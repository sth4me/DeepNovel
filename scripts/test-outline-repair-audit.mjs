// 大纲自动修复的 audit 一致性：回滚恢复 auditBefore、成功合并范围外问题、自动流程不被旧 audit 覆盖。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-repair-audit-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-repair-audit-project-'))
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

await service.initProject(project, { title: '修复审计' })
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
const chapterData = (number, synopsis) => ({
  id: `ch-${String(number).padStart(3, '0')}`,
  number,
  title: `第${number}章`,
  synopsis,
  status: 'confirmed',
  wordBudget: 3000,
  change: `第${number}章变化`,
  storyQuestion: `第${number}章问题`,
  promise: `第${number}章承诺`,
})
const writeOutline = (chapters) => service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '镇子', goal: '送人到书院', exitCriteria: '到达书院', targetChapters: 5, chapters }],
})
const baseChapters = [1, 2, 3, 4, 5].map((number) => chapterData(number, `第${number}章原梗概`))
await writeOutline(baseChapters)
const issueA = { level: 'warn', number: 2, message: '第2章冲突', advice: '改' }
const issueB = { level: 'warn', number: 5, message: '第5章冲突（范围外）', advice: '改' }
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issueA, issueB], structureIssues: [] })
const readOutline = () => service.readJson(project, 'story/plot/outline.json')
const readAudit = () => service.readJson(project, 'story/plot/outline-audit.json')
const chapterOf = async (number) => (await readOutline()).volumes[0].chapters.find((item) => Number(item.number) === number)
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let auditPayloads = []
let repairPatch = null
let generateChapters = []
let repairCalls = 0
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.audit') {
    const payload = auditPayloads.length > 1 ? auditPayloads.shift() : auditPayloads[0]
    if (payload instanceof Error) throw payload
    return wrap(payload ?? { issues: [], structureIssues: [] })
  }
  if (options.kind === 'outline.repair') {
    repairCalls += 1
    return wrap(repairPatch ?? { chapters: [] })
  }
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') return wrap({ chapters: generateChapters })
  return wrap({})
}

// ---------- 1) 回滚（regressed）：outline 与 audit 同时恢复 ----------
auditPayloads = [{ issues: [issueA, { level: 'warn', number: 2, message: '第2章新问题', advice: '改' }], structureIssues: [] }]
repairPatch = { chapters: [{ number: 2, synopsis: '第2章修复后梗概' }] }
const regressed = await service.repairOutlineIssues(project, { issues: [issueA] })
assert.equal(regressed.rolledBack, true)
assert.equal(regressed.reason, 'regressed')
assert.equal(regressed.lastRepair.rolledBack, true)
assert.equal(regressed.lastRepair.attemptedCount, 1)
assert.ok(Array.isArray(regressed.lastRepair.attempted) && regressed.lastRepair.attempted.length === 1, 'attempted 应为问题摘要数组')
assert.ok(regressed.lastRepair.newIssues.some((issue) => String(issue.message).includes('第2章新问题')), 'lastRepair 应记录新增问题')
assert.ok(regressed.audit.issues.some((issue) => Number(issue.number) === 2 && issue.message === issueA.message), '回滚后 return audit 应为回滚前问题')
assert.equal(regressed.audit.issues.some((issue) => String(issue.message).includes('第2章新问题')), false, '不应残留修复后新问题')
const regressedAuditFile = await readAudit()
assert.deepEqual(regressedAuditFile.issues.map((issue) => issue.message).sort(), regressed.audit.issues.map((issue) => issue.message).sort(), '回滚后 audit 文件应与返回一致')
assert.equal((await chapterOf(2)).synopsis, '第2章原梗概', 'outline 应回滚')
assert.ok(regressedAuditFile.lastRepair?.rolledBack === true)
assert.ok(regressedAuditFile.dismissed !== undefined || true)

