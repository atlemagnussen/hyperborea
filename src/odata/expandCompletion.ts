import { isBackReference, type Field } from "../spec/fields.js"
import type { Schema } from "../spec/openapi.js"
import {
  completeFilter,
  type CompletionResult,
  type FilterContext,
  type Suggestion,
} from "./filterCompletion.js"
import { completeSelect } from "./selectCompletion.js"

/**
 * Suggestions for $expand, e.g. parent($select=id,name),users($filter=...;$top=5).
 * The nested options of an expanded entity complete on that entity's fields, reusing the
 * $select / $filter rules; $expand inside is handled recursively.
 */
export function completeExpand(
  textBeforeCursor: string,
  ctx: FilterContext,
  rootName?: string,
): CompletionResult | null {
  return expandList(textBeforeCursor, 0, ctx.fields, ctx, [rootName])
}

type Ancestors = (string | undefined)[]

function shift(result: CompletionResult | null, offset: number): CompletionResult | null {
  return result && { ...result, from: result.from + offset }
}

function targetOf(field: Field | undefined): Schema | undefined {
  return field?.navigation ?? field?.collection
}

/** Index of the ) matching the ( at open, skipping quoted strings; -1 when not closed yet */
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

/** Index of the ; ending an option value, skipping parentheses and strings; -1 when not ended */
function findOptionEnd(text: string, start: number) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0)
        return -1
      i = end
    } else if (c === "(")
      depth++
    else if (c === ")")
      depth--
    else if (c === ";" && depth === 0)
      return i
  }
  return -1
}

function navigationSuggestions(fields: Field[], exclude: Set<string>, ancestors: Ancestors): Suggestion[] {
  const suggestions: Suggestion[] = fields
    .filter((f) => targetOf(f) && !exclude.has(f.name))
    .map((f): Suggestion => ({
      label: f.name,
      kind: "navigation",
      detail: `${f.collection ? "collection" : "single"}${isBackReference(f, ancestors) ? " ↻" : ""}`,
      info: isBackReference(f, ancestors)
        ? `Back to ${f.schemaName}, already expanded further out: repeats the same fields`
        : f.description,
      // type ( for nested options or , for the next one
      insert: f.name,
      reopen: false,
    }))
  if (!exclude.size)
    suggestions.push({ label: "*", kind: "keyword", info: "Expand all related entities", insert: "*", reopen: false })
  return suggestions
}

/** A comma separated list of navigation properties, each with optional (nested options) */
function expandList(
  text: string,
  offset: number,
  fields: Field[],
  ctx: FilterContext,
  ancestors: Ancestors,
): CompletionResult | null {
  const expanded = new Set<string>()
  let i = 0
  while (true) {
    while (text[i] === " ")
      i++
    const name = /^[\w*]*/.exec(text.slice(i))![0]
    const start = i
    i += name.length
    if (i === text.length) {
      const options = navigationSuggestions(fields, expanded, ancestors)
      return options.length ? { from: offset + start, options } : null
    }
    while (text[i] === " ")
      i++
    if (i === text.length)
      return null

    if (text[i] === ",") {
      expanded.add(name)
      i++
      continue
    }
    if (text[i] !== "(")
      return null

    const field = fields.find((f) => f.name === name)
    const close = findClose(text, i)
    if (close < 0) {
      // cursor is inside the nested options of this navigation property
      const target = targetOf(field)
      if (!target)
        return null
      const nested = text.slice(i + 1)
      const nestedAncestors = [...ancestors, field?.schemaName]
      return nestedOptions(nested, offset + i + 1, ctx.fieldsOf(target), !!field?.collection, ctx, nestedAncestors)
    }
    expanded.add(name)
    i = close + 1
    while (text[i] === " ")
      i++
    if (i === text.length)
      return null
    if (text[i] !== ",")
      return null
    i++
  }
}

const optionInfo: Record<string, string> = {
  $select: "Fields of the related entity",
  $filter: "Filter the related collection",
  $orderby: "Sort the related collection",
  $expand: "Expand further from the related entity",
  $top: "Max number of related rows",
  $skip: "Skip related rows",
  $count: "Include @odata.count for the related collection",
}

function optionSuggestions(fields: Field[], isCollection: boolean, used: Set<string>): Suggestion[] {
  const hasNavigation = fields.some((f) => targetOf(f))
  return Object.keys(optionInfo)
    .filter((name) => !used.has(name))
    // filtering, sorting and paging only make sense on collections
    .filter((name) => isCollection || ["$select", "$expand"].includes(name))
    .filter((name) => name !== "$expand" || hasNavigation)
    .map((name) => ({
      label: name,
      kind: "keyword",
      info: optionInfo[name],
      insert: name === "$count" ? "$count=true" : `${name}=`,
      reopen: !["$top", "$skip", "$count"].includes(name),
    }))
}

/** Options inside parentheses, separated by ;  e.g. $select=id,name;$top=5 */
function nestedOptions(
  text: string,
  offset: number,
  fields: Field[],
  isCollection: boolean,
  ctx: FilterContext,
  ancestors: Ancestors,
): CompletionResult | null {
  const used = new Set<string>()
  let i = 0
  while (true) {
    while (text[i] === " ")
      i++
    const name = /^\$?\w*/.exec(text.slice(i))![0]
    const start = i
    i += name.length
    if (i === text.length) {
      const options = optionSuggestions(fields, isCollection, used)
      return options.length ? { from: offset + start, options } : null
    }
    if (text[i] !== "=")
      return null
    const valueStart = i + 1
    const end = findOptionEnd(text, valueStart)
    if (end < 0) {
      // cursor is inside this option's value
      const value = text.slice(valueStart)
      const valueOffset = offset + valueStart
      const nestedCtx: FilterContext = { fields, fieldsOf: ctx.fieldsOf }
      switch (name.toLowerCase()) {
        case "$select":
          return shift(completeSelect(value, fields), valueOffset)
        case "$filter":
          return shift(completeFilter(value, nestedCtx), valueOffset)
        case "$orderby":
          return shift(completeOrderby(value, fields), valueOffset)
        case "$expand":
          return expandList(value, valueOffset, fields, nestedCtx, ancestors)
        default:
          return null
      }
    }
    used.add(name.toLowerCase())
    i = end + 1
  }
}

/** $orderby: comma separated fields, each optionally followed by asc or desc */
export function completeOrderby(textBeforeCursor: string, fields: Field[]): CompletionResult | null {
  const segments = textBeforeCursor.split(",")
  const current = segments.pop() ?? ""
  const used = new Set(segments.map((s) => s.trim().split(/\s+/)[0]))
  const match = /^\s*(\w*)(\s+(\w*))?$/.exec(current)
  if (!match)
    return null
  const [, field, afterField, direction] = match
  if (afterField === undefined) {
    const options: Suggestion[] = fields
      .filter((f) => !targetOf(f) && f.type !== "array" && f.type !== "object" && !used.has(f.name))
      .map((f) => ({
        label: f.name,
        kind: "field",
        detail: f.enum ? "enum" : f.format ?? f.type,
        info: f.description,
      }))
    return options.length ? { from: textBeforeCursor.length - field.length, options } : null
  }
  return {
    from: textBeforeCursor.length - direction.length,
    options: [
      { label: "asc", kind: "keyword", info: "Ascending (default)", reopen: false, insert: "asc" },
      { label: "desc", kind: "keyword", info: "Descending", reopen: false, insert: "desc" },
    ],
  }
}
