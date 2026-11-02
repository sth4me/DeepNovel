// Phase 2：诊断 → 定向修复 → 复检（自动档 + 处方档）+ 助手工具。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-repair-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-repair-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
const lockRules = await import('../lock-rules.js')

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

await service.initProject(project, { title: '修复链路' })
const iso = new Date().toISOString()
const chapter = (number) => ({ id: `c${number}`, number, title: `第${number}章`, synopsis: '梗概：林昭出场。', status: 'confirmed', wordBudget: 3000 })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'v1', title: '一', chapters: [chapter(1), chapter(2)] }],
})
const baseDraft = '他看见小林站在门口。破庙里没有人。他把包袱放下，走到桌边。' + '雨声很大，屋檐在滴水。他伸手去摸口袋里的半块玉佩。'.repeat(60)
await service.writeTextFile(project, 'story/chapters/001/draft.md', baseDraft)
await service.writeJson(project, 'story/chapters/001/meta.json', {
  chapterId: 'c1', number: 1, title: '第1章', status: 'drafted', wordCount: baseDraft.length, updatedAt: iso,
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', { status: 'confirmed', characters: [{ name: '林昭', description: '主角' }], locations: [], rules: [], factions: [], items: [] })
await service.saveFact(project, { kind: '术语', key: '林昭', value: '小林' })

// mock LLM
let logicMode = 'initial' // initial | empty | two
let repairPayload = null
const reviewPayload = {
  score: 62,
  aiFlavor: { level: '中', score: 62, markers: [] },
  styleIssues: [{ category: '套话', severity: 'medium', quote: '他看见', advice: '改具体动作' }],
  continuityIssues: [{ level: 'error', message: '玉佩在前文已碎', advice: '改为完整或换道具' }],
}
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'chapter.logic-audit') {
    if (logicMode === 'initial') return { parsed: { logicIssues: [{ type: '因果', severity: 'high', quote: '他看见', advice: '补因果' }] } }
    if (logicMode === 'two') return { parsed: { logicIssues: [
      { type: '因果', severity: 'high', quote: '他看见', advice: '补因果' },
      { type: '时间', severity: 'medium', quote: '雨声很大', advice: '补时间标记' },
    ] } }
    return { parsed: { logicIssues: [] } }
  }
  if (options.kind === 'chapter.review') return { parsed: reviewPayload }
  if (options.kind === 'chapter.repair') return { parsed: repairPayload ?? { patches: [] } }
  return { parsed: {} }
}

// ---------- 1) 诊断：分级 + id 稳定 ----------
const diag = await service.diagnoseChapter(project, { number: 1 })
assert.ok(diag.issues.length >= 4, `应合并多来源 issues，实际 ${diag.issues.length}`)
const hard = diag.issues.filter((issue) => issue.level === 'hard')
const soft = diag.issues.filter((issue) => issue.level === 'soft')
assert.ok(hard.some((issue) => issue.source === 'facts'), '事实违规应为硬问题')
assert.ok(hard.some((issue) => issue.source === 'logic'), '逻辑问题应为硬问题')
assert.ok(hard.some((issue) => issue.source === 'continuity'), '连续性 error 应为硬问题')
assert.ok(soft.some((issue) => issue.source === 'style'), '文风问题应为软问题')
assert.ok(soft.some((issue) => issue.source === 'aiFlavor'), 'AI 味应为软问题')
assert.ok(diag.issues.every((issue) => /^iss-[a-z0-9]+$/i.test(issue.id)), 'issue id 应稳定生成')
assert.equal(diag.stats.characters > 0, true)
const diagAgain = await service.diagnoseChapter(project, { number: 1 })
assert.deepEqual(diagAgain.issues.map((issue) => issue.id), diag.issues.map((issue) => issue.id), '同输入应生成相同 id')
assert.equal(typeof diag.scores.logic, 'number')
assert.equal(typeof diag.scores.style, 'number')

// ---------- 2) prescribe：只返回处方、文件不变 ----------
const beforePrescribe = await readFile(join(project, 'story/chapters/001/draft.md'), 'utf8')
const prescribe = await service.repairChapter(project, { number: 1, mode: 'prescribe' })
assert.equal(prescribe.mode, 'prescribe')
assert.ok(Array.isArray(prescribe.prescriptions) && prescribe.prescriptions.length >= 4)
assert.ok(prescribe.prescriptions.some((item) => item.autoFixable === true && item.level === 'hard'))
assert.ok(prescribe.prescriptions.some((item) => item.autoFixable === false && item.level === 'soft'))
assert.ok(Array.isArray(prescribe.softHints) && prescribe.softHints.length > 0)
assert.equal(await readFile(join(project, 'story/chapters/001/draft.md'), 'utf8'), beforePrescribe, 'prescribe 不应修改正文')

