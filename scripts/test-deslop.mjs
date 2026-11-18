// 去 AI 味：审查 aiFlavor 透传 + deslop 改写（备份/长度校验/dryRun/target 选择/失败不落盘）。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-deslop-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-deslop-project-'))
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
  llm: {
    resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
    stream: async function* () {},
  },
})

await service.initProject(project, { title: 'deslop 测试' })
const iso = new Date().toISOString()
const chapter = (number, title) => ({
  id: `c${number}`,
  number,
  title,
  synopsis: `第${number}章的剧情梗概`,
  status: 'confirmed',
  wordBudget: 3000,
  inputs: {},
  plant: [],
  payoff: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: '一句话',
  updatedAt: iso,
  volumes: [{ id: 'v1', title: '卷一', chapters: [chapter(1, '第1章'), chapter(2, '第2章')] }],
})
const aiDraft = [
  '他缓缓走进破庙，眼中闪过一丝不易察觉的悲伤。',
  '仿佛整个世界都安静下来，他深吸一口气，嘴角勾起一抹冷笑。',
  '他感到一阵失落，不禁微微皱眉，心中涌起一股说不清的情绪。',
  '这一刻，他终于明白，命运早已注定。',
].join('\n\n')
const humanDraft = [
  '他走进破庙，脚踩在碎瓦上响了一声。',
  '庙里没人。梁上垂着半截断绳，风一吹，晃。',
  '他把包袱放在供桌上，坐下，手指在桌沿敲了两下。',
  '"来晚了。"',
  '供桌后面传来一声咳。',
].join('\n\n')
await service.writeTextFile(project, 'story/chapters/001/draft.md', aiDraft)
await service.writeJson(project, 'story/chapters/001/meta.json', {
  chapterId: 'c1', number: 1, title: '第1章', status: 'drafted', wordCount: aiDraft.length, updatedAt: iso,
})
await service.writeTextFile(project, 'story/chapters/002/draft.md', aiDraft)
await service.writeJson(project, 'story/chapters/002/meta.json', {
  chapterId: 'c2', number: 2, title: '第2章', status: 'drafted', wordCount: aiDraft.length, updatedAt: iso,
})
const store = await service.storeFor(project)

let captured = null
let nextResponse = null
service.callJsonModel = async (agent, options) => {
  captured = options
  const parsed = nextResponse
  return { parsed, usage: null, first: { model: null, durationMs: 0 } }
}

// ---------- 1) prompt 要点：禁用词清单 + 改最少原则 ----------
nextResponse = { text: humanDraft, changes: [{ from: '缓缓走进', to: '走进', reason: '禁用词' }] }
const result = await service.deslopChapter(project, { number: 1, target: 'draft' })
assert.ok(captured, '应调用模型')
assert.equal(captured.task, 'deslop')
assert.match(captured.system, /改最少/, 'prompt 应含“改最少”原则')
assert.match(captured.system, /禁用词/, 'prompt 应含禁用词规则')
assert.match(captured.system, /章末总结|升华/, 'prompt 应含章末升华禁令')
const userText = captured.messages[0].content[0].text
assert.match(userText, /仿佛|一丝|缓缓|眼中闪过/, 'user prompt 应带一级禁用词清单')
assert.match(userText, /当前正文/, 'user prompt 应带当前正文')
assert.match(userText, /只改“怎么说”/, 'user prompt 应声明只改怎么说')

// ---------- 2) deslop 成功：写回 + 修订备份 + meta + QA 清理 + run ----------
assert.equal(result.target, 'draft')
assert.equal(result.changed, 1)
assert.ok(result.beforeAiFlavor.score < result.afterAiFlavor.score, '去 AI 味后分数应上升')
assert.ok(result.beforeAiFlavor.markers.length > 0, '改写前应识别出禁用词 markers')
assert.ok(result.revisionPath.startsWith('story/chapters/001/revisions/deslop-'), '应写 deslop 修订备份')
const written = await service.readText(project, 'story/chapters/001/draft.md')
assert.equal(written, humanDraft, '正文应写回改写版')
const backup = await service.readText(project, result.revisionPath)
assert.equal(backup, aiDraft, '修订备份应是改写前全文')
const meta = store.readChapterMeta(1)
assert.equal(meta.status, 'manual', 'meta.status 应为 manual')
assert.equal(meta.wordCount, result.wordCount, 'meta.wordCount 应更新')
assert.ok(meta.outlineHash, '应写入 outlineHash')
assert.ok(meta.lastRunId, '应写入 lastRunId')
const runs = store.listRuns(30)
assert.ok(runs.some((run) => run.kind === 'chapter.deslop'), '应写 chapter.deslop run')
// FTS 同步（writeTextFile 自动重建该章索引）
const searchHits = async (query) => (await service.searchProject(project, { query })).results
  .filter((item) => item.type === 'chapter' && Number(item.number) === 1)
