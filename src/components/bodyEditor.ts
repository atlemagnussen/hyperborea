import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { json } from "@codemirror/lang-json"
import { bracketMatching, codeFolding, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language"
import { search, searchKeymap } from "@codemirror/search"
import { EditorState, Prec } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, query, state } from "lit/decorators.js"
import { bodyCompletion } from "../codemirror/bodyCompletion.js"
import { completionTheme } from "../codemirror/completionTheme.js"
import { highlightStyle } from "../codemirror/highlight.js"
import { jsonTheme } from "../codemirror/jsonTheme.js"
import type { SchemaOrRef } from "../spec/fields.js"
import type { Document } from "../spec/openapi.js"

// an input to type in, not a viewer: form control background, and a scroll limit for long bodies
const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--wa-form-control-background-color)" },
  ".cm-gutters": { backgroundColor: "var(--wa-form-control-background-color)" },
  // CodeMirror's base theme makes the caret black, invisible on a dark background
  ".cm-content": { caretColor: "var(--wa-form-control-value-color)" },
  ".cm-scroller": { minHeight: "6lh", maxHeight: "60vh" },
})

/** Problem with JSON text, or "" when it parses (an empty body is allowed) */
function jsonError(text: string) {
  if (!text.trim())
    return ""
  try {
    JSON.parse(text)
    return ""
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Editor for a JSON request body. Emits "input" like a native input; value holds the text.
 * Emits "reset" when the user asks for the example body again.
 */
@customElement("body-editor")
export class BodyEditor extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-2xs);
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--wa-space-2xs);
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .label {
      color: var(--wa-form-control-label-color);
      font-weight: var(--wa-form-control-label-font-weight);
      font-size: var(--wa-font-size-m);
      margin-right: auto;
    }
    .type {
      font-family: var(--wa-font-family-code);
    }
    .error {
      color: var(--wa-color-danger-on-quiet);
      font-size: var(--wa-font-size-s);
    }
  `

  @property()
  label = "Body"

  @property()
  value = ""

  /** Media type sent, shown next to the label */
  @property()
  contentType = ""

  /** Spec and body schema, for suggestions of enum values and property names */
  @property({ attribute: false })
  document?: Document

  @property({ attribute: false })
  schema?: SchemaOrRef

  @state()
  private error = ""

  @query(".editor")
  private container!: HTMLDivElement

  private view?: EditorView

  protected firstUpdated() {
    this.createView()
  }

  connectedCallback() {
    super.connectedCallback()
    if (this.hasUpdated && !this.view)
      this.createView()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.view?.destroy()
    this.view = undefined
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("value"))
      this.error = jsonError(this.value)
  }

  protected updated(changed: PropertyValues<this>) {
    // value set from outside, e.g. switching operation or loading a saved request
    const view = this.view
    if (changed.has("value") && view && view.state.doc.toString() !== this.value)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: this.value } })
  }

  private createView() {
    this.view = new EditorView({
      parent: this.container,
      root: this.shadowRoot!,
      state: EditorState.create({
        doc: this.value,
        extensions: [
          // Ctrl/Cmd+Enter belongs to the request editor (send), do not insert a line
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => true }])),
          history(),
          closeBrackets(),
          bracketMatching(),
          autocompletion({
            override: [bodyCompletion(() => (this.document && this.schema ? { document: this.document, schema: this.schema } : undefined))],
            icons: false,
          }),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
          lineNumbers(),
          codeFolding({ placeholderText: "…" }),
          foldGutter(),
          json(),
          syntaxHighlighting(highlightStyle),
          search({ top: true }),
          EditorView.lineWrapping,
          jsonTheme,
          editorTheme,
          completionTheme,
          EditorView.contentAttributes.of({ "aria-label": this.label }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged)
              return
            this.value = update.state.doc.toString()
            this.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
          }),
        ],
      }),
    })
  }

  /** Re-indents valid JSON with 2 spaces */
  private format() {
    if (this.error || !this.value.trim() || !this.view)
      return
    const formatted = JSON.stringify(JSON.parse(this.value), null, 2)
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: formatted } })
  }

  render() {
    return html`
      <div class="toolbar">
        <span class="label">${this.label}</span>
        ${this.contentType ? html`<span class="type">${this.contentType}</span>` : null}
        <wa-button size="s" appearance="plain" ?disabled=${!!this.error} @click=${this.format}>
          <wa-icon slot="start" name="align-left"></wa-icon>
          Format
        </wa-button>
        <wa-button
          size="s"
          appearance="plain"
          title="Replace the body with an example built from the spec"
          @click=${() => this.dispatchEvent(new Event("reset"))}
        >
          <wa-icon slot="start" name="rotate-left"></wa-icon>
          Example
        </wa-button>
      </div>
      <div class="editor"></div>
      ${this.error ? html`<div class="error">Invalid JSON: ${this.error}</div>` : null}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "body-editor": BodyEditor
  }
}
