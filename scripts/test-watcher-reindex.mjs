// 外部直接写正文（绕过 service）后：索引、wordCount、搜索 snippet 都要跟上，且重复写入幂等。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-watch-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-watch-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
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

await service.initProject(project, { title: '外部改正文' })
const iso = new Date().toISOString()
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: null,
  updatedAt: iso,
  volumes: [{
    id: 'v1',
    title: '卷一',
    chapters: [{
      id: 'c1',
      number: 1,
      title: '第1章',
      synopsis: '破庙里遇到神秘人',
      status: 'confirmed',
      wordBudget: 3000,
      inputs: {},
      plant: [],
      payoff: [],
    }],
  }],
})
await mkdir(join(project, 'story', 'chapters', '001'), { recursive: true })
const store = await service.storeFor(project)

// 等轮询监听的签名基线建立（ensureChapterWatch 首次是异步建立）
const waitPrimed = async () => {
  for (let index = 0; index < 100; index += 1) {
    if (service.chapterWatches.get(project)?.primed) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('正文监听基线未建立')
}
await waitPrimed()

// 1) 外部直接写文件（绕过 service.writeTextFile）
const body = '林昭在雨夜的破庙里遇到神秘人，对方留下半块玉佩。'
await writeFile(join(project, 'story', 'chapters', '001', 'draft.md'), body, 'utf8')
const flushed = await service.flushChapterWatch(project)
assert.deepEqual(flushed.reindexed, [1], 'flush 应检测到第 1 章正文变化')

// FTS 命中 + snippet（前端按 [[ ]] 解析高亮）
const search = await service.searchProject(project, { query: '破庙里' })
assert.ok(
  search.results.some((item) => item.type === 'chapter' && Number(item.number) === 1),
  '搜索应命中外部写入的正文',
)
assert.ok(
  search.results.some((item) => String(item.snippet).includes('[[破庙里]]')),
  'snippet 应带 [[ ]] 高亮标记',
)

// chapter_meta.wordCount 修正为实际字数（忽略空白）
const expected = body.replace(/\s+/g, '').length
assert.equal(store.readChapterMeta(1).wordCount, expected, 'wordCount 应更新为实际字数')

// 2) 再写一次同一文件：索引不重复（该章 FTS 只有 1 行），wordCount 继续更新
const second = `${body}又追来一名黑衣人。`
await writeFile(join(project, 'story', 'chapters', '001', 'draft.md'), second, 'utf8')
await service.flushChapterWatch(project)
const rows = store.db.prepare('SELECT COUNT(*) AS n FROM fts_chapters WHERE number = 1').get()
assert.equal(Number(rows.n), 1, '重复写入后该章 FTS 仍只有 1 行（幂等）')
assert.equal(store.readChapterMeta(1).wordCount, second.replace(/\s+/g, '').length, 'wordCount 应随内容继续更新')

// 3) 轮询定时器也能捕获变化（用短轮询验证一次）
service.chapterWatchPollMs = 60
service.closeChapterWatch(project)
service.ensureChapterWatch(project)
await waitPrimed()
const third = `${second}破庙里的钟声响起。`
await writeFile(join(project, 'story', 'chapters', '001', 'final.md'), third, 'utf8')
for (let index = 0; index < 100 && !(service.chapterWatches.get(project)?.known.size > 0); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 20))
}
let polled = null
for (let index = 0; index < 200; index += 1) {
  const meta = store.readChapterMeta(1)
  if (meta && meta.wordCount === third.replace(/\s+/g, '').length) {
    polled = meta
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 20))
}
assert.ok(polled, '轮询定时器应捕获 final.md 的外部变化')

// 4) dispose 后监听关闭
service.disposeStores()
assert.equal(service.chapterWatches.size, 0, 'disposeStores 应关闭全部正文监听')
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('watcher reindex tests passed')
