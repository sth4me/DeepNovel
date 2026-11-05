// 章纲质量校验：选角泄漏不自动重生成（仅顶层 newNamed 例外重试）+ 主动性弧段/重复升级规则。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-quality-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-quality-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { OUTLINE_SYSTEM_PROMPT, OUTLINE_AUDIT_SYSTEM_PROMPT } = await import('../templates.js')

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

await service.initProject(project, { title: '章纲质量' })
await service.writeJson(project, 'story/project.json', { schemaVersion: 1, title: '章纲质量', automation: { autoRepairOutline: false, autoAudit: false, autoFix: false } })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: '角色1', length: { chapters: 30, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { pov: 'third-limited', chapterWords: 3000 }, samples: [] })
const poolNames = Array.from({ length: 8 }, (_, index) => `角色${index + 1}`)
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: poolNames.map((name, index) => ({ id: `characters-${index + 1}`, name, role: index === 0 ? '主角' : '配角', description: `${name}的描述` })),
  locations: [], rules: [], factions: [], items: [],
})
const writeOutline = () => service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate',
  logline: '一句话',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '城区', goal: '查清真相',
    cast: poolNames.slice(0, 6).map((name, index) => ({ name, roleInVolume: '本卷作用', fromChapter: 1, importance: index === 0 ? '主角' : '配角' })),
    extras: [{ name: '角色7', roleInVolume: '信息源', fromChapter: 1, note: '提供线索，不推动关键转折' }],
    chapters: [],
  }],
})
await writeOutline()
const readOutline = () => service.readJson(project, 'story/plot/outline.json')
const readAudit = () => service.readJson(project, 'story/plot/outline-audit.json')

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
const chapter = (number, extra = {}) => ({
  number,
  title: `第${number}章`,
  synopsis: `第${number}章：角色1主动前往镇上与角色2交涉，付出被跟踪的代价。`,
  change: `第${number}章局面变化`,
  storyQuestion: `第${number}章读者问题`,
  promise: `推进：第${number}章承诺`,
  castUsed: ['角色1', '角色2'],
  ...extra,
})
let generatePayload = null
let retryPayload = null
let generateCalls = 0
let retryCalls = 0
let capturedRetryPrompt = ''
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') {
    generateCalls += 1
    return wrap(generatePayload)
  }
  if (options.kind === 'outline.enforce.retry') {
    retryCalls += 1
    capturedRetryPrompt = options.messages?.[0]?.content?.[0]?.text ?? ''
    return wrap(retryPayload)
  }
  if (options.kind === 'outline.audit') return wrap({ issues: [], structureIssues: [] })
  return wrap({})
}
const run = async () => {
  generateCalls = 0
  retryCalls = 0
  capturedRetryPrompt = ''
  return service.outlineGenerate(project, { count: 3 })
}

// ---------- A1) 章级 castUsed 名单外：不自动重生成 + 结构问题 + 不阻塞写盘 ----------
await writeOutline()
generatePayload = { chapters: [chapter(1, { castUsed: ['角色1', '池外角色X'] }), chapter(2), chapter(3)], newNamed: [] }
let result = await run()
assert.equal(generateCalls, 1)
assert.equal(retryCalls, 0, '章级选角泄漏不应自动重生成章纲')
assert.ok(result.castViolations.some((item) => item.name === '池外角色X' && item.number === 1), '应记录 castViolations')
assert.ok(result.cast.warning && result.cast.warning.includes('选角泄漏'), '应返回 warning')
const audit1 = await readAudit()
assert.ok(audit1.structureIssues.some((issue) => issue.type === '未登记角色' && Number(issue.number) === 1), '应写入未登记角色结构问题（进 replan）')
const persisted = (await readOutline()).volumes[0].chapters
assert.equal(persisted.length, 3, '违规不阻塞写盘')
assert.deepEqual(persisted.find((item) => Number(item.number) === 1).castUsed, ['角色1', '池外角色X'], 'chapter.castUsed 应持久化')

