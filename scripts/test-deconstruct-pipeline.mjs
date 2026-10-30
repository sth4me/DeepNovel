// 拆书多角色流水线：三阶段合并、单阶段容错、旧记录兼容、空文本报错。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-deconstruct-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-deconstruct-project-'))
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
}

const STRUCTURE_JSON = {
  summary: '主角在雨夜遇到一名自称故人的神秘人，对方留下半块玉佩后离开。',
  units: [
    { index: 1, span: '雨夜，破庙', summary: '主角避雨，发现庙里已经有人。', function: '开场' },
    { index: 2, span: '神秘人开口', summary: '神秘人自称故人，留下半块玉佩。', function: '冲突' },
    { index: 3, span: '玉佩落地', summary: '神秘人消失在雨里，主角握紧玉佩。', function: '钩子' },
  ],
}
const CHARACTERS_JSON = {
  characters: [
    { name: '林昭', role: '主角', description: '避雨的年轻剑客', traits: ['谨慎', '多疑'], goal: '查清父亲旧案' },
    { name: '神秘人', role: '配角', description: '雨夜出现在破庙的人', traits: ['寡言'], goal: '留下玉佩' },
  ],
  settings: { locations: ['破庙', '雨夜山道'], rules: ['玉佩成对'], factions: ['旧案相关势力'], items: ['半块玉佩'] },
  relations: [{ from: '林昭', to: '神秘人', type: '旧识', note: '对方自称故人' }],
}
const TECHNIQUE_JSON = {
  hooks: ['雨夜来客留下信物', '旧案线索以物件形式出现'],
  techniques: [
    { name: '以物传信', how: '让关键线索以可携带的物件出现，人物拿到物件时读者自然记住。', example: '半块玉佩' },
    { name: '反常自称', how: '让陌生人用内部称呼开口，制造身份悬念。', example: '自称故人' },
  ],
  pacing: '前半段用电闪雷鸣压住节奏，后段用短句加快。',
}