// ---------- 3) auto：应用可匹配 patch、跳过不可匹配、复检后保留 ----------
logicMode = 'empty'
repairPayload = {
  summary: '修 1 处',
  patches: [
    { from: '他看见小林站在门口。', to: '小林站在门口。', reason: '去掉告知式叙述' },
    { from: '不存在的片段', to: 'x', reason: '无效 patch' },
  ],
}
const auto = await service.repairChapter(project, { number: 1, mode: 'auto' })
assert.equal(auto.rolledBack, false)
assert.equal(auto.applied.length, 1, '只应用可匹配 patch')
assert.ok(auto.skipped.some((item) => item.reason.includes('找不到')), '不可匹配 patch 应进 skipped')
assert.ok(auto.rounds.length >= 1)
assert.ok(auto.rounds[0].issuesAfter < auto.rounds[0].issuesBefore, '复检后硬问题应减少')
const afterAuto = await readFile(join(project, 'story/chapters/001/draft.md'), 'utf8')
assert.ok(afterAuto.includes('小林站在门口。'), 'patch 应已应用')
assert.equal(afterAuto.includes('他看见小林站在门口。'), false)

// ---------- 4) 回滚：复检硬问题不降 → 恢复原样 ----------
reviewPayload.continuityIssues = []
await service.writeTextFile(project, 'story/chapters/001/draft.md', baseDraft)
logicMode = 'two'
repairPayload = { patches: [{ from: '他看见小林站在门口。', to: '小林站在门口。', reason: 'x' }] }
const rolled = await service.repairChapter(project, { number: 1, mode: 'auto' })
assert.equal(rolled.rolledBack, true, '硬问题不降应回滚')
assert.equal(await readFile(join(project, 'story/chapters/001/draft.md'), 'utf8'), baseDraft, '回滚后正文应恢复原样')
assert.ok(rolled.summary.includes('回滚'))

// ---------- 5) soft 不自动改（只有软问题时 auto 不动文件） ----------
const facts = (await service.listFacts(project)).facts
for (const fact of facts) await service.deleteFact(project, { id: fact.id })
logicMode = 'empty'
reviewPayload.continuityIssues = []
reviewPayload.styleIssues = [{ category: '套话', severity: 'medium', quote: '他看见', advice: '改具体动作' }]
const softOnly = await service.repairChapter(project, { number: 1, mode: 'auto' })
assert.equal(softOnly.applied.length, 0, '软问题不应自动修')
assert.equal(softOnly.rolledBack, false)
assert.ok(softOnly.softHints.length > 0, '软问题应返回 softHints')
assert.equal(await readFile(join(project, 'story/chapters/001/draft.md'), 'utf8'), baseDraft)

// ---------- 6) maxRounds 上限 + 无草稿报错 ----------
const maxRoundsResult = await service.repairChapter(project, { number: 1, mode: 'auto', maxRounds: 5 })
assert.ok(maxRoundsResult.rounds.length <= 2, 'maxRounds 上限应为 2')
await assert.rejects(() => service.diagnoseChapter(project, { number: 2 }), /还没有正文/)
await assert.rejects(() => service.repairChapter(project, { number: 2, mode: 'auto' }), /还没有正文/)

// ---------- 7) 锁资源 + 助手工具注册/调用 ----------
assert.equal(lockRules.runResource('chapter-repair', { number: 1 }), 'chapter:1')
assert.equal(lockRules.runResource('chapter-diagnose', { number: 1 }), 'chapter:1')
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.ok(indexSource.includes("case 'chapter-diagnose'"))
assert.ok(indexSource.includes("case 'chapter-repair'"))
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const tool = (name) => registered.find((item) => item.name === name)
assert.ok(tool('novel_diagnose'), '应注册 novel_diagnose')
assert.ok(tool('novel_repair'), '应注册 novel_repair')
// 恢复 facts + 逻辑问题，供工具调用
await service.saveFact(project, { kind: '术语', key: '林昭', value: '小林' })
logicMode = 'initial'
const toolDiag = await tool('novel_diagnose').execute({ number: 1 }, { agent: project, signal: null })
assert.ok(Array.isArray(toolDiag.issues) && toolDiag.issues.length > 0)
assert.ok(toolDiag.issues.filter((issue) => issue.level === 'soft').length <= 10, 'soft 最多 10 条')
const toolPrescribe = await tool('novel_repair').execute({ action: 'prescribe', number: 1 }, { agent: project, signal: null })
assert.ok(Array.isArray(toolPrescribe.prescriptions))
logicMode = 'empty'
repairPayload = { patches: [{ from: '他看见小林站在门口。', to: '小林站在门口。', reason: 'x' }] }
const toolAuto = await tool('novel_repair').execute({ action: 'auto', number: 1 }, { agent: project, signal: null })
assert.equal(typeof toolAuto.rolledBack, 'boolean')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('repair pipeline tests passed')
