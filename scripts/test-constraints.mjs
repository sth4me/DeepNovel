// 约束引擎 + 事实包（schema v4）+ 双注入 + 旧接口简化。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-constraints-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-constraints-project-'))
const legacyProject = await mkdtemp(join(tmpdir(), 'deepnovel-constraints-legacy-'))
process.env.DSH_HOME = home

const constraintsEngine = await import('../constraints.js')
const { buildChapterUserPrompt } = await import('../templates.js')
const { NovelWriterService } = await import('../service.js')
const { DatabaseSync } = await import('node:sqlite')

// ---------- 1) 优先级：explicit > requirements，且冲突记录 ----------
const priorityResult = constraintsEngine.resolveChapterConstraints({
  instruction: '本章用第一人称写',
  writingNotes: '本书统一用第三人称叙述',
  styleFields: { pov: 'third-limited', tense: 'past' },
})
assert.ok(priorityResult.hardRules.some((rule) => rule.includes('第一人称')), 'explicit 应胜出')
assert.ok(priorityResult.conflicts.some((item) => item.a === 'explicit' && item.b === 'style' && item.winner === 'explicit'))
assert.ok(priorityResult.layers.some((layer) => layer.level === 'explicit' && layer.content.includes('第一人称')))
assert.ok(priorityResult.layers.some((layer) => layer.level === 'requirements'))

// ---------- 2) 结构化冲突：人称 / 句长 / 对话比例 / 术语 / 章纲 vs bible / 伏笔 ----------
const structured = constraintsEngine.resolveChapterConstraints({
  writingNotes: '用第三人称，多用短句，多写对话',
  styleFields: { pov: 'first', tense: 'present', sentenceLength: 'long', dialogueRatio: 0.2, chapterWords: 3000 },
  facts: [{ id: 'f1', kind: '术语', key: '林昭', value: '小林' }],
  glossary: [{ canonical: '林昭', aliases: ['小林'] }],
  chapter: { number: 1, synopsis: '林昭 killed 敌人后死去。' },
  bible: { characters: [{ name: '林昭', description: '存活，是主角' }] },
  foreshadowing: [{ id: 'p1', status: 'done' }],
})
const conflictPairs = structured.conflicts.map((item) => `${item.a}>${item.b}`)
assert.ok(conflictPairs.includes('requirements>style'), '人称/句长/对话冲突应记录')
assert.ok(structured.conflicts.some((item) => item.reason.includes('第一人称') || item.reason.includes('第三人称')))
assert.ok(structured.conflicts.some((item) => item.reason.includes('短句')), '句长冲突应记录')
assert.ok(structured.conflicts.some((item) => item.reason.includes('对话')), '对话比例冲突应记录')
assert.ok(structured.hardRules.some((rule) => rule.includes('林昭')), '术语应进入硬约束')
assert.ok(structured.conflicts.some((item) => item.a === 'outline' && item.b === 'bible' && item.autoResolved === false), '章纲 vs 设定应标记需更新')
assert.ok(structured.warnings.some((warning) => warning.includes('设定需要同步')))
assert.ok(structured.hardRules.length <= 12, 'hardRules 最多 12 条')
assert.ok(structured.hardRules.every((rule) => rule.length > 0 && rule.length <= 200))

// 伏笔状态冲突
const foreshadowConflict = constraintsEngine.resolveChapterConstraints({
  chapter: { number: 1, synopsis: '本章回收旧信件的伏笔' },
  foreshadowing: [{ id: 'p1', status: 'done', title: '旧信件' }],
})
assert.ok(foreshadowConflict.conflicts.some((item) => item.a === 'outline' && item.b === 'facts'))
assert.ok(foreshadowConflict.warnings.some((warning) => warning.includes('伏笔')))

// ---------- 3) 双注入：start/end 内容一致、不含新规则 ----------
const start = constraintsEngine.renderConstraints(structured, { phase: 'start' })
const end = constraintsEngine.renderConstraints(structured, { phase: 'end' })
assert.ok(start.includes('【硬约束'))
assert.ok(end.includes('【硬约束复述'))
const ruleLines = (text) => text.split('\n').filter((line) => /^\d+\. /.test(line))
assert.deepEqual(ruleLines(start), ruleLines(end), 'start/end 硬约束内容应一致')
assert.ok(ruleLines(start).length <= 12)
assert.equal(ruleLines(start).length, structured.hardRules.length)

