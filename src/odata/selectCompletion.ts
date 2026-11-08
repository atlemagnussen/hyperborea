import type { Field } from "../spec/fields.js"
import type { CompletionResult, Suggestion } from "./filterCompletion.js"

/**
 * Suggestions for $select: a comma separated list of the row's own fields.
 * Fields of related entities are selected inside $expand, e.g. $expand=parent($select=name),
 * so navigation and collection fields are not offered here.
 */
export function completeSelect(textBeforeCursor: string, fields: Field[]): CompletionResult | null {
  const segments = textBeforeCursor.split(",")
  const current = segments.pop() ?? ""
  const word = current.trimStart()
  const from = textBeforeCursor.length - word.length
  // the word being typed may only contain field name characters
  if (!/^\w*$/.test(word))
    return null

  const selected = new Set(segments.map((s) => s.trim()))
  const options: Suggestion[] = fields
    .filter((f) => !f.navigation && !f.collection && f.type !== "array" && !selected.has(f.name))
    .map((f) => ({
      label: f.name,
      kind: "field",
      detail: f.enum ? "enum" : f.format ?? f.type,
      info: f.description,
      // type a comma for the next field
      insert: f.name,
      reopen: false,
    }))
  if (!segments.length)
    options.push({ label: "*", kind: "keyword", info: "All fields", insert: "*", reopen: false })
  return options.length ? { from, options } : null
}
