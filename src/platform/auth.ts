/**
 * 認証をこの 1 ファイルに隔離する。
 *
 * picker.ts が写真の取得を隔離しているのと同じ考え方。
 * いまは匿名認証だけだが、商用化するとGoogle/Appleログインが要る。
 * そのとき触るのはこのファイルとログインボタンのUIだけで済むようにしてある。
 *
 * ## 匿名認証を選んでいる理由
 *
 * ログイン画面なしで使い始められること。
 * uid（利用者を区別する識別子）はブラウザに保存され、次回も同じものが使われる。
 *
 * ## 商用化したときどう変わるか
 *
 * 匿名アカウントは「昇格」できる（linkWithPopup）。**昇格しても uid は変わらない**
 * ので、それまでに作ったデータもサーバー側の登録もそのまま引き継がれる。
 * signInWithPopup を使うと別の uid でログインし直してしまい、データも
 * 許可リストの登録も切り離されるので、そちらは使わない。
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from 'firebase/auth';
import { FIREBASE_CONFIG } from '@/config/api';

const auth = getAuth(initializeApp(FIREBASE_CONFIG));

/**
 * 認証が済むまで待つ。
 *
 * onAuthStateChanged は「保存済みのログイン状態を復元し終えた」時点でも呼ばれる。
 * 先に signInAnonymously を呼ぶと復元前の状態で新しいアカウントを作ってしまうため、
 * 通知を待ってから、未ログインのときだけ作る。
 */
const ready: Promise<User> = new Promise((resolve, reject) => {
  const stop = onAuthStateChanged(
    auth,
    (user) => {
      if (user) {
        stop();
        resolve(user);
        return;
      }
      signInAnonymously(auth).catch(reject);
    },
    reject
  );
});

/** APIを叩くためのトークン。1時間で失効するので、必要になるたびに取り直す */
export async function getIdToken(): Promise<string> {
  const user = await ready;
  // 引数なしだと期限が近いときだけ更新される。毎回強制更新はしない
  return user.getIdToken();
}

/**
 * 利用者を区別する識別子。
 *
 * 限定公開のうちは、これをサーバー側の許可リストに登録してもらう必要があるため
 * 画面に表示する。個人情報は含まれない（匿名アカウントなので紐づく情報が無い）。
 */
export async function getUid(): Promise<string> {
  return (await ready).uid;
}

/**
 * お金がかかる操作の前に、本登録を求める。
 *
 * **いまは何もしない。** 限定公開では許可リストが門番なので、匿名のままでよい。
 *
 * 商用化するとここに Google/Apple ログインへの昇格（linkWithPopup）が入る。
 * 呼び出し位置を先に作っておくのは、あとから探し直さないため。
 * サーバー側もトークンの sign_in_provider を見れば匿名かどうか判定できるので、
 * クライアントを信用せずに強制できる。
 */
export async function ensureRegistered(): Promise<void> {
  await ready;
}
