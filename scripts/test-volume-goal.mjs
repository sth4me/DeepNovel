// 卷目标状态驱动：候选生成/校验/不写盘、select 选定与修订、新卷自动选警示、通用非叙事标记规则。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-volgoal-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-volgoal-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
const { OUTLINE_AUDIT_SYSTEM_PROMPT, OUTLINE_SYSTEM_PROMPT, buildVolumePlanUserPrompt, buildOutlineUserPrompt } = await import('../templates.js')

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

// ---------- 0) buildVolumePlanUserPrompt 状态注入 ----------
const planPrompt = buildVolumePlanUserPrompt({
  title: 't', language: 'zh', premise: { premise: 'p' },
  styleFields: {},
  volume: { id: 'vol-2', title: '第 2 卷' },
  previousVolume: { title: '第 1 卷', map: '落雁镇', goal: '送人到书院', lastChapter: { number: 2, title: '第2章' } },
  previousEndState: {
    states: [{ number: 2, characters: [{ name: '纪小棠', desire: '进书院', fear: '被卖', unresolved: ['欠债未还'] }] }],
    summary: '末章摘要：她决定连夜出发。',
    ending: '她推开门，雨声灌进屋里，远处有人在叫她的名字。',
    unresolved: ['欠债未还', '书院名额未定'],
  },
  roster: [{ name: '纪小棠', role: '主角', status: '活跃' }],
})
assert.ok(planPrompt.includes('上一卷结束时的人物状态与局势'), '应注入上一卷末状态')
assert.ok(planPrompt.includes('人物状态（末 3 章）'), '应含末 3 章状态')
assert.ok(planPrompt.includes('进书院'), '应含角色欲望')
assert.ok(planPrompt.includes('末章摘要'), '应含末章摘要')
assert.ok(planPrompt.includes('正文结尾'), '应含末章正文结尾')
assert.ok(planPrompt.includes('她推开门'), '应含结尾正文片段')
assert.ok(planPrompt.includes('欠债未还'), '应含未解冲突')
assert.ok(planPrompt.includes('角色池/本卷阵容'), '应含角色池/阵容')

// ---------- 1) 数据：vol-1 有末章正文/状态，vol-2 空目标 ----------
await service.initProject(project, { title: '卷目标' })
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
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [
    {
      id: 'vol-1', title: '第 1 卷', map: '落雁镇', goal: '送纪小棠到白鹿书院', exitCriteria: '到达书院', targetChapters: 4,
      chapters: [1, 2].map((number) => ({
        id: `ch-${String(number).padStart(3, '0')}`,
        number,
        title: `第${number}章`,
        synopsis: `第${number}章梗概`,
        status: 'confirmed',
        wordBudget: 3000,
        change: `第${number}章变化`,
        storyQuestion: `第${number}章问题`,
        promise: `第${number}章承诺`,
      })),
    },
    { id: 'vol-2', title: '第 2 卷', map: '', goal: '', exitCriteria: '', targetChapters: 6, chapters: [] },
  ],
})
await service.writeTextFile(project, 'story/chapters/002/final.md', '她推开门，雨声灌进屋里，远处有人在叫她的名字。'.repeat(20))
await service.writeJson(project, 'story/chapters/002/summary.json', { number: 2, summary: '末章摘要：她决定连夜出发。' })
await service.writeJson(project, 'story/state/002.json', {
  number: 2,
  scene: { location: '落雁镇', time: '深夜' },
  characters: [{ name: '纪小棠', situation: '刚到镇上', desire: '进书院', fear: '被卖', unresolved: ['欠债未还'] }],
  summary: '她决定连夜出发',
})
const readOutline = () => service.readJson(project, 'story/plot/outline.json')
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
const candidatesPayload = {
  candidates: [
    { title: '第 2 卷', map: '白鹿书院及周边', goal: '在书院名额被顶替前把学籍坐实', whyNow: '纪小棠欠债未还，债主已追到镇上', cost: '欠人情债', risk: '被发现冒名', exitCriteria: '学籍落定', targetChapters: 6 },
    { title: '第 2 卷', map: '白鹿书院', goal: '查清谁在替她报名并夺回名额', whyNow: '有人冒用她的名字报名', cost: '暴露身份', risk: '连累同乡', exitCriteria: '夺回名额并查清主使', targetChapters: 6 },
  ],
}
let planCalls = 0
let planPayload = candidatesPayload
let generatePayload = null
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.volume-plan') {
    planCalls += 1
    return wrap(planPayload)
  }
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') {
    return wrap(generatePayload ?? { chapters: [] })
  }
  if (options.kind === 'outline.audit') return wrap({ issues: [], structureIssues: [] })
  return wrap({})
}

