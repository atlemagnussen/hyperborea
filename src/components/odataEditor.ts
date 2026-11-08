import {
  autocompletion,
  snippet,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { StreamLanguage, syntaxHighlighting } from "@codemirror/language"
import { EditorState, Prec } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, query } from "lit/decorators.js"
import { completionTheme } from "../codemirror/completionTheme.js"
import { highlightStyle } from "../codemirror/highlight.js"
import type { CompletionResult, Suggestion } from "../odata/filterCompletion.js"

export type CompleteFn = (textBeforeCursor: string) => CompletionResult | null

const keywords = /^(and|or|not|eq|ne|gt|ge|lt|le|in|has|true|false|null|with|as)\b/i

// minimal OData expression highlighting
const odataLanguage = StreamLanguage.define<null>({
  token(stream) {
    if (stream.eatSpace())
      return null
    if (stream.match(/^'([^']|'')*'?/))
      return "string"
    if (stream.match(/^-?\d[\w:.+-]*/))
      return "number"
    if (stream.match(keywords))
      return "keyword"
    if (stream.match(/^[A-Za-z_]\w*(?=\s*\()/))
      return "function"
    if (stream.match(/^[A-Za-z_][\w/.]*/))
      return "propertyName"
    stream.next()
    return "punctuation"
  },
})

// CodeMirror styles from WebAwesome tokens, so it follows the light/dark theme
const theme = EditorView.theme({
  "&": {
    backgroundColor: "var(--wa-form-control-background-color)",
    color: "var(--wa-form-control-value-color)",
    border: "var(--wa-form-control-border-width) var(--wa-form-control-border-style) var(--wa-form-control-border-color)",
    borderRadius: "var(--wa-form-control-border-radius)",
    fontSize: "var(--wa-font-size-m)",
  },
  "&.cm-focused": {
    outline: "var(--wa-focus-ring)",
    outlineOffset: "var(--wa-focus-ring-offset)",
  },
  ".cm-content": {
    fontFamily: "var(--wa-font-family-code)",
    // one line is exactly as tall as a WebAwesome input
    padding: "calc((var(--wa-form-control-height) - 1lh - 2 * var(--wa-form-control-border-width)) / 2) 0",
    minHeight: "var(--odata-editor-min-height, 1lh)",
    caretColor: "var(--wa-form-control-value-color)",
  },
  ".cm-line": { padding: "0 var(--wa-form-control-padding-inline)" },
  ".cm-placeholder": { color: "var(--wa-form-control-placeholder-color)" },
})

const completionType: Record<Suggestion["kind"], string> = {
  field: "property",
  navigation: "namespace",
  function: "function",
  operator: "keyword",
  keyword: "keyword",
  value: "constant",
}

/** Opens the completion list when the cursor is on the last visual line (an open list handles Arrow Down itself) */
function openOnLastLine(view: EditorView) {
  const head = view.state.selection.main.head
  const cursor = view.coordsAtPos(head)
  const end = view.coordsAtPos(view.state.doc.length)
  if (cursor && end && cursor.bottom < end.top + 1)
    return false
  return startCompletion(view)
}

/** Inserts the suggestion, then opens the completion again for what comes next */
function toCompletion(s: Suggestion): Completion {
  const reopen = (view: EditorView) => setTimeout(() => startCompletion(view))
  return {
    label: s.label,
    detail: s.detail,
    info: s.info,
    type: completionType[s.kind],
    boost: s.kind === "field" || s.kind === "navigation" ? 1 : 0,
    apply: (view, completion, from, to) => {
      if (s.snippet) {
        snippet(s.snippet)(view, completion, from, to)
      } else {
        const text = s.insert ?? `${s.label} `
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: "input.complete",
        })
      }
      if (s.reopen !== false)
        reopen(view)
    },
  }
}

/**
 * Text editor with OData autocomplete. Emits "input" like a native input; value holds the text.
 * Emits "submit" on Enter when no suggestion list is open.
 * The completion rules come from the complete property (see odata/filterCompletion.ts).
 */
