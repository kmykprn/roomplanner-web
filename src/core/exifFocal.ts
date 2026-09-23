/**
 * 写真に記録されたレンズの焦点距離（EXIF）から、縦の画角を出す。
 *
 * スマホの写真には「35mm 換算の焦点距離」が入っている（iPhone なら 1× で 26mm、
 * 0.5× で 13mm など）。これがあれば、写真から推定するより画角がずっと正確に決まる。
 *
 * **縮める前の元のファイルから読む。** 表示用に縮めると canvas を通るので EXIF が消える。
 * JPEG だけを読む（iPhone の写真もブラウザに渡るときは JPEG になる）。
 * 読めない・入っていない写真（スクリーンショット、送られてきて EXIF が消えた写真）は null。
 */

/** 35mm 判（36 × 24 mm）の対角線の長さ。換算焦点距離はこれを基準にしている */
const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
/** EXIF は先頭にある。念のため多めに読むが、ファイル全体は読まない */
const HEADER_BYTES = 256 * 1024;

const TAG_EXIF_IFD = 0x8769;
const TAG_FOCAL_35MM = 0xa405;

/** 35mm 換算の焦点距離（mm）。読めなければ null */
export async function readFocal35(file: Blob): Promise<number | null> {
  try {
    const view = new DataView(await file.slice(0, HEADER_BYTES).arrayBuffer());
    return findFocal35(view);
  } catch {
    return null;
  }
}

/**
 * 換算焦点距離と写真の縦横比（幅 ÷ 高さ、向きを直したあと）から、縦の画角（度）。
 * 換算は対角線で合わせてあるので、写真の対角線を 35mm 判の対角線に当てて高さを出す
 */
export function vfovFromFocal35(focal35: number, aspect: number): number {
  const heightMm = FULL_FRAME_DIAGONAL_MM / Math.hypot(aspect, 1);
  return (2 * Math.atan(heightMm / (2 * focal35)) * 180) / Math.PI;
}

/** JPEG の APP1（Exif）を探し、Exif IFD の換算焦点距離を読む */
function findFocal35(view: DataView): number | null {
  if (view.getUint16(0) !== 0xffd8) return null; // JPEG ではない
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    // APP1 で、中身が "Exif\0\0" で始まるもの
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      return readTiff(view, offset + 10);
    }
    // 画像本体が始まったら、その先に EXIF は無い
    if (marker === 0xffda || (marker & 0xff00) !== 0xff00) return null;
    offset += 2 + size;
  }
  return null;
}

/** TIFF の構造（IFD0 → Exif IFD）をたどる。start は TIFF ヘッダの先頭 */
function readTiff(view: DataView, start: number): number | null {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (at: number): number => view.getUint16(start + at, little);
  const u32 = (at: number): number => view.getUint32(start + at, little);

  const exifIfd = findTag(u16, u32, u32(4), TAG_EXIF_IFD);
  if (exifIfd === null) return null;
  const focal = findTag(u16, u32, exifIfd, TAG_FOCAL_35MM);
  // 0 は「不明」の意味で入っていることがある
  return focal && focal > 0 ? focal : null;
}

/** IFD の中から 1 つのタグの値を読む。SHORT なら値そのもの、LONG なら値（オフセットのこともある） */
function findTag(
  u16: (at: number) => number,
  u32: (at: number) => number,
  ifd: number,
  tag: number
): number | null {
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) !== tag) continue;
    const type = u16(entry + 2);
    if (type === 3) return u16(entry + 8); // SHORT
    if (type === 4) return u32(entry + 8); // LONG
    return null;
  }
  return null;
}
