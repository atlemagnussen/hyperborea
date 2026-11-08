import type * as HighchartsTypes from "highcharts"
import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, query, state } from "lit/decorators.js"
import { buildOptions, type ChartTheme } from "../chart/options.js"
import {
  chartSpecs,
  fitConfig,
  fitType,
  getColumns,
  rowCountKey,
  type ChartConfig,
  type ChartType,
  type Column,
  type Row,
} from "../chart/rows.js"

type Highcharts = typeof HighchartsTypes

// Highcharts is loaded on first use, it is not needed until a chart is shown
let highcharts: Promise<Highcharts> | undefined
function loadHighcharts() {
  highcharts ??= (async () => {
    const { default: Highcharts } = await import("highcharts/esm/highcharts.js")
    await Promise.all([
      import("highcharts/esm/modules/heatmap.js"),
      import("highcharts/esm/modules/treemap.js"),
      import("highcharts/esm/modules/accessibility.js"),
    ])
    return Highcharts as unknown as Highcharts
  })()
  return highcharts
}

// the last config per set of columns, so the same query keeps its chart while the app is open
const configs = new Map<string, ChartConfig>()

const stackings: { value: ChartConfig["stacking"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "normal", label: "Stacked" },
  { value: "percent", label: "100%" },
]

const sorts: { value: ChartConfig["sort"]; label: string }[] = [
  { value: "none", label: "X order" },
  { value: "desc", label: "Largest first" },
  { value: "asc", label: "Smallest first" },
]

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** Chart of response rows: pick a chart type, then the fields it needs */
@customElement("chart-view")
export class ChartView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-s);
      min-height: 0;
    }
    .config {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--wa-space-s);
    }
    .config wa-select {
      min-width: 9em;
      flex: 1 1 10em;
      max-width: 20em;
    }
    .config wa-select.y {
      flex-grow: 2;
      max-width: 28em;
    }
    .config wa-select.narrow {
      flex: 0 1 11em;
      min-width: 8em;
    }
    .config .publish {
      margin-left: auto;
    }
    .tiles {
      display: flex;
      flex-wrap: wrap;
      gap: var(--wa-space-m);
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-2xs);
      min-width: 10em;
      padding: var(--wa-space-m) var(--wa-space-l);
      background: var(--wa-color-surface-default);
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
    }
    .tile .label {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .tile .value {
      color: var(--wa-color-text-normal);
      font-size: var(--wa-font-size-3xl);
      font-weight: var(--wa-font-weight-semibold);
      line-height: 1.1;
    }
    .note {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .chart {
      flex: 1;
      min-height: 320px;
      padding: var(--wa-space-s);
      background: var(--wa-color-surface-default);
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
    }
  `

  @property({ attribute: false })
  rows: Row[] = []

  /** Settings to start from, e.g. of a published chart */
  @property({ attribute: false })
  preset?: ChartConfig

  /** Only the chart, no settings: the published chart page */
  @property({ type: Boolean })
  readonly = false

  /** Offer to publish the chart (emits "chart-publish" with the settings) */
  @property({ type: Boolean })
  publishable = false

  @state()
  private config?: ChartConfig

  @query(".chart")
  private container?: HTMLDivElement

  private columns: Column[] = []
  private chart?: HighchartsTypes.Chart
  private resizeObserver = new ResizeObserver(() => this.chart?.reflow())
  // the theme is a class on <html>: redraw in the other mode's colors
  private themeObserver = new MutationObserver(() => this.draw())

  connectedCallback() {
    super.connectedCallback()
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.themeObserver.disconnect()
    this.resizeObserver.disconnect()
    this.chart?.destroy()
    this.chart = undefined
  }

  private get signature() {
    return this.columns.map((c) => c.key).sort().join(",")
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("rows")) {
      this.columns = getColumns(this.rows)
      this.config = fitConfig(this.config ?? configs.get(this.signature), this.columns)
    }
    if (changed.has("preset") && this.preset && this.columns.length)
      this.config = fitConfig(this.preset, this.columns)
  }

  protected updated() {
    if (!this.container) {
      // big numbers instead of a chart
      this.chart?.destroy()
      this.chart = undefined
      return
    }
    this.resizeObserver.observe(this.container)
    this.draw()
  }

  private set(change: Partial<ChartConfig>) {
    this.config = fitType({ ...this.config!, ...change }, this.columns)
    configs.set(this.signature, this.config)
  }

  private get theme(): ChartTheme {
    const style = getComputedStyle(this)
    const token = (name: string) => style.getPropertyValue(name).trim()
    return {
      dark: document.documentElement.classList.contains("wa-dark"),
      text: token("--wa-color-text-normal"),
      quiet: token("--wa-color-text-quiet"),
      grid: token("--wa-color-surface-border"),
      surface: token("--wa-color-surface-default"),
      raised: token("--wa-color-surface-raised"),
      font: token("--wa-font-family-body"),
    }
  }

  private async draw() {
    const config = this.config
    const container = this.container
    if (!config || !container || !config.x)
      return
    const Highcharts = await loadHighcharts()
    // a newer draw may have started while loading
    if (config !== this.config || !this.isConnected)
      return
    const { options } = buildOptions(this.rows, this.columns, config, this.theme)
    this.chart?.destroy()
    this.chart = Highcharts.chart(container, options)
  }

  render() {
    const config = this.config
    if (!config)
      return null
    const numbers = this.columns.filter((c) => c.kind === "number")
    if (this.rows.length === 1 && numbers.length)
      return this.renderTiles(numbers)
    const spec = chartSpecs[config.type]
    const { notes } = buildOptions(this.rows, this.columns, config, this.theme)
    if (this.readonly)
      return html`
        ${notes.length ? html`<div class="note">${notes.join(" ")}</div>` : null}
        <div class="chart"></div>
      `
    const value = (e: Event) => (e.target as HTMLSelectElement & { value: string | string[] }).value
    const xKind = this.columns.find((c) => c.key === config.x)?.kind
    const timeAxis = xKind === "date" && (config.type === "line" || config.type === "area")
    const xColumns = this.columns.filter((c) => !spec.xKinds || spec.xKinds.includes(c.kind))
    const yColumns = numbers.filter((c) => c.key !== config.x)
    const splitColumns = this.columns.filter((c) => c.kind !== "number" && c.key !== config.x)
    // stacking needs several series: several Y fields or a split
    const stackable = spec.stacking && (config.y.length > 1 || !!config.splitBy)
    return html`
      <div class="config">
        <wa-select
          class="narrow"
          size="s"
          label="Chart"
          title=${spec.info}
          .value=${config.type}
          @change=${(e: Event) => this.set({ type: value(e) as ChartType })}
        >
          ${Object.entries(chartSpecs).map(
            ([type, s]) => html`<wa-option value=${type} title=${s.info}>${s.label}</wa-option>`,
          )}
        </wa-select>
        <wa-select
          size="s"
          label=${spec.x}
          title=${spec.xKinds ? "A number or date field" : "Categories along the axis"}
          .value=${config.x}
          @change=${(e: Event) => this.set({ x: value(e) as string })}
        >
          ${xColumns.map((c) => html`<wa-option value=${c.key}>${c.key}</wa-option>`)}
        </wa-select>
        ${spec.multiY
          ? html`
              <wa-select
                class="y"
                size="s"
                label=${spec.y}
                title="Number fields to plot, rows with the same X are summed"
                multiple
                max-options-visible="3"
                .value=${config.y}
                @change=${(e: Event) => {
                  const y = value(e) as string[]
                  if (y.length)
                    this.set({ y })
                }}
              >
                <wa-option value=${rowCountKey}>Number of rows</wa-option>
                ${yColumns.map((c) => html`<wa-option value=${c.key}>${c.key}</wa-option>`)}
              </wa-select>
            `
          : html`
              <wa-select
                size="s"
                label=${spec.y}
                title="Number field; rows with the same group are summed"
                .value=${config.y[0] ?? ""}
                @change=${(e: Event) => this.set({ y: [value(e) as string] })}
              >
                ${spec.rowCount ? html`<wa-option value=${rowCountKey}>Number of rows</wa-option>` : null}
                ${yColumns.map((c) => html`<wa-option value=${c.key}>${c.key}</wa-option>`)}
              </wa-select>
            `}
        ${spec.split
          ? html`
              <wa-select
                size="s"
                label=${spec.split}
                title=${spec.splitRequired ? "The second field to group by" : "One series per value of this field"}
                placeholder="(none)"
                ?with-clear=${!spec.splitRequired}
                .value=${config.splitBy ?? ""}
                @change=${(e: Event) => this.set({ splitBy: (value(e) as string) || undefined })}
              >
                ${splitColumns.map((c) => html`<wa-option value=${c.key}>${c.key}</wa-option>`)}
              </wa-select>
            `
          : null}
        ${spec.stacking
          ? html`
              <wa-select
                class="narrow"
                size="s"
                label="Stacking"
                title="Stack the series; 100% shows each series' share of the category"
                ?disabled=${!stackable}
                .value=${config.stacking}
                @change=${(e: Event) => this.set({ stacking: value(e) as ChartConfig["stacking"] })}
              >
                ${stackings.map((o) => html`<wa-option value=${o.value}>${o.label}</wa-option>`)}
              </wa-select>
            `
          : null}
        ${spec.sort && !timeAxis
          ? html`
              <wa-select
                class="narrow"
                size="s"
                label="Sort"
                title="Order of the categories: by X, or by their total"
                .value=${config.sort}
                @change=${(e: Event) => this.set({ sort: value(e) as ChartConfig["sort"] })}
              >
                ${sorts.map((o) => html`<wa-option value=${o.value}>${o.label}</wa-option>`)}
              </wa-select>
            `
          : null}
        ${this.publishable
          ? html`
              <wa-button
                class="publish"
                size="s"
                appearance="outlined"
                title="Show this chart on its own page, e.g. on a screen"
                @click=${() =>
                  this.dispatchEvent(new CustomEvent("chart-publish", { detail: config, bubbles: true, composed: true }))}
              >
                <wa-icon slot="start" name="share-nodes"></wa-icon>
                Publish
              </wa-button>
            `
          : null}
      </div>
      ${notes.length ? html`<div class="note">${notes.join(" ")}</div>` : null}
      <div class="chart"></div>
    `
  }

  /** One row (e.g. aggregate without groupby): its numbers as big figures, the text as context */
  private renderTiles(numbers: Column[]) {
    const row = this.rows[0]
    const context = this.columns
      .filter((c) => c.kind !== "number" && row[c.key] !== null && row[c.key] !== undefined)
      .map((c) => `${c.key}: ${row[c.key]}`)
      .join(" · ")
    return html`
      ${context ? html`<div class="note">${context}</div>` : null}
      <div class="tiles">
        ${numbers.map((c) => {
          const value = row[c.key]
          return html`
            <div class="tile">
              <span class="label">${c.key}</span>
              <span class="value">${typeof value === "number" ? numberFormat.format(value) : "–"}</span>
            </div>
          `
        })}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chart-view": ChartView
  }
}
