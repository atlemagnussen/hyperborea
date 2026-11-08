// whether queries are sent automatically (selecting an endpoint or saved query, value actions)
const storageKey = "hyperborea.autoSend"

/** On by default */
export function getAutoSend() {
  try {
    return localStorage.getItem(storageKey) !== "false"
  } catch {
    // storage unavailable, use default
    return true
  }
}

export function setAutoSend(on: boolean) {
  try {
    localStorage.setItem(storageKey, String(on))
  } catch {
    // storage unavailable, choice only lasts until reload
  }
}
