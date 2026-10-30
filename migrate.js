/**
 * 旧 JSON 项目 → SQLite 迁移（Phase 0）。
 *
 * 设计：
 * - DB 不存在时才迁移；已存在返回 { migrated: false }。
 * - 阶段 1（异步）逐文件读取所有 JSON 与章节正文，坏文件记入 skipped，不中断。
 * - 阶段 2（同步事务）一次性写入所有表并重建 FTS；任何写入失败整体回滚并删除 DB 文件。
 * - 旧 JSON 全部保留（只读存档），正文 Markdown 不迁移，只读进 FTS。
 */
import { existsSync, rmSync } from 'node:fs'
import { readFile, readdir, stat as fsStat } from 'node:fs/promises'
import { join } from 'node:path'
import { openDatabase } from './db.js'
import { NovelStore } from './store.js'

const DEFAULT_FS = {
  resolve: async (relativePath, { cwd }) => join(cwd, relativePath),
  stat: async (target) => {
    try {
      const info = await fsStat(target)
      return { version: String(info.mtimeMs) }
    } catch {
      return null
    }
  },
  readText: async (target) => readFile(target, 'utf8'),
  listDir: async (target) => {
    const entries = await readdir(target, { withFileTypes: true })
    return entries.map((entry) => ({ type: entry.isDirectory() ? 'directory' : 'file', name: entry.name }))
  },
}

/** 把 prompt/system.json 的 v1（纯字符串）与 v2（{version, overrides}）统一成 map。 */
function normalizePromptOverrides(data) {
  const source = data && typeof data === 'object' ? data : {}
  const raw = source.overrides && typeof source.overrides === 'object' ? source.overrides : source
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'version' || key === 'overrides') continue
    let text = ''
    let baseHash = null
    let baseRevision = null
    if (typeof value === 'string') {
      text = value
    } else if (value && typeof value === 'object') {
      text = typeof value.text === 'string' ? value.text : ''
      baseHash = value.baseHash ?? null
      baseRevision = value.baseRevision === null || value.baseRevision === undefined
        ? null
        : (Number.isFinite(Number(value.baseRevision)) ? Number(value.baseRevision) : null)
    }
    const clean = text.trim().slice(0, 20000)
    if (!clean) continue
    out[key] = { text: clean, baseHash, baseRevision }
  }
  return out
}

