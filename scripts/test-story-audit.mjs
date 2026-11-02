// Phase 3-D：章纲故事字段 + 故事审校（软、诊断式）+ scope + repair 不改故事。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-story-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-story-project-'))
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

await service.initProject(project, { title: '故事审校' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: 'a', length: { chapters: 10, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', {
  status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [],
})
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed', characters: [], locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate',
  logline: '一句话',
  volumes: [{ id: 'vol-1', title: '一', map: '地图', goal: '目标', chapters: [] }],
})

// ---------- 1) outlineGenerate 产物含故事字段（字段存在，可为空） ----------
let logicCalls = 0
let reviewCalls = 0
let storyCalls = 0
let storyPayload = {}
let outlinePayload = {
  chapters: [{
    number: 1,
    title: '第1章',
    synopsis: '林昭在破庙里等到了来送信的人，得知钥匙被换走。',
    change: '他失去了能开门的钥匙',
    storyQuestion: '谁换走了钥匙',
    promise: '推进：追查换锁的人',
    beats: [{ goal: '拿钥匙', obstacle: '门锁被换', turn: '发现被换锁', cost: '错过约定' }],
    wordBudget: 3000,
  }],
}
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
service.callJsonModel = async (agent, options) => {
  const kind = options.kind
  if (kind === 'outline.generate' || kind === 'outline.regenerate') return wrap(outlinePayload)
  if (kind === 'outline.audit') return wrap({ issues: [] })
  if (kind === 'chapter.logic-audit') { logicCalls += 1; return wrap({ logicIssues: [] }) }
  if (kind === 'chapter.review') {
    reviewCalls += 1
    return wrap({ score: 85, styleIssues: [], continuityIssues: [], aiFlavor: { level: '轻', score: 85 } })
  }
  if (kind === 'chapter.story-audit') { storyCalls += 1; return wrap(storyPayload) }
  return wrap({})
}
const generated = await service.outlineGenerate(project, { count: 1 })
const generatedChapter = generated.chapters?.[0]
assert.ok(generatedChapter, '应返回章节')
assert.equal(generatedChapter.change, '他失去了能开门的钥匙')
assert.equal(generatedChapter.storyQuestion, '谁换走了钥匙')
assert.equal(generatedChapter.promise, '推进：追查换锁的人')
assert.ok(Array.isArray(generatedChapter.beats) && generatedChapter.beats[0].goal === '拿钥匙')
assert.equal(typeof generatedChapter.change, 'string')

// ---------- 2) outline-update 写入/保留 ----------
const updated = await service.updateOutlineChapter(project, { number: 1, fields: { change: '丢掉钥匙' } })
assert.equal(updated.change, '丢掉钥匙')
assert.equal(updated.storyQuestion, '谁换走了钥匙', '未传字段应保留')
const updated2 = await service.updateOutlineChapter(project, { number: 1, fields: { storyQuestion: '谁想开门' } })
assert.equal(updated2.change, '丢掉钥匙')
assert.equal(updated2.storyQuestion, '谁想开门')

// 加入第 2 章（缺故事字段，供 outlineAudit 软提示）
const outline = await service.readJson(project, 'story/plot/outline.json')
outline.volumes[0].chapters.push({ id: 'ch-002', number: 2, title: '第2章', synopsis: '过场章', status: 'candidate', wordBudget: 3000 })
await service.writeJson(project, 'story/plot/outline.json', outline)

// 正文
const draftText = '林昭站在门口，钥匙不见了。他愣了一会，转身去问隔壁的人。'.repeat(10)
await service.writeTextFile(project, 'story/chapters/001/draft.md', draftText)
await service.writeJson(project, 'story/chapters/001/meta.json', {
  chapterId: 'ch-001', number: 1, title: '第1章', status: 'drafted', wordCount: draftText.length, updatedAt: new Date().toISOString(),
})

// ---------- 3) 故事审校判定：无变化/因果断裂/刻意感/安静章节 ----------
storyPayload = { changeHappened: false, changeQuote: '', questionProgress: 'stalled', promiseProgress: 'partial', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '缺少变化' }
const noChange = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.ok(noChange.issues.some((issue) => issue.type === '无变化' && issue.level === 'soft' && issue.source === 'story'))
assert.equal(noChange.story.changeHappened, false)

storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '门后是谁', causalChain: 'broken', contrived: 'none', issues: [], summary: '' }
const broken = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.ok(broken.issues.some((issue) => issue.type === '因果断裂'))
assert.equal(broken.story.newQuestion, '门后是谁')

storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'high', issues: [{ type: '降智', quote: '突然', advice: '补动机' }], summary: '' }
const contrived = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.ok(contrived.issues.some((issue) => issue.type === '为冲突而冲突'))
assert.ok(contrived.issues.some((issue) => issue.type === '故事·降智'))

storyPayload = { changeHappened: true, questionProgress: 'answered', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '成立' }
const quiet = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.equal(quiet.issues.filter((issue) => issue.source === 'story').length, 0, '安静章节 change 成立即通过')
assert.equal(quiet.story.changeHappened, true)
assert.equal(quiet.story.contrived, 'none')

// ---------- 4) scope：story / logic / all ----------
logicCalls = 0; reviewCalls = 0; storyCalls = 0
storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '' }
const storyOnly = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.equal(storyCalls, 1)
assert.equal(logicCalls, 0, 'scope=story 不跑逻辑')
assert.equal(reviewCalls, 0, 'scope=story 不跑统一审校')
assert.ok(storyOnly.issues.every((issue) => issue.level === 'soft'))
logicCalls = 0; reviewCalls = 0; storyCalls = 0
const logicScope = await service.diagnoseChapter(project, { number: 1, scope: 'logic' })
assert.equal(logicCalls, 1)
assert.equal(storyCalls, 0, 'scope=logic 不跑故事')
assert.equal(reviewCalls, 0)
logicCalls = 0; reviewCalls = 0; storyCalls = 0
const allScope = await service.diagnoseChapter(project, { number: 1 })
assert.equal(logicCalls, 1)
assert.equal(reviewCalls, 1)
assert.equal(storyCalls, 1)
assert.ok(allScope.issues.every((issue) => issue.source === 'story' ? issue.level === 'soft' : true))

// ---------- 5) repair：story 不自动改 / prescribe 标记 high ----------
storyPayload = { changeHappened: false, questionProgress: 'stalled', promiseProgress: 'partial', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '' }
const draftBefore = await readFile(join(project, 'story/chapters/001/draft.md'), 'utf8')
const auto = await service.repairChapter(project, { number: 1, mode: 'auto' })
assert.equal(auto.applied.length, 0, 'story 软问题不应自动修')
assert.equal(await readFile(join(project, 'story/chapters/001/draft.md'), 'utf8'), draftBefore, '正文不应变化')
assert.ok(auto.softHints.some((hint) => hint.type === '无变化' && hint.suggestion.includes('章纲')), 'softHints 应建议调章纲')
const prescribe = await service.repairChapter(project, { number: 1, mode: 'prescribe' })
const storyItem = prescribe.prescriptions.find((item) => item.type === '无变化')
assert.ok(storyItem, 'prescribe 应包含故事处方')
assert.equal(storyItem.autoFixable, false)
assert.equal(storyItem.risk, 'high')

// ---------- 6) outlineAudit 缺字段 → 软提示 ----------
const audit = await service.auditOutline(project, { fromChapter: 1, toChapter: 2 })
assert.ok(audit.issues.some((issue) => issue.number === 2 && issue.level === 'warn' && issue.message.includes('缺少')), '缺故事字段应给软提示')
assert.ok(audit.issues.every((issue) => issue.level !== 'error'), '故事提示不应阻断')

// ---------- 7) novel_diagnose 返回 story ----------
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const tool = registered.find((item) => item.name === 'novel_diagnose')
assert.ok(tool, '应注册 novel_diagnose')
storyPayload = { changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '新问题', causalChain: 'ok', contrived: 'none', issues: [], summary: '' }
const toolResult = await tool.execute({ number: 1 }, { agent: project, signal: null })
assert.ok(toolResult.story, 'novel_diagnose 应返回 story 字段')
assert.equal(toolResult.story.changeHappened, true)

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('story audit tests passed')
