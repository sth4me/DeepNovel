/** 大纲文档：story/plot/outline.json。保持旧版 readOutline/writeOutline 的返回结构。 */
import { clone, isPlainObject } from './doc-store.js'

const FILE = 'plot/outline.json'
const VOLUME_KNOWN = ['id', 'title', 'map', 'goal', 'powerCeiling', 'exitCriteria', 'targetChapters', 'chapters']
const CHAPTER_KNOWN = ['id', 'number', 'title', 'synopsis', 'status', 'wordBudget', 'inputs', 'plant', 'payoff', 'foreshadow', 'createdAt', 'updatedAt']
const OUTLINE_KNOWN = ['status', 'logline', 'volumes', 'updatedAt']

function extraFields(source, known) {
  const set = new Set(known)
  const extra = {}
  for (const [key, value] of Object.entries(isPlainObject(source) ? source : {})) {
    if (!set.has(key)) extra[key] = clone(value)
  }
  return extra
}

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeChapter(chapter) {
  // 旧服务按 chapter.foreshadow.{plant,payoff} 读取，文件存储这里保持两套字段同步。
  const foreshadow = isPlainObject(chapter.foreshadow) ? chapter.foreshadow : {}
  const plant = Array.isArray(chapter.plant)
    ? clone(chapter.plant)
    : (Array.isArray(foreshadow.plant) ? clone(foreshadow.plant) : [])
  const payoff = Array.isArray(chapter.payoff)
    ? clone(chapter.payoff)
    : (Array.isArray(foreshadow.payoff) ? clone(foreshadow.payoff) : [])
  return {
    ...extraFields(chapter, CHAPTER_KNOWN),
    id: String(chapter.id ?? ''),
    number: finiteOrNull(chapter.number),
    title: String(chapter.title ?? ''),
    synopsis: String(chapter.synopsis ?? ''),
    status: chapter.status ?? 'candidate',
    wordBudget: finiteOrNull(chapter.wordBudget),
    inputs: isPlainObject(chapter.inputs) ? clone(chapter.inputs) : {},
    plant,
    payoff,
    foreshadow: { plant: clone(plant), payoff: clone(payoff) },
    createdAt: chapter.createdAt ?? null,
    updatedAt: chapter.updatedAt ?? null,
  }
}

function normalizeVolume(volume) {
  const chapters = (Array.isArray(volume.chapters) ? volume.chapters : [])
    .filter((chapter) => isPlainObject(chapter) && String(chapter.id ?? '').trim())
  return {
    ...extraFields(volume, VOLUME_KNOWN),
    id: String(volume.id ?? ''),
    title: String(volume.title ?? ''),
    map: String(volume.map ?? ''),
    goal: String(volume.goal ?? ''),
    powerCeiling: volume.powerCeiling ?? null,
    exitCriteria: volume.exitCriteria ?? null,
    targetChapters: finiteOrNull(volume.targetChapters),
    chapters: chapters.map(normalizeChapter),
  }
}

export function readOutline(docStore) {
  const doc = docStore.read(FILE, null)
  const data = {
    ...extraFields(doc, OUTLINE_KNOWN),
    status: doc?.status ?? 'candidate',
    logline: doc?.logline ?? null,
    volumes: [],
    updatedAt: doc?.updatedAt ?? null,
  }
  const volumes = Array.isArray(doc?.volumes) ? doc.volumes : []
  data.volumes = volumes
    .filter((volume) => isPlainObject(volume) && String(volume.id ?? '').trim())
    .map(normalizeVolume)
  return data
}

export function writeOutline(docStore, value = {}) {
  const source = isPlainObject(value) ? value : {}
  const volumes = (Array.isArray(source.volumes) ? source.volumes : [])
    .filter((volume) => isPlainObject(volume))
    .map((volume) => normalizeVolume({ ...volume, id: String(volume.id ?? '') }))
    .map((volume, index) => (volume.id ? volume : { ...volume, id: `volume-${index + 1}` }))
  const next = {
    ...extraFields(source, OUTLINE_KNOWN),
    status: source.status ?? 'candidate',
    logline: source.logline ?? null,
    volumes,
    updatedAt: source.updatedAt ?? new Date().toISOString(),
  }
  docStore.write(FILE, next)
  return readOutline(docStore)
}

/** 按章号删除大纲行（旧版 deleteOutlineChapter 语义：按 number 而不是 id）。 */
export function deleteOutlineChapterByNumber(docStore, number) {
  const target = Number(number)
  const outline = readOutline(docStore)
  const volumes = outline.volumes.map((volume) => ({
    ...volume,
    chapters: volume.chapters.filter((chapter) => Number(chapter.number) !== target),
  }))
  writeOutline(docStore, { ...outline, volumes })
  return { deleted: target }
}
