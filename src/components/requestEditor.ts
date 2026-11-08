import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, state } from "lit/decorators.js"
import { currentAuthorizationCodeConfig, getAccessToken, type Identity } from "../auth/auth.js"
import { insertableValues, noInsertableReason } from "../auth/claims.js"
import type { ChartConfig } from "../chart/rows.js"
import { getAuthOptions } from "../spec/security.js"
import { getAutoSend, setAutoSend } from "../autoSend.js"
import { appVersion } from "../environment.js"
import {
  bodyKey,
  buildUrl,
  customQueryNames,
  execute,
  missingRequired,
  paramKey,
  valuesFromNextLink,
  type ParameterValues,
  type ResponseResult,
} from "../request/request.js"
import {
  getParameterType,
  isQuery,
  type Document,
  type LoadedSpec,
  type Method,
  type Operation,
  type Parameter,
} from "../spec/openapi.js"
import { exampleBody } from "../spec/example.js"
import { completeFilter } from "../odata/filterCompletion.js"
import { completeExpand } from "../odata/expandCompletion.js"
import { completeSelect } from "../odata/selectCompletion.js"
import { completeApply } from "../odata/applyCompletion.js"
import { getFields, getItemSchema, getResponseModel } from "../spec/fields.js"
import type { BodyEditor } from "./bodyEditor.js"
import type { CompleteFn, OdataEditor } from "./odataEditor.js"
import { saveQuery, type SavedQuery } from "../storage/savedQueries.js"
import type { JsonTarget } from "../codemirror/jsonTarget.js"
import {
  appendFilter,
  appendSelect,
  literalAtCursor,
  odataLiteral,
  resolveRowValue,
} from "../odata/valueActions.js"
import type { Field } from "../spec/fields.js"
import type { Schema } from "../spec/openapi.js"
import type { ValueAction, ValueActionDetail } from "./jsonView.js"
import "./bodyEditor.js"
import "./modelView.js"
import "./odataEditor.js"
import "./responseView.js"

// remembers entered values per operation while the app is open
const valuesByOperation = new Map<string, ParameterValues>()

const sendShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘+Enter" : "Ctrl+Enter"

// initial values for query parameters of collection endpoints, used when the operation has the
// parameter. Single item endpoints (e.g. /customers/{id}) also declare $count but get no defaults
const defaultQueryValues: Record<string, string> = { $count: "true" }

// optional query parameters shown without a value; the other optional ones are added from chips
const pinnedQueryParams = new Set(["$filter", "$count"])

// OData system query options offered as chips on OData reads that do not declare them
const knownOdataParams = [
  "$filter", "$select", "$expand", "$orderby", "$top", "$skip", "$count", "$search", "$skiptoken",
  "$apply", "$compute", "$levels", "$format",
]

/** A query parameter the spec does not declare, added by the user or from a next link */
function customParam(name: string): Parameter {
  return { name, in: "query", description: "Not declared in the spec" }
}

const methodVariant: Record<Method, string> = {
  get: "brand",
  post: "success",
  put: "warning",
  patch: "warning",
  delete: "danger",
}

/** Example body of a write, built from the spec, so there is something to edit */
function defaultBody(document: Document, operation: Operation) {
  return operation.requestBody?.contentType ? exampleBody(document, operation.requestBody.schema) : ""
}

function defaultValues(document: Document, operation: Operation): ParameterValues {
  const values: ParameterValues = {}
  const body = defaultBody(document, operation)
  if (body)
    values[bodyKey] = body
  if (!isQuery(operation) || !operation.isCollection)
    return values
  for (const p of operation.parameters) {
    if (p.in === "query" && p.name in defaultQueryValues)
      values[paramKey(p.in, p.name)] = defaultQueryValues[p.name]
  }
  return values
}

