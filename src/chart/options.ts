import type * as Highcharts from "highcharts"
import {
  label,
  maxSeries,
  rowCountKey,
  toChartData,
  toTime,
  type ChartConfig,
  type ChartData,
  type Column,
  type Row,
} from "./rows.js"

/**
 * Categorical colors in a fixed order (validated for color vision deficiencies), with steps
 * for the light and the dark surface. Swap for the product palette when one passes the checks.
 */
const palette = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
}

/** One blue from near the surface (low) to strong (high), for the heatmap */
const sequential = {
  light: { min: "#cde2fb", max: "#0d366b" },
  dark: { min: "#104281", max: "#b7d3f6" },
}

/** Scatter colors every pair of dots against each other, only the first three stay apart */
const maxScatterGroups = 3

/** Colors and fonts of the page, read from the WebAwesome tokens */
export interface ChartTheme {
  dark: boolean
  text: string
  quiet: string
  grid: string
  surface: string
  raised: string
  font: string
}

export interface ChartResult {
  options: Highcharts.Options
  /** Things the reader should know, e.g. that rows were summed */
  notes: string[]
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function yName(y: string) {
  return y === rowCountKey ? "Rows" : y
}

export function buildOptions(rows: Row[], columns: Column[], config: ChartConfig, theme: ChartTheme): ChartResult {
  const result = (() => {
    switch (config.type) {
      case "heatmap":
        return heatmap(rows, columns, config, theme)
      case "pareto":
        return pareto(rows, columns, config, theme)
      case "treemap":
        return treemap(rows, columns, config, theme)
      case "scatter":
        return scatter(rows, columns, config, theme)
      default:
        return categories(rows, columns, config, theme)
    }
  })()
  return { options: merge(base(theme), result.options), notes: result.notes }
}

/** Shallow merge per top level option, enough for the options built here */
function merge(a: Highcharts.Options, b: Highcharts.Options): Highcharts.Options {
  const out: Record<string, unknown> = { ...a }
  for (const [key, value] of Object.entries(b)) {
    const current = out[key]
    out[key] = isPlain(current) && isPlain(value) ? { ...current, ...value } : value
  }
  return out as Highcharts.Options
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function base(theme: ChartTheme): Highcharts.Options {
  return {
    chart: { backgroundColor: "transparent", style: { fontFamily: theme.font }, animation: false },
    colors: theme.dark ? palette.dark : palette.light,
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      itemStyle: { color: theme.text, fontWeight: "normal" },
      itemHoverStyle: { color: theme.text },
      itemHiddenStyle: { color: theme.quiet },
    },
    tooltip: {
      backgroundColor: theme.raised,
      borderColor: theme.grid,
      style: { color: theme.text },
    },
    plotOptions: {
      // object points beyond 1000 need this, scatter has one per row
      series: { animation: false, turboThreshold: 0 },
    },
  }
}

function axis(theme: ChartTheme, title: string | undefined, extra: Highcharts.XAxisOptions = {}): Highcharts.XAxisOptions {
  return {
    title: { text: title, style: { color: theme.quiet } },
    labels: { style: { color: theme.quiet } },
    lineColor: theme.grid,
    tickColor: theme.grid,
    gridLineColor: theme.grid,
    ...extra,
  }
}

function summaryNotes(data: ChartData, seriesLimit = maxSeries) {
  const notes: string[] = []
  if (data.combined)
    notes.push("Rows with the same X are summed.")
  if (data.folded)
    notes.push(`The ${data.folded} smallest of the split values are summed into Other (max ${seriesLimit} series).`)
  return notes
}

/** Thin bars with rounded ends; stacked segments separated by a line in the surface color */
function bars(theme: ChartTheme, stacked: boolean) {
  return {
    borderWidth: stacked ? 2 : 0,
    borderColor: theme.surface,
    borderRadius: 4,
    pointPadding: 0.05,
    groupPadding: 0.12,
    maxPointWidth: 64,
  }
}

/** Column, bar, line and area; line and area get a time axis when X holds dates */
function categories(rows: Row[], columns: Column[], config: ChartConfig, theme: ChartTheme) {
  const type = config.type as "column" | "bar" | "line" | "area"
  const xKind = columns.find((c) => c.key === config.x)?.kind
  const timeAxis = xKind === "date" && (type === "line" || type === "area")
  const data = toChartData(rows, columns, timeAxis ? { ...config, sort: "none" } : config)
  const several = data.series.length > 1
  const stackable = type !== "line" && several
  const stacking = stackable && config.stacking !== "none" ? config.stacking : undefined
  const percent = stacking === "percent"
  const yTitle = percent
    ? "Share"
    : config.y.length === 1 && !config.splitBy
      ? yName(config.y[0])
      : undefined
  const times = timeAxis ? data.categories.map(toTime) : []
  const dateOnly = data.categories.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c))

  const series = data.series.map((s): Highcharts.SeriesOptionsType => ({
    type,
    name: s.name,
    data: timeAxis
      // missing values: a gap in a line would hide the trend; stacked areas need every point
      ? s.data.flatMap((v, i) => (times[i] === null ? [] : v === null ? (stacking ? [[times[i]!, 0]] : []) : [[times[i]!, v]]))
      : s.data,
  }))
  const options: Highcharts.Options = {
    chart: { type },
    // a single series is named by the Y axis title, more get a legend
    legend: { enabled: several },
    xAxis: timeAxis
      ? axis(theme, config.x, { type: "datetime" })
      : axis(theme, config.x, { categories: data.categories }),
    yAxis: {
      ...axis(theme, yTitle),
      labels: { style: { color: theme.quiet }, format: percent ? "{value}%" : undefined },
      gridLineWidth: 1,
      lineWidth: 0,
    } as Highcharts.YAxisOptions,
    tooltip: {
      shared: true,
      xDateFormat: dateOnly ? "%Y-%m-%d" : "%Y-%m-%d %H:%M",
      pointFormat: percent
        ? '<span style="color:{point.color}">●</span> {series.name}: <b>{point.y}</b> ({point.percentage:.0f}%)<br/>'
        : undefined,
    },
    plotOptions: {
      series: { animation: false, turboThreshold: 0, stacking },
      column: bars(theme, !!stacking),
      bar: bars(theme, !!stacking),
      line: { lineWidth: 2, marker: { radius: 4, symbol: "circle" } },
      area: { lineWidth: 2, fillOpacity: 0.25, marker: { radius: 3, symbol: "circle" } },
    },
    series,
  }
  const notes = summaryNotes(data)
  if (timeAxis && data.categories.length !== times.filter((t) => t !== null).length)
    notes.push("Some X values are not dates and are left out.")
  return { options, notes }
}

