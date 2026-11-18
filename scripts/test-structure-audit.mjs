// 结构问题分流：审核分离、repair 只修一致性、replan 聚合、structure-only、suggestedAction、工具/UI。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-structure-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-structure-project-'))
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

await service.initProject(project, { title: '结构分流' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: '主角', length: { chapters: 20, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed', characters: [{ id: 'c1', name: '主角', role: '主角', description: '主角' }], locations: [], rules: [], factions: [], items: [],
})
const chapter = (number) => ({
  id: `ch-${String(number).padStart(3, '0')}`,
  number,
  title: `第${number}章`,
  synopsis: `第${number}章的具体剧情梗概。`,
  status: 'confirmed',
  wordBudget: 3000,
  change: `第${number}章发生了变化`,
  storyQuestion: `第${number}章的读者问题`,
  promise: `推进：第${number}章的承诺`,
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标', chapters: [1, 2, 3, 4, 5, 6].map(chapter) }],
})
const draftText = '主角走进码头，看见对面的人。他把信塞进口袋。'.repeat(30)
await service.writeTextFile(project, 'story/chapters/001/draft.md', draftText)

const consistencyIssue = { level: 'warn', number: 2, message: '第2章时间线与第1章矛盾', advice: '调整第2章时间' }
const structurePayload = [
  { type: '角色超载', number: 2, message: '第2章出现 9 个命名角色，超出本卷阵容', advice: '削减到 6 人以内' },
  { type: '桥段重复', number: 3, message: '第3章与第1章使用同一套码头冲突，无新信息', advice: '换场景或加新代价' },
  { type: '调性漂移', number: 0, message: '整体从都市悬疑漂向喜剧', advice: '回调整体调性' },
]
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let auditCalls = 0
let repairCalls = 0
let capturedRepairPrompt = ''
let auditPayload = null
const capturedAuditMaxTokens = []
let repairPayload = null
let logicPayload = { logicIssues: [] }
let storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '' }
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.audit') {
    auditCalls += 1
    capturedAuditMaxTokens.push(options.maxTokens ?? null)
    const next = Array.isArray(auditPayload) ? auditPayload.shift() : auditPayload
    if (next instanceof Error) throw next
    return wrap(next ?? { issues: [] })
  }
  if (options.kind === 'outline.repair') {
    repairCalls += 1
    capturedRepairPrompt = `${options.system ?? ''}\n${options.messages?.[0]?.content?.[0]?.text ?? ''}`
    return wrap(repairPayload ?? { chapters: [] })
  }
  if (options.kind === 'chapter.logic-audit') return wrap(logicPayload)
  if (options.kind === 'chapter.review') return wrap({ score: 85, styleIssues: [], continuityIssues: [], aiFlavor: { level: '轻', score: 85 } })
  if (options.kind === 'chapter.story-audit') return wrap(storyPayload)
  return wrap({})
}

// ---------- 1) auditOutline：issues 与 structureIssues 分离 ----------
auditPayload = { issues: [consistencyIssue], structureIssues: structurePayload }
const audit = await service.auditOutline(project, { fromChapter: 1, toChapter: 6 })
assert.equal(audit.issues.filter((issue) => issue.message === consistencyIssue.message).length, 1, '一致性问题应在 issues')
assert.equal(audit.structureIssues.length, 3, '结构问题应在 structureIssues')
assert.ok(audit.structureIssues.every((issue) => issue.type && issue.message))
assert.equal(audit.issues.some((issue) => String(issue.message).includes('角色超载')), false, '结构问题不应混入 issues')
const auditFile = await service.readJson(project, 'story/plot/outline-audit.json')
assert.equal(auditFile.structureIssues.length, 3, 'structureIssues 应写盘')
assert.ok(Array.isArray(auditFile.issues))

