/**
 * 文件版 NovelStore：保持旧版 NovelStore 的同步方法签名与返回结构，内部改用 JSON 文档。
 * 代码组织：DocStore 负责同步读写与缓存；大纲、章节状态各自一个领域模块；
 * 其余领域（项目/构思/文风/设定/关系/能力）在本类内，P3 领域先显式失败。
 */
import { join } from 'node:path'
import { DocStore, clone, isPlainObject } from './storage/doc-store.js'
import { readOutline, writeOutline, deleteOutlineChapterByNumber } from './storage/outline.js'
import * as chapterState from './storage/chapter-state.js'
import * as library from './storage/library.js'
import * as logs from './storage/logs.js'
import * as searchIndex from './storage/search.js'
import * as references from './storage/references.js'
import { MATERIAL_KINDS, FACT_KINDS } from './store.js'

export { MATERIAL_KINDS, FACT_KINDS }

const BIBLE_CATEGORIES = ['characters', 'locations', 'rules', 'factions', 'items']
/** 兼容等级：旧上层按 schema v5 判断能力（正文标记、摘要、事实、素材），文件存储已全部支持。 */
const FILE_SCHEMA_VERSION = 5

function now() {
  return new Date().toISOString()
}

export class FileNovelStore {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this.docs = new DocStore(join(projectRoot, 'story'))
  }

  /** 事务：与旧版 store.tx 对齐（延迟写入、失败回滚）。 */
  tx(fn) {
    return this.docs.transaction(fn)
  }

  /* ------------------------------ 项目 ------------------------------ */

  readProject() {
    return this.docs.read('project.json', null)
  }

  writeProject(patch = {}) {
    const current = this.readProject() ?? {}
    return this.docs.write('project.json', { ...current, ...clone(patch) })
  }

  readProjectPrompt() {
    return this.readProject()?.prompt ?? null
  }

  writeProjectPrompt(value) {
    const current = this.readProject() ?? {}
    this.docs.write('project.json', { ...current, prompt: clone(value) })
    return this.readProjectPrompt()
  }

  readAutomation() {
    return this.readProject()?.automation ?? null
  }

  writeAutomation(value) {
    const current = this.readProject() ?? {}
    this.docs.write('project.json', { ...current, automation: clone(value) })
    return this.readAutomation()
  }

  /* ------------------------------ 构思 ------------------------------ */

  readPremise() {
    return this.docs.read('premise.json', null)
  }

  writePremise(value = {}) {
    const source = isPlainObject(value) ? value : {}
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
    return this.docs.write('premise.json', next)
  }

  deletePremise() {
    this.docs.remove('premise.json')
    return true
  }

  /* ------------------------------ 文风 ------------------------------ */

  readStyleContract() {
    return this.docs.read('style/contract.json', null)
  }

  writeStyleContract(value = {}) {
    const source = isPlainObject(value) ? value : {}
    const next = {
      status: source.status ?? 'candidate',
      templateId: source.templateId ?? null,
      fields: isPlainObject(source.fields) ? clone(source.fields) : {},
      samples: Array.isArray(source.samples) ? clone(source.samples) : [],
      fieldsHash: source.fieldsHash ?? null,
      updatedAt: source.updatedAt ?? now(),
    }
    for (const [key, item] of Object.entries(source)) {
      if (!(key in next)) next[key] = clone(item)
    }
    return this.docs.write('style/contract.json', next)
  }

  deleteStyleContract() {
    this.docs.remove('style/contract.json')
    return true
  }

  listStyleTemplates() {
    const doc = this.docs.read('style/templates.json', { templates: [] })
    const list = Array.isArray(doc?.templates) ? doc.templates : []
    return clone(list).sort((left, right) => {
      const a = String(left.createdAt ?? '')
      const b = String(right.createdAt ?? '')
      return a === b ? String(left.id).localeCompare(String(right.id)) : a.localeCompare(b)
    })
  }

  saveStyleTemplate(template = {}) {
    const source = isPlainObject(template) ? template : {}
    const id = String(source.id ?? '')
    if (!id) throw new Error('文风模板缺少 id')
    const next = {
      id,
      name: String(source.name ?? id),
      group: String(source.group ?? '自定义'),
      description: String(source.description ?? ''),
      tags: Array.isArray(source.tags) ? clone(source.tags) : [],
      fields: isPlainObject(source.fields) ? clone(source.fields) : {},
      samples: Array.isArray(source.samples) ? clone(source.samples) : [],
      createdAt: source.createdAt ?? now(),
    }
    const doc = this.docs.read('style/templates.json', { templates: [] })
    const templates = (Array.isArray(doc?.templates) ? doc.templates : []).filter((item) => item.id !== id)
    templates.push(next)
    this.docs.write('style/templates.json', { templates })
    return this.listStyleTemplates().find((item) => item.id === id) ?? null
  }

  deleteStyleTemplate(id) {
    const key = String(id ?? '')
    const doc = this.docs.read('style/templates.json', { templates: [] })
    const before = Array.isArray(doc?.templates) ? doc.templates : []
    const templates = before.filter((item) => item.id !== key)
    this.docs.write('style/templates.json', { templates })
    return { deleted: key, changes: before.length === templates.length ? 0 : 1 }
  }

  /* ------------------------------ 设定 ------------------------------ */

  readBible() {
    // 兼容旧版纯 JSON 项目：设定曾写在 story/bible/index.json。
    const doc = this.docs.read('bible/entries.json', null) ?? this.docs.read('bible/index.json', null)
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
    const source = isPlainObject(value) ? value : {}
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
    return this.docs.write('bible/entries.json', next)
  }

  readRelations() {
    const doc = this.docs.read('bible/relations.json', null)
    return {
      status: doc?.status ?? 'candidate',
      relations: Array.isArray(doc?.relations) ? clone(doc.relations) : [],
      positions: isPlainObject(doc?.positions) ? clone(doc.positions) : {},
      updatedAt: doc?.updatedAt ?? null,
    }
  }

  writeRelations(value = {}) {
    const source = isPlainObject(value) ? value : {}
    const next = {
      status: source.status ?? 'candidate',
      relations: Array.isArray(source.relations) ? clone(source.relations) : [],
      positions: isPlainObject(source.positions) ? clone(source.positions) : {},
      updatedAt: source.updatedAt ?? now(),
    }
    for (const [key, item] of Object.entries(source)) {
      if (!(key in next)) next[key] = clone(item)
    }
    return this.docs.write('bible/relations.json', next)
  }

  /* ------------------------------ 能力体系 ------------------------------ */

  readPower() {
    return this.docs.read('power.json', null)
  }

  writePower(value) {
    this.docs.write('power.json', clone(value ?? null))
    return this.readPower()
  }

  /* ------------------------------ 大纲 ------------------------------ */

  readOutline() {
    return readOutline(this.docs)
  }

  writeOutline(value) {
    return writeOutline(this.docs, value)
  }

  deleteOutlineChapter(number) {
    return deleteOutlineChapterByNumber(this.docs, number)
  }

  /* ------------------------------ 章节状态 ------------------------------ */

  readChapterMeta(number) { return chapterState.readChapterMeta(this.docs, number) }
  writeChapterMeta(number, value) { return chapterState.writeChapterMeta(this.docs, number, value) }
  setChapterProseFlags(number, flags) { return chapterState.setChapterProseFlags(this.docs, number, flags) }
  listChapterProseFlags() { return chapterState.listChapterProseFlags(this.docs) }
  readChapterQa(number) { return chapterState.readChapterQa(this.docs, number) }
  writeChapterQa(number, value) { return chapterState.writeChapterQa(this.docs, number, value) }
  readChapterState(number) { return chapterState.readChapterState(this.docs, number) }
  writeChapterState(number, value) { return chapterState.writeChapterState(this.docs, number, value) }
  readChapterSummary(number) { return chapterState.readChapterSummary(this.docs, number) }
  writeChapterSummary(number, value) { return chapterState.writeChapterSummary(this.docs, number, value) }
  listChapterStates() { return chapterState.listChapterStates(this.docs) }
  listChapterSummaries() { return chapterState.listChapterSummaries(this.docs) }
  readStateIndex() { return chapterState.readStateIndex(this.docs) }
  writeStateMeta(updatedAt) { return chapterState.writeStateMeta(this.docs, updatedAt) }
  writeStateIndex(value) { return chapterState.writeStateIndex(this.docs, value) }
  deleteChapterRows(number) { return chapterState.deleteChapterRows(this.docs, number) }
  renameChapterRows(from, to) { return chapterState.renameChapterRows(this.docs, from, to) }

  /* ------------------------------ 素材与事实 ------------------------------ */

  listMaterials() { return library.listMaterials(this.docs) }
  readMaterial(id) { return library.readMaterial(this.docs, id) }
  saveMaterial(input) { return library.saveMaterial(this.docs, input) }
  deleteMaterial(id) { return library.deleteMaterial(this.docs, id) }
  listFacts(filter) { return library.listFacts(this.docs, filter) }
  readFact(id) { return library.readFact(this.docs, id) }
  saveFact(input) { return library.saveFact(this.docs, input) }
  deleteFact(id) { return library.deleteFact(this.docs, id) }
  glossaryFacts() { return library.glossaryFacts(this.docs) }

  /* ------------------------------ 运行 / 提示词 / 笔记 / 统计 ------------------------------ */

  saveRun(run) { return logs.saveRun(this.docs, run) }
  readRun(runId) { return logs.readRun(this.docs, runId) }
  listRuns(limit) { return logs.listRuns(this.docs, limit) }
  pruneRuns(keep) { return logs.pruneRuns(this.docs, keep) }
  readPromptOverrides() { return logs.readPromptOverrides(this.docs) }
  writePromptOverride(key, value) { return logs.writePromptOverride(this.docs, key, value) }
  deletePromptOverride(key) { return logs.deletePromptOverride(this.docs, key) }
  listNotes(number) { return logs.listNotes(this.docs, number) }
  appendNote(note) { return logs.appendNote(this.docs, note) }
  replaceNotes(number, notes) { return logs.replaceNotes(this.docs, number, notes) }
  readStats() { return logs.readStats(this.docs) }
  appendStatsEvent(event) { return logs.appendStatsEvent(this.docs, event) }
  writeStats(value) { return logs.writeStats(this.docs, value) }

  /* ------------------------------ 资料库 ------------------------------ */

  listReferences() { return references.listReferences(this.docs) }
  readReference(id) { return references.readReference(this.docs, id) }
  saveReference(input) { return references.saveReference(this.docs, input) }
  deleteReference(id) { return references.deleteReference(this.docs, id) }

  /* ------------------------------ 检索 ------------------------------ */

  search(query, options) { return searchIndex.search(this.docs, this.projectRoot, query, options) }
  readChapterBody(number) { return searchIndex.readChapterBody(this.projectRoot, number) }
  ftsRowCounts() { return searchIndex.indexCounts(this.docs, this.projectRoot) }
  ftsQuery(query) { return `"${String(query ?? '').replace(/"/g, '""')}"` }

  /* 文件存储没有索引：重建动作保留为“重新计数”，让旧调用继续可用但不再维护 FTS。 */
  reindexChapter(number) { return { number: Number(number) } }
  reindexOutline() { return { outline: searchIndex.indexCounts(this.docs, this.projectRoot).outline } }
  reindexBible() { return { bible: searchIndex.indexCounts(this.docs, this.projectRoot).bible } }
  reindexSummaries() { return { summaries: searchIndex.indexCounts(this.docs, this.projectRoot).summaries } }
  reindexAll() { return searchIndex.indexCounts(this.docs, this.projectRoot) }

  checkpoint() {
    return { checkpointed: false }
  }

  schemaVersion() {
    return FILE_SCHEMA_VERSION
  }

  close() {}
}
