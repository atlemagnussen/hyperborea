import { WebStorageStateStore, type UserManagerSettings } from "oidc-client-ts"

const rootPath = window.location.origin

/** Authorization Code settings from the spec and the login dialog (see auth.ts loginAuthorizationCode) */
export interface AuthorizationCodeConfig {
  authority: string
  clientId: string
  scope: string
  /** Only when the spec has no OIDC discovery url */
  authorizationEndpoint?: string
  tokenEndpoint?: string
}

// sessionStorage, so callback.html and the silent renew iframe (which do not load the spec)
// use the same settings as the app. Holds no secrets.
const storageKey = "hyperborea.authorizationCode"

export function storeAuthorizationCodeConfig(config: AuthorizationCodeConfig) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(config))
  } catch {
    // storage unavailable: login redirects cannot complete, the app still works without login
  }
}

export function storedAuthorizationCodeConfig(): AuthorizationCodeConfig | undefined {
  try {
    const json = sessionStorage.getItem(storageKey)
    return json ? (JSON.parse(json) as AuthorizationCodeConfig) : undefined
  } catch {
    return undefined
  }
}

/** Settings shared by the app, callback.html and the silent renew iframe */
export function getSettings(config = storedAuthorizationCodeConfig()): UserManagerSettings | undefined {
  if (!config)
    return undefined
  return {
    authority: config.authority,
    client_id: config.clientId,
    scope: config.scope,
    // without OIDC discovery, the endpoints come from the spec's oauth2 flow
    metadataSeed: config.authorizationEndpoint
      ? { authorization_endpoint: config.authorizationEndpoint, token_endpoint: config.tokenEndpoint }
      : undefined,
    // code flow with PKCE; callback.html completes the login (see handleLoginCallback)
    response_type: "code",
    response_mode: "query",
    // same urls as demoClient, already whitelisted for webclient on the auth server
    redirect_uri: `${rootPath}/callback.html`,
    silent_redirect_uri: `${rootPath}/silent-renew.html`,
    // login and logout in a popup (popup.html), so the app is not left; same url as demoClient
    popup_redirect_uri: `${rootPath}/popup.html`,
    popup_post_logout_redirect_uri: `${rootPath}/popup.html`,
    post_logout_redirect_uri: rootPath,
    loadUserInfo: true,
    // the stored user key also contains authority and client id
    userStore: new WebStorageStateStore({ store: window.sessionStorage, prefix: "hyperborea." }),
  }
}
