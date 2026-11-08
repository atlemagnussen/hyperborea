import type { Field } from "../spec/fields.js"
import type { Schema } from "../spec/openapi.js"

/** Value types the completion distinguishes */
export type ValueType =
  | "string"
  | "number"
  | "boolean"
  | "date-time"
  | "date"
  | "uuid"
  | "enum"
  | "unknown"

export interface Suggestion {
  label: string
  kind: "field" | "navigation" | "function" | "operator" | "keyword" | "value"
  /** Short text shown next to the label, e.g. the type */
  detail?: string
  /** Longer description shown beside the list */
  info?: string
  /** Text to insert, defaults to label. Ends with a space unless it opens something */
  insert?: string
  /** CodeMirror snippet template, ${} marks placeholders (Tab moves to the next) */
  snippet?: string
  /** Open the suggestions again after inserting, for what comes next. Default true */
  reopen?: boolean
}

export interface CompletionResult {
  /** Position in the text where the replaced word starts */
  from: number
  options: Suggestion[]
}

export interface FilterContext {
  fields: Field[]
  /** Fields of a navigation target schema */
  fieldsOf: (schema: Schema) => Field[]
}

interface FunctionSpec {
  args: ValueType[]
  returns: ValueType
  snippet: string
  info: string
}

// OData v4 built-in functions supported by ASP.NET Core OData
const functions: Record<string, FunctionSpec> = {
  contains: fn(["string", "string"], "boolean", "contains(${}, '${}')${}", "Text contains"),
  startswith: fn(["string", "string"], "boolean", "startswith(${}, '${}')${}", "Text starts with"),
  endswith: fn(["string", "string"], "boolean", "endswith(${}, '${}')${}", "Text ends with"),
  tolower: fn(["string"], "string", "tolower(${})${}", "Lower case, for case-insensitive compare"),
  toupper: fn(["string"], "string", "toupper(${})${}", "Upper case"),
  trim: fn(["string"], "string", "trim(${})${}", "Remove leading and trailing spaces"),
  length: fn(["string"], "number", "length(${})${}", "Number of characters"),
  indexof: fn(["string", "string"], "number", "indexof(${}, '${}')${}", "Position of text, -1 when missing"),
  year: fn(["date-time"], "number", "year(${})${}", "Year of a date"),
  month: fn(["date-time"], "number", "month(${})${}", "Month of a date (1-12)"),
  day: fn(["date-time"], "number", "day(${})${}", "Day of month"),
  hour: fn(["date-time"], "number", "hour(${})${}", "Hour of a date"),
  date: fn(["date-time"], "date", "date(${})${}", "Date part, compare with 2026-01-31"),
  now: fn([], "date-time", "now()", "Current date and time"),
}

function fn(args: ValueType[], returns: ValueType, snippet: string, info: string): FunctionSpec {
  return { args, returns, snippet, info }
}

const operators: Record<string, string> = {
  eq: "equals",
  ne: "not equals",
  gt: "greater than",
  ge: "greater than or equal",
  lt: "less than",
  le: "less than or equal",
  in: "one of a list: in ('a', 'b')",
}

/** Operators that make sense per type */
function operatorsFor(type: ValueType) {
  if (type === "boolean")
    return ["eq", "ne"]
  if (type === "enum" || type === "uuid")
    return ["eq", "ne", "in"]
  return Object.keys(operators)
}

export function valueTypeOf(field: Field): ValueType {
  if (field.enum?.length)
    return "enum"
  if (field.type === "boolean")
    return "boolean"
  if (field.type === "integer" || field.type === "number")
    return "number"
  if (field.format === "date-time")
    return "date-time"
  if (field.format === "date")
    return "date"
  if (field.format === "uuid")
    return "uuid"
  if (field.type === "string")
    return "string"
  return "unknown"
}

// ---- tokenizer ----

interface Token {
  kind: "ident" | "string" | "number" | "punct" | "open-string"
  text: string
  start: number
  end: number
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const start = i
    if (c === "'") {
      // '' is an escaped quote inside a string
      i++
      let closed = false
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'")
          i += 2
        else if (text[i] === "'") {
          i++
          closed = true
          break
        } else
          i++
      }
      tokens.push({ kind: closed ? "string" : "open-string", text: text.slice(start, i), start, end: i })
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < text.length && /[\w/.]/.test(text[i]))
        i++
      tokens.push({ kind: "ident", text: text.slice(start, i), start, end: i })
    } else if (/[0-9-]/.test(c)) {
      // numbers, dates (2026-01-31T00:00:00Z) and guids starting with a digit
      i++
      while (i < text.length && /[\w:.+-]/.test(text[i]))
        i++
      tokens.push({ kind: "number", text: text.slice(start, i), start, end: i })
    } else {
      i++
      tokens.push({ kind: "punct", text: c, start, end: i })
    }
  }
  return tokens
}

