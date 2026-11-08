import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, state } from "lit/decorators.js"
import { groupOperations, type NavEntry, type TagGroup } from "../spec/grouping.js"
import { getGetOnly, setGetOnly } from "../getOnly.js"
import { isQuery, type Document, type Operation } from "../spec/openapi.js"

/** Lists operations grouped by tag. Emits "operation-selected" with the operation key */
@customElement("operation-browser")
export class OperationBrowser extends LitElement {
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
    .filters {
      display: flex;
      align-items: center;
      gap: var(--wa-space-s);
    }
    .filters wa-input {
      flex: 1;
      min-width: 0;
    }
    .filters wa-switch {
      white-space: nowrap;
    }
    wa-tree {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      --indent-size: var(--wa-space-s);
    }
    wa-tree-item::part(item) {
      cursor: pointer;
    }
    .op {
      display: grid;
      grid-template-columns: 2.5rem 1fr;
      column-gap: var(--wa-space-2xs);
      min-width: 0;
    }
    .op > :not(.method) {
      grid-column: 2;
    }
    .method {
      grid-row: 1 / span 2;
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-2xs);
      font-weight: var(--wa-font-weight-semibold);
      line-height: var(--wa-line-height-normal);
      padding-top: 0.15em;
    }
    .method.get {
      color: var(--wa-color-brand-on-quiet);
    }
    .method.post {
      color: var(--wa-color-success-on-quiet);
    }
    .method.put,
    .method.patch {
      color: var(--wa-color-warning-on-quiet);
    }
    .method.delete {
      color: var(--wa-color-danger-on-quiet);
    }
    .path {
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-s);
      word-break: break-all;
    }
    .summary {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-xs);
    }
    .folder > wa-icon {
      color: var(--wa-color-text-quiet);
    }
    .count {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-xs);
    }
  `

  @property({ attribute: false })
  operations: Operation[] = []

  /** The spec, for x-tagGroups */
  @property({ attribute: false })
  document?: Document

  @property()
  selectedKey = ""

  @state()
  private filter = ""

  /** Hide write operations; remembered in this browser */
  @state()
  private getOnly = getGetOnly()

  private nav: NavEntry[] = []

  protected willUpdate(changed: PropertyValues<this>) {
    // structure from all operations, so folders stay stable while filtering
    if ((changed.has("operations") || changed.has("document")) && this.document)
      this.nav = groupOperations(this.document, this.operations)
  }

  /**
   * Entries with only the operations matching the filter (and GET only), empty tags and folders
   * removed
   */
  private get filtered(): NavEntry[] {
    const filter = this.filter.trim().toLowerCase()
    if (!filter && !this.getOnly)
      return this.nav
    const matches = (op: Operation, folder = "") =>
      (!this.getOnly || isQuery(op)) &&
      `${folder} ${op.tag} ${op.method} ${op.path} ${op.operationId ?? ""} ${op.summary ?? ""}`
        .toLowerCase()
        .includes(filter)
    const filterGroup = (group: TagGroup, folder?: string): TagGroup | undefined => {
      const operations = group.operations.filter((op) => matches(op, folder))
      return operations.length ? { ...group, operations } : undefined
    }
    const result: NavEntry[] = []
    for (const entry of this.nav) {
      if (entry.kind === "tag") {
        const group = filterGroup(entry.group)
        if (group)
          result.push({ kind: "tag", group })
      } else {
        const tags = entry.folder.tags
          .map((g) => filterGroup(g, entry.folder.name))
          .filter((g): g is TagGroup => !!g)
        if (tags.length)
          result.push({ kind: "folder", folder: { ...entry.folder, tags } })
      }
    }
    return result
  }

  private onSelectionChange(e: CustomEvent<{ selection: HTMLElement[] }>) {
    const key = e.detail.selection[0]?.dataset.key
    if (!key)
      return
    this.dispatchEvent(new CustomEvent("operation-selected", { detail: key, bubbles: true, composed: true }))
  }

  private lastFilter = ""

  /**
   * Expanded state is set here rather than bound in the template: tree items created inside an
   * existing branch get their expanded state reset by wa-tree. When the filter changes, open the
   * matches (or only the path to the selected endpoint); otherwise just make sure that path is open
   * and leave manual expanding alone.
   */
  protected updated() {
    const filterChanged = this.filter !== this.lastFilter
    this.lastFilter = this.filter
    const filtering = this.filter.trim() !== ""
    requestAnimationFrame(() => {
      const groups = this.renderRoot.querySelectorAll<HTMLElement & { expanded: boolean }>(
        "wa-tree-item:not([data-key])",
      )
      for (const item of groups) {
        const hasSelected = !!this.selectedKey &&
          [...item.querySelectorAll<HTMLElement>("wa-tree-item[data-key]")].some(
            (op) => op.dataset.key === this.selectedKey,
          )
        if (filterChanged)
          item.expanded = filtering || hasSelected
        else if (hasSelected)
          item.expanded = true
      }
    })
  }

  private renderTag(group: TagGroup) {
    const ops = group.operations
    return html`
      <wa-tree-item>
        ${group.tag}&nbsp;<span class="count">(${ops.length})</span>
        ${ops.map(
          (op) => html`
            <wa-tree-item data-key=${op.key} ?selected=${op.key === this.selectedKey}>
              <div class="op">
                <span class="method ${op.method}">${op.method === "delete" ? "DEL" : op.method.toUpperCase()}</span>
                <span class="path">${op.path}</span>
                ${op.summary ? html`<span class="summary">${op.summary}</span>` : null}
              </div>
            </wa-tree-item>
          `,
        )}
      </wa-tree-item>
    `
  }

  render() {
    const entries = this.filtered
    return html`
      <div class="filters">
        <wa-input
          placeholder="Filter endpoints"
          with-clear
          size="s"
          .value=${this.filter}
          @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value ?? "")}
        >
          <wa-icon slot="start" name="magnifying-glass"></wa-icon>
        </wa-input>
        <wa-switch
          size="s"
          title="Show only GET endpoints (reads), hiding writes"
          .checked=${this.getOnly}
          @change=${(e: Event) => {
            this.getOnly = (e.target as HTMLInputElement).checked
            setGetOnly(this.getOnly)
          }}
        >
          GET only
        </wa-switch>
      </div>
      <wa-tree selection="leaf" @wa-selection-change=${this.onSelectionChange}>
        ${entries.map((entry) => {
          if (entry.kind === "tag")
            return this.renderTag(entry.group)
          const { folder } = entry
          const count = folder.tags.reduce((n, g) => n + g.operations.length, 0)
          return html`
            <wa-tree-item class="folder">
              <wa-icon name="folder"></wa-icon>&nbsp;${folder.name}&nbsp;<span class="count">(${count})</span>
              ${folder.tags.map((g) => this.renderTag(g))}
            </wa-tree-item>
          `
        })}
      </wa-tree>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "operation-browser": OperationBrowser
  }
}
