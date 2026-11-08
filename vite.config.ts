import { resolve } from "path"
import { defineConfig } from "vite"

const projectDir = import.meta.dirname
const srcDir = resolve(projectDir, "src")

export default defineConfig({
  // the html pages live in src next to their scripts; their urls stay /, /popup.html, ...
  // (the redirect urls whitelisted on the auth server)
  root: srcDir,
  publicDir: resolve(projectDir, "public"),
  // .env.development (+ .env.development.local) in dev; the container uses public/config.js
  envDir: projectDir,
  envPrefix: "HYPERBOREA_",
  define: {
    // the image version from build.sh (container build arg), "dev" otherwise
    __APP_VERSION__: JSON.stringify(process.env.HYPERBOREA_VERSION || "dev"),
  },
  server: {
    // the auth server accepts redirects to localhost:8000 (and 8080)
    port: 8000,
    strictPort: true,
  },
  build: {
    target: "esnext",
    outDir: resolve(projectDir, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(srcDir, "index.html"),
        // OIDC redirect target (fallback when the login popup is blocked), see src/auth/auth.ts
        callback: resolve(srcDir, "callback.html"),
        // hidden iframe target for silent token renew
        silentRenew: resolve(srcDir, "silent-renew.html"),
        // login / logout popup target
        popup: resolve(srcDir, "popup.html"),
      },
    },
  },
})