// ---------- 2) repair 只修 issues；replan 聚合；prompt 不含结构问题 ----------
auditPayload = { issues: [] }
repairPayload = { chapters: [{ number: 2, synopsis: '第2章修复后的梗概。' }] }
auditCalls = 0
repairCalls = 0
const repaired = await service.repairOutlineIssues(project, { issues: [consistencyIssue] })
assert.equal(repairCalls, 1, '应调用一次修复模型')
assert.deepEqual(repaired.repaired, [2])
assert.ok(capturedRepairPrompt.includes(consistencyIssue.message), '修复 prompt 应含一致性问题')
for (const word of ['角色超载', '桥段重复', '调性漂移', '超出本卷阵容']) {
  assert.equal(capturedRepairPrompt.includes(word), false, `修复 prompt 不应含结构问题：${word}`)
}
assert.ok(Array.isArray(repaired.replan) && repaired.replan.length >= 1, '应返回 replan')
assert.ok(repaired.replan.some((item) => item.from === 2 && item.to === 3), '相邻章结构问题应合并为 2–3')
assert.ok(repaired.replan.some((item) => item.from == null && item.to == null), '全局结构问题 from/to 应为 null')

// ---------- 3) 只有结构问题 → structure-only，不调修复模型 ----------
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [], structureIssues: structurePayload })
repairCalls = 0
const structureOnly = await service.repairOutlineIssues(project, { issues: [] })
assert.equal(structureOnly.reason, 'structure-only')
assert.deepEqual(structureOnly.repaired, [])
assert.equal(repairCalls, 0, 'structure-only 不应调用修复模型')
assert.ok(structureOnly.replan.length >= 1)
assert.ok(structureOnly.replan.some((item) => item.type.includes('角色超载') || item.type.includes('桥段重复')))

// ---------- 4) diagnoseChapter suggestedAction ----------
logicPayload = { logicIssues: [{ type: '因果', severity: 'high', quote: '主角走进码头', advice: '补因果' }] }
const diagHard = await service.diagnoseChapter(project, { number: 1, scope: 'logic' })
assert.equal(diagHard.suggestedAction, 'repair', 'hard 一致性问题 → repair')
logicPayload = { logicIssues: [] }
storyPayload = { changeHappened: false, questionProgress: 'stalled', promiseProgress: 'partial', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '' }
const diagStory = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.ok(['revise', 'ignore'].includes(diagStory.suggestedAction), `story soft 应为 revise/ignore，实际 ${diagStory.suggestedAction}`)
storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '' }
const diagClean = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.equal(diagClean.suggestedAction, null)

// ---------- 5) agent 工具：novel_outline repair 返回 replan；novel_diagnose 返回 suggestedAction ----------
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.ok(indexSource.includes("case 'outline-repair'"), 'outline-repair action 存在')
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const outlineTool = registered.find((item) => item.name === 'novel_outline')
assert.ok(outlineTool, '应注册 novel_outline')
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [consistencyIssue], structureIssues: structurePayload })
repairPayload = { chapters: [{ number: 2, synopsis: '第2章修复版。' }] }
auditPayload = { issues: [] }
const toolRepair = await outlineTool.execute({ action: 'repair' }, { agent: project, signal: null })
assert.ok(Array.isArray(toolRepair.replan), 'novel_outline repair 应返回 replan')
assert.ok(toolRepair.replan.length >= 1)
const diagTool = registered.find((item) => item.name === 'novel_diagnose')
assert.ok(diagTool, '应注册 novel_diagnose')
logicPayload = { logicIssues: [{ type: '因果', severity: 'high', quote: '主角走进码头', advice: '补因果' }] }
const toolDiag = await diagTool.execute({ number: 1 }, { agent: project, signal: null })
assert.equal(toolDiag.suggestedAction, 'repair', 'novel_diagnose 应返回 suggestedAction')

// ---------- 6) client 静态断言 ----------
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(clientSource.includes('待处理（') && clientSource.includes('结构问题不会自动处理'), 'client 应展示结构问题（待处理）')
assert.ok(clientSource.includes('建议重规划'), 'client 应展示 replan 范围提示')


