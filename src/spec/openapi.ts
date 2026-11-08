import type { OpenAPIV3 } from "openapi-types"

export type Document = OpenAPIV3.Document
export type Parameter = OpenAPIV3.ParameterObject
export type Schema = OpenAPIV3.SchemaObject

/** Methods shown as endpoints, in the order they are listed under a path */
export const methods = ["get", "post", "put", "patch", "delete"] as const
export type Method = (typeof methods)[number]

/** Request body of a write operation; only JSON bodies can be edited */
export interface RequestBody {
  /** The JSON media type to send, e.g. application/json; undefined when the spec offers none */
  contentType?: string
  /** All media types the spec lists, to explain a body that cannot be edited */
  contentTypes: string[]
  /** Unresolved, so the schema name stays visible */
  schema?: Schema | OpenAPIV3.ReferenceObject
  required: boolean
}

export interface Operation {
  /** Unique key: method and path, e.g. "GET /v2/groups" */
  key: string
  method: Method
  path: string
  tag: string
  operationId?: string
  summary?: string
  description?: string
  parameters: Parameter[]
  requestBody?: RequestBody
  /** Schema of the success (2xx) response, $refs at the top level resolved */
  responseSchema?: Schema
  /** Response is a list (array or OData { value: [...] }), as opposed to a single item */
  isCollection: boolean
}

export interface LoadedSpec {
  url: string
  document: Document
  title: string
  version: string
  apiBaseUrl: string
  operations: Operation[]
}

/**
 * A plain read: OData, value actions, paging, auto send and the views of rows only apply to GET.
 * Write operations are only sent when asked and show their response as JSON.
 */
export function isQuery(operation: Operation) {
  return operation.method === "get"
}

/** Key of an operation; saved queries from before other methods were shown hold only the path */
export function operationKey(method: Method, path: string) {
  return `${method.toUpperCase()} ${path}`
}

const cache = new Map<string, LoadedSpec>()

export async function loadSpec(specUrl: string, refresh = false) {
  const cached = cache.get(specUrl)
  if (cached && !refresh)
    return cached

  const response = await fetch(specUrl, {
    headers: { Accept: "application/json, application/yaml;q=0.9, */*;q=0.8" },
  })
  if (!response.ok)
    throw new Error(`Failed to load spec: ${response.status} ${response.statusText}`)
  const document = await parseSpec(await response.text())

  const spec: LoadedSpec = {
    url: specUrl,
    document,
    title: document.info?.title ?? specUrl,
    version: document.info?.version ?? "",
    apiBaseUrl: getBaseUrl(document, specUrl),
    operations: getOperations(document),
  }
  cache.set(specUrl, spec)
  return spec
}

/** Parses a spec in JSON or YAML (the YAML parser is loaded only when needed) and checks it is OpenAPI 3 */
async function parseSpec(text: string): Promise<Document> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    try {
      // core schema: no `<<` merge keys, which are not part of OpenAPI anyway
      const { load } = await import("js-yaml")
      parsed = load(text)
    } catch (err) {
      const reason = err instanceof Error ? err.message.split("\n")[0] : String(err)
      throw new Error(`The spec is neither valid JSON nor YAML: ${reason}`)
    }
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("The spec is not an OpenAPI document.")
  const { openapi, swagger } = parsed as { openapi?: unknown; swagger?: unknown }
  if (swagger !== undefined)
    throw new Error(`This is a Swagger ${String(swagger)} spec. Hyperborea supports OpenAPI 3.x only.`)
  if (typeof openapi !== "string" || !openapi.startsWith("3."))
    throw new Error(`Hyperborea supports OpenAPI 3.x only; this spec has no "openapi: 3.x" version.`)
  return parsed as Document
}

function getBaseUrl(document: Document, specUrl: string) {
  const server = document.servers?.[0]?.url
  // server urls may be relative to the spec location
  if (server)
    return new URL(server, specUrl).toString().replace(/\/$/, "")
  return new URL(specUrl).origin
}

