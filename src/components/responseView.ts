import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, query, state } from "lit/decorators.js"
import { formatDateTime } from "../format.js"
import type { ResponseResult } from "../request/request.js"
import { getRows, type ChartConfig } from "../chart/rows.js"
import type { JsonView } from "./jsonView.js"
import "./chartView.js"
import "./jsonView.js"

function formatBytes(bytes: number) {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Number of rows in a page: plain arrays ($apply) or OData { value: [...] } wrappers */
function getRowCount(body: unknown): { rows: number; total?: number } | undefined {
  if (Array.isArray(body))
    return { rows: body.length }
  if (typeof body === "object" && body !== null && "value" in body && Array.isArray(body.value)) {
    const total = (body as Record<string, unknown>)["@odata.count"]
    return { rows: body.value.length, total: typeof total === "number" ? total : undefined }
  }
  return undefined
}

/**
 * Shows the response of a request of any method: raw JSON, or a chart when it holds rows
 */
@customElement("response-view")
export class ResponseView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-s);
      min-height: 0;
    }
    .meta {
      display: flex;
      align-items: center;
      gap: var(--wa-space-m);
      /* room for the arrival flash */
      padding: var(--wa-space-2xs) var(--wa-space-xs);
      border-radius: var(--wa-border-radius-m);
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .waiting {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      color: var(--wa-color-brand-on-quiet);
    }
    wa-spinner {
      font-size: var(--wa-font-size-m);
    }
    /* the previous response stays visible, faded, until the new one arrives */
    .meta ~ * {
      transition: opacity 150ms;
    }
    :host([loading]) .meta ~ * {
      opacity: 0.5;
    }
    .meta wa-switch {
      white-space: nowrap;
    }
    .received {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
    }
    pre {
      margin: 0;
      padding: var(--wa-space-m);
      overflow: auto;
      background: var(--wa-color-surface-lowered);
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-s);
      line-height: 1.4;
    }
  `

  @property({ attribute: false })
  result?: ResponseResult

  /** Offer "Next page" for an @odata.nextLink; only reads are paged */
  @property({ type: Boolean })
  paging = false

  /** Passed on to the JSON view: actions for the value under the cursor */
  /** A request is in flight: show a spinner in the status row */
  @property({ type: Boolean, reflect: true })
  loading = false

  @property({ attribute: false })
  actionsFor?: JsonView["actionsFor"]

  @query(".meta")
  private meta?: HTMLElement

  /** Chart settings to start from (a saved query's published chart); switches to the chart */
  @property({ attribute: false })
  chartPreset?: ChartConfig

  /** The chart offers to publish itself (emits "chart-publish") */
  @property({ type: Boolean })
  publishable = false

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("chartPreset") && this.chartPreset)
      this.chart = true
  }

  /** Show rows as a chart instead of JSON; kept for the next responses */
  @state()
  private chart = false

  /** Flash the status row when a response arrives, also when it equals the previous one */
  protected updated(changed: PropertyValues<this>) {
    if (!changed.has("result") || !this.result || !this.meta)
      return
    const color = this.result.ok ? "var(--wa-color-success-fill-loud)" : "var(--wa-color-danger-fill-loud)"
    const tint = (percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.meta.animate(
      reduceMotion
        ? [{ backgroundColor: tint(35) }, { backgroundColor: "transparent" }]
        : [
            // the row lights up in the status color, a ring spreads out and everything fades
            { backgroundColor: tint(40), boxShadow: `0 0 0 0 ${tint(70)}` },
            { backgroundColor: tint(25), boxShadow: `0 0 0 0.35em ${tint(40)}`, offset: 0.35 },
            { backgroundColor: "transparent", boxShadow: "0 0 0 0.7em transparent" },
          ],
      { duration: 900, easing: "ease-out" },
    )
  }

  render() {
    const result = this.result
    const waiting = this.loading
      ? html`<span class="waiting"><wa-spinner></wa-spinner> Waiting for response…</span>`
      : null
    if (!result)
      return waiting ? html`<div class="meta">${waiting}</div>` : null

    const count = getRowCount(result.body)
    const rows = getRows(result.body)
    const showChart = this.chart && !!rows
    const body = result.body as Record<string, unknown> | undefined
    const link = body?.["@odata.nextLink"]
    const nextLink = this.paging && typeof link === "string" ? link : undefined
    const text =
      typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)
    return html`
      <div class="meta">
        ${waiting}
        <wa-badge variant=${result.ok ? "success" : "danger"}>
          ${result.status} ${result.statusText}
        </wa-badge>
        ${count
          ? html`<span>
              ${count.rows} ${count.rows === 1 ? "row" : "rows"}
              ${count.total !== undefined ? html`of ${count.total}` : null}
            </span>`
          : null}
        ${nextLink
          ? html`<wa-button
              size="s"
              appearance="outlined"
              title=${nextLink}
              @click=${() =>
                this.dispatchEvent(new CustomEvent("next-page", { detail: nextLink, bubbles: true, composed: true }))}
            >
              Next page
              <wa-icon slot="end" name="arrow-right"></wa-icon>
            </wa-button>`
          : null}
        <span>${Math.round(result.durationMs)} ms</span>
        <span>${formatBytes(result.sizeBytes)}</span>
        <span class="received" title="Response received">${formatDateTime(result.receivedAt)}</span>
        <wa-copy-button .value=${text} copy-label="Copy response"></wa-copy-button>
        ${rows
          ? html`<wa-switch
              size="s"
              title="Show the rows as a chart"
              .checked=${this.chart}
              @change=${(e: Event) => (this.chart = (e.target as HTMLInputElement).checked)}
            >
              Chart
            </wa-switch>`
          : null}
      </div>
      ${result.status === 401
        ? html`<wa-callout variant="warning">Unauthorized. Log in and try again.</wa-callout>`
        : null}
      ${showChart
        ? html`<chart-view .rows=${rows!} .preset=${this.chartPreset} ?publishable=${this.publishable}></chart-view>`
        : typeof result.body === "object" && result.body !== null
          ? html`<json-view .text=${text} .actionsFor=${this.actionsFor}></json-view>`
          : text
            ? html`<pre>${text}</pre>`
            : null}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "response-view": ResponseView
  }
}
