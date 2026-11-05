// 大纲问题清理：稳定 id / dismissed 过滤（重审不复活）/ 截断 / dismiss 三种定位 / update 自动消解。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-dismiss-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-dismiss-project-'))
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

await service.initProject(project, { title: '问题清理' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: '角色1', length: { chapters: 10, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { pov: 'third-limited', chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '角色1', role: '主角', description: '主角' }],
  locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '城区', goal: '目标',
    chapters: [1, 2, 3].map((number) => ({
      id: `ch-${String(number).padStart(3, '0')}`,
      number,
      title: `第${number}章`,
      synopsis: `第${number}章的具体剧情。`,
      status: 'confirmed',
      wordBudget: 3000,
      change: `第${number}章变化`,
      storyQuestion: `第${number}章问题`,
      promise: `第${number}章承诺`,
    })),
  }],
})
const readAudit = () => service.readJson(project, 'story/plot/outline-audit.json')
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let auditPayload = null
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.audit') return wrap(auditPayload ?? { issues: [], structureIssues: [] })
  return wrap({})
}

// ---------- 1) 稳定 id + 去重 ----------
auditPayload = {
  issues: [
    { level: 'warn', number: 1, message: '第1章时间线冲突', advice: '改' },
    { level: 'warn', number: 1, message: '第1章时间线冲突', advice: '改' },
    { level: 'error', number: 2, message: '第2章位置冲突', advice: '改' },
  ],
  structureIssues: [{ type: '主角被动', number: 2, message: '第2章被动', advice: '改' }],
}
const audited = await service.auditOutline(project, { fromChapter: 1, toChapter: 3 })
assert.equal(audited.issues.length, 2, '相同问题应按 id 去重')
assert.ok(audited.issues.every((issue) => typeof issue.id === 'string' && issue.id.length > 10), '每条问题应有稳定 id')
assert.match(audited.issues[0].id, /^warn\|1\|/, 'id 前缀应含 level|number')
assert.ok(audited.structureIssues[0].id)
const auditFile1 = await readAudit()
assert.ok(auditFile1.issues.every((issue) => issue.id), '写盘文件问题应带 id')

// ---------- 2) 截断：单次 issues ≤30 / structure ≤10 + warning ----------
auditPayload = {
  issues: Array.from({ length: 35 }, (_, index) => ({ level: 'warn', number: (index % 3) + 1, message: `第${index + 1}条不同冲突`, advice: '改' })),
  structureIssues: Array.from({ length: 12 }, (_, index) => ({ type: '因果薄弱', number: (index % 3) + 1, message: `结构问题${index + 1}`, advice: '改' })),
}
const truncated = await service.auditOutline(project, { fromChapter: 1, toChapter: 3 })
assert.equal(truncated.issues.length, 30, 'issues 截断到 30')
assert.equal(truncated.structureIssues.length, 10, 'structureIssues 截断到 10')
assert.ok(truncated.warning && truncated.warning.includes('截断'), '截断应返回 warning')

// ---------- 3) dismiss 三种定位 + 再审计不复活 ----------
auditPayload = {
  issues: [{ level: 'warn', number: 1, message: '第1章问题' }, { level: 'warn', number: 2, message: '第2章问题' }],
  structureIssues: [{ type: '主角被动', number: 3, message: '第3章结构问题' }],
}
await service.auditOutline(project, { fromChapter: 1, toChapter: 3 })
const initialAudit = await readAudit()
const firstId = initialAudit.issues.find((issue) => Number(issue.number) === 1).id
const dismissedById = await service.dismissOutlineIssues(project, { ids: [firstId] })
assert.equal(dismissedById.removed, 1)
const afterIds = await readAudit()
assert.equal(afterIds.issues.some((issue) => Number(issue.number) === 1), false)
assert.ok(Array.isArray(afterIds.dismissed) && afterIds.dismissed.some((item) => item.id === firstId), '应记录 dismissed')
const dismissedByChapter = await service.dismissOutlineIssues(project, { chapter: 2 })
assert.equal(dismissedByChapter.removed, 1)
const afterChapter = await readAudit()
assert.equal(afterChapter.issues.some((issue) => Number(issue.number) === 2), false)
const dismissedAll = await service.dismissOutlineIssues(project, { all: true })
assert.equal(dismissedAll.removed, 1, 'all 应清理剩余结构问题')
const afterAll = await readAudit()
assert.equal(afterAll.issues.length, 0)
assert.equal(afterAll.structureIssues.length, 0)
assert.equal(dismissedAll.dismissedTotal >= 3, true)

// 重审返回同样问题 → 被 dismissed 过滤，不复活
auditPayload = {
  issues: [
    { level: 'warn', number: 1, message: '第1章问题' },
    { level: 'warn', number: 2, message: '第2章问题' },
    { level: 'warn', number: 3, message: '第3章新问题' },
  ],
  structureIssues: [{ type: '主角被动', number: 3, message: '第3章结构问题' }],
}
const reAudit = await service.auditOutline(project, { fromChapter: 1, toChapter: 3 })
assert.equal(reAudit.issues.some((issue) => Number(issue.number) === 1 || Number(issue.number) === 2), false, '已忽略的问题不应复活')
assert.equal(reAudit.structureIssues.some((issue) => issue.type === '主角被动'), false, '已忽略的结构问题不应复活')
assert.ok(reAudit.issues.some((issue) => Number(issue.number) === 3), '新问题仍会出现')

