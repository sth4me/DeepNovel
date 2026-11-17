/**
 * 一次性迁移：旧版 story/project.db（SQLite）→ 文件存储。
 * 迁移成功后把 project.db 改名为 project.db.migrated，避免重复迁移。
 * 只读旧库，不写旧库；失败时不改任何文件。
 */
import { existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from './db.js'
import { NovelStore } from './store.js'
import { FileNovelStore } from './file-store.js'

function chapterNumbers(oldStore) {
  const numbers = new Set()
  for (const number of oldStore.listChapterProseFlags().keys()) numbers.add(Number(number))
  for (const state of oldStore.listChapterStates()) numbers.add(Number(state.number))
  for (const chapter of oldStore.readOutline().volumes.flatMap((volume) => volume.chapters)) {
    if (Number.isFinite(Number(chapter.number))) numbers.add(Number(chapter.number))
  }
  return [...numbers].filter((number) => Number.isFinite(number) && number > 0).sort((a, b) => a - b)
}

function copyChapter(oldStore, next, number) {
  const meta = oldStore.readChapterMeta(number)
  if (meta) next.writeChapterMeta(number, meta)
  const qa = oldStore.readChapterQa(number)
  if (qa && (qa.qa || qa.styleQa || qa.continuity)) next.writeChapterQa(number, qa)
  const state = oldStore.readChapterState(number)
  if (state) next.writeChapterState(number, state)
  const summary = oldStore.readChapterSummary(number)
  if (summary) next.writeChapterSummary(number, summary)
  const flags = oldStore.listChapterProseFlags().get(number)
  if (flags) next.setChapterProseFlags(number, flags)
}

export function migrateProjectDb(projectRoot) {
  const dbPath = join(projectRoot, 'story', 'project.db')
  if (!existsSync(dbPath)) return { migrated: false, reason: 'no-db' }

  const next = new FileNovelStore(projectRoot)
  if (next.readProject()) return { migrated: false, reason: 'file-store-exists' }

  const db = openDatabase(dbPath)
  let oldStore
  try {
    oldStore = new NovelStore(db, projectRoot)
    const project = oldStore.readProject() ?? {}
    next.writeProject(project)
    const prompt = oldStore.readProjectPrompt()
    if (prompt) next.writeProjectPrompt(prompt)
    const automation = oldStore.readAutomation()
    if (automation) next.writeAutomation(automation)

    const premise = oldStore.readPremise()
    if (premise) next.writePremise(premise)
    const style = oldStore.readStyleContract()
    if (style) next.writeStyleContract(style)
    for (const template of oldStore.listStyleTemplates()) next.saveStyleTemplate(template)
    next.writeBible(oldStore.readBible())
    next.writeRelations(oldStore.readRelations())
    const power = oldStore.readPower()
    if (power) next.writePower(power)
    next.writeOutline(oldStore.readOutline())

    const numbers = chapterNumbers(oldStore)
    for (const number of numbers) copyChapter(oldStore, next, number)

    for (const material of oldStore.listMaterials()) next.saveMaterial(material)
    for (const fact of oldStore.listFacts()) next.saveFact(fact)

    const overrides = oldStore.readPromptOverrides()
    for (const [key, value] of Object.entries(overrides)) next.writePromptOverride(key, value)

    for (const run of oldStore.listRuns(500)) next.saveRun(run)
    next.writeStats(oldStore.readStats())

    for (const note of oldStore.listNotes()?.notes ?? []) {
      const chapter = Number.isFinite(Number(note.chapter)) ? Number(note.chapter) : null
      next.appendNote({ chapter, text: note, source: note.source ?? 'legacy' })
    }
  } finally {
    try { db.close() } catch {
      // 已关闭
    }
  }

  renameSync(dbPath, `${dbPath}.migrated`)
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
  return { migrated: true }
}
