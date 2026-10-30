// schema v2：正文存在性入库（chapter_meta.has_draft/has_final）+ 旧库平滑升级 + 监听事件解析/去抖。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-flags-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-flags-project-'))
process.env.DSH_HOME = home

const { NovelWriterService, parseChapterWatchEventPath } = await import('../service.js')
const { openDatabase, SCHEMA_VERSION } = await import('../db.js')
const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await stat(abs(target))
      return { version: String(info.mtimeMs) }
    } catch {
      return null
    }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
  listDir: async (target) => (await readdir(abs(target), { withFileTypes: true })).map((entry) => ({
    type: entry.isDirectory() ? 'directory' : 'file',
    name: entry.name,
  })),
  processPath: (target) => abs(target),
}
const service = new NovelWriterService({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})

await service.initProject(project, { title: '正文存在性' })
const store = await service.storeFor(project)
const iso = new Date().toISOString()
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: null,
  updatedAt: iso,
  volumes: [{
    id: 'v1',
    title: '卷一',
    chapters: [1, 2, 3, 4].map((number) => ({
      id: `c${number}`,
      number,
      title: `第${number}章`,
      synopsis: '破庙里遇到神秘人',
      status: 'confirmed',
      wordBudget: 3000,
      inputs: {},
      plant: [],
      payoff: [],
    })),
  }],
})
assert.equal(store.readProject().proseFlagsBackfilled, true, '新项目应带 proseFlagsBackfilled 标记')
assert.equal(store.listChapterProseFlags().size, 0, '新项目初始无 flags')

// ---------- 1) service 写正文 → flags 正确 ----------
await service.writeTextFile(project, 'story/chapters/001/draft.md', '第1章草稿：破庙里遇到神秘人。')
let flags = store.listChapterProseFlags()
assert.deepEqual(flags.get(1), { hasDraft: true, hasFinal: false }, '写 draft 后 hasDraft=true')
await service.writeTextFile(project, 'story/chapters/001/final.md', '第1章定稿：破庙里遇到神秘人。')
flags = store.listChapterProseFlags()
assert.deepEqual(flags.get(1), { hasDraft: true, hasFinal: true }, '写 final 后 hasFinal=true')

// ---------- 2) 外部直接 fs 写正文 → 监听 flush 后 flags 正确 ----------
await mkdir(join(project, 'story', 'chapters', '002'), { recursive: true })
await service.flushChapterWatch(project) // 建立签名基线
await writeFile(join(project, 'story', 'chapters', '002', 'draft.md'), '第2章外部直写：破庙里遇到神秘人。', 'utf8')
const flushed = await service.flushChapterWatch(project)
assert.ok(flushed.reindexed.includes(2), 'flush 应检测到第2章外部写入')
flags = store.listChapterProseFlags()
assert.deepEqual(flags.get(2), { hasDraft: true, hasFinal: false }, '外部直写后监听应更新 flags')

// ---------- 3) scanChapterFiles 命中 DB 分支：不做目录扫描 ----------
const beforeScans = service.proseScanCount
const scanned = await service.scanChapterFiles(project, project)
assert.equal(service.proseScanCount, beforeScans, 'DB flags 命中时不应触发目录扫描')
assert.deepEqual(scanned.get(1), { hasDraft: true, hasFinal: true })
assert.deepEqual(scanned.get(2), { hasDraft: true, hasFinal: false })

// ---------- 4) 删章后 flags/行清除 ----------
await service.writeJson(project, 'story/chapters/002/meta.json', { chapterId: 'c2', number: 2, title: '第2章', status: 'drafted', wordCount: 10 })
assert.ok(store.readChapterMeta(2), '第2章 meta 应存在')
await service.deleteChapter(project, { number: 2, snapshot: false })
assert.equal(store.readChapterMeta(2), null, '删章后 meta 行应删除')
assert.equal(store.listChapterProseFlags().has(2), false, '删章后 flags 应清除')

// ---------- 5) schema v1 旧库升级到 v2：列补齐、数据不丢 ----------
const legacyRoot = await mkdtemp(join(tmpdir(), 'deepnovel-flags-legacy-'))
await mkdir(join(legacyRoot, 'story'), { recursive: true })
const legacyDbPath = join(legacyRoot, 'story', 'project.db')
{
  const db = new DatabaseSync(legacyDbPath)
  db.exec('CREATE TABLE chapter_meta (number INTEGER PRIMARY KEY, json TEXT, status TEXT, word_count INTEGER, outline_hash TEXT, updated_at TEXT)')
  db.exec("INSERT INTO chapter_meta (number, json, status, word_count, updated_at) VALUES (1, '{\"number\":1,\"title\":\"旧章\"}', 'drafted', 120, '2026-01-01T00:00:00.000Z')")
  db.exec('PRAGMA user_version = 1')
  db.close()
}
const migratedDb = openDatabase(legacyDbPath)
const version = Number(migratedDb.prepare('PRAGMA user_version').get().user_version)
assert.equal(version, SCHEMA_VERSION, 'user_version 应升到 v2')
const columns = new Set(migratedDb.prepare("PRAGMA table_info('chapter_meta')").all().map((column) => column.name))
assert.ok(columns.has('has_draft') && columns.has('has_final'), '旧库应补上 has_draft/has_final 列')
const legacyRow = migratedDb.prepare('SELECT number, json, word_count FROM chapter_meta WHERE number = 1').get()
assert.equal(Number(legacyRow.word_count), 120, '升级不应丢数据')
assert.ok(String(legacyRow.json).includes('旧章'), '升级不应丢 JSON')
migratedDb.close()

