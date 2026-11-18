// 角色纪律：禁止正文给路人取名、未登记角色审校为 hard 一致性问题并可修复。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-discipline-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-discipline-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { EXPAND_SYSTEM_PROMPT, CHAPTER_REVIEW_SYSTEM_PROMPT, STORY_AUDIT_SYSTEM_PROMPT, OUTLINE_SYSTEM_PROMPT, OUTLINE_AUDIT_SYSTEM_PROMPT, buildChapterUserPrompt } = await import('../templates.js')
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

const longDraft = '林昭在雨里走进镇子，找到货郎问路。货郎挑着担子，往东边指了指。'.repeat(30)
await service.initProject(project, { title: '角色纪律' })
await service.writeJson(project, 'story/project.json', { schemaVersion: 1, title: '角色纪律', automation: { autoAudit: false, autoFix: false } })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['古风'], protagonist: '林昭', length: { chapters: 10, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'ancient', fields: { pov: 'third-limited', chapterWords: 800 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '林昭', role: '主角', description: '主角' }, { id: 'c2', name: '郑货郎', role: '配角', description: '货郎' }],
  locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标',
    cast: [{ name: '林昭', roleInVolume: '主角', fromChapter: 1, importance: '主角' }, { name: '郑货郎', roleInVolume: '配角', fromChapter: 1, importance: '配角' }],
    chapters: [{ id: 'ch-001', number: 1, title: '第1章', synopsis: '林昭在镇口向货郎问路。', status: 'confirmed', wordBudget: 800, change: '拿到路线', storyQuestion: '货郎是否可信', promise: '推进：找路' }],
  }],
})

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
service.callModel = async (agent, options) => {
  if (options.task === 'draft') return { text: longDraft, usage: null, model: null, durationMs: 0 }
  return { text: longDraft, usage: null, model: null, durationMs: 0 }
}
let reviewPayload = {}
let storyPayload = {}
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'chapter.logic-audit') return wrap({ logicIssues: [] })
  if (options.kind === 'chapter.review') return wrap(reviewPayload)
  if (options.kind === 'chapter.story-audit') return wrap(storyPayload)
  return wrap({})
}

// ---------- 1) 生成提示词：角色纪律 ----------
const cast = [{ name: '林昭', roleInVolume: '主角' }, { name: '郑货郎', roleInVolume: '配角' }]
const prompt = buildChapterUserPrompt({
  title: 't', language: 'zh-CN', number: 1, wordBudget: 800,
  chapter: { number: 1, title: '开端', synopsis: 'x' },
  styleFields: {}, cast,
})
assert.ok(prompt.includes('【角色使用规则】'), 'draft prompt 应含角色使用规则')
assert.ok(prompt.includes('纯功能路人'), '应区分纯功能路人')
assert.ok(prompt.includes('身份/特征指代'), '应要求用身份指代')
assert.ok(prompt.includes('登记进角色池'), '应要求复用名字先登记')
assert.ok(prompt.includes('不要造名后消失'), '一次性名字不要留在正文')
const promptNoCast = buildChapterUserPrompt({
  title: 't', language: 'zh-CN', number: 2, wordBudget: 800,
  chapter: { number: 2, title: '章', synopsis: 'x' }, styleFields: {},
})
assert.ok(promptNoCast.includes('【角色使用规则】'), '无阵容的章节也应有角色使用规则')
// 三层角色：阵容 + 具名龙套
const promptWithExtras = buildChapterUserPrompt({
  title: 't', language: 'zh-CN', number: 1, wordBudget: 800,
  chapter: { number: 1, title: '开端', synopsis: 'x' },
  styleFields: {},
  cast: [...cast, { name: '王掌柜', roleInVolume: '信息源', note: '提供线索，不推动关键转折', kind: 'extra' }],
})
assert.ok(promptWithExtras.includes('【本卷具名配角'), '有配角时 prompt 应列出')
assert.ok(promptWithExtras.includes('王掌柜'), 'prompt 应含配角名字')
assert.ok(promptWithExtras.includes('可以推动局部转折') || promptWithExtras.includes('不限制其推动局部转折'), '具名配角可推动局部转折')
assert.ok(prompt.includes('【角色池已登记') === false, '未传角色池时不伪造角色池块')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('角色池里的已登记角色都可以具名出场'), '大纲提示词应允许角色池角色出场')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('不是出场白名单'), '大纲提示词应说明焦点名单不是白名单')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('角色超载=焦点名单>12 人或具名配角>8 人'), '审核应区分软超载')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('关键转折缺铺垫'), '审核应识别关键转折缺铺垫')
assert.ok(CHAPTER_REVIEW_SYSTEM_PROMPT.includes('角色池'), '统一审校未登记判定应按角色池')
assert.ok(STORY_AUDIT_SYSTEM_PROMPT.includes('角色池'), '故事审校未登记判定应按角色池')
assert.ok(EXPAND_SYSTEM_PROMPT.includes('路人'), '扩写提示词应含路人规则')
assert.ok(EXPAND_SYSTEM_PROMPT.includes('不给姓名'), '扩写提示词应禁止给路人取名')
assert.ok(EXPAND_SYSTEM_PROMPT.includes('先登记'), '扩写提示词应要求先登记')

