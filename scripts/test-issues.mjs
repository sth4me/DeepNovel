// 待处理问题聚合：issuesSummary（本地统计）、replan 范围、limit、project-state/action/tool、UI 静态断言。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-issues-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-issues-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')

const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try { const info = await stat(abs(target)); return { version: String(info.mtimeMs) } } catch { return null }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
  listDir: async () => [],
  processPath: (target) => abs(target),
}
const service = new NovelWriterService({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})
setNovelWriter(service)

await service.initProject(project, { title: '问题聚合' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: '角色1', length: { chapters: 10, wordsPerChapter: 1000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { pov: 'third-limited', chapterWords: 1000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '角色1', role: '主角', description: '主角' }],
  locations: [], rules: [], factions: [], items: [],
})
const chapter = (number) => ({
  id: `ch-${String(number).padStart(3, '0')}`,
  number,
  title: `第${number}章`,
  synopsis: `第${number}章的具体剧情。`,
  status: 'confirmed',
  wordBudget: 1000,
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '城区', goal: '目标', chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(chapter) }],
})
const shortDraft = '他走进巷子，看见门口站着一个人。'.repeat(40)   // ~640 汉字，低于 800
const okDraft = '他走进巷子，看见门口站着一个人，于是停下脚步，把手里的信按回口袋里。'.repeat(40) // >800
await service.writeTextFile(project, 'story/chapters/001/draft.md', shortDraft)
await service.writeTextFile(project, 'story/chapters/002/draft.md', okDraft)
await service.writeTextFile(project, 'story/chapters/001/final.md', shortDraft)
await service.writeTextFile(project, 'story/chapters/002/final.md', okDraft)
await service.writeJson(project, 'story/chapters/001/meta.json', { number: 1, chapterId: 'ch-001', title: '第1章', status: 'drafted', wordCount: 640 })
await service.writeJson(project, 'story/chapters/002/meta.json', { number: 2, chapterId: 'ch-002', title: '第2章', status: 'drafted', wordCount: 960 })
await service.reindexProject(project)
await service.writeJson(project, 'story/state/002.json', {
  number: 2,
  characters: [{ name: '角色1', situation: '在巷口', nextHook: '继续走' }],
  summary: '第2章结束',
})

// outline-audit：一致性 + 结构（第5–8章连续被动 / 第7章重复）+ 过期清理
await service.writeJson(project, 'story/plot/outline-audit.json', {
  fromChapter: 1,
  toChapter: 10,
  issues: [{ level: 'warn', number: 3, message: '第3章时间线与第2章矛盾', advice: '调整第3章' }],
  structureIssues: [
    { type: '主角被动', number: 5, message: '第5章被动', advice: '补主动选择' },
    { type: '主角被动', number: 6, message: '第6章仍被动', advice: '补主动选择' },
    { type: '桥段重复', number: 7, message: '第7章同一手段无升级', advice: '升级代价' },
    { type: '主角被动', number: 8, message: '第8章仍被动', advice: '补主动选择' },
  ],
  staleCount: 2,
  checkedAt: new Date().toISOString(),
})

let modelCalls = 0
service.callJsonModel = async () => { modelCalls += 1; return { parsed: {}, runId: 'x' } }
service.callModel = async () => { modelCalls += 1; return { text: '' } }

