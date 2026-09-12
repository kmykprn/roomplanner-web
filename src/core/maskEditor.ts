/**
 * 手前にある物の指定（マスク）を作る道具の中身。
 *
 * なぞる・囲む・消しゴムはどれも**同じマスクに形を描くだけ**で、出口は1つ。
 * 描いた形を画像にして状態（photoState.maskUrl）へ渡し、表示側（core/viewer.ts）が
 * その画像で写真を切り抜いてキャンバスの上に重ねる。3D には何も教えない。
 *
 * 指の動きをどの道具に渡すかは interaction/maskPaint.ts、
 * ボタン（囲みを閉じる・戻す）は ui/maskPanel.ts。どちらもここを呼ぶ。
 */

import { photoState, setMaskPolygon, setMaskUndoDepth, setMaskUrl } from '@/core/photoState';
import type { PhotoPoint } from '@/core/photoView';
import { saveMask } from '@/platform/backgroundStore';

/** マスクの解像度（長辺、ピクセル）。写真より粗くてよい。塗りの縁が見える程度で十分 */
const MASK_LONG_EDGE = 1024;

/**
 * 画面の幅に対する割合で持つ太さ。**寄っても画面上の太さは変えない。**
 * 寄れば寄るほど写真の上では細くなるので、細部は寄って描く
 */
const BRUSH_SCREEN_FRACTION = { thin: 0.012, thick: 0.035 };
/** 囲む途中の線と、打った角の印 */
const OUTLINE_SCREEN_FRACTION = 0.004;
const CORNER_SCREEN_FRACTION = 0.012;
/** 最初の角からこの距離（画面の幅に対する割合）以内をタップしたら、囲みを閉じたとみなす */
const CLOSE_TAP_SCREEN_FRACTION = 0.04;

/** 「戻す」で戻れる回数。1回ぶんの控えはマスクの画素数と同じ大きさなので、増やしすぎない */
const UNDO_LIMIT = 10;

export interface MaskEditor {
  /** なぞる・消しゴム。なぞった通りに塗る／消す（どちらかは道具で決まる） */
  beginStroke(point: PhotoPoint): void;
  extendStroke(point: PhotoPoint): void;
  endStroke(): void;
  /** 囲む。角を打ち、閉じると中が塗られる。最初の角をもう一度タップしても閉じる */
  addCorner(point: PhotoPoint): void;
  closePolygon(): void;
  /**
   * 1つ戻す。どの道具でも使える。
   * 囲む途中の角があればそれを 1 つ、無ければ最後に描いた形（一筆・囲み・全部消す）を戻す
   */
  undo(): void;
}

