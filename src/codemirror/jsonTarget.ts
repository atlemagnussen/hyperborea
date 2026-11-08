import { syntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import type { SyntaxNode } from "@lezer/common"

/** A value in the JSON document: where it is and what it holds */
export interface JsonTarget {
  /** e.g. ["value", 3, "parent", "name"] */
  path: (string | number)[]
  /** Parsed value for primitives (string, number, boolean, null); undefined for objects/arrays */
  value: unknown
  primitive: boolean
  /** Document range of the value */
  from: number
  to: number
}

const primitives = new Set(["String", "Number", "True", "False", "Null"])
const values = new Set([...primitives, "Object", "Array"])

/** Path from the document root to a value node */
function pathOf(state: EditorState, node: SyntaxNode): (string | number)[] {
  const path: (string | number)[] = []
  let current: SyntaxNode = node
  while (current.parent) {
    const parent: SyntaxNode = current.parent
    if (parent.name === "Property") {
      const name = parent.firstChild!
      path.unshift(JSON.parse(state.sliceDoc(name.from, name.to)) as string)
    } else if (parent.name === "Array") {
      let index = 0
      for (let child = parent.firstChild; child && child.from < current.from; child = child.nextSibling)
        if (values.has(child.name))
          index++
      path.unshift(index)
    }
    current = parent
  }
  return path
}

/**
 * The value at a document position: the value of the property the cursor is on (also on its
 * name), or the array element under the cursor. Undefined outside values (brackets, commas).
 */
export function jsonTargetAt(state: EditorState, pos: number): JsonTarget | undefined {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1)
  let valueNode: SyntaxNode | undefined
  for (; node; node = node.parent) {
    if (node.name === "Property") {
      valueNode = node.lastChild && values.has(node.lastChild.name) ? node.lastChild : undefined
      break
    }
    if (values.has(node.name) && node.parent?.name === "Array") {
      valueNode = node
      break
    }
  }
  if (!valueNode)
    return undefined
  const primitive = primitives.has(valueNode.name)
  return {
    path: pathOf(state, valueNode),
    value: primitive ? JSON.parse(state.sliceDoc(valueNode.from, valueNode.to)) : undefined,
    primitive,
    from: valueNode.from,
    to: valueNode.to,
  }
}
