/// <reference types="vite/client" />

interface ImportMetaEnv extends Readonly<Partial<Record<HyperboreaEnvKey, string>>> {}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

type HyperboreaEnvKey =
  | "HYPERBOREA_ENV_NAME"
  | "HYPERBOREA_SPEC_URL"
  | "HYPERBOREA_DEFAULT_AUTH_CODE_CLIENT"

interface Window {
  /** Written by public/config.js, see build/30-write-runtime-config.sh */
  __HYPERBOREA_ENV__?: Partial<Record<HyperboreaEnvKey, string>>
}

/** Build version, e.g. 0.6 (set in vite.config.ts) */
declare const __APP_VERSION__: string