// ---------- 2) 审校提示词：未登记角色判定 ----------
assert.ok(CHAPTER_REVIEW_SYSTEM_PROMPT.includes('未登记角色'), '统一审校应判定未登记角色')
assert.ok(CHAPTER_REVIEW_SYSTEM_PROMPT.includes('改身份'), '统一审校应给出改身份处理')
assert.ok(STORY_AUDIT_SYSTEM_PROMPT.includes('未登记角色'), '故事审校应判定未登记角色')
assert.ok(STORY_AUDIT_SYSTEM_PROMPT.includes('改身份'), '故事审校应给出改身份处理')

// 先生成正文（诊断需要正文）
const draft = await service.draftChapter(project, { number: 1 })
assert.ok(draft.runId, 'draft 应成功')

// ---------- 3) diagnoseChapter：未登记角色 → soft + 三选一 advice，不强制 repair ----------
reviewPayload = {
  score: 80,
  styleIssues: [],
  continuityIssues: [{ level: 'warn', type: '未登记角色', message: '正文出现「胡屠户」，不在角色池内', advice: '改掉' }],
}
storyPayload = {
  changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '',
  causalChain: 'ok', contrived: 'none', summary: '',
  issues: [{ type: '未登记角色', quote: '胡屠户', advice: '改' }],
  endingHook: { type: '信息', strength: 0.8, newQuestion: '' },
}
const diagnosis = await service.diagnoseChapter(project, { number: 1 })
const unregistered = diagnosis.issues.filter((issue) => issue.type === '未登记角色')
assert.ok(unregistered.length >= 1, '应识别未登记角色问题')
assert.ok(unregistered.every((issue) => issue.level === 'soft'), '未登记角色应为 soft 提示')
assert.ok(unregistered.every((issue) => issue.source === 'continuity'), '未登记角色应归为 continuity')
assert.ok(unregistered.every((issue) => issue.advice.includes('登记') && issue.advice.includes('身份')), 'advice 应给登记/改身份/临时名三种处理')
assert.notEqual(diagnosis.suggestedAction, 'repair', '未登记名字不应强制 repair')

// ---------- 4) draftChapter 不阻塞（角色纪律问题只影响诊断，不阻断生成） ----------
const draftAgain = await service.draftChapter(project, { number: 1 })
assert.ok(draftAgain.runId, 'draft 应成功')
assert.ok(draftAgain.wordCount > 0)
const draftText = await service.readText(project, 'story/chapters/001/draft.md')
assert.ok(draftText.length > 0)

// ---------- 5) novel_diagnose 返回保留该类问题 ----------
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const diagTool = registered.find((item) => item.name === 'novel_diagnose')
assert.ok(diagTool, '应注册 novel_diagnose')
const toolDiag = await diagTool.execute({ number: 1 }, { agent: project, signal: null })
assert.ok(toolDiag.issues.some((issue) => issue.type === '未登记角色' && issue.level === 'soft'), 'novel_diagnose 应保留未登记名字的软提示')
assert.ok(toolDiag.issues.some((issue) => String(issue.advice).includes('登记')))


// ---------- 6) OUTLINE_AUDIT：焦点名单超载与关键转折缺铺垫 ----------
let auditPayload = null
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.audit') return wrap(auditPayload ?? { issues: [], structureIssues: [] })
  if (options.kind === 'chapter.logic-audit') return wrap({ logicIssues: [] })
  if (options.kind === 'chapter.review') return wrap(reviewPayload)
  if (options.kind === 'chapter.story-audit') return wrap(storyPayload)
  return wrap({})
}
auditPayload = {
  issues: [],
  structureIssues: [
    { type: '角色超载', number: 1, message: '焦点名单 13 人、具名配角 9 人，超过硬上限（12+8）且没有场景拆分', advice: '拆场景或减少焦点角色' },
    { type: '关键转折缺铺垫', number: 1, message: '关键转折由一次性新人物凭空解决，前面没有铺垫', advice: '补铺垫或改由已有角色承担' },
  ],
}
const auditResult = await service.auditOutline(project, { fromChapter: 1, toChapter: 1 })
assert.equal(auditResult.structureIssues.length, 2, '应保留 2 条结构问题')
assert.ok(auditResult.structureIssues.some((issue) => issue.type === '角色超载'), '应识别角色超载')
assert.ok(auditResult.structureIssues.some((issue) => issue.type === '关键转折缺铺垫'), '应识别关键转折缺铺垫')
await service.writeJson(project, 'story/plot/outline-audit.json', auditResult)
const auditReplan = await service.repairOutlineIssues(project, { issues: [] })
assert.equal(auditReplan.reason, 'structure-only', '结构问题不应进入 repair')
assert.ok(auditReplan.replan.some((item) => item.from === 1), '应建议重规划第 1 章')
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('character discipline tests passed')
