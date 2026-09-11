/**
 * 画像を縮める。用途が2つある。
 *
 * **送る前**（生成API）… 通信量のため。携帯で撮った写真は4000px・5MB近くあり、
 * そのまま送ると回線が細いときに待たされる。生成パイプラインは長辺1024pxを
 * 前提にしているので、これ以上大きく送っても品質は上がらない。
 *
 * **画面に出す前**（写真モードの背景）… 表示のため。**Safari は大きすぎる画像を
 * 描かないことがある**（端末のメモリに応じた上限がある）。原寸のまま背景に
 * 敷くと、読み込めているのに真っ黒のまま、という形で出る。
 */

/** 生成側が前提にしている大きさ。これを超えるぶんは送っても無駄になる */
const MAX_EDGE_UPLOAD = 1024;

/** 画面に出すための大きさ。高解像度の画面でも粗く見えない程度に取る */
const MAX_EDGE_DISPLAY = 1600;

/** JPEG の品質。0.85 は写真で劣化が目に付かず、容量が十分小さくなる値 */
const JPEG_QUALITY = 0.85;

/**
 * 生成APIへ送るために縮める。
 *
 * 透過は失われる。生成側は背景を自動で除去するので、透過を保つ必要がない。
 */
export function shrinkForUpload(file: File): Promise<Blob> {
  return shrink(file, MAX_EDGE_UPLOAD);
}

/**
 * 画面に出すために縮める。
 *
 * こちらは縮小に失敗しても呼び出し側が表示の成否を確かめるので、
 * 元の画像を返して判断を任せる。
 */
export function shrinkForDisplay(file: File): Promise<Blob> {
  return shrink(file, MAX_EDGE_DISPLAY);
}

/**
 * 長辺を maxEdge 以下に収めた JPEG を作る。
 *
 * @param file 選ばれた画像。HEIC など canvas が扱えない形式のときは、
 *             縮小せずそのまま返す（送信先やブラウザ側の対応に任せる）
 */
async function shrink(file: File, maxEdge: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // createImageBitmap は EXIF の回転を反映しない実装があるため明示する
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // iPhone の HEIC はブラウザによってデコードできない。
    // 送る場合はサーバー側が対応しているので、そのまま渡して任せる
    return file;
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  // すでに十分小さいなら、再エンコードして画質を落とすだけ損になる
  if (scale === 1 && file.size <= 1024 * 1024) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  // 変換に失敗しても、元の画像で試せるようにする
  return blob ?? file;
}
