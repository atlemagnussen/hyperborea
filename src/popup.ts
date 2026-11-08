import { UserManager } from "oidc-client-ts"
import { getSettings } from "./auth/settings.js"

// runs in the login / logout popup: hands the auth server's response to the app window
async function completePopup() {
  const settings = getSettings()
  if (!settings)
    throw new Error("Login settings missing, start the login from the app again")
  const manager = new UserManager(settings)
  const params = new URLSearchParams(window.location.search)
  // a login response carries code (or error) and state; anything else is the logout return
  if (params.has("state") && (params.has("code") || params.has("error")))
    await manager.signinPopupCallback()
  else
    await manager.signoutPopupCallback()
  window.close()
}

completePopup().catch((err: unknown) => {
  console.error("Popup callback failed", err)
  document.querySelector("#message")!.textContent =
    `Login failed: ${err instanceof Error ? err.message : String(err)}. You can close this window.`
})
