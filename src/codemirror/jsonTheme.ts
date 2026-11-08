import { EditorView } from "@codemirror/view"

/** JSON viewer and body editor in WebAwesome colors, including the value action bar */
export const jsonTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--wa-color-surface-lowered)",
    color: "var(--wa-color-text-normal)",
    border: "var(--wa-border-width-s) solid var(--wa-color-surface-border)",
    borderRadius: "var(--wa-border-radius-m)",
    fontSize: "var(--wa-font-size-s)",
  },
  "&.cm-focused": { outline: "var(--wa-focus-ring)", outlineOffset: "var(--wa-focus-ring-offset)" },
  ".cm-content": { fontFamily: "var(--wa-font-family-code)", padding: "var(--wa-space-s) 0" },
  ".cm-gutters": {
    backgroundColor: "var(--wa-color-surface-lowered)",
    color: "var(--wa-color-text-quiet)",
    border: "none",
    borderRadius: "var(--wa-border-radius-m) 0 0 var(--wa-border-radius-m)",
  },
  ".cm-foldGutter .cm-gutterElement": { cursor: "pointer", padding: "0 4px" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--wa-color-neutral-fill-quiet)",
    color: "var(--wa-color-text-quiet)",
    border: "none",
    padding: "0 4px",
    cursor: "pointer",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--wa-color-brand-fill-quiet)" },
  ".cm-searchMatch": { backgroundColor: "var(--wa-color-warning-fill-quiet)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--wa-color-warning-fill-normal)" },
  ".cm-tooltip.cm-value-actions": {
    backgroundColor: "var(--wa-color-surface-raised)",
    border: "var(--wa-border-width-s) solid var(--wa-color-surface-border)",
    borderRadius: "var(--wa-border-radius-m)",
    boxShadow: "var(--wa-shadow-m)",
    padding: "2px",
    display: "flex",
    gap: "2px",
    fontFamily: "var(--wa-font-family-body)",
  },
  ".cm-tooltip.cm-value-actions .cm-tooltip-arrow:before": {
    borderTopColor: "var(--wa-color-surface-border)",
    borderBottomColor: "var(--wa-color-surface-border)",
  },
  ".cm-tooltip.cm-value-actions .cm-tooltip-arrow:after": {
    borderTopColor: "var(--wa-color-surface-raised)",
    borderBottomColor: "var(--wa-color-surface-raised)",
  },
  ".cm-panels": {
    backgroundColor: "var(--wa-color-surface-raised)",
    color: "var(--wa-color-text-normal)",
    borderColor: "var(--wa-color-surface-border)",
  },
})