let failStage = null
const streamCalls = []
const llm = {
  resolveModelInfo: async () => ({ reasoning: { efforts: [] }, defaultMaxTokens: 64000 }),
  stream: async function* (request) {
    streamCalls.push(request)
    const system = String(request.system ?? '')
    if (failStage === 'structure' && system.includes('结构拆解')) throw new Error('模拟结构阶段失败')
    if (failStage === 'characters' && system.includes('人物与设定拆解')) throw new Error('模拟人物阶段失败')
    if (failStage === 'technique' && system.includes('技法拆解')) throw new Error('模拟技法阶段失败')
    let payload = null
    if (system.includes('结构拆解')) payload = STRUCTURE_JSON
    else if (system.includes('人物与设定拆解')) payload = CHARACTERS_JSON
    else if (system.includes('技法拆解')) payload = TECHNIQUE_JSON
    if (!payload) throw new Error(`未知阶段的 system：${system.slice(0, 60)}`)
    yield { type: 'text-delta', text: JSON.stringify(payload) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const ctx = {
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm,
}
const service = new NovelWriterService(ctx)
await mkdir(join(project, 'story'), { recursive: true })
await writeFile(join(project, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: 't' }), 'utf8')
const dataPath = join(project, '.dsh-writing', 'deconstructions.json')

// 1) 成功：三阶段顺序调用，合并出全部新字段
const sampleText = '雨夜，破庙。林昭避雨时发现庙里已经有人。那人自称故人，留下一块玉佩便消失在雨里。'
const result = await service.deconstructText(project, { text: sampleText, title: '雨夜破庙' })
assert.equal(result.stages.length, 3)
assert.ok(result.stages.every((stage) => stage.ok === true), JSON.stringify(result.stages))
assert.deepEqual(result.stages.map((stage) => stage.key), [
  'deconstruct.structure',
  'deconstruct.characters',
  'deconstruct.technique',
])
assert.deepEqual(result.stages.map((stage) => stage.sections), [
  ['summary', 'units'],
  ['characters', 'settings', 'relations'],
  ['techniques', 'hooks', 'pacing'],
])
assert.equal(result.analysis.title, '雨夜破庙')
assert.equal(result.analysis.summary, STRUCTURE_JSON.summary)
assert.deepEqual(result.analysis.units.map((unit) => unit.function), ['开场', '冲突', '钩子'])
assert.equal(result.analysis.units[0].summary, '主角避雨，发现庙里已经有人。')
assert.equal(result.analysis.characters[0].name, '林昭')
assert.deepEqual(result.analysis.characters[0].traits, ['谨慎', '多疑'])
assert.equal(result.analysis.settings.locations[0], '破庙')
assert.equal(result.analysis.settings.items[0], '半块玉佩')
assert.equal(result.analysis.relations[0].from, '林昭')
assert.equal(result.analysis.relations[0].type, '旧识')
assert.deepEqual(result.analysis.hooks, TECHNIQUE_JSON.hooks)
assert.equal(result.analysis.techniques.length, 2)
assert.equal(result.analysis.techniques[0].name, '以物传信')
assert.ok(result.analysis.pacing.includes('节奏'))
assert.equal(result.analysis.style && Object.keys(result.analysis.style).length, 0)
assert.equal(streamCalls.length, 3, '三阶段各应调用一次模型')

// 落盘检查
const savedOnce = await service.readDeconstructions(project)
assert.equal(savedOnce.items.length, 1)
assert.equal(savedOnce.items[0].title, '雨夜破庙')
assert.ok(Array.isArray(savedOnce.items[0].units))
assert.ok(savedOnce.items[0].settings && savedOnce.items[0].relations)
assert.ok(savedOnce.items[0].techniques && typeof savedOnce.items[0].pacing === 'string')

// 2) 旧记录仍可读，且新一轮拆书后旧记录字段原样保留
await writeFile(dataPath, JSON.stringify({
  items: [{
    title: '旧记录',
    summary: '旧梗概',
    style: { genre: ['武侠'], tone: '冷硬' },
    characters: [{ name: '旧人物', role: '主角', description: '旧描述' }],
    hooks: ['旧钩子'],
    createdAt: '2026-01-01T00:00:00.000Z',
  }],
  updatedAt: '2026-01-01T00:00:00.000Z',
}), 'utf8')
const legacy = await service.readDeconstructions(project)
assert.equal(legacy.items.length, 1)
assert.equal(legacy.items[0].summary, '旧梗概')
assert.equal(legacy.items[0].stages, undefined, '旧记录没有 stages，应原样返回')
assert.deepEqual(legacy.items[0].style, { genre: ['武侠'], tone: '冷硬' })
assert.deepEqual(legacy.items[0].characters[0], { name: '旧人物', role: '主角', description: '旧描述' })
const second = await service.deconstructText(project, { text: sampleText, title: '第二次拆书' })
assert.equal(second.items.length, 2)
assert.equal(second.items[0].title, '第二次拆书')
const keptLegacy = second.items.find((item) => item.title === '旧记录')
assert.ok(keptLegacy, '旧记录应保留')
assert.deepEqual(keptLegacy.style, { genre: ['武侠'], tone: '冷硬' })
assert.deepEqual(keptLegacy.hooks, ['旧钩子'])

// 3) 单阶段失败：不整体失败，其余字段照常落盘
failStage = 'characters'
const partial = await service.deconstructText(project, { text: '第二章：主角进城。', title: '容错测试' })
assert.equal(partial.stages.length, 3)
const failedStage = partial.stages.find((stage) => stage.key === 'deconstruct.characters')
assert.equal(failedStage.ok, false)
assert.ok(failedStage.error.includes('模拟人物阶段失败'), failedStage.error)
assert.deepEqual(failedStage.sections, ['characters', 'settings', 'relations'])
assert.ok(partial.analysis.units.length > 0, '结构阶段结果应保留')
assert.ok(partial.analysis.techniques.length > 0, '技法阶段结果应保留')
assert.deepEqual(partial.analysis.characters, [])
assert.deepEqual(partial.analysis.settings, { locations: [], rules: [], factions: [], items: [] })
assert.deepEqual(partial.analysis.relations, [])
const savedPartial = await service.readDeconstructions(project)
assert.equal(savedPartial.items[0].title, '容错测试')
assert.ok(savedPartial.items[0].units.length > 0, '失败阶段不应阻止 items 落盘')
assert.ok(Array.isArray(savedPartial.items[0].stages), 'item 应落盘 stages')
const persistedFailed = savedPartial.items[0].stages.find((stage) => stage.key === 'deconstruct.characters')
assert.equal(persistedFailed.ok, false)
assert.ok(persistedFailed.error.includes('模拟人物阶段失败'))
assert.deepEqual(persistedFailed.sections, ['characters', 'settings', 'relations'])

// 4) 阶段 1 失败：summary 为空，但阶段 2/3 结果仍保存
failStage = 'structure'
const partialStructure = await service.deconstructText(project, { text: '第三章：雨停。', title: '结构失败' })
const structureStage = partialStructure.stages.find((stage) => stage.key === 'deconstruct.structure')
assert.equal(structureStage.ok, false)
assert.equal(partialStructure.analysis.summary, '')
assert.deepEqual(partialStructure.analysis.units, [])
assert.ok(partialStructure.analysis.characters.length > 0, '人物阶段结果应保留')
const savedStructure = await service.readDeconstructions(project)
assert.equal(savedStructure.items[0].title, '结构失败')
failStage = null

// 5) 空文本报错
await assert.rejects(() => service.deconstructText(project, { text: '   ' }), /请粘贴要拆解/)

// 6) 阶段提示词已在 PROMPT_CATALOG 注册
const { PROMPT_CATALOG } = await import('../templates.js')
for (const key of ['deconstructStructure', 'deconstructCharacters', 'deconstructTechnique']) {
  const entry = PROMPT_CATALOG.find((item) => item.key === key)
  assert.ok(entry, `缺少提示词条目：${key}`)
  assert.equal(entry.category, '拆书')
  assert.equal(entry.revision, 1)
}

service.disposeStores()
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('deconstruct pipeline tests passed')
