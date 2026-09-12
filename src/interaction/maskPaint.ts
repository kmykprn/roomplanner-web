/**
 * 隠す場所を指で塗る。
 *
 * 写真の中で家具の手前にある物（机など）をなぞると、そこだけ写真が 3D の
 * 手前に出て、後ろへ動かした家具が隠れる。
 *
 * 塗った形は写真と同じ座標系のキャンバス（マスク）に描き、画像にして状態へ渡す。
 * 表示側（core/viewer.ts）はその画像で写真を切り抜いてキャンバスの上に重ねる。
 * **3D には何も教えない。** 隠れて見えるのは重ね順のおかげで、深度は使っていない。
 *
 * 「隠す」タブを開いている間だけ効く。1 本指が筆になり、2 本指は寄る操作のまま。
 */

import { photoState, setMaskUrl } from '@/core/photoState';
import { photoPointAt, type ScreenPoint } from '@/core/photoView';
import { saveMask } from '@/platform/backgroundStore';

/** マスクの解像度（長辺、ピクセル）。写真より粗くてよい。塗りの縁が見える程度で十分 */
const MASK_LONG_EDGE = 1024;

/**
 * 筆の太さ。画面の幅に対する割合で持ち、**寄っても画面上の太さは変えない。**
 * 寄れば寄るほど写真の上では細くなるので、細部は寄って塗る
 */
const BRUSH_SCREEN_FRACTION = { thin: 0.012, thick: 0.035 };

export function createMaskPaint(canvas: HTMLCanvasElement): () => void {
  /** 塗る先。写真の縦横比が変わったら作り直す */
  const mask = document.createElement('canvas');
  const context = mask.getContext('2d') as CanvasRenderingContext2D;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#fff';

  /** 自分が状態へ渡した URL。よそから来た URL（起動時の読み戻し）と区別する */
  let producedUrl: string | null = null;
  /** 触れている指。2 本になったら筆を止める */
  const activePointers = new Set<number>();
  let strokePointer: number | null = null;
  let previousPoint: { x: number; y: number } | null = null;
  /** 描いている途中の見た目の更新は 1 フレームに 1 回にまとめる */
  let previewRequest = 0;

  /** 画面の座標を、マスクのピクセル座標に直す（寄っているぶんも織り込む） */
  function toMaskPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const screen: ScreenPoint = {
      u: (event.clientX - rect.left) / rect.width,
      v: (event.clientY - rect.top) / rect.height,
    };
    const photo = photoPointAt(photoState.get().view, screen);
    return { x: photo.x * mask.width, y: photo.y * mask.height };
  }

  /** 写真の縦横比に合わせてマスクを用意する。比が変わっていなければそのまま */
  function ensureMaskSize(): boolean {
    const { backgroundAspect } = photoState.get();
    if (!backgroundAspect) return false;
    const width =
      backgroundAspect >= 1 ? MASK_LONG_EDGE : Math.round(MASK_LONG_EDGE * backgroundAspect);
    const height =
      backgroundAspect >= 1 ? Math.round(MASK_LONG_EDGE / backgroundAspect) : MASK_LONG_EDGE;
    if (mask.width === width && mask.height === height) return true;
    mask.width = width;
    mask.height = height;
    // 大きさを変えると描画の設定も消えるので入れ直す
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#fff';
    return true;
  }

  function applyTool(): void {
    const { maskTool, view } = photoState.get();
    const fraction = maskTool.thick ? BRUSH_SCREEN_FRACTION.thick : BRUSH_SCREEN_FRACTION.thin;
    // 画面上の太さを保つため、寄っているぶんだけ写真の上では細くする
    context.lineWidth = (fraction / view.scale) * mask.width;
    context.globalCompositeOperation = maskTool.erase ? 'destination-out' : 'source-over';
  }

  /** 描いている途中の見た目。URL を作るのは重いので 1 フレームに 1 回 */
  function schedulePreview(): void {
    if (previewRequest) return;
    previewRequest = requestAnimationFrame(() => {
      previewRequest = 0;
      producedUrl = mask.toDataURL();
      setMaskUrl(producedUrl);
    });
  }

  /** 塗り終わり。画像にして状態へ渡し、端末にも残す */
  function commit(): void {
    mask.toBlob((blob) => {
      if (!blob) return;
      producedUrl = URL.createObjectURL(blob);
      setMaskUrl(producedUrl);
      saveMask(blob).catch(() => {});
    });
  }

  function endStroke(): void {
    if (strokePointer === null) return;
    strokePointer = null;
    previousPoint = null;
    commit();
  }

  function onPointerDown(event: PointerEvent): void {
    activePointers.add(event.pointerId);
    // 2 本目が触れたら筆を置く。寄る操作の途中で線が引かれないように
    if (activePointers.size > 1) {
      endStroke();
      return;
    }
    if (!photoState.get().isMasking || !event.isPrimary) return;
    if (!ensureMaskSize()) return;

    applyTool();
    strokePointer = event.pointerId;
    previousPoint = toMaskPoint(event);
    // 触れただけでも点を打つ。細かい場所は点で埋める
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(previousPoint.x + 0.01, previousPoint.y);
    context.stroke();
    schedulePreview();
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== strokePointer || !previousPoint) return;
    const point = toMaskPoint(event);
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    previousPoint = point;
    schedulePreview();
  }

  function onPointerUp(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    if (event.pointerId === strokePointer) endStroke();
  }

  /**
   * よそでマスクが差し替わったら、塗る先も合わせる。
   * 起動時に読み戻したときは画像から描き直し、消されたときは白紙にする
   */
  function followState(): void {
    const { maskUrl } = photoState.get();
    if (maskUrl === producedUrl) return;
    producedUrl = maskUrl;
    if (!ensureMaskSize()) return;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, mask.width, mask.height);
    if (!maskUrl) return;
    const image = new Image();
    image.onload = () => {
      // 読んでいる間にまた差し替わっていたら、古い絵で上書きしない
      if (photoState.get().maskUrl !== maskUrl) return;
      context.drawImage(image, 0, 0, mask.width, mask.height);
    };
    image.src = maskUrl;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  const unsubscribe = photoState.subscribe(followState);
  followState();

  return function dispose(): void {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    unsubscribe();
    cancelAnimationFrame(previewRequest);
  };
}
