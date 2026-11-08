import { HighlightStyle } from "@codemirror/language"
import { tags } from "@lezer/highlight"

/** Syntax colors from WebAwesome tokens, so they follow the light/dark theme */
export const highlightStyle = HighlightStyle.define([
  { tag: tags.string, color: "var(--wa-color-success-on-quiet)" },
  { tag: tags.number, color: "var(--wa-color-warning-on-quiet)" },
  { tag: [tags.keyword, tags.bool, tags.null], color: "var(--wa-color-brand-on-quiet)", fontWeight: "600" },
  { tag: tags.function(tags.variableName), color: "var(--wa-color-danger-on-quiet)" },
  { tag: tags.propertyName, color: "var(--wa-color-text-normal)" },
])
