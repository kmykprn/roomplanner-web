/**
 * 認証をこの 1 ファイルに隔離する。
 *
 * picker.ts が写真の取得を隔離しているのと同じ考え方。
 * 触るのはこのファイルとログインの UI だけで済むようにしてある。
 *
 * ## 匿名で始めて、あとから Google に紐づける
 *
 * 初回はログイン画面なしで匿名アカウントを作り、uid（利用者を区別する識別子）を
 * ブラウザに保存する。ただし匿名のままだと、サイトデータが消えた時点で
 * uid ごと消えて二度と戻れない（Safari は 7 日間使わないだけでこれが起きる）。
 *
 * そこで `signInWithGoogle()` で匿名アカウントを Google に**昇格**させる
 * （linkWithPopup）。**昇格しても uid は変わらない**ので、それまでに作ったものも
 * サーバー側の許可リストの登録もそのまま引き継がれ、別の端末からも同じ uid に戻れる。
 * signInWithPopup で入り直すと別の uid になって全部が切り離されるので、
 * 1 台目ではそちらを使わない（分岐は googleLink.ts）。
 *
 * ## iOS はポップアップではなくリダイレクト
 *
 * iOS Safari はポップアップの結果を持ち帰れず「ログインしています…」のまま止まる
 * （実機で再現）。iOS では linkWithRedirect で Google へ遷移し、戻ってきた起動時に
 * getRedirectResult で結果を受け取る。**匿名ログインより先に受け取る**こと。先に
 * signInAnonymously が走ると、戻ってきた昇格の結果を別の新しいアカウントで上書きする。
 *
 * リダイレクトはページを読み直すので、選んでいた写真は持ち越せない。戻ってきたことを
 * redirectLogin で画面に伝え、写真を選び直してもらう。
 *
 * ## 「今のユーザー」を追い続ける
 *
 * 2 台目で既存のアカウントへログインし直すと、Firebase の現在ユーザーは別の
 * オブジェクトに差し替わる。最初に掴んだユーザーを持ち続けると、古い uid と
 * 失効したトークンを返してしまう。getUid / getIdToken は常に今のユーザーを見る。
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import { createStore } from '@/core/store';
import { FIREBASE_CONFIG, IS_CONFIGURED } from '@/config/api';
import { finishRedirect, linkOrSignIn, shouldUseRedirect } from '@/platform/googleLink';

const NOT_CONFIGURED = 'Firebase の設定が入っていません（VITE_FIREBASE_API_KEY）';

export interface AuthState {
  /** pending: 保存済みの状態を復元中 / ready: 使える / failed: 認証できない（この起動では直らない） */
  status: 'pending' | 'ready' | 'failed';
  uid: string | null;
  /** まだ Google に紐づけていない。サイトデータが消えると uid ごと消える状態 */
  anonymous: boolean;
  error: string | null;
}

export interface RedirectLoginState {
  /** none: リダイレクト経由の起動ではない / signed-in: 戻ってきてログインできた / failed: 戻ってきたが失敗 */
  outcome: 'none' | 'signed-in' | 'failed';
  error: string | null;
}

/**
 * リダイレクトでのログインから戻ってきたときの結果。iOS でだけ入る。
 * ページを読み直しているので選んでいた写真は無く、画面はこれを見て選び直しを促す
 */
export const redirectLogin = createStore<RedirectLoginState>({ outcome: 'none', error: null });

/** 画面が購読する認証の状態。ログインの要否の表示などに使う */
export const authState = createStore<AuthState>({
  status: IS_CONFIGURED ? 'pending' : 'failed',
  uid: null,
  anonymous: true,
  error: IS_CONFIGURED ? null : NOT_CONFIGURED,
});

// **設定が無いときは初期化しない。**
// getAuth() は鍵が空だとその場で例外を投げ、モジュールの読み込みごと失敗する。
// つまり生成機能だけでなく、部屋の表示を含むアプリ全体が起動しなくなる。
// 生成はアプリの一部でしかないので、設定漏れで全部を巻き添えにしない
const auth = IS_CONFIGURED ? getAuth(initializeApp(FIREBASE_CONFIG)) : null;

/** 今のユーザー。復元が済むまでは null */
let currentUser: User | null = null;
/** ユーザーが入るのを待っている相手 */
let waiters: Array<{ resolve(user: User): void; reject(error: Error): void }> = [];

if (auth) {
  void start(auth);
}

async function start(auth: Auth): Promise<void> {
  // リダイレクトから戻ってきた結果を**最初に**受け取る。
  // これより先に匿名ログインが走ると、昇格した本人ではなく新しい匿名アカウントを掴んでしまう
  await receiveRedirect(auth);

  // onAuthStateChanged は「保存済みのログイン状態を復元し終えた」時点でも呼ばれる。
  // 先に signInAnonymously を呼ぶと復元前の状態で新しいアカウントを作ってしまうため、
  // 通知を待ってから、未ログインのときだけ作る
  onAuthStateChanged(
    auth,
    (user) => {
      if (user) adopt(user);
      else signInAnonymously(auth).catch(fail);
    },
    fail
  );
}

