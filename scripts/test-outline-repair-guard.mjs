// 大纲修复熔断：变差回滚、减少保留、复检失败回滚、同指纹 exhausted、>6 章截断、repair.log、生成内最多 1 轮。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-repair-guard-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-repair-guard-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
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

await service.initProject(project, { title: '修复熔断' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: 'a', length: { chapters: 30, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', {
  status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [],
})
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed', characters: [], locations: [], rules: [], factions: [], items: [],
})
const chapter = (number) => ({
  id: `ch-${String(number).padStart(3, '0')}`,
  number,
  title: `第${number}章`,
  synopsis: `第${number}章原有梗概，人物在码头等待，事件按顺序发生。`,
  status: 'candidate',
  wordBudget: 3000,
})
const outlineBase = () => ({
  status: 'candidate',
  logline: '一句话',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标', chapters: [1, 2, 3, 4, 5, 6, 7, 8].map(chapter) }],
})
const resetOutline = async () => {
  await service.writeJson(project, 'story/plot/outline.json', outlineBase())
  await service.writeJson(project, 'story/plot/outline-audit.json', {})
}
const issue = (number, message = '章纲因果断裂') => ({ level: 'warn', number, message, advice: '补一句因果' })

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let auditScript = []
let repairPayload = { chapters: [] }
let generatePayload = { chapters: [] }
let auditCalls = 0
let repairCalls = 0
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.audit') {
    auditCalls += 1
    const next = auditScript.length > 0 ? auditScript.shift() : { issues: [] }
    if (next instanceof Error) throw next
    return wrap(next)
  }
  if (options.kind === 'outline.repair') {
    repairCalls += 1
    return wrap(repairPayload)
  }
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') return wrap(generatePayload)
  return wrap({})
}
const readOutline = () => service.readJson(project, 'story/plot/outline.json')

// ---------- 1) 修复后变差 → 回滚 ----------
await resetOutline()
const beforeIssues = [issue(1), issue(2)]
auditScript = [
  { issues: [issue(1), issue(2), issue(3), issue(4)] },
]
repairPayload = { chapters: [{ number: 1, synopsis: '改后的梗概（可能引入新问题）' }] }
const regressed = await service.repairOutlineIssues(project, { issues: beforeIssues })
assert.equal(regressed.rolledBack, true, '变差应回滚')
assert.equal(regressed.reason, 'regressed')
assert.ok(Array.isArray(regressed.newIssues))
assert.deepEqual(regressed.repaired, [])
const outlineAfterRollback = await readOutline()
assert.equal(outlineAfterRollback.volumes[0].chapters[0].synopsis, chapter(1).synopsis, '回滚后章纲应恢复原样')

// ---------- 2) 修复后问题减少 → 保留 ----------
await resetOutline()
auditScript = [{ issues: [issue(2)] }]
repairPayload = { chapters: [{ number: 1, synopsis: '改后的梗概，因果补齐' }] }
const improved = await service.repairOutlineIssues(project, { issues: [issue(1), issue(2)] })
assert.equal(improved.rolledBack, false)
assert.deepEqual(improved.repaired, [1])
assert.ok(improved.issuesBefore >= improved.issuesAfter)
const outlineImproved = await readOutline()
assert.equal(outlineImproved.volumes[0].chapters[0].synopsis, '改后的梗概，因果补齐')

// ---------- 3) 复检失败 → 回滚（audit-unavailable） ----------
await resetOutline()
auditScript = [new Error('audit boom')]
repairPayload = { chapters: [{ number: 2, synopsis: '改后的第二章' }] }
const unavailable = await service.repairOutlineIssues(project, { issues: [issue(2)] })
assert.equal(unavailable.rolledBack, true)
assert.equal(unavailable.reason, 'audit-unavailable')
const outlineAfterUnavailable = await readOutline()
assert.equal(outlineAfterUnavailable.volumes[0].chapters[1].synopsis, chapter(2).synopsis)

// ---------- 4) 同指纹累计 ≥2 次 → exhausted（不写盘） ----------
await resetOutline()
const fingerprint = 'warn|1|章纲因果断裂'
await service.writeJson(project, 'story/plot/outline-audit.json', { repairAttempts: { [fingerprint]: { count: 2, lastAt: new Date().toISOString() } } })
repairPayload = { chapters: [{ number: 1, synopsis: '不应生效的修改' }] }
const exhaustedResult = await service.repairOutlineIssues(project, { issues: [issue(1)] })
assert.ok(exhaustedResult.exhausted.includes(fingerprint), '达上限的指纹应进 exhausted')
assert.deepEqual(exhaustedResult.repaired, [])
assert.equal(exhaustedResult.rolledBack, false)
const outlineExhausted = await readOutline()
assert.equal(outlineExhausted.volumes[0].chapters[0].synopsis, chapter(1).synopsis, 'exhausted 不应写盘')

