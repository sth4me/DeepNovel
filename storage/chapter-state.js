/**
 * 章节状态文档：story/state/<NNN>.json + story/state/index.json。
 * 一章一个文件，包含 meta / qa / state / summary / 正文存在标记。
 */
import { clone, isPlainObject } from './doc-store.js'

const INDEX_FILE = 'state/index.json'

function now() {
  return new Date().toISOString()
}

export function chapterFile(number) {
  const n = Number(number)
  if (!Number.isFinite(n) || n < 1) throw new Error(`非法章号：${number}`)
  return `state/${String(Math.trunc(n)).padStart(3, '0')}.json`
}

function readChapterDoc(docStore, number) {
  const n = Number(number)
  if (!Number.isFinite(n)) return null
  return docStore.read(chapterFile(n), null)
}

function writeChapterDoc(docStore, number, value) {
  const written = docStore.write(chapterFile(number), value)
  registerChapter(docStore, number)
  return written
}

function ensureChapterDoc(docStore, number) {
  const existing = readChapterDoc(docStore, number)
  if (existing) return existing
  const next = {}
  writeChapterDoc(docStore, number, next)
  return next
}

/* ------------------------------ meta ------------------------------ */

export function readChapterMeta(docStore, number) {
  return readChapterDoc(docStore, number)?.meta ?? null
}

export function writeChapterMeta(docStore, number, value = {}) {
  const source = isPlainObject(value) ? value : {}
  const doc = ensureChapterDoc(docStore, number)
  doc.meta = { ...clone(source), updatedAt: source.updatedAt ?? now() }
  writeChapterDoc(docStore, number, doc)
  return clone(doc.meta)
}

export function setChapterProseFlags(docStore, number, flags = {}) {
  const n = Number(number)
  if (!Number.isFinite(n) || n < 1) return null
  const doc = ensureChapterDoc(docStore, n)
  const prose = isPlainObject(doc.prose) ? doc.prose : {}
  if (flags.hasDraft !== undefined) prose.hasDraft = flags.hasDraft === true
  if (flags.hasFinal !== undefined) prose.hasFinal = flags.hasFinal === true
  prose.updatedAt = now()
  doc.prose = prose
  if (!doc.meta) {
    const meta = isPlainObject(flags.meta) ? clone(flags.meta) : {}
    doc.meta = {
      ...meta,
      chapterId: meta.chapterId ?? `c${n}`,
      number: n,
      title: meta.title ?? `第 ${n} 章`,
      status: meta.status ?? (prose.hasDraft ? 'drafted' : 'planned'),
      wordCount: Number(meta.wordCount) || 0,
      updatedAt: meta.updatedAt ?? now(),
    }
  }
  writeChapterDoc(docStore, n, doc)
  return { number: n, hasDraft: prose.hasDraft === true, hasFinal: prose.hasFinal === true }
}

export function listChapterProseFlags(docStore) {
  const map = new Map()
  const dir = docStore.read(INDEX_FILE, null)
  const numbers = Array.isArray(dir?.chapters) ? dir.chapters.map((item) => Number(item.number)) : []
  for (const number of numbers) {
    if (!Number.isFinite(number)) continue
    const prose = readChapterDoc(docStore, number)?.prose
    map.set(number, { hasDraft: prose?.hasDraft === true, hasFinal: prose?.hasFinal === true })
  }
  return map
}

/* ------------------------------ qa ------------------------------ */

export function readChapterQa(docStore, number) {
  const doc = readChapterDoc(docStore, number)
  return {
    qa: clone(doc?.qa ?? null),
    styleQa: clone(doc?.styleQa ?? null),
    continuity: clone(doc?.continuity ?? null),
  }
}

export function writeChapterQa(docStore, number, value = {}) {
  const source = isPlainObject(value) ? value : {}
  const doc = ensureChapterDoc(docStore, number)
  doc.qa = source.qa === undefined ? null : clone(source.qa)
  doc.styleQa = source.styleQa === undefined ? null : clone(source.styleQa)
  doc.continuity = source.continuity === undefined ? null : clone(source.continuity)
  writeChapterDoc(docStore, number, doc)
  return readChapterQa(docStore, number)
}

/* ------------------------------ state ------------------------------ */

export function readChapterState(docStore, number) {
  return clone(readChapterDoc(docStore, number)?.state ?? null)
}