/** X by Y grid; the cell color is the value */
function heatmap(rows: Row[], columns: Column[], config: ChartConfig, theme: ChartTheme) {
  if (!config.splitBy)
    return { options: {}, notes: ["A heatmap needs a second field to group by (Y). Group by two fields in $apply."] }
  const data = toChartData(rows, columns, config, Infinity)
  // Y rows ordered like the X columns: by total when sorting, else in the order they came
  let order = data.series.map((_, i) => i)
  if (config.sort !== "none") {
    const totals = data.series.map((s) => s.data.reduce<number>((sum, v) => sum + (v ?? 0), 0))
    const direction = config.sort === "desc" ? -1 : 1
    order = order.sort((a, b) => direction * (totals[a] - totals[b]))
  }
  const points: [number, number, number][] = []
  order.forEach((s, y) =>
    data.series[s].data.forEach((value, x) => {
      if (value !== null)
        points.push([x, y, value])
    }),
  )
  const colors = theme.dark ? sequential.dark : sequential.light
  const options: Highcharts.Options = {
    chart: { type: "heatmap" },
    xAxis: axis(theme, config.x, { categories: data.categories, lineWidth: 0 }),
    yAxis: axis(theme, config.splitBy, {
      categories: order.map((s) => data.series[s].name),
      reversed: true,
      gridLineWidth: 0,
    }) as Highcharts.YAxisOptions,
    colorAxis: { min: 0, minColor: colors.min, maxColor: colors.max, labels: { style: { color: theme.quiet } } },
    legend: { enabled: true, align: "right", layout: "vertical", verticalAlign: "middle", symbolHeight: 200 },
    tooltip: {
      headerFormat: "",
      pointFormatter(this: Highcharts.Point & { value?: number | null }) {
        const x = data.categories[this.x]
        const y = data.series[order[this.y!]].name
        return `${x} · ${y}: <b>${numberFormat.format(this.value ?? 0)}</b>`
      },
    },
    series: [
      {
        type: "heatmap",
        name: yName(config.y[0]),
        data: points,
        borderWidth: 2,
        borderColor: theme.surface,
        borderRadius: 4,
        // values in the cells while they fit
        dataLabels: {
          enabled: points.length <= 150,
          style: { textOutline: "none", fontWeight: "normal" },
          formatter(this: Highcharts.Point & { value?: number | null }) {
            return numberFormat.format(this.value ?? 0)
          },
        },
      },
    ],
  }
  return { options, notes: summaryNotes(data) }
}