// ---------- 4) 语义冲突合并 + LLM 失败降级 ----------
const semantic = constraintsEngine.resolveChapterConstraints({
  instruction: '不要写打斗',
  writingNotes: '每章必须有打斗场面',
  styleFields: { pov: 'third-limited' },
  semanticConflicts: [{ a: 'requirements', b: 'explicit', winner: 'explicit', reason: '要求不写打斗与必须写打斗矛盾' }],
})
assert.ok(semantic.conflicts.some((item) => item.reason.includes('打斗')), '语义冲突应合并')
// 优先级改判：若模型给 winner 低优先级，按引擎改判
const reJudged = constraintsEngine.resolveChapterConstraints({
  semanticConflicts: [{ a: 'requirements', b: 'explicit', winner: 'requirements', reason: 'x' }],
})
assert.ok(reJudged.conflicts.some((item) => item.winner === 'explicit'), '语义冲突应按优先级改判')

// validateAgainstFacts：术语/称呼/硬事实关键值
const validation = constraintsEngine.validateAgainstFacts('小林走进屋子。', [
  { id: 'f1', kind: '术语', key: '林昭', value: '小林' },
  { id: 'f3', kind: '硬事实', key: '年龄', value: '28', must: true, note: '二十八|28岁' },
])
assert.equal(validation.ok, false)
assert.ok(validation.violations.some((item) => item.kind === '术语' && item.rule.includes('小林')))
assert.ok(validation.violations.some((item) => item.kind === '硬事实'))
const titleValidation = constraintsEngine.validateAgainstFacts('林昭来了。', [
  { id: 'f2', kind: '称呼', key: '林昭', value: '林先生' },
])
assert.ok(titleValidation.violations.some((item) => item.kind === '称呼'))

// ---------- 5) facts 表：v3 旧库升级 v4、不丢数据、CRUD、chapterFacts 合并 ----------
await mkdir(join(legacyProject, 'story'), { recursive: true })
const legacyDb = new DatabaseSync(join(legacyProject, 'story', 'project.db'))
legacyDb.exec(`
CREATE TABLE project (
  id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER, title TEXT, language TEXT,
  genre_json TEXT, logline TEXT, writing_notes TEXT, craft_auto INTEGER DEFAULT 1,
  prompt_json TEXT, automation_json TEXT, extra_json TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE materials (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT, content TEXT NOT NULL,
  tags_json TEXT, source TEXT, created_at TEXT, updated_at TEXT
);
`)
legacyDb.prepare('INSERT INTO project (id, schema_version, title, language) VALUES (1, 3, ?, ?)').run('旧项目', 'zh')
legacyDb.prepare('INSERT INTO materials (id, title, kind, content) VALUES (?, ?, ?, ?)').run('mat-old', '旧素材', '片段', '旧素材内容')
legacyDb.exec('PRAGMA user_version = 3')
legacyDb.close()

const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try { const info = await stat(join(target.cwd, target.relativePath)); return { version: String(info.mtimeMs) } } catch { return null }
  },
  readText: async (target) => readFile(join(target.cwd, target.relativePath), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(join(target.cwd, target.relativePath)), { recursive: true })
    await writeFile(join(target.cwd, target.relativePath), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
}
const service = new NovelWriterService({ fs: fsCtx, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } })

const legacyStore = await service.storeFor(legacyProject)
assert.equal(legacyStore.schemaVersion(), 4, 'v3 旧库应升级到 v4')
assert.equal(legacyStore.readProject().title, '旧项目', '旧项目数据不丢')
assert.equal(legacyStore.listMaterials().length, 1, '旧 materials 数据不丢')
const legacyFact = legacyStore.saveFact({ kind: '术语', key: '林昭', value: '小林' })
assert.ok(legacyFact.id.startsWith('fact-'), 'v4 facts 表可用')

await service.initProject(project, { title: '约束测试' })
const globalFact = await service.saveFact(project, { kind: '术语', key: '林昭', value: '小林' })
assert.equal(globalFact.kind, '术语')
const chapterFact = await service.saveFact(project, { kind: '硬事实', key: '年龄', value: '28', chapter: 1, note: '二十八|28岁' })
assert.equal(chapterFact.chapter, 1)
const safetyFact = await service.saveFact(project, { kind: '安全', key: '底线', value: '不写未成年人性内容' })
assert.equal(safetyFact.kind, '安全')
const factList = (await service.listFacts(project)).facts
assert.equal(factList.length, 3)
assert.equal((await service.chapterFacts(project, 1)).length, 3, '本章事实应含全局+本章')
assert.equal((await service.chapterFacts(project, 2)).length, 2, '其他章只含全局事实')
assert.deepEqual(legacyStore.glossaryFacts().map((item) => item.canonical), ['林昭'])
await assert.rejects(() => service.saveFact(project, { kind: '术语', key: '', value: 'x' }), /key 不能为空/)
await assert.rejects(() => service.saveFact(project, { kind: '非法', key: 'k', value: 'v' }), /kind|不能为空/)
const deletedFact = await service.deleteFact(project, { id: chapterFact.id })
assert.deepEqual(deletedFact, { id: chapterFact.id, deleted: true })
await assert.rejects(() => service.deleteFact(project, { id: 'no-such' }), /找不到事实/)

