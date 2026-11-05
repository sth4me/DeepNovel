// 大纲修复版本：improved 自动应用、regressed/mixed 候选版本、apply/discard、20 版本上限、actions/enum、10157。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-repairs-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-repairs-project-'))
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

await service.initProject(project, { title: '修复版本' })
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
const issueA = { level: 'warn', number: 2, message: '第2章冲突', advice: '改' }
const issueB = { level: 'warn', number: 5, message: '第5章冲突（范围外）', advice: '改' }
const resetData = async () => {
  await writeOutline(baseChapters)
  await service.writeJson(project, 'story/plot/outline-audit.json', { issues: [issueA, issueB], structureIssues: [] })
}
const readOutline = () => service.readJson(project, 'story/plot/outline.json')
const readAudit = () => service.readJson(project, 'story/plot/outline-audit.json')
const chapterOf = async (number) => (await readOutline()).volumes[0].chapters.find((item) => Number(item.number) === number)
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let auditPayload = { issues: [], structureIssues: [] }
let repairPatch = { chapters: [{ number: 2, synopsis: '第2章修复后梗概' }] }
let auditCalls = 0
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.audit') {
    auditCalls += 1
    if (auditPayload instanceof Error) throw auditPayload
    return wrap(auditPayload)
  }
  if (options.kind === 'outline.repair') return wrap(repairPatch)
  return wrap({})
}

// ---------- 1) improved：自动应用 + 保留旧版本 + diff ----------
await resetData()
auditPayload = { issues: [], structureIssues: [] }
const improved = await service.repairOutlineIssues(project, { issues: [issueA] })
assert.equal(improved.applied, true)
assert.equal(improved.status, 'improved')
assert.equal(improved.rolledBack, false)
assert.ok(improved.versionId, '应返回 versionId')
assert.equal((await chapterOf(2)).synopsis, '第2章修复后梗概', 'improved 应自动应用')
const improvedAudit = await readAudit()
assert.equal(improvedAudit.issues.some((issue) => Number(issue.number) === 2), false, '范围内问题应被清除')
assert.ok(improvedAudit.issues.some((issue) => Number(issue.number) === 5), '范围外问题保留')
assert.equal(improvedAudit.lastRepair.applied, true)
assert.ok(Array.isArray(improved.diff) && improved.diff.some((item) => Number(item.number) === 2), 'diff 应含第2章')
const diffChapter = improved.diff.find((item) => Number(item.number) === 2)
assert.equal(diffChapter.fields.synopsis.before, '第2章原梗概')
assert.equal(diffChapter.fields.synopsis.after, '第2章修复后梗概')
const revisionFile = await service.readJson(project, `story/plot/revisions/${improved.versionId}.json`)
assert.equal(revisionFile.status, 'applied')
assert.equal(revisionFile.outlineAfter.volumes[0].chapters.find((item) => Number(item.number) === 2).synopsis, '第2章修复后梗概')

// ---------- 2) regressed：候选版本 + 当前大纲不被覆盖 + apply ----------
await resetData()
auditPayload = { issues: [issueA, { level: 'warn', number: 2, message: '第2章新问题', advice: '改' }], structureIssues: [] }
const regressed = await service.repairOutlineIssues(project, { issues: [issueA] })
assert.equal(regressed.applied, false)
assert.equal(regressed.status, 'regressed')
assert.ok(regressed.versionId)
assert.equal((await chapterOf(2)).synopsis, '第2章原梗概', 'regressed 不应覆盖当前大纲')
const regressedAudit = await readAudit()
assert.ok(regressedAudit.issues.some((issue) => issue.message === issueA.message), '当前 audit 应与当前大纲一致（保留原问题）')
assert.equal(JSON.stringify(regressedAudit.issues).includes('第2章新问题'), false, '当前 audit 不应残留候选新问题')
assert.ok(regressed.candidateAudit, '应返回候选 audit')
const applied = await service.applyOutlineRevision(project, { id: regressed.versionId })
assert.equal(applied.applied, true)
assert.equal((await chapterOf(2)).synopsis, '第2章修复后梗概', 'apply 后应写盘候选大纲')
const appliedAudit = await readAudit()
assert.deepEqual(appliedAudit.issues.map((issue) => issue.message).sort(), (regressed.candidateAudit?.issues ?? []).map((issue) => issue.message).sort(), 'apply 后 audit 应为候选 audit')
const appliedRevision = await service.readJson(project, `story/plot/revisions/${regressed.versionId}.json`)
assert.equal(appliedRevision.status, 'applied')