/**
 * Categories largest first with the running total. Bars show each category's share, so the
 * running total fits the same 0-100% axis (no second axis); the tooltip has the values
 */
function pareto(rows: Row[], columns: Column[], config: ChartConfig, theme: ChartTheme) {
  const data = toChartData(rows, columns, { ...config, splitBy: undefined, sort: "desc" })
  const values = data.series[0]?.data.map((v) => v ?? 0) ?? []
  const total = values.reduce((sum, v) => sum + v, 0)
  if (total <= 0)
    return { options: {}, notes: ["Nothing to show: the values add up to zero."] }
  let running = 0
  const shares = values.map((value) => ({ y: (value / total) * 100, value }))
  const cumulative = values.map((value) => {
    running += value
    return (running / total) * 100
  })
  const name = yName(config.y[0])
  const options: Highcharts.Options = {
    xAxis: axis(theme, config.x, { categories: data.categories }),
    yAxis: {
      ...axis(theme, `Share of ${name}`),
      labels: { style: { color: theme.quiet }, format: "{value}%" },
      max: 100,
      gridLineWidth: 1,
      plotLines: [
        {
          value: 80,
          color: theme.quiet,
          dashStyle: "Dash",
          width: 1,
          label: { text: "80%", align: "right", style: { color: theme.quiet } },
          zIndex: 3,
        },
      ],
    } as Highcharts.YAxisOptions,
    legend: { enabled: true },
    tooltip: { shared: true, valueDecimals: 1 },
    plotOptions: { column: bars(theme, false) },
    series: [
      {
        type: "column",
        name,
        data: shares,
        tooltip: { pointFormat: '<span style="color:{point.color}">●</span> {series.name}: <b>{point.value}</b> ({point.y:.1f}%)<br/>' },
      },
      {
        type: "line",
        name: "Running total",
        data: cumulative,
        lineWidth: 2,
        marker: { radius: 4, symbol: "circle" },
        tooltip: { pointFormat: '<span style="color:{point.color}">●</span> {series.name}: <b>{point.y:.1f}%</b><br/>' },
      },
    ],
  }
  return { options, notes: summaryNotes(data) }
}

/** Areas sized by the value: groups (colored) holding their subgroups */
function treemap(rows: Row[], columns: Column[], config: ChartConfig, theme: ChartTheme) {
  const data = toChartData(rows, columns, { ...config, sort: "none" }, Infinity)
  const totals = data.categories.map((_, i) => data.series.reduce((sum, s) => sum + Math.max(0, s.data[i] ?? 0), 0))
  // eight colors: the largest seven groups keep theirs, the rest fold into Other
  let groups = data.categories.map((_, i) => i).filter((i) => totals[i] > 0).sort((a, b) => totals[b] - totals[a])
  let folded: number[] = []
  if (groups.length > maxSeries) {
    folded = groups.slice(maxSeries - 1)
    groups = groups.slice(0, maxSeries - 1)
  }
  const colors = theme.dark ? palette.dark : palette.light
  const points: Highcharts.PointOptionsObject[] = []
  const add = (id: string, name: string, color: string, indexes: number[]) => {
    if (!config.splitBy) {
      points.push({ id, name, color, value: indexes.reduce((sum, i) => sum + totals[i], 0) })
      return
    }
    points.push({ id, name, color })
    data.series.forEach((s, g) => {
      const value = indexes.reduce((sum, i) => sum + Math.max(0, s.data[i] ?? 0), 0)
      if (value > 0)
        points.push({ id: `${id}/${g}`, parent: id, name: s.name, value })
    })
  }
  groups.forEach((i, n) => add(`g${i}`, data.categories[i], colors[n], [i]))
  if (folded.length)
    add("other", "Other", colors[maxSeries - 1], folded)

  const nested = !!config.splitBy
  const options: Highcharts.Options = {
    legend: { enabled: false },
    tooltip: {
      headerFormat: "",
      pointFormatter(this: Highcharts.Point & { value?: number | null; parent?: string }) {
        const parent = this.parent ? points.find((p) => p.id === this.parent)?.name : undefined
        return `${parent ? `${parent} · ` : ""}${this.name}: <b>${numberFormat.format(this.value ?? 0)}</b>`
      },
    },
    series: [
      {
        type: "treemap",
        name: yName(config.y[0]),
        layoutAlgorithm: "squarified",
        allowTraversingTree: nested,
        borderColor: theme.surface,
        borderWidth: 2,
        borderRadius: 4,
        data: points,
        dataLabels: { style: { textOutline: "none", fontWeight: "normal", color: "contrast" } },
        levels: nested
          ? [
              {
                level: 1,
                borderWidth: 4,
                dataLabels: {
                  enabled: true,
                  align: "left",
                  verticalAlign: "top",
                  style: { fontWeight: "bold", textOutline: "none", color: "contrast" },
                },
              },
              { level: 2, dataLabels: { enabled: true, style: { textOutline: "none", fontWeight: "normal" } } },
            ]
          : undefined,
        breadcrumbs: { style: { color: theme.text } },
      } as Highcharts.SeriesTreemapOptions,
    ],
  }
  const notes = summaryNotes({ ...data, folded: 0 })
  if (folded.length)
    notes.push(`The ${folded.length} smallest groups are summed into Other (max ${maxSeries} colors).`)
  if (nested)
    notes.push("Click a group to zoom in.")
  return { options, notes }
}

