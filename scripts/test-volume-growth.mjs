// 卷增长：收束硬规则/overdue 警示/volume-end 动作、新卷阵容轮换（新面孔/警告/audit 类型）。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-growth-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-growth-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
const { OUTLINE_AUDIT_SYSTEM_PROMPT, OUTLINE_SYSTEM_PROMPT } = await import('../templates.js')

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

await service.initProject(project, { title: '卷增长' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: '送学生去书院', genre: ['古风'], protagonist: '纪小棠', length: { chapters: 20, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'ancient', fields: { pov: 'third-limited', chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: ['纪小棠', '角色2', '角色3'].map((name, index) => ({ id: `c${index + 1}`, name, role: index === 0 ? '主角' : '配角', description: name, meta: { status: '活跃', firstChapter: 1, importance: index === 0 ? '主角' : '配角' } })),
  locations: [], rules: [], factions: [], items: [],
})
const chapterData = (number, extra = {}) => ({
  id: `ch-${String(number).padStart(3, '0')}`,
  number,
  title: `第${number}章`,
  synopsis: `第${number}章：主角推进目标。`,
  status: 'confirmed',
  wordBudget: 3000,
  change: `第${number}章变化`,
  storyQuestion: `第${number}章问题`,
  promise: `第${number}章承诺`,
  ...extra,
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [
    {
      id: 'vol-1', title: '第 1 卷', map: '镇子', goal: '送人到书院', exitCriteria: '到达书院', targetChapters: 2,
      cast: [{ name: '纪小棠', roleInVolume: '主角', fromChapter: 1, importance: '主角' }, { name: '角色2', roleInVolume: '同伴', fromChapter: 1, importance: '配角' }],
      chapters: [1, 2, 3, 4].map((number) => chapterData(number)),
    },
    { id: 'vol-2', title: '第 2 卷', map: '', goal: '', exitCriteria: '', targetChapters: 6, chapters: [], cast: [] },
  ],
})
const readOutline = () => service.readJson(project, 'story/plot/outline.json')
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let generateChapters = []
let castPayload = null
const castPrompts = []
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') return wrap({ chapters: generateChapters })
  if (options.kind === 'outline.audit') return wrap({ issues: [], structureIssues: [] })
  if (options.kind === 'outline.cast') {
    castPrompts.push(options.messages?.[0]?.content?.[0]?.text ?? '')
    return wrap(castPayload)
  }
  return wrap({})
}
const makeChapter = (number, extra = {}) => ({
  number,
  title: `第${number}章`,
  synopsis: `第${number}章：主角推进目标。`,
  change: `第${number}章变化`,
  storyQuestion: `第${number}章问题`,
  promise: `第${number}章承诺`,
  castUsed: ['纪小棠'],
  newNamed: [],
  ...extra,
})

// ---------- 1) 提示词：收束硬规则 / 阵容未更新 ----------
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('分卷收束硬规则'), 'OUTLINE_SYSTEM_PROMPT 应含收束硬规则')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('volumeEnd'), '应要求输出 volumeEnd')
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('全卷只能有一个收束章'), '收束章应唯一')
assert.ok(OUTLINE_AUDIT_SYSTEM_PROMPT.includes('焦点名单连续多卷'), '审核应含焦点名单轮换软提示')
const sections = []
apply({ tools: { register: () => {} }, systemPrompt: { section: (section) => sections.push(section) } })
const doctrine = sections.find((section) => section.name === 'deepnovel:writing-doctrine')
assert.ok(doctrine.text().includes('volume-plan'), '10120 应含新卷流程 volume-plan')
assert.ok(doctrine.text().includes('volume-end'), '10120 应含 volume-end 收束')
const guard = sections.find((section) => section.name === 'deepnovel:outline-repair-guard')
assert.ok(guard.text().includes('volume-end'), '10157 应提示用 volume-end 收束')

// ---------- 2) 收束 overdue 警示（无 volumeEnd 且章数 ≥ target+2） ----------
generateChapters = [makeChapter(5)]
const overdue = await service.outlineGenerate(project, { volumeId: 'vol-1', fromChapter: 5, count: 1 })
assert.equal(overdue.volumeEndOverdue, true, '无收束章且章数超 target+2 应提示')
assert.ok(overdue.volumeEndOverdueWarning && overdue.volumeEndOverdueWarning.includes('volume-end'), 'warning 应提示用 volume-end')

// ---------- 3) 有 volumeEnd 时不提示 ----------
generateChapters = [makeChapter(6, { volumeEnd: true })]
const ended = await service.outlineGenerate(project, { volumeId: 'vol-1', fromChapter: 6, count: 1 })
assert.equal(ended.volumeEndOverdue, false, '已有收束章不应提示 overdue')
assert.equal(ended.volumeEnded, true)

