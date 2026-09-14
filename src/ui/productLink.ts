/**
 * 「楽天で見る ¥24,800」。商品ページから取り込んだ家具に付く、買うためのリンク。
 *
 * 開くのは紹介料の付くリンク（affiliateUrl）。**アプリの外（ブラウザ）で開く。**
 * アプリの中の WebView で開くと、楽天側が紹介元を判定できないことがあるため。
 * 編集の姿と操作タブの両方で同じものを使う。
 */

import type { ProductInfo } from '@/config/furniture';

export function createProductLink(product: ProductInfo): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'button is-quiet is-small product-link';
  link.href = product.affiliateUrl || product.url;
  link.target = '_blank';
  // noopener: 開いた先からこのページを触らせない。noreferrer は付けない（紹介元の判定に要る）
  link.rel = 'noopener';
  link.textContent = product.price === null ? '楽天で見る' : `楽天で見る ${formatPrice(product.price)}`;
  return link;
}

function formatPrice(price: number): string {
  return `¥${price.toLocaleString('ja-JP')}`;
}
