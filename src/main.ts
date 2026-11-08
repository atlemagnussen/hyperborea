// first: moves storage from the former name before anything reads it
import "./storage/migrate.js"
import "./webawesome.js"
import "./styles.css"
import { missingSettings } from "./environment.js"
import { applyTheme } from "./theme.js"

applyTheme()

if (missingSettings.length) {
  document.body.innerHTML = `
    <wa-callout variant="danger" style="margin: var(--wa-space-l)">
      Missing settings: ${missingSettings.join(", ")}.
      Set them in .env.development.local, or as environment variables on the container.
    </wa-callout>
  `
} else {
  import("./components/appRoot.js")
}