/** 阶段 1：异步读取全部旧数据（逐文件容错）。 */
async function collectLegacyData({ projectRoot, fs, skipped }) {
  const readJson = async (relativePath) => {
    let info = null
    try {
      const target = await fs.resolve(relativePath, { cwd: projectRoot })
      info = await fs.stat(target)
    } catch {
      info = null
    }
    if (!info) return null
    try {
      const target = await fs.resolve(relativePath, { cwd: projectRoot })
      return JSON.parse(await fs.readText(target))
    } catch {
      skipped.push(relativePath)
      return null
    }
  }
  const listDir = async (relativePath) => {
    try {
      const target = await fs.resolve(relativePath, { cwd: projectRoot })
      return await fs.listDir(target)
    } catch {
      return []
    }
  }
  const readText = async (relativePath) => {
    try {
      const target = await fs.resolve(relativePath, { cwd: projectRoot })
      const info = await fs.stat(target)
      if (!info) return null
      return await fs.readText(target)
    } catch {
      return null
    }
  }

  const project = await readJson('story/project.json')
  const premise = await readJson('story/premise.json')
  const style = await readJson('story/style/contract.json')
  const bible = await readJson('story/bible/index.json')
  const relations = await readJson('story/bible/relations.json')
  const power = await readJson('story/power.json')
  const outline = await readJson('story/plot/outline.json')
  const stateIndex = await readJson('story/state/index.json')
  const stats = await readJson('story/stats.json')
  const prompts = await readJson('story/prompts/system.json')

  const styleTemplates = []
  for (const entry of await listDir('story/style/templates')) {
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
    const template = await readJson(`story/style/templates/${entry.name}`)
    if (template && typeof template === 'object') styleTemplates.push(template)
  }

  // 章号来源：章节目录 + 大纲（任一存在都算）
  const numbers = new Set()
  for (const entry of await listDir('story/chapters')) {
    if (entry.type !== 'directory') continue
    const number = Number(entry.name)
    if (Number.isFinite(number) && number > 0) numbers.add(number)
  }
  for (const volume of outline?.volumes ?? []) {
    for (const chapter of volume?.chapters ?? []) {
      const number = Number(chapter?.number)
      if (Number.isFinite(number) && number > 0) numbers.add(number)
    }
  }
  const chaptersData = []
  for (const number of [...numbers].sort((a, b) => a - b)) {
    const pad = String(number).padStart(3, '0')
    const dir = `story/chapters/${pad}`
    const meta = await readJson(`${dir}/meta.json`)
    const qa = await readJson(`${dir}/qa.json`)
    const styleQa = await readJson(`${dir}/style-qa.json`)
    const continuity = await readJson(`${dir}/continuity.json`)
    const summary = await readJson(`${dir}/summary.json`)
    const body = (await readText(`${dir}/final.md`)) ?? (await readText(`${dir}/draft.md`)) ?? ''
    chaptersData.push({ number, meta, qa, styleQa, continuity, summary, body })
  }

  const states = []
  for (const entry of await listDir('story/state')) {
    if (entry.type !== 'file' || !/^\d+\.json$/.test(entry.name)) continue
    const stateJson = await readJson(`story/state/${entry.name}`)
    if (!stateJson) continue
    const number = Number(stateJson.number ?? entry.name.replace(/\.json$/, ''))
    if (!Number.isFinite(number)) continue
    states.push({ number, json: stateJson })
  }

  const runs = []
  for (const entry of await listDir('.dsh-writing/runs')) {
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
    const run = await readJson(`.dsh-writing/runs/${entry.name}`)
    if (run && typeof run === 'object' && run.runId) runs.push(run)
  }

  const notes = []
  for (const entry of await listDir('.dsh-writing/notes')) {
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
    const file = await readJson(`.dsh-writing/notes/${entry.name}`)
    if (!file) continue
    const match = entry.name.match(/^chapter-(\d+)\.json$/)
    const chapter = match ? Number(match[1]) : null
    for (const note of Array.isArray(file.notes) ? file.notes : []) {
      notes.push({ chapter, text: note, source: 'legacy' })
    }
  }

  return {
    project,
    premise,
    style,
    styleTemplates,
    bible,
    relations,
    power,
    outline,
    stateIndex,
    stats,
    promptOverrides: normalizePromptOverrides(prompts),
    chaptersData,
    states,
    runs,
    notes,
  }
}

/** 阶段 2：同步事务内写入所有表并重建 FTS（正文已在阶段 1 读入）。 */
function writeLegacyData(store, data) {
  return store.tx(() => {
    const counts = {
      project: 0,
      premise: 0,
      style: 0,
      styleTemplates: 0,
      bibleEntries: 0,
      relations: 0,
      power: 0,
      volumes: 0,
      chapters: 0,
      chapterMeta: 0,
      chapterQa: 0,
      chapterState: 0,
      chapterSummary: 0,
      statsEvents: 0,
      runs: 0,
      promptOverrides: 0,
      notes: 0,
    }
    if (data.project) {
      store.writeProject(data.project)
      counts.project = 1
    }
    if (data.premise) {
      store.writePremise(data.premise)
      counts.premise = 1
    }
    if (data.style) {
      store.writeStyleContract(data.style)
      counts.style = 1
    }
    for (const template of data.styleTemplates) {
      if (!template?.id) continue
      store.saveStyleTemplate(template)
      counts.styleTemplates += 1
    }
    if (data.bible) {
      store.writeBible(data.bible)
      counts.bibleEntries = ['characters', 'locations', 'rules', 'factions', 'items']
        .reduce((sum, category) => sum + (Array.isArray(data.bible[category]) ? data.bible[category].length : 0), 0)
    }
    if (data.relations) {
      store.writeRelations(data.relations)
      counts.relations = Array.isArray(data.relations.relations) ? data.relations.relations.length : 0
    }
    if (data.power) {
      store.writePower(data.power)
      counts.power = 1
    }
    if (data.outline) {
      store.writeOutline(data.outline)
      const volumes = Array.isArray(data.outline.volumes) ? data.outline.volumes : []
      counts.volumes = volumes.length
      counts.chapters = volumes.reduce((sum, volume) => sum + (Array.isArray(volume.chapters) ? volume.chapters.length : 0), 0)
    }
    for (const chapter of data.chaptersData) {
      if (chapter.meta) {
        store.writeChapterMeta(chapter.number, chapter.meta)
        counts.chapterMeta += 1
      }
      if (chapter.qa || chapter.styleQa || chapter.continuity) {
        store.writeChapterQa(chapter.number, { qa: chapter.qa, styleQa: chapter.styleQa, continuity: chapter.continuity })
        counts.chapterQa += 1
      }
      if (chapter.summary) {
        store.writeChapterSummary(chapter.number, chapter.summary)
        counts.chapterSummary += 1
      }
    }
    for (const state of data.states) {
      store.writeChapterState(state.number, state.json)
      counts.chapterState += 1
    }
    if (data.stateIndex?.updatedAt) store.writeStateMeta(data.stateIndex.updatedAt)
    if (data.stats) {
      store.writeStats(data.stats)
      counts.statsEvents = Array.isArray(data.stats.events) ? data.stats.events.length : 0
    }
    for (const run of data.runs) {
      store.saveRun(run)
      counts.runs += 1
    }
    for (const [key, value] of Object.entries(data.promptOverrides)) {
      store.writePromptOverride(key, value)
      counts.promptOverrides += 1
    }
    for (const note of data.notes) {
      store.appendNote(note)
      counts.notes += 1
    }

    // FTS：outline/bible/summary 直接来自 DB；章节正文用预读文本。
    store.reindexOutline()
    store.reindexBible()
    store.reindexSummaries()
    const titleByNumber = new Map()
    for (const volume of data.outline?.volumes ?? []) {
      for (const chapter of volume?.chapters ?? []) {
        const number = Number(chapter?.number)
        if (Number.isFinite(number)) titleByNumber.set(number, String(chapter?.title ?? ''))
      }
    }
    for (const chapter of data.chaptersData) {
      store.reindexChapter(chapter.number, {
        title: titleByNumber.get(chapter.number) ?? String(chapter.meta?.title ?? ''),
        body: chapter.body ?? '',
      })
    }
    return counts
  })
}