@customElement("odata-editor")
export class OdataEditor extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      /* same label spacing as WebAwesome inputs */
      gap: var(--wa-space-xs);
    }
    label {
      color: var(--wa-form-control-label-color);
      font-weight: var(--wa-form-control-label-font-weight);
      line-height: var(--wa-form-control-label-line-height);
    }
    .field {
      position: relative;
    }
    /* room for the clear button at the end of the line */
    .field.clearable .cm-editor .cm-line {
      padding-inline-end: calc(var(--wa-form-control-padding-inline) + 1.5em);
    }
    /* looks like the clear button in wa-input */
    .clear {
      position: absolute;
      top: calc((var(--wa-form-control-height) - 1.5em) / 2);
      inset-inline-end: calc(var(--wa-form-control-padding-inline) - 0.125em);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1;
      height: 1.5em;
      font-size: var(--wa-font-size-m);
      color: var(--wa-color-neutral-on-quiet);
      border: none;
      border-radius: var(--wa-border-radius-s);
      background: none;
      padding: 0;
      transition: var(--wa-transition-normal) color;
      cursor: pointer;
    }
    .clear:hover {
      color: color-mix(in oklab, currentColor, var(--wa-color-mix-hover));
    }
    .clear:active {
      color: color-mix(in oklab, currentColor, var(--wa-color-mix-active));
    }
    .clear:focus-visible {
      outline: var(--wa-focus-ring);
      outline-offset: var(--wa-focus-ring-offset);
    }
    .hint {
      color: var(--wa-form-control-hint-color);
      font-size: var(--wa-font-size-s);
      line-height: var(--wa-form-control-hint-line-height);
    }
  `

  @property()
  label = ""

  @property()
  hint = ""

  @property()
  placeholder = ""

  @property()
  value = ""

  /** Shows a button that empties the editor when it has text, like wa-input */
  @property({ attribute: "with-clear", type: Boolean })
  withClear = false

  @property({ attribute: false })
  complete?: CompleteFn

  @query(".editor")
  private container!: HTMLDivElement

  private view?: EditorView

  protected firstUpdated() {
    this.createView()
  }

  connectedCallback() {
    super.connectedCallback()
    // re-attached after disconnectedCallback destroyed the view
    if (this.hasUpdated && !this.view)
      this.createView()
  }

  private createView() {
    const source = (context: CompletionContext) => {
      const text = context.state.doc.sliceString(0, context.pos)
      const result = this.complete?.(text)
      if (!result || !result.options.length)
        return null
      return { from: result.from, options: result.options.map(toCompletion), validFor: /^[\w']*$/ }
    }

    this.view = new EditorView({
      parent: this.container,
      root: this.shadowRoot!,
      state: EditorState.create({
        doc: this.value,
        extensions: [
          // Ctrl/Cmd+Enter belongs to the request editor (send), do not insert a line
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => true }])),
          // Enter accepts a suggestion when the list is open (higher precedence), else it
          // submits like a single line input; OData expressions need no line breaks
          Prec.high(keymap.of([{ key: "Enter", run: () => (this.dispatchEvent(new Event("submit")), true) }])),
          // Arrow Down opens the full list like a combobox; on a wrapped line above the last it
          // still moves the cursor down. Ctrl+Space works too (CodeMirror's default)
          Prec.high(keymap.of([{ key: "ArrowDown", run: openOnLastLine }])),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [source], icons: false }),
          EditorView.lineWrapping,
          placeholder(this.placeholder),
          odataLanguage,
          syntaxHighlighting(highlightStyle),
          theme,
          completionTheme,
          EditorView.contentAttributes.of({ "aria-label": this.label }),
          // a right-click outside the selection moves the cursor there, like in a text input, so
          // "Insert from token" (request editor) inserts where was clicked
          EditorView.domEventHandlers({
            contextmenu: (e, view) => {
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
              const { from, to } = view.state.selection.main
              if (pos !== null && (pos < from || pos > to))
                view.dispatch({ selection: { anchor: pos } })
              return false
            },
          }),
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

  protected updated(changed: PropertyValues<this>) {
    // value set from outside, e.g. switching operation
    const view = this.view
    if (changed.has("value") && view && view.state.doc.toString() !== this.value)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: this.value } })
  }

  /** Puts the cursor in the editor, like focus() on a WebAwesome input */
  focus() {
    this.view?.focus()
  }

  /** The text before the cursor, e.g. to decide how a value is written there */
  get textBeforeCursor() {
    const state = this.view?.state
    return state ? state.doc.sliceString(0, state.selection.main.from) : this.value
  }

  /** Replaces the selection (or inserts at the cursor) with text, and focuses the editor */
  insert(text: string) {
    const view = this.view
    if (!view)
      return
    // the update listener emits "input"
    view.dispatch(view.state.replaceSelection(text), { userEvent: "input", scrollIntoView: true })
    view.focus()
  }

  private clear() {
    const view = this.view
    if (!view)
      return
    // the update listener emits "input"
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" }, userEvent: "delete" })
    view.focus()
    // like wa-clear on WebAwesome inputs: cleared by the button, not by typing
    this.dispatchEvent(new Event("clear"))
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.view?.destroy()
    this.view = undefined
  }

  render() {
    return html`
      ${this.label ? html`<label @click=${() => this.view?.focus()}>${this.label}</label>` : null}
      <div class="field ${this.withClear ? "clearable" : ""}">
        <div class="editor"></div>
        ${this.withClear && this.value
          ? html`
              <button
                class="clear"
                type="button"
                aria-label="Clear entry"
                tabindex="-1"
                @mousedown=${(e: Event) => e.preventDefault()}
                @click=${this.clear}
              >
                <wa-icon name="circle-xmark" library="system" variant="regular"></wa-icon>
              </button>
            `
          : null}
      </div>
      ${this.hint ? html`<div class="hint">${this.hint}</div>` : null}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "odata-editor": OdataEditor
  }
}