// 连续两次尝试后（count=2），第三次返回 exhausted
await resetOutline()
repairPayload = { chapters: [] }
const firstTry = await service.repairOutlineIssues(project, { issues: [issue(1)] })
assert.equal(firstTry.reason, 'no-patches')
const secondTry = await service.repairOutlineIssues(project, { issues: [issue(1)] })
assert.equal(secondTry.reason, 'no-patches')
const thirdTry = await service.repairOutlineIssues(project, { issues: [issue(1)] })
assert.ok(thirdTry.exhausted.length > 0, '第 3 次应 exhausted')
assert.equal(thirdTry.reason, 'exhausted')
const auditFile = await service.readJson(project, 'story/plot/outline-audit.json')
assert.ok(auditFile.repairAttempts, 'repairAttempts 应持久化到 outline-audit.json')

// ---------- 5) 单次最多修 6 章 ----------
await resetOutline()
const manyIssues = Array.from({ length: 8 }, (_, index) => issue(index + 1, `问题${index + 1}`))
auditScript = [{ issues: [] }]
repairPayload = { chapters: Array.from({ length: 8 }, (_, index) => ({ number: index + 1, synopsis: `第${index + 1}章修复后梗概` })) }
const capped = await service.repairOutlineIssues(project, { issues: manyIssues })
assert.equal(capped.repaired.length, 6, '单次最多修 6 章')
assert.equal(capped.skippedChapters.length, 2)
assert.ok(capped.exhausted.some((item) => String(item).startsWith('chapter|7') || String(item).startsWith('chapter|8')), '超出上限的章应进 exhausted')

// ---------- 6) repair.log 追加一行 ----------
const logText = await readFile(join(project, '.dsh-writing', 'repair.log'), 'utf8')
const lastLine = logText.trim().split('\n').pop()
const logEntry = JSON.parse(lastLine)
assert.equal(logEntry.mode, 'outline.repair')
assert.equal(typeof logEntry.issuesBefore, 'number')
assert.equal(logEntry.rolledBack, false)

// ---------- 7) 生成内自动修复最多 1 轮 ----------
await resetOutline()
auditCalls = 0
repairCalls = 0
generatePayload = { chapters: [{ number: 9, title: '第9章', synopsis: '第9章梗概。', wordBudget: 3000 }] }
auditScript = [
  { issues: [issue(9, '第9章逻辑问题')] },
  { issues: [] },
]
repairPayload = { chapters: [{ number: 9, synopsis: '第9章修复后梗概' }] }
const generated = await service.outlineGenerate(project, { fromChapter: 9, count: 1 })
assert.equal(repairCalls, 1, '生成内只修复 1 轮')
assert.ok(auditCalls <= 2, `生成内审核次数应 ≤2（实际 ${auditCalls}）`)
assert.ok(generated.repair, '生成返回应带 repair 摘要')
assert.equal(generated.repair.rolledBack, false)
const outlineFinal = await readOutline()
assert.equal(outlineFinal.volumes[0].chapters.find((item) => Number(item.number) === 9).synopsis, '第9章修复后梗概')


// ---------- 8) 过期审核问题清理（指向已删除章节） ----------
// 8a) 混合过滤：保留存在章节的问题，标记 stale
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate',
  logline: 'x',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标', chapters: [chapter(1), chapter(2), chapter(3)] }],
})
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issue(2), issue(9)] })
const pruned = await service.pruneOutlineAudit(project)
assert.equal(pruned.staleCount, 1)
assert.deepEqual(pruned.staleNumbers, [9])
assert.equal(pruned.issues.length, 1)
assert.equal(Number(pruned.issues[0].number), 2)
const auditAfterPrune = await service.readJson(project, 'story/plot/outline-audit.json')
assert.equal(auditAfterPrune.issues.length, 1)
assert.equal(auditAfterPrune.staleCount, 1)

// 8b) 全部过期 → repair 返回 stale-audit（不调修复模型）
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issue(21), issue(24)] })
repairCalls = 0
const staleRepair = await service.repairOutlineIssues(project, { issues: [issue(21), issue(24)] })
assert.equal(staleRepair.reason, 'stale-audit')
assert.equal(staleRepair.staleCount, 2)
assert.equal(staleRepair.issuesBefore, 0)
assert.equal(staleRepair.issuesAfter, 0)
assert.deepEqual(staleRepair.repaired, [])
assert.equal(repairCalls, 0, '全过期时不应调用修复模型')
const auditCleared = await service.readJson(project, 'story/plot/outline-audit.json')
assert.deepEqual(auditCleared.issues, [])
assert.equal(auditCleared.staleCount, 2)

// 8c) 删除尾部章节后自动 prune（不调模型）
await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issue(2), issue(3), issue(24)] })
await service.deleteTailChapters(project, { count: 1, snapshot: false })
const outlineAfterDelete = await readOutline()
assert.equal(outlineAfterDelete.volumes[0].chapters.length, 2)
const auditAfterDelete = await service.readJson(project, 'story/plot/outline-audit.json')
assert.equal(auditAfterDelete.issues.some((item) => Number(item.number) === 3), false, '删除章节后旧问题应被清理')
assert.equal(auditAfterDelete.issues.some((item) => Number(item.number) === 24), false)
assert.ok(Number(auditAfterDelete.staleCount ?? 0) >= 1)
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('outline repair guard tests passed')
