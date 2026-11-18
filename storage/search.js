/**
 * 检索：不再使用 SQLite FTS，改为直接扫描项目文档。
 * 单本长篇规模下开销可接受；后续如需加速只做可重建的内存索引。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readOutline } from './outline.js'
import { listChapterSummaries } from './chapter-state.js'

const BIBLE_LABELS = { characters: '角色', locations: '地点', rules: '规则', factions: '势力', items: '物品' }

export function likeSnippet(text, query, radius = 20) {
  const source = String(text ?? '')
  const index = source.indexOf(query)
  if (index < 0) return source.slice(0, radius * 2)
  const start = Math.max(0, index - radius)
  const end = Math.min(source.length, index + query.length + radius)
  return `${start > 0 ? '…' : ''}${source.slice(start, index)}[[${source.slice(index, index + query.length)}]]${source.slice(index + query.length, end)}${end < source.length ? '…' : ''}`
}

/** 读章节正文：final 优先，其次 draft；正文始终是 Markdown 文件。 */
export function readChapterBody(projectRoot, number) {
  const pad = String(Number(number)).padStart(3, '0')
  for (const name of ['final.md', 'draft.md']) {
    const path = join(projectRoot, 'story', 'chapters', pad, name)
    if (!existsSync(path)) continue
    try {
      return readFileSync(path, 'utf8')
    } catch {
      // 两种正文都可能读不出来
    }
  }
  return ''
}

function pushIfMatched(results, query, type, title, body, extra = {}) {
  const text = String(body ?? '')
  if (!text.includes(query)) return
  results.push({ type, title, snippet: likeSnippet(text, query), score: 0, ...extra })
}

export function search(docStore, projectRoot, query, options = {}) {
  const q = String(query ?? '').trim()
  if (!q) return { results: [] }
  const max = Math.max(1, Math.min(200, Number(options.limit) || 20))
  const results = []

  const outline = readOutline(docStore)
  for (const volume of outline.volumes) {
    for (const chapter of volume.chapters) {
      pushIfMatched(results, q, 'outline', chapter.title || `第 ${chapter.number} 章`, chapter.synopsis ?? '', { number: chapter.number })
    }
  }
  const bible = docStore.read('bible/entries.json', null)
  for (const category of Object.keys(BIBLE_LABELS)) {
    for (const entry of Array.isArray(bible?.[category]) ? bible[category] : []) {
      pushIfMatched(results, q, 'bible', entry.name || `${BIBLE_LABELS[category]} · ${entry.id}`, entry.description ?? '', { entryId: entry.id })
    }
  }
  for (const summary of listChapterSummaries(docStore)) {
    pushIfMatched(results, q, 'summary', `第 ${summary.number} 章摘要`, summary.summary ?? '', { number: summary.number })
  }
  for (const chapter of outline.volumes.flatMap((volume) => volume.chapters)) {
    const body = readChapterBody(projectRoot, chapter.number)
    if (!body) continue
    if (!body.includes(q)) continue
    results.push({
      type: 'chapter',
      number: chapter.number,
      title: chapter.title || `第 ${chapter.number} 章`,
      snippet: likeSnippet(body, q),
      score: 0,
    })
    if (results.length >= max) break
  }
  return { results: results.slice(0, max) }
}

/** 索引统计：文件存储没有索引，返回可检索条目数，便于旧接口继续工作。 */
export function indexCounts(docStore, projectRoot) {
  const outline = readOutline(docStore)
  const chapters = outline.volumes.flatMap((volume) => volume.chapters)
  const bible = docStore.read('bible/entries.json', null)
  const bibleCount = Object.keys(BIBLE_LABELS).reduce((total, category) => total + (Array.isArray(bible?.[category]) ? bible[category].length : 0), 0)
  return {
    chapters: chapters.filter((chapter) => readChapterBody(projectRoot, chapter.number)).length,
    outline: chapters.length,
    bible: bibleCount,
    summaries: listChapterSummaries(docStore).length,
  }
}
