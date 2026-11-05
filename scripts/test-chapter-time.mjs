// 章纲时间锚点：prompt 注入时间线/锚点/硬事实、normalize 合法与非法、update time、audit 规则、工具字段。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-time-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-time-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
const { OUTLINE_AUDIT_SYSTEM_PROMPT, OUTLINE_SYSTEM_PROMPT, buildOutlineUserPrompt } = await import('../templates.js')

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

// ---------- 0) 提示词函数级：时间锚点块 ----------
const prompt = buildOutlineUserPrompt({
  title: 't', language: 'zh', fromChapter: 5, toChapter: 5, totalChapters: 20, wordBudget: 3000,
  premise: {}, styleFields: {},
  volume: { title: '第 1 卷', map: '镇子', goal: '送人到书院', exitCriteria: '到达书院', targetChapters: 10 },
  progress: { volumeTitle: '第 1 卷', chapterNumber: 5, indexInVolume: 5, totalInVolume: 10, usedChapters: 4, remainingChapters: 5 },
  timeline: [{ number: 3, title: '第3章', time: { day: 2, part: '晨', spanDays: 0, mode: 'linear' } }],
  previousTimeAnchor: { day: 2, part: '夜', spanDays: 0, mode: 'linear' },
  hardFacts: [{ kind: '硬事实', key: '欠款期限', value: '三日后付清欠款', day: 3 }],
})
assert.ok(prompt.includes('【时间锚点（必须遵守，time 只写 JSON，不写进 synopsis）】'), '应含时间锚点块')
assert.ok(prompt.includes('已有章节时间线（最近 8 章）'), '应注入已有章节时间线')
assert.ok(prompt.includes('第2天·晨'), '时间线应含 day/part')
assert.ok(prompt.includes('上一章锚点：第2天·夜'), '应注入上一章锚点')
assert.ok(prompt.includes('硬事实/期限'), '应注入硬事实')
assert.ok(prompt.includes('（第3天）'), '期限应换算为 day')
assert.ok(prompt.includes('新章 day 必须 ≥ 前一 linear 章的 day'), '应含线性递增规则')
assert.ok(prompt.includes('flashback/parallel 不参与线性顺序'), 'flashback/parallel 不参与线性顺序')
assert.ok(prompt.indexOf('【时间锚点') > prompt.indexOf('【本卷目标与本章位置（最高优先级）】'), '时间锚点在最高优先级块之后')
assert.ok(prompt.indexOf('【时间锚点') < prompt.indexOf('文风契约：'), '时间锚点在文风契约之前')

// ---------- 项目数据 ----------
await service.initProject(project, { title: '时间锚点' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: '送学生去书院', genre: ['古风'], protagonist: '纪小棠', length: { chapters: 20, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'ancient', fields: { pov: 'third-limited', chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '纪小棠', role: '主角', description: '主角', meta: { status: '活跃', firstChapter: 1, importance: '主角' } }],
  locations: [], rules: [], factions: [], items: [],
})
const chapterData = (number, time) => ({
  id: `ch-${String(number).padStart(3, '0')}`,
  number,
  title: `第${number}章`,
  synopsis: `第${number}章梗概：主角推进目标。`,
  status: 'confirmed',
  wordBudget: 3000,
  change: `第${number}章变化`,
  storyQuestion: `第${number}章问题`,
  promise: `第${number}章承诺`,
  ...(time ? { time } : {}),
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '镇子', goal: '送人到书院', exitCriteria: '到达书院', targetChapters: 10,
    cast: [{ name: '纪小棠', roleInVolume: '主角', fromChapter: 1, importance: '主角' }],
    chapters: [
      chapterData(1, null),
      chapterData(2, { day: 1, part: '夜', spanDays: 0, mode: 'linear' }),
      chapterData(3, { day: 2, part: '晨', spanDays: 0, mode: 'linear' }),
      chapterData(4, { day: 2, part: '夜', spanDays: 0, mode: 'linear' }),
    ],
  }],
})
await service.saveFact(project, { kind: '硬事实', key: '欠款期限', value: '三日后付清欠款' })
await service.saveFact(project, { kind: '安全', key: '宵禁', value: '入夜后不得出门' })
const readOutline = () => service.readJson(project, 'story/plot/outline.json')
const chapterAt = async (number) => (await readOutline()).volumes[0].chapters.find((item) => Number(item.number) === number)
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let generateChapters = []
const generatePrompts = []
const auditPrompts = []
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') {
    generatePrompts.push(options.messages?.[0]?.content?.[0]?.text ?? '')
    return wrap({ chapters: generateChapters })
  }
  if (options.kind === 'outline.audit') {
    auditPrompts.push(options.messages?.[0]?.content?.[0]?.text ?? '')
    return wrap({ issues: [], structureIssues: [] })
  }
  return wrap({})
}
const makeChapter = (number, time) => ({
  number,
  title: `第${number}章`,
  synopsis: `第${number}章：主角推进目标。`,
  change: `第${number}章变化`,
  storyQuestion: `第${number}章问题`,
  promise: `第${number}章承诺`,
  castUsed: ['纪小棠'],
  newNamed: [],
  ...(time ? { time } : {}),
})

