#!/usr/bin/env node
// 把旧版章纲字段（goal/conflict/turn/outcome/hook/beats）总结成新版 synopsis。
//
// 用法：
//   node scripts/backfill-synopsis.mjs <项目目录>            # 只预览，不写盘
//   node scripts/backfill-synopsis.mjs <项目目录> --apply    # 写回，并备份原 outline.json
//
// 说明：
// - 只补 synopsis 为空的章节；已有 synopsis 的跳过。
// - 纯本地拼装（不调用模型）：goal；conflict；turn；outcome；hook，截断 400 字。
// - 写盘前把原文件备份为 outline.json.bak-<时间戳>。

import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

const SENTENCE_SPLIT = /[；;。\n]+/

function clean(text, max = 400) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function summarize(chapter) {
  const parts = []
  const push = (value) => {
    const text = clean(value, 160)
    if (text && !parts.includes(text)) parts.push(text)
  }
  push(chapter.goal)
  push(chapter.conflict)
  push(chapter.turn)
  push(chapter.outcome)
  push(chapter.hook)
  if (parts.length === 0 && Array.isArray(chapter.beats)) {
    for (const beat of chapter.beats.slice(0, 3)) push(beat)
  }
  if (parts.length === 0 && chapter.synopsis) return String(chapter.synopsis)
  const merged = parts.join('；')
  return clean(merged, 400)
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const projectRoot = args.find((item) => !item.startsWith('--'))
  if (!projectRoot) {
    console.error('用法：node scripts/backfill-synopsis.mjs <项目目录> [--apply]')
    process.exit(1)
  }
  const outlinePath = join(projectRoot, 'story', 'plot', 'outline.json')
  let raw
  try {
    raw = await readFile(outlinePath, 'utf8')
  } catch (error) {
    console.error(`读取失败：${outlinePath}\n${error?.message ?? error}`)
    process.exit(1)
  }
  const outline = JSON.parse(raw)
  const chapters = (outline.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
  const filled = []
  const skipped = []
  const empty = []
  for (const chapter of chapters) {
    const existing = String(chapter.synopsis ?? '').trim()
    if (existing) {
      skipped.push({ number: chapter.number, synopsis: existing })
      continue
    }
    const synopsis = summarize(chapter)
    if (!synopsis) {
      empty.push(Number(chapter.number))
      continue
    }
    chapter.synopsis = synopsis
    filled.push({ number: chapter.number, synopsis })
  }
  console.log(`章节 ${chapters.length} 章：将补 ${filled.length}，已有 ${skipped.length}，无法总结 ${empty.length}`)
  for (const item of filled.slice(0, 8)) console.log(`  第 ${item.number} 章：${item.synopsis.slice(0, 80)}…`)
  if (!apply) {
    console.log('\n（预览模式，未写盘；加 --apply 写回）')
    return
  }
  if (filled.length === 0) {
    console.log('没有需要补全的章节，未写盘。')
    return
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${outlinePath}.bak-${stamp}`
  await copyFile(outlinePath, backupPath)
  outline.updatedAt = new Date().toISOString()
  await writeFile(outlinePath, `${JSON.stringify(outline, null, 2)}\n`, 'utf8')
  console.log(`\n已写回 ${filled.length} 章 synopsis；原文件备份：${backupPath}`)
  if (empty.length) console.log(`以下章节无可用旧字段，未补：${empty.join('、')}`)
}

main().catch((error) => {
  console.error(error?.stack ?? String(error))
  process.exit(1)
})