// ---------- 6) service.buildConstraintsFor：语义预检 + 降级 ----------
await service.writeJson(project, 'story/project.json', { schemaVersion: 1, title: '约束测试', writingNotes: { draft: ['一、必须用第三人称'] } })
const baseContext = { bible: { characters: [{ name: '林昭', description: '存活' }] }, foreshadowing: [], notes: [] }
let semanticCalls = 0
service.callJsonModel = async (agent, options) => {
  semanticCalls += 1
  if (options.kind === 'chapter.constraints') {
    return { parsed: { conflicts: [{ a: 'requirements', b: 'explicit', winner: 'requirements', ruleA: '第三人称', ruleB: '第一人称', reason: '视角冲突' }] } }
  }
  return { parsed: null }
}
const projectData = await service.readJson(project, 'story/project.json')
const built = await service.buildConstraintsFor(agentWithProject(project), {
  number: 1,
  chapter: { number: 1, synopsis: '林昭死去。' },
  project: projectData,
  inputs: { styleFields: { pov: 'third-limited' } },
  storyContext: baseContext,
  instruction: '本章用第一人称',
  stage: 'draft',
})
assert.ok(structuredConfig(built), '应返回约束对象')
assert.ok(built.conflicts.some((item) => item.winner === 'explicit' || item.a === 'explicit'), '语义冲突应按优先级裁决')
assert.ok(semanticCalls >= 1)
// 降级：LLM 抛错不阻塞
service.callJsonModel = async () => { throw new Error('boom') }
const degraded = await service.buildConstraintsFor(agentWithProject(project), {
  number: 1,
  chapter: { number: 1, synopsis: '林昭死去。' },
  project: projectData,
  inputs: { styleFields: { pov: 'third-limited' } },
  storyContext: baseContext,
  instruction: '本章用第一人称',
  stage: 'draft',
})
assert.ok(structuredConfig(degraded), 'LLM 失败应降级为结构化结果')

// ---------- 7) buildChapterUserPrompt 双注入 ----------
const constraintsForPrompt = constraintsEngine.resolveChapterConstraints({
  instruction: '本章用第一人称',
  facts: [{ id: 'f1', kind: '术语', key: '林昭', value: '小林' }],
  glossary: [{ canonical: '林昭', aliases: ['小林'] }],
  chapter: { number: 1, title: '测试章', synopsis: '林昭出场。' },
  styleFields: { pov: 'first' },
})
const prompt = buildChapterUserPrompt({
  title: 't', language: 'zh', number: 1, chapter: { title: '测试章' },
  styleFields: { pov: 'first' }, wordBudget: 3000, instruction: '本章用第一人称',
  constraints: constraintsForPrompt,
})
assert.equal(prompt.split('【硬约束').length - 1 >= 2, true, '应开头与结尾各注入一次硬约束块')
assert.ok(prompt.includes('1. 视角：第一人称') || prompt.includes('视角：第一人称'), '硬约束应含显式视角')
assert.ok(prompt.includes('本章用第一人称'), '应保留 explicit 原文')

// ---------- 8) 旧接口简化：craft-card-* 与用户卡 CRUD 已移除 ----------
assert.equal(typeof service.saveCraftCard, 'undefined')
assert.equal(typeof service.deleteCraftCard, 'undefined')
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
for (const action of ['craft-cards', 'craft-card-read', 'craft-card-save', 'craft-card-delete', 'craft-card-toggle']) {
  assert.equal(indexSource.includes(`case '${action}'`), false, `action 应已移除：${action}`)
}

