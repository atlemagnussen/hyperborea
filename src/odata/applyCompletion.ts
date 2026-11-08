import type { Field } from "../spec/fields.js"
import {
  completeFilter,
  valueTypeOf,
  type CompletionResult,
  type FilterContext,
  type Suggestion,
} from "./filterCompletion.js"

/**
 * Suggestions for $apply (OData data aggregation), e.g.
 * filter(level gt 1)/groupby((parent/name), aggregate($count as total))
 *
 * Transformations are separated by / and run in order on the rows of the response schema.
 * groupby, aggregate and compute change the rows, so later steps complete on the grouped fields
 * and the aliases defined so far. Expressions inside filter(...) and compute(...) reuse the
 * $filter rules.
 */
export function completeApply(textBeforeCursor: string, ctx: FilterContext): CompletionResult | null {
  let fields = ctx.fields
  for (const step of splitTop(textBeforeCursor, "/")) {
    const text = textBeforeCursor.slice(step.start, step.end)
    if (step.end < textBeforeCursor.length) {
      fields = fieldsAfter(text, fields, ctx)
      continue
    }
    return completeStep(text, step.start, { fields, fieldsOf: ctx.fieldsOf })
  }
  return null
}

// transformations supported by ASP.NET Core OData
const transformations: Record<string, { snippet: string; info: string }> = {
  filter: { snippet: "filter(${})", info: "Keep the rows matching a condition, like $filter" },
  groupby: {
    snippet: "groupby((${})${})",
    info: "One row per distinct combination of the fields, optionally with aggregate(...)",
  },
  aggregate: { snippet: "aggregate(${})", info: "One row of totals: field with sum as alias" },
  compute: { snippet: "compute(${})", info: "Add calculated fields: expression as alias" },
}

const methods: Record<string, string> = {
  sum: "Total of a number field",
  average: "Average of a number field",
  min: "Smallest value",
  max: "Largest value",
  countdistinct: "Number of distinct values",
}

interface Span {
  start: number
  end: number
}

/** Splits at separator outside parentheses and strings; the last span runs to the end */
function splitTop(text: string, separator: string): Span[] {
  const spans: Span[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0)
        break
      i = end
    } else if (c === "(")
      depth++
    else if (c === ")")
      depth--
    else if (c === separator && depth === 0) {
      spans.push({ start, end: i })
      start = i + 1
    }
  }
  spans.push({ start, end: text.length })
  return spans
}

/** Index of the ) matching the ( at open, skipping strings; -1 when not closed yet */
function findClose(text: string, open: number) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0)
        return -1
      i = end
    } else if (c === "(")
      depth++
    else if (c === ")" && --depth === 0)
      return i
  }
  return -1
}

function shift(result: CompletionResult | null, offset: number): CompletionResult | null {
  return result && { ...result, from: result.from + offset }
}

/** A field defined by the query (aggregate or compute alias) */
function aliasField(name: string, type: string, format?: string): Field {
  return { name, type, format, description: "Defined earlier in $apply" }
}

