// 人物状态：生成/写盘、阵容外剔除、草稿注入、自动更新、失败不阻塞、action/工具。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-state-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-state-project-'))
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

await service.initProject(project, { title: '人物状态' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: '角色1', length: { chapters: 10, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [] })
const poolNames = Array.from({ length: 8 }, (_, index) => `角色${index + 1}`)
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: poolNames.map((name, index) => ({ id: `characters-${index + 1}`, name, role: index === 0 ? '主角' : '配角', description: `${name}的描述` })),
  locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标',
    cast: poolNames.slice(0, 6).map((name, index) => ({ name, roleInVolume: '本卷作用', fromChapter: 1, importance: index === 0 ? '主角' : '配角' })),
    chapters: [
      { id: 'ch-001', number: 1, title: '第1章', synopsis: '角色1在码头遇到角色2。', status: 'confirmed', wordBudget: 3000 },
      { id: 'ch-002', number: 2, title: '第2章', synopsis: '角色1决定追查线索。', status: 'confirmed', wordBudget: 3000 },
    ],
  }],
})
await service.writeTextFile(project, 'story/chapters/001/draft.md', '角色1走进码头，看见角色2。他把信塞进口袋。'.repeat(20))
await service.writeJson(project, 'story/state/001.json', {
  scene: { location: '码头', time: '夜' },
  characters: [{ name: '角色1', situation: '刚拿到信', nextHook: '去问角色2' }],
  summary: '角色1拿到信',
})

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let stateCalls = 0
let stateThrow = false
let statePayload = {
  scene: { location: '码头', time: '深夜' },
  characters: [
    { name: '角色1', situation: '发现线索', desire: '查清真相', fear: '被出卖', knowledge: { knows: ['信在角色2手里'], unknown: ['幕后是谁'] }, relationships: [{ with: '角色2', status: '暂时合作' }], items: ['信'], injuries: '', unresolved: ['谁寄的信'], nextHook: '去找角色2对质' },
    { name: '角色2', situation: '在码头等', desire: '脱身', fear: '被牵连', knowledge: { knows: [], unknown: [] }, relationships: [], items: [], injuries: '手臂擦伤', unresolved: [], nextHook: '与角色1见面' },
    { name: '角色8', situation: '不该出现', desire: '', fear: '', knowledge: { knows: [], unknown: [] }, relationships: [], items: [], injuries: '', unresolved: [], nextHook: '' },
  ],
  summary: '角色1与角色2在码头见面，线索指向上一章的信。',
}
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'chapter.character-state') {
    stateCalls += 1
    if (stateThrow) throw new Error('state boom')
    return wrap(statePayload)
  }
  return wrap({})
}
let draftPrompt = ''
service.callModel = async (agent, options) => {
  if (options.task === 'draft') draftPrompt = options.messages?.[0]?.content?.[0]?.text ?? ''
  return { text: '角色1走进码头，找到角色2说话。他把信递过去。'.repeat(30), usage: null, model: null, durationMs: 0 }
}

// ---------- 1) updateChapterState：生成 + 阵容外剔除 + 写盘 ----------
await service.writeTextFile(project, 'story/chapters/002/draft.md', '角色1追查线索，和角色2见面。'.repeat(20))
const updated = await service.updateChapterState(project, { number: 2 })
assert.equal(updated.state.characters.length, 3, '角色池内角色应保留（不再按焦点名单过滤）')
assert.ok(updated.state.characters.every((character) => poolNames.includes(character.name)))
assert.ok(!updated.warning, '角色池内角色不应产生剔除 warning')
assert.equal(updated.state.scene.location, '码头')
assert.equal(updated.state.summary.includes('角色1'), true)
const persisted = await service.chapterState(project, 2)
assert.equal(persisted.characters.length, 3, 'state 应写盘')
assert.equal(persisted.characters[0].nextHook, '去找角色2对质')

// ---------- 2) draftChapter：注入上一章状态 + 阵容，生成后自动更新 state ----------
stateCalls = 0
const draftResult = await service.draftChapter(project, { number: 2 })
assert.ok(draftPrompt.includes('【上一章人物状态'), 'draft prompt 应含上一章人物状态')
assert.ok(draftPrompt.includes('【本卷焦点名单'), 'draft prompt 应含本卷焦点名单')
assert.ok(draftPrompt.includes('角色1'), '阵容应含角色名')
assert.ok(draftPrompt.includes('角色8'), '角色池内角色应可出现在 prompt（焦点名单不是白名单）')
assert.equal(draftPrompt.includes('上一章人物状态：无'), false)
assert.ok(stateCalls >= 1, '生成后应自动更新人物状态')
assert.ok(draftResult.state, 'draft 返回应含 state')
assert.ok(draftResult.stateWarning === null || draftResult.stateWarning.includes('角色8'), 'stateWarning 可为剔除提示')

// ---------- 3) 无上一章状态：draft 正常、不注入 state 段 ----------
await service.writeJson(project, 'story/state/001.json', null)
stateCalls = 0
const noPrev = await service.draftChapter(project, { number: 2 })
assert.equal(draftPrompt.includes('【上一章人物状态'), false, '无上章状态时不注入')
assert.ok(draftPrompt.includes('【本卷焦点名单'))
assert.ok(noPrev)

// ---------- 4) state 生成失败不影响 draft ----------
stateThrow = true
const failedState = await service.draftChapter(project, { number: 2 })
assert.ok(failedState.runId, 'draft 应成功')
assert.equal(failedState.state, null)
assert.ok(failedState.stateWarning && failedState.stateWarning.includes('人物状态更新失败'), '应返回 stateWarning')
stateThrow = false

// ---------- 5) action / 工具 ----------
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.ok(indexSource.includes("case 'chapter-state'"), '应含 chapter-state action')
assert.ok(indexSource.includes("case 'chapter-state-update'"), '应含 chapter-state-update action')
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const tool = registered.find((item) => item.name === 'novel_state')
assert.ok(tool, '应注册 novel_state')
const toolGet = await tool.execute({ action: 'get', number: 2 }, { agent: project, signal: null })
assert.ok(toolGet.state && Array.isArray(toolGet.state.characters))
const toolUpdate = await tool.execute({ action: 'update', number: 2 }, { agent: project, signal: null })
assert.ok(toolUpdate.state)

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('character state tests passed')
