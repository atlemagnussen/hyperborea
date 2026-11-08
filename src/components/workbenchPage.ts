import { css, html, LitElement } from "lit"
import { customElement, state } from "lit/decorators.js"
import { initialize, logout, onIdentityChanged, setAuthorizationCodeOption, type Identity } from "../auth/auth.js"
import { appVersion, environment, getSelectedSpecUrl, setSelectedSpecUrl } from "../environment.js"
import { loadSpec, type LoadedSpec } from "../spec/openapi.js"
import {
  getAuthOptions,
  type AuthorizationCodeOption,
  type ClientCredentialsOption,
  type LoginFlow,
} from "../spec/security.js"
import { getTheme, setTheme } from "../theme.js"
import type { SavedQuery } from "../storage/savedQueries.js"
import { listAddedSpecs, removeSpec } from "../storage/specs.js"
import "./addSpecDialog.js"
import "./loginDialog.js"
import "./operationBrowser.js"
import "./savedQueryList.js"
import "./requestEditor.js"
import "./tokenDialog.js"

/** The main page: endpoints and saved requests, the request editor and its response */
@customElement("workbench-page")
export class WorkbenchPage extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--wa-space-m);
      padding: var(--wa-space-s) var(--wa-space-m);
      border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    }
    h1 {
      display: flex;
      align-items: center;
      gap: var(--wa-space-s);
      margin: 0;
      font-size: var(--wa-font-size-l);
    }
    .logo {
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgb(0 0 0 / 0.25);
    }
    .spec {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    h1,
    .end {
      white-space: nowrap;
      flex-shrink: 0;
    }
    header > .spec {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spec-select {
      display: flex;
      align-items: center;
      min-width: 0;
      flex: 0 1 30rem;
    }
    .spec-select wa-select {
      flex: 1;
      min-width: 12rem;
    }
    .spec a {
      color: inherit;
    }
    .spec a:hover {
      color: var(--wa-color-text-link);
    }
    .end {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: var(--wa-space-s);
    }
    wa-split-panel {
      flex: 1;
      min-height: 0;
    }
    [slot="start"],
    [slot="end"] {
      height: 100%;
      overflow: auto;
    }
    /* sidebar tabs fill the height; each panel scrolls its own list */
    .sidebar {
      overflow: hidden;
      --indicator-color: var(--wa-color-brand-fill-loud);
    }
    .sidebar::part(base),
    .sidebar::part(tab-group) {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .sidebar::part(body) {
      flex: 1;
      min-height: 0;
    }
    .sidebar wa-tab-panel {
      height: 100%;
    }
    .sidebar wa-tab-panel::part(base) {
      height: 100%;
      padding: 0;
    }
    .center {
      padding: var(--wa-space-l);
    }
    .start-actions {
      margin-top: var(--wa-space-m);
    }
  `

  @state()
  private environment = environment

  /** Spec urls added in this browser (IndexedDB), after the configured ones in the selector */
  @state()
  private addedSpecUrls: string[] = []

  /** The spec in use, chosen in the header; none until loaded, or when there are no specs at all */
  @state()
  private specUrl?: string

  /** Set once the added specs are read and a spec is chosen */
  @state()
  private ready = false

  @state()
  private addSpecOpen = false

  /** Configured urls (HYPERBOREA_SPEC_URL) first, then the added ones */
  private get specUrls() {
    const configured = this.environment.specUrls
    return [...configured, ...this.addedSpecUrls.filter((url) => !configured.includes(url))]
  }

  private isAddedSpec(url?: string) {
    return !!url && !this.environment.specUrls.includes(url) && this.addedSpecUrls.includes(url)
  }

  private async readAddedSpecs() {
    try {
      this.addedSpecUrls = (await listAddedSpecs()).map((spec) => spec.url)
    } catch (err) {
      // IndexedDB unavailable (e.g. some private windows): only the configured specs
      console.warn("Could not read added specs", err)
    }
  }

  private async switchSpec(url: string | undefined) {
    if (url === this.specUrl)
      return
    if (url)
      setSelectedSpecUrl(url)
    this.specUrl = url
    // endpoints and saved query belong to the previous spec
    this.selectedKey = ""
    this.savedQuery = undefined
    this.spec = undefined
    await this.loadSpec()
    await this.setupAuth()
  }

  private async specAdded(url: string) {
    await this.readAddedSpecs()
    await this.switchSpec(url)
  }

  private async removeCurrentSpec() {
    const url = this.specUrl
    if (!url || !this.isAddedSpec(url))
      return
    await removeSpec(url)
    await this.readAddedSpecs()
    await this.switchSpec(this.specUrls[0])
  }

  @state()
  private spec?: LoadedSpec

  @state()
  private specError = ""

  /** Who requests are sent as: a user (Authorization Code) or a client (Client Credentials) */
  @state()
  private identity: Identity | null = null

  /** Login options from the spec */
  @state()
  private authorizationCode?: AuthorizationCodeOption

  @state()
  private clientCredentials?: ClientCredentialsOption

  @state()
  private loginOpen = false

  /** What the login dialog logs in as; kept after closing, so it does not change while hiding */
  @state()
  private loginFlow: LoginFlow = "clientCredentials"

  private openLogin(flow: LoginFlow) {
    this.loginFlow = flow
    this.loginOpen = true
  }

  @state()
  private selectedKey = ""

  /** Saved query loaded in the editor */
  @state()
  private savedQuery?: SavedQuery

  private selectOperation(key: string) {
    this.selectedKey = key
    this.savedQuery = undefined
  }

  private async selectSavedQuery(query: SavedQuery) {
    this.selectedKey = query.operationKey
    // new object, so selecting the same query again reloads its values
    this.savedQuery = { ...query }
    // run it once the editor has the operation and values
    await this.updateComplete
    const editor = this.renderRoot.querySelector("request-editor")
    await editor?.updateComplete
    editor?.runSavedQuery()
  }

  @state()
  private theme = getTheme()

  @state()
  private tokenOpen = false

  private toggleTheme() {
    this.theme = this.theme === "dark" ? "light" : "dark"
    setTheme(this.theme)
  }

  connectedCallback() {
    super.connectedCallback()
    onIdentityChanged((identity) => (this.identity = identity))
    this.readAddedSpecs()
      .then(() => {
        this.specUrl = getSelectedSpecUrl(this.specUrls)
        this.ready = true
        return this.loadSpec()
      })
      .then(() => this.setupAuth())
  }

  /** Login options from the spec's securitySchemes, then restore an Authorization Code login */
  private async setupAuth() {
    const options = this.spec ? getAuthOptions(this.spec.document) : {}
    this.authorizationCode = options.authorizationCode
    this.clientCredentials = options.clientCredentials
    setAuthorizationCodeOption(options.authorizationCode)
    this.identity = await initialize()
  }

  private async loadSpec(refresh = false) {
    this.specError = ""
    if (refresh)
      this.spec = undefined
    if (!this.specUrl)
      return
    try {
      this.spec = await loadSpec(this.specUrl, refresh)
    } catch (err) {
      this.specError = err instanceof Error ? err.message : String(err)
    }
  }

  private get selectedOperation() {
    return this.spec?.operations.find((o) => o.key === this.selectedKey)
  }

  private renderMain() {
    if (this.ready && !this.specUrl) {
      return html`
        <div class="center">
          <wa-callout variant="brand">
            <wa-icon slot="icon" name="map"></wa-icon>
            Add the url of an OpenAPI spec to explore its API. It is remembered in this browser.
            <div class="start-actions">
              <wa-button variant="brand" @click=${() => (this.addSpecOpen = true)}>
                <wa-icon slot="start" name="plus"></wa-icon>
                Add OpenAPI spec
              </wa-button>
            </div>
          </wa-callout>
        </div>
      `
    }
    if (this.specError) {
      return html`
        <div class="center">
          <wa-callout variant="danger">
            Could not load spec from ${this.specUrl}: ${this.specError}
          </wa-callout>
        </div>
      `
    }
    if (!this.spec)
      return html`<div class="center"><wa-spinner></wa-spinner> Loading spec…</div>`

    return html`
      <wa-split-panel position="25">
        <wa-tab-group slot="start" class="sidebar">
          <wa-tab slot="nav" panel="endpoints">Endpoints</wa-tab>
          <wa-tab slot="nav" panel="saved">Saved</wa-tab>
          <wa-tab-panel name="endpoints">
            <operation-browser
              .operations=${this.spec.operations}
              .document=${this.spec.document}
              selectedKey=${this.selectedKey}
              @operation-selected=${(e: CustomEvent<string>) => this.selectOperation(e.detail)}
            ></operation-browser>
          </wa-tab-panel>
          <wa-tab-panel name="saved">
            <saved-query-list
              .operations=${this.spec.operations}
              selectedId=${this.savedQuery?.id ?? ""}
              @query-selected=${(e: CustomEvent<SavedQuery>) => this.selectSavedQuery(e.detail)}
            ></saved-query-list>
          </wa-tab-panel>
        </wa-tab-group>
        <div slot="end">
          <request-editor
            .spec=${this.spec}
            .operation=${this.selectedOperation}
            .savedQuery=${this.savedQuery}
            ?authenticated=${!!this.identity}
            .identity=${this.identity}
            @query-saved=${(e: CustomEvent<SavedQuery>) => (this.savedQuery = e.detail)}
          ></request-editor>
        </div>
      </wa-split-panel>
    `
  }

  /** Spec selector: the configured and added spec urls, with add and remove */
  private renderSpecSelect() {
    const addButton = html`
      <wa-button id="add-spec" size="s" appearance="plain" @click=${() => (this.addSpecOpen = true)}>
        <wa-icon name="plus" label="Add OpenAPI spec"></wa-icon>
      </wa-button>
      <wa-tooltip for="add-spec">Add OpenAPI spec</wa-tooltip>
    `
    if (!this.specUrls.length)
      return addButton
    return html`
      <span class="spec-select">
        <wa-select
          size="s"
          aria-label="OpenAPI spec"
          .value=${this.specUrl}
          @change=${(e: Event) => this.switchSpec((e.target as HTMLSelectElement).value)}
        >
          ${this.specUrls.map(
            (url) => html`<wa-option value=${url}>${url.replace(/^https?:\/\//, "")}</wa-option>`,
          )}
        </wa-select>
        <wa-button
          size="s"
          appearance="plain"
          href=${this.specUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <wa-icon name="arrow-up-right-from-square" label="Open the spec"></wa-icon>
        </wa-button>
        ${addButton}
        ${this.isAddedSpec(this.specUrl)
        ? html`
              <wa-button id="remove-spec" size="s" appearance="plain" @click=${this.removeCurrentSpec}>
                <wa-icon name="trash" label="Remove this spec"></wa-icon>
              </wa-button>
              <wa-tooltip for="remove-spec">Remove this spec from the list</wa-tooltip>
            `
        : null}
      </span>
    `
  }

  private renderLogin() {
    const identity = this.identity
    if (identity) {
      return html`
        <wa-button id="identity" size="s" appearance="plain" @click=${() => (this.tokenOpen = true)}>
          <wa-icon slot="start" name=${identity.flow === "clientCredentials" ? "robot" : "user"}></wa-icon>
          ${identity.name}
        </wa-button>
        <wa-tooltip for="identity">
          ${identity.flow === "clientCredentials" ? "Client Credentials" : "Authorization Code"} · show access token
        </wa-tooltip>
        <token-dialog
          ?open=${this.tokenOpen}
          .token=${identity.accessToken}
          @close=${() => (this.tokenOpen = false)}
        ></token-dialog>
        <wa-button size="s" @click=${logout}>Log out</wa-button>
      `
    }
    const loginDialog = html`<login-dialog
      ?open=${this.loginOpen}
      flow=${this.loginFlow}
      .authorizationCodeOption=${this.authorizationCode}
      .clientCredentialsOption=${this.clientCredentials}
      @close=${() => (this.loginOpen = false)}
    ></login-dialog>`
    // both options: a menu, otherwise a single button
    if (this.authorizationCode && this.clientCredentials) {
      return html`
        <wa-dropdown
          @wa-select=${(e: CustomEvent<{ item: { value: string } }>) =>
          this.openLogin(e.detail.item.value as LoginFlow)}
        >
          <wa-button slot="trigger" size="s" variant="brand" with-caret>Log in</wa-button>
          <wa-dropdown-item value="authorizationCode">
            <wa-icon slot="icon" name="user"></wa-icon>
            Authorization Code
          </wa-dropdown-item>
          <wa-dropdown-item value="clientCredentials">
            <wa-icon slot="icon" name="robot"></wa-icon>
            Client Credentials
          </wa-dropdown-item>
        </wa-dropdown>
        ${loginDialog}
      `
    }
    const flow: LoginFlow | undefined = this.clientCredentials
      ? "clientCredentials"
      : this.authorizationCode
        ? "authorizationCode"
        : undefined
    if (!flow)
      return null
    return html`
      <wa-button size="s" variant="brand" @click=${() => this.openLogin(flow)}>Log in</wa-button>
      ${loginDialog}
    `
  }

  render() {
    return html`
      <header>
        <h1>
          <img class="logo" src="/logo.webp" width="32" height="32" alt="" title="Hyperborea ${appVersion}" />
        </h1>
        ${this.spec
        ? html`
              <span class="spec">
                ${this.spec.title} ${this.spec.version} · ${this.spec.apiBaseUrl}
              </span>
            `
        : null}
        ${this.ready ? this.renderSpecSelect() : null}
        <div class="end">
          <wa-button size="s" appearance="plain" @click=${this.toggleTheme}>
            <wa-icon
              name=${this.theme === "dark" ? "sun" : "moon"}
              label=${this.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            ></wa-icon>
          </wa-button>
          <wa-button size="s" appearance="plain" ?disabled=${!this.specUrl} @click=${() => this.loadSpec(true)}>
            <wa-icon name="rotate" label="Reload spec"></wa-icon>
          </wa-button>
          ${this.renderLogin()}
        </div>
      </header>
      ${this.renderMain()}
      <add-spec-dialog
        ?open=${this.addSpecOpen}
        .known=${this.specUrls}
        @spec-added=${(e: CustomEvent<string>) => this.specAdded(e.detail)}
        @close=${() => (this.addSpecOpen = false)}
      ></add-spec-dialog>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "workbench-page": WorkbenchPage
  }
}
