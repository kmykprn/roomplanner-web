/**
 * iOS アプリ（Capacitor）のときだけ使うネイティブ機能。
 *
 * Web でも import される（Capacitor.isNativePlatform() は Web では false を返すだけ）。
 * WKWebView では Google のポップアップもリダイレクトも動かないので、ログインだけは
 * ネイティブの画面で資格情報を取り、Web の Firebase SDK に渡す（auth.ts）。
 * セッションは Web 側の 1 つだけにして、匿名からの昇格（uid を保つ）を今の流れのまま使う
 */

import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { GoogleAuthProvider, OAuthProvider, type AuthCredential } from 'firebase/auth';

/** iOS アプリの中で動いているか（Web と PWA では false） */
export const isNativeApp = Capacitor.isNativePlatform();

export type NativeProvider = 'google' | 'apple';

/**
 * ネイティブのログイン画面を開き、Firebase に渡せる資格情報を返す。
 * 利用者が閉じたら null。
 *
 * capacitor.config.ts の skipNativeAuth が true なので、ネイティブ側の Firebase には
 * ログインされない。返るのはトークンだけ
 */
export async function nativeCredential(provider: NativeProvider): Promise<AuthCredential | null> {
  try {
    if (provider === 'google') {
      const { credential } = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
      if (!credential?.idToken) throw new Error('Google からトークンが返りませんでした');
      return GoogleAuthProvider.credential(credential.idToken, credential.accessToken);
    }
    const { credential } = await FirebaseAuthentication.signInWithApple({ skipNativeAuth: true });
    if (!credential?.idToken) throw new Error('Apple からトークンが返りませんでした');
    return new OAuthProvider('apple.com').credential({
      idToken: credential.idToken,
      rawNonce: credential.nonce,
    });
  } catch (error) {
    if (isCancelled(error)) return null;
    throw error;
  }
}

/**
 * 利用者が自分でやめたか。
 * Google は「The user canceled the sign-in flow」、Apple は ASAuthorizationError の 1001（canceled）。
 * どちらもプラグインは文字列でしか返さないので、言葉で見る
 */
function isCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message) || /1001/.test(message);
}
