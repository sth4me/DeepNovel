/** 运行记录、提示词覆盖、章节笔记、统计：各占一个 JSON 文档。 */
import { clone, isPlainObject } from './doc-store.js'

const RUNS_FILE = 'runs.json'
const PROMPTS_FILE = 'prompt-overrides.json'
const NOTES_FILE = 'notes.json'
const STATS_FILE = 'stats.json'
const RUNS_LIMIT = 500

function now() {
  return new Date().toISOString()
}

function readList(docStore, file, key) {
  const doc = docStore.read(file, { [key]: [] })
  return (Array.isArray(doc?.[key]) ? doc[key] : []).filter((item) => isPlainObject(item))
}

/* ------------------------------ 运行记录 ------------------------------ */

export function saveRun(docStore, run = {}) {
  const source = isPlainObject(run) ? run : {}
  const runId = String(source.runId ?? '')
  if (!runId) throw new Error('运行记录缺少 runId')
  const record = { ...clone(source), runId, createdAt: source.createdAt ?? now() }
  const runs = readList(docStore, RUNS_FILE, 'runs').filter((item) => item.runId !== runId)
  runs.push(record)
  const trimmed = runs
    .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
    .slice(0, RUNS_LIMIT)
  docStore.write(RUNS_FILE, { runs: trimmed })
  return clone(record)
}

export function readRun(docStore, runId) {
  return clone(readList(docStore, RUNS_FILE, 'runs').find((item) => item.runId === String(runId ?? '')) ?? null)
}

export function listRuns(docStore, limit = 20) {
  const max = Math.max(1, Math.min(RUNS_LIMIT, Number(limit) || 20))
  return readList(docStore, RUNS_FILE, 'runs')
    .slice()
    .sort((left, right) => {
      const a = String(left.createdAt ?? '')
      const b = String(right.createdAt ?? '')
      if (a !== b) return b.localeCompare(a)
      return String(right.runId ?? '').localeCompare(String(left.runId ?? ''))
    })
    .slice(0, max)
    .map((item) => clone(item))
}

export function pruneRuns(docStore, keep = 20) {
  const max = Math.max(1, Math.min(RUNS_LIMIT, Number(keep) || 20))
  const runs = readList(docStore, RUNS_FILE, 'runs')
  if (runs.length <= max) return { removed: 0, kept: runs.length }
  const kept = runs
    .slice()
    .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
    .slice(0, max)
  docStore.write(RUNS_FILE, { runs: kept })
  return { removed: runs.length - max, kept: max }
}

/* ------------------------------ 提示词覆盖 ------------------------------ */

export function readPromptOverrides(docStore) {
  const doc = docStore.read(PROMPTS_FILE, { overrides: {} })
  const overrides = isPlainObject(doc?.overrides) ? doc.overrides : {}
  const out = {}
  for (const key of Object.keys(overrides).sort()) {
    const item = overrides[key]
    if (!isPlainObject(item)) continue
    out[key] = {
      text: String(item.text ?? ''),
      baseHash: item.baseHash ?? null,
      baseRevision: item.baseRevision == null ? null : Number(item.baseRevision),
    }
  }
  return out
}

export function writePromptOverride(docStore, key, value) {
  const name = String(key ?? '')
  if (!name) throw new Error('提示词覆盖缺少 key')
  let text = ''
  let baseHash = null
  let baseRevision = null
  if (typeof value === 'string') {
    text = value
  } else if (isPlainObject(value)) {
    text = typeof value.text === 'string' ? value.text : ''
    baseHash = value.baseHash ?? null
    baseRevision = value.baseRevision == null ? null : Number(value.baseRevision)
  }
  const clean = text.trim().slice(0, 20000)
  if (!clean) return deletePromptOverride(docStore, name)
  const doc = docStore.read(PROMPTS_FILE, { overrides: {} })
  const overrides = isPlainObject(doc?.overrides) ? doc.overrides : {}
  overrides[name] = { text: clean, baseHash, baseRevision }
  docStore.write(PROMPTS_FILE, { overrides })
  return readPromptOverrides(docStore)
}