// ---------- 3) mixed：不应用 + discard 后不可 apply ----------
await resetData()
await service.writeJson(project, 'story/plot/outline-audit.json', {
  issues: [issueA, { level: 'warn', number: 2, message: '第2章冲突二', advice: '改' }, issueB],
  structureIssues: [],
})
auditPayload = { issues: [{ level: 'warn', number: 2, message: '第2章新问题', advice: '改' }], structureIssues: [] }
const mixed = await service.repairOutlineIssues(project, { issues: [issueA, { level: 'warn', number: 2, message: '第2章冲突二', advice: '改' }] })
assert.equal(mixed.applied, false)
assert.equal(mixed.status, 'mixed')
assert.ok(mixed.versionId)
assert.equal((await chapterOf(2)).synopsis, '第2章原梗概')
const discarded = await service.discardOutlineRevision(project, { id: mixed.versionId })
assert.equal(discarded.discarded, true)
await assert.rejects(() => service.applyOutlineRevision(project, { id: mixed.versionId }), /已丢弃|不能应用/)
const discardedRevision = await service.readJson(project, `story/plot/revisions/${mixed.versionId}.json`)
assert.equal(discardedRevision.status, 'discarded')

// ---------- 4) 20 版本上限 ----------
const saved = []
for (let index = 0; index < 22; index += 1) {
  saved.push(await service.saveOutlineRevision(project, { status: 'candidate', reason: 'test', summary: `test ${index}`, issuesBefore: 1, issuesAfter: 0 }))
}
const listed = await service.listOutlineRevisions(project)
assert.equal(listed.revisions.length, 20, '最多保留最近 20 个版本')
assert.equal(listed.revisions[0].id, saved[21].id, '最新在前')
assert.equal(listed.revisions[19].id, saved[2].id, '保留最近 20 个（第 0/1 个被淘汰）')
const droppedFile = await service.readJson(project, `story/plot/revisions/${saved[0].id}.json`).catch(() => null)
assert.equal(droppedFile, null, '被淘汰版本文件应删除')

// ---------- 5) actions / enum ----------
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
for (const action of ['outline-revisions', 'outline-revision-get', 'outline-revision-apply', 'outline-revision-discard']) {
  assert.ok(indexSource.includes(`case '${action}'`), `应有 ${action}`)
}
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const outlineTool = registered.find((tool) => tool.name === 'novel_outline')
const enumValues = outlineTool.parameters.properties.action.enum
for (const action of ['revisions', 'revision', 'apply-revision', 'discard-revision']) {
  assert.ok(enumValues.includes(action), `enum 应含 ${action}`)
}
assert.ok(outlineTool.parameters.properties.revisionId, '应有 revisionId 参数')
const listResult = await outlineTool.execute({ action: 'revisions' }, { agent: project, signal: null })
assert.ok(Array.isArray(listResult.revisions), 'revisions 应返回列表')
const noId = await outlineTool.execute({ action: 'revision' }, { agent: project, signal: null })
assert.equal(noId.ok, false)
assert.ok(String(noId.error).includes('revisionId'), '缺 revisionId 应给可读错误')

// ---------- 6) 10157 文案 ----------
const sections = []
apply({ tools: { register: () => {} }, systemPrompt: { section: (section) => sections.push(section) } })
const guard = sections.find((section) => section.name === 'deepnovel:outline-repair-guard')
assert.ok(guard.text().includes('applied：true'), '10157 应说明 applied 语义')
assert.ok(guard.text().includes('apply-revision'), '10157 应提示 apply-revision')
assert.ok(guard.text().includes('discard-revision'), '10157 应提示 discard-revision')
assert.ok(guard.text().includes('不要立刻重复 repair'), '10157 应禁止立刻重复 repair')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('outline repairs tests passed')
