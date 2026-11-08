/** A value column found in the response rows, nested objects flattened to paths like parent/name */
export interface Column {
  key: string
  /** number: all values are numbers; date: ISO dates; else text categories */
  kind: "number" | "date" | "text"
}

export type Row = Record<string, unknown>

/** Pseudo column for Y: the number of rows per X value */
export const rowCountKey = "#rows"

/** The rows of a response: a plain array ($apply) or the OData { value: [...] } wrapper */
export function getRows(body: unknown): Row[] | undefined {
  const rows = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && "value" in body && Array.isArray(body.value)
      ? body.value
      : undefined
  if (!rows?.length || !rows.every((r) => typeof r === "object" && r !== null && !Array.isArray(r)))
    return undefined
  return rows.map((r) => flatten(r as Row))
}

function flatten(row: Row, prefix = "", out: Row = {}): Row {
  for (const [key, value] of Object.entries(row)) {
    // OData annotations like @odata.etag are not data
    if (key.includes("@") || Array.isArray(value))
      continue
    if (typeof value === "object" && value !== null)
      flatten(value as Row, `${prefix}${key}/`, out)
    else
      out[prefix + key] = value
  }
  return out
}

const isoDate = /^\d{4}-\d{2}-\d{2}(T|$)/

export function getColumns(rows: Row[]): Column[] {
  const keys: string[] = []
  for (const row of rows)
    for (const key of Object.keys(row))
      if (!keys.includes(key))
        keys.push(key)
  // a related object that is null in some rows (parent: null) is not a column of its own
  return keys.filter((key) => !keys.some((k) => k.startsWith(`${key}/`))).map((key) => {
    const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined)
    const kind = values.length && values.every((v) => typeof v === "number")
      ? "number"
      : values.length && values.every((v) => typeof v === "string" && isoDate.test(v))
        ? "date"
        : "text"
    return { key, kind }
  })
}

export type ChartType = "column" | "bar" | "line" | "area" | "heatmap" | "pareto" | "treemap" | "scatter"

/** What a chart type needs from the config, and what the controls are called for it */
export interface ChartSpec {
  label: string
  info: string
  /** Label of the X control */
  x: string
  /** Kinds X may have; any when missing */
  xKinds?: Column["kind"][]
  /** Label of the Y control */
  y: string
  /** Several Y columns, else one */
  multiY: boolean
  /** "Number of rows" may be the Y */
  rowCount: boolean
  /** Label of the split control; no split when missing */
  split?: string
  /** The chart needs a split field (heatmap: the second grouping field) */
  splitRequired?: boolean
  stacking: boolean
  sort: boolean
}

const categorySpec = {
  x: "X",
  y: "Y",
  multiY: true,
  rowCount: true,
  split: "Split by",
  sort: true,
} as const

export const chartSpecs: Record<ChartType, ChartSpec> = {
  column: { ...categorySpec, label: "Column", info: "Compare values per category", stacking: true },
  bar: { ...categorySpec, label: "Bar", info: "Like column, room for long category names", stacking: true },
  line: { ...categorySpec, label: "Line", info: "Trend; dates on X get a time axis", stacking: false },
  area: { ...categorySpec, label: "Area", info: "Trend with volume; stack to show the parts", stacking: true },
  heatmap: {
    label: "Heatmap",
    info: "Two grouping fields as a grid, the color shows the value",
    x: "X",
    y: "Value",
    multiY: false,
    rowCount: true,
    split: "Y",
    splitRequired: true,
    stacking: false,
    sort: true,
  },
  pareto: {
    label: "Pareto",
    info: "Largest first with the running total: the few that make up most",
    x: "Category",
    y: "Value",
    multiY: false,
    rowCount: true,
    stacking: false,
    sort: false,
  },
  treemap: {
    label: "Treemap",
    info: "Share of the whole as areas, optionally one level nested",
    x: "Group",
    y: "Size",
    multiY: false,
    rowCount: true,
    split: "Subgroup",
    stacking: false,
    sort: false,
  },
  scatter: {
    label: "Scatter",
    info: "One dot per row: two numbers against each other",
    x: "X",
    xKinds: ["number", "date"],
    y: "Y",
    multiY: false,
    rowCount: false,
    split: "Color by",
    stacking: false,
    sort: false,
  },
}