// ---- context analysis ----

type State = "operand" | "operator" | "value" | "connector"

type Frame =
  | { kind: "group" }
  | { kind: "list" }
  | { kind: "function"; name: string; arg: number }

interface Analysis {
  state: State
  /** Type of the left hand side, for operator and value suggestions */
  leftType: ValueType
  leftField?: Field
  frame?: Frame
}

const keywords = new Set(["and", "or", "not", ...Object.keys(operators), "has"])

function analyse(tokens: Token[], ctx: FilterContext): Analysis {
  let state: State = "operand"
  let leftType: ValueType = "unknown"
  let leftField: Field | undefined
  let pendingFunction: string | undefined
  let afterIn = false
  const stack: Frame[] = []
  const top = () => stack[stack.length - 1]

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const lower = t.text.toLowerCase()
    const next = tokens[i + 1]

    if (t.kind === "ident" && next?.text === "(" && lower in functions && state !== "operator") {
      pendingFunction = lower
      continue
    }
    if (t.text === "(") {
      if (pendingFunction) {
        stack.push({ kind: "function", name: pendingFunction, arg: 0 })
        pendingFunction = undefined
        state = "operand"
      } else if (afterIn) {
        stack.push({ kind: "list" })
        afterIn = false
        state = "value"
      } else {
        stack.push({ kind: "group" })
        state = "operand"
      }
      continue
    }
    if (t.text === ",") {
      const frame = top()
      if (frame?.kind === "function") {
        frame.arg++
        leftType = functions[frame.name].args[frame.arg] ?? "unknown"
        leftField = undefined
      }
      state = "value"
      continue
    }
    if (t.text === ")") {
      const frame = stack.pop()
      if (frame?.kind === "function") {
        const returns = functions[frame.name].returns
        state = returns === "boolean" ? "connector" : "operator"
        leftType = returns
        leftField = undefined
      } else {
        state = "connector"
      }
      continue
    }

    switch (state) {
      case "operand":
        if (lower === "not")
          break
        if (t.kind === "ident" && !keywords.has(lower)) {
          leftField = fieldByPath(t.text, ctx)
          leftType = leftField ? valueTypeOf(leftField) : "unknown"
        } else {
          leftField = undefined
          leftType = t.kind === "string" ? "string" : t.kind === "number" ? "number" : "unknown"
        }
        state = top()?.kind === "function" ? "connector" : "operator"
        break
      case "operator":
        if (lower === "in")
          afterIn = true
        state = "value"
        break
      case "value":
        state = "connector"
        break
      case "connector":
        if (lower === "and" || lower === "or")
          state = "operand"
        break
    }
  }
  return { state, leftType, leftField, frame: top() }
}

function fieldByPath(path: string, ctx: FilterContext): Field | undefined {
  let fields = ctx.fields
  let field: Field | undefined
  for (const segment of path.split("/")) {
    field = fields.find((f) => f.name === segment)
    if (!field)
      return undefined
    fields = field.navigation ? ctx.fieldsOf(field.navigation) : []
  }
  return field
}

// ---- suggestions ----

function fieldSuggestions(fields: Field[], argType?: ValueType): Suggestion[] {
  const suggestions: Suggestion[] = []
  for (const f of fields) {
    if (f.navigation) {
      // navigation into a single related entity, e.g. parent/name
      if (!argType)
        suggestions.push({ label: f.name, kind: "navigation", detail: "→ fields", info: f.description, insert: `${f.name}/` })
      continue
    }
    // collections need any/all lambdas, not supported yet
    if (f.collection || f.type === "array" || f.type === "object")
      continue
    const type = valueTypeOf(f)
    if (argType && type !== argType)
      continue
    suggestions.push({
      label: f.name,
      kind: "field",
      detail: f.enum ? "enum" : f.format ?? f.type,
      info: f.description,
    })
  }
  return suggestions
}

