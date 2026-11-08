import type { Field } from "../spec/fields.js"
import type { Schema } from "../spec/openapi.js"
import { valueTypeOf } from "./filterCompletion.js"

/** A value in a response row, resolved against the spec's model */
export interface RowValue {
  /** OData path of the field, e.g. "parent/name" */
  odataPath: string
  field: Field
  /** True when the field sits directly on the row (usable in top level $select / $orderby) */
  topLevel: boolean
}

/**
 * Maps a JSON path in a response to a field of the row model. Rows are the items of
 * { value: [...] } pages or plain arrays, or the response itself for single items.
 * Values inside collections (e.g. users[0].role) are not resolved: they need any()/all().
 */
export function resolveRowValue(
  path: (string | number)[],
  fields: Field[],
  fieldsOf: (schema: Schema) => Field[],
): RowValue | undefined {
  let rest = path
  if (rest[0] === "value" && typeof rest[1] === "number")
    rest = rest.slice(2)
  else if (typeof rest[0] === "number")
    rest = rest.slice(1)
  if (!rest.length || rest.some((segment) => typeof segment !== "string"))
    return undefined

  let current = fields
  let field: Field | undefined
  for (const [i, name] of (rest as string[]).entries()) {
    field = current.find((f) => f.name === name)
    if (!field)
      return undefined
    if (i < rest.length - 1) {
      if (!field.navigation)
        return undefined
      current = fieldsOf(field.navigation)
    }
  }
  if (!field || field.navigation || field.collection)
    return undefined
  return { odataPath: rest.join("/"), field, topLevel: rest.length === 1 }
}

/** OData literal for a value of a field: 'text' (quotes doubled), numbers, true/false, null, dates */
export function odataLiteral(value: unknown, field: Field): string {
  if (value === null || value === undefined)
    return "null"
  const type = valueTypeOf(field)
  if (typeof value === "string") {
    // dates and guids are written without quotes in OData v4
    if (type === "date-time" || type === "date" || type === "uuid")
      return value
    return `'${value.replace(/'/g, "''")}'`
  }
  return String(value)
}

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A value of unknown type (e.g. a token claim) written into an OData expression at the cursor:
 * inside an open 'string' only its quotes are doubled, else guids are bare and the rest is 'text'
 */
export function literalAtCursor(value: string, textBeforeCursor: string) {
  const escaped = value.replace(/'/g, "''")
  // doubled quotes inside a string count twice, so an odd count means a string is open
  if ((textBeforeCursor.match(/'/g)?.length ?? 0) % 2 === 1)
    return escaped
  return guidPattern.test(value) ? value : `'${escaped}'`
}

/** Adds a condition to an existing $filter with "and", keeping an "or" expression together */
export function appendFilter(current: string, condition: string) {
  const existing = current.trim()
  if (!existing)
    return condition
  return /\bor\b/i.test(existing) ? `(${existing}) and ${condition}` : `${existing} and ${condition}`
}

/** Adds a field to a comma separated $select, unless it is there already */
export function appendSelect(current: string, fieldName: string) {
  const fields = current.split(",").map((f) => f.trim()).filter(Boolean)
  return fields.includes(fieldName) ? fields.join(",") : [...fields, fieldName].join(",")
}