/** One dot per row with a number (or date) X and a number Y, colored by a field */
function scatter(rows: Row[], columns: Column[], config: ChartConfig, theme: ChartTheme) {
  const y = config.y[0]
  if (!y || y === rowCountKey)
    return { options: {}, notes: ["A scatter needs two number fields, e.g. two aggregates per group."] }
  const xDate = columns.find((c) => c.key === config.x)?.kind === "date"
  const text = columns.filter((c) => c.kind === "text" && c.key !== config.splitBy)
  // the rows' text fields name the dot, e.g. the grouped fields of an $apply
  const pointName = (row: Row) => text.map((c) => label(row[c.key])).join(" · ")

  let groups = config.splitBy ? [...new Set(rows.map((r) => label(r[config.splitBy!])))] : [""]
  let folded = 0
  if (groups.length > maxScatterGroups) {
    const counts = new Map<string, number>()
    for (const row of rows)
      counts.set(label(row[config.splitBy!]), (counts.get(label(row[config.splitBy!])) ?? 0) + 1)
    const keep = [...groups].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, maxScatterGroups - 1)
    folded = groups.length - keep.length
    groups = [...groups.filter((g) => keep.includes(g)), "Other"]
  }
  const byGroup = new Map(groups.map((g) => [g, [] as Highcharts.PointOptionsObject[]]))
  let skipped = 0
  for (const row of rows) {
    const x = xDate ? toTime(row[config.x]) : row[config.x]
    const value = row[y]
    if (typeof x !== "number" || typeof value !== "number") {
      skipped++
      continue
    }
    let group = config.splitBy ? label(row[config.splitBy]) : ""
    if (!byGroup.has(group))
      group = "Other"
    byGroup.get(group)!.push({ x, y: value, name: pointName(row) })
  }
  const xFormat = xDate ? "{point.x:%Y-%m-%d}" : "{point.x}"
  const options: Highcharts.Options = {
    chart: { type: "scatter", zooming: { type: "xy" } },
    legend: { enabled: groups.length > 1 },
    xAxis: axis(theme, config.x, { type: xDate ? "datetime" : "linear", gridLineWidth: 1 }),
    yAxis: { ...axis(theme, y), gridLineWidth: 1 } as Highcharts.YAxisOptions,
    tooltip: {
      headerFormat: "",
      pointFormat: `<b>{point.name}</b><br/>${config.x}: ${xFormat}<br/>${y}: {point.y}`,
    },
    series: groups.map((g) => ({
      type: "scatter",
      name: g || y,
      data: byGroup.get(g),
      // a ring in the surface color keeps overlapping dots apart
      marker: { radius: 4, symbol: "circle", lineWidth: 1, lineColor: theme.surface },
    })),
  }
  const notes: string[] = []
  if (folded)
    notes.push(`${folded} of the color values are combined into Other (max ${maxScatterGroups} colors).`)
  if (skipped)
    notes.push(`${skipped} rows without numbers are left out.`)
  return { options, notes }
}