// ---------- 7) 大纲审核分块 + max-tokens 降级 + 复检复用分块 ----------
const bigChapter = (number) => ({
  id: `ch-${String(number).padStart(3, '0')}`,
  number,
  title: `第${number}章`,
  synopsis: `第${number}章的具体剧情梗概。`,
  status: 'confirmed',
  wordBudget: 3000,
  change: `第${number}章发生变化`,
  storyQuestion: `第${number}章的读者问题`,
  promise: `推进：第${number}章的承诺`,
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标', chapters: Array.from({ length: 24 }, (_, index) => bigChapter(index + 1)) }],
})

// 7a) 24 章分 2 块：调用 2 次并合并（结构问题补 number）
auditCalls = 0
capturedAuditMaxTokens.length = 0
auditPayload = [
  { issues: [{ level: 'warn', number: 1, message: '第1章时间线冲突', advice: '改1' }], structureIssues: [{ type: '角色超载', number: 1, message: '第1章角色过多', advice: '减角色' }] },
  { issues: [{ level: 'warn', number: 13, message: '第13章位置冲突', advice: '改13' }], structureIssues: [{ type: '桥段重复', number: 13, message: '第13章桥段重复', advice: '换桥段' }] },
]
const chunked = await service.auditOutline(project, { fromChapter: 1, toChapter: 24 })
assert.equal(auditCalls, 2, `24 章应分 2 块审核，实际 ${auditCalls} 次`)
assert.equal(chunked.issues.filter((issue) => issue.message.includes('冲突')).length, 2, '两块 issues 应合并')
assert.equal(chunked.structureIssues.length, 2, '两块 structureIssues 应合并')
assert.ok(chunked.structureIssues.some((issue) => issue.number === 13 && issue.type === "桥段重复"))
assert.equal(chunked.fromChapter, 1)
assert.equal(chunked.toChapter, 24)
assert.equal(chunked.chunkErrors, undefined)

// 7b) 单块失败、其他块成功 → chunkErrors 记录，不抛错
auditCalls = 0
auditPayload = [
  new Error('chunk boom'),
  { issues: [{ level: 'warn', number: 13, message: '第13章可修复冲突', advice: '改' }], structureIssues: [] },
]
const partial = await service.auditOutline(project, { fromChapter: 1, toChapter: 24 })
assert.equal(auditCalls, 2)
assert.equal(partial.chunkErrors.length, 1, '应记录失败块')
assert.equal(partial.chunkErrors[0].from, 1)
assert.equal(partial.chunkErrors[0].to, 12)
assert.ok(partial.issues.some((issue) => issue.message.includes('可修复')), '成功块 issues 应保留')

// 7c) 默认不限制 token：审核调用不带 maxTokens；显式配置 project.automation.maxTokens 才生效
auditCalls = 0
capturedAuditMaxTokens.length = 0
auditPayload = [{ issues: [], structureIssues: [] }, { issues: [], structureIssues: [] }]
await service.auditOutline(project, { fromChapter: 1, toChapter: 24 })
assert.equal(auditCalls, 2)
assert.ok(capturedAuditMaxTokens.every((value) => value == null), '默认不应传 maxTokens')

