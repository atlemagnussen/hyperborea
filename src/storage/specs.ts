import { run, storeNames } from "./db.js"

/** An OpenAPI spec url the user added in this browser, next to the configured HYPERBOREA_SPEC_URL ones */
export interface AddedSpec {
  url: string
  addedAt: string
}

const storeName = storeNames.specs

/** Oldest first, so the selector keeps the order they were added in */
export async function listAddedSpecs(): Promise<AddedSpec[]> {
  const specs = await run<AddedSpec[]>(storeName, "readonly", (store) => store.getAll())
  return specs.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

export async function addSpec(url: string): Promise<AddedSpec> {
  const spec: AddedSpec = { url, addedAt: new Date().toISOString() }
  await run(storeName, "readwrite", (store) => store.put(spec))
  return spec
}

export async function removeSpec(url: string) {
  await run(storeName, "readwrite", (store) => store.delete(url))
}
