/**
 * ネイティブ依存をここ 1 ファイルに隔離する。
 *
 * ブラウザでは <input type="file"> で写真の選択もカメラ起動もできる。
 * Capacitor で iOS アプリにするときは、この関数の中身だけを
 * @capacitor/camera に差し替えればよく、呼び出し側は一切変わらない。
 *
 * v4 の app/furniture/create.tsx が expo-image-picker に直接依存していた部分に相当する。
 */

/** Capacitor に包まれて動いているか判定する */
export function isNativeApp(): boolean {
  return 'Capacitor' in window;
}

/**
 * 画像を 1 枚選ばせる。キャンセルされたら null を返す。
 *
 * @param useCamera true ならカメラを直接起動する（対応環境のみ）
 */
export function pickImage(useCamera = false): Promise<File | null> {
  return pickFiles(useCamera, false).then((files) => files[0] ?? null);
}

/** 複数の写真を一度に選ばせる。キャンセル時は空配列を返す。 */
export function pickImages(): Promise<File[]> {
  return pickFiles(false, true);
}

function pickFiles(useCamera: boolean, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;

    // iOS Safari / Android Chrome はこの属性でカメラが直接開く
    if (useCamera) input.capture = 'environment';

    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
    });

    // ファイル選択をキャンセルしたときに Promise が残り続けないようにする
    input.addEventListener('cancel', () => resolve([]));

    input.click();
  });
}
