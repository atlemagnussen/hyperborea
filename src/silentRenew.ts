import { UserManager } from "oidc-client-ts"
import { getSettings } from "./auth/settings.js"

// runs inside the hidden iframe: hands the auth response to the app's UserManager in the parent
const settings = getSettings()
if (settings) {
  new UserManager(settings).signinSilentCallback().catch((err: unknown) => {
    console.error("Silent renew callback failed", err)
  })
}
