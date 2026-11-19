/**
 * 资料库：原作 / 我的前作 / 研究资料 / 灵感。
 * 索引在 references/index.json，正文存 references/sources/<id>.md。
 * 类型（kind）有语义：决定 AI 引用方式，必须可编辑。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { clone, isPlainObject } from './doc-store.js'

export const REFERENCE_KINDS = ['original', 'prior', 'research', 'idea']

export const REFERENCE_KIND_LABELS = {
  original: '原作',
  prior: '我的前作',
  research: '研究资料',
  idea: '灵感',
}

export const REFERENCE_KIND_DESCRIPTIONS = {
  original: '同人原作。AI 只借鉴世界观与人物设定，不复述原文，避免抄袭与侵权。',
  prior: '你以前的作品。AI 学习你的用词、节奏与句式习惯，用于统一文风。',
  research: '资料性材料。AI 只做事实与细节参考，不当作叙事模板。',
  idea: '灵感碎片。AI 可用于扩展与变体，允许发挥，不要求忠于原意。',
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : []
  const seen = new Set()
  const out = []
  for (const tag of list) {
    const value = String(tag ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= 10) break
  }
  return out
}

function now() {
  return new Date().toISOString()
}

function indexPath(store) {
  return store.path('references/index.json')
}

function readIndex(store) {
  const doc = store.read('references/index.json', { sources: [] })
  return {
    sources: (Array.isArray(doc?.sources) ? doc.sources : []).filter((item) => isPlainObject(item)),
    updatedAt: doc?.updatedAt ?? null,
  }
}

function writeIndex(store, sources) {
  store.write('references/index.json', { sources, updatedAt: now() })
}

function sourcePath(id) {
  return `references/sources/${id}.md`
}

function readContent(store, id) {
  const path = store.path(sourcePath(id))
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function listReferences(store) {
  const { sources, updatedAt } = readIndex(store)
  return {
    updatedAt,
    kinds: REFERENCE_KINDS.map((kind) => ({
      kind,
      label: REFERENCE_KIND_LABELS[kind],
      description: REFERENCE_KIND_DESCRIPTIONS[kind],
    })),
    sources: clone(sources).sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))),
  }
}

export function readReference(store, id) {
  const key = String(id ?? '')
  const source = readIndex(store).sources.find((item) => item.id === key)
  if (!source) return null
  return { ...clone(source), content: readContent(store, key) }
}

export function saveReference(store, input = {}) {
  const source = isPlainObject(input) ? input : {}
  const title = String(source.title ?? '').trim()
  if (!title) throw new Error('资料标题不能为空')
  const kind = REFERENCE_KINDS.includes(source.kind) ? source.kind : 'research'
  const requestedId = String(source.id ?? '').trim()
  const { sources } = readIndex(store)
  const existing = requestedId ? sources.find((item) => item.id === requestedId) : null
  const id = existing?.id ?? (requestedId || `ref-${Date.now()}-${randomUUID().slice(0, 8)}`)
  const content = String(source.content ?? '')
  mkdirSync(store.path('references/sources'), { recursive: true })
  writeFileSync(store.path(sourcePath(id)), content, 'utf8')
  const record = {
    id,
    title,
    kind,
    tags: normalizeTags(source.tags),
    note: source.note == null ? '' : String(source.note).slice(0, 500),
    source: source.source == null ? null : String(source.source).slice(0, 300),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  }
  const next = sources.filter((item) => item.id !== id)
  next.push(record)
  writeIndex(store, next)
  return { ...clone(record), content }
}

export function deleteReference(store, id) {
  const key = String(id ?? '')
  const { sources } = readIndex(store)
  const next = sources.filter((item) => item.id !== key)
  if (next.length === sources.length) return { deleted: false }
  writeIndex(store, next)
  const path = store.path(sourcePath(key))
  if (existsSync(path)) rmSync(path, { force: true })
  return { deleted: true }
}

/** 批量删除：一次写索引，逐个删正文文件；返回删除数量。 */
export function deleteReferences(store, ids = []) {
  const keys = new Set(ids.map((id) => String(id ?? '')))
  if (keys.size === 0) return { deleted: 0 }
  const { sources } = readIndex(store)
  const kept = sources.filter((item) => !keys.has(item.id))
  const deleted = sources.length - kept.length
  if (deleted === 0) return { deleted: 0 }
  writeIndex(store, kept)
  for (const id of keys) {
    const path = store.path(sourcePath(id))
    if (existsSync(path)) rmSync(path, { force: true })
  }
  return { deleted }
}