export interface ChartConfig {
  type: ChartType
  x: string
  /** Numeric columns, or rowCountKey */
  y: string[]
  /** Optional column whose values become separate series */
  splitBy?: string
  /** Stacked bars show totals, percent shows each series' share of the category */
  stacking: "none" | "normal" | "percent"
  /** Order categories by their total (all series together); none keeps the X order */
  sort: "none" | "desc" | "asc"
}

const isId = (c: Column) => /(^|\/)id$/i.test(c.key)

/**
 * Sensible first choice: a text column along X, a number (not an id) up the Y axis. The last
 * number, since $apply returns the grouped fields first and the aggregates after them
 */
export function defaultConfig(columns: Column[]): ChartConfig {
  const x = columns.find((c) => c.kind !== "number" && !isId(c)) ?? columns.find((c) => !isId(c)) ?? columns[0]
  const y = columns.findLast((c) => c.kind === "number" && c !== x && !isId(c))
  return { type: "column", x: x?.key ?? "", y: [y?.key ?? rowCountKey], stacking: "none", sort: "none" }
}

/** Keeps the parts of a previous config that still exist in the columns, defaults for the rest */
export function fitConfig(config: ChartConfig | undefined, columns: Column[]): ChartConfig {
  const fallback = defaultConfig(columns)
  if (!config)
    return fallback
  if (!(config.type in chartSpecs))
    config = { ...config, type: fallback.type }
  const has = (key: string) => columns.some((c) => c.key === key)
  const y = config.y.filter((k) => k === rowCountKey || columns.some((c) => c.key === k && c.kind === "number"))
  return fitType({
    type: config.type,
    x: has(config.x) ? config.x : fallback.x,
    y: y.length ? y : fallback.y,
    splitBy: config.splitBy && has(config.splitBy) ? config.splitBy : undefined,
    stacking: config.stacking,
    sort: config.sort,
  }, columns)
}

/** Makes a config fit its chart type, e.g. after switching type: number X for scatter, one Y, ... */
export function fitType(config: ChartConfig, columns: Column[]): ChartConfig {
  const spec = chartSpecs[config.type]
  let { x, y, splitBy } = config
  const kindOf = (key: string) => columns.find((c) => c.key === key)?.kind
  if (spec.xKinds && !spec.xKinds.includes(kindOf(x)!)) {
    const allowed = columns.filter((c) => spec.xKinds!.includes(c.kind))
    x = (allowed.find((c) => !isId(c)) ?? allowed[0])?.key ?? x
  }
  y = y.filter((k) => k !== x && (spec.rowCount || k !== rowCountKey))
  if (!y.length) {
    const number = columns.findLast((c) => c.kind === "number" && c.key !== x && !isId(c))
    y = number ? [number.key] : spec.rowCount ? [rowCountKey] : []
  }
  if (!spec.multiY)
    y = y.slice(0, 1)
  if (!spec.split || splitBy === x)
    splitBy = undefined
  if (spec.splitRequired && !splitBy)
    splitBy = columns.find((c) => c.kind !== "number" && c.key !== x && !isId(c))?.key
  return { ...config, x, y, splitBy }
}

export interface ChartData {
  categories: string[]
  series: { name: string; data: (number | null)[] }[]
  /** Rows sharing an X (and split) value were summed */
  combined: boolean
  /** Number of split values folded into "Other" */
  folded: number
}

/** Categorical colors are capped at 8; more split values fold into Other */
export const maxSeries = 8