/** リダイレクトでのログインから戻ってきたなら、その結果を採り入れる。そうでなければ何もしない */
async function receiveRedirect(auth: Auth): Promise<void> {
  let result: unknown = null;
  let error: unknown = null;
  try {
    result = await getRedirectResult(auth);
  } catch (caught) {
    error = caught;
  }
  try {
    const outcome = await finishRedirect(
      {
        credentialFromError: credentialFromError,
        signInWithCredential: async (credential) => {
          await signInWithCredential(auth, credential);
        },
      },
      result,
      error
    );
    if (outcome === 'linked' || outcome === 'signed-in-existing') {
      redirectLogin.set({ outcome: 'signed-in', error: null });
    }
    // 'none'（リダイレクト経由ではない）と 'cancelled' は何も出さない
  } catch (failure) {
    redirectLogin.set({
      outcome: 'failed',
      error: failure instanceof Error ? failure.message : 'ログインできませんでした',
    });
  }
}

function credentialFromError(error: unknown) {
  return GoogleAuthProvider.credentialFromError(
    error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]
  );
}

/** 今のユーザーとして採用し、状態を画面に映す */
function adopt(user: User): void {
  currentUser = user;
  authState.set({ status: 'ready', uid: user.uid, anonymous: user.isAnonymous, error: null });
  const pending = waiters;
  waiters = [];
  for (const waiter of pending) waiter.resolve(user);
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  authState.set({ status: 'failed', error: message });
  const pending = waiters;
  waiters = [];
  for (const waiter of pending) waiter.reject(new Error(message));
}

/** 今のユーザー。復元が済んでいなければ済むまで待つ。認証できなければ失敗 */
function waitForUser(): Promise<User> {
  if (currentUser) return Promise.resolve(currentUser);
  const { status, error } = authState.get();
  if (status === 'failed') return Promise.reject(new Error(error ?? NOT_CONFIGURED));
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

/** APIを叩くためのトークン。1時間で失効するので、必要になるたびに取り直す */
export async function getIdToken(): Promise<string> {
  const user = await waitForUser();
  // 引数なしだと期限が近いときだけ更新される。毎回強制更新はしない
  return user.getIdToken();
}

/**
 * 利用者を区別する識別子。
 *
 * 限定公開のうちは、これをサーバー側の許可リストに登録してもらう必要があるため
 * 画面に表示する。個人情報は含まれない（匿名アカウントなら紐づく情報が無く、
 * Google に紐づけても uid 自体は無作為な文字列）。
 */
export async function getUid(): Promise<string> {
  return (await waitForUser()).uid;
}

/**
 * お金がかかる操作の前に、認証が済んでいることを確かめる。
 *
 * ログインの要求そのものは UI が行う（ポップアップは直接のクリックからしか
 * 開けないため、ここで開くことはできない）。限定公開では許可リストが門番なので、
 * 匿名のままでも通す。サーバー側で匿名を拒否するのは後の段階
 */
export async function ensureRegistered(): Promise<void> {
  await waitForUser();
}

/** この端末ではリダイレクトで昇格するか（iOS）。画面が文言を変えるのにも使う */
export function usesRedirectLogin(): boolean {
  return shouldUseRedirect(navigator.userAgent, navigator.maxTouchPoints ?? 0, navigator.platform);
}

/**
 * Google に紐づける。**直接のクリックから呼ぶこと**（await を挟むとポップアップが塞がれる）。
 *
 * 1 台目: 匿名アカウントが昇格し、uid はそのまま。
 * 2 台目: その Google の既存アカウントへログインし直し、uid はそちらになる。
 * 利用者がポップアップを閉じたら 'cancelled'。それ以外の失敗は理由を持った Error。
 *
 * iOS ではリダイレクトで Google へ遷移するので、この関数は**戻らない**。
 * 結果は戻ってきた起動時に receiveRedirect() が受け取る
 */
export async function signInWithGoogle(): Promise<'signed-in' | 'cancelled'> {
  if (!auth) throw new Error(NOT_CONFIGURED);
  const user = await waitForUser();
  if (!user.isAnonymous) return 'signed-in';

  const provider = new GoogleAuthProvider();
  const outcome = await linkOrSignIn(
    {
      link: async () => {
        await linkWithPopup(user, provider);
      },
      linkWithRedirect: () => linkWithRedirect(user, provider),
      credentialFromError,
      signInWithCredential: async (credential) => {
        await signInWithCredential(auth, credential);
      },
      signInWithPopup: async () => {
        await signInWithPopup(auth, provider);
      },
    },
    usesRedirectLogin()
  );
  if (outcome === 'cancelled') return 'cancelled';

  // 昇格では同じユーザーのまま中身が変わるので onAuthStateChanged が鳴らない。
  // ログインし直しでは鳴るが、どちらでもここで今のユーザーを映し直せば同じ
  adopt(auth.currentUser ?? user);
  return 'signed-in';
}
