/** 素材库与事实库：story/materials.json、story/facts.json。 */
import { randomUUID } from 'node:crypto'
import { MATERIAL_KINDS, FACT_KINDS } from '../store.js'
import { clone, isPlainObject } from './doc-store.js'

const MATERIALS_FILE = 'materials.json'
const FACTS_FILE = 'facts.json'
const MATERIAL_TAGS_LIMIT = 10

function now() {
  return new Date().toISOString()
}

export function normalizeMaterialTags(tags) {
  const list = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(/[,，\s]+/) : [])
  const seen = new Set()
  const out = []
  for (const tag of list) {
    const value = String(tag ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= MATERIAL_TAGS_LIMIT) break
  }
  return out
}

/* ------------------------------ 素材 ------------------------------ */

function readMaterials(docStore) {
  const doc = docStore.read(MATERIALS_FILE, { materials: [] })
  return (Array.isArray(doc?.materials) ? doc.materials : []).filter((item) => isPlainObject(item))
}

export function listMaterials(docStore) {
  return clone(readMaterials(docStore)).sort((left, right) => {
    const a = String(left.updatedAt ?? '')
    const b = String(right.updatedAt ?? '')
    if (a !== b) return b.localeCompare(a)
    return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))
  })
}

export function readMaterial(docStore, id) {
  return clone(readMaterials(docStore).find((item) => item.id === String(id ?? '')) ?? null)
}

export function saveMaterial(docStore, input = {}) {
  const source = isPlainObject(input) ? input : {}
  const content = String(source.content ?? '')
  if (!content.trim()) throw new Error('素材内容不能为空')
  const kind = MATERIAL_KINDS.includes(source.kind) ? source.kind : '其他'
  const tags = normalizeMaterialTags(source.tags)
  const requestedId = String(source.id ?? '').trim()
  const existing = requestedId ? readMaterial(docStore, requestedId) : null
  const id = existing?.id ?? (requestedId || `mat-${Date.now()}-${randomUUID().slice(0, 8)}`)
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  const title = String(source.title ?? '').trim().slice(0, 120) || firstLine.slice(0, 120) || '未命名素材'
  const timestamp = now()
  const material = {
    id,
    title,
    kind,
    content,
    tags,
    source: source.source == null ? null : String(source.source).slice(0, 200),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  const materials = readMaterials(docStore).filter((item) => item.id !== id)
  materials.push(material)
  docStore.write(MATERIALS_FILE, { materials })
  return clone(material)
}

export function deleteMaterial(docStore, id) {
  const key = String(id ?? '')
  const materials = readMaterials(docStore)
  const next = materials.filter((item) => item.id !== key)
  if (next.length === materials.length) return false
  docStore.write(MATERIALS_FILE, { materials: next })
  return true
}

/* ------------------------------ 事实 ------------------------------ */

function readFacts(docStore) {
  const doc = docStore.read(FACTS_FILE, { facts: [] })
  return (Array.isArray(doc?.facts) ? doc.facts : []).filter((item) => isPlainObject(item))
}

function sortedFacts(facts) {
  return clone(facts).sort((left, right) => {
    const kindCompare = String(left.kind ?? '').localeCompare(String(right.kind ?? ''))
    if (kindCompare !== 0) return kindCompare
    return String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
  })
}

export function listFacts(docStore, filter = {}) {
  const facts = readFacts(docStore)
  if (filter.chapter == null) return sortedFacts(facts)
  const chapter = Number(filter.chapter)
  return sortedFacts(facts.filter((item) => item.chapter == null || Number(item.chapter) === chapter))
}

export function readFact(docStore, id) {
  return clone(readFacts(docStore).find((item) => item.id === String(id ?? '')) ?? null)
}

export function saveFact(docStore, input = {}) {
  const source = isPlainObject(input) ? input : {}
  const key = String(source.key ?? '').trim()
  const value = String(source.value ?? '').trim()
  if (!key) throw new Error('事实 key 不能为空')
  if (!value) throw new Error('事实 value 不能为空')
  const kind = FACT_KINDS.includes(source.kind) ? source.kind : '硬事实'
  const chapter = Number.isFinite(Number(source.chapter)) && Number(source.chapter) > 0 ? Number(source.chapter) : null
  const requestedId = String(source.id ?? '').trim()
  const existing = requestedId ? readFact(docStore, requestedId) : null
  const id = existing?.id ?? (requestedId || `fact-${Date.now()}-${randomUUID().slice(0, 8)}`)
  const fact = {
    id,
    chapter,
    kind,
    key,
    value,
    must: source.must == null ? true : Boolean(source.must),
    note: source.note == null ? null : String(source.note),
    updatedAt: now(),
  }
  const facts = readFacts(docStore).filter((item) => item.id !== id)
  facts.push(fact)
  docStore.write(FACTS_FILE, { facts })
  return clone(fact)
}

export function deleteFact(docStore, id) {
  const key = String(id ?? '')
  const facts = readFacts(docStore)
  const next = facts.filter((item) => item.id !== key)
  if (next.length === facts.length) return false
  docStore.write(FACTS_FILE, { facts: next })
  return true
}

export function glossaryFacts(docStore) {
  return listFacts(docStore)
    .filter((fact) => fact.kind === '术语' || fact.kind === '称呼')
    .map((fact) => ({
      id: fact.id,
      canonical: fact.kind === '称呼' ? fact.value : fact.key,
      aliases: fact.kind === '称呼'
        ? [fact.key]
        : String(fact.value).split(/[,，、\s]+/).map((alias) => alias.trim()).filter(Boolean),
      kind: fact.kind,
    }))
}
