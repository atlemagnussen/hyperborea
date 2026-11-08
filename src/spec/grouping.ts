import type { Document, Operation } from "./openapi.js"

export interface TagGroup {
  tag: string
  operations: Operation[]
}

export interface Folder {
  name: string
  tags: TagGroup[]
}

/** Top level of the endpoint tree: a folder of related tags, or a single tag */
export type NavEntry = { kind: "folder"; folder: Folder } | { kind: "tag"; group: TagGroup }

// leading path segments that are not resources: /v2/..., /api/v1/...
const versionSegment = /^(v\d+(\.\d+)*|api)$/i

/** Folder key of a path: the first segment after version prefixes, e.g. /v2/checklists/x -> checklists */
export function folderKey(path: string) {
  const segments = path.split("/").filter(Boolean)
  return segments.find((s) => !versionSegment.test(s) && !s.startsWith("{")) ?? ""
}

/** Manual grouping from the x-tagGroups extension (Redoc): [{ name, tags: [...] }] */
function tagGroupsExtension(document: Document): Map<string, string> | undefined {
  const groups = (document as unknown as Record<string, unknown>)["x-tagGroups"]
  if (!Array.isArray(groups))
    return undefined
  const folderByTag = new Map<string, string>()
  for (const group of groups as { name?: unknown; tags?: unknown }[]) {
    if (typeof group.name === "string" && Array.isArray(group.tags))
      group.tags.forEach((tag) => typeof tag === "string" && folderByTag.set(tag, group.name as string))
  }
  return folderByTag
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" })

/**
 * Groups operations by tag, and related tags into folders.
 * Rule: tags whose endpoints share the first path segment (after /v2 etc.) form a folder when
 * there are 2 or more of them, e.g. ChecklistAnswers, ChecklistItems -> checklists.
 * A spec with x-tagGroups is grouped by that instead.
 */
export function groupOperations(document: Document, operations: Operation[]): NavEntry[] {
  const tags = new Map<string, Operation[]>()
  for (const op of operations) {
    const list = tags.get(op.tag) ?? []
    list.push(op)
    tags.set(op.tag, list)
  }

  let folderByTag = tagGroupsExtension(document)
  if (!folderByTag) {
    folderByTag = new Map()
    const tagsByKey = new Map<string, string[]>()
    for (const [tag, ops] of tags) {
      // the most common key among the tag's endpoints (normally they all share one)
      const counts = new Map<string, number>()
      ops.forEach((op) => counts.set(folderKey(op.path), (counts.get(folderKey(op.path)) ?? 0) + 1))
      const key = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      tagsByKey.set(key, [...(tagsByKey.get(key) ?? []), tag])
    }
    for (const [key, keyTags] of tagsByKey) {
      if (key && keyTags.length >= 2)
        keyTags.forEach((tag) => folderByTag!.set(tag, key))
    }
  }

  const folders = new Map<string, Folder>()
  const entries: NavEntry[] = []
  for (const [tag, ops] of tags) {
    const group: TagGroup = { tag, operations: ops }
    const folderName = folderByTag.get(tag)
    if (!folderName) {
      entries.push({ kind: "tag", group })
      continue
    }
    let folder = folders.get(folderName)
    if (!folder) {
      folder = { name: folderName, tags: [] }
      folders.set(folderName, folder)
      entries.push({ kind: "folder", folder })
    }
    folder.tags.push(group)
  }

  folders.forEach((f) => f.tags.sort((a, b) => byName(a.tag, b.tag)))
  const nameOf = (e: NavEntry) => (e.kind === "folder" ? e.folder.name : e.group.tag)
  return entries.sort((a, b) => byName(nameOf(a), nameOf(b)))
}
