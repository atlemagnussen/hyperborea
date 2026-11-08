import { json } from "@codemirror/lang-json"
import {
  codeFolding,
  ensureSyntaxTree,
  foldEffect,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  unfoldAll,
} from "@codemirror/language"
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search"
import { EditorState, StateField, type StateEffect } from "@codemirror/state"
import { EditorView, keymap, lineNumbers, showTooltip, type Tooltip } from "@codemirror/view"
import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, query } from "lit/decorators.js"
import { highlightStyle } from "../codemirror/highlight.js"
import { jsonTheme } from "../codemirror/jsonTheme.js"
import { jsonTargetAt, type JsonTarget } from "../codemirror/jsonTarget.js"

/** An action offered for the value under the cursor, e.g. "add to $filter" */
export interface ValueAction {
  id: string
  label: string
  title?: string
}

/** Detail of the "value-action" event */
export interface ValueActionDetail {
  action: string
  target: JsonTarget
}

/**
 * Shows `level` levels and folds every object and array nested deeper: level 1 keeps the top
 * object open with its children collapsed, e.g. an OData page as `@odata.count` and `value: […]`
 */
function foldToLevel(view: EditorView, level: number) {
  const state = view.state
  // the whole document must be parsed to find all nesting
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)
  if (!tree)
    return
  unfoldAll(view)
  const effects: StateEffect<unknown>[] = []
  let depth = 0
  tree.iterate({
    enter: (node) => {
      if (node.name !== "Object" && node.name !== "Array")
        return
      if (depth >= level && node.to - node.from > 2) {
        // fold the inside, keeping the brackets: { … }
        effects.push(foldEffect.of({ from: node.from + 1, to: node.to - 1 }))
        return false
      }
      depth++
    },
    leave: (node) => {
      if (node.name === "Object" || node.name === "Array")
        depth--
    },
  })
  view.dispatch({ effects })
}

/** JSON in a read only CodeMirror: objects and arrays can be collapsed, Ctrl+F searches */
@customElement("json-view")
export class JsonView extends LitElement {
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
  `

  /** The JSON text to show */
  @property()
  text = ""

  /** Actions for the value under the cursor; none means no action bar */
  @property({ attribute: false })
  actionsFor?: (target: JsonTarget) => ValueAction[]

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

  protected updated(changed: PropertyValues<this>) {
    const view = this.view
    if (changed.has("text") && view && view.state.doc.toString() !== this.text)
      view.setState(this.createState())
  }

  private createState() {
    return EditorState.create({
      doc: this.text,
      extensions: [
        EditorState.readOnly.of(true),
        lineNumbers(),
        codeFolding({ placeholderText: "…" }),
        foldGutter(),
        json(),
        syntaxHighlighting(highlightStyle),
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([...searchKeymap, ...foldKeymap]),
        EditorView.lineWrapping,
        jsonTheme,
        this.valueActions(),
        EditorView.contentAttributes.of({ "aria-label": "Response body" }),
      ],
    })
  }

  /** A small action bar above the value under the cursor (click or keyboard), see actionsFor */
  private valueActions() {
    const tooltipsFor = (state: EditorState): readonly Tooltip[] => {
      const selection = state.selection.main
      // text selections are for copying, no action bar then
      if (!selection.empty || !this.actionsFor)
        return []
      const target = jsonTargetAt(state, selection.head)
      const actions = target ? this.actionsFor(target) : []
      if (!target || !actions.length)
        return []
      return [
        {
          pos: target.from,
          above: true,
          arrow: true,
          create: () => ({ dom: this.actionBar(target, actions) }),
        },
      ]
    }
    return StateField.define<readonly Tooltip[]>({
      create: tooltipsFor,
      update: (tooltips, tr) => (tr.docChanged || tr.selection ? tooltipsFor(tr.state) : tooltips),
      provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
    })
  }

  private actionBar(target: JsonTarget, actions: ValueAction[]) {
    const bar = document.createElement("div")
    bar.className = "cm-value-actions"
    bar.setAttribute("role", "toolbar")
    bar.setAttribute("aria-label", "Actions for this value")
    for (const action of actions) {
      const button = document.createElement("wa-button")
      button.setAttribute("size", "s")
      button.setAttribute("appearance", "plain")
      button.textContent = action.label
      if (action.title)
        button.title = action.title
      // keep the editor focus and cursor, so the bar stays where it is
      button.addEventListener("mousedown", (e) => e.preventDefault())
      button.addEventListener("click", () => {
        const detail: ValueActionDetail = { action: action.id, target }
        this.dispatchEvent(new CustomEvent("value-action", { detail, bubbles: true, composed: true }))
      })
      bar.append(button)
    }
    return bar
  }

  private createView() {
    this.view = new EditorView({ parent: this.container, root: this.shadowRoot!, state: this.createState() })
  }

  private run(action: (view: EditorView) => void) {
    if (this.view)
      action(this.view)
  }

  render() {
    return html`
      <div class="toolbar">
        <wa-button size="s" appearance="plain" @click=${() => this.run(unfoldAll)}>
          <wa-icon slot="start" name="angles-down"></wa-icon>
          Expand all
        </wa-button>
        <span>Show depth</span>
        ${[1, 2, 3].map(
          (level) => html`<wa-button
            size="s"
            appearance="plain"
            title=${`Collapse everything nested deeper than ${level}`}
            @click=${() => this.run((v) => foldToLevel(v, level))}
          >
            ${level}
          </wa-button>`,
        )}
      </div>
      <div class="editor"></div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "json-view": JsonView
  }
}
