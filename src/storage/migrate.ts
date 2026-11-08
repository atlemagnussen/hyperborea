// One time move of browser storage from the client's former name (genericClient) to hyperborea.
// Imported first in main.ts, so it runs before anything reads storage. Remove once all browsers
// that used the old name have loaded the app.

const legacyPrefix = "genericClient."
const newPrefix = "hyperborea."
// keys renamed since, under either prefix (sessionStorage Authorization Code settings)
const renamed: Record<string, string> = { userLogin: "authorizationCode" }

function migrate(storage: Storage) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
  for (const key of keys) {
    const prefix = [legacyPrefix, newPrefix].find((p) => key?.startsWith(p))
    if (!key || !prefix)
      continue
    const name = key.slice(prefix.length)
    const newKey = newPrefix + (renamed[name] ?? name)
    if (newKey === key)
      continue
    if (storage.getItem(newKey) === null)
      storage.setItem(newKey, storage.getItem(key)!)
    storage.removeItem(key)
  }
}

try {
  migrate(localStorage)
  migrate(sessionStorage)
} catch {
  // storage unavailable: nothing to migrate
}
