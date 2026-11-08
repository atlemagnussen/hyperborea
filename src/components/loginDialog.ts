import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, state } from "lit/decorators.js"
import { loginAuthorizationCode, loginClientCredentials } from "../auth/auth.js"
import { environment } from "../environment.js"
import type { AuthorizationCodeOption, ClientCredentialsOption, LoginFlow } from "../spec/security.js"

// last client id that logged in successfully, per flow and auth server, so switching between
// APIs keeps each one's client; not sensitive (the secret is never stored)
const clientIdsKey = "hyperborea.clientIds"
// the single remembered client credentials id from before, used when there is none per server
const legacyClientIdKey = "hyperborea.clientId"

function rememberedClientIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(clientIdsKey) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

function rememberedClientId(key: string, flow: LoginFlow) {
  try {
    const legacy = flow === "clientCredentials" ? localStorage.getItem(legacyClientIdKey) : null
    return rememberedClientIds()[key] ?? legacy ?? ""
  } catch {
    return ""
  }
}

function rememberClientId(key: string, clientId: string) {
  try {
    localStorage.setItem(clientIdsKey, JSON.stringify({ ...rememberedClientIds(), [key]: clientId }))
  } catch {
    // storage unavailable: the id is typed again next time
  }
}

/**
 * Login with the Authorization Code or Client Credentials flow: client id (prefilled), scopes from
 * the spec, and for Client Credentials the secret. The secret is only held while the request runs,
 * never stored. Authorization Code continues at the auth server in a popup once submitted.
 */
@customElement("login-dialog")
export class LoginDialog extends LitElement {
  static styles = css`
    form {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    /* WebAwesome has no validation styles, only states: mark fields left empty on submit */
    wa-input:state(user-invalid)::part(input-wrapper) {
      border-color: var(--wa-color-danger-border-loud);
    }
    .server {
      margin: 0;
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      word-break: break-all;
    }
    .scopes {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-2xs);
    }
    .scopes-hint {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    /* long hints and scope descriptions wrap instead of widening the dialog */
    .scopes-hint,
    wa-checkbox::part(label) {
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .scope-name {
      font-family: var(--wa-font-family-code);
    }
    .footer {
      display: flex;
      gap: var(--wa-space-s);
    }
  `

  @property({ type: Boolean })
  open = false

  @property()
  flow: LoginFlow = "clientCredentials"

  @property({ attribute: false })
  authorizationCodeOption?: AuthorizationCodeOption

  @property({ attribute: false })
  clientCredentialsOption?: ClientCredentialsOption

  @state()
  private clientId = ""

  @state()
  private scopes = new Set<string>()

  @state()
  private loading = false

  @state()
  private error = ""

  // kept outside reactive state and cleared after each attempt
  private secret = ""

  private get option() {
    return this.flow === "authorizationCode" ? this.authorizationCodeOption : this.clientCredentialsOption
  }

  /** The auth server the remembered client id belongs to */
  private get serverKey() {
    const server =
      this.flow === "authorizationCode" ? this.authorizationCodeOption?.authority : this.clientCredentialsOption?.tokenUrl
    return `${this.flow}:${server ?? ""}`
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("open") && this.open) {
      this.error = ""
      const authorizationCode = this.flow === "authorizationCode"
      this.clientId =
        rememberedClientId(this.serverKey, this.flow) || (authorizationCode ? environment.defaultAuthCodeClient : "")
      // the scopes the spec's security requirements name
      this.scopes = new Set(this.option?.requiredScopes)
    }
  }

  private close() {
    this.secret = ""
    this.error = ""
    this.open = false
    this.dispatchEvent(new CustomEvent("close"))
  }

  private async submit(e: Event) {
    // only fired once the required fields are filled (browser validation)
    e.preventDefault()
    const clientId = this.clientId.trim()
    this.loading = true
    this.error = ""
    try {
      let loggedIn = false
      if (this.flow === "authorizationCode" && this.authorizationCodeOption) {
        // false when the popup was closed: keep the dialog open to try again
        loggedIn = await loginAuthorizationCode(this.authorizationCodeOption, clientId, [...this.scopes])
      } else if (this.flow === "clientCredentials" && this.clientCredentialsOption) {
        await loginClientCredentials(this.clientCredentialsOption, clientId, this.secret, [...this.scopes])
        loggedIn = true
      }
      if (loggedIn) {
        rememberClientId(this.serverKey, clientId)
        this.close()
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.secret = ""
      this.loading = false
      // the secret field is cleared after every attempt
      const input = this.renderRoot.querySelector<HTMLInputElement>("#secret")
      if (input)
        input.value = ""
    }
  }

  private toggleScope(scope: string, checked: boolean) {
    const scopes = new Set(this.scopes)
    if (checked)
      scopes.add(scope)
    else
      scopes.delete(scope)
    this.scopes = scopes
  }

  private renderScopes() {
    const scopes = Object.entries(this.option?.scopes ?? {})
    if (!scopes.length)
      return null
    return html`
      <div class="scopes" role="group" aria-label="Scopes">
        <span class="scopes-hint">
          ${this.flow === "clientCredentials"
            ? "Scopes to request. None: all the client is allowed."
            : "Scopes to request."}
        </span>
        ${scopes.map(
      ([scope, description]) => html`
            <wa-checkbox
              .checked=${this.scopes.has(scope)}
              @change=${(e: Event) => this.toggleScope(scope, (e.target as HTMLInputElement).checked)}
            >
              <span class="scope-name">${scope}</span>${description ? html` · ${description}` : null}
            </wa-checkbox>
          `,
    )}
      </div>
    `
  }

  render() {
    const authorizationCode = this.flow === "authorizationCode"
    const server = authorizationCode
      ? `Authority · ${this.authorizationCodeOption?.authority}`
      : `Token url · ${this.clientCredentialsOption?.tokenUrl}`
    return html`
      <wa-dialog
        label=${authorizationCode ? "Authorization Code with PKCE" : "Client Credentials"}
        ?open=${this.open}
        @wa-after-hide=${(e: Event) => e.target === e.currentTarget && this.close()}
      >
        <form id="login" @submit=${this.submit}>
          <p class="server">${server}</p>
          <wa-input
            label="Client id"
            required
            autocomplete="off"
            .value=${this.clientId}
            @input=${(e: Event) => (this.clientId = (e.target as HTMLInputElement).value ?? "")}
            ?autofocus=${authorizationCode || !this.clientId}
          ></wa-input>
          ${authorizationCode
        ? null
        : html`
                <wa-input
                  id="secret"
                  label="Client secret"
                  required
                  type="password"
                  password-toggle
                  autocomplete="off"
                  hint="Not stored. Log in again when the token expires."
                  ?autofocus=${!!this.clientId}
                  @input=${(e: Event) => (this.secret = (e.target as HTMLInputElement).value ?? "")}
                ></wa-input>
              `}
          ${this.renderScopes()}
          ${this.error ? html`<wa-callout variant="danger">${this.error}</wa-callout>` : null}
        </form>
        <div slot="footer" class="footer">
          <wa-button @click=${this.close}>Cancel</wa-button>
          <!-- submits the form, so the browser validates the required fields first -->
          <wa-button type="submit" form="login" variant="brand" ?loading=${this.loading}>
            Log in
          </wa-button>
        </div>
      </wa-dialog>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "login-dialog": LoginDialog
  }
}
