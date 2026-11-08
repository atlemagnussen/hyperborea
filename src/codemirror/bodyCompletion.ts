import { startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"
import { unwrap, type SchemaOrRef } from "../spec/fields.js"
import type { Document, Schema } from "../spec/openapi.js"

/** Where the cursor is in a JSON body, read from the (possibly unfinished) text before it */
export interface BodyPosition {
  /** Property names and array items ("[]") from the root: to the value typed, or the object of a key */
  path: string[]
  /** A property name is typed (key) or a value: of a property, or an array item */
  kind: "key" | "value"
  /** Keys already written in the object, offered no more */
  keys: string[]
  /** Start of what is typed so far: an open string including its quote, or a bare word */
  from: number
  typed: string
}

interface Frame {
  kind: "object" | "array"
  key?: string
  afterColon: boolean
  keys: string[]
}

/**
 * Scans the text before the cursor. Tolerant: the text is being typed, so it is usually not
 * valid JSON yet. Undefined outside the top level value or where nothing can be typed.
 */
export function bodyPositionAt(text: string): BodyPosition | undefined {
  const stack: Frame[] = []
  let openString = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const top = stack.at(-1)
    if (c === '"') {
      let end = i + 1
      while (end < text.length && text[end] !== '"')
        end += text[end] === "\\" ? 2 : 1
      if (end >= text.length) {
        openString = i
        break
      }
      if (top?.kind === "object" && !top.afterColon) {
        try {
          top.key = JSON.parse(text.slice(i, end + 1)) as string
          top.keys.push(top.key)
        } catch {
          top.key = undefined
        }
      }
      i = end
    } else if (c === "{" || c === "[") {
      stack.push({ kind: c === "{" ? "object" : "array", afterColon: false, keys: [] })
    } else if (c === "}" || c === "]") {
      stack.pop()
    } else if (c === ":" && top?.kind === "object") {
      top.afterColon = true
    } else if (c === "," && top?.kind === "object") {
      top.afterColon = false
      top.key = undefined
    }
  }

  const top = stack.at(-1)
  if (!top)
    return undefined
  const typed = openString >= 0 ? text.slice(openString) : (/[\w.+-]*$/.exec(text)?.[0] ?? "")
  const from = text.length - typed.length
  // the parent frames' current key (or item) leads to this one
  const path = stack.slice(0, -1).map((frame) => (frame.kind === "array" ? "[]" : (frame.key ?? "")))

  // only where something is missing, not e.g. after a finished value or a key without its colon
  const lastToken = text.slice(0, from).trimEnd().at(-1)
  if (top.kind === "array")
    return lastToken === "[" || lastToken === "," ? { path: [...path, "[]"], kind: "value", keys: [], from, typed } : undefined
  if (top.afterColon)
    return lastToken === ":" ? { path: [...path, top.key ?? ""], kind: "value", keys: top.keys, from, typed } : undefined
  return lastToken === "{" || lastToken === "," ? { path, kind: "key", keys: top.keys, from, typed } : undefined
}

/** The schemas a value can take: the alternatives of oneOf/anyOf, each unwrapped */
function variants(document: Document, schemaOrRef: SchemaOrRef): Schema[] {
  const schema = unwrap(document, schemaOrRef)
  const alternatives = schema.oneOf ?? schema.anyOf
  return alternatives?.length ? alternatives.flatMap((alt) => variants(document, alt)) : [schema]
}

/** Properties of an object schema, including all parts of allOf and all alternatives */
function propertiesOf(document: Document, schemaOrRef: SchemaOrRef): Record<string, SchemaOrRef> {
  const properties: Record<string, SchemaOrRef> = {}
  for (const schema of variants(document, schemaOrRef)) {
    for (const part of schema.allOf ?? [])
      Object.assign(properties, propertiesOf(document, part))
    Object.assign(properties, schema.properties)
  }
  return properties
}

/** The schema at a body path, undefined where the spec does not describe it */
export function schemaAt(document: Document, root: SchemaOrRef, path: string[]): SchemaOrRef | undefined {
  let current: SchemaOrRef | undefined = root
  for (const segment of path) {
    if (!current)
      return undefined
    if (segment === "[]") {
      const array: Schema | undefined = variants(document, current).find((s) => s.type === "array")
      current = array?.items
    } else {
      current = propertiesOf(document, current)[segment]
    }
  }
  return current
}

function typeLabel(schema: Schema) {
  if (schema.enum)
    return "enum"
  if (schema.type === "array")
    return "array"
  return [schema.type ?? (schema.properties ? "object" : ""), schema.format].filter(Boolean).join(" ")
}

/**
 * Inserts text for what is typed, then opens the list again when asked (e.g. for the value after
 * a property name). A string being typed also loses its closing quote, added by closeBrackets.
 */
function insert(text: string, reopen = false) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const typedString = view.state.sliceDoc(from, from + 1) === '"'
    if (typedString && view.state.sliceDoc(to, to + 1) === '"')
      to++
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.complete",
    })
    if (reopen)
      setTimeout(() => startCompletion(view))
  }
}

function valueOption(label: string, type: string, boost = 0): Completion {
  return { label, type, boost, apply: insert(label) }
}

function valueOptions(document: Document, schemaOrRef: SchemaOrRef): Completion[] {
  const options: Completion[] = []
  let nullable = false
  for (const schema of variants(document, schemaOrRef)) {
    nullable ||= !!schema.nullable
    for (const value of schema.enum ?? [])
      options.push(valueOption(JSON.stringify(value), "enum", 1))
    if (schema.type === "boolean")
      options.push(valueOption("true", "constant"), valueOption("false", "constant"))
  }
  if (nullable && options.length)
    options.push(valueOption("null", "constant", -1))
  return options
}

function keyOptions(document: Document, schemaOrRef: SchemaOrRef, written: string[]): Completion[] {
  return Object.entries(propertiesOf(document, schemaOrRef))
    .filter(([name]) => !written.includes(name) && !name.includes("@"))
    .map(([name, prop]) => {
      const schema = unwrap(document, prop)
      return {
        label: JSON.stringify(name),
        detail: typeLabel(schema),
        info: schema.description,
        type: "property",
        boost: schema.readOnly ? -1 : 0,
        apply: insert(`${JSON.stringify(name)}: `, valueOptions(document, prop).length > 0),
      }
    })
}

/**
 * Suggestions from the request body schema: enum values (and true/false) for a value, property
 * names for a key. Values open by themselves after the colon; keys once a quote is typed.
 */
export function bodyCompletion(getSchema: () => { document: Document; schema: SchemaOrRef } | undefined) {
  return (context: CompletionContext): CompletionResult | null => {
    const spec = getSchema()
    if (!spec)
      return null
    const position = bodyPositionAt(context.state.doc.sliceString(0, context.pos))
    if (!position)
      return null
    const { document, schema } = spec
    const target = schemaAt(document, schema, position.path)
    if (!target)
      return null

    if (position.kind === "key" && !position.typed.startsWith('"') && !context.explicit)
      return null
    const options =
      position.kind === "key" ? keyOptions(document, target, position.keys) : valueOptions(document, target)
    if (!options.length)
      return null

    // matched against the text before the cursor only: with the closing quote added by
    // closeBrackets, a lone opening quote would be "" and match nothing
    return { from: position.from, to: context.pos, options, validFor: /^"?[^"]*$/ }
  }
}