// ---------- 1) outlineGenerate 注入时间线/锚点/硬事实 ----------
generateChapters = [makeChapter(5, { day: 3, part: '日', spanDays: 1, mode: 'linear' })]
const generated = await service.outlineGenerate(project, { fromChapter: 5, count: 1 })
assert.ok(generated)
const injected = generatePrompts[0]
assert.ok(injected.includes('【时间锚点（必须遵守，time 只写 JSON，不写进 synopsis）】'), '生成 prompt 应含时间锚点块')
assert.ok(injected.includes('已有章节时间线（最近 8 章）'), '应含已有章节时间线')
assert.ok(injected.includes('第2天·晨'), '应含第3章时间锚点')
assert.ok(injected.includes('上一章锚点：第2天·夜'), '应含上一章（第4章）锚点')
assert.ok(injected.includes('（第3天）'), '硬事实期限应换算为 day')
assert.ok(injected.includes('宵禁'), '应注入安全类硬事实')
assert.ok(injected.includes('新章 day 必须 ≥ 前一 linear 章的 day'), '应含线性规则')

// ---------- 2) 合法 time 写盘保留（不进 synopsis） ----------
const saved = await chapterAt(5)
assert.ok(saved.time, '合法 time 应保留')
assert.equal(saved.time.day, 3)
assert.equal(saved.time.part, '日')
assert.equal(saved.time.spanDays, 1)
assert.equal(saved.time.mode, 'linear')
assert.equal(String(saved.synopsis).includes('time'), false, 'synopsis 不应含 time 标记')

// ---------- 3) 非法 time 丢弃为 null ----------
generateChapters = [makeChapter(6, { day: -1, part: '夜' })]
await service.outlineGenerate(project, { fromChapter: 6, count: 1 })
const invalidSaved = await chapterAt(6)
assert.equal(Boolean(invalidSaved.time), false, '非法 time 应丢弃')

// ---------- 4) updateOutlineChapter 支持 fields.time ----------
const updated = await service.updateOutlineChapter(project, { number: 5, fields: { time: { day: 5, part: '暮', spanDays: 2, mode: 'flashback' } } })
assert.equal(updated.time.day, 5)
assert.equal(updated.time.mode, 'flashback')
const updatedSaved = await chapterAt(5)
assert.equal(updatedSaved.time.part, '暮')
await assert.rejects(() => service.updateOutlineChapter(project, { number: 5, fields: { time: { day: 'x', part: '夜' } } }), /time 不合法/)

// ---------- 5) OUTLINE_AUDIT：注入时间线 + 判定规则 ----------
const auditPromptsBefore = auditPrompts.length
await service.auditOutline(project, { fromChapter: 1, toChapter: 6 })
const auditPrompt = auditPrompts[auditPrompts.length - 1]
assert.ok(auditPrompts.length > auditPromptsBefore)
assert.ok(auditPrompt.includes('【时间线（章纲 time 锚点'), '审核 prompt 应注入时间线')
assert.ok(auditPrompt.includes('"day"'), '审核 prompt 应含 time JSON')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('相邻 linear 章 day 倒退'), '审核规则应含线性倒退')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('flashback/parallel 不参与线性顺序'), '审核规则应含 flashback 不参与')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('没有 time 的章不要报'), '无 time 不报')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('不要自动修'), '不自动修')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('时间锚点规则'), 'system prompt 应含时间锚点规则')

// ---------- 6) 工具字段与描述 ----------
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const outlineTool = registered.find((tool) => tool.name === 'novel_outline')
assert.ok(outlineTool.parameters.properties.fields.properties.time, 'update fields 应支持 time')
assert.ok(outlineTool.description.includes('时间线冲突'), '描述应说明时间线冲突处理')
assert.ok(outlineTool.parameters.properties.fields.properties.time.description.includes('不写进 synopsis'), 'time 字段应说明不写进 synopsis')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('chapter time tests passed')
