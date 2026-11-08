import { Log, User, UserManager } from "oidc-client-ts"
import type { AuthorizationCodeOption, ClientCredentialsOption } from "../spec/security.js"
import { getSettings, storedAuthorizationCodeConfig, storeAuthorizationCodeConfig, type AuthorizationCodeConfig } from "./settings.js"

Log.setLogger(console)
Log.setLevel(Log.WARN)

const rootPath = window.location.origin

/** Who requests are made as, by the flow the token came from: a user or a client */
export type Identity =
  | { flow: "authorizationCode"; name: string; accessToken: string; user: User }
  | { flow: "clientCredentials"; name: string; accessToken: string; expiresAt: number }

// ---- identity state and change notification ----

let clientCredentialsIdentity: Extract<Identity, { flow: "clientCredentials" }> | undefined
let clientCredentialsExpiryTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<(identity: Identity | null) => void>()

/** Called with the current identity after login, renew, logout or Client Credentials token expiry */
export function onIdentityChanged(callback: (identity: Identity | null) => void) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

async function notify() {
  const identity = await getIdentity()
  listeners.forEach((l) => l(identity))
}

function authorizationCodeIdentity(user: User | null): Identity | null {
  if (!user || user.expired)
    return null
  const name = user.profile.name ?? user.profile.preferred_username ?? user.profile.sub
  return { flow: "authorizationCode", name, accessToken: user.access_token, user }
}

export async function getIdentity(): Promise<Identity | null> {
  if (clientCredentialsIdentity && clientCredentialsIdentity.expiresAt > Date.now())
    return clientCredentialsIdentity
  return authorizationCodeIdentity((await manager?.getUser()) ?? null)
}

export async function getAccessToken(): Promise<string | null> {
  return (await getIdentity())?.accessToken ?? null
}

// ---- Authorization Code flow with PKCE (user) ----

let manager: UserManager | undefined

function createManager(config?: AuthorizationCodeConfig) {
  const settings = getSettings(config)
  if (!settings)
    return undefined
  const m = new UserManager({
    ...settings,
    // renews in a hidden iframe (silent-renew.html) when the access token is about to expire
    automaticSilentRenew: true,
  })
  m.events.addSilentRenewError((err) => console.error("Silent renew failed", err))
  m.events.addUserLoaded(() => notify())
  m.events.addUserUnloaded(() => notify())
  return m
}

function useManager(config: AuthorizationCodeConfig | undefined) {
  manager?.stopSilentRenew()
  manager = config && createManager(config)
}

/**
 * Sets the spec's Authorization Code option (OIDC discovery / oauth2 authorizationCode flow). Restores the login
 * of this tab when it was made against the same authority, e.g. after a reload or switching back
 * to the spec; client id and scopes are chosen in the login dialog (see loginAuthorizationCode).
 */
export function setAuthorizationCodeOption(option: AuthorizationCodeOption | undefined) {
  const stored = storedAuthorizationCodeConfig()
  useManager(option && stored?.authority === option.authority ? stored : undefined)
}

/** Completes the code flow on callback.html and returns to the page where login started */
export async function handleLoginCallback() {
  const m = createManager()
  if (!m)
    throw new Error("Login settings missing, start the login from the app again")
  const user = await m.signinRedirectCallback()
  const returnUrl = typeof user.state === "string" ? user.state : rootPath
  window.location.replace(returnUrl)
}

/**
 * Loads the stored user. If its access token expired while the app was closed, tries a silent
 * renew first, so a reload does not log the user out while the session at the auth server lives
 */
export async function initialize(): Promise<Identity | null> {
  const user = await manager?.getUser()
  if (user?.expired) {
    try {
      await manager!.signinSilent()
    } catch (err) {
      console.warn("Silent renew on startup failed, user must log in again", err)
      await manager!.removeUser()
    }
  }
  return getIdentity()
}

/** The Authorization Code login of this tab (client id, scopes; no secrets), e.g. to publish a chart with */
export function currentAuthorizationCodeConfig(option: AuthorizationCodeOption | undefined) {
  const stored = storedAuthorizationCodeConfig()
  return option && stored?.authority === option.authority ? stored : undefined
}

/**
 * Logs in a tab that has no login yet (a published chart opened in a new tab) as a known client:
 * restores this tab's login if it has one, else tries a silent login in a hidden iframe, which
 * works while the session at the auth server lives and the browser sends its cookie there.
 * Returns null when the user has to log in (loginAuthorizationCode, from a click).
 */