export function writeChapterState(docStore, number, value = {}) {
  const source = isPlainObject(value) ? value : {}
  const doc = ensureChapterDoc(docStore, number)
  const timestamp = source.updatedAt ?? source.approvedAt ?? now()
  doc.state = { ...clone(source), updatedAt: timestamp }
  writeChapterDoc(docStore, number, doc)
  writeStateMeta(docStore, timestamp)
  return readChapterState(docStore, number)
}

/* ------------------------------ summary ------------------------------ */

export function readChapterSummary(docStore, number) {
  return clone(readChapterDoc(docStore, number)?.summary ?? null)
}

export function writeChapterSummary(docStore, number, value = {}) {
  const source = isPlainObject(value) ? value : {}
  const doc = ensureChapterDoc(docStore, number)
  doc.summary = { ...clone(source), updatedAt: source.generatedAt ?? source.updatedAt ?? now() }
  writeChapterDoc(docStore, number, doc)
  return readChapterSummary(docStore, number)
}

/* ------------------------------ 列表与索引 ------------------------------ */

function chapterNumbers(docStore) {
  const index = docStore.read(INDEX_FILE, null)
  const numbers = Array.isArray(index?.chapters) ? index.chapters.map((item) => Number(item.number)) : []
  return [...new Set(numbers.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
}

export function listChapterStates(docStore) {
  return chapterNumbers(docStore).flatMap((number) => {
    const state = readChapterState(docStore, number)
    return state ? [{ number, ...state }] : []
  })
}

export function listChapterSummaries(docStore) {
  return chapterNumbers(docStore).flatMap((number) => {
    const summary = readChapterSummary(docStore, number)
    return summary ? [{ number, ...summary }] : []
  })
}

export function readStateMeta(docStore) {
  return docStore.read(INDEX_FILE, null)?.updatedAt ?? null
}

export function writeStateMeta(docStore, updatedAt = now()) {
  docStore.update(INDEX_FILE, { chapters: [] }, (current) => ({
    ...(isPlainObject(current) ? current : {}),
    updatedAt,
  }))
  return updatedAt
}

export function readStateIndex(docStore) {
  const chapters = listChapterStates(docStore).map((state) => ({
    id: state.chapterId ?? state.id ?? '',
    number: Number(state.number),
    title: state.title ?? '',
    status: 'approved',
    wordCount: Number(state.meta?.wordCount ?? 0),
    summary: state.summary ?? '',
    approvedAt: state.approvedAt ?? state.meta?.approvedAt ?? null,
    finalPath: `story/chapters/${String(state.number).padStart(3, '0')}/final.md`,
  }))
  return { chapters, updatedAt: readStateMeta(docStore) }
}

/** index 的 chapters 列表由各章文档重建；这里只更新 updatedAt。 */
export function writeStateIndex(docStore, value = {}) {
  const source = isPlainObject(value) ? value : {}
  writeStateMeta(docStore, source.updatedAt ?? now())
  return readStateIndex(docStore)
}

/* ------------------------------ 删除与重排 ------------------------------ */

export function deleteChapterRows(docStore, number) {
  const n = Number(number)
  docStore.remove(chapterFile(n))
  docStore.update(INDEX_FILE, { chapters: [] }, (current) => ({
    ...(isPlainObject(current) ? current : {}),
    chapters: (Array.isArray(current?.chapters) ? current.chapters : []).filter((item) => Number(item.number) !== n),
  }))
  return { deleted: n }
}

export function renameChapterRows(docStore, fromNumber, toNumber) {
  const from = Number(fromNumber)
  const to = Number(toNumber)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return { renamed: false }
  const source = readChapterDoc(docStore, from)
  if (!source) return { renamed: false }
  docStore.remove(chapterFile(to))
  const next = clone(source)
  if (isPlainObject(next.meta)) next.meta.number = to
  if (isPlainObject(next.state)) next.state.number = to
  if (isPlainObject(next.summary)) next.summary.number = to
  writeChapterDoc(docStore, to, next)
  docStore.remove(chapterFile(from))
  return { renamed: true, from, to }
}

/** 把某章登记进索引（章节状态首次写入后调用）。 */
export function registerChapter(docStore, number) {
  const n = Number(number)
  docStore.update(INDEX_FILE, { chapters: [] }, (current) => {
    const chapters = Array.isArray(current?.chapters) ? current.chapters : []
    if (chapters.some((item) => Number(item.number) === n)) return current
    return { ...(isPlainObject(current) ? current : {}), chapters: [...chapters, { number: n }] }
  })
}
