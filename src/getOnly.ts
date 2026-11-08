// whether the endpoint tree shows only GET endpoints (reads), hiding writes
const storageKey = "hyperborea.getOnly"

/** Off by default */
export function getGetOnly() {
  try {
    return localStorage.getItem(storageKey) === "true"
  } catch {
    // storage unavailable, use default
    return false
  }
}

export function setGetOnly(on: boolean) {
  try {
    localStorage.setItem(storageKey, String(on))
  } catch {
    // storage unavailable, choice only lasts until reload
  }
}
