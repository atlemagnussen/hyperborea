import type { AuthorizationCodeConfig } from "../auth/settings.js"
import type { ChartConfig } from "../chart/rows.js"
import type { ParameterValues } from "../request/request.js"
import { operationKey } from "../spec/openapi.js"
import { afterOpen, openNamed, requestDone, run as runIn, storeNames } from "./db.js"

/** A query the user saved: endpoint plus all parameter values (and the body of a write) */
export interface SavedQuery {
  id: string
  name: string
  /** Operation.key, e.g. "GET /v2/groups" */
  operationKey: string
  values: ParameterValues
  /** Spec the query was made against */
  specUrl: string
  createdAt: string
  updatedAt: string
  /** Set when the query's chart is published: shown on its own page, /chart/{id} */
  chart?: PublishedChart
}

/** A chart shown on its own page, see chartPage.ts */
export interface PublishedChart {
  title: string
  config: ChartConfig
  /**
   * The Authorization Code login it was published with (no secrets), so the chart page can log in
   * silently in a new tab. Missing when published while logged in with Client Credentials only
   */
  auth?: AuthorizationCodeConfig
  publishedAt: string
}

// POC storage: IndexedDB in this browser only, see db.ts
// the client's former name; its queries are moved over once, see moveLegacyQueries
const legacyDbName = "genericClient"
const storeName = storeNames.savedQueries

/** Copies the queries from the database under the former name, then deletes it */
async function moveLegacyQueries(db: IDBDatabase) {
  const databases = await indexedDB.databases?.().catch(() => [])
  if (!databases?.some((d) => d.name === legacyDbName))
    return
  const legacy = await openNamed(legacyDbName, 1, [storeName])
  const read = legacy.transaction(storeName, "readonly").objectStore(storeName).getAll()
  await requestDone(read)
  legacy.close()
  const write = db.transaction(storeName, "readwrite")
  for (const query of read.result as SavedQuery[])
    write.objectStore(storeName).put(query)
  await requestDone(write)
  indexedDB.deleteDatabase(legacyDbName)
}

afterOpen(moveLegacyQueries)

const run = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) =>
  runIn<T>(storeName, mode, action)

/** Fires "change" after a query was saved or deleted */
export const savedQueriesEvents = new EventTarget()

const changed = () => savedQueriesEvents.dispatchEvent(new Event("change"))

/** Queries saved when only GET was shown have the bare path as key */
const withMethod = (query: SavedQuery): SavedQuery =>
  query.operationKey.startsWith("/") ? { ...query, operationKey: operationKey("get", query.operationKey) } : query

export async function listQueries(): Promise<SavedQuery[]> {
  const queries = (await run<SavedQuery[]>("readonly", (store) => store.getAll())).map(withMethod)
  return queries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}

export async function getQuery(id: string): Promise<SavedQuery | undefined> {
  const query = await run<SavedQuery | undefined>("readonly", (store) => store.get(id))
  return query && withMethod(query)
}

/** Saves a new query, or updates the one with the given id */
export async function saveQuery(
  query: Omit<SavedQuery, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<SavedQuery> {
  const now = new Date().toISOString()
  const existing = query.id
    ? await run<SavedQuery | undefined>("readonly", (store) => store.get(query.id!))
    : undefined
  const saved: SavedQuery = {
    ...query,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await run("readwrite", (store) => store.put(saved))
  changed()
  return saved
}

export async function deleteQuery(id: string) {
  await run("readwrite", (store) => store.delete(id))
  changed()
}
