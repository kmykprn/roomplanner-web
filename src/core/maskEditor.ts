/**
 * 隠す場所（マスク）を作る道具の中身。
 *
 * 筆・囲う・似た色、の3つはどれも**同じマスクに形を描くだけ**で、出口は1つ。
 * 描いた形を画像にして状態（photoState.maskUrl）へ渡し、表示側（core/viewer.ts）が
 * その画像で写真を切り抜いてキャンバスの上に重ねる。3D には何も教えない。
 *
 * 指の動きをどの道具に渡すかは interaction/maskPaint.ts、
 * ボタン（閉じて塗る・1つ戻す）は ui/maskPanel.ts。どちらもここを呼ぶ。
 */

import { photoState, setMaskPolygon, setMaskUrl } from '@/core/photoState';
import type { PhotoPoint } from '@/core/photoView';
import { saveMask } from '@/platform/backgroundStore';

/** マスクの解像度（長辺、ピクセル）。写真より粗くてよい。塗りの縁が見える程度で十分 */
const MASK_LONG_EDGE = 1024;

/**
 * 画面の幅に対する割合で持つ太さ。**寄っても画面上の太さは変えない。**
 * 寄れば寄るほど写真の上では細くなるので、細部は寄って描く
 */
const BRUSH_SCREEN_FRACTION = { thin: 0.012, thick: 0.035 };
/** 囲う途中の線と、打った角の印 */
const OUTLINE_SCREEN_FRACTION = 0.004;
const CORNER_SCREEN_FRACTION = 0.012;

export interface MaskEditor {
  /** 筆。なぞった通りに塗る */
  beginStroke(point: PhotoPoint): void;
  extendStroke(point: PhotoPoint): void;
  endStroke(): void;
  /** 囲う。角を打ち、閉じると中が塗られる */
  addCorner(point: PhotoPoint): void;
  undoCorner(): void;
  closePolygon(): void;
  /** 似た色。タップした点と似た色が続く範囲をまとめて塗る */
  fillSimilar(point: PhotoPoint): Promise<void>;
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
  /** 似た色に使う写真の画素。写真が変わるまで使い回す */
  let photoPixels: { url: string; data: ImageData } | null = null;
  let lastToolKind = photoState.get().maskTool.kind;

  function toPixel(point: PhotoPoint): { x: number; y: number } {
    return { x: point.x * mask.width, y: point.y * mask.height };
  }

  /** 画面上で一定に見える太さを、いまの寄り具合でマスクのピクセルに直す */
  function screenFractionToPixels(fraction: number): number {
    return (fraction / photoState.get().view.scale) * mask.width;
  }

  /** 塗るか消すか。どの道具も同じ */
  function compositeOperation(): GlobalCompositeOperation {
    return photoState.get().maskTool.erase ? 'destination-out' : 'source-over';
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

  // --- 筆 ---

  function beginStroke(point: PhotoPoint): void {
    if (!ensureMaskSize()) return;
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

  // --- 囲う ---

  function addCorner(point: PhotoPoint): void {
    if (!ensureMaskSize()) return;
    setMaskPolygon([...photoState.get().maskPolygon, point]);
    schedulePreview();
  }

  function undoCorner(): void {
    setMaskPolygon(photoState.get().maskPolygon.slice(0, -1));
    schedulePreview();
  }

  function closePolygon(): void {
    const corners = photoState.get().maskPolygon.map(toPixel);
    setMaskPolygon([]);
    if (corners.length < 3) {
      schedulePreview();
      return;
    }
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

  // --- 似た色 ---

  /** 写真をマスクと同じ大きさで読み、画素を取り出す。写真が変わるまで使い回す */
  async function ensurePhotoPixels(): Promise<ImageData | null> {
    const { backgroundUrl } = photoState.get();
    if (!backgroundUrl || !ensureMaskSize()) return null;
    if (photoPixels?.url === backgroundUrl) return photoPixels.data;

    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => resolve(null);
      element.src = backgroundUrl;
    });
    if (!image) return null;

    const canvas = document.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    const pixelContext = canvas.getContext('2d') as CanvasRenderingContext2D;
    pixelContext.drawImage(image, 0, 0, mask.width, mask.height);
    photoPixels = {
      url: backgroundUrl,
      data: pixelContext.getImageData(0, 0, mask.width, mask.height),
    };
    return photoPixels.data;
  }

  async function fillSimilar(point: PhotoPoint): Promise<void> {
    const pixels = await ensurePhotoPixels();
    if (!pixels) return;

    const seed = toPixel(point);
    const region = similarRegion(
      pixels,
      Math.floor(seed.x),
      Math.floor(seed.y),
      photoState.get().maskTool.tolerance
    );

    // 選ばれた画素だけ白（不透明）にした画像を作り、塗る／消すの決まりで重ねる
    const patch = new ImageData(mask.width, mask.height);
    for (let index = 0; index < region.length; index++) {
      if (region[index]) patch.data[index * 4 + 3] = 255;
    }
    const canvas = document.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    (canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(patch, 0, 0);
    context.globalCompositeOperation = compositeOperation();
    context.drawImage(canvas, 0, 0);
    commit();
  }

  /**
   * よそで状態が変わったら合わせる。
   *   - マスクが差し替わった（起動時の読み戻し・全部消す）→ 塗る先も描き直す／白紙にする
   *   - 道具を変えた・「隠す」タブを閉じた → 囲う途中の角は捨てる
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

  return { beginStroke, extendStroke, endStroke, addCorner, undoCorner, closePolygon, fillSimilar };
}

/**
 * タップした点と似た色が続く範囲（画像編集の「自動選択」）。
 *
 * 隣を辿りながら、**最初の点の色**と比べる。隣どうしで比べると、少しずつ色が
 * 変わる面（グラデーション）で際限なく広がってしまう
 */
function similarRegion(
  image: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number
): Uint8Array {
  const { width, height, data } = image;
  const selected = new Uint8Array(width * height);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return selected;

  const seedIndex = (seedY * width + seedX) * 4;
  const [seedR, seedG, seedB] = [data[seedIndex], data[seedIndex + 1], data[seedIndex + 2]];
  // 3 チャンネルの差の二乗平均が、許容（0〜1 を 0〜255 に伸ばしたもの）の二乗以内なら似ている
  const limit = (tolerance * 255) ** 2 * 3;

  const stack = [seedY * width + seedX];
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (selected[index]) continue;
    const offset = index * 4;
    const dr = data[offset] - seedR;
    const dg = data[offset + 1] - seedG;
    const db = data[offset + 2] - seedB;
    if (dr * dr + dg * dg + db * db > limit) continue;
    selected[index] = 1;

    const x = index % width;
    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (index >= width) stack.push(index - width);
    if (index + width < width * height) stack.push(index + width);
  }
  return selected;
}

export const maskEditor = createMaskEditor();
