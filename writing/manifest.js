// 文档模型：deepnovel.json 只保存对象索引和薄字段，创作内容都在 Markdown。
import { basename, join } from 'node:path'
import { emptyRoute, normalizeRouting } from './routing.js'
import { normalizeDialogue } from './dialogue.js'

export const MANIFEST_FILE = 'deepnovel.json'
export const SCHEMA_VERSION = 1

export const STAGES = ['setup', 'world', 'character', 'plot', 'manuscript', 'continuity', 'done']

export const DEFAULT_STYLE = {
  tone: '',
  pov: 'third-limited',
  tense: 'past',
  language: 'zh',
  notes: '',
}

export function defaultManifest({ title = '未命名', genre = '', language = 'zh', style = {} } = {}) {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    title: String(title || basename(String(title || '')) || '未命名').slice(0, 200),
    genre: String(genre || '').slice(0, 120),
    notes: '',
    language: String(language || 'zh') === 'en' ? 'en' : 'zh',
    style: { ...DEFAULT_STYLE, ...(style && typeof style === 'object' ? style : {}) },
    world: [],
    characters: [],
    plot: {
      book: { title: '全书主线', file: 'plot/book.md' },
      volumes: [],
    },
    continuity: {
      ledger: 'continuity/ledger.json',
      summaries: 'continuity/summaries',
    },
    routing: { plan: emptyRoute(), prose: emptyRoute() },
    dialogue: normalizeDialogue({}),
    createdAt: now,
    updatedAt: now,
  }
}

export function isValidId(value, prefix = '') {
  if (typeof value !== 'string') return false
  if (prefix && !value.startsWith(prefix)) return false
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(value)
}

export function cleanTitle(value, fallback = '未命名') {
  const text = String(value ?? '').trim()
  return (text || fallback).slice(0, 200)
}

export function nextObjectId(prefix, existing = []) {
  const used = new Set(existing.map((item) => String(item?.id ?? '')))
  let index = 1
  while (used.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

function uniqueById(items, normalize) {
  const seen = new Set()
  const result = []
  const source = Array.isArray(items) ? items : []
  for (let index = 0; index < source.length; index += 1) {
    const normalized = normalize(source[index], index)
    if (!normalized || seen.has(normalized.id)) continue
    seen.add(normalized.id)
    result.push(normalized)
  }
  return result.sort((left, right) => Number(left.order) - Number(right.order))
}

function orderOf(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

export function normalizeManifest(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const now = new Date().toISOString()
  const world = uniqueById(source.world, (item, index) => {
    if (!item || typeof item !== 'object') return null
    if (!isValidId(item.id, 'w')) return null
    return {
      id: String(item.id),
      title: cleanTitle(item.title, '未命名设定'),
      category: String(item.category ?? 'general').slice(0, 80) || 'general',
      order: orderOf(item.order, index + 1),
    }
  })
  const characters = uniqueById(source.characters, (item, index) => {
    if (!item || typeof item !== 'object') return null
    if (!isValidId(item.id, 'c')) return null
    return {
      id: String(item.id),
      name: cleanTitle(item.name, '未命名角色'),
      role: String(item.role ?? '').slice(0, 120),
      order: orderOf(item.order, index + 1),
    }
  })
  const rawPlot = source.plot && typeof source.plot === 'object' ? source.plot : {}
  const volumes = uniqueById(rawPlot.volumes, (volume, volumeIndex) => {
    if (!volume || typeof volume !== 'object') return null
    if (!isValidId(volume.id, 'v')) return null
    const arcs = uniqueById(volume.arcs, (arc, arcIndex) => {
      if (!arc || typeof arc !== 'object') return null
      if (!isValidId(arc.id, 'a')) return null
      return {
        id: String(arc.id),
        title: cleanTitle(arc.title, '未命名剧情点'),
        order: orderOf(arc.order, arcIndex + 1),
      }
    })
    const chapters = uniqueById(volume.chapters, (chapter, chapterIndex) => {
      if (!chapter || typeof chapter !== 'object') return null
      if (!isValidId(chapter.id, 'ch')) return null
      const arcIds = new Set(arcs.map((item) => item.id))
      return {
        id: String(chapter.id),
        title: cleanTitle(chapter.title, '未命名章节'),
        order: orderOf(chapter.order, chapterIndex + 1),
        ...(chapter.arcId && arcIds.has(String(chapter.arcId)) ? { arcId: String(chapter.arcId) } : {}),
      }
    })
    return {
      id: String(volume.id),
      title: cleanTitle(volume.title, '未命名卷'),
      order: orderOf(volume.order, volumeIndex + 1),
      arcs,
      chapters,
    }
  })
  const style = source.style && typeof source.style === 'object' ? { ...DEFAULT_STYLE, ...source.style } : { ...DEFAULT_STYLE }
  return {
    schemaVersion: SCHEMA_VERSION,
    title: cleanTitle(source.title, '未命名'),
    genre: String(source.genre ?? '').slice(0, 120),
    notes: String(source.notes ?? '').slice(0, 12000),
    language: source.language === 'en' ? 'en' : 'zh',
    style,
    world,
    characters,
    plot: {
      book: {
        title: cleanTitle(rawPlot.book?.title, '全书主线'),
        file: 'plot/book.md',
      },
      volumes,
    },
    continuity: {
      ledger: 'continuity/ledger.json',
      summaries: 'continuity/summaries',
    },
    routing: normalizeRouting(source.routing),
    dialogue: normalizeDialogue(source.dialogue),
    createdAt: String(source.createdAt ?? now),
    updatedAt: String(source.updatedAt ?? now),
  }
}

export function allChapters(manifest) {
  return (manifest?.plot?.volumes ?? []).flatMap((volume) =>
    (volume.chapters ?? []).map((chapter) => ({ ...chapter, volumeId: volume.id, volumeTitle: volume.title })),
  )
}

export function findVolume(manifest, id) {
  return (manifest?.plot?.volumes ?? []).find((volume) => volume.id === String(id)) ?? null
}

export function findChapter(manifest, id) {
  for (const volume of manifest?.plot?.volumes ?? []) {
    const chapter = (volume.chapters ?? []).find((item) => item.id === String(id))
    if (chapter) return { chapter, volume }
  }
  return null
}

export function findArc(manifest, id) {
  for (const volume of manifest?.plot?.volumes ?? []) {
    const arc = (volume.arcs ?? []).find((item) => item.id === String(id))
    if (arc) return { arc, volume }
  }
  return null
}

export function fileFor(kind, id = '') {
  switch (kind) {
    case 'book': return 'plot/book.md'
    case 'world': return `world/${id}.md`
    case 'character': return `characters/${id}.md`
    case 'volume': return `plot/volumes/${id}.md`
    case 'arc': return `plot/arcs/${id}.md`
    case 'chapter': return `plot/chapters/${id}.md`
    case 'manuscript': return `manuscript/${id}.md`
    case 'summary': return `continuity/summaries/${id}.md`
    case 'ledger': return 'continuity/ledger.json'
    default: throw new Error(`未知文档类型：${kind}`)
  }
}

export function projectPath(root, relativePath) {
  return join(root, relativePath)
}
