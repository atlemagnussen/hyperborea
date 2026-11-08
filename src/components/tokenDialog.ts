import { css, html, LitElement } from "lit"
import { customElement, property } from "lit/decorators.js"
import { decodeJwt, type Claims } from "../auth/claims.js"
import { formatDateTime } from "../format.js"

// claims holding NumericDate values (seconds since epoch)
const dateClaims = new Set(["exp", "iat", "nbf", "auth_time", "updated_at"])

/** Dialog showing the claims of the access token */
@customElement("token-dialog")
export class TokenDialog extends LitElement {
  static styles = css`
    wa-dialog {
      --width: 50rem;
    }
    h3 {
      margin: var(--wa-space-m) 0 var(--wa-space-xs);
      font-size: var(--wa-font-size-m);
    }
    h3:first-child {
      margin-top: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--wa-font-size-s);
    }
    th,
    td {
      text-align: left;
      vertical-align: top;
      padding: var(--wa-space-2xs) var(--wa-space-s);
      border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    }
    th {
      width: 12rem;
      font-family: var(--wa-font-family-code);
      font-weight: var(--wa-font-weight-semibold);
    }
    td {
      /* long values (ids, urls) wrap without horizontal scrolling, words stay whole when possible */
      overflow-wrap: anywhere;
    }
    .list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .quiet {
      color: var(--wa-color-text-quiet);
    }
  `

  @property({ type: Boolean })
  open = false

  @property()
  token = ""

  private onAfterHide(e: Event) {
    if (e.target !== e.currentTarget)
      return
    this.open = false
    this.dispatchEvent(new CustomEvent("close"))
  }

  private renderValue(name: string, value: unknown) {
    if (dateClaims.has(name) && typeof value === "number") {
      const date = new Date(value * 1000)
      const id = `date-${name}`
      return html`
        <span id=${id}>${formatDateTime(date)}</span>
        <wa-tooltip for=${id}>${value}</wa-tooltip>
        <span class="quiet">(<wa-relative-time .date=${date} sync></wa-relative-time>)</span>
      `
    }
    // lists one item per line: arrays, and OAuth's space separated scope string
    const items = Array.isArray(value)
      ? value
      : name === "scope" && typeof value === "string"
        ? value.split(" ").filter(Boolean)
        : undefined
    if (items)
      return html`<ul class="list">
        ${items.map((v) => html`<li>${typeof v === "object" ? JSON.stringify(v) : String(v)}</li>`)}
      </ul>`
    if (typeof value === "object" && value !== null)
      return JSON.stringify(value)
    return String(value)
  }

  private renderClaims(title: string, claims: Claims) {
    return html`
      <h3>${title}</h3>
      <table>
        ${Object.entries(claims).map(
          ([name, value]) => html`
            <tr>
              <th>${name}</th>
              <td>${this.renderValue(name, value)}</td>
            </tr>
          `,
        )}
      </table>
    `
  }

  render() {
    const decoded = this.open ? decodeJwt(this.token) : undefined
    return html`
      <wa-dialog label="Access token" ?open=${this.open} light-dismiss @wa-after-hide=${this.onAfterHide}>
        <wa-copy-button
          slot="header-actions"
          .value=${this.token}
          copy-label="Copy access token"
        ></wa-copy-button>
        ${decoded
          ? html`
              ${this.renderClaims("Payload", decoded.payload)}
              ${this.renderClaims("Header", decoded.header)}
            `
          : html`<p>The access token is not a JWT and cannot be decoded.</p>`}
      </wa-dialog>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "token-dialog": TokenDialog
  }
}