// ---------- 1) issuesSummary：聚合来源与 actions ----------
const summary = await service.issuesSummary(project)
assert.ok(summary.count >= 4, `应聚合多类问题，实际 ${summary.count}`)
assert.ok(Array.isArray(summary.items) && summary.items.length > 0)
assert.ok(summary.generatedAt)
const outlineIssue = summary.items.find((item) => item.source === 'outline' && item.type === '一致性问题')
assert.ok(outlineIssue, '应包含大纲一致性问题')
assert.equal(outlineIssue.chapter, 3)
assert.deepEqual(outlineIssue.actions.map((action) => action.id), ['repair', 'audit', 'dismiss'])
assert.equal(outlineIssue.severity, 'warn')
const replanItem = summary.items.find((item) => item.source === 'outline' && item.actions.some((action) => action.id === 'replan'))
assert.ok(replanItem, '应包含结构问题 replan')
const replanAction = replanItem.actions.find((action) => action.id === 'replan')
assert.deepEqual(replanAction.params, { fromChapter: 5, toChapter: 8 }, 'replan 范围应来自 buildStructureReplan（5–8 合并）')
assert.ok(replanAction.label.includes('第 5–8 章'))
const staleItem = summary.items.find((item) => item.source === 'stale')
assert.ok(staleItem, '应包含过期清理提示')
assert.equal(staleItem.severity, 'info')
const wordItem = summary.items.find((item) => item.source === 'chapter' && item.type === '字数不足')
assert.ok(wordItem, '应包含字数不足')
assert.equal(wordItem.chapter, 1)
assert.deepEqual(wordItem.actions[0].params, { number: 1 })
const stateItem = summary.items.find((item) => item.source === 'state' && item.type === '人物状态未更新')
assert.ok(stateItem, '应包含人物状态未更新')
assert.equal(stateItem.chapter, 1, '第 2 章有 state 不应报，第 1 章缺 state 应报')
assert.equal(summary.items.some((item) => item.source === 'state' && item.chapter === 2), false)
assert.equal(modelCalls, 0, 'issuesSummary 不应调用模型')

// ---------- 2) limit 生效 ----------
const limited = await service.issuesSummary(project, { limit: 2 })
assert.equal(limited.items.length, 2)
assert.equal(limited.count, summary.count, 'count 应为总数（不受 limit 影响）')

// ---------- 3) project-state / issues-list / novel_issues ----------
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.ok(indexSource.includes('issuesSummary'), 'project-state 应聚合 issues')
assert.ok(indexSource.includes("case 'issues-list'"), '应有 issues-list action')
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const issuesTool = registered.find((item) => item.name === 'novel_issues')
assert.ok(issuesTool, '应注册 novel_issues')
const toolResult = await issuesTool.execute({ limit: 5 }, { agent: project, signal: null })
assert.ok(toolResult.count >= 4)
assert.ok(Array.isArray(toolResult.items) && toolResult.items.length <= 5)