// ---------- 6) 300 章冷启动：DB flags 命中，零目录扫描且 <30ms ----------
const bulkRoot = await mkdtemp(join(tmpdir(), 'deepnovel-flags-bulk-'))
await service.initProject(bulkRoot, { title: '300章' })
const bulkStore = await service.storeFor(bulkRoot)
const bulkCount = 300
await bulkStore.tx(() => {
  for (let number = 1; number <= bulkCount; number += 1) {
    const pad = String(number).padStart(3, '0')
    bulkStore.setChapterProseFlags(number, { hasDraft: number <= 250, hasFinal: number <= 100 })
    void pad
  }
})
await mkdir(join(bulkRoot, 'story', 'chapters'), { recursive: true })
for (let number = 1; number <= bulkCount; number += 1) {
  const pad = String(number).padStart(3, '0')
  await mkdir(join(bulkRoot, 'story', 'chapters', pad), { recursive: true })
  if (number <= 250) await writeFile(join(bulkRoot, 'story', 'chapters', pad, 'draft.md'), `第${number}章正文：破庙里遇到神秘人。`, 'utf8')
  if (number <= 100) await writeFile(join(bulkRoot, 'story', 'chapters', pad, 'final.md'), `第${number}章正文：破庙里遇到神秘人。`, 'utf8')
}
service.chapterFileCache.delete(bulkRoot)
const scanBefore = service.proseScanCount
const startedAt = performance.now()
const bulkFiles = await service.scanChapterFiles(bulkRoot, bulkRoot)
const elapsed = performance.now() - startedAt
assert.equal(bulkFiles.size, bulkCount, '应返回全部 300 章的 flags')
assert.equal(service.proseScanCount, scanBefore, '冷启动不应触发目录扫描（DB flags 命中）')
assert.ok(elapsed < 30, `300 章 DB flags 读取应 <30ms，实测 ${elapsed.toFixed(1)}ms`)
console.log(`300 章冷启动 scanChapterFiles: ${elapsed.toFixed(2)}ms（未触发目录扫描）`)
assert.deepEqual(bulkFiles.get(1), { hasDraft: true, hasFinal: true })
assert.deepEqual(bulkFiles.get(300), { hasDraft: false, hasFinal: false })

// ---------- 7) 监听事件路径解析 + 去抖合并（纯函数 / 内部队列） ----------
assert.deepEqual(parseChapterWatchEventPath('001/draft.md'), { number: 1, file: 'draft' })
assert.deepEqual(parseChapterWatchEventPath('012/final.md'), { number: 12, file: 'final' })
assert.deepEqual(parseChapterWatchEventPath('001\\draft.md'), { number: 1, file: 'draft' })
assert.deepEqual(parseChapterWatchEventPath('story/chapters/003/draft.md'), { number: 3, file: 'draft' })
assert.equal(parseChapterWatchEventPath('001/notes.txt'), null)
assert.equal(parseChapterWatchEventPath('abc/draft.md'), null)
assert.equal(parseChapterWatchEventPath('001/draft.md.bak'), null)

service.chapterWatchDebounceMs = 30
await service.ensureChapterWatch(project)
const watchEntry = service.chapterWatches.get(project)
assert.ok(watchEntry, '项目应建立监听记录')
watchEntry.pending.clear()
service.collectChapterWatchEvent(project, '001/draft.md')
service.collectChapterWatchEvent(project, '002/final.md')
service.collectChapterWatchEvent(project, '001/final.md')
assert.equal(watchEntry.pending.size, 2, '连续事件应按章号合并去重（001、002）')
await new Promise((resolve) => setTimeout(resolve, 120))
assert.equal(watchEntry.pending.size, 0, '去抖窗口后应收敛处理并清空队列')

service.disposeStores()
assert.equal(service.chapterWatches.size, 0, 'dispose 应关闭全部监听')
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
await rm(legacyRoot, { recursive: true, force: true })
await rm(bulkRoot, { recursive: true, force: true })
console.log('prose flags tests passed')
