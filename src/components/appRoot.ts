import { Router } from "@lit-labs/router"
import { css, html, LitElement } from "lit"
import { customElement } from "lit/decorators.js"

/**
 * Client side routes with real paths (nginx and the Vite dev server answer every path with
 * index.html). Each page is loaded when its route is first entered.
 */
@customElement("app-root")
export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100vh;
    }
    .not-found {
      padding: var(--wa-space-l);
    }
  `

  private router = new Router(
    this,
    [
      {
        path: "/",
        enter: async () => {
          await import("./workbenchPage.js")
          return true
        },
        render: () => html`<workbench-page></workbench-page>`,
      },
      {
        path: "/chart/:id",
        enter: async () => {
          await import("./chartPage.js")
          return true
        },
        render: ({ id }) => html`<chart-page .queryId=${id ?? ""}></chart-page>`,
      },
    ],
    {
      fallback: {
        render: () => html`
          <div class="not-found">
            <wa-callout variant="warning">
              Nothing here. <a href="/">Back to Hyperborea</a>
            </wa-callout>
          </div>
        `,
      },
    },
  )

  render() {
    return this.router.outlet()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": AppRoot
  }
}