// ---------- 4) updateOutlineChapter 自动清理并返回 resolvedIssues ----------
await service.writeJson(project, 'story/plot/outline-audit.json', {
  issues: [
    { id: 'warn|1|issue|dddddddddddd', level: 'warn', number: 1, message: '第1章旧问题' },
    { id: 'warn|2|issue|eeeeeeeeeeee', level: 'warn', number: 2, message: '第2章旧问题' },
  ],
  structureIssues: [],
})
const updated = await service.updateOutlineChapter(project, { number: 1, fields: { synopsis: '第1章新梗概' } })
assert.equal(updated.resolvedIssues, 1, 'update 后应清理本章旧问题')
const afterUpdate = await readAudit()
assert.equal(afterUpdate.issues.some((issue) => Number(issue.number) === 1), false, '本章旧问题应被清理')
assert.ok(afterUpdate.issues.some((issue) => Number(issue.number) === 2), '其它章问题应保留')
assert.ok(afterUpdate.dismissed.some((item) => item.id === 'warn|1|issue|dddddddddddd'), '清理应记入 dismissed')

// ---------- 5) action / enum / 缺参 / client ----------
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.ok(indexSource.includes("case 'outline-dismiss'"), '应有 outline-dismiss action')
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const outlineTool = registered.find((tool) => tool.name === 'novel_outline')
assert.ok(outlineTool.parameters.properties.action.enum.includes('dismiss'), 'action enum 应含 dismiss')
const noTarget = await outlineTool.execute({ action: 'dismiss' }, { agent: project, signal: null })
assert.equal(noTarget.ok, false)
assert.ok(String(noTarget.error).includes('ids、chapter 或 all'), '缺定位应给可读错误')
const toolDismiss = await outlineTool.execute({ action: 'dismiss', all: true }, { agent: project, signal: null })
assert.ok(toolDismiss && Number.isFinite(Number(toolDismiss.removed)), 'dismiss all 应成功')
const issuesTool = registered.find((tool) => tool.name === 'novel_issues')
assert.ok(issuesTool, '应有 novel_issues')
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(clientSource.includes('outline-dismiss'), 'client 应能触发 outline-dismiss')
assert.ok(clientSource.includes("'忽略'"), 'client 应有忽略按钮')


// ---------- 6) 旧 audit 无 id：展示 id 与写回 id 一致，按该 id dismiss 生效 ----------
await service.writeJson(project, 'story/plot/outline-audit.json', {
  issues: [{ level: 'warn', number: 1, message: '第1章旧问题' }],
  structureIssues: [{ type: '主角被动', number: 2, message: '第2章被动' }],
})
const legacySummary = await service.issuesSummary(project)
const legacyIssue = legacySummary.items.find((item) => item.source === 'outline' && item.type === '一致性问题')
assert.ok(legacyIssue && legacyIssue.id, '展示 id 应存在')
assert.equal(legacyIssue.id.startsWith('outline:'), false, '展示 id 应为稳定持久化 id（不再用展示前缀）')
const legacyFile = await readAudit()
assert.equal(legacyFile.issues[0].id, legacyIssue.id, '展示 id 应与写回 audit id 一致')
const dismissedLegacy = await service.dismissOutlineIssues(project, { ids: [legacyIssue.id] })
assert.ok(dismissedLegacy.removed >= 1, '按展示 id dismiss 应生效（removed>0）')
assert.equal((await readAudit()).issues.length, 0, '问题应从文件移除')

// structure 问题 id 可 dismiss
const structureItem = (await service.issuesSummary(project)).items.find((item) => item.source === 'outline' && item.actions.some((action) => action.id === 'replan'))
assert.ok(structureItem, '仍应有结构问题项')
const dismissedStructure = await service.dismissOutlineIssues(project, { ids: [structureItem.id] })
assert.ok(dismissedStructure.removed >= 1, '结构问题 id 应可 dismiss')

// 旧展示 id（outline:issue:... 前缀）兼容
await service.writeJson(project, 'story/plot/outline-audit.json', {
  issues: [{ id: 'warn|3|issue|abcdabcdabcd', level: 'warn', number: 3, message: '第3章旧问题' }],
  structureIssues: [],
})
const legacyPrefixId = 'outline:issue:3:第3章旧问题'
const dismissedPrefix = await service.dismissOutlineIssues(project, { ids: [legacyPrefixId] })
assert.ok(dismissedPrefix.removed >= 1, '旧展示前缀 id 应兼容匹配')
const afterPrefix = await readAudit()
assert.equal(afterPrefix.issues.length, 0)
assert.ok(afterPrefix.dismissed.some((item) => item.id === 'warn|3|issue|abcdabcdabcd'), '前缀 dismiss 应记入持久化 id')
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('outline dismiss tests passed')
