/**
 * 文件版 NovelStore：保持旧版 NovelStore 的同步方法签名与返回结构，内部改用 JSON 文档。
 * P1 覆盖：项目、提示词注入、自动化、构思、文风契约与模板、设定、关系、能力。
 * 其余方法在后续阶段补齐；未实现时抛错，避免静默返回错误数据。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MATERIAL_KINDS, FACT_KINDS } from './store.js'

export { MATERIAL_KINDS, FACT_KINDS }

const BIBLE_CATEGORIES = ['characters', 'locations', 'rules', 'factions', 'items']
const FILE_SCHEMA_VERSION = 1

function now() {
  return new Date().toISOString()
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class FileNovelStore {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this.root = join(projectRoot, 'story')
    this.cache = new Map()
  }

  /* ------------------------------ 基础读写（同步） ------------------------------ */

  path(relative) {
    return join(this.root, relative)
  }

  readDoc(relative, fallback = null) {
    if (this.cache.has(relative)) return clone(this.cache.get(relative))
    const target = this.path(relative)
    if (!existsSync(target)) {
      this.cache.set(relative, fallback)
      return clone(fallback)
    }
    try {
      const value = JSON.parse(readFileSync(target, 'utf8'))
      this.cache.set(relative, value)
      return clone(value)
    } catch {
      this.cache.set(relative, fallback)
      return clone(fallback)
    }
  }

  writeDoc(relative, value) {
    this.cache.set(relative, value)
    const target = this.path(relative)
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temp, target)
    return clone(value)
  }

  /* ------------------------------ 项目 ------------------------------ */

  readProject() {
    return this.readDoc('project.json', null)
  }

  writeProject(patch = {}) {
    const current = this.readDoc('project.json', {}) ?? {}
    const next = { ...current, ...clone(patch) }
    return this.writeDoc('project.json', next)
  }

  readProjectPrompt() {
    return this.readDoc('project.json', null)?.prompt ?? null
  }

  writeProjectPrompt(value) {
    const current = this.readDoc('project.json', {}) ?? {}
    this.writeDoc('project.json', { ...current, prompt: clone(value) })
    return this.readProjectPrompt()
  }

  readAutomation() {
    return this.readDoc('project.json', null)?.automation ?? null
  }

  writeAutomation(value) {
    const current = this.readDoc('project.json', {}) ?? {}
    this.writeDoc('project.json', { ...current, automation: clone(value) })
    return this.readAutomation()
  }

  /* ------------------------------ 构思 ------------------------------ */

  readPremise() {
    return this.readDoc('premise.json', null)
  }

  writePremise(value = {}) {
    const source = isObject(value) ? value : {}
    const next = {
      status: source.status ?? 'candidate',
      candidates: Array.isArray(source.candidates) ? clone(source.candidates) : [],
      chosen: source.chosen === undefined ? null : clone(source.chosen),
      chosenHash: source.chosenHash ?? null,
      updatedAt: source.updatedAt ?? now(),
    }
    for (const [key, item] of Object.entries(source)) {
      if (!(key in next)) next[key] = clone(item)
    }
    this.writeDoc('premise.json', next)
    return this.readPremise()
  }

  deletePremise() {
    this.writeDoc('premise.json', null)
    return true
  }

  /* ------------------------------ 文风 ------------------------------ */

  readStyleContract() {
    return this.readDoc('style/contract.json', null)
  }

  writeStyleContract(value = {}) {
    const source = isObject(value) ? value : {}
    const next = {
      status: source.status ?? 'candidate',
      templateId: source.templateId ?? null,
      fields: isObject(source.fields) ? clone(source.fields) : {},
      samples: Array.isArray(source.samples) ? clone(source.samples) : [],
      fieldsHash: source.fieldsHash ?? null,
      updatedAt: source.updatedAt ?? now(),
    }
    for (const [key, item] of Object.entries(source)) {
      if (!(key in next)) next[key] = clone(item)
    }
    this.writeDoc('style/contract.json', next)
    return this.readStyleContract()
  }

  deleteStyleContract() {
    this.writeDoc('style/contract.json', null)
    return true
  }

  listStyleTemplates() {
    const doc = this.readDoc('style/templates.json', { templates: [] })
    const list = Array.isArray(doc?.templates) ? doc.templates : []
    return clone(list).sort((left, right) => {
      const a = String(left.createdAt ?? '')
      const b = String(right.createdAt ?? '')
      return a === b ? String(left.id).localeCompare(String(right.id)) : a.localeCompare(b)
    })
  }

  saveStyleTemplate(template = {}) {
    const source = isObject(template) ? template : {}
    const id = String(source.id ?? '')
    if (!id) throw new Error('文风模板缺少 id')
    const next = {
      id,
      name: String(source.name ?? id),
      group: String(source.group ?? '自定义'),
      description: String(source.description ?? ''),
      tags: Array.isArray(source.tags) ? clone(source.tags) : [],
      fields: isObject(source.fields) ? clone(source.fields) : {},
      samples: Array.isArray(source.samples) ? clone(source.samples) : [],
      createdAt: source.createdAt ?? now(),
    }
    const doc = this.readDoc('style/templates.json', { templates: [] })
    const templates = (Array.isArray(doc?.templates) ? doc.templates : []).filter((item) => item.id !== id)
    templates.push(next)
    this.writeDoc('style/templates.json', { templates })
    return this.listStyleTemplates().find((item) => item.id === id) ?? null
  }

  deleteStyleTemplate(id) {
    const key = String(id ?? '')
    const doc = this.readDoc('style/templates.json', { templates: [] })
    const before = Array.isArray(doc?.templates) ? doc.templates : []
    const templates = before.filter((item) => item.id !== key)
    this.writeDoc('style/templates.json', { templates })
    return { deleted: key, changes: before.length === templates.length ? 0 : 1 }
  }

  /* ------------------------------ 设定 ------------------------------ */

  readBible() {
    const doc = this.readDoc('bible/entries.json', null)
    const data = {
      status: doc?.status ?? 'missing',
      updatedAt: doc?.updatedAt ?? null,
      confirmedAt: doc?.confirmedAt ?? null,
    }
    for (const category of BIBLE_CATEGORIES) {
      data[category] = Array.isArray(doc?.[category]) ? clone(doc[category]) : []
    }
    for (const [key, item] of Object.entries(doc ?? {})) {
      if (!(key in data)) data[key] = clone(item)
    }
    return data
  }

  writeBible(value = {}) {
    const source = isObject(value) ? value : {}
    const next = {
      status: source.status ?? 'missing',
      updatedAt: source.updatedAt ?? now(),
      confirmedAt: source.confirmedAt ?? null,
    }
    for (const category of BIBLE_CATEGORIES) {
      next[category] = Array.isArray(source[category]) ? clone(source[category]) : []
    }
    for (const [key, item] of Object.entries(source)) {
      if (!(key in next)) next[key] = clone(item)
    }
    this.writeDoc('bible/entries.json', next)
    return this.readBible()
  }

  readRelations() {
    const doc = this.readDoc('bible/relations.json', null)
    return {
      status: doc?.status ?? 'candidate',
      relations: Array.isArray(doc?.relations) ? clone(doc.relations) : [],
      positions: isObject(doc?.positions) ? clone(doc.positions) : {},
      updatedAt: doc?.updatedAt ?? null,
    }
  }

  writeRelations(value = {}) {
    const source = isObject(value) ? value : {}
    const next = {
      status: source.status ?? 'candidate',
      relations: Array.isArray(source.relations) ? clone(source.relations) : [],
      positions: isObject(source.positions) ? clone(source.positions) : {},
      updatedAt: source.updatedAt ?? now(),
    }
    for (const [key, item] of Object.entries(source)) {
      if (!(key in next)) next[key] = clone(item)
    }
    this.writeDoc('bible/relations.json', next)
    return this.readRelations()
  }

  /* ------------------------------ 能力体系 ------------------------------ */

  readPower() {
    return this.readDoc('power.json', null)
  }

  writePower(value) {
    this.writeDoc('power.json', clone(value ?? null))
    return this.readPower()
  }

  /* ------------------------------ 后续阶段占位 ------------------------------ */

  unsupported(name) {
    throw new Error(`file-store 尚未实现 ${name}（P2/P3 阶段补齐）`)
  }

  readOutline() { return this.unsupported('readOutline') }
  writeOutline() { return this.unsupported('writeOutline') }
  readChapterMeta() { return this.unsupported('readChapterMeta') }
  writeChapterMeta() { return this.unsupported('writeChapterMeta') }
  setChapterProseFlags() { return this.unsupported('setChapterProseFlags') }
  listChapterProseFlags() { return this.unsupported('listChapterProseFlags') }
  readChapterQa() { return this.unsupported('readChapterQa') }
  writeChapterQa() { return this.unsupported('writeChapterQa') }
  readChapterState() { return this.unsupported('readChapterState') }
  writeChapterState() { return this.unsupported('writeChapterState') }
  readChapterSummary() { return this.unsupported('readChapterSummary') }
  writeChapterSummary() { return this.unsupported('writeChapterSummary') }
  listChapterStates() { return this.unsupported('listChapterStates') }
  listChapterSummaries() { return this.unsupported('listChapterSummaries') }
  readStateIndex() { return this.unsupported('readStateIndex') }
  writeStateMeta() { return this.unsupported('writeStateMeta') }
  writeStateIndex() { return this.unsupported('writeStateIndex') }
  deleteChapterRows() { return this.unsupported('deleteChapterRows') }
  deleteOutlineChapter() { return this.unsupported('deleteOutlineChapter') }
  renameChapterRows() { return this.unsupported('renameChapterRows') }
  readStats() { return this.unsupported('readStats') }
  appendStatsEvent() { return this.unsupported('appendStatsEvent') }
  writeStats() { return this.unsupported('writeStats') }
  saveRun() { return this.unsupported('saveRun') }
  readRun() { return this.unsupported('readRun') }
  listRuns() { return this.unsupported('listRuns') }
  pruneRuns() { return this.unsupported('pruneRuns') }
  readPromptOverrides() { return this.unsupported('readPromptOverrides') }
  writePromptOverride() { return this.unsupported('writePromptOverride') }
  deletePromptOverride() { return this.unsupported('deletePromptOverride') }
  listNotes() { return this.unsupported('listNotes') }
  appendNote() { return this.unsupported('appendNote') }
  replaceNotes() { return this.unsupported('replaceNotes') }
  search() { return this.unsupported('search') }
  reindexChapter() { return this.unsupported('reindexChapter') }
  reindexOutline() { return this.unsupported('reindexOutline') }
  reindexBible() { return this.unsupported('reindexBible') }
  reindexSummaries() { return this.unsupported('reindexSummaries') }
  reindexAll() { return this.unsupported('reindexAll') }
  ftsRowCounts() { return this.unsupported('ftsRowCounts') }
  ftsQuery() { return this.unsupported('ftsQuery') }
  listMaterials() { return this.unsupported('listMaterials') }
  readMaterial() { return this.unsupported('readMaterial') }
  saveMaterial() { return this.unsupported('saveMaterial') }
  deleteMaterial() { return this.unsupported('deleteMaterial') }
  listFacts() { return this.unsupported('listFacts') }
  readFact() { return this.unsupported('readFact') }
  saveFact() { return this.unsupported('saveFact') }
  deleteFact() { return this.unsupported('deleteFact') }
  glossaryFacts() { return this.unsupported('glossaryFacts') }
  readChapterBody() { return this.unsupported('readChapterBody') }

  checkpoint() {
    return { checkpointed: false }
  }

  schemaVersion() {
    return FILE_SCHEMA_VERSION
  }

  close() {}
}