@customElement("request-editor")
export class RequestEditor extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
      padding: var(--wa-space-m);
      box-sizing: border-box;
      /* fill the panel, so the start screen can use the full height */
      min-height: 100%;
    }
    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    wa-tab-panel::part(base) {
      padding: var(--wa-space-m) 0 0;
    }
    .welcome {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: var(--wa-space-s);
      padding: var(--wa-space-2xl) var(--wa-space-l);
      border-radius: var(--wa-border-radius-l);
      /* background.webp is pre-blurred and small (28 kB) instead of blurring with CSS */
      background-color: var(--wa-color-surface-lowered);
      background-image: linear-gradient(var(--welcome-background-dim), var(--welcome-background-dim)),
        url("/background.webp");
      background-size: cover;
      background-position: center;
    }
    .welcome img {
      width: min(360px, 70vw);
      height: auto;
      border-radius: 50%;
      box-shadow: 0 0 2.5rem rgb(0 0 0 / 0.45);
    }
    .welcome h1 {
      margin: var(--wa-space-m) 0 0;
      font-size: var(--wa-font-size-3xl);
      letter-spacing: 0.04em;
    }
    .welcome .version {
      margin: 0;
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .welcome .credit {
      margin: 0;
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-xs);
    }
    .dialog-buttons {
      display: flex;
      gap: var(--wa-space-s);
    }
    .publish-form {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    .publish-link {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
    }
    .publish-link wa-input {
      flex: 1;
    }
    .publish-form .quiet {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    wa-dialog code {
      font-family: var(--wa-font-family-code);
      word-break: break-all;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: var(--wa-space-s);
      margin: 0;
      font-size: var(--wa-font-size-l);
    }
    .description {
      margin: 0;
      color: var(--wa-color-text-quiet);
    }
    .url-bar {
      display: flex;
      gap: var(--wa-space-xs);
      align-items: center;
    }
    .url-bar wa-input {
      flex: 1;
    }
    .url-bar wa-input::part(input) {
      font-family: var(--wa-font-family-code);
    }
    fieldset {
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
      padding: var(--wa-space-m);
      margin: 0;
    }
    wa-details::part(header) {
      font-weight: var(--wa-font-weight-semibold);
    }
    legend {
      padding: 0 var(--wa-space-xs);
      font-weight: var(--wa-font-weight-semibold);
    }
    .params {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: var(--wa-space-m);
    }
    .first-row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--wa-space-s);
      margin-bottom: var(--wa-space-m);
    }
    .first-row > :not(.compact) {
      flex: 1 1 8rem;
      /* flex items do not shrink below their content width by default */
      min-width: 0;
    }
    /* small fields: less padding, and (in the template) no clear button or spin buttons,
       otherwise a 6rem number field leaves room for only two digits */
    .first-row .compact {
      --wa-form-control-padding-inline: var(--wa-space-xs);
    }
    .first-row wa-input.compact {
      width: 6rem;
    }
    .first-row wa-select.compact {
      width: 9rem;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--wa-space-m);
      /* each editor grows downwards on its own when its text wraps */
      align-items: start;
      margin-top: var(--wa-space-m);
    }
    .pair > * {
      min-width: 0;
    }
    .params .long {
      grid-column: 1 / -1;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--wa-space-2xs);
    }
    .params + .chips,
    .pair + .chips {
      margin-top: var(--wa-space-m);
    }
    .chips .custom-name {
      width: 12rem;
    }
    /* the "Insert from token" menu opens at the pointer, from this invisible trigger */
    .token-menu-anchor {
      position: fixed;
      width: 0;
      height: 0;
      padding: 0;
      border: 0;
      opacity: 0;
    }
    .token-menu wa-dropdown-item [slot="details"] {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--wa-color-text-quiet);
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-s);
    }
  `

  @property({ attribute: false })
  spec?: LoadedSpec

  @property({ attribute: false })
  operation?: Operation

  /** A saved query to load; set together with its operation. A new object reloads it */
  @property({ attribute: false })
  savedQuery?: SavedQuery

  /** Logged in (any flow); queries are only sent automatically then */
  @property({ type: Boolean })
  authenticated = false

  /** Who is logged in; its token claims can be inserted into parameter fields */
  @property({ attribute: false })
  identity?: Identity | null

  /** "Insert from token" menu opened by right-clicking a field, at the pointer */
  @state()
  private tokenMenu?: {
    x: number
    y: number
    param: Parameter
    claims: [name: string, value: string][]
    /** Selection in a wa-input when it was right-clicked; odata-editor keeps its own */
    selection?: [start: number, end: number]
  }

  @state()
  private autoSend = getAutoSend()

  /** Set when the operation changed, so the endpoint is sent once it is rendered */
  private sendOnUpdate = false

  @state()
  private values: ParameterValues = {}

  @state()
  private saveOpen = false

  @state()
  private saveName = ""

  @state()
  private saveError = ""

  @state()
  private loading = false

  /** Chart settings waiting in the publish dialog */
  @state()
  private publishConfig?: ChartConfig

  @state()
  private publishTitle = ""

  @state()
  private publishError = ""

  /** The query just published, the dialog shows its link */
  @state()
  private published?: SavedQuery

  /** A DELETE waiting for confirmation */
  @state()
  private confirmOpen = false

  @state()
  private result?: ResponseResult

  @state()
  private error = ""

  // kept when switching operation
  @state()
  private odataOpen = true

  /** The name input of the "Custom…" chip is open */
  @state()
  private customNameOpen = false

  private abort?: AbortController

  /** A mouse button or finger is down in the editor, see onFieldBlur */
  private pointerDown = false

  constructor() {
    super()
    // Ctrl+Enter (Cmd+Enter on Mac) sends from anywhere in the editor, also multi-line inputs
    this.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        this.send()
      }
    })
    this.addEventListener("pointerdown", () => (this.pointerDown = true))
    window.addEventListener("pointerup", () => (this.pointerDown = false))
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("operation") && this.operation) {
      this.abort?.abort()
      this.values = valuesByOperation.get(this.operation.key) ?? defaultValues(this.spec!.document, this.operation)
      this.result = undefined
      this.error = ""
      this.loading = false
      this.customNameOpen = false
      this.createCompletions()
      // a saved query is run by runSavedQuery instead
      this.sendOnUpdate = !this.savedQuery
    }
    if (changed.has("savedQuery") && this.savedQuery && this.operation) {
      // copy, so editing does not change the loaded query until it is saved
      this.values = { ...this.savedQuery.values }
      valuesByOperation.set(this.operation.key, this.values)
    }
  }

  protected updated() {
    if (this.sendOnUpdate) {
      this.sendOnUpdate = false
      this.sendAutomatically()
    }
  }

  /** Only reads are sent without being asked; a write changes data, so it waits for Send */
  private get canAutoSend() {
    return this.authenticated && this.autoSend && !!this.operation && isQuery(this.operation)
  }

  /**
   * Sends without being asked (endpoint selected, value action), when logged in, auto send is on
   * and it is a read. Missing required parameters (e.g. an {id}) just skip it, the user has not
   * asked yet
   */
  private sendAutomatically() {
    if (!this.canAutoSend || !this.operation || missingRequired(this.operation, this.values).length)
      return
    return this.send()
  }

  private toggleAutoSend(e: Event) {
    this.autoSend = (e.target as HTMLInputElement).checked
    setAutoSend(this.autoSend)
  }

  private openSave() {
    if (!this.operation)
      return
    const loaded = this.loadedQuery
    this.saveName = loaded?.name ?? this.operation.operationId ?? this.operation.summary ?? this.operation.path
    this.saveError = ""
    this.saveOpen = true
  }

  /** The saved query shown in the editor, if it belongs to the current operation */
  private get loadedQuery() {
    return this.savedQuery?.operationKey === this.operation?.key ? this.savedQuery : undefined
  }

  private async save(asNew: boolean) {
    const name = this.saveName.trim()
    if (!this.operation || !this.spec || !name)
      return
    try {
      const saved = await saveQuery({
        id: asNew ? undefined : this.loadedQuery?.id,
        name,
        operationKey: this.operation.key,
        values: { ...this.values },
        specUrl: this.spec.url,
        // updating keeps a published chart; a new query starts without one
        chart: asNew ? undefined : this.loadedQuery?.chart,
      })
      this.saveOpen = false
      this.dispatchEvent(new CustomEvent("query-saved", { detail: saved, bubbles: true, composed: true }))
    } catch (err) {
      this.saveError = `Could not save: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private openPublish(e: CustomEvent<ChartConfig>) {
    const loaded = this.loadedQuery
    this.publishConfig = e.detail
    this.publishTitle = loaded?.chart?.title ?? loaded?.name ?? this.operation?.operationId ?? ""
    this.publishError = ""
    this.published = undefined
  }

  /** The Authorization Code login a published chart logs in with, when this tab has one */
  private get publishAuth() {
    return this.spec && currentAuthorizationCodeConfig(getAuthOptions(this.spec.document).authorizationCode)
  }

  /** Saves the request as it is now (values and chart), so the chart page shows what is on screen */
  private async publish() {
    const title = this.publishTitle.trim()
    const loaded = this.loadedQuery
    if (!this.operation || !this.spec || !this.publishConfig || !title)
      return
    try {
      const saved = await saveQuery({
        id: loaded?.id,
        name: loaded?.name ?? title,
        operationKey: this.operation.key,
        values: { ...this.values },
        specUrl: this.spec.url,
        chart: { title, config: this.publishConfig, auth: this.publishAuth, publishedAt: new Date().toISOString() },
      })
      this.published = saved
      this.dispatchEvent(new CustomEvent("query-saved", { detail: saved, bubbles: true, composed: true }))
    } catch (err) {
      this.publishError = `Could not publish: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private renderPublishDialog() {
    const loaded = this.loadedQuery
    const published = this.published
    const link = published ? `${window.location.origin}/chart/${published.id}` : ""
    const close = () => {
      this.publishConfig = undefined
      this.published = undefined
    }
    return html`
      <wa-dialog
        label=${published ? "Chart published" : "Publish chart"}
        ?open=${!!this.publishConfig}
        @wa-after-hide=${(e: Event) => e.target === e.currentTarget && close()}
      >
        ${published
          ? html`
              <div class="publish-form">
                <span>The chart has its own page, which sends the request each time it is opened.</span>
                <div class="publish-link">
                  <wa-input readonly .value=${link} aria-label="Link to the chart"></wa-input>
                  <wa-copy-button .value=${link} copy-label="Copy link"></wa-copy-button>
                </div>
                <span class="quiet">
                  Saved in this browser only: the link works here, not for others.
                </span>
              </div>
              <div slot="footer" class="dialog-buttons">
                <wa-button @click=${close}>Close</wa-button>
                <wa-button variant="brand" href=${link} target="_blank" rel="noopener">
                  Open
                  <wa-icon slot="end" name="arrow-up-right-from-square"></wa-icon>
                </wa-button>
              </div>
            `
          : html`
              <div class="publish-form">
                <wa-input
                  label="Title"
                  .value=${this.publishTitle}
                  @input=${(e: Event) => (this.publishTitle = (e.target as HTMLInputElement).value ?? "")}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.stopPropagation()
                      this.publish()
                    }
                  }}
                  autofocus
                ></wa-input>
                <span>
                  ${loaded
                    ? html`Saves <b>${loaded.name}</b> as it is now, with this chart.`
                    : "Saves the request as it is now, with this chart, named by the title."}
                </span>
                ${this.publishAuth
                  ? null
                  : html`<wa-callout variant="warning" size="s">
                      Not logged in with Authorization Code: the chart page will ask for a client id
                      to log in. Log in as a user first to let it log in by itself.
                    </wa-callout>`}
                ${this.publishError ? html`<wa-callout variant="danger">${this.publishError}</wa-callout>` : null}
              </div>
              <div slot="footer" class="dialog-buttons">
                <wa-button @click=${close}>Cancel</wa-button>
                <wa-button variant="brand" @click=${this.publish} ?disabled=${!this.publishTitle.trim()}>
                  Publish
                </wa-button>
              </div>
            `}
      </wa-dialog>
    `
  }

  private renderSaveDialog() {
    const loaded = this.loadedQuery
    return html`
      <wa-dialog
        label="Save request"
        ?open=${this.saveOpen}
        @wa-after-hide=${(e: Event) => e.target === e.currentTarget && (this.saveOpen = false)}
      >
        <wa-input
          label="Name"
          .value=${this.saveName}
          @input=${(e: Event) => (this.saveName = (e.target as HTMLInputElement).value ?? "")}
          @keydown=${(e: KeyboardEvent) => {
        // keep Enter from sending the request
        if (e.key === "Enter") {
          e.stopPropagation()
          this.save(!loaded)
        }
      }}
          autofocus
        ></wa-input>
        ${this.saveError ? html`<wa-callout variant="danger">${this.saveError}</wa-callout>` : null}
        <div slot="footer" class="dialog-buttons">
          ${loaded
        ? html`
                <wa-button @click=${() => this.save(true)} ?disabled=${!this.saveName.trim()}>
                  Save as new
                </wa-button>
                <wa-button variant="brand" @click=${() => this.save(false)} ?disabled=${!this.saveName.trim()}>
                  Update
                </wa-button>
              `
        : html`
                <wa-button variant="brand" @click=${() => this.save(true)} ?disabled=${!this.saveName.trim()}>
                  Save
                </wa-button>
              `}
        </div>
      </wa-dialog>
    `
  }

  // OData autocomplete from the fields of the operation's response rows
  private completeFilter?: CompleteFn
  private completeSelect?: CompleteFn
  private completeExpand?: CompleteFn
  private completeApply?: CompleteFn

  /** Fields of a response row, for the value actions in the response */
  private rowFields?: { fields: Field[]; fieldsOf: (schema: Schema) => Field[] }

  /** Actions for a value in the response: filter on it, select it, sort by it, copy it */
  private actionsFor = (target: JsonTarget): ValueAction[] => {
    const actions: ValueAction[] = []
    const row = this.rowFields && resolveRowValue(target.path, this.rowFields.fields, this.rowFields.fieldsOf)
    const has = (name: string) => this.operation?.parameters.some((p) => p.in === "query" && p.name === name)
    if (row && target.primitive) {
      const condition = `${row.odataPath} eq ${odataLiteral(target.value, row.field)}`
      if (has("$filter")) {
        actions.push({ id: "filter-eq", label: "= filter", title: `Add to $filter: ${condition}` })
        actions.push({ id: "filter-ne", label: "≠ filter", title: `Add to $filter: ${condition.replace(" eq ", " ne ")}` })
      }
      if (row.topLevel && has("$orderby")) {
        actions.push({ id: "orderby-asc", label: "↑ sort", title: `$orderby=${row.odataPath} asc` })
        actions.push({ id: "orderby-desc", label: "↓ sort", title: `$orderby=${row.odataPath} desc` })
      }
    }
    if (row?.topLevel && has("$select"))
      actions.push({ id: "select", label: "+ select", title: `Add ${row.odataPath} to $select` })
    if (target.primitive)
      actions.push({ id: "copy", label: "copy", title: "Copy the value" })
    return actions
  }

  private onValueAction(e: CustomEvent<ValueActionDetail>) {
    const { action, target } = e.detail
    if (action === "copy") {
      navigator.clipboard?.writeText(String(target.value)).catch(() => { })
      return
    }
    const row = this.rowFields && resolveRowValue(target.path, this.rowFields.fields, this.rowFields.fieldsOf)
    if (!row || !this.operation)
      return
    const key = (name: string) => paramKey("query", name)
    const values = { ...this.values }
    if (action === "filter-eq" || action === "filter-ne") {
      const op = action === "filter-eq" ? "eq" : "ne"
      values[key("$filter")] = appendFilter(values[key("$filter")] ?? "", `${row.odataPath} ${op} ${odataLiteral(target.value, row.field)}`)
    } else if (action === "orderby-asc" || action === "orderby-desc") {
      values[key("$orderby")] = `${row.odataPath} ${action === "orderby-asc" ? "asc" : "desc"}`
    } else if (action === "select") {
      values[key("$select")] = appendSelect(values[key("$select")] ?? "", row.odataPath)
    }
    // a new filter or sort order makes the current page position meaningless
    if (action !== "select") {
      delete values[key("$skip")]
      delete values[key("$skiptoken")]
    }
    this.values = values
    valuesByOperation.set(this.operation.key, values)
    this.sendAutomatically()
  }

  private createCompletions() {
    this.completeFilter = this.completeSelect = this.completeExpand = this.completeApply = this.rowFields = undefined
    if (!this.spec || !this.operation || !isQuery(this.operation))
      return
    const document = this.spec.document
    const fields = getFields(document, getItemSchema(document, this.operation))
    const ctx = { fields, fieldsOf: (schema: Parameters<typeof getFields>[1]) => getFields(document, schema) }
    this.rowFields = ctx
    this.completeFilter = (text) => completeFilter(text, ctx)
    this.completeSelect = (text) => completeSelect(text, fields)
    const rootName = getResponseModel(document, this.operation).itemName
    this.completeExpand = (text) => completeExpand(text, ctx, rootName)
    this.completeApply = (text) => completeApply(text, ctx)
  }

  private get url() {
    if (!this.spec || !this.operation)
      return ""
    return buildUrl(this.spec.apiBaseUrl, this.operation, this.values)
  }

  private setValue(param: Parameter, value: string) {
    if (!this.operation)
      return
    this.values = { ...this.values, [paramKey(param.in, param.name)]: value }
    valuesByOperation.set(this.operation.key, this.values)
  }

  private setBody(text: string) {
    if (!this.operation)
      return
    this.values = { ...this.values, [bodyKey]: text }
    valuesByOperation.set(this.operation.key, this.values)
  }

  /** Clear button: the field is done, so the query is sent like after a value action */
  private clearValue(param: Parameter) {
    this.setValue(param, "")
    this.sendAutomatically()
  }

  /** Follows @odata.nextLink: its parameters go into the form, then the request is sent */
  private nextPage(nextLink: string) {
    if (!this.operation || !isQuery(this.operation))
      return
    this.values = valuesFromNextLink(this.values, nextLink)
    valuesByOperation.set(this.operation.key, this.values)
    return this.send()
  }

  /**
   * Runs a saved query selected in the list: OData options collapsed to focus on the result.
   * Only loaded, not sent, when not logged in, auto send is off or it is a write
   */
  runSavedQuery() {
    if (!this.canAutoSend)
      return
    this.odataOpen = false
    return this.send()
  }

  /** Sends the request with the current values; a DELETE asks for confirmation first */
  async send() {
    if (this.operation?.method === "delete")
      this.confirmOpen = true
    else
      return this.sendNow()
  }

  private confirmDelete() {
    this.confirmOpen = false
    return this.sendNow()
  }

  private renderConfirmDialog() {
    return html`
      <wa-dialog
        label="Send DELETE?"
        ?open=${this.confirmOpen}
        @wa-after-hide=${(e: Event) => e.target === e.currentTarget && (this.confirmOpen = false)}
      >
        <p>This deletes data on the server:</p>
        <code>DELETE ${this.url}</code>
        <div slot="footer" class="dialog-buttons">
          <wa-button @click=${() => (this.confirmOpen = false)} autofocus>Cancel</wa-button>
          <wa-button variant="danger" @click=${this.confirmDelete}>Delete</wa-button>
        </div>
      </wa-dialog>
    `
  }

  private async sendNow() {
    const op = this.operation
    if (!op)
      return
    const missing = missingRequired(op, this.values)
    if (missing.length) {
      this.error = `Missing required parameters: ${missing.join(", ")}`
      return
    }
    // a body is sent when the spec describes a JSON one and something was entered
    const requestType = op.requestBody?.contentType
    const requestBody = requestType && this.values[bodyKey]?.trim() ? this.values[bodyKey] : undefined
    if (requestBody !== undefined) {
      try {
        JSON.parse(requestBody)
      } catch (err) {
        this.error = `The request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
        return
      }
    }

    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    this.loading = true
    this.error = ""
    try {
      const token = await getAccessToken()
      this.result = await execute({
        method: op.method,
        url: this.url,
        token,
        requestBody,
        requestType,
        signal: abort.signal,
      })
    } catch (err) {
      if (abort.signal.aborted)
        return
      this.result = undefined
      // fetch only throws on network errors, which in the browser includes CORS failures
      this.error = `Request failed: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      if (this.abort === abort)
        this.loading = false
    }
  }

  /** Always shown: path, required and pinned query parameters */
  private isPinned(param: Parameter) {
    return param.in === "path" || !!param.required || (param.in === "query" && pinnedQueryParams.has(param.name))
  }

  /** An optional parameter is shown while it has an entry in values, even an empty one */
  private isShown(param: Parameter) {
    return this.isPinned(param) || paramKey(param.in, param.name) in this.values
  }

  /** Chip clicked: the parameter gets an (empty) value, so its field shows, and is focused */
  private async addParam(name: string) {
    if (!this.operation)
      return
    const key = paramKey("query", name)
    if (!(key in this.values)) {
      this.values = { ...this.values, [key]: "" }
      valuesByOperation.set(this.operation.key, this.values)
    }
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>(`[data-param="${CSS.escape(name)}"]`)?.focus()
  }

  /** An optional field left empty folds back into its chip */
  private onFieldBlur(param: Parameter, e: FocusEvent) {
    const field = e.currentTarget as HTMLElement
    const op = this.operation
    // focus may move inside the field (clear button, dropdown), so check once it has settled.
    // During a click (e.g. on a chip) wait for its end, else the chips move under the pointer
    const hide = () => {
      const key = paramKey(param.in, param.name)
      if (!op || op !== this.operation || field.matches(":focus-within") || this.isPinned(param) || this.values[key] !== "" ||
        this.tokenMenu?.param === param)
        return
      const values = { ...this.values }
      delete values[key]
      this.values = values
      valuesByOperation.set(op.key, values)
    }
    if (this.pointerDown)
      window.addEventListener("pointerup", () => setTimeout(hide), { once: true })
    else
      setTimeout(hide)
  }

  private async openCustomName() {
    this.customNameOpen = true
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>(".custom-name")?.focus()
  }

  private onCustomNameKey(e: KeyboardEvent) {
    const input = e.target as HTMLInputElement
    if (e.key === "Escape") {
      e.stopPropagation()
      this.customNameOpen = false
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      const name = (input.value ?? "").trim()
      if (!name)
        return
      this.customNameOpen = false
      this.addParam(name)
    }
  }

  private fieldOf(param: Parameter) {
    return this.renderRoot.querySelector<HTMLElement>(`[data-param="${CSS.escape(param.name)}"]`)
  }

  /**
   * Right-click on a text field opens "Insert from token" with the claims of the access token,
   * or a note why there are none (e.g. not logged in). Shift+right-click keeps the browser's menu
   */
  private openTokenMenu(param: Parameter, e: MouseEvent) {
    if (e.shiftKey)
      return
    const claims = insertableValues(this.identity)
    e.preventDefault()
    const input = e.composedPath()[0]
    const selection: [number, number] | undefined = input instanceof HTMLInputElement
      ? [input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length]
      : undefined
    this.tokenMenu = { x: e.clientX, y: e.clientY, param, claims, selection }
  }

  /** Inserts a claim at the cursor; in OData expressions as a literal ('text', bare guids) */
  private async insertClaim(value: string) {
    const menu = this.tokenMenu
    const field = menu && this.fieldOf(menu.param)
    if (!menu || !field)
      return
    if (field.localName === "odata-editor") {
      const editor = field as OdataEditor
      editor.insert(literalAtCursor(value, editor.textBeforeCursor))
      return
    }
    const current = this.values[paramKey(menu.param.in, menu.param.name)] ?? ""
    const [start, end] = menu.selection ?? [current.length, current.length]
    this.setValue(menu.param, current.slice(0, start) + value + current.slice(end))
    await this.updateComplete
    const cursor = start + value.length
    ;(field as HTMLInputElement).setSelectionRange(cursor, cursor)
  }

  /** The field gets focus back when the menu closes, so an empty optional field folds as usual */
  private closeTokenMenu() {
    const param = this.tokenMenu?.param
    this.tokenMenu = undefined
    if (param)
      this.fieldOf(param)?.focus()
  }

  private renderTokenMenu() {
    const menu = this.tokenMenu
    if (!menu)
      return null
    return html`
      <wa-dropdown
        class="token-menu"
        open
        placement="bottom-start"
        @wa-select=${(e: CustomEvent<{ item: { value: string } }>) => this.insertClaim(e.detail.item.value)}
        @wa-after-hide=${(e: Event) => e.target === e.currentTarget && this.closeTokenMenu()}
      >
        <button
          slot="trigger"
          class="token-menu-anchor"
          style="left: ${menu.x}px; top: ${menu.y}px"
          tabindex="-1"
          aria-label="Insert from token"
        ></button>
        ${menu.claims.map(([name, value]) => html`
          <wa-dropdown-item value=${value} title=${value}>
            <wa-icon slot="icon" name="key"></wa-icon>
            ${name}
            <span slot="details">${value}</span>
          </wa-dropdown-item>
        `)}
        ${menu.claims.length
          ? null
          : html`<wa-dropdown-item disabled>
              <wa-icon slot="icon" name="key"></wa-icon>
              ${noInsertableReason(this.identity)}
            </wa-dropdown-item>`}
      </wa-dropdown>
    `
  }

  /** Chips that add hidden parameters: declared ones, known OData options, and a custom name */
  private renderChips(hidden: Parameter[], suggested: string[]) {
    return html`
      <div class="chips">
        ${hidden.map((p) => html`
          <wa-button size="s" appearance="outlined" pill title=${p.description ?? ""} @click=${() => this.addParam(p.name)}>
            <wa-icon slot="start" name="plus"></wa-icon>${p.name}
          </wa-button>
        `)}
        ${suggested.map((name) => html`
          <wa-button
            size="s"
            appearance="plain"
            pill
            title="OData option not declared in the spec"
            @click=${() => this.addParam(name)}
          >
            <wa-icon slot="start" name="plus"></wa-icon>${name}
          </wa-button>
        `)}
        ${this.customNameOpen
          ? html`<wa-input
              class="custom-name"
              size="s"
              placeholder="Parameter name, Enter"
              aria-label="Custom parameter name"
              @keydown=${this.onCustomNameKey}
              @focusout=${() => setTimeout(() => (this.customNameOpen = false))}
            ></wa-input>`
          : html`<wa-button
              size="s"
              appearance="plain"
              pill
              title="Add a query parameter the spec does not declare"
              @click=${this.openCustomName}
            >
              <wa-icon slot="start" name="plus"></wa-icon>Custom…
            </wa-button>`}
      </div>
    `
  }

  /** Numbers and true/false ($top, $skip, $count, ...) get small fields on the first OData row */
  private isCompact(param: Parameter) {
    const { type, enum: options } = getParameterType(this.spec!.document, param)
    return !options && (type === "integer" || type === "number" || type === "boolean")
  }

  private renderParam(param: Parameter) {
    const { type, enum: options } = getParameterType(this.spec!.document, param)
    const value = this.values[paramKey(param.in, param.name)] ?? ""
    const onInput = (e: Event) => this.setValue(param, (e.target as HTMLInputElement).value ?? "")
    const onClear = () => this.clearValue(param)
    const custom = !this.operation?.parameters.includes(param)
    const label = `${param.name}${param.required ? " *" : ""}${custom ? " (not in spec)" : ""}`
    const onBlur = (e: FocusEvent) => this.onFieldBlur(param, e)
    const onContextMenu = (e: MouseEvent) => this.openTokenMenu(param, e)
    // descriptions are shown on hover instead of as hint lines, to keep the form short
    const compact = this.isCompact(param)
    const title = param.description ?? ""

    if (type === "boolean" || options) {
      const choices = options ?? ["true", "false"]
      return html`
        <wa-select
          data-param=${param.name}
          @focusout=${onBlur}
          class=${compact ? "compact" : ""}
          title=${title}
          label=${label}
          placeholder="(not set)"
          with-clear
          .value=${value}
          @change=${onInput}
          @wa-clear=${onClear}
        >
          ${choices.map((c) => html`<wa-option value=${c}>${c}</wa-option>`)}
        </wa-select>
      `
    }
    if (param.name === "$filter") {
      return html`
        <odata-editor
          data-param=${param.name}
          @focusout=${onBlur}
          @contextmenu=${onContextMenu}
          class="long"
          with-clear
          label=${label}
          title="Start typing or press Ctrl+Space for suggestions"
          placeholder="e.g. name eq 'x' and level gt 1"
          .value=${value}
          .complete=${this.completeFilter}
          @input=${onInput}
          @submit=${this.send}
          @clear=${onClear}
        ></odata-editor>
      `
    }
    if (param.name === "$expand") {
      return html`
        <odata-editor
          data-param=${param.name}
          @focusout=${onBlur}
          @contextmenu=${onContextMenu}
          class="long"
          with-clear
          label=${label}
          title="Related objects, with nested options: parent($select=id,name),users($top=5)"
          placeholder="e.g. parent($select=id,name)"
          .value=${value}
          .complete=${this.completeExpand}
          @input=${onInput}
          @submit=${this.send}
          @clear=${onClear}
        ></odata-editor>
      `
    }
    if (param.name === "$select") {
      return html`
        <odata-editor
          data-param=${param.name}
          @focusout=${onBlur}
          @contextmenu=${onContextMenu}
          with-clear
          label=${label}
          title="Comma separated fields. Fields of related objects: $expand=parent($select=name)"
          placeholder="e.g. id,name"
          .value=${value}
          .complete=${this.completeSelect}
          @input=${onInput}
          @submit=${this.send}
          @clear=${onClear}
        ></odata-editor>
      `
    }
    if (param.name === "$apply") {
      return html`
        <odata-editor
          data-param=${param.name}
          @focusout=${onBlur}
          @contextmenu=${onContextMenu}
          class="long"
          with-clear
          label=${label}
          title="Transformations separated by /: filter(...), groupby((fields), aggregate(...)), aggregate(field with sum as alias), compute(expression as alias)"
          placeholder="e.g. groupby((level), aggregate($count as count))"
          .value=${value}
          .complete=${this.completeApply}
          @input=${onInput}
          @submit=${this.send}
          @clear=${onClear}
        ></odata-editor>
      `
    }
    return html`
      <wa-input
        data-param=${param.name}
        @focusout=${onBlur}
        @contextmenu=${onContextMenu}
        class=${compact ? "compact" : ""}
        title=${title}
        label=${label}
        type=${type === "integer" || type === "number" ? "number" : "text"}
        ?with-clear=${!compact}
        @wa-clear=${onClear}
        ?without-spin-buttons=${compact}
        .value=${value}
        @input=${onInput}
        @keydown=${(e: KeyboardEvent) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && this.send()}
      ></wa-input>
    `
  }

  private onOdataToggle(e: Event) {
    // wa-select dropdowns inside also emit wa-show / wa-hide
    if (e.target === e.currentTarget)
      this.odataOpen = e.type === "wa-show"
  }

  private renderGroup(title: string, params: Parameter[], chips?: unknown) {
    if (!params.length && !chips)
      return null
    return html`
      <fieldset>
        <legend>${title}</legend>
        ${params.length ? html`<div class="params">${params.map((p) => this.renderParam(p))}</div>` : null}
        ${chips}
      </fieldset>
    `
  }

  /** Body editor of a write; a body that is not JSON (e.g. a file upload) cannot be edited yet */
  private renderBody(op: Operation) {
    const body = op.requestBody
    if (!body)
      return null
    if (!body.contentType)
      return html`<wa-callout variant="warning">
        The request body (${body.contentTypes.join(", ") || "no media type"}) cannot be edited yet,
        the request is sent without one.
      </wa-callout>`
    return html`
      <body-editor
        label=${`Body${body.required ? " *" : ""}`}
        contentType=${body.contentType}
        .document=${this.spec!.document}
        .schema=${body.schema}
        .value=${this.values[bodyKey] ?? ""}
        @input=${(e: Event) => this.setBody((e.target as BodyEditor).value)}
        @reset=${() => this.setBody(defaultBody(this.spec!.document, op))}
      ></body-editor>
    `
  }

  render() {
    const op = this.operation
    if (!op || !this.spec)
      return html`
        <section class="welcome">
          <!-- <img
            src="/hyperborea.webp"
            width="360"
            height="360"
            alt="Mercator's map of the Arctic, with Hyperborea around the North Pole"
          /> -->
          <h1>&nbsp;</h1>
          <p class="description">Select an endpoint on the left, or a saved request.</p>
          <p class="version">Hyperborea ${appVersion}</p>
          <p class="credit">Gerardus Mercator, <i>Septentrionalium Terrarum descriptio</i>, 1595</p>
        </section>
      `

    const pathParams = op.parameters.filter((p) => p.in === "path")
    const declaredQuery = op.parameters.filter((p) => p.in === "query")
    const custom = customQueryNames(op, this.values).map(customParam)
    // optional parameters without a value are hidden behind chips
    const query = [...declaredQuery, ...custom].filter((p) => this.isShown(p))
    const hidden = declaredQuery.filter((p) => !this.isShown(p))
    const declaredNames = new Set(declaredQuery.map((p) => p.name))
    const odataEndpoint = isQuery(op) && declaredQuery.some((p) => p.name.startsWith("$"))
    const suggested = odataEndpoint
      ? knownOdataParams.filter((name) => !declaredNames.has(name) && !(paramKey("query", name) in this.values))
      : []
    // one chip row: in the OData section when there is one, else under the query parameters
    const chips = this.renderChips(hidden, suggested)
    const odata = query.filter((p) => p.name.startsWith("$"))
    const other = query.filter((p) => !p.name.startsWith("$"))
    // first row: short text fields and the compact ones; order: search, sort, paging
    const firstRowText = ["$search", "$orderby", "$skiptoken"]
    const rank = (p: Parameter) => (firstRowText.includes(p.name) ? firstRowText.indexOf(p.name) : 1.5)
    const firstRow = odata
      .filter((p) => firstRowText.includes(p.name) || this.isCompact(p))
      .sort((a, b) => rank(a) - rank(b))
    // $select (left) and $expand (right) share the last row; the rest ($filter, ...) above it
    const pair = ["$select", "$expand"]
      .map((name) => odata.find((p) => p.name === name))
      .filter((p): p is Parameter => !!p)
    const restOdata = odata.filter((p) => !firstRow.includes(p) && !pair.includes(p))
    const url = this.url

    return html`
      <header>
        <h2>
          ${op.summary ?? op.operationId ?? op.path}
          ${this.loadedQuery
        ? html`<wa-tag size="s" variant="brand">
                <wa-icon name="floppy-disk"></wa-icon>&nbsp;${this.loadedQuery.name}
              </wa-tag>`
        : null}
        </h2>
        ${op.description ? html`<p class="description">${op.description}</p>` : null}
      </header>

      <wa-tab-group>
        <wa-tab slot="nav" panel="query">Query</wa-tab>
        <wa-tab slot="nav" panel="model">Model</wa-tab>

        <wa-tab-panel name="query">
          <div class="panel">
          <div class="url-bar">
            <wa-input readonly .value=${url} aria-label="Request url">
              <wa-badge slot="start" variant=${methodVariant[op.method]}>${op.method.toUpperCase()}</wa-badge>
            </wa-input>
            <wa-copy-button .value=${url} copy-label="Copy url"></wa-copy-button>
            <wa-button id="send" variant="brand" ?loading=${this.loading} @click=${this.send}>
              <wa-icon name="play" label="Send"></wa-icon>
            </wa-button>
            <wa-tooltip for="send">Send (${sendShortcut})</wa-tooltip>
            <wa-button id="save" appearance="plain" @click=${this.openSave}>
              <wa-icon name="floppy-disk" label="Save request"></wa-icon>
            </wa-button>
            <wa-tooltip for="save">Save request</wa-tooltip>
            ${isQuery(op)
        ? html`
                <wa-switch id="auto-send" size="s" .checked=${this.autoSend} @change=${this.toggleAutoSend}>
                  Auto
                </wa-switch>
                <wa-tooltip for="auto-send">
                  Send automatically when an endpoint or saved request is selected, a value action is
                  used or a field is cleared${this.authenticated ? "" : " (only when logged in)"}
                </wa-tooltip>
              `
        : null}
          </div>

          ${this.renderGroup("Path parameters", pathParams)}
          ${this.renderGroup("Query parameters", other, odataEndpoint || odata.length ? undefined : chips)}
          ${odataEndpoint || odata.length
        ? html`
                <wa-details
                  summary="OData"
                  ?open=${this.odataOpen}
                  @wa-show=${this.onOdataToggle}
                  @wa-hide=${this.onOdataToggle}
                >
                  ${firstRow.length
            ? html`<div class="first-row">${firstRow.map((p) => this.renderParam(p))}</div>`
            : null}
                  ${restOdata.length
            ? html`<div class="params">${restOdata.map((p) => this.renderParam(p))}</div>`
            : null}
                  ${pair.length
            ? html`<div class="pair">${pair.map((p) => this.renderParam(p))}</div>`
            : null}
                  ${chips}
                </wa-details>
              `
        : null}
          ${this.renderBody(op)}
          ${this.error ? html`<wa-callout variant="danger">${this.error}</wa-callout>` : null}
          <response-view
            .result=${this.result}
            ?loading=${this.loading}
            ?paging=${isQuery(op)}
            .actionsFor=${this.actionsFor}
            @value-action=${this.onValueAction}
            @next-page=${(e: CustomEvent<string>) => this.nextPage(e.detail)}
            .chartPreset=${this.loadedQuery?.chart?.config}
            ?publishable=${isQuery(op)}
            @chart-publish=${this.openPublish}
          ></response-view>
          </div>
        </wa-tab-panel>

        <wa-tab-panel name="model">
          <model-view .spec=${this.spec} .operation=${op}></model-view>
        </wa-tab-panel>
      </wa-tab-group>
      ${this.renderSaveDialog()}
      ${this.renderPublishDialog()}
      ${this.renderConfirmDialog()}
      ${this.renderTokenMenu()}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "request-editor": RequestEditor
  }
}