// ---------- 2) planVolume：2–3 候选、不写盘、状态注入 ----------
const planned = await service.planVolume(project, { volumeId: 'vol-2' })
assert.equal(planned.candidates.length, 2)
assert.equal(planned.candidates[0].whyNow.includes('债主'), true)
assert.ok(planned.candidates.every((candidate) => candidate.goal && candidate.exitCriteria && candidate.whyNow))
assert.ok(planned.previousEndState.states.length >= 1, '应带上一卷末状态')
assert.ok(planned.previousEndState.ending.includes('她推开门'), '应带末章正文结尾')
assert.ok(planned.previousEndState.unresolved.includes('欠债未还'), '应带未解冲突')
const outlineAfterPlan = await readOutline()
assert.equal(outlineAfterPlan.volumes[1].goal, '', 'planVolume 默认不写盘')

// 校验失败：只有 1 个候选（非旧单对象格式）→ 抛错
planPayload = { candidates: [{ title: 'x', map: 'y', goal: 'g', whyNow: 'w', exitCriteria: 'e', targetChapters: 6 }] }
await assert.rejects(() => service.planVolume(project, { volumeId: 'vol-2' }), /2–3 个候选/)
// 兼容旧单对象输出
planPayload = { title: '第 2 卷', map: '白鹿书院', goal: '把学籍坐实', whyNow: '债主追来', cost: '人情', risk: '暴露', exitCriteria: '学籍落定', targetChapters: 6 }
const legacyPlan = await service.planVolume(project, { volumeId: 'vol-2' })
assert.equal(legacyPlan.candidates.length, 1, '旧单对象应包装成 1 个候选')
assert.equal(legacyPlan.candidates[0].goal, '把学籍坐实')

// ---------- 3) selectVolumePlan：按 index 写盘、overrides 修订 ----------
planPayload = candidatesPayload
const selected = await service.selectVolumePlan(project, { volumeId: 'vol-2', index: 1, candidates: candidatesPayload.candidates })
assert.equal(selected.volume.goal, '查清谁在替她报名并夺回名额')
assert.equal(selected.volume.whyNow.includes('冒用'), true)
assert.equal(selected.volume.targetChapters, 6)
assert.ok(selected.volume.goalRevisedAt, '应记录修订时间')
let outlineSelected = await readOutline()
assert.equal(outlineSelected.volumes[1].goal, '查清谁在替她报名并夺回名额', '选定后应写盘')
assert.equal(outlineSelected.volumes[1].exitCriteria, '夺回名额并查清主使')
const revised = await service.selectVolumePlan(project, { volumeId: 'vol-2', index: 1, candidates: candidatesPayload.candidates, overrides: { goal: '先夺回名额，再查主使', whyNow: '债主与冒名者同时逼近' } })
assert.equal(revised.volume.goal, '先夺回名额，再查主使')
outlineSelected = await readOutline()
assert.equal(outlineSelected.volumes[1].goal, '先夺回名额，再查主使', 'overrides 修订应写盘')
assert.ok(outlineSelected.volumes[1].goalRevisedAt)