assert.ok((await searchHits('来晚了')).length > 0, 'FTS 应命中改写后的新内容')
// QA 文件被清（旧质检失效）
const qaExists = await service.readText(project, 'story/chapters/001/qa.json').catch(() => null)
assert.equal(qaExists, null, 'deslop 后应清掉旧 qa')

// ---------- 3) 长度异常（±30% 外）失败且不落盘 ----------
const beforeText = await service.readText(project, 'story/chapters/002/draft.md')
const revisionCountBefore = (await readdir(join(project, 'story/chapters/002/revisions')).catch(() => [])).length
nextResponse = { text: '太短了。', changes: [] }
let lengthError = null
try {
  await service.deslopChapter(project, { number: 2, target: 'draft' })
} catch (error) {
  lengthError = error
}
assert.ok(lengthError, '长度变化过大应抛错')
assert.match(lengthError.message, /字数变化过大/)
assert.equal(await service.readText(project, 'story/chapters/002/draft.md'), beforeText, '失败不应改动正文')
const revisionCountAfter = (await readdir(join(project, 'story/chapters/002/revisions')).catch(() => [])).length
assert.equal(revisionCountAfter, revisionCountBefore, '失败不应写修订备份')

// ---------- 4) dryRun 只预览不落盘 ----------
const dryBefore = await service.readText(project, 'story/chapters/002/draft.md')
nextResponse = { text: humanDraft, changes: [{ from: '仿佛', to: '', reason: '禁用词' }] }
const dry = await service.deslopChapter(project, { number: 2, target: 'draft', dryRun: true })
assert.equal(dry.dryRun, true)
assert.equal(dry.text, humanDraft)
assert.ok(dry.afterAiFlavor.score > dry.beforeAiFlavor.score)
assert.equal(await service.readText(project, 'story/chapters/002/draft.md'), dryBefore, 'dryRun 不应写正文')

// ---------- 5) target 选择：final 优先；显式 draft ----------
await service.writeTextFile(project, 'story/chapters/002/final.md', aiDraft)
nextResponse = { text: humanDraft, changes: [] }
const finalResult = await service.deslopChapter(project, { number: 2 })
assert.equal(finalResult.target, 'final', 'final 存在时应默认改 final')
assert.equal(await service.readText(project, 'story/chapters/002/final.md'), humanDraft)
assert.equal(await service.readText(project, 'story/chapters/002/draft.md'), dryBefore, '默认改 final 时 draft 不变')
const finalMeta = store.readChapterMeta(2)
assert.equal(finalMeta.finalStale, true, '改 final 后 finalStale 应为 true')
nextResponse = { text: humanDraft, changes: [] }
const explicitDraft = await service.deslopChapter(project, { number: 2, target: 'draft' })
assert.equal(explicitDraft.target, 'draft')

// ---------- 6) AI 味审校解析：aiFlavor 透传 ----------
nextResponse = {
  score: 88,
  summary: '整体自然',
  aiFlavor: { level: '中', score: 72, markers: [{ type: '禁用词', quote: '仿佛', word: '仿佛' }] },
  issues: [{ category: 'AI味', severity: 'medium', quote: '仿佛', advice: '删掉' }],
}
const styleQa = await service.styleAudit(project, { number: 1 })
assert.equal(styleQa.aiFlavor.level, '中')
assert.equal(styleQa.aiFlavor.score, 72)
assert.equal(styleQa.aiFlavor.markers[0].word, '仿佛')
assert.ok(styleQa.issues.some((issue) => issue.code.startsWith('AI_')))

nextResponse = {
  score: 90,
  summary: 'ok',
  aiFlavor: { level: '轻', score: 86, markers: [] },
  styleIssues: [],
  continuityIssues: [],
}
const review = await service.chapterReview(project, { number: 1 })
assert.equal(review.styleQa.aiFlavor.level, '轻')
assert.equal(review.styleQa.aiFlavor.score, 86)

// 模型没给 aiFlavor 时用启发式兜底
nextResponse = { score: 60, summary: 'x', issues: [] }
const fallback = await service.styleAudit(project, { number: 2 })
assert.ok(fallback.aiFlavor && typeof fallback.aiFlavor.score === 'number', '缺少 aiFlavor 时应启发式兜底')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('deslop tests passed')
