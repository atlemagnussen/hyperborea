export type Theme = "dark" | "light"

const storageKey = "hyperborea.theme"

export function getTheme(): Theme {
  try {
    if (localStorage.getItem(storageKey) === "light")
      return "light"
  } catch {
    // storage unavailable, use default
  }
  return "dark"
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("wa-dark", theme === "dark")
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // storage unavailable, choice only lasts until reload
  }
}

/** Applies the stored theme (dark by default) */
export function applyTheme() {
  document.documentElement.classList.toggle("wa-dark", getTheme() === "dark")
}
