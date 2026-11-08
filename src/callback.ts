import { handleLoginCallback } from "./auth/auth.js"

handleLoginCallback().catch((err: unknown) => {
  console.error("Login callback failed", err)
  const message = document.querySelector("#message")!
  message.textContent = `Login failed: ${err instanceof Error ? err.message : String(err)}`
  document.querySelector("#retry")!.removeAttribute("hidden")
})