export function deletePromptOverride(docStore, key) {
  const name = String(key ?? '')
  const doc = docStore.read(PROMPTS_FILE, { overrides: {} })
  const overrides = isPlainObject(doc?.overrides) ? { ...doc.overrides } : {}
  delete overrides[name]
  docStore.write(PROMPTS_FILE, { overrides })
  return readPromptOverrides(docStore)
}

/* ------------------------------ 章节笔记 ------------------------------ */

function readNotes(docStore) {
  return readList(docStore, NOTES_FILE, 'entries')
}

export function listNotes(docStore, number) {
  const notes = readNotes(docStore)
  const filtered = Number.isFinite(Number(number))
    ? notes.filter((item) => Number(item.chapter) === Number(number))
    : notes
  return {
    notes: clone(filtered).map((item) => {
      const parsed = isPlainObject(item.text) ? item.text : { text: String(item.text ?? '') }
      return { ...parsed, source: item.source ?? null, createdAt: item.createdAt ?? null }
    }),
  }
}

export function appendNote(docStore, note = {}) {
  const source = isPlainObject(note) ? note : {}
  const chapter = Number.isFinite(Number(source.chapter)) ? Number(source.chapter) : null
  const payload = isPlainObject(source.text) ? clone(source.text) : { text: String(source.text ?? '') }
  const createdAt = source.createdAt ?? now()
  const entries = readNotes(docStore)
  entries.push({ chapter, text: payload, source: source.source ?? null, createdAt })
  docStore.write(NOTES_FILE, { entries })
  return { chapter, ...payload, source: source.source ?? null, createdAt }
}

export function replaceNotes(docStore, number, notes = []) {
  const chapter = Number.isFinite(Number(number)) ? Number(number) : null
  const entries = readNotes(docStore).filter((item) => {
    const itemChapter = item.chapter == null ? null : Number(item.chapter)
    return itemChapter !== chapter
  })
  for (const note of Array.isArray(notes) ? notes : []) {
    const payload = isPlainObject(note) ? clone(note) : { text: String(note ?? '') }
    entries.push({ chapter, text: payload, source: 'legacy', createdAt: now() })
  }
  docStore.write(NOTES_FILE, { entries })
  return listNotes(docStore, chapter)
}

/* ------------------------------ 统计 ------------------------------ */

export function readStats(docStore) {
  const doc = docStore.read(STATS_FILE, { events: [], updatedAt: null })
  return {
    events: (Array.isArray(doc?.events) ? doc.events : []).filter((item) => isPlainObject(item)).map((item) => clone(item)),
    updatedAt: doc?.updatedAt ?? null,
  }
}

export function appendStatsEvent(docStore, event = {}) {
  const source = isPlainObject(event) ? event : {}
  const doc = docStore.read(STATS_FILE, { events: [], updatedAt: null })
  const events = (Array.isArray(doc?.events) ? doc.events : []).filter((item) => isPlainObject(item))
  events.push({
    date: String(source.date ?? new Date().toLocaleDateString('sv-SE')),
    number: Number(source.number) || 0,
    words: Number(source.words) || 0,
    action: String(source.action ?? 'write'),
    time: source.time ?? now(),
  })
  docStore.write(STATS_FILE, { events, updatedAt: now() })
  return readStats(docStore)
}

export function writeStats(docStore, value = {}) {
  const source = isPlainObject(value) ? value : {}
  const events = (Array.isArray(source.events) ? source.events : [])
    .filter((item) => isPlainObject(item))
    .map((item) => ({
      date: String(item.date ?? ''),
      number: Number(item.number) || 0,
      words: Number(item.words) || 0,
      action: String(item.action ?? 'write'),
      time: item.time ?? null,
    }))
  docStore.write(STATS_FILE, { events, updatedAt: source.updatedAt ?? now() })
  return readStats(docStore)
}