export async function loginSilently(option: AuthorizationCodeOption, config: AuthorizationCodeConfig) {
  if (!currentAuthorizationCodeConfig(option))
    storeAuthorizationCodeConfig(config)
  setAuthorizationCodeOption(option)
  const identity = await initialize()
  if (identity || !manager)
    return identity
  try {
    await manager.signinSilent()
  } catch (err) {
    console.info("Silent login failed, user must log in:", err instanceof Error ? err.message : err)
  }
  return getIdentity()
}

/**
 * Logs in with the Authorization Code flow, as the given client with the given scopes. The client
 * id is not in OpenAPI, so the user enters it (see loginDialog.ts).
 * Logs in in a popup window (popup.html completes it), so the app stays where it is.
 * When the browser blocks the popup, falls back to a full page redirect (callback.html).
 * Must be called from a click, else the browser blocks the popup.
 * Returns whether the user is logged in; false when the popup was closed.
 */
export async function loginAuthorizationCode(
  option: AuthorizationCodeOption,
  clientId: string,
  scopes: string[],
): Promise<boolean> {
  const config: AuthorizationCodeConfig = {
    authority: option.authority,
    clientId,
    scope: scopes.join(" ") || "openid",
    authorizationEndpoint: option.authorizationEndpoint,
    tokenEndpoint: option.tokenEndpoint,
  }
  // callback.html and the silent renew iframe read the settings from storage
  storeAuthorizationCodeConfig(config)
  useManager(config)
  if (!manager)
    return false
  // oidc-client-ts reports a blocked and a closed popup the same way ("Popup closed by user"),
  // so note whether window.open returned a window while the popup is opened (synchronously)
  let blocked = false
  const open = window.open
  window.open = (...args: Parameters<typeof window.open>) => {
    const popup = open.apply(window, args)
    blocked = !popup
    return popup
  }
  let login: Promise<unknown>
  try {
    // popupAbortOnClose: without it the promise never settles when the popup is closed or blocked
    login = manager.signinPopup({ popupAbortOnClose: true })
  } finally {
    window.open = open
  }
  if (blocked) {
    login.catch(() => {})
    await manager.signinRedirect({ state: window.location.href })
    return false
  }
  try {
    await login
  } catch (err) {
    // the user closed the popup: stay logged out, nothing to report
    if (err instanceof Error && err.message.startsWith("Popup closed")) {
      console.info("Popup login not completed")
      return false
    }
    // e.g. unknown client id or scope, reported by the auth server
    throw err
  }
  return true
}

// ---- Client Credentials flow (client) ----

/**
 * Requests a token with client id and secret. The secret is only used for this request and never
 * stored; the token is kept in memory only, so after expiry or a page reload the client logs in again.
 */
export async function loginClientCredentials(
  option: ClientCredentialsOption,
  clientId: string,
  secret: string,
  scopes: string[],
) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: secret,
  })
  if (scopes.length)
    body.set("scope", scopes.join(" "))
  const response = await fetch(option.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  })
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || typeof result.access_token !== "string") {
    const detail = [result.error, result.error_description].filter(Boolean).join(": ")
    throw new Error(detail || `Token request failed (${response.status})`)
  }
  const expiresIn = typeof result.expires_in === "number" ? result.expires_in : 3600
  clientCredentialsIdentity = {
    flow: "clientCredentials",
    name: clientId,
    accessToken: result.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  clearTimeout(clientCredentialsExpiryTimer)
  clientCredentialsExpiryTimer = setTimeout(() => {
    clientCredentialsIdentity = undefined
    notify()
  }, expiresIn * 1000)
  await notify()
}

// ---- logout ----

export async function logout() {
  if (clientCredentialsIdentity) {
    clientCredentialsIdentity = undefined
    clearTimeout(clientCredentialsExpiryTimer)
    await notify()
    return
  }
  if (!manager)
    return
  // ends the session at the auth server in a popup; the user is removed locally in any case, also
  // when the popup is closed or blocked, or the auth server does not return to popup.html
  try {
    await manager.signoutPopup({ popupAbortOnClose: true })
  } catch (err) {
    console.info("Popup logout not completed:", err instanceof Error ? err.message : err)
  } finally {
    await manager.removeUser()
  }
}