// ---------- 4) client 静态断言：待处理 + 动作 ----------
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(clientSource.includes('待处理（'), 'client 应显示待处理（N）')
assert.ok(clientSource.includes("runIssueAction"), 'client 应有动作分发')
for (const action of ['outline-repair', 'outline-audit', 'outline-generate', 'chapter-state-update']) {
  assert.ok(clientSource.includes(action), `client 应能触发 ${action}`)
}
assert.ok(clientSource.includes('showIssuesModal'), 'client 应有查看全部 modal')
assert.ok(clientSource.includes('人物状态未更新') || clientSource.includes('issue.type'), 'client 应展示问题类型/信息')
// 回归：runIssueAction / showIssuesModal 必须在 App 中定义，并显式传给子组件（否则大纲页 ReferenceError 白屏）
assert.ok(/function OutlineWorkbench\(\{[^}]*runIssueAction[^}]*showIssuesModal/.test(clientSource), 'OutlineWorkbench 应接收 runIssueAction/showIssuesModal')
assert.ok(/function ChaptersWorkbench\(\{[^}]*runIssueAction[^}]*showIssuesModal/.test(clientSource), 'ChaptersWorkbench 应接收 runIssueAction/showIssuesModal')
assert.ok(/function ChapterWorkspace\(\{[^}]*runIssueAction[^}]*showIssuesModal/.test(clientSource), 'ChapterWorkspace 应接收 runIssueAction/showIssuesModal')
assert.ok(/h\(OutlineWorkbench, \{[\s\S]{0,400}?runIssueAction[\s\S]{0,200}?showIssuesModal/.test(clientSource), 'OutlineWorkbench 调用应传 runIssueAction/showIssuesModal')
assert.ok(/h\(ChaptersWorkbench, \{[\s\S]{0,400}?runIssueAction[\s\S]{0,200}?showIssuesModal/.test(clientSource), 'ChaptersWorkbench 调用应传 runIssueAction/showIssuesModal')
assert.ok(/h\(ChapterWorkspace, \{[\s\S]{0,400}?runIssueAction[\s\S]{0,200}?showIssuesModal/.test(clientSource), 'ChapterWorkspace 调用应传 runIssueAction/showIssuesModal')


// ---------- 5) 待处理按当前章纲过滤过期项并清理 audit（幂等） ----------
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '城区', goal: '目标', chapters: [chapter(1), chapter(2), chapter(3)] }],
})
await service.writeJson(project, 'story/plot/outline-audit.json', {
  issues: [
    { level: 'warn', number: 3, message: '第3章时间线与第2章矛盾', advice: '调整第3章' },
    { level: 'warn', number: 21, message: '第21章旧问题（章节已删除）', advice: '改' },
    { level: 'warn', number: 24, message: '第24章旧问题（章节已删除）', advice: '改' },
    { level: 'warn', number: null, message: '全局一致性问题', advice: '改' },
  ],
  structureIssues: [
    { type: '主角被动', number: 5, message: '第5–8章旧结构问题（章节已删除）', advice: '改' },
    { type: '调性漂移', number: 0, message: '全局调性漂移', advice: '改' },
  ],
  staleCount: 2,
  checkedAt: new Date().toISOString(),
})
let auditWrites = 0
const originalWriteJson = service.writeJson.bind(service)
service.writeJson = async (agent, path, value) => {
  if (String(path).includes('outline-audit')) auditWrites += 1
  return originalWriteJson(agent, path, value)
}
const filtered = await service.issuesSummary(project)
assert.ok(filtered.items.some((item) => item.source === 'outline' && item.chapter === 3), '保留当前章节问题（第3章）')
assert.equal(filtered.items.some((item) => item.chapter === 21 || item.chapter === 24), false, '过期章节问题不应出现在待处理列表')
const globalIssue = filtered.items.find((item) => item.source === 'outline' && item.type === '一致性问题' && item.chapter === null)
assert.ok(globalIssue, 'number 为空的全局问题应保留')
assert.ok(filtered.items.some((item) => item.source === 'outline' && item.actions.some((action) => action.id === 'replan')), '全局结构问题应保留（replan）')
assert.equal(filtered.items.some((item) => item.chapter === 5), false, '过期结构问题不应出现在待处理列表')
const staleItem2 = filtered.items.find((item) => item.source === 'stale')
assert.ok(staleItem2, '应提示已清理过期项')
const staleNumbers = String(staleItem2.message).match(/(\d+)/)?.[1]
assert.ok(Number(staleNumbers) >= 2, `staleCount 应合并旧值与本次清理，实际 ${staleNumbers}`)
const auditAfter = await service.readJson(project, 'story/plot/outline-audit.json')
assert.equal(auditAfter.issues.some((item) => Number(item.number) === 21), false, '文件 issues 应已清理过期项')
assert.equal(auditAfter.issues.some((item) => Number(item.number) === 24), false)
assert.equal(auditAfter.structureIssues.some((item) => Number(item.number) === 5), false, '文件 structureIssues 应已清理过期项')
assert.ok(Number(auditAfter.staleCount) >= 2, '文件 staleCount 应累计')
const firstWrites = auditWrites
assert.ok(firstWrites >= 1 && firstWrites <= 2, '第一次应写盘清理（prune + id 规范化）')
await service.issuesSummary(project)
assert.equal(auditWrites, firstWrites, '第二次调用不应再写盘（幂等）')
service.writeJson = originalWriteJson
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('issues tests passed')