function isRef(obj: unknown): obj is OpenAPIV3.ReferenceObject {
  return typeof obj === "object" && obj !== null && "$ref" in obj
}

/** Resolves a local $ref (#/components/...), following chained refs */
export function resolve<T>(document: Document, obj: T | OpenAPIV3.ReferenceObject): T {
  const seen = new Set<string>()
  let current: unknown = obj
  while (isRef(current)) {
    const ref = current.$ref
    if (!ref.startsWith("#/"))
      throw new Error(`Only local $refs are supported: ${ref}`)
    if (seen.has(ref))
      throw new Error(`Circular $ref: ${ref}`)
    seen.add(ref)

    current = ref
      .slice(2)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], document)
    if (current === undefined)
      throw new Error(`Unresolvable $ref: ${ref}`)
  }
  return current as T
}

function getOperations(document: Document): Operation[] {
  const operations: Operation[] = []
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of methods) {
      const operation = pathItem?.[method]
      if (!operation)
        continue

      // operation level parameters override path level ones with same name + location
      const parameters = new Map<string, Parameter>()
      for (const p of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
        const param = resolve(document, p)
        parameters.set(`${param.in}:${param.name}`, param)
      }

      const raw = rawResponseSchema(document, operation)
      const responseSchema = raw && resolve(document, raw)
      operations.push({
        key: operationKey(method, path),
        method,
        path,
        tag: operation.tags?.[0] ?? "default",
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        parameters: [...parameters.values()],
        requestBody: getRequestBody(document, operation),
        responseSchema,
        isCollection: isCollection(document, responseSchema),
      })
    }
  }
  return operations
}

// JSON media types: application/json, text/json, application/problem+json, application/*+json
const jsonType = /^(application|text)\/([\w.*-]+\+)?json\b/i

function getRequestBody(document: Document, operation: OpenAPIV3.OperationObject): RequestBody | undefined {
  if (!operation.requestBody)
    return undefined
  const body = resolve(document, operation.requestBody)
  const content = body.content ?? {}
  const contentTypes = Object.keys(content)
  // prefer plain application/json over text/json and wildcards like application/*+json
  const contentType = contentTypes.find((t) => t.toLowerCase() === "application/json") ??
    contentTypes.find((t) => jsonType.test(t) && !t.includes("*"))
  const schema = contentType ? content[contentType].schema : undefined
  return {
    contentType,
    contentTypes,
    schema,
    required: body.required ?? false,
  }
}

/** The success response: 200, else the first other 2xx (201 Created, ...), else default */
function successResponse(operation: OpenAPIV3.OperationObject) {
  const responses = operation.responses ?? {}
  const code = ["200", ...Object.keys(responses).filter((c) => /^2(\d\d|XX)$/i.test(c)).sort(), "default"]
    .find((c) => responses[c])
  return code ? responses[code] : undefined
}

/** Raw (unresolved) schema of the success JSON response, to find schema names */
export function rawResponseSchema(document: Document, operation: OpenAPIV3.OperationObject) {
  const ok = successResponse(operation)
  if (!ok)
    return undefined
  const content = resolve(document, ok).content ?? {}
  return (content["application/json"] ?? Object.values(content)[0])?.schema
}

function isCollection(document: Document, schema?: Schema) {
  if (!schema)
    return false
  if (schema.type === "array")
    return true
  const value = schema.properties?.value
  return value !== undefined && resolve(document, value).type === "array"
}

/** Type of a parameter, looking through nullable oneOf/allOf wrappers used by the union spec */
export function getParameterType(document: Document, param: Parameter) {
  if (!param.schema)
    return { type: "string" }
  let schema = resolve(document, param.schema)
  const inner = schema.oneOf ?? schema.allOf
  if (!schema.type && !schema.enum && inner?.length === 1)
    schema = resolve(document, inner[0])
  return {
    type: schema.type ?? "string",
    format: schema.format,
    enum: schema.enum?.map(String),
  }
}