/** Turns rows into categories and series: one series per Y column, times the split values */
export function toChartData(rows: Row[], columns: Column[], config: ChartConfig, seriesLimit = maxSeries): ChartData {
  const xColumn = columns.find((c) => c.key === config.x)
  // numbers and dates read in order; text keeps the response order (its $orderby)
  const ordered = xColumn?.kind === "number" || xColumn?.kind === "date"
    ? [...rows].sort((a, b) => compare(a[config.x], b[config.x]))
    : rows
  const categories = [...new Set(ordered.map((r) => label(r[config.x])))]
  const index = new Map(categories.map((c, i) => [c, i]))

  let groups = config.splitBy ? [...new Set(rows.map((r) => label(r[config.splitBy!])))] : [""]
  // the largest groups keep their own series, the rest fold into Other
  let folded = 0
  const perGroup = Math.max(1, config.y.length)
  if (groups.length * perGroup > seriesLimit) {
    const keep = Math.max(1, Math.floor(seriesLimit / perGroup) - 1)
    const totals = new Map(groups.map((g) => [g, 0]))
    for (const row of rows)
      totals.set(label(row[config.splitBy!]), totals.get(label(row[config.splitBy!]))! + Math.abs(valueOf(row, config.y[0])))
    const sorted = [...groups].sort((a, b) => totals.get(b)! - totals.get(a)!)
    folded = groups.length - keep
    groups = [...groups.filter((g) => sorted.slice(0, keep).includes(g)), "Other"]
  }

  const series: ChartData["series"] = []
  const slot = new Map<string, (number | null)[]>()
  for (const group of groups)
    for (const y of config.y) {
      const data: (number | null)[] = categories.map(() => null)
      const yName = y === rowCountKey ? "Rows" : y
      const name = config.splitBy ? (config.y.length > 1 ? `${group} · ${yName}` : group) : yName
      series.push({ name, data })
      slot.set(`${group}\u0000${y}`, data)
    }

  let combined = false
  const seen = new Set<string>()
  for (const row of rows) {
    let group = config.splitBy ? label(row[config.splitBy]) : ""
    if (!groups.includes(group))
      group = "Other"
    const category = index.get(label(row[config.x]))!
    const key = `${group}\u0000${category}`
    if (seen.has(key))
      combined = true
    seen.add(key)
    for (const y of config.y) {
      const data = slot.get(`${group}\u0000${y}`)!
      const value = y === rowCountKey ? 1 : row[y]
      if (typeof value === "number")
        data[category] = (data[category] ?? 0) + value
    }
  }
  if (config.sort !== "none") {
    // by total of all series in the category, largest or smallest first
    const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0))
    const direction = config.sort === "desc" ? -1 : 1
    const order = categories.map((_, i) => i).sort((a, b) => direction * (totals[a] - totals[b]))
    return {
      categories: order.map((i) => categories[i]),
      series: series.map((s) => ({ ...s, data: order.map((i) => s.data[i]) })),
      combined: combined && !config.y.includes(rowCountKey),
      folded,
    }
  }
  return { categories, series, combined: combined && !config.y.includes(rowCountKey), folded }
}

/**
 * Time of an ISO date as milliseconds, for a time axis. Dates are UTC midnight; timestamps keep
 * their local wall clock, since Highcharts shows times in UTC
 */
export function toTime(value: unknown): number | null {
  if (typeof value !== "string")
    return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return Date.parse(`${value}T00:00:00Z`)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.getTime() - date.getTimezoneOffset() * 60_000
}

export function label(value: unknown) {
  return value === null || value === undefined || value === "" ? "(empty)" : String(value)
}

function valueOf(row: Row, y: string) {
  const value = y === rowCountKey ? 1 : row[y]
  return typeof value === "number" ? value : 0
}

function compare(a: unknown, b: unknown) {
  if (a === b)
    return 0
  if (a === null || a === undefined)
    return 1
  if (b === null || b === undefined)
    return -1
  return (a as number | string) < (b as number | string) ? -1 : 1
}
