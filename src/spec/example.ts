import { schemaName, unwrap, type SchemaOrRef } from "./fields.js"
import type { Document } from "./openapi.js"

/**
 * A starting value for a request body: the schema's example or default where it has one, else an
 * empty value per type ("" , 0, false, the first enum value). Read only fields are left out.
 * Arrays get one item at the top (a list body), nested arrays stay empty; a type nested in
 * itself becomes null.
 */
export function exampleValue(document: Document, schemaOrRef: SchemaOrRef, seen: string[] = [], depth = 0): unknown {
  const name = schemaName(document, schemaOrRef)
  if (name && seen.includes(name))
    return null
  const path = name ? [...seen, name] : seen
  const schema = unwrap(document, schemaOrRef)
  if (schema.example !== undefined)
    return schema.example
  if (schema.default !== undefined)
    return schema.default
  if (schema.enum?.length)
    return schema.enum[0]
  const alternatives = schema.oneOf ?? schema.anyOf
  if (alternatives?.length)
    return exampleValue(document, alternatives[0], path, depth)
  if (schema.allOf?.length) {
    // allOf with several parts (one part is unwrapped already): the parts' fields together
    return Object.assign({}, ...schema.allOf.map((part) => exampleValue(document, part, path, depth)))
  }

  switch (schema.type) {
    case "array":
      return depth ? [] : [exampleValue(document, schema.items, path, depth + 1)]
    case "integer":
    case "number":
      return 0
    case "boolean":
      return false
    case "string":
      if (schema.format === "date-time")
        return new Date().toISOString()
      if (schema.format === "date")
        return new Date().toISOString().slice(0, 10)
      if (schema.format === "uuid")
        return "00000000-0000-0000-0000-000000000000"
      return ""
  }
  if (!schema.properties)
    return {}
  return Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([, prop]) => !unwrap(document, prop).readOnly)
      .map(([key, prop]) => [key, exampleValue(document, prop, path, depth + 1)]),
  )
}

/** The example as editable JSON text */
export function exampleBody(document: Document, schema: SchemaOrRef | undefined) {
  return schema ? JSON.stringify(exampleValue(document, schema), null, 2) : ""
}
