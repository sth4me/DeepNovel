// 项目字数统计：按章、卷、全书汇总，并给出章卡目标进度。
import { fileFor } from './manifest.js'
import { countText, parseTarget, progressOf } from './textstats.js'

function fileOfKind(kind, id) {
  if (kind === 'summary') return fileFor('summary', id)
  if (kind === 'chapter') return fileFor('chapter', id)
  return fileFor('manuscript', id)
}

async function chapterRow(project, chapter, volume, kind) {
  const text = await project.store.readTextOrNull(fileOfKind(kind, chapter.id)) ?? ''
  const stats = countText(text)
  const card = kind === 'manuscript'
    ? await project.store.readTextOrNull(fileFor('chapter', chapter.id)) ?? ''
    : ''
  const target = parseTarget(card)
  return {
    id: chapter.id,
    title: chapter.title,
    order: chapter.order,
    volumeId: volume?.id ?? '',
    volumeTitle: volume?.title ?? '',
    netChars: stats.netChars,
    lines: stats.lines,
    quotes: stats.quotes.straight + stats.quotes.curly + stats.quotes.corner,
    target,
    progress: progressOf(stats.netChars, target),
  }
}

function sumRows(rows) {
  return rows.reduce((total, row) => total + row.netChars, 0)
}

/**
 * @param scope project | volume | chapter
 * @param kind manuscript（默认）| chapter（章卡）| summary（摘要）
 */
export async function countProject(project, { scope = 'project', volumeId = '', chapterId = '', kind = 'manuscript' } = {}) {
  const volumes = project.manifest.plot.volumes ?? []
  if (scope === 'chapter') {
    const found = volumes.flatMap((volume) => (volume.chapters ?? []).map((chapter) => ({ volume, chapter })))
      .find((item) => item.chapter.id === String(chapterId))
    if (!found) throw new Error(`找不到章节：${chapterId}`)
    const row = await chapterRow(project, found.chapter, found.volume, kind)
    return {
      scope,
      kind,
      rule: countText('').rule,
      total: { netChars: row.netChars, chapters: 1 },
      chapter: row,
      chapters: [row],
    }
  }

  const selected = scope === 'volume'
    ? volumes.filter((volume) => volume.id === String(volumeId))
    : volumes
  if (scope === 'volume' && selected.length === 0) throw new Error(`找不到卷：${volumeId}`)

  const rows = []
  for (const volume of selected) {
    for (const chapter of volume.chapters ?? []) {
      rows.push(await chapterRow(project, chapter, volume, kind))
    }
  }
  const totalNet = sumRows(rows)
  const targets = rows.filter((row) => row.target)
  const targetNet = targets.reduce((total, row) => total + row.target.max, 0)
  return {
    scope,
    kind,
    rule: countText('').rule,
    total: {
      netChars: totalNet,
      chapters: rows.length,
      ...(targets.length ? { targetNet, progress: progressOf(totalNet, { min: targetNet, max: targetNet }) } : {}),
    },
    chapters: rows,
  }
}
