/**
 * 送る前に画像を縮める。
 *
 * サーバー側でも縮めているが、クライアントで縮めるのは通信量のため。
 * 携帯で撮った写真は4000px・5MB近くあり、そのまま送ると回線が細いときに待たされる。
 * 長辺1024pxなら通常300KB以下になる。
 *
 * 生成パイプラインは長辺1024pxを前提にしているので、これ以上大きく送っても
 * 品質は上がらない。
 */

/** 生成側が前提にしている大きさ。これを超えるぶんは送っても無駄になる */
const MAX_EDGE = 1024;

/** JPEG の品質。0.85 は写真で劣化が目に付かず、容量が十分小さくなる値 */
const JPEG_QUALITY = 0.85;

/**
 * 画像を長辺 1024px 以下の JPEG に変換する。
 *
 * 透過は失われる。生成側は背景を自動で除去するので、透過を保つ必要がない。
 *
 * @param file 選ばれた画像。HEIC など canvas が扱えない形式のときは、
 *             縮小せずそのまま返す（サーバー側が対応している）
 */
export async function shrinkForUpload(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // createImageBitmap は EXIF の回転を反映しない実装があるため明示する
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // iPhone の HEIC はブラウザによってデコードできない。
    // サーバー側が対応しているので、そのまま送って任せる
    return file;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
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
