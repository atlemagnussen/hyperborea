export interface Environment {
  name: string
  /** OpenAPI spec urls (HYPERBOREA_SPEC_URL, comma separated); more than one shows a selector */
  specUrls: string[]
  /** Prefilled client id for Authorization Code login (OpenAPI has no field for it); can be changed */
  defaultAuthCodeClient: string
}

// values from .env files, only present in development builds
const buildEnv: Window["__HYPERBOREA_ENV__"] = {
  HYPERBOREA_ENV_NAME: import.meta.env.HYPERBOREA_ENV_NAME,
  HYPERBOREA_SPEC_URL: import.meta.env.HYPERBOREA_SPEC_URL,
  HYPERBOREA_DEFAULT_AUTH_CODE_CLIENT: import.meta.env.HYPERBOREA_DEFAULT_AUTH_CODE_CLIENT,
}

const missing: string[] = []

/** Runtime config (container) wins over build time config (.env files) */
function read(key: HyperboreaEnvKey, required = true) {
  const value = window.__HYPERBOREA_ENV__?.[key] || buildEnv?.[key] || ""
  if (required && !value)
    missing.push(key)
  return value
}

/** Build version, e.g. 0.6, or "dev" outside a container build */
export const appVersion = __APP_VERSION__

export const environment: Environment = {
  name: read("HYPERBOREA_ENV_NAME", false),
  specUrls: read("HYPERBOREA_SPEC_URL")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
  defaultAuthCodeClient: read("HYPERBOREA_DEFAULT_AUTH_CODE_CLIENT", false),
}

/** Names of required settings that are not set */
export const missingSettings: readonly string[] = missing

// the spec chosen in the selector, remembered per browser
const specUrlKey = "hyperborea.specUrl"

/** The selected spec url: the remembered one when it is still configured, else the first */
export function getSelectedSpecUrl() {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(specUrlKey)
  } catch {
    // storage unavailable
  }
  return stored && environment.specUrls.includes(stored) ? stored : environment.specUrls[0]
}

export function setSelectedSpecUrl(url: string) {
  try {
    localStorage.setItem(specUrlKey, url)
  } catch {
    // storage unavailable: the choice lasts until reload
  }
}