function createMaskEditor(): MaskEditor {
  /** 塗った形そのもの。写真の縦横比が変わったら作り直す */
  const mask = document.createElement('canvas');
  const context = mask.getContext('2d') as CanvasRenderingContext2D;
  /** 表示用。囲う途中の線を、塗った形の上に重ねて出すために別に持つ */
  const preview = document.createElement('canvas');
  const previewContext = preview.getContext('2d') as CanvasRenderingContext2D;

  /** 自分が状態へ渡した URL。よそから来た URL（起動時の読み戻し）と区別する */
  let producedUrl: string | null = null;
  let previousPoint: { x: number; y: number } | null = null;
  /** 描いている途中の見た目の更新は 1 フレームに 1 回にまとめる */
  let previewRequest = 0;
  let lastToolKind = photoState.get().maskTool.kind;
  /**
   * 「戻す」のための控え。形を描く前のマスクを、不透明度だけ取り出して積む
   * （マスクは白か透明かしか無いので、不透明度だけで元に戻せる）
   */
  const history: Uint8ClampedArray[] = [];

  function toPixel(point: PhotoPoint): { x: number; y: number } {
    return { x: point.x * mask.width, y: point.y * mask.height };
  }

  /** 画面上で一定に見える太さを、いまの寄り具合でマスクのピクセルに直す */
  function screenFractionToPixels(fraction: number): number {
    return (fraction / photoState.get().view.scale) * mask.width;
  }

  /** 塗るか消すか。消しゴムだけが消す */
  function compositeOperation(): GlobalCompositeOperation {
    return photoState.get().maskTool.kind === 'eraser' ? 'destination-out' : 'source-over';
  }

  /** いまのマスクの不透明度だけを取り出す。何か塗ってあるかも一緒に返す */
  function captureAlpha(): { alpha: Uint8ClampedArray; painted: boolean } {
    const { data } = context.getImageData(0, 0, mask.width, mask.height);
    const alpha = new Uint8ClampedArray(mask.width * mask.height);
    let painted = false;
    for (let index = 0; index < alpha.length; index++) {
      alpha[index] = data[index * 4 + 3];
      if (alpha[index]) painted = true;
    }
    return { alpha, painted };
  }

  /** 形を描く前に、いまのマスクを控える。上限を超えたら古いものから捨てる */
  function remember(alpha = captureAlpha().alpha): void {
    history.push(alpha);
    if (history.length > UNDO_LIMIT) history.shift();
    setMaskUndoDepth(history.length);
  }

  /** 控えたマスクに戻す。白＋控えた不透明度で描き直す */
  function restore(alpha: Uint8ClampedArray): void {
    const image = new ImageData(mask.width, mask.height);
    for (let index = 0; index < alpha.length; index++) {
      const offset = index * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = alpha[index];
    }
    context.putImageData(image, 0, 0);
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
    preview.width = width;
    preview.height = height;
    return true;
  }

  /** 表示に出す絵。囲う途中なら、塗った形の上に線と角の印を重ねる */
  function renderPreview(): HTMLCanvasElement {
    const { maskPolygon } = photoState.get();
    if (maskPolygon.length === 0) return mask;

    previewContext.globalCompositeOperation = 'source-over';
    previewContext.clearRect(0, 0, preview.width, preview.height);
    previewContext.drawImage(mask, 0, 0);
    previewContext.strokeStyle = '#fff';
    previewContext.fillStyle = '#fff';
    previewContext.lineWidth = screenFractionToPixels(OUTLINE_SCREEN_FRACTION);
    previewContext.lineJoin = 'round';

    const corners = maskPolygon.map(toPixel);
    previewContext.beginPath();
    corners.forEach((corner, index) =>
      index === 0
        ? previewContext.moveTo(corner.x, corner.y)
        : previewContext.lineTo(corner.x, corner.y)
    );
    previewContext.stroke();
    const radius = screenFractionToPixels(CORNER_SCREEN_FRACTION) / 2;
    for (const corner of corners) {
      previewContext.beginPath();
      previewContext.arc(corner.x, corner.y, radius, 0, Math.PI * 2);
      previewContext.fill();
    }
    return preview;
  }

  /** 描いている途中の見た目。URL を作るのは重いので 1 フレームに 1 回 */
  function schedulePreview(): void {
    if (previewRequest) return;
    previewRequest = requestAnimationFrame(() => {
      previewRequest = 0;
      producedUrl = renderPreview().toDataURL();
      setMaskUrl(producedUrl);
    });
  }

  /** 描き終わり。画像にして状態へ渡し、端末にも残す */
  function commit(): void {
    mask.toBlob((blob) => {
      if (!blob) return;
      producedUrl = URL.createObjectURL(blob);
      setMaskUrl(producedUrl);
      saveMask(blob).catch(() => {});
    });
  }

  // --- なぞる・消しゴム ---

  function beginStroke(point: PhotoPoint): void {
    if (!ensureMaskSize()) return;
    remember();
    const { thick } = photoState.get().maskTool;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#fff';
    context.lineWidth = screenFractionToPixels(
      thick ? BRUSH_SCREEN_FRACTION.thick : BRUSH_SCREEN_FRACTION.thin
    );
    context.globalCompositeOperation = compositeOperation();

    previousPoint = toPixel(point);
    // 触れただけでも点を打つ。細かい場所は点で埋める
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(previousPoint.x + 0.01, previousPoint.y);
    context.stroke();
    schedulePreview();
  }

  function extendStroke(point: PhotoPoint): void {
    if (!previousPoint) return;
    const pixel = toPixel(point);
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(pixel.x, pixel.y);
    context.stroke();
    previousPoint = pixel;
    schedulePreview();
  }

  function endStroke(): void {
    if (!previousPoint) return;
    previousPoint = null;
    commit();
  }

  // --- 囲む ---

  function addCorner(point: PhotoPoint): void {
    if (!ensureMaskSize()) return;
    const corners = photoState.get().maskPolygon;

    // 3 つ以上打ってあって、最初の角の近くをタップしたら「閉じる」の合図
    if (corners.length >= 3) {
      const first = corners[0];
      const distance = Math.hypot(point.x - first.x, point.y - first.y);
      if (distance <= CLOSE_TAP_SCREEN_FRACTION / photoState.get().view.scale) {
        closePolygon();
        return;
      }
    }

    setMaskPolygon([...corners, point]);
    schedulePreview();
  }

  function closePolygon(): void {
    const corners = photoState.get().maskPolygon.map(toPixel);
    setMaskPolygon([]);
    if (corners.length < 3) {
      schedulePreview();
      return;
    }
    remember();
    context.globalCompositeOperation = compositeOperation();
    context.fillStyle = '#fff';
    context.beginPath();
    corners.forEach((corner, index) =>
      index === 0 ? context.moveTo(corner.x, corner.y) : context.lineTo(corner.x, corner.y)
    );
    context.closePath();
    context.fill();
    commit();
  }

  // --- 戻す ---

  function undo(): void {
    const { maskPolygon } = photoState.get();
    if (maskPolygon.length > 0) {
      setMaskPolygon(maskPolygon.slice(0, -1));
      schedulePreview();
      return;
    }
    const previous = history.pop();
    if (!previous) return;
    setMaskUndoDepth(history.length);
    restore(previous);
    commit();
  }

  /**
   * よそで状態が変わったら合わせる。
   *   - マスクが差し替わった（起動時の読み戻し・全部消す）→ 塗る先も描き直す／白紙にする
   *   - 道具を変えた・「手前」タブを閉じた → 囲む途中の角は捨てる
   */
  function followState(): void {
    const { maskUrl, maskTool, isMasking, maskPolygon } = photoState.get();

    if ((maskTool.kind !== lastToolKind || !isMasking) && maskPolygon.length > 0) {
      setMaskPolygon([]);
      schedulePreview();
    }
    lastToolKind = maskTool.kind;

    if (maskUrl === producedUrl) return;
    producedUrl = maskUrl;
    if (!ensureMaskSize()) return;
    // 「全部消す」も戻せるように、消す前に控える。何も塗っていなければ控えない
    // （起動時の読み戻しは白紙から始まるので、ここには引っかからない）
    if (!maskUrl) {
      const current = captureAlpha();
      if (current.painted) remember(current.alpha);
    }
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

  photoState.subscribe(followState);
  followState();

  return { beginStroke, extendStroke, endStroke, addCorner, closePolygon, undo };
}

export const maskEditor = createMaskEditor();