const defaultStream = service.ctx.llm.stream
const capturedStreamOptions = []
service.ctx.llm.stream = async function* (options) {
  capturedStreamOptions.push(options)
  yield { type: 'text-delta', text: 'ok' }
  yield { type: 'finish', reason: { kind: 'stop' } }
  yield { type: 'usage', usage: { outputTokens: 1 } }
}
await service.callModel(project, { system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
assert.equal('maxTokens' in capturedStreamOptions[0], false, '默认调用不应向 stream 传 maxTokens')
await service.writeJson(project, 'story/project.json', { schemaVersion: 1, title: '结构分流', automation: { maxTokens: 5000 } })
await service.callModel(project, { system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
assert.equal(capturedStreamOptions[1].maxTokens, 5000, '显式配置 automation.maxTokens 时应带上')
service.ctx.llm.stream = defaultStream

// 7d) repair 复检复用分块审核（大范围复检 → 2 块）
const issueA = { level: 'warn', number: 2, message: '第2章时间线矛盾', advice: '改2' }
const issueB = { level: 'warn', number: 20, message: '第20章位置矛盾', advice: '改20' }
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issueA, issueB], structureIssues: [{ type: '调性漂移', number: 0, message: '整体调性漂移', advice: '回调' }] })
auditCalls = 0
repairCalls = 0
auditPayload = [{ issues: [] }, { issues: [] }]
repairPayload = { chapters: [{ number: 2, synopsis: '第2章修复版' }, { number: 20, synopsis: '第20章修复版' }] }
const rechecked = await service.repairOutlineIssues(project, { issues: [issueA, issueB] })
assert.equal(repairCalls, 1)
assert.equal(auditCalls, 2, '复检应复用分块审核（2 块）')
assert.ok(capturedAuditMaxTokens.every((value) => value == null), '复检也不应传 maxTokens')
assert.equal(rechecked.rolledBack, false)
assert.deepEqual(rechecked.repaired, [2, 20])
assert.ok(Array.isArray(rechecked.replan) && rechecked.replan.length >= 1)

// ---------- 8) 黄金三章（大纲层）与章末钩子（章节故事审校） ----------
// 8a) 黄金三章不满足 → 3 条 structureIssues(type=黄金三章)，replan 聚合 1–3
auditPayload = {
  issues: [],
  structureIssues: [
    { type: '黄金三章', number: 1, message: '第1章章末停在无关动作，没有具体钩子', advice: '改成动作未完成/刚做决定/关键新信息' },
    { type: '黄金三章', number: 2, message: '第2章没有冲突或承诺升级，只是过场', advice: '升级冲突或承诺' },
    { type: '黄金三章', number: 3, message: '第3章只有送信的信息推进，没有小胜利', advice: '补一次小胜利或阶段兑现' },
  ],
}
const goldenAudit = await service.auditOutline(project, { fromChapter: 1, toChapter: 3 })
assert.equal(goldenAudit.structureIssues.length, 3, '黄金三章不满足应输出 3 条结构问题')
assert.ok(goldenAudit.structureIssues.every((issue) => issue.type === '黄金三章'))
assert.deepEqual(goldenAudit.structureIssues.map((issue) => issue.number), [1, 2, 3])
await service.writeJson(project, 'story/plot/outline-audit.json', goldenAudit)
const goldenOnly = await service.repairOutlineIssues(project, { issues: [] })
assert.equal(goldenOnly.reason, 'structure-only')
assert.ok(goldenOnly.replan.some((item) => item.from === 1 && item.to === 3), '黄金三章问题应聚合成 1–3 的范围')
assert.ok(goldenOnly.replan.every((item) => item.from !== 2 || item.to !== 2), '相邻章不应拆成单章范围')

// 8b) 满足黄金三章 → 0 条结构问题
auditPayload = { issues: [], structureIssues: [] }
const cleanAudit = await service.auditOutline(project, { fromChapter: 1, toChapter: 3 })
assert.equal(cleanAudit.structureIssues.length, 0, '达标后不应有结构问题')

// 8c) 第 1 章 endingHook 弱 → soft issue「章末钩子偏弱」
storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '', endingHook: { type: '无', strength: 0.1, newQuestion: '' } }
const hookDiag = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.ok(hookDiag.issues.some((issue) => issue.type === '章末钩子偏弱' && issue.level === 'soft'), '第1章钩子弱应生成 soft issue')
assert.equal(hookDiag.story.endingHook.type, '无')
assert.equal(hookDiag.suggestedAction, 'revise')

// 8d) 正常钩子不报问题；novel_diagnose 返回 story.endingHook
storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '', endingHook: { type: '决定', strength: 0.9, newQuestion: '' } }
const hookOk = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.equal(hookOk.issues.some((issue) => issue.type === '章末钩子偏弱'), false, '强钩子不应报问题')
const toolDiag2 = await diagTool.execute({ number: 1 }, { agent: project, signal: null })
assert.equal(toolDiag2.story?.endingHook?.type, '决定', 'novel_diagnose 应返回 story.endingHook')
assert.equal(toolDiag2.story?.endingHook?.strength, 0.9)
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('structure audit tests passed')
