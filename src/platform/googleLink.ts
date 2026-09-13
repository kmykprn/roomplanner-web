/**
 * 匿名アカウントを Google に紐づける（昇格する）ときの分岐。
 *
 * Firebase の呼び出しは受け取った関数越しに行い、ここには判断だけを置く。
 * ポップアップは本物のブラウザでしか開かないので、分岐の正しさは
 * 偽の関数を渡して確かめる（auth.ts の呼び出し側は薄い）。
 *
 * ## 2 台目の分岐が要る理由
 *
 * 1 台目では linkWithPopup が匿名アカウントを昇格させ、uid はそのまま。
 * 2 台目では、その Google はもう 1 台目のアカウントに紐づいているので link は
 * `auth/credential-already-in-use` で失敗する。このときは既存のアカウントへ
 * ログインし直す（この端末で作った空の匿名アカウントは捨てる）。
 *
 * ログインし直しには、失敗した結果に入っている資格情報をそのまま使う。
 * もう一度ポップアップを開くと、直接のクリックから離れているので塞がれる。
 */

import type { AuthCredential } from 'firebase/auth';

/**
 * ポップアップではなくリダイレクトで昇格すべき端末か。
 *
 * iOS の Safari はポップアップを別タブとして開くことが多く、そのタブでログインを
 * 終えても元のページとの通信路が切れて、linkWithPopup の Promise が決着しないまま
 * 止まる（実機で再現）。iOS では Chrome や Firefox も中身は WebKit なので同じ。
 *
 * iPadOS 13 以降は UA が Mac を名乗るので、タッチ点数で見分ける。
 * 引数で受けるのは、ブラウザ無しで判断を確かめられるようにするため。
 */
export function shouldUseRedirect(
  userAgent: string,
  maxTouchPoints: number,
  platform: string | undefined
): boolean {
  if (/\b(iPad|iPhone|iPod)\b/.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

export interface LinkOps {
  /** linkWithPopup。成功すれば同じ uid のまま Google が付く */
  link(): Promise<void>;
  /** linkWithRedirect。ページが Google へ遷移するので、この Promise は決着しない */
  linkWithRedirect(): Promise<never>;
  /** 失敗した結果から、Google の資格情報を取り出す。無ければ null */
  credentialFromError(error: unknown): AuthCredential | null;
  /** 取り出した資格情報で既存のアカウントへログインする（ポップアップ無し） */
  signInWithCredential(credential: AuthCredential): Promise<void>;
  /** 資格情報が取れなかったときの最後の手。ポップアップを開き直す */
  signInWithPopup(): Promise<void>;
}

export type LinkOutcome =
  /** 匿名アカウントが昇格した。uid はそのまま */
  | 'linked'
  /** その Google の既存アカウントへログインし直した。uid が変わる */
  | 'signed-in-existing'
  /** 利用者がポップアップを閉じた */
  | 'cancelled';

/** その Google がもう別のアカウントに紐づいているときの失敗 */
const ALREADY_IN_USE = new Set(['auth/credential-already-in-use', 'auth/email-already-in-use']);

/** 利用者が自分でやめたときの失敗。エラーとして見せない */
const CANCELLED = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

export async function linkOrSignIn(ops: LinkOps, useRedirect = false): Promise<LinkOutcome> {
  // リダイレクトはここでは終わらない。結果は戻ってきたあと finishRedirect() が受け取る
  if (useRedirect) return ops.linkWithRedirect();

  let linkError: unknown;
  try {
    await ops.link();
    return 'linked';
  } catch (error) {
    const code = errorCode(error);
    if (CANCELLED.has(code)) return 'cancelled';
    if (!ALREADY_IN_USE.has(code)) throw new Error(describeFailure(code));
    linkError = error;
  }

  // 2 台目。失敗した結果に入っている資格情報で、既存のアカウントへログインし直す。
  // 資格情報が取れなければポップアップを開き直す（塞がれることがあるが、他に手が無い）
  try {
    const credential = ops.credentialFromError(linkError);
    if (credential) await ops.signInWithCredential(credential);
    else await ops.signInWithPopup();
    return 'signed-in-existing';
  } catch (error) {
    const code = errorCode(error);
    if (CANCELLED.has(code)) return 'cancelled';
    throw new Error(describeFailure(code));
  }
}

/**
 * リダイレクトから戻ってきた結果を、ポップアップと同じ分岐に流す。
 *
 * `result` は getRedirectResult の戻り値（リダイレクト経由でなければ null）、
 * `error` はそれが投げた失敗。2 台目では link が credential-already-in-use で失敗し、
 * その失敗に入っている資格情報で既存のアカウントへログインし直す（ポップアップ側と同じ）。
 */
export async function finishRedirect(
  ops: Pick<LinkOps, 'credentialFromError' | 'signInWithCredential'>,
  result: unknown,
  error: unknown
): Promise<LinkOutcome | 'none'> {
  if (!error) return result ? 'linked' : 'none';
  const code = errorCode(error);
  if (CANCELLED.has(code)) return 'cancelled';
  if (!ALREADY_IN_USE.has(code)) throw new Error(describeFailure(code));
  const credential = ops.credentialFromError(error);
  if (!credential) throw new Error(describeFailure(code));
  await ops.signInWithCredential(credential);
  return 'signed-in-existing';
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string') return code;
  }
  return '';
}

/** 利用者に見せる失敗の理由。次に何をすればよいかが分かる言い方にする */
export function describeFailure(code: string): string {
  switch (code) {
    case 'auth/popup-blocked':
      return 'ログインの画面が開けませんでした。ポップアップを許可してもう一度お試しください';
    case 'auth/unauthorized-domain':
      return 'このサイトからはログインできない設定になっています（管理者にお伝えください）';
    case 'auth/network-request-failed':
      return '通信できませんでした。接続を確かめてもう一度お試しください';
    case 'auth/operation-not-allowed':
      return 'Google ログインが有効になっていません（管理者にお伝えください）';
    default:
      return code ? `ログインできませんでした（${code}）` : 'ログインできませんでした';
  }
}
