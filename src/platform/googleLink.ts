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

export interface LinkOps {
  /** linkWithPopup。成功すれば同じ uid のまま Google が付く */
  link(): Promise<void>;
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

export async function linkOrSignIn(ops: LinkOps): Promise<LinkOutcome> {
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
