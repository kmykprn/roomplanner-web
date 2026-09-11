/**
 * ネイティブ依存をここ 1 ファイルに隔離する。
 *
 * ブラウザでは <input type="file"> で写真の選択もカメラ起動もできる。
 * Capacitor で iOS アプリにするときは、この関数の中身だけを
 * @capacitor/camera に差し替えればよく、呼び出し側は一切変わらない。
 *
 * v4 の app/furniture/create.tsx が expo-image-picker に直接依存していた部分に相当する。
 */

/**
 * cancel が飛んだあと、遅れて届く写真を待つ猶予（ミリ秒）。
 *
 * **iOS は写真を渡す前にシートを閉じることがある。** iCloud からの取得や
 * HEIC→JPEG の変換が挟まるためで、そのとき cancel が change より先に飛ぶ。
 * ここで即座に「キャンセルされた」と決めると、**あとから届いた写真を捨てる**。
 *
 * 実際に「1回目は反映されず、2回目は反映される」という形で踏んだ。
 * 1回目で変換が済んで端末に残り、2回目は即座に渡されるためそう見える。
 *
 * 本当にキャンセルされた場合はこの時間ぶん何も起きないが、
 * 画面上は元から何も起きないので害はない。
 */
const LATE_FILE_GRACE_MS = 5000;

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

    // 文書に入れてから開く。切り離したままの要素は参照が切れると回収され得るので、
    // 選択が終わる前にイベントごと消える余地を作らない
    input.style.display = 'none';
    document.body.appendChild(input);

    let graceTimer = 0;
    let settled = false;

    /** 1 度だけ決着させ、後片付けをする */
    function finish(files: File[]): void {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      input.remove();
      resolve(files);
    }

    input.addEventListener('change', () => finish([...(input.files ?? [])]));

    // cancel では即断せず、猶予のあいだ待ってから改めてファイルの有無を見る
    input.addEventListener('cancel', () => {
      graceTimer = window.setTimeout(() => finish([...(input.files ?? [])]), LATE_FILE_GRACE_MS);
    });

    input.click();
  });
}
