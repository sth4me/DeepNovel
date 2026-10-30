// Phase 1a 集成测试：service.js 全面切到 SQLite store 后的初始化/读写/删章/搜索/迁移行为。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, stat, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-service-store-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-service-store-'))
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
  listDir: async (target) => {
    const entries = await readdir(abs(target), { withFileTypes: true })
    return entries.map((entry) => ({ type: entry.isDirectory() ? 'directory' : 'file', name: entry.name }))
  },
  processPath: (target) => abs(target),
}
const ctx = {
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
}
const service = new NovelWriterService(ctx)
const exists = async (relative) => Boolean(await fsCtx.stat({ cwd: project, relativePath: relative }))

// 1) initProject：建 DB、不再写结构化 JSON，但 project 行可读
const init = await service.initProject(project, { title: '新项目' })
assert.equal(init.initialized, true)
assert.equal(init.title, '新项目')
assert.ok(await exists('story/project.db'), 'project.db 应已创建')
assert.equal(await exists('story/project.json'), false, '新项目不应再写 project.json')
assert.equal(await exists('story/plot/outline.json'), false, '新项目不应再写 outline.json')
assert.equal((await service.readJson(project, 'story/project.json')).title, '新项目')
assert.equal(await service.isInitialized(project), true)

// 2) 大纲 / 设定写读一致
const outline = {
  status: 'confirmed',
  logline: '一句话',
  volumes: [{
    id: 'v1',
    title: '第一卷',
    map: '山',
    goal: 'g',
    powerCeiling: '筑基',
    exitCriteria: 'e',
    targetChapters: 2,
    chapters: [
      { id: 'c1', number: 1, title: '雨夜', synopsis: '破庙里遇到神秘人', status: 'confirmed', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
      { id: 'c2', number: 2, title: '进城', synopsis: '进城', status: 'confirmed', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
    ],
  }],
  updatedAt: new Date().toISOString(),
}
await service.writeJson(project, 'story/plot/outline.json', outline)
const readOutline = await service.readJson(project, 'story/plot/outline.json')
assert.equal(readOutline.volumes.length, 1)
assert.equal(readOutline.volumes[0].chapters.length, 2)
assert.equal(readOutline.volumes[0].powerCeiling, '筑基')

await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'C#01', name: '林昭', role: '主角', description: '破庙里的剑客', traits: ['谨慎'], goal: '查案' }],
  locations: [], rules: [], factions: [], items: [],
  updatedAt: new Date().toISOString(),
})
const bible = await service.readBible(project)
assert.equal(bible.characters[0].name, '林昭')
assert.deepEqual(bible.characters[0].traits, ['谨慎'])

// 3) 正文写入自动建 FTS；searchProject 走 store.search（3 字命中带 snippet，2 字 LIKE 兜底）
const paths1 = service.chapterPaths(1)
await service.writeTextFile(project, paths1.draft, '林昭在雨夜的破庙里遇到神秘人，对方留下半块玉佩。')
const search = await service.searchProject(project, { query: '破庙里' })
assert.ok(search.results.length > 0, '3 字搜索应有结果')
const chapterHit = search.results.find((item) => item.type === 'chapter')
assert.ok(chapterHit, '应命中章节正文')
assert.equal(chapterHit.number, 1)
assert.ok(chapterHit.snippet.includes('[破庙里]'), `snippet 应高亮：${chapterHit.snippet}`)
assert.ok(search.results.some((item) => item.type === 'outline'), '应命中大纲 synopsis')
const search2 = await service.searchProject(project, { query: '破庙' })
assert.ok(search2.results.length > 0, '2 字搜索应走 LIKE 兜底')

// 4) 章节 meta / qa / summary 写读
await service.writeJson(project, paths1.meta, {
  chapterId: 'c1', number: 1, title: '雨夜', status: 'approved', wordCount: 120,
  updatedAt: new Date().toISOString(),
})
assert.equal((await service.readJson(project, paths1.meta)).wordCount, 120)
await service.writeJson(project, paths1.qa, { status: 'pass', issues: [] })
assert.equal((await service.readJson(project, paths1.qa)).status, 'pass')
await service.writeJson(project, service.chapterSummaryPath(1), {
  number: 1, summary: '破庙里遇到神秘人。', characters: ['林昭'], events: [], openThreads: [],
  generatedAt: new Date().toISOString(),
})
assert.equal((await service.readJson(project, service.chapterSummaryPath(1))).summary, '破庙里遇到神秘人。')

// 5) 删章：DB 行与 FTS 一起清理
const store = await service.storeFor(project)
assert.equal(store.readChapterMeta(1).wordCount, 120)
const deleted = await service.deleteChapter(project, {
  number: 1,
  snapshot: false,
  removeOutline: true,
  renumber: false,
})
assert.equal(deleted.outlineRemoved, true)
assert.equal(store.readChapterMeta(1), null)
assert.equal(store.readChapterSummary(1), null)
assert.equal(store.readChapterState(1), null)
assert.equal(
  store.readOutline().volumes[0].chapters.some((chapter) => Number(chapter.number) === 1),
  false,
  '大纲章节应删除',
)
assert.equal(
  store.search('破庙里').results.some((item) => item.type === 'chapter' && item.number === 1),
  false,
  'FTS 应清理该章',
)

// 6) 旧 JSON 项目首次打开自动迁移；旧文件保留
const legacy = await mkdtemp(join(tmpdir(), 'deepnovel-service-store-legacy-'))
await mkdir(join(legacy, 'story', 'plot'), { recursive: true })
await mkdir(join(legacy, 'story', 'bible'), { recursive: true })
await writeFile(join(legacy, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: '旧项目' }), 'utf8')
await writeFile(join(legacy, 'story', 'bible', 'index.json'), JSON.stringify({
  status: 'confirmed',
  characters: [{ id: 'C#01', name: '旧角色', role: '主角', description: '旧描述' }],
  locations: [], rules: [], factions: [], items: [],
}), 'utf8')
await writeFile(join(legacy, 'story', 'plot', 'outline.json'), JSON.stringify({
  status: 'candidate', logline: null,
  volumes: [{
    id: 'v1', title: '卷',
    chapters: [{ id: 'c1', number: 1, title: '旧章', synopsis: '旧梗概', status: 'candidate', wordBudget: 3000, inputs: {}, plant: [], payoff: [] }],
  }],
}), 'utf8')
assert.equal(await service.isInitialized(legacy), true)
const legacyBible = await service.readBible(legacy)
assert.ok(await stat(join(legacy, 'story', 'project.db')), '首次数据访问应自动迁移出 DB')
assert.equal(legacyBible.characters[0].name, '旧角色')
const legacyOutline = await service.readJson(legacy, 'story/plot/outline.json')
assert.equal(legacyOutline.volumes[0].chapters[0].title, '旧章')
assert.ok(await stat(join(legacy, 'story', 'bible', 'index.json')), '旧 JSON 应保留为只读存档')

service.disposeStores()
// 关闭 watcher 后等事件队列清空，避免 Windows libuv recursive watch 在目录删除时断言
await new Promise((resolve) => setTimeout(resolve, 120))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
await rm(legacy, { recursive: true, force: true })
console.log('service store integration tests passed')
