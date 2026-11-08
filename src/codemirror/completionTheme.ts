import { EditorView } from "@codemirror/view"

/** The completion list (and other tooltips) in WebAwesome colors, follows the light/dark theme */
export const completionTheme = EditorView.theme({
  ".cm-tooltip": {
    backgroundColor: "var(--wa-color-surface-raised)",
    color: "var(--wa-color-text-normal)",
    border: "var(--wa-border-width-s) solid var(--wa-color-surface-border)",
    borderRadius: "var(--wa-border-radius-m)",
    boxShadow: "var(--wa-shadow-m)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--wa-font-family-code)",
    fontSize: "var(--wa-font-size-s)",
    maxHeight: "16em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 8px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--wa-color-brand-fill-loud)",
    color: "var(--wa-color-brand-on-loud)",
  },
  ".cm-completionDetail": { marginLeft: "1em", fontStyle: "normal", opacity: "0.7" },
  ".cm-completionInfo": { padding: "4px 8px", maxWidth: "24em", fontSize: "var(--wa-font-size-s)" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
})
