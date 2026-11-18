// 碎片化改正文（novel_chapter action=patch / service.patchChapterText）：
// 只替换片段、不调用 LLM、rev 备份、meta 标记、final 置 stale、FTS 同步。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-patch-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-patch-project-'))
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
let llmCalls = 0
const service = new NovelWriterService({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: {
    resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
    stream: async function* () {
      llmCalls += 1
      yield { type: 'text-delta', text: '{}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  },
})

await service.initProject(project, { title: 'patch 测试' })
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
const originalDraft = '林昭在雨夜的破庙里遇到神秘人。对方留下半块玉佩。林昭收起玉佩继续赶路。'
await service.writeTextFile(project, 'story/chapters/001/draft.md', originalDraft)
await service.writeJson(project, 'story/chapters/001/meta.json', {
  chapterId: 'c1',
  number: 1,
  title: '第1章',
  status: 'drafted',
  wordCount: originalDraft.length,
  updatedAt: iso,
})
const store = await service.storeFor(project)
const searchHits = async (query) => (await service.searchProject(project, { query })).results
  .filter((item) => item.type === 'chapter' && Number(item.number) === 1)

// ---------- 1) patch 成功（唯一匹配） ----------
assert.equal(llmCalls, 0, '补丁前不应调用模型')
const result = await service.patchChapterText(project, {
  number: 1,
  target: 'draft',
  find: '半块玉佩',
  replace: '完整的羊皮卷',
  note: '审查中断后小步改',
})
assert.equal(result.replaced, 1)
assert.equal(result.target, 'draft')
assert.equal(result.staleFinal, false)
assert.ok(result.wordCount > 0)
assert.equal(llmCalls, 0, 'patch 不应调用 LLM')
const patchedDraft = await service.readText(project, 'story/chapters/001/draft.md')
assert.ok(patchedDraft.includes('完整的羊皮卷'), '正文应替换成功')
assert.ok(!patchedDraft.includes('半块玉佩'), '旧片段应被替换掉')
// revision 备份（替换前全文）存在
const revision = await service.readText(project, result.revisionPath)
assert.equal(revision, originalDraft, '修订备份应保留替换前全文')
// meta 标记
const meta = store.readChapterMeta(1)
assert.equal(meta.status, 'manual', 'patch 后 meta.status 应为 manual')
assert.equal(meta.wordCount, result.wordCount, 'meta.wordCount 应更新')
assert.ok(meta.outlineHash, '应写入 outlineHash')
assert.ok(meta.lastRunId, '应写入 lastRunId')
// FTS 同步
assert.ok((await searchHits('完整的羊皮卷')).length > 0, 'FTS 应命中新内容')
assert.equal((await searchHits('半块玉佩')).length, 0, 'FTS 不应再命中旧内容')
// run 记录
const runs = store.listRuns(20)
assert.ok(runs.some((run) => run.kind === 'chapter.patch'), '应写 chapter.patch run 记录')

// ---------- 2) all=true 替换多次 ----------
await service.writeTextFile(project, 'story/chapters/001/draft.md', '破庙里遇到神秘人。破庙里有人点灯。破庙里很安静。')
const multi = await service.patchChapterText(project, {
  number: 1,
  target: 'draft',
  find: '破庙里',
  replace: '山神庙里',
  all: true,
})
assert.equal(multi.replaced, 3, 'all=true 应替换全部 3 次')
const multiDraft = await service.readText(project, 'story/chapters/001/draft.md')
assert.equal((multiDraft.match(/山神庙里/g) ?? []).length, 3, '替换后不应残留旧片段')

// ---------- 3) find 不存在 → 报错 ----------
await assert.rejects(
  () => service.patchChapterText(project, { number: 1, find: '根本不存在的片段', replace: 'x' }),
  /没找到要替换的片段/,
  'find 不存在应报错',
)

// ---------- 4) 多次出现且 all=false → 报错 ----------
await service.writeTextFile(project, 'story/chapters/001/draft.md', '重复片段重复片段')
await assert.rejects(
  () => service.patchChapterText(project, { number: 1, find: '重复片段', replace: '新片段' }),
  /片段出现 2 次/,
  '多次匹配且 all=false 应报错',
)

// ---------- 5) final patch → finalStale ----------
await service.writeTextFile(project, 'story/chapters/001/final.md', '定稿：林昭在破庙里遇到神秘人。')
await service.writeJson(project, 'story/chapters/001/meta.json', {
  chapterId: 'c1', number: 1, title: '第1章', status: 'approved', wordCount: 20, updatedAt: iso,
})
const finalPatch = await service.patchChapterText(project, {
  number: 1,
  target: 'final',
  find: '破庙里',
  replace: '山神庙里',
})
assert.equal(finalPatch.target, 'final')
assert.equal(finalPatch.staleFinal, true, '改 final 后应标记 staleFinal')
const finalMeta = store.readChapterMeta(1)
assert.equal(finalMeta.finalStale, true, 'meta.finalStale 应为 true')
assert.equal(finalMeta.status, 'manual')
const patchedFinal = await service.readText(project, 'story/chapters/001/final.md')
assert.ok(patchedFinal.includes('山神庙里'), 'final 应被替换')

// ---------- 6) chapterDetail 补 hasDraft/hasFinal/wordCount ----------
const detail = await service.chapterDetail(project, 1)
assert.deepEqual(
  { hasDraft: detail.hasDraft, hasFinal: detail.hasFinal },
  { hasDraft: true, hasFinal: true },
  'chapterDetail 应提供 hasDraft/hasFinal',
)
assert.equal(detail.wordCount, finalMeta.wordCount, 'chapterDetail 应提供 wordCount')

// ---------- 7) 目标文件不存在时给出可操作错误 ----------
const emptyProject = await mkdtemp(join(tmpdir(), 'deepnovel-patch-empty-'))
await service.initProject(emptyProject, { title: '空章节' })
await service.writeJson(emptyProject, 'story/plot/outline.json', {
  status: 'confirmed', logline: null, updatedAt: iso,
  volumes: [{ id: 'v1', title: '卷一', chapters: [{ id: 'c1', number: 1, title: '第1章', synopsis: 'x', status: 'confirmed', wordBudget: 3000, inputs: {}, plant: [], payoff: [] }] }],
})
await assert.rejects(
  () => service.patchChapterText(emptyProject, { number: 1, find: 'a', replace: 'b' }),
  /还没有草稿/,
  '没有草稿时应提示先 read/draft',
)
service.disposeStores()
await rm(emptyProject, { recursive: true, force: true })

// ---------- 9) 外部直写正文 → flush 标 manual；改 final 置 finalStale ----------
{
  service.recentSelfWrites.clear() // 模拟外部编辑器（无自写记录）
  const store2 = await service.storeFor(project)
  await service.flushChapterWatch(project) // 基线
  await writeFile(join(project, 'story', 'chapters', '001', 'final.md'), '外部直写定稿：山神庙里遇到神秘人。', 'utf8')
  const flushed = await service.flushChapterWatch(project)
  assert.ok(flushed.reindexed.includes(1), 'flush 应检测到外部 final 变化')
  const externalMeta = store2.readChapterMeta(1)
  assert.equal(externalMeta.status, 'manual', '外部改动应把 meta.status 标为 manual')
  assert.equal(externalMeta.finalStale, true, '外部改 final 应置 finalStale')
}

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('chapter patch tests passed')

// ---------- 8) 工具错误包装 + 系统提示词两段 ----------
{
  const { apply } = await import('../agent.js')
  const registered = []
  const sections = []
  apply({
    tools: { register: (tool) => registered.push(tool) },
    systemPrompt: { section: (section) => sections.push(section) },
  })
  assert.ok(registered.length >= 10, '应注册全部工具')
  const chapterTool = registered.find((tool) => tool.name === 'novel_chapter')
  assert.ok(chapterTool, '应有 novel_chapter 工具')
  const toolError = await chapterTool.execute({ action: 'list' }, { agent: 'not-initialized', signal: null })
  assert.equal(toolError.ok, false, '工具抛错应返回结构化错误（不裸抛异常）')
  assert.ok(toolError.error, '应包含 error 信息')
  assert.ok(toolError.hint, '应包含 hint 下一步建议')
  assert.equal(toolError.tool, 'novel_chapter')
  const names = sections.map((section) => section.name)
  assert.ok(names.includes('deepnovel:data-layer-rules'), '应有数据层规则提示词')
  assert.ok(names.includes('deepnovel:interruption-recovery'), '应有中断恢复提示词')
  const orders = sections.map((section) => section.order)
  assert.ok(orders.includes(10149) && orders.includes(10151), '提示词顺序应为 10149/10151')
  const params = chapterTool.parameters.properties
  assert.ok(params.find && params.replace && params.all && params.target && params.note, 'novel_chapter 应暴露 patch 参数')
  assert.ok(params.action.enum.includes('patch'), 'action 枚举应包含 patch')
}
