import { css, html, LitElement } from "lit"
import { customElement, property, state } from "lit/decorators.js"
import type { Operation } from "../spec/openapi.js"
import {
  deleteQuery,
  listQueries,
  saveQuery,
  savedQueriesEvents,
  type SavedQuery,
} from "../storage/savedQueries.js"

/** Saved queries from IndexedDB. Emits "query-selected" with the SavedQuery */
@customElement("saved-query-list")
export class SavedQueryList extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-s);
      padding: var(--wa-space-s);
      box-sizing: border-box;
      height: 100%;
      min-height: 0;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      flex: 1;
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--wa-space-2xs);
      border-radius: var(--wa-border-radius-m);
    }
    li.selected {
      background: var(--wa-color-brand-fill-quiet);
    }
    li:hover:not(.selected) {
      background: var(--wa-color-neutral-fill-quiet);
    }
    .open {
      all: unset;
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      padding: var(--wa-space-xs) var(--wa-space-s);
      cursor: pointer;
    }
    .open:focus-visible {
      outline: var(--wa-focus-ring);
      border-radius: var(--wa-border-radius-m);
    }
    .open[disabled] {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .published {
      color: var(--wa-color-brand-on-quiet);
      margin-right: var(--wa-space-3xs);
    }
    .path {
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .confirm {
      display: flex;
      align-items: center;
      gap: var(--wa-space-2xs);
      padding-right: var(--wa-space-2xs);
      font-size: var(--wa-font-size-s);
    }
    /* the ⋯ menu shows on the selected or hovered row, or while in use; always on touch screens */
    @media (hover: hover) {
      li:not(.selected):not(:hover):not(:focus-within) .menu:not([open]) {
        opacity: 0;
      }
    }
    .empty {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      margin: var(--wa-space-s);
    }
  `

  @property({ attribute: false })
  operations: Operation[] = []

  /** Id of the query loaded in the editor */
  @property()
  selectedId = ""

  @state()
  private queries: SavedQuery[] = []

  @state()
  private filter = ""

  @state()
  private confirmDelete = ""

  @state()
  private error = ""

  private onChange = () => this.load()

  connectedCallback() {
    super.connectedCallback()
    savedQueriesEvents.addEventListener("change", this.onChange)
    this.load()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    savedQueriesEvents.removeEventListener("change", this.onChange)
  }

  private async load() {
    try {
      this.queries = await listQueries()
      this.error = ""
    } catch (err) {
      this.error = `Could not read saved requests: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private async deleteSaved(id: string) {
    this.confirmDelete = ""
    try {
      await deleteQuery(id)
    } catch (err) {
      this.error = `Could not delete: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  /** An action from a saved request's ⋯ menu */
  private async onMenu(query: SavedQuery, action: string) {
    if (action === "delete")
      this.confirmDelete = query.id
    else if (action === "open-chart")
      window.open(`/chart/${query.id}`, "_blank", "noopener")
    else if (action === "unpublish") {
      try {
        await saveQuery({ ...query, chart: undefined })
      } catch (err) {
        this.error = `Could not unpublish: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  private select(query: SavedQuery) {
    this.dispatchEvent(new CustomEvent("query-selected", { detail: query, bubbles: true, composed: true }))
  }

  render() {
    const filter = this.filter.trim().toLowerCase()
    const queries = this.queries.filter(
      (q) => !filter || `${q.name} ${q.operationKey}`.toLowerCase().includes(filter),
    )
    const known = new Set(this.operations.map((o) => o.key))
    return html`
      <wa-input
        placeholder="Filter saved requests"
        with-clear
        size="s"
        .value=${this.filter}
        @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value ?? "")}
      >
        <wa-icon slot="start" name="magnifying-glass"></wa-icon>
      </wa-input>
      ${this.error ? html`<wa-callout variant="danger" size="s">${this.error}</wa-callout>` : null}
      ${!this.queries.length && !this.error
        ? html`<p class="empty">No saved requests yet. Use Save next to Send to store one.</p>`
        : null}
      <ul>
        ${queries.map((q) => {
          const available = known.has(q.operationKey)
          return html`
            <li class=${q.id === this.selectedId ? "selected" : ""}>
              ${this.confirmDelete === q.id
                ? html`
                    <span class="open"><span class="name">Delete "${q.name}"?</span></span>
                    <span class="confirm">
                      <wa-button size="s" variant="danger" @click=${() => this.deleteSaved(q.id)}>Delete</wa-button>
                      <wa-button size="s" appearance="plain" @click=${() => (this.confirmDelete = "")}>
                        Cancel
                      </wa-button>
                    </span>
                  `
                : html`
                    <button
                      class="open"
                      ?disabled=${!available}
                      title=${available ? "" : "Endpoint not in the current spec"}
                      @click=${() => this.select(q)}
                    >
                      <span class="name">
                        ${q.chart
                          ? html`<wa-icon class="published" name="chart-column" label="Published chart"></wa-icon>`
                          : null}
                        ${q.name}
                      </span>
                      <span class="path">${q.operationKey}</span>
                    </button>
                    <wa-dropdown
                      class="menu"
                      placement="bottom-end"
                      @wa-select=${(e: CustomEvent<{ item: { value: string } }>) => this.onMenu(q, e.detail.item.value)}
                    >
                      <wa-button slot="trigger" size="s" appearance="plain" title="More actions">
                        <wa-icon name="ellipsis" label=${`Actions for ${q.name}`}></wa-icon>
                      </wa-button>
                      ${q.chart
                        ? html`
                            <wa-dropdown-item value="open-chart">
                              <wa-icon slot="icon" name="arrow-up-right-from-square"></wa-icon>
                              Open chart
                            </wa-dropdown-item>
                            <wa-dropdown-item value="unpublish">
                              <wa-icon slot="icon" name="eye-slash"></wa-icon>
                              Unpublish chart
                            </wa-dropdown-item>
                          `
                        : null}
                      <wa-dropdown-item value="delete" variant="danger">
                        <wa-icon slot="icon" name="trash"></wa-icon>
                        Delete…
                      </wa-dropdown-item>
                    </wa-dropdown>
                  `}
            </li>
          `
        })}
      </ul>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "saved-query-list": SavedQueryList
  }
}