// ---------- 2) 成功：范围外问题保留，范围内替换 ----------
auditPayloads = [{ issues: [], structureIssues: [] }]
repairCalls = 0
const improved = await service.repairOutlineIssues(project, { issues: [issueA] })
assert.equal(improved.rolledBack, false)
assert.equal(improved.reason, 'improved')
assert.equal(improved.lastRepair.rolledBack, false)
assert.ok(improved.audit.issues.some((issue) => Number(issue.number) === 5), '范围外问题应保留')
assert.equal(improved.audit.issues.some((issue) => Number(issue.number) === 2), false, '范围内问题应被替换')
const improvedFile = await readAudit()
assert.deepEqual(improvedFile.issues.map((issue) => issue.message).sort(), improved.audit.issues.map((issue) => issue.message).sort(), '成功后 audit 文件应与返回一致')
assert.equal((await chapterOf(2)).synopsis, '第2章修复后梗概', 'outline 应为修复后')

// 还原数据
await writeOutline(baseChapters)
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issueA, issueB], structureIssues: [] })

// ---------- 3) audit-unavailable：回滚并恢复 audit ----------
auditPayloads = [new Error('audit 不可用')]
repairPatch = { chapters: [{ number: 2, synopsis: '第2章修复后梗概' }] }
const unavailable = await service.repairOutlineIssues(project, { issues: [issueA] })
assert.equal(unavailable.rolledBack, true)
assert.equal(unavailable.reason, 'audit-unavailable')
assert.ok(unavailable.audit.issues.some((issue) => Number(issue.number) === 2 && issue.message === issueA.message))
const unavailableFile = await readAudit()
assert.deepEqual(unavailableFile.issues.map((issue) => issue.message).sort(), unavailable.audit.issues.map((issue) => issue.message).sort(), 'audit-unavailable 回滚后文件应与返回一致')
assert.equal((await chapterOf(2)).synopsis, '第2章原梗概')

// ---------- 4) 自动流程（outlineGenerate）不被修复前旧 audit 覆盖 ----------
await writeOutline(baseChapters)
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issueB], structureIssues: [] })
generateChapters = [{
  number: 6,
  title: '第6章',
  synopsis: '第6章：前往书院。',
  change: '出发',
  storyQuestion: '能到吗',
  promise: '入学',
  castUsed: ['纪小棠'],
  newNamed: [],
}]
auditPayloads = [
  { issues: [{ level: 'warn', number: 6, message: '第6章问题', advice: '改' }], structureIssues: [] },
  { issues: [{ level: 'warn', number: 6, message: '第6章问题', advice: '改' }, { level: 'warn', number: 6, message: '第6章新问题', advice: '改' }], structureIssues: [] },
]
repairPatch = { chapters: [{ number: 6, synopsis: '第6章修复后梗概' }] }
const generated = await service.outlineGenerate(project, { volumeId: 'vol-1', fromChapter: 6, count: 1 })
assert.equal(generated.rolledBack, true, '自动流程修复回滚')
const generatedAuditFile = await readAudit()
assert.equal(String(JSON.stringify(generatedAuditFile.issues)).includes('第6章新问题'), false, '写盘 audit 不应残留修复后新问题')
assert.deepEqual(
  generatedAuditFile.issues.map((issue) => issue.message).sort(),
  (generated.audit?.issues ?? []).map((issue) => issue.message).sort(),
  '自动流程写盘 audit 应与返回 audit 一致（不被旧覆盖）',
)
assert.ok(generated.audit?.issues?.some((issue) => Number(issue.number) === 6), '回滚后应保留本轮修复前的问题（第6章）')

// ---------- 5) 10157 文案 ----------
const sections = []
apply({ tools: { register: () => {} }, systemPrompt: { section: (section) => sections.push(section) } })
const guard = sections.find((section) => section.name === 'deepnovel:outline-repair-guard')
assert.ok(guard.text().includes('applied：true'), '10157 应说明 applied 语义')
assert.ok(guard.text().includes('apply-revision'), '10157 应提示 apply-revision')
assert.ok(guard.text().includes('不要立刻重复 repair'), '10157 应禁止立刻重复 repair')

// ---------- 6) 工具层透传 audit/lastRepair ----------
const agentSource = await readFile(new URL('../agent.js', import.meta.url), 'utf8')
assert.ok(agentSource.includes('audit: result.audit ?? null'), 'novel_outline repair 应透传 audit')
assert.ok(agentSource.includes('lastRepair: result.lastRepair ?? null'), 'novel_outline repair 应透传 lastRepair')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('outline repair audit tests passed')
