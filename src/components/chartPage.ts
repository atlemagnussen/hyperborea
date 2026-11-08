import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, state } from "lit/decorators.js"
import {
  getAccessToken,
  getIdentity,
  initialize,
  loginAuthorizationCode,
  loginSilently,
  onIdentityChanged,
  setAuthorizationCodeOption,
  type Identity,
} from "../auth/auth.js"
import { getRows } from "../chart/rows.js"
import { buildUrl, execute, type ResponseResult } from "../request/request.js"
import { loadSpec, type LoadedSpec, type Operation } from "../spec/openapi.js"
import { getAuthOptions, type AuthorizationCodeOption } from "../spec/security.js"
import { getQuery, type SavedQuery } from "../storage/savedQueries.js"
import "./chartView.js"
import "./loginDialog.js"

const refreshChoices = [
  { minutes: 0, label: "Off" },
  { minutes: 1, label: "Every minute" },
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 60, label: "Every hour" },
]

/** Auto refresh from the url (?refresh=5), so a screen can keep showing a chart */
function refreshFromUrl() {
  const minutes = Number(new URLSearchParams(window.location.search).get("refresh"))
  return refreshChoices.some((c) => c.minutes === minutes) ? minutes : 0
}

type Status = "loading" | "login" | "ready" | "error"

/**
 * A published chart on its own page (/chart/{id}): sends the saved request with the login from
 * its spec and shows only the chart. See PublishedChart in storage/savedQueries.ts.
 */