// ---------- A2) 仅顶层 newNamed 且无其它违规：重试一次并修复 ----------
await writeOutline()
generatePayload = { chapters: [chapter(1), chapter(2), chapter(3)], newNamed: ['池外角色Y'] }
retryPayload = { chapters: [chapter(1), chapter(2), chapter(3)], newNamed: [] }
result = await run()
assert.equal(retryCalls, 1, '仅顶层 newNamed 时应重试一次')
assert.ok(capturedRetryPrompt.includes('池外角色Y'), '重试 prompt 应列出违规名字')
assert.ok(capturedRetryPrompt.includes('身份指代'), '重试 prompt 应要求身份指代')
assert.ok(capturedRetryPrompt.includes('角色1'), '重试 prompt 应重申名单')
assert.deepEqual(result.castViolations, [], '修复后不应有违规')
assert.equal(result.cast.warning, null)

// ---------- A3) 顶层 newNamed 重试后仍违规：停止并记结构问题 ----------
await writeOutline()
generatePayload = { chapters: [chapter(1), chapter(2), chapter(3)], newNamed: ['池外角色Y'] }
retryPayload = { chapters: [chapter(1), chapter(2), chapter(3)], newNamed: ['池外角色Y'] }
result = await run()
assert.equal(retryCalls, 1, '只重试一次')
assert.ok(result.castViolations.some((item) => item.name === '池外角色Y' && item.kind === 'topNewNamed'), '仍违规应返回顶层违规')
assert.ok(result.cast.warning)
const audit3 = await readAudit()
assert.ok(audit3.structureIssues.some((issue) => issue.type === '未登记角色' && (issue.number === null || Number(issue.number) === 0)), '应记录未登记角色结构问题')

// ---------- A4) 章级违规 + 顶层 newNamed 同时存在：不重试，全部记录 ----------
await writeOutline()
generatePayload = { chapters: [chapter(1, { castUsed: ['角色1', '池外角色X'] }), chapter(2), chapter(3)], newNamed: ['池外角色Y'] }
result = await run()
assert.equal(retryCalls, 0, '存在章级违规时不应触发顶层重试')
assert.ok(result.castViolations.some((item) => item.number === 1), '应记录章级违规')
assert.ok(result.castViolations.some((item) => item.kind === 'topNewNamed'), '应记录顶层违规')
const audit4 = await readAudit()
assert.ok(audit4.structureIssues.filter((issue) => issue.type === '未登记角色').length >= 2, '章级与顶层都应记结构问题')

// ---------- B/C) 提示词：主动性弧段 + 重复必须升级 ----------
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('每 2–4 章'), '大纲提示词应给主动性频率')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('主动选择'), '应要求主角主动选择')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('有明确代价'), '主动选择应有代价')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('连续 3 章以上'), '应定义连续被动阈值')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('连续两章同一手段'), '应定义重复升级阈值')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('新信息、新代价或新阻力'), '重复必须升级')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('不强制每章'), 'agency 应为可选字段')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('主角被动判定'), '审核应含主角被动判定')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('连续 3 章以上'), '审核应含连续被动阈值')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('桥段重复判定'), '审核应含桥段重复判定')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('连续两章'), '审核应含连续两章重复')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('范围'), '审核应要求给出范围')

// ---------- audit 范围结构问题 → replan ----------
const auditPayloads = []
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.audit') return wrap(auditPayloads.shift() ?? { issues: [], structureIssues: [] })
  return wrap({})
}
auditPayloads.push({
  issues: [],
  structureIssues: [
    { type: '主角被动', number: 2, message: '第2–3章连续被动，没有带代价的主动选择', advice: '补主动选择或重规划该区间' },
    { type: '桥段重复', number: 3, message: '第3章同一手段（夜探）且无升级', advice: '换手段或升级代价' },
  ],
})
const rangeAudit = await service.auditOutline(project, { fromChapter: 1, toChapter: 12 })
assert.equal(rangeAudit.structureIssues.length, 2)
assert.ok(rangeAudit.structureIssues.some((issue) => issue.type === '主角被动' && issue.number === 2 && issue.message.includes('第2–3章')))
assert.ok(rangeAudit.structureIssues.some((issue) => issue.type === '桥段重复' && issue.number === 3))
await service.writeJson(project, 'story/plot/outline-audit.json', rangeAudit)
const replan = await service.repairOutlineIssues(project, { issues: [] })
assert.equal(replan.reason, 'structure-only', '结构问题不应进入 repair')
assert.ok(replan.replan.some((item) => item.from === 2 && item.to === 3), 'replan 应包含被动/重复区间（2–3）')


service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('outline quality checks passed')