function functionSuggestions(): Suggestion[] {
  return Object.entries(functions).map(([name, spec]) => ({
    label: name,
    kind: "function",
    detail: spec.returns === "boolean" ? "condition" : spec.returns,
    info: spec.info,
    snippet: spec.snippet,
  }))
}

function todayIso() {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00Z`
}

function valueSuggestions(type: ValueType, field?: Field): Suggestion[] {
  const values: Suggestion[] = []
  if (type === "enum" && field?.enum)
    values.push(...field.enum.map((v): Suggestion => ({ label: `'${v}'`, kind: "value", detail: "enum" })))
  if (type === "boolean")
    values.push({ label: "true", kind: "value" }, { label: "false", kind: "value" })
  if (type === "string")
    values.push({ label: "'…'", kind: "value", detail: "text", snippet: "'${}'" })
  if (type === "date-time")
    values.push({ label: todayIso(), kind: "value", detail: "date-time (UTC)" })
  if (type === "date")
    values.push({ label: todayIso().slice(0, 10), kind: "value", detail: "date" })
  if (type === "date-time" || type === "date")
    values.push({ label: "now()", kind: "function", detail: "date-time", info: "Current date and time" })
  values.push({ label: "null", kind: "value" })
  return values
}

/** Suggestions for the $filter text before the cursor */
export function completeFilter(textBeforeCursor: string, ctx: FilterContext): CompletionResult | null {
  const tokens = tokenize(textBeforeCursor)
  const last = tokens[tokens.length - 1]
  const cursor = textBeforeCursor.length

  // cursor right after a word: it is being typed and gets replaced
  let from = cursor
  let fields = ctx.fields
  if (last && last.end === cursor && (last.kind === "ident" || last.kind === "number" || last.kind === "open-string")) {
    tokens.pop()
    from = last.start
    const slash = last.text.lastIndexOf("/")
    if (last.kind === "ident" && slash >= 0) {
      // navigation path: complete the fields of the related entity
      const nav = fieldByPath(last.text.slice(0, slash), ctx)
      if (!nav?.navigation)
        return null
      fields = ctx.fieldsOf(nav.navigation)
      from = last.start + slash + 1
      return { from, options: fieldSuggestions(fields) }
    }
  }

  const { state, leftType, leftField, frame } = analyse(tokens, ctx)
  const inFunction = frame?.kind === "function" ? frame : undefined

  if (last?.kind === "open-string" && from === last.start) {
    // inside a quoted value: only enum values can be suggested
    return state === "value" && leftType === "enum"
      ? { from, options: valueSuggestions("enum", leftField).filter((s) => s.label.startsWith("'")) }
      : null
  }

  switch (state) {
    case "operand": {
      if (inFunction) {
        // field placeholder of a function snippet: Tab continues to the next placeholder
        const argType = functions[inFunction.name].args[inFunction.arg]
        const options = fieldSuggestions(fields, argType)
        return { from, options: options.map((o) => ({ ...o, insert: o.label, reopen: false })) }
      }
      return {
        from,
        options: [
          ...fieldSuggestions(fields),
          ...functionSuggestions(),
          { label: "not", kind: "keyword", info: "Negates the following condition" },
          { label: "(", kind: "keyword", info: "Group conditions", insert: "(" },
        ],
      }
    }
    case "operator":
      return {
        from,
        options: operatorsFor(leftType).map((op) => ({
          label: op,
          kind: "operator",
          info: operators[op],
          insert: op === "in" ? "in (" : undefined,
        })),
      }
    case "value":
      return { from, options: valueSuggestions(leftType, leftField) }
    case "connector": {
      const close: Suggestion = { label: ")", kind: "keyword", insert: ") " }
      const next: Suggestion = { label: ",", kind: "keyword", insert: ", " }
      // inside a function call or an in (...) list only , and ) can follow
      if (frame?.kind === "list")
        return { from, options: [next, close] }
      if (inFunction) {
        const moreArgs = inFunction.arg + 1 < functions[inFunction.name].args.length
        return { from, options: moreArgs ? [next, close] : [close] }
      }
      const options: Suggestion[] = [
        { label: "and", kind: "keyword", info: "Both conditions must match" },
        { label: "or", kind: "keyword", info: "Either condition must match" },
      ]
      if (frame)
        options.push(close)
      return { from, options }
    }
  }
}
