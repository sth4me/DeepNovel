// 写作要求阶段映射：修复/扩写/去AI味/自动修复 → 修订；expand prompt 注入要求+硬约束；fix 约束映射；client 即时保存。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-notes-tasks-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-notes-tasks-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const constraintsEngine = await import('../constraints.js')
const templates = await import('../templates.js')

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
const makeService = () => new NovelWriterService({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})
const service = makeService()
const notes = '一、必须用第三人称；二、避免套路化爽点'

// ---------- 1) writingNotesFor 阶段映射 ----------
const reviseProject = { writingNotes: notes, writingNotesTasks: ['revise'] }
for (const stage of ['fix', 'expand', 'deslop', 'qa-fix', 'autofix', 'revise']) {
  assert.equal(service.writingNotesFor(reviseProject, stage), notes, `${stage} 应命中修订要求`)
}
for (const stage of ['draft', 'bible', 'outline']) {
  assert.equal(service.writingNotesFor(reviseProject, stage), '', `${stage} 不应命中修订任务`)
}
const draftProject = { writingNotes: notes, writingNotesTasks: ['draft'] }
assert.equal(service.writingNotesFor(draftProject, 'draft'), notes, 'draft 任务应命中草稿')
assert.equal(service.writingNotesFor(draftProject, 'expand'), '', '只勾草稿时扩写不应误命中')
assert.equal(service.writingNotesFor(draftProject, 'fix'), '', '只勾草稿时修复不应误命中')
const allProject = { writingNotes: notes, writingNotesTasks: [] }
assert.equal(service.writingNotesFor(allProject, 'expand'), notes, '未勾选 = 全部阶段生效')
assert.equal(service.writingNotesFor({ writingNotes: '' }, 'revise'), '', '无要求返回空')

// ---------- 2) expandChapterText：要求在前、带 constraints ----------
const resolved = constraintsEngine.resolveChapterConstraints({
  writingNotes: notes,
  styleFields: { pov: 'first' },
})
let expandPrompt = ''
service.callModel = async (agent, options) => {
  expandPrompt = options.messages?.[0]?.content?.[0]?.text ?? ''
  return { text: '扩写后的完整正文。' }
}
const expanded = await service.expandChapterText(project, {
  number: 3,
  chapter: { number: 3, title: '三' },
  text: '现有正文。',
  targetWords: 3000,
  styleFields: { pov: 'third-limited' },
  cast: [],
  samples: [],
  writingNotes: notes,
  constraints: resolved,
})
assert.equal(expanded, '扩写后的完整正文。')
const TITLE = '【项目写作要求（用户长期设定，优先级高于文风契约/设定/章纲）】'
assert.ok(expandPrompt.includes(TITLE), '扩写 prompt 应注入写作要求')
assert.ok(expandPrompt.includes(notes), '应含要求正文')
assert.ok(expandPrompt.includes('冲突规则：'), '应含冲突规则')
assert.ok(expandPrompt.indexOf('目标字数') < expandPrompt.indexOf(TITLE), '要求在目标字数之后')
assert.ok(expandPrompt.indexOf(TITLE) < expandPrompt.indexOf('【文风契约】'), '要求在文风契约之前')
assert.ok(expandPrompt.includes('【硬约束'), '扩写应带 constraints（start）')
// 不传 writingNotes/constraints 时不应出现
service.callModel = async (agent, options) => {
  expandPrompt = options.messages?.[0]?.content?.[0]?.text ?? ''
  return { text: 'x' }
}
await service.expandChapterText(project, { number: 3, chapter: { number: 3 }, text: '正文。', targetWords: 3000, styleFields: {}, cast: [], samples: [] })
assert.equal(expandPrompt.includes(TITLE), false, '未传 writingNotes 时不应注入')

// ---------- 3) fix 走 buildConstraintsFor(stage:'fix') 映射后自动生效 ----------
await service.initProject(project, { title: '映射测试' })
await service.writeJson(project, 'story/project.json', {
  schemaVersion: 1,
  title: '映射测试',
  writingNotes: notes,
  writingNotesTasks: ['revise'],
})
await service.writeJson(project, 'story/premise.json', { status: 'confirmed', chosen: { title: 'x', premise: 'p', genre: ['古风'], protagonist: '角色1', length: { chapters: 10, wordsPerChapter: 3000 } } })
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'ancient', fields: { pov: 'first', chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', { status: 'confirmed', characters: [], locations: [], rules: [], factions: [], items: [] })
const projectData = await service.readJson(project, 'story/project.json')
let semanticCalls = 0
service.callJsonModel = async () => {
  semanticCalls += 1
  return { parsed: null }
}
const fixConstraints = await service.buildConstraintsFor(project, {
  number: 1,
  chapter: { number: 1, title: '一', synopsis: '主角行动。' },
  project: projectData,
  inputs: { styleFields: { pov: 'first' } },
  storyContext: { bible: { characters: [] }, foreshadowing: [], notes: [] },
  instruction: '',
  stage: 'fix',
})
assert.ok(fixConstraints, 'fix 约束应返回')
assert.ok(fixConstraints.layers.some((layer) => layer.level === 'requirements' && String(layer.content).includes('第三人称')), 'fix 阶段应包含写作要求（修订任务）')
assert.ok(fixConstraints.hardRules.some((rule) => rule.includes('第三人称')), '写作要求应进入硬约束')
assert.ok(semanticCalls >= 0)

// ---------- 4) client：checkbox 即时保存 + 标签 ----------
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(clientSource.includes('修订（含修复/扩写/去AI味）'), '标签应说明修订含修复/扩写/去AI味')
const checkboxBlock = clientSource.slice(clientSource.indexOf('checked: writingTasks.includes(stage)'), clientSource.indexOf('checked: writingTasks.includes(stage)') + 900)
assert.ok(checkboxBlock.includes("run('project-update'"), 'checkbox 变更应即时保存')
assert.ok(checkboxBlock.includes('writingNotesTasks: nextTasks'), '应保存 writingNotesTasks')
assert.ok(checkboxBlock.includes('silent: true'), '即时保存应 silent')
assert.ok(checkboxBlock.includes('setNotesDirty(false)'), '保存后应清除未保存状态')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('writing notes tasks tests passed')