// ---------- 4) markVolumeEnd：设且仅设该章 ----------
const marked = await service.markVolumeEnd(project, { volumeId: 'vol-1', chapterNumber: 2 })
assert.deepEqual(marked, { volumeId: 'vol-1', chapterNumber: 2, volumeEnded: true })
let outlineMarked = await readOutline()
let vol1 = outlineMarked.volumes[0]
assert.equal(vol1.chapters.find((chapter) => Number(chapter.number) === 2).volumeEnd, true)
assert.equal(vol1.chapters.filter((chapter) => chapter.volumeEnd === true).length, 1, '全卷只能有一个收束章')
assert.equal(outlineMarked.pendingNextVolume, true)
const markedDefault = await service.markVolumeEnd(project, { volumeId: 'vol-1' })
assert.equal(markedDefault.chapterNumber, 6, '默认标记卷末章')
outlineMarked = await readOutline()
vol1 = outlineMarked.volumes[0]
assert.equal(vol1.chapters.filter((chapter) => chapter.volumeEnd === true).length, 1)
assert.equal(vol1.chapters.find((chapter) => Number(chapter.number) === 6).volumeEnd, true)

// ---------- 5) 新卷阵容轮换：prompt 注入 + 警告 + 新面孔 ----------
const currentOutline = await readOutline()
await service.writeJson(project, 'story/plot/outline.json', {
  ...currentOutline,
  volumes: [...currentOutline.volumes, { id: 'vol-2', title: '第 2 卷', map: '', goal: '', exitCriteria: '', targetChapters: 6, chapters: [], cast: [] }],
})
// 5a) 与上一卷完全相同且无理由 → warning
castPayload = {
  rationale: '延续上一卷',
  cast: [{ name: '纪小棠', roleInVolume: '主角', fromChapter: 7, importance: '主角' }, { name: '角色2', roleInVolume: '同伴', fromChapter: 7, importance: '配角' }],
  extras: [],
  newCharacters: [],
}
const sameCast = await service.planVolumeCast(project, { volumeId: 'vol-2', fromChapter: 7, toChapter: 12 })
assert.ok(sameCast.castWarning && sameCast.castWarning.includes('阵容未更新'), '阵容与上一卷相同应 warning')
assert.equal(sameCast.newFaces.length, 0)
const castPrompt = castPrompts[0]
assert.ok(castPrompt.includes('上一卷阵容'), '选角 prompt 应注入上一卷阵容')
assert.ok(castPrompt.includes('未使用角色池'), '选角 prompt 应注入未使用角色池')
assert.ok(castPrompt.includes('轮换建议'), '选角 prompt 应含轮换建议（软）')

// 5b) 引入未使用角色池的新面孔 → 无 warning，newFaces 正确
castPayload = {
  rationale: '加入新同伴',
  newFaces: ['角色3'],
  cast: [{ name: '纪小棠', roleInVolume: '主角', fromChapter: 7, importance: '主角' }, { name: '角色3', roleInVolume: '新同伴', fromChapter: 7, importance: '核心' }],
  extras: [],
  newCharacters: [],
}
const rotated = await service.planVolumeCast(project, { volumeId: 'vol-2', fromChapter: 7, toChapter: 12 })
assert.equal(rotated.castWarning, null, '引入新面孔不应 warning')
assert.deepEqual(rotated.newFaces, ['角色3'])

// 5c) 相同但有 noNewCastReason → 不 warning
castPayload = {
  rationale: '延续',
  noNewCastReason: '本卷是上一卷关系的直接延续，新面孔会破坏闭环',
  cast: [{ name: '纪小棠', roleInVolume: '主角', fromChapter: 7, importance: '主角' }, { name: '角色2', roleInVolume: '同伴', fromChapter: 7, importance: '配角' }],
  extras: [],
  newCharacters: [],
}
const explained = await service.planVolumeCast(project, { volumeId: 'vol-2', fromChapter: 7, toChapter: 12 })
assert.equal(explained.castWarning, null, '有 noNewCastReason 不应 warning')

// ---------- 6) volume-end 工具 action ----------
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.ok(indexSource.includes("case 'outline-volume-end'"), '应有 outline-volume-end action')
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const outlineTool = registered.find((tool) => tool.name === 'novel_outline')
assert.ok(outlineTool.parameters.properties.action.enum.includes('volume-end'), 'enum 应含 volume-end')
assert.ok(outlineTool.parameters.properties.chapterNumber, '应有 chapterNumber 参数')
const toolEnd = await outlineTool.execute({ action: 'volume-end', volumeId: 'vol-1', chapterNumber: 4 }, { agent: project, signal: null })
assert.equal(toolEnd.volumeEnded, true)
const afterTool = await readOutline()
assert.equal(afterTool.volumes[0].chapters.find((chapter) => Number(chapter.number) === 4).volumeEnd, true)
assert.equal(afterTool.volumes[0].chapters.filter((chapter) => chapter.volumeEnd === true).length, 1)

// ---------- 7) volume-plan/volume-select 与 volume-end 共存 ----------
assert.ok(outlineTool.parameters.properties.action.enum.includes('volume-plan'))
assert.ok(outlineTool.parameters.properties.action.enum.includes('volume-select'))

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('volume growth tests passed')