/** The fields of the rows after one transformation */
function fieldsAfter(step: string, fields: Field[], ctx: FilterContext): Field[] {
  const match = /^\s*(\w+)\s*\(/.exec(step)
  if (!match)
    return fields
  const open = match[0].length - 1
  const close = findClose(step, open)
  const inner = step.slice(open + 1, close < 0 ? undefined : close)
  switch (match[1].toLowerCase()) {
    case "aggregate":
      return aggregateAliases(inner, fields, ctx)
    case "compute":
      return [...fields, ...computeAliases(inner)]
    case "groupby": {
      // groupby((a, parent/name), aggregate(...)): the grouped fields keep their place in the row
      const listClose = inner.trimStart().startsWith("(") ? findClose(inner, inner.indexOf("(")) : -1
      if (listClose < 0)
        return fields
      const grouped = new Set(
        inner.slice(inner.indexOf("(") + 1, listClose).split(",").map((p) => p.trim().split("/")[0]),
      )
      const rest = inner.slice(listClose + 1)
      const agg = /aggregate\s*\(/.exec(rest)
      const aliases = agg
        ? aggregateAliases(rest.slice(agg.index + agg[0].length, findClose(rest, agg.index + agg[0].length - 1)), fields, ctx)
        : []
      return [...fields.filter((f) => grouped.has(f.name)), ...aliases]
    }
    default:
      return fields
  }
}

/** Aliases of aggregate(Amount with sum as Total, $count as Count) with their types */
function aggregateAliases(inner: string, fields: Field[], ctx: FilterContext): Field[] {
  return splitTop(inner, ",").flatMap(({ start, end }) => {
    const words = inner.slice(start, end).trim().split(/\s+/)
    const as = words.findIndex((w) => w.toLowerCase() === "as")
    const alias = as >= 0 ? words[as + 1] : undefined
    if (!alias)
      return []
    const method = words[2]?.toLowerCase()
    if (words[0] === "$count" || method === "countdistinct")
      return [aliasField(alias, "integer")]
    if (method === "min" || method === "max") {
      const source = fieldByPath(words[0], fields, ctx)
      if (source)
        return [{ ...source, name: alias, description: `${method} of ${words[0]}` }]
    }
    return [aliasField(alias, "number")]
  })
}

/** Aliases of compute(year(date) as Year, ...); their type is not known */
function computeAliases(inner: string): Field[] {
  return splitTop(inner, ",").flatMap(({ start, end }) => {
    const match = /\s+as\s+(\w+)\s*$/i.exec(inner.slice(start, end))
    return match ? [aliasField(match[1], "")] : []
  })
}

function fieldByPath(path: string, fields: Field[], ctx: FilterContext): Field | undefined {
  let field: Field | undefined
  for (const segment of path.split("/")) {
    field = fields.find((f) => f.name === segment)
    if (!field)
      return undefined
    fields = field.navigation ? ctx.fieldsOf(field.navigation) : []
  }
  return field
}

/** Field path being typed (e.g. parent/na): fields of the last segment's entity */
function pathSuggestions(word: string, offset: number, ctx: FilterContext, exclude = new Set<string>()): CompletionResult | null {
  const slash = word.lastIndexOf("/")
  let fields = ctx.fields
  if (slash >= 0) {
    const nav = fieldByPath(word.slice(0, slash), fields, ctx)
    if (!nav?.navigation)
      return null
    fields = ctx.fieldsOf(nav.navigation)
  }
  const prefix = word.slice(0, slash + 1)
  const options: Suggestion[] = fields
    .filter((f) => !f.collection && f.type !== "array" && !exclude.has(prefix + f.name))
    .map((f) =>
      f.navigation
        ? { label: f.name, kind: "navigation", detail: "→ fields", info: f.description, insert: `${f.name}/` }
        : {
          label: f.name,
          kind: "field",
          detail: f.enum ? "enum" : f.format ?? f.type,
          info: f.description,
          insert: f.name,
          reopen: false,
        },
    )
  return options.length ? { from: offset + slash + 1, options } : null
}

function completeStep(text: string, offset: number, ctx: FilterContext): CompletionResult | null {
  const match = /^(\s*)(\w*)/.exec(text)!
  const name = match[2]
  const afterName = match[0].length
  if (afterName === text.length) {
    const options: Suggestion[] = Object.entries(transformations).map(([label, t]) => ({
      label,
      kind: "function",
      info: t.info,
      snippet: t.snippet,
    }))
    return { from: offset + match[1].length, options }
  }
  if (text[afterName] !== "(")
    return null
  const close = findClose(text, afterName)
  if (close >= 0) {
    // the transformation is complete, the next one follows a /
    return text.slice(close + 1).trim()
      ? null
      : { from: offset + text.length, options: [{ label: "/", kind: "keyword", info: "Then another transformation", insert: "/" }] }
  }
  const inner = text.slice(afterName + 1)
  const innerOffset = offset + afterName + 1
  switch (name.toLowerCase()) {
    case "filter":
      return shift(completeFilter(inner, ctx), innerOffset)
    case "aggregate":
      return completeAggregate(inner, innerOffset, ctx)
    case "compute":
      return completeCompute(inner, innerOffset, ctx)
    case "groupby":
      return completeGroupby(inner, innerOffset, ctx)
    default:
      return null
  }
}

/** groupby((a, parent/name), aggregate(...)) */
function completeGroupby(text: string, offset: number, ctx: FilterContext): CompletionResult | null {
  const open = text.indexOf("(")
  if (open < 0) {
    return text.trim()
      ? null
      : { from: offset + text.length, options: [{ label: "(", kind: "keyword", info: "Fields to group by", insert: "(" }] }
  }
  const close = findClose(text, open)
  if (close < 0) {
    // the field list
    const list = text.slice(open + 1)
    const items = splitTop(list, ",")
    const current = items.pop()!
    const word = list.slice(current.start).trimStart()
    if (!/^[\w/]*$/.test(word))
      return null
    const used = new Set(items.map(({ start, end }) => list.slice(start, end).trim()))
    return pathSuggestions(word, offset + open + 1 + list.length - word.length, ctx, used)
  }
  const rest = text.slice(close + 1)
  const restOffset = offset + close + 1
  const agg = /^\s*,\s*aggregate\s*\(/i.exec(rest)
  if (agg) {
    const inner = rest.slice(agg[0].length)
    if (findClose(rest, agg[0].length - 1) >= 0)
      return null
    return completeAggregate(inner, restOffset + agg[0].length, ctx)
  }
  const partial = /^\s*,\s*(\w*)$/.exec(rest)
  if (partial)
    return {
      from: restOffset + rest.length - partial[1].length,
      options: [{ label: "aggregate", kind: "function", info: "Totals per group", snippet: "aggregate(${})" }],
    }
  if (rest.trim())
    return null
  return {
    from: restOffset + rest.length,
    options: [
      { label: ",", kind: "keyword", info: "Add totals per group: , aggregate(...)", snippet: ", aggregate(${})" },
      { label: ")", kind: "keyword", insert: ")" },
    ],
  }
}

/** aggregate(Amount with sum as Total, $count as Count) */
function completeAggregate(text: string, offset: number, ctx: FilterContext): CompletionResult | null {
  const items = splitTop(text, ",")
  const current = items[items.length - 1]
  const item = text.slice(current.start)
  const itemOffset = offset + current.start
  const words = item.trimStart().split(/\s+/)
  const typing = words.pop()!
  const from = itemOffset + item.length - typing.length

  if (!words.length) {
    const result = pathSuggestions(typing, itemOffset + item.length - typing.length, ctx)
    const options = (result?.options ?? []).map((o) => (o.kind === "field" ? { ...o, insert: `${o.label} with ` } : o))
    if (!typing.includes("/"))
      options.push({ label: "$count", kind: "keyword", info: "Number of rows", snippet: "$count as ${count}" })
    return { from: result?.from ?? from, options }
  }
  const [path, second, third] = words.map((w) => w.toLowerCase())
  if (words.length === 1) {
    // after the field: with (or as after $count)
    const next = path === "$count" ? "as" : "with"
    return { from, options: [{ label: next, kind: "keyword", insert: `${next} ` }] }
  }
  if (words.length === 2 && second === "with") {
    const field = fieldByPath(words[0], ctx.fields, ctx)
    const numeric = !field || valueTypeOf(field) === "number"
    const fieldName = words[0].split("/").pop()!
    return {
      from,
      options: Object.entries(methods)
        .filter(([m]) => numeric || (m !== "sum" && m !== "average"))
        .map(([m, info]) => ({
          label: m,
          kind: "function",
          info,
          // the alias names the new field, Tab or typing replaces it
          snippet: `${m} as \${${m}${fieldName[0].toUpperCase()}${fieldName.slice(1)}}`,
        })),
    }
  }
  if (words.length === 3 && second === "with" && third in methods)
    return { from, options: [{ label: "as", kind: "keyword", insert: "as " }] }
  return null
}

const arithmetic: Record<string, string> = {
  add: "plus",
  sub: "minus",
  mul: "times",
  div: "divided by",
  mod: "remainder",
}

/** compute(Price mul Quantity as Total, year(Date) as Year) */
function completeCompute(text: string, offset: number, ctx: FilterContext): CompletionResult | null {
  const items = splitTop(text, ",")
  const current = items[items.length - 1]
  const item = text.slice(current.start)
  const itemOffset = offset + current.start
  // the alias after as is free text
  if (/\sas\s+\w*$/i.test(item))
    return null
  // after an operand: as, or an arithmetic operator
  const trailing = /^(.*\S)\s+(\w*)$/.exec(item)
  if (trailing && splitTop(trailing[1], ",").length === 1 && findClose(`(${trailing[1]})`, 0) === trailing[1].length + 1) {
    const last = trailing[1].split(/\s+/).pop()!.toLowerCase()
    if (!(last in arithmetic)) {
      return {
        from: itemOffset + item.length - trailing[2].length,
        options: [
          { label: "as", kind: "keyword", info: "Name of the new field", insert: "as ", reopen: false },
          ...Object.entries(arithmetic).map(([op, info]): Suggestion => ({ label: op, kind: "operator", info })),
        ],
      }
    }
  }
  // operands and function arguments follow the $filter rules, starting after the last operator
  const operand = /^.*\s(?:add|sub|mul|div|mod)\s+/i.exec(item)?.[0].length ?? 0
  return shift(completeFilter(item.slice(operand), ctx), itemOffset + operand)
}
