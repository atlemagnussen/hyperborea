// The app's IndexedDB database: per browser and per origin (so per deployment)
const dbName = "hyperborea"
// 2: added the specs store
const dbVersion = 2

export const storeNames = { savedQueries: "savedQueries", specs: "specs" } as const
export type StoreName = (typeof storeNames)[keyof typeof storeNames]

const keyPaths: Record<StoreName, string> = { savedQueries: "id", specs: "url" }

/** Opens a database, creating the stores it lacks (the former genericClient database has version 1) */
export function openNamed(name: string, version: number, stores: StoreName[]) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      for (const store of stores) {
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store, { keyPath: keyPaths[store] })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"))
  })
}

export function requestDone(request: IDBRequest | IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    if (request instanceof IDBTransaction)
      request.oncomplete = () => resolve()
    else
      request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

let dbPromise: Promise<IDBDatabase> | undefined
const onOpen: ((db: IDBDatabase) => Promise<void>)[] = []

/** Runs once after the database is first opened, before it is used (e.g. moving legacy data) */
export function afterOpen(action: (db: IDBDatabase) => Promise<void>) {
  onOpen.push(action)
}

export function openDb() {
  dbPromise ??= openNamed(dbName, dbVersion, Object.values(storeNames))
    .then(async (db) => {
      for (const action of onOpen)
        await action(db).catch((err) => console.warn("IndexedDB setup step failed", err))
      return db
    })
    .catch((err) => {
      dbPromise = undefined
      throw err
    })
  return dbPromise
}

export async function run<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(storeName, mode).objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })
}
