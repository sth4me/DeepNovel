// 章纲提示词：本卷目标/本章位置最高优先级 + 主线推进规则（不新增 roadmap 数据/接口）+ 原有 synopsis/落点断言。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-prompt-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-prompt-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
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

// ---------- 0) 旧断言保留：synopsis/beats/落点 ----------
const legacyPrompt = buildOutlineUserPrompt({
  title: 't', language: 'zh', fromChapter: 3, toChapter: 4, totalChapters: 20, wordBudget: 3000,
  premise: {}, styleFields: {},
  previousAnchor: { number: 2, title: '二', synopsis: '他在码头等到天亮。', summary: '他确认船不会再回来。', ending: '他把灯吹灭了。' },
})
assert.ok(legacyPrompt.includes('【上一章落点（下一章必须承接）】'))
assert.ok(legacyPrompt.includes('他把灯吹灭了。'))
assert.ok(legacyPrompt.includes('承接落点但承接≠原地续写'), '落点规则应为承接≠原地续写')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('synopsis: string'))
assert.ok(!OUTLINE_SYSTEM_PROMPT.includes('goal:'))
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('beats'), '应支持可选 beats 脚手架')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('可选'), 'beats 应标注可选')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('允许安静章节'), '应允许安静章节')

// ---------- 1) 卷目标为空：明确提示未设置 ----------
const emptyPrompt = buildOutlineUserPrompt({
  title: 'x', language: 'zh', premise: { premise: 'p' }, styleFields: {},
  fromChapter: 2, toChapter: 2, totalChapters: 20, wordBudget: 3000,
  volume: { title: '第 1 卷', map: '镇子', goal: '', exitCriteria: '', targetChapters: 10 },
  progress: { volumeTitle: '第 1 卷', chapterNumber: 2, indexInVolume: 2, totalInVolume: 10, usedChapters: 1, remainingChapters: 8 },
})
assert.ok(emptyPrompt.includes('【本卷目标与本章位置（最高优先级）】'))
assert.ok(emptyPrompt.includes('未设置。必须先由用户/助手补本卷目标'), '卷目标为空应明确提示')

// 项目数据：卷目标「送纪小棠到白鹿书院」，已写 4 章、目标 10 章
await service.initProject(project, { title: '大纲推进' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: '送学生去书院的故事', genre: ['古风'], protagonist: '角色1', length: { chapters: 20, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'ancient', fields: { pov: 'third-limited', chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '角色1', role: '主角', description: '主角' }],
  locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{
    id: 'vol-1',
    title: '第 1 卷',
    map: '落雁镇 → 白鹿书院',
    goal: '把纪小棠送到白鹿书院',
    exitCriteria: '纪小棠进入白鹿书院',
    targetChapters: 10,
    chapters: [1, 2, 3, 4].map((number) => ({
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
  }],
})
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let generateChapters = []
const prompts = []
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') {
    prompts.push(options.messages?.[0]?.content?.[0]?.text ?? '')
    return wrap({ chapters: generateChapters })
  }
  if (options.kind === 'outline.audit') return wrap({ issues: [], structureIssues: [] })
  return wrap({})
}
const makeChapters = (numbers) => numbers.map((number) => ({
  number,
  title: `第${number}章`,
  synopsis: `第${number}章：主角主动推进，前往下一站。`,
  change: `第${number}章变化`,
  storyQuestion: `第${number}章问题`,
  promise: `第${number}章承诺`,
  castUsed: ['角色1'],
  newNamed: [],
}))

// ---------- 2) 单章：位置数字、优先级顺序、规则关键词 ----------
generateChapters = makeChapters([5])
const single = await service.outlineGenerate(project, { fromChapter: 5, count: 1 })
assert.ok(single)
assert.equal(prompts.length, 1)
const singlePrompt = prompts[0]
assert.ok(singlePrompt.includes('【本卷目标与本章位置（最高优先级）】'), '单章 prompt 应含最高优先级块')
assert.ok(singlePrompt.includes('把纪小棠送到白鹿书院'), '应含本卷目标')
assert.ok(singlePrompt.includes('本卷第 5/10 章'), `应含正确位置（第5/10章），实际：${singlePrompt.match(/本章位置[^\n]*/)?.[0] ?? ''}`)
assert.ok(singlePrompt.includes('本卷已写 4 章'), '应含已写章数')
assert.ok(singlePrompt.includes('距卷末约 5 章'), '应含剩余章数')
assert.ok(singlePrompt.includes('纪小棠进入白鹿书院'), '应含离卷条件')
assert.ok(singlePrompt.indexOf('【本卷目标与本章位置（最高优先级）】') < singlePrompt.indexOf('文风契约：'), '最高优先级块应在文风契约之前')
assert.ok(singlePrompt.includes('允许时间跳跃/转场'), '应允许转场')
assert.ok(singlePrompt.includes('连续超过 2 章'), '应含停滞规则')
assert.ok(singlePrompt.includes('不得用「遇见新人物/新事件/新麻烦」替代主线'), '应禁止用新人替代主线')
assert.ok(singlePrompt.includes('场记式') && singlePrompt.includes('叙事句'), '应改为通用非叙事标记规则')
assert.ok(singlePrompt.includes('时间/场景要融进叙事'), '应要求时间/场景融进叙事')
assert.ok(singlePrompt.includes('承接≠原地续写'), '上一章落点应说明承接≠原地续写')
assert.ok(singlePrompt.includes('2 章内解决或脱身'), '支线应在 2 章内脱身')

// ---------- 3) 批量：本批位置数字正确 ----------
generateChapters = makeChapters([5, 6, 7])
const batch = await service.outlineGenerate(project, { fromChapter: 5, count: 3 })
assert.ok(batch)
const batchPrompt = prompts[1]
assert.ok(batchPrompt.includes('本批章节位置'), '批量应列出本批位置')
for (const [number, index, remaining] of [[5, 5, 5], [6, 6, 4], [7, 7, 3]]) {
  assert.ok(batchPrompt.includes(`第 ${number} 章：本卷第 ${index}/10 章（距卷末约 ${remaining} 章）`), `应含第 ${number} 章位置`)
}

// ---------- 4) 系统/审核提示词规则 ----------
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('主线推进规则'), 'OUTLINE_SYSTEM_PROMPT 应含主线推进规则')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('synopsis 必须写成叙事句'), 'OUTLINE_SYSTEM_PROMPT 应要求叙事句')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('承接≠原地续写'), 'OUTLINE_SYSTEM_PROMPT 应含承接说明')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('主线停滞'), '审核应含主线停滞')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('支线挤占'), '审核应含支线挤占')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('非叙事标记'), '审核应含非叙事标记')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('场记式开头'), '审核应含场记式开头')

// ---------- 5) 不应再有 roadmap 方案残留 ----------
for (const file of ['templates.js', 'service.js', 'agent.js']) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.equal(/roadmap/i.test(source), false, `${file} 不应有 roadmap 残留`)
}

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('outline prompt tests passed')