// ---------- 9) draftChapter 集成：prompt 双注入 + 返回 constraints ----------
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: 'a', length: { chapters: 10, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', {
  status: 'confirmed', templateId: 'fast-web', fields: { pov: 'first', chapterWords: 3000 }, samples: [],
})
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed', characters: [], locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'v1', title: '一', chapters: [{ id: 'c1', number: 1, title: '测试章', synopsis: '林昭出场。', status: 'confirmed', wordBudget: 3000 }] }],
})
let draftPrompt = null
service.callJsonModel = async () => ({ parsed: { conflicts: [] } })
service.callModel = async (agent, options) => {
  draftPrompt = options.messages?.[0]?.content?.[0]?.text ?? null
  return { text: '他推门进去，屋里没人。他把包袱放下，手指在桌沿敲了两下。'.repeat(20), usage: null, model: null, durationMs: 0 }
}
const draftResult = await service.draftChapter(project, { number: 1, instruction: '本章用第一人称' })
assert.ok(Array.isArray(draftResult.constraints.hardRules) && draftResult.constraints.hardRules.length > 0, 'draft 应返回 constraints 摘要')
assert.ok(draftPrompt.includes('【硬约束'), 'draft prompt 应含硬约束块')
assert.equal(draftPrompt.split('【硬约束').length - 1 >= 2, true, 'draft prompt 应开头/结尾双注入')
assert.ok(draftPrompt.includes('本章用第一人称'), 'draft prompt 应含 explicit 指令')


// ---------- 10) facts API + 助手工具 novel_facts / novel_constraints ----------
const indexSource2 = await readFile(new URL('../index.js', import.meta.url), 'utf8')
for (const action of ['facts-list', 'fact-save', 'fact-delete']) {
  assert.ok(indexSource2.includes(`case '${action}'`), `project-action 应包含 ${action}`)
}
const lockRules = await import('../lock-rules.js')
assert.equal(lockRules.runResource('fact-save'), 'facts', 'fact-save 应归 facts 资源')
assert.equal(lockRules.runResource('facts-list'), null, '只读列表不占写锁')
assert.equal(lockRules.runResource('chapter-draft', { number: 1 }), 'chapter:1')

const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
setNovelWriter(service)
const registered = []
apply({
  tools: { register: (tool) => registered.push(tool) },
  systemPrompt: { section: () => {} },
})
const tool = (name) => registered.find((item) => item.name === name)
assert.ok(tool('novel_facts'), '应注册 novel_facts')
assert.ok(tool('novel_constraints'), '应注册 novel_constraints')

const factsList = await tool('novel_facts').execute({ action: 'list' }, { agent: project, signal: null })
assert.ok(Array.isArray(factsList.facts) && factsList.facts.length >= 2)
assert.ok(factsList.facts.every((fact) => typeof fact.key === 'string' && fact.key.length <= 200))
const savedFactTool = await tool('novel_facts').execute({ action: 'save', kind: '称呼', key: '林昭', value: '林先生' }, { agent: project, signal: null })
assert.ok(savedFactTool.fact?.id, 'novel_facts save 应返回 fact')
const afterSaveFacts = await tool('novel_facts').execute({ action: 'list' }, { agent: project, signal: null })
assert.ok(afterSaveFacts.facts.some((fact) => fact.kind === '称呼' && fact.key === '林昭'))
const deletedFactTool = await tool('novel_facts').execute({ action: 'delete', id: savedFactTool.fact.id }, { agent: project, signal: null })
assert.equal(deletedFactTool.deleted, true)

const draftBefore2 = await readFile(join(project, 'story', 'chapters', '001', 'draft.md'), 'utf8')
const constraintsCheck = await tool('novel_constraints').execute({ action: 'check', number: 1, instruction: '本章用第一人称' }, { agent: project, signal: null })
assert.equal(constraintsCheck.number, 1)
assert.ok(Array.isArray(constraintsCheck.hardRules) && constraintsCheck.hardRules.length > 0)
assert.ok(Array.isArray(constraintsCheck.conflicts))
assert.ok(Array.isArray(constraintsCheck.warnings))
assert.equal(constraintsCheck.conflicts.length <= 10, true)
assert.equal(await readFile(join(project, 'story', 'chapters', '001', 'draft.md'), 'utf8'), draftBefore2, 'novel_constraints 不应写正文')
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
await rm(legacyProject, { recursive: true, force: true })
console.log('constraints tests passed')

function agentWithProject(cwd) {
  return cwd
}
function structuredConfig(value) {
  return Boolean(value && Array.isArray(value.hardRules) && Array.isArray(value.conflicts) && Array.isArray(value.layers) && Array.isArray(value.warnings))
}
