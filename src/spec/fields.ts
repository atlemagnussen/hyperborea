import type { OpenAPIV3 } from "openapi-types"
import { rawResponseSchema, resolve, type Document, type Operation, type Schema } from "./openapi.js"

export interface Field {
  name: string
  /** OpenAPI type: string, integer, number, boolean, object, array */
  type: string
  format?: string
  enum?: string[]
  description?: string
  /** Single navigation property (e.g. parent): fields reachable with parent/... */
  navigation?: Schema
  /** Collection navigation property (e.g. users): item schema, for any/all */
  collection?: Schema
  /** Name of the related schema (navigation / collection), e.g. Group */
  schemaName?: string
  nullable?: boolean
  required?: boolean
}

export type SchemaOrRef = Schema | OpenAPIV3.ReferenceObject

/** Resolves $refs and the single item oneOf/allOf wrappers the union spec uses for nullable types */
export function unwrap(document: Document, schemaOrRef: SchemaOrRef): Schema {
  const schema = resolve(document, schemaOrRef)
  const inner = schema.oneOf ?? schema.allOf
  if (inner?.length === 1) {
    const resolved = unwrap(document, inner[0])
    return { ...schema, ...resolved, oneOf: undefined, allOf: undefined }
  }
  return schema
}

/** Name of the component schema behind a $ref, looking through single item oneOf/allOf wrappers */
export function schemaName(document: Document, schemaOrRef: SchemaOrRef | undefined): string | undefined {
  if (!schemaOrRef)
    return undefined
  if ("$ref" in schemaOrRef)
    return schemaOrRef.$ref.split("/").pop()
  const inner = schemaOrRef.oneOf ?? schemaOrRef.allOf
  if (inner?.length === 1)
    return schemaName(document, inner[0])
  if (schemaOrRef.type === "array")
    return schemaName(document, schemaOrRef.items)
  return undefined
}

/** The schema of one row: items of { value: [...] } or of an array, else the response itself */
export function getItemSchema(document: Document, operation: Operation) {
  const schema = operation.responseSchema
  if (!schema)
    return undefined
  if (schema.type === "array")
    return unwrap(document, schema.items)
  const value = schema.properties?.value
  if (value) {
    const resolved = unwrap(document, value)
    if (resolved.type === "array")
      return unwrap(document, resolved.items)
  }
  return schema
}

/**
 * Fields of an object schema, skipping OData annotations like users@odata.count unless
 * withAnnotations (a response wrapper's @odata.count belongs to its documentation)
 */
export function getFields(document: Document, schema: Schema | undefined, withAnnotations = false): Field[] {
  if (!schema?.properties)
    return []
  return Object.entries(schema.properties)
    .filter(([name]) => withAnnotations || !name.includes("@"))
    .map(([name, prop]) => {
      const resolved = unwrap(document, prop)
      const field: Field = {
        name,
        type: resolved.type ?? (resolved.properties ? "object" : "string"),
        format: resolved.format,
        enum: resolved.enum?.map(String),
        description: resolved.description,
        nullable: resolved.nullable === true,
        required: schema.required?.includes(name) ?? false,
      }
      if (resolved.type === "array") {
        const items = unwrap(document, resolved.items)
        if (items.properties) {
          field.collection = items
          field.schemaName = schemaName(document, prop)
        }
      } else if (resolved.properties) {
        field.navigation = resolved
        field.schemaName = schemaName(document, prop)
      }
      return field
    })
}

export interface ResponseModel {
  /** Schema name of the whole response, e.g. GroupPaginationResult */
  responseName?: string
  /** The whole response when it is an object, e.g. an OData page or another API's paged result */
  response?: Schema
  /** Schema name of one row, e.g. Group */
  itemName?: string
  /** Schema of one row */
  item?: Schema
  /** Alternatives when a row can be one of several types (oneOf) */
  variants?: { name?: string; schema: Schema }[]
}

/** What an operation returns, for documentation */
export function getResponseModel(document: Document, operation: Operation): ResponseModel {
  const raw = rawResponseSchema(document, document.paths[operation.path]![operation.method]!)
  const item = getItemSchema(document, operation)
  let itemRaw: SchemaOrRef | undefined = raw
  const response = raw && resolve(document, raw)
  if (response?.type === "array")
    itemRaw = response.items
  else if (response?.properties?.value) {
    const value = unwrap(document, response.properties.value)
    itemRaw = value.type === "array" ? value.items : response.properties.value
  }
  const model: ResponseModel = {
    responseName: schemaName(document, raw),
    itemName: schemaName(document, itemRaw),
    item,
  }
  if (raw && response?.properties)
    model.response = unwrap(document, raw)
  const alternatives = item?.oneOf ?? item?.anyOf
  if (alternatives && alternatives.length > 1) {
    model.variants = alternatives.map((alt) => ({
      name: schemaName(document, alt),
      schema: unwrap(document, alt),
    }))
  }
  return model
}

/**
 * True when a related type leads back to a type further up the path (e.g. Group → users →
 * UserGroup → group: Group), which only repeats fields already shown. A direct self-reference
 * (Group → parent: Group) is a hierarchy, not a loop. ancestors: schema names from the root down
 * to the type containing the field.
 */
export function isBackReference(field: Field, ancestors: (string | undefined)[]) {
  const container = ancestors[ancestors.length - 1]
  return !!field.schemaName && field.schemaName !== container && ancestors.includes(field.schemaName)
}
