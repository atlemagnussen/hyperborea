import type { Operation } from "../spec/openapi.js"

export type ParameterValues = Record<string, string>

/** Key used for a parameter in ParameterValues */
export function paramKey(location: string, name: string) {
  return `${location}:${name}`
}

/** Key of the request body text in ParameterValues, so it is remembered and saved with them */
export const bodyKey = "body"

// characters that are valid in a query string and keep OData expressions readable
const readable: Record<string, string> = {
  "%24": "$",
  "%2C": ",",
  "%3A": ":",
  "%2F": "/",
  "%40": "@",
  // nested $expand options: users($select=name;$top=5)
  "%3D": "=",
  "%3B": ";",
}

function encodeQuery(value: string) {
  return encodeURIComponent(value).replace(/%24|%2C|%3A|%2F|%40|%3D|%3B/g, (m) => readable[m])
}

/**
 * Query parameters in values that the operation does not declare: custom ones the user added
 * (e.g. undocumented OData options) or that came with a next link
 */
export function customQueryNames(operation: Operation, values: ParameterValues) {
  const declared = new Set(operation.parameters.filter((p) => p.in === "query").map((p) => p.name))
  return Object.keys(values)
    .filter((key) => key.startsWith("query:"))
    .map((key) => key.slice("query:".length))
    .filter((name) => !declared.has(name))
}

/** Builds the full url. Empty values are left out; missing path params stay as {name} */
export function buildUrl(baseUrl: string, operation: Operation, values: ParameterValues) {
  const path = operation.path.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const value = values[paramKey("path", name)]
    return value ? encodeURIComponent(value) : match
  })

  // declared parameters in spec order, then custom ones in the order they were added
  const names = [
    ...operation.parameters.filter((p) => p.in === "query").map((p) => p.name),
    ...customQueryNames(operation, values),
  ]
  const query = names
    .map((name) => [name, values[paramKey("query", name)]] as const)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${encodeQuery(name)}=${encodeQuery(value)}`)
    .join("&")

  return `${baseUrl}${path}${query ? `?${query}` : ""}`
}

/**
 * Parameter values for an OData @odata.nextLink. The link is the complete next request: its query
 * parameters replace all current query values (e.g. $skip is dropped when it switches to
 * $skiptoken); path parameters are kept. Only the parameters are used, not the link's host, so the
 * url bar keeps showing the real request even when the server returns an internal host.
 * Parameters the operation does not declare become custom ones.
 */
export function valuesFromNextLink(values: ParameterValues, nextLink: string) {
  const next: ParameterValues = Object.fromEntries(
    Object.entries(values).filter(([key]) => !key.startsWith("query:")),
  )
  new URL(nextLink, "http://next.link").searchParams.forEach((value, name) => {
    next[paramKey("query", name)] = value
  })
  return next
}

export function missingRequired(operation: Operation, values: ParameterValues) {
  const missing = operation.parameters
    .filter((p) => p.required && !values[paramKey(p.in, p.name)])
    .map((p) => p.name)
  if (operation.requestBody?.required && !values[bodyKey]?.trim())
    missing.push("request body")
  return missing
}

export interface ResponseResult {
  url: string
  status: number
  statusText: string
  ok: boolean
  durationMs: number
  /** When the response arrived */
  receivedAt: Date
  sizeBytes: number
  contentType: string
  body: unknown
  rawText: string
}

export interface RequestOptions {
  method: string
  url: string
  token: string | null
  /** Body text, sent with requestType */
  requestBody?: string
  requestType?: string
  signal?: AbortSignal
}

export async function execute({ method, url, token, requestBody, requestType, signal }: RequestOptions) {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (token)
    headers.Authorization = `Bearer ${token}`
  if (requestBody !== undefined && requestType)
    headers["Content-Type"] = requestType

  const started = performance.now()
  const response = await fetch(url, { method: method.toUpperCase(), headers, body: requestBody, signal })
  const rawText = await response.text()
  const durationMs = performance.now() - started

  const contentType = response.headers.get("content-type") ?? ""
  let body: unknown = rawText
  if (contentType.includes("json") && rawText) {
    try {
      body = JSON.parse(rawText)
    } catch {
      // keep raw text
    }
  }

  const result: ResponseResult = {
    url,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    durationMs,
    receivedAt: new Date(),
    sizeBytes: new Blob([rawText]).size,
    contentType,
    body,
    rawText,
  }
  return result
}
