// 任务简报：把执行任务真正需要的内容直接打包进提示，减少子代理反复检索。
import { fileFor } from './manifest.js'
import { countText, parseTarget, progressOf } from './textstats.js'

const LIMITS = { styleNotes: 1200, card: 4000, previousTail: 800, ledger: 1200 }

function clip(value, limit) {
  const text = String(value ?? '').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…（已截断）`
}

function findChapter(project, chapterId) {
  for (const volume of project.manifest.plot.volumes ?? []) {
    const chapter = (volume.chapters ?? []).find((item) => item.id === String(chapterId))
    if (chapter) return { chapter, volume }
  }
  return null
}

function previousChapter(project, volume, chapter) {
  const index = (volume.chapters ?? []).findIndex((item) => item.id === chapter.id)
  if (index > 0) return volume.chapters[index - 1]
  const volumes = project.manifest.plot.volumes ?? []
  const volumeIndex = volumes.findIndex((item) => item.id === volume.id)
  for (let cursor = volumeIndex - 1; cursor >= 0; cursor -= 1) {
    const chapters = volumes[cursor].chapters ?? []
    if (chapters.length) return chapters[chapters.length - 1]
  }
  return null
}

function ledgerExcerpt(ledger) {
  const parts = []
  for (const [key, label] of [['handoffs', '章节交接'], ['facts', '已确认事实'], ['foreshadow', '伏笔']]) {
    const items = Array.isArray(ledger?.[key]) ? ledger[key].slice(-4) : []
    const lines = items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean)
    if (lines.length) parts.push(`${label}：${lines.join('；')}`)
  }
  return parts.length ? clip(parts.join('\n'), LIMITS.ledger) : ''
}

/**
 * 生成任务简报。chapterId 存在时给出本章写作所需的全部上下文。
 */
export async function buildTaskBrief(project, { role = 'plan', chapterId = '' } = {}) {
  const manifest = project.manifest
  const lines = []
  lines.push(`# 任务简报：${manifest.title}`)
  if (manifest.genre) lines.push(`题材：${manifest.genre}`)
  const notes = clip(manifest.notes ?? '', LIMITS.styleNotes)
  if (notes) lines.push(`写作要求：\n${notes}`)
  const styleNotes = clip(manifest.style?.notes ?? '', LIMITS.styleNotes)
  const tone = clip(manifest.style?.tone ?? '', 400)
  if (styleNotes || tone) lines.push(`文风契约：\n${[tone, styleNotes].filter(Boolean).join('\n')}`)

  const found = chapterId ? findChapter(project, chapterId) : null
  if (found) {
    const { chapter, volume } = found
    lines.push(`目标章节：第 ${chapter.order} 章《${chapter.title}》（id ${chapter.id}，卷「${volume.title}」）`)
    const card = clip(await project.store.readTextOrNull(fileFor('chapter', chapter.id)) ?? '', LIMITS.card)
    if (card) lines.push(`\n## 本章章卡（已给全，不需要再读文件）\n${card}`)

    const current = await project.store.readTextOrNull(fileFor('manuscript', chapter.id)) ?? ''
    const stats = countText(current)
    const target = parseTarget(card)
    const detail = target
      ? `当前净字数 ${stats.netChars}，目标 ${target.min}–${target.max}，还差 ${Math.max(0, target.min - stats.netChars)} 字。`
      : `当前净字数 ${stats.netChars}。`
    lines.push(`\n## 进度\n${detail}${progressOf(stats.netChars, target) ? `（完成度 ${progressOf(stats.netChars, target).percent}%）` : ''}`)
    if (current) lines.push(`当前正文结尾（续写从这里接）：\n${clip(current.slice(-LIMITS.previousTail), LIMITS.previousTail)}`)

    const previous = previousChapter(project, volume, chapter)
    if (previous) {
      const previousText = await project.store.readTextOrNull(fileFor('manuscript', previous.id)) ?? ''
      const summary = await project.store.readTextOrNull(fileFor('summary', previous.id)) ?? ''
      const tail = summary || previousText.slice(-LIMITS.previousTail)
      if (tail) lines.push(`\n## 上一章（第 ${previous.order} 章《${previous.title}》）结尾或摘要\n${clip(tail, LIMITS.previousTail + 200)}`)
    }
  }

  const ledger = await project.readLedger().catch(() => null)
  const excerpt = ledgerExcerpt(ledger)
  if (excerpt) lines.push(`\n## 连续性要点\n${excerpt}`)

  lines.push('')
  lines.push('## 执行约定')
  lines.push('- 简报里已经给出章卡、当前正文、上一章和连续性要点；按这些内容直接写，不要为了“了解一下”去全项目搜索。')
  lines.push('- 同一份文件最多读两次；不要重复检索已经给出的内容。')
  lines.push(`- ${role === 'prose'
    ? '扩写用 novel_write action=append 只提交新增段落；整章重写才用 action=propose 提交完整正文。'
    : '结构或设定改动用 novel_write action=propose / patch 生成提案。'}`)
  lines.push('- 完成后用一句话说明写了什么、净字数变化；不要重复校验，也不要继续下一个任务。')
  return lines.join('\n')
}