/**
 * 把现有 JSON 项目迁移到 SQLite。
 * @param {object} options
 * @param {string} options.projectRoot 项目根目录
 * @param {object} [options.fs] 文件系统适配器（resolve/stat/readText/listDir），默认用 node fs
 * @param {(relativePath: string) => string} [options.resolveHostPath] 相对路径 → 宿主绝对路径
 * @returns {Promise<{migrated: boolean, counts?: object, skipped?: string[], dbPath?: string}>}
 */
export async function migrateLegacyProject(options = {}) {
  const projectRoot = String(options.projectRoot ?? '')
  if (!projectRoot) throw new Error('migrateLegacyProject 需要 projectRoot')
  const resolveHostPath = typeof options.resolveHostPath === 'function'
    ? options.resolveHostPath
    : (relativePath) => join(projectRoot, relativePath)
  const fs = options.fs && typeof options.fs === 'object' ? options.fs : DEFAULT_FS
  const dbPath = resolveHostPath('story/project.db')
  if (existsSync(dbPath)) return { migrated: false, dbPath }

  const skipped = []
  const data = await collectLegacyData({ projectRoot, fs, skipped })

  let db = null
  try {
    db = openDatabase(dbPath)
    const store = new NovelStore(db, projectRoot)
    const counts = writeLegacyData(store, data)
    // 正文存在性入库（schema v2）：迁移期间唯一一次全量扫描，之后打开项目不再扫目录。
    const chapterNumbers = new Set()
    for (const chapter of data.chaptersData ?? []) chapterNumbers.add(Number(chapter.number))
    for (const volume of data.outline?.volumes ?? []) {
      for (const chapter of volume.chapters ?? []) chapterNumbers.add(Number(chapter.number))
    }
    for (const number of chapterNumbers) {
      if (!Number.isFinite(number) || number < 1) continue
      const pad = String(number).padStart(3, '0')
      const hasDraft = existsSync(resolveHostPath(`story/chapters/${pad}/draft.md`))
      const hasFinal = existsSync(resolveHostPath(`story/chapters/${pad}/final.md`))
      if (hasDraft || hasFinal) store.setChapterProseFlags(number, { hasDraft, hasFinal })
    }
    if (data.project) store.writeProject({ ...data.project, proseFlagsBackfilled: true })
    store.checkpoint()
    store.close()
    return { migrated: true, counts, skipped, dbPath }
  } catch (error) {
    try {
      db?.close()
    } catch {
      // 连接可能已关闭
    }
    for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        rmSync(path, { force: true })
      } catch {
        // 尽力清理
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`迁移失败，已回滚并删除数据库：${message}`)
  }
}
