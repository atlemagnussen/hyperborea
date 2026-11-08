import { css, html, LitElement, type PropertyValues } from "lit"
import { customElement, property, state } from "lit/decorators.js"
import {
  getFields,
  getResponseModel,
  isBackReference,
  schemaName,
  unwrap,
  type Field,
  type ResponseModel,
} from "../spec/fields.js"
import type { Document, LoadedSpec, Operation, RequestBody, Schema } from "../spec/openapi.js"

/**
 * Documentation of what an operation takes (request body of a write) and returns: types and their
 * fields, related types expandable
 */
@customElement("model-view")
export class ModelView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    .summary {
      margin: 0;
    }
    h3 {
      margin: 0;
      font-size: var(--wa-font-size-m);
    }
    .name {
      font-family: var(--wa-font-family-code);
      font-weight: var(--wa-font-weight-semibold);
    }
    .quiet {
      color: var(--wa-color-text-quiet);
    }
    .fields {
      display: grid;
      grid-template-columns: minmax(12rem, max-content) minmax(8rem, max-content) 1fr;
      font-size: var(--wa-font-size-s);
    }
    .row {
      display: contents;
    }
    .row > * {
      padding: var(--wa-space-2xs) var(--wa-space-s);
      border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      min-width: 0;
    }
    .head > * {
      font-weight: var(--wa-font-weight-semibold);
      color: var(--wa-color-text-quiet);
    }
    .field {
      display: flex;
      align-items: center;
      gap: var(--wa-space-2xs);
      font-family: var(--wa-font-family-code);
      white-space: nowrap;
    }
    .toggle {
      all: unset;
      cursor: pointer;
      display: inline-flex;
      color: var(--wa-color-text-quiet);
    }
    .toggle:focus-visible {
      outline: var(--wa-focus-ring);
    }
    .spacer {
      display: inline-block;
      width: 1em;
    }
    .type {
      font-family: var(--wa-font-family-code);
      white-space: nowrap;
    }
    .loop {
      color: var(--wa-color-warning-on-quiet);
      cursor: help;
    }
    .related {
      color: var(--wa-color-brand-on-quiet);
    }
    .enum {
      display: flex;
      flex-wrap: wrap;
      gap: var(--wa-space-2xs);
      margin-top: var(--wa-space-2xs);
    }
  `

  @property({ attribute: false })
  spec?: LoadedSpec

  @property({ attribute: false })
  operation?: Operation

  /** Expanded rows by path, e.g. "parent" or "users/user" */
  @state()
  private expanded = new Set<string>()

  private model?: ResponseModel

  /** The list in a paged response object (OData value, or e.g. values of other APIs), shown expanded */
  private listField?: Field

  protected willUpdate(changed: PropertyValues<this>) {
    if ((changed.has("operation") || changed.has("spec")) && this.spec && this.operation) {
      this.model = getResponseModel(this.spec.document, this.operation)
      this.listField = this.model.variants ? undefined : findListField(this.spec.document, this.model.response)
      this.expanded = new Set(this.listField ? [this.listField.name] : [])
    }
  }

  private toggle(path: string) {
    const expanded = new Set(this.expanded)
    if (!expanded.delete(path))
      expanded.add(path)
    this.expanded = expanded
  }

  private typeOf(field: Field) {
    if (field.collection)
      return html`<span class="related">${field.schemaName ?? "object"}[]</span>`
    if (field.navigation)
      return html`<span class="related">${field.schemaName ?? "object"}</span>`
    if (field.enum)
      return "enum"
    return field.format ?? field.type
  }

  private renderFields(schema: Schema, path: string, depth: number, ancestors: (string | undefined)[]): unknown {
    // annotations like @odata.count are documented on the response itself, not on related types
    const fields = getFields(this.spec!.document, schema, !path)
    return fields.map((field) => {
      const fieldPath = path ? `${path}/${field.name}` : field.name
      const related = field.navigation ?? field.collection
      const open = this.expanded.has(fieldPath)
      const loop = isBackReference(field, ancestors)
      const loopId = `loop-${fieldPath.replace(/\W/g, "_")}`
      return html`
        <div class="row">
          <div class="field" style="padding-left: calc(var(--wa-space-s) + ${depth * 1.25}em)">
            ${related
              ? html`
                  <button
                    class="toggle"
                    aria-expanded=${open}
                    aria-label=${`${open ? "Collapse" : "Expand"} ${field.name}`}
                    @click=${() => this.toggle(fieldPath)}
                  >
                    <wa-icon name=${open ? "chevron-down" : "chevron-right"}></wa-icon>
                  </button>
                `
              : html`<span class="spacer"></span>`}
            ${field.name}
          </div>
          <div class="type">
            ${this.typeOf(field)}${loop
              ? html`<span class="loop" id=${loopId}> ↻</span>
                  <wa-tooltip for=${loopId}>
                    Back to ${field.schemaName}, already shown above: expanding repeats the same fields
                  </wa-tooltip>`
              : null}${field.nullable ? html`<span class="quiet"> · nullable</span>` : null}${field.required
              ? html`<span class="quiet"> · required</span>`
              : null}
          </div>
          <div>
            ${field.description ?? ""}
            ${field.enum
              ? html`<div class="enum">
                  ${field.enum.map((v) => html`<wa-tag size="s" variant="neutral">${v}</wa-tag>`)}
                </div>`
              : null}
          </div>
        </div>
        ${related && open
          ? this.renderFields(related, fieldPath, depth + 1, [...ancestors, field.schemaName])
          : null}
      `
    })
  }

  private renderTable(schema: Schema, rootName: string | undefined, path = "") {
    return html`
      <div class="fields" role="table">
        <div class="row head">
          <div>Field</div>
          <div>Type</div>
          <div>Description</div>
        </div>
        ${this.renderFields(schema, path, 0, [rootName])}
      </div>
    `
  }

  /** What a write sends: the body's type and fields, under "#request" in the expanded paths */
  private renderRequestBody(body: RequestBody) {
    if (!body.contentType || !body.schema)
      return html`<p class="summary">
        Takes a body of type ${body.contentTypes.join(", ") || "(none)"}, not described further.
      </p>`
    const document = this.spec!.document
    const schema = unwrap(document, body.schema)
    const name = schemaName(document, body.schema)
    const path = "#request"
    const optional = body.required ? "" : " (optional)"
    if (schema.type === "array") {
      const item = unwrap(document, schema.items)
      return html`
        <p class="summary">
          Takes a list of <span class="name">${name ?? item.type ?? "object"}</span>${optional}.
        </p>
        ${item.properties ? this.renderTable(item, name, path) : null}
      `
    }
    return html`
      <p class="summary">
        Takes <span class="name">${name ?? schema.format ?? schema.type ?? "object"}</span>${optional}.
      </p>
      ${schema.properties ? this.renderTable(schema, name, path) : null}
    `
  }

  render() {
    const op = this.operation
    if (!op || !this.model)
      return null
    if (!op.requestBody)
      return this.renderResponse(op, this.model)
    return html`
      <h3>Request body</h3>
      ${this.renderRequestBody(op.requestBody)}
      <h3>Response</h3>
      ${this.renderResponse(op, this.model)}
    `
  }

  private renderResponse(op: Operation, model: ResponseModel) {
    const item = model.item
    const typeName = model.itemName ?? (item?.properties ? "object" : item?.format ?? item?.type ?? "object")
    const name = html`<span class="name">${typeName}</span>`

    const list = this.listField
    let summary
    if (!item)
      summary = html`No JSON response described in the spec.`
    else if (list)
      summary = html`Returns ${model.responseName
        ? html`<span class="name">${model.responseName}</span>`
        : "an object"} with a list of <span class="name">${list.schemaName ?? "object"}</span> in
        <code>${list.name}</code>.`
    else if (model.variants)
      summary = html`Returns ${op.isCollection ? "a list where each item is" : "an item that is"} one of
        ${model.variants.length} types:`
    else if (op.isCollection)
      summary = html`Returns a list of ${name}.`
    else
      summary = html`Returns a single ${name}.`

    return html`
      <p class="summary">${summary}</p>
      ${model.variants
        ? html`
            ${model.variants.map((v, i) => {
              const path = `#${i}`
              const open = this.expanded.has(path)
              return html`
                <div>
                  <button class="toggle" aria-expanded=${open} @click=${() => this.toggle(path)}>
                    <wa-icon name=${open ? "chevron-down" : "chevron-right"}></wa-icon>
                    <span class="name">&nbsp;${v.name ?? `Variant ${i + 1}`}</span>
                  </button>
                  ${open ? this.renderTable(v.schema, v.name, path) : null}
                </div>
              `
            })}
          `
        : null}
      ${list
        ? this.renderTable(model.response!, model.responseName)
        : item?.properties
          ? this.renderTable(item, model.itemName)
          : null}
    `
  }
}

/**
 * The list of a paged response object: its only related collection, next to nothing but numbers
 * (count, page) and OData annotations. Matches OData pages ({ value, @odata.count }) and paged
 * results of APIs that name things differently (e.g. { total, page, values }), but not an entity
 * with a collection (e.g. { id, title, elements }).
 */
function findListField(document: Document, response: Schema | undefined) {
  const fields = getFields(document, response, true)
  const collections = fields.filter((f) => f.collection)
  const pageInfo = (f: Field) => f.name.includes("@") || f.type === "integer" || f.type === "number"
  if (collections.length !== 1 || !fields.every((f) => f.collection || pageInfo(f)))
    return undefined
  return collections[0]
}

declare global {
  interface HTMLElementTagNameMap {
    "model-view": ModelView
  }
}
