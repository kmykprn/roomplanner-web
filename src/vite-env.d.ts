/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Firebase のウェブAPIキー。
   *
   * 秘密ではないがリポジトリには置かない（理由は config/api.ts）。
   * ローカルでは .env.local に、GitHub Pages へのデプロイでは
   * Actions のシークレットから注入する。
   */
  readonly VITE_FIREBASE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