// ---------- 4) outlineGenerate 新卷空目标：自动选候选1 + 明确 warning ----------
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [
    (await readOutline()).volumes[0],
    { id: 'vol-2', title: '第 2 卷', map: '', goal: '', exitCriteria: '', targetChapters: 6, chapters: [] },
  ],
})
planPayload = candidatesPayload
planCalls = 0
generatePayload = {
  chapters: [{
    number: 3,
    title: '第3章',
    synopsis: '第3章：纪小棠赶到书院门口，主动递交名帖。',
    change: '到达书院',
    storyQuestion: '名额还在吗',
    promise: '推进：入学',
    castUsed: ['纪小棠'],
    newNamed: [],
  }],
}
const generated = await service.outlineGenerate(project, { volumeId: 'vol-2', fromChapter: 3, count: 1 })
assert.equal(planCalls, 1, '新卷空目标应调用一次卷规划')
assert.equal(Array.isArray(generated.volumeGoalCandidates), true)
assert.equal(generated.volumeGoalCandidates.length, 2)
assert.equal(generated.volumeGoalAutoSelected, true, '应标记自动选')
assert.ok(generated.volumeGoalWarning && generated.volumeGoalWarning.includes('暂用候选 1'), '应有明确 warning（不静默）')
const outlineGenerated = await readOutline()
assert.equal(outlineGenerated.volumes[1].goal, candidatesPayload.candidates[0].goal, '自动选定候选1并写盘')

// ---------- 5) 通用非叙事标记规则（不点名 D1/D2） ----------
const outlinePrompt = buildOutlineUserPrompt({
  title: 't', language: 'zh', fromChapter: 3, toChapter: 3, totalChapters: 20, wordBudget: 3000,
  premise: {}, styleFields: {},
  volume: { title: '第 2 卷', map: '书院', goal: '夺回名额', exitCriteria: '学籍落定', targetChapters: 6 },
  progress: { volumeTitle: '第 2 卷', chapterNumber: 3, indexInVolume: 1, totalInVolume: 6, usedChapters: 0, remainingChapters: 5 },
})
assert.ok(outlinePrompt.includes('synopsis 必须是叙事句'), '应要求叙事句')
assert.ok(outlinePrompt.includes('场记式'), '应禁止场记式')
assert.ok(outlinePrompt.includes('编号式'), '应禁止编号式')
assert.ok(outlinePrompt.includes('方括号'), '应禁止方括号场景标签')
assert.equal(/D1\/D2/.test(outlinePrompt), false, 'prompt 不应点名 D1/D2')
assert.equal(/D1\/D2/.test(OUTLINE_SYSTEM_PROMPT), false, 'system prompt 不应点名 D1/D2')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('非叙事标记'), '审核应含非叙事标记')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('场记式开头'), '审核应含场记式开头')
assert.equal(/D1\/D2/.test(OUTLINE_AUDIT_SYSTEM_PROMPT), false, '审核不应点名具体日期代号')
for (const file of ['templates.js', 'service.js', 'agent.js']) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.equal(/D1\/D2/.test(source), false, `${file} 不应出现 D1/D2`)
}

// ---------- 6) 入口：index / agent ----------
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.ok(indexSource.includes("case 'volume-plan'"), '应有 volume-plan action')
assert.ok(indexSource.includes("case 'volume-select'"), '应有 volume-select action')
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const outlineTool = registered.find((tool) => tool.name === 'novel_outline')
const enumValues = outlineTool.parameters.properties.action.enum
assert.ok(enumValues.includes('volume-plan'), 'enum 应含 volume-plan')
assert.ok(enumValues.includes('volume-select'), 'enum 应含 volume-select')
assert.ok(outlineTool.description.includes('volume-plan'), '描述应含 volume-plan')
assert.ok(outlineTool.description.includes('volume-select'), '描述应含 volume-select')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('volume goal tests passed')
