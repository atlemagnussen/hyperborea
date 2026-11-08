import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, state } from "lit/decorators.js"
import { loadSpec } from "../spec/openapi.js"
import { addSpec } from "../storage/specs.js"

/**
 * Adds an OpenAPI spec url, remembered in this browser (IndexedDB). The spec is loaded first, so
 * a wrong url or a server without CORS is reported here instead of being saved.
 * Fires "spec-added" with the url, and "close".
 */
@customElement("add-spec-dialog")
export class AddSpecDialog extends LitElement {
  static styles = css`
    form {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    wa-input:state(user-invalid)::part(input-wrapper) {
      border-color: var(--wa-color-danger-border-loud);
    }
    .footer {
      display: flex;
      gap: var(--wa-space-s);
      justify-content: flex-end;
    }
  `

  @property({ type: Boolean })
  open = false

  /** Urls already in the selector: adding one of them just selects it */
  @property({ attribute: false })
  known: readonly string[] = []

  @state()
  private url = ""

  @state()
  private error = ""

  @state()
  private loading = false

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("open") && this.open) {
      this.url = ""
      this.error = ""
    }
  }

  private close() {
    this.open = false
    this.dispatchEvent(new CustomEvent("close"))
  }

  private async submit(e: Event) {
    // only fired once the url is filled in and valid (browser validation)
    e.preventDefault()
    const url = this.url.trim()
    this.loading = true
    this.error = ""
    try {
      if (!this.known.includes(url)) {
        const spec = await loadSpec(url, true)
        if (!spec.operations.length)
          throw new Error("The spec has no operations.")
        await addSpec(url)
      }
      this.dispatchEvent(new CustomEvent("spec-added", { detail: url }))
      this.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // fetch only says "Failed to fetch" for network and CORS errors
      this.error = err instanceof TypeError
        ? `${message}. The server must be reachable and allow CORS from ${location.origin}.`
        : message
    } finally {
      this.loading = false
    }
  }

  render() {
    return html`
      <wa-dialog
        label="Add OpenAPI spec"
        ?open=${this.open}
        @wa-after-hide=${(e: Event) => e.target === e.currentTarget && this.close()}
      >
        <form id="add-spec" @submit=${this.submit}>
          <wa-input
            label="Spec url"
            type="url"
            required
            autocomplete="url"
            placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
            hint="OpenAPI 3.x, in JSON or YAML. Remembered in this browser only."
            .value=${this.url}
            @input=${(e: Event) => (this.url = (e.target as HTMLInputElement).value ?? "")}
            autofocus
          ></wa-input>
          ${this.error ? html`<wa-callout variant="danger">${this.error}</wa-callout>` : null}
        </form>
        <div slot="footer" class="footer">
          <wa-button @click=${this.close}>Cancel</wa-button>
          <wa-button type="submit" form="add-spec" variant="brand" ?loading=${this.loading}>Add</wa-button>
        </div>
      </wa-dialog>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "add-spec-dialog": AddSpecDialog
  }
}
