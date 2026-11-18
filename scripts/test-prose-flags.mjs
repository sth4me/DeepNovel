// schema v2：正文存在性入库（chapter_meta.has_draft/has_final）+ 旧库平滑升级 + 监听事件解析/去抖。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-flags-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-flags-project-'))
process.env.DSH_HOME = home

const { NovelWriterService, parseChapterWatchEventPath } = await import('../service.js')
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

// ---------- 4) 删章后 flags/行清除 ----------
await service.writeJson(project, 'story/chapters/002/meta.json', { chapterId: 'c2', number: 2, title: '第2章', status: 'drafted', wordCount: 10 })
assert.ok(store.readChapterMeta(2), '第2章 meta 应存在')
await service.deleteChapter(project, { number: 2, snapshot: false })
assert.equal(store.readChapterMeta(2), null, '删章后 meta 行应删除')
assert.equal(store.listChapterProseFlags().has(2), false, '删章后 flags 应清除')

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
console.log('prose flags tests passed')