@customElement("chart-page")
export class ChartPage extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-s);
      height: 100%;
      box-sizing: border-box;
      padding: var(--wa-space-m) var(--wa-space-l);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--wa-space-s) var(--wa-space-m);
    }
    h1 {
      margin: 0;
      font-size: var(--wa-font-size-xl);
      font-weight: var(--wa-font-weight-semibold);
    }
    .meta {
      display: flex;
      align-items: center;
      gap: var(--wa-space-s);
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .end {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
    }
    .end wa-select {
      width: 12em;
    }
    chart-view {
      flex: 1;
      min-height: 0;
    }
    .center {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--wa-space-m);
      padding: var(--wa-space-l) 0;
    }
  `

  /** Id of the saved query, from the path */
  @property()
  queryId = ""

  @state()
  private query?: SavedQuery

  @state()
  private status: Status = "loading"

  @state()
  private error = ""

  @state()
  private identity: Identity | null = null

  @state()
  private result?: ResponseResult

  @state()
  private loading = false

  @state()
  private refreshMinutes = refreshFromUrl()

  /** No login saved with the chart: the login dialog asks for a client id */
  @state()
  private loginOpen = false

  private spec?: LoadedSpec
  private operation?: Operation
  private authOption?: AuthorizationCodeOption
  private timer?: ReturnType<typeof setInterval>
  private stopListening?: () => void

  connectedCallback() {
    super.connectedCallback()
    this.stopListening = onIdentityChanged((identity) => {
      this.identity = identity
      // logged in from the button or the dialog
      if (identity && this.status === "login") {
        this.status = "ready"
        this.send()
      }
    })
    this.startTimer()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.stopListening?.()
    clearInterval(this.timer)
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("queryId"))
      this.load()
  }

  /** Sends again every refreshMinutes, while the page is visible */
  private startTimer() {
    clearInterval(this.timer)
    if (this.refreshMinutes)
      this.timer = setInterval(() => !document.hidden && this.send(), this.refreshMinutes * 60_000)
  }

  private fail(message: string) {
    this.error = message
    this.status = "error"
  }

  private async load() {
    this.status = "loading"
    this.result = undefined
    try {
      const query = await getQuery(this.queryId)
      if (!query?.chart)
        return this.fail("No published chart with this link in this browser. Charts are saved per browser.")
      this.query = query
      document.title = `${query.chart.title} · Hyperborea`
      this.spec = await loadSpec(query.specUrl)
      this.operation = this.spec.operations.find((o) => o.key === query.operationKey)
      if (!this.operation)
        return this.fail(`The endpoint ${query.operationKey} is not in the spec ${query.specUrl} any more.`)
      this.identity = await this.logIn()
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err))
    }
    if (this.authOption && !this.identity) {
      this.status = "login"
      return
    }
    this.status = "ready"
    await this.send()
  }

  /** The spec's Authorization Code login, silently with the client the chart was published with */
  private async logIn() {
    this.authOption = getAuthOptions(this.spec!.document).authorizationCode
    const auth = this.query!.chart!.auth
    if (this.authOption && auth?.authority === this.authOption.authority)
      return loginSilently(this.authOption, auth)
    setAuthorizationCodeOption(this.authOption)
    return (await initialize()) ?? getIdentity()
  }

  /** From a click, so the browser allows the popup */
  private async loginClick() {
    const auth = this.query?.chart?.auth
    if (!this.authOption)
      return
    if (!auth) {
      this.loginOpen = true
      return
    }
    try {
      await loginAuthorizationCode(this.authOption, auth.clientId, auth.scope.split(" "))
    } catch (err) {
      this.fail(`Login failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private send = async () => {
    if (!this.spec || !this.operation || !this.query || this.loading)
      return
    this.loading = true
    try {
      const result = await execute({
        method: this.operation.method,
        url: buildUrl(this.spec.apiBaseUrl, this.operation, this.query.values),
        token: await getAccessToken(),
      })
      if (result.status === 401 && this.authOption) {
        this.status = "login"
        return
      }
      this.result = result
    } catch (err) {
      // keep showing the last chart; the error tells why it is not updated
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
    }
  }

  private setRefresh(minutes: number) {
    this.refreshMinutes = minutes
    this.startTimer()
    const url = new URL(window.location.href)
    if (minutes)
      url.searchParams.set("refresh", String(minutes))
    else
      url.searchParams.delete("refresh")
    history.replaceState(history.state, "", url)
  }

  private renderBody() {
    switch (this.status) {
      case "loading":
        return html`<div class="center"><wa-spinner></wa-spinner></div>`
      case "error":
        return html`<div class="center">
          <wa-callout variant="danger">${this.error}</wa-callout>
          <a href="/">Back to Hyperborea</a>
        </div>`
      case "login":
        return html`<div class="center">
          <span>Log in to see this chart.</span>
          <wa-button variant="brand" @click=${this.loginClick}>Log in</wa-button>
          <login-dialog
            ?open=${this.loginOpen}
            flow="authorizationCode"
            .authorizationCodeOption=${this.authOption}
            @close=${() => (this.loginOpen = false)}
          ></login-dialog>
        </div>`
    }
    const result = this.result
    if (!result)
      return html`<div class="center"><wa-spinner></wa-spinner></div>`
    if (!result.ok)
      return html`<div class="center">
        <wa-callout variant="danger">The request failed: ${result.status} ${result.statusText}</wa-callout>
      </div>`
    const rows = getRows(result.body)
    if (!rows)
      return html`<div class="center"><wa-callout variant="neutral">The response has no rows to chart.</wa-callout></div>`
    const body = result.body as Record<string, unknown>
    return html`
      ${typeof body["@odata.nextLink"] === "string"
        ? html`<span class="meta">Only the first page of the response is shown.</span>`
        : null}
      ${this.error ? html`<wa-callout variant="warning" size="s">Not updated: ${this.error}</wa-callout>` : null}
      <chart-view readonly .rows=${rows} .preset=${this.query?.chart?.config}></chart-view>
    `
  }

  render() {
    const chart = this.query?.chart
    return html`
      <header>
        <h1>${chart?.title ?? "Chart"}</h1>
        ${this.result
          ? html`<span class="meta">
              ${this.query?.name} · updated <wa-relative-time .date=${this.result.receivedAt} sync></wa-relative-time>
              ${this.loading ? html`<wa-spinner></wa-spinner>` : null}
            </span>`
          : null}
        <div class="end">
          ${this.status === "ready"
            ? html`
                <wa-select
                  size="s"
                  aria-label="Auto refresh"
                  title="Auto refresh, kept in the link"
                  .value=${String(this.refreshMinutes)}
                  @change=${(e: Event) => this.setRefresh(Number((e.target as HTMLSelectElement).value))}
                >
                  <wa-icon slot="start" name="clock-rotate-left"></wa-icon>
                  ${refreshChoices.map((c) => html`<wa-option value=${String(c.minutes)}>${c.label}</wa-option>`)}
                </wa-select>
                <wa-button size="s" appearance="plain" ?disabled=${this.loading} @click=${this.send}>
                  <wa-icon name="rotate" label="Refresh"></wa-icon>
                </wa-button>
              `
            : null}
          <wa-button size="s" appearance="plain" href="/" title="Open Hyperborea">
            <wa-icon name="pen-to-square" label="Open Hyperborea"></wa-icon>
          </wa-button>
        </div>
      </header>
      ${this.renderBody()}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chart-page": ChartPage
  }
}
