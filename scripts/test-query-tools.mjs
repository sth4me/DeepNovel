// 助手读取能力补齐：novel_query 新增 kind（relations/power/inspirations/deconstructions/
// prompt-overrides/premise-chat）+ novel_bible 关系/力量读写。全部通过真实工具 execute 验证。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-query-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-query-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await stat(abs(target))
      return { version: String(info.mtimeMs) }
    } catch {
      return null
    }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
  listDir: async (target) => (await readdir(abs(target), { withFileTypes: true })).map((entry) => ({
    type: entry.isDirectory() ? 'directory' : 'file',
    name: entry.name,
  })),
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
const registered = []
apply({
  tools: { register: (tool) => registered.push(tool) },
  systemPrompt: { section: () => {} },
})
const tool = (name) => {
  const found = registered.find((item) => item.name === name)
  assert.ok(found, `应注册工具 ${name}`)
  return found
}
const query = async (args) => tool('novel_query').execute(args, { agent: project, signal: null })
const bible = async (args) => tool('novel_bible').execute(args, { agent: project, signal: null })

const iso = new Date().toISOString()
await service.initProject(project, { title: '查询工具' })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: null,
  updatedAt: iso,
  volumes: [{
    id: 'v1',
    title: '卷一',
    chapters: [
      { id: 'c1', number: 1, title: '第1章', synopsis: '破庙里遇到神秘人', status: 'confirmed', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
      { id: 'c2', number: 2, title: '第2章', synopsis: '拜师学艺', status: 'confirmed', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
    ],
  }],
})
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [
    { id: 'C#01', name: '甲', role: '主角', description: '少年剑客' },
    { id: 'C#02', name: '乙', role: '师父', description: '隐世高人' },
    { id: 'C#03', name: '丙', role: '反派', description: '魔教长老' },
  ],
  locations: [{ id: 'L#01', name: '破庙', description: '荒废古庙' }],
  rules: [],
  factions: [],
  items: [],
  updatedAt: iso,
})
await service.saveRelations(project, {
  relations: [
    { from: '甲', to: '乙', type: '师徒', note: '雨夜拜师' },
    { from: '甲', to: '丙', type: '敌对', note: '旧仇' },
  ],
  positions: { 甲: { x: 0.2, y: 0.4 }, 乙: { x: 0.8, y: 0.4 } },
})
await service.savePower(project, {
  power: {
    status: 'confirmed',
    system: {
      name: '武道境界',
      summary: '三流到一流',
      tiers: [
        { id: 't1', name: '三流', order: 0, description: '刚入门' },
        { id: 't2', name: '一流', order: 1, description: '真气外放' },
      ],
    },
    characters: [{ id: 'P#01', name: '甲', tierId: 't2', stage: '初期' }],
    chapterChanges: { 1: ['甲：入门'], 3: ['甲：突破一流'] },
  },
})
await service.saveInspiration(project, { topic: '雨夜奇遇', ideas: ['破庙', '半块玉佩'] })
await service.writeJson(project, '.dsh-writing/deconstructions.json', {
  items: [{
    title: '拆书A',
    summary: '一个关于复仇与师恩的故事。',
    units: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
    characters: [{ name: '甲' }, { name: '乙' }],
    techniques: [{ name: '倒叙' }],
    hooks: [], settings: [], relations: [],
    createdAt: iso,
  }],
})
const catalog = await service.promptCatalog(project)
const promptKey = catalog.prompts[0].key
await service.saveSystemOverrides(project, { [promptKey]: '自定义提示词：先写冲突再写场景。' })
await service.savePremiseChat(project, {
  messages: [
    { role: 'user', content: '想要一个雨夜复仇的故事。', createdAt: iso },
    { role: 'assistant', content: '可以这样：' + '很长的建议'.repeat(120), createdAt: iso },
  ],
  batches: [{ id: 'b1', mode: 'candidates', candidates: [{}, {}], createdAt: iso }],
})

// ---------- 1) relations ----------
const relations = await query({ kind: 'relations' })
assert.equal(relations.kind, 'relations')
assert.equal(relations.relations.length, 2)
assert.deepEqual(relations.relations[0], { from: '甲', to: '乙', type: '师徒', note: '雨夜拜师' })
assert.deepEqual(relations.positions, { 甲: { x: 0.2, y: 0.4 }, 乙: { x: 0.8, y: 0.4 } })
assert.equal((await query({ kind: 'relations', keyword: '师徒' })).relations.length, 1)
assert.equal((await query({ kind: 'relations', keyword: '不存在的词' })).relations.length, 0)
assert.equal((await query({ kind: 'relations', limit: 1 })).relations.length, 1)

// ---------- 2) power ----------
const power = await query({ kind: 'power' })
assert.equal(power.kind, 'power')
assert.equal(power.tiers.length, 2)
assert.equal(power.characters[0].name, '甲')
assert.deepEqual(power.changes.map((item) => item.chapter), [3, 1], 'changes 应按章号倒序')
assert.equal((await query({ kind: 'power', keyword: '一流' })).tiers.length, 1)
assert.equal((await query({ kind: 'power', keyword: '甲' })).characters.length, 1)
assert.equal((await query({ kind: 'power', limit: 1 })).changes.length, 1)

// ---------- 3) inspirations ----------
const inspirations = await query({ kind: 'inspirations' })
assert.equal(inspirations.kind, 'inspirations')
assert.equal(inspirations.items.length, 1)
assert.equal(inspirations.items[0].topic, '雨夜奇遇')
assert.ok(Array.isArray(inspirations.items[0].ideas))
assert.equal((await query({ kind: 'inspirations', keyword: '玉佩' })).items.length, 1)
assert.equal((await query({ kind: 'inspirations', keyword: '不存在的词' })).items.length, 0)

// ---------- 4) deconstructions（默认只回摘要+计数，entryId/number 取全文） ----------
const deconstructions = await query({ kind: 'deconstructions' })
assert.equal(deconstructions.kind, 'deconstructions')
assert.equal(deconstructions.items.length, 1)
const entry = deconstructions.items[0]
assert.equal(entry.title, '拆书A')
assert.ok(entry.summary.startsWith('一个关于复仇'))
assert.equal(entry.counts.units, 3)
assert.equal(entry.counts.characters, 2)
assert.equal(entry.counts.techniques, 1)
assert.equal('units' in entry, false, '默认不应返回全文数组')
assert.equal('characters' in entry, false, '默认不应返回全文数组')
const fullEntry = await query({ kind: 'deconstructions', entryId: '拆书A' })
assert.ok(Array.isArray(fullEntry.item.units) && fullEntry.item.units.length === 3, 'entryId 应返回单条全文')
const indexedEntry = await query({ kind: 'deconstructions', number: 1 })
assert.equal(indexedEntry.item.title, '拆书A', 'number 应返回第 N 条全文')
const missingEntry = await query({ kind: 'deconstructions', entryId: '不存在' })
assert.equal(missingEntry.ok, false, '缺失拆书记录应返回结构化错误')
assert.match(missingEntry.error, /找不到拆书记录/)

// ---------- 5) prompt-overrides（只回预览） ----------
const overrides = await query({ kind: 'prompt-overrides' })
assert.equal(overrides.kind, 'prompt-overrides')
assert.equal(overrides.overrides.length, 1)
assert.equal(overrides.overrides[0].key, promptKey)
assert.equal(overrides.overrides[0].customized, true)
assert.ok(overrides.overrides[0].revision >= 1)
assert.ok(overrides.overrides[0].preview.includes('自定义提示词'))
assert.ok(overrides.overrides[0].preview.length <= 120)
assert.equal('content' in overrides.overrides[0], false, '不应返回全文')

// ---------- 6) premise-chat（消息截断 400、批次候选计数） ----------
const chat = await query({ kind: 'premise-chat' })
assert.equal(chat.kind, 'premise-chat')
assert.equal(chat.messages.length, 2)
assert.equal(chat.messages[0].role, 'user')
assert.ok(chat.messages[1].content.length <= 400, '消息内容应截断 400')
assert.equal(chat.batches.length, 1)
assert.equal(chat.batches[0].candidateCount, 2)
assert.equal((await query({ kind: 'premise-chat', limit: 1 })).messages.length, 1)

// ---------- 7) novel_bible action=relations/power 读写往返 ----------
const readRelations = await bible({ action: 'relations' })
assert.equal(readRelations.relations.length, 2)
const savedRelations = await bible({
  action: 'relations-save',
  relations: [
    { from: '甲', to: '乙', type: '师徒', note: '三年之约' },
    { from: '甲', to: '丙', type: '宿敌', note: '旧仇' },
  ],
  positions: { 甲: { x: 0.5, y: 0.5 } },
})
assert.equal(savedRelations.relations.length, 2)
const rereadRelations = await bible({ action: 'relations' })
assert.equal(rereadRelations.relations[0].note, '三年之约')
assert.deepEqual(rereadRelations.positions, { 甲: { x: 0.5, y: 0.5 } })

const readPower = await bible({ action: 'power' })
assert.equal(readPower.system.name, '武道境界')
const savedPower = await bible({
  action: 'power-save',
  power: {
    status: 'confirmed',
    system: {
      name: '武道境界',
      summary: '三流到绝顶',
      tiers: [
        { id: 't1', name: '三流', order: 0 },
        { id: 't2', name: '一流', order: 1 },
        { id: 't3', name: '绝顶', order: 2 },
      ],
    },
    characters: [{ id: 'P#01', name: '甲', tierId: 't3', stage: '圆满' }],
    chapterChanges: { 5: ['甲：登顶'] },
  },
})
assert.equal(savedPower.system.tiers.length, 3)
const rereadPower = await bible({ action: 'power' })
assert.equal(rereadPower.characters[0].tierName, '绝顶')
assert.ok(Array.isArray(rereadPower.chapterChanges['5']), 'power-save 应保留章节变化')

// ---------- 8) 未知 kind → 工具错误包装（不裸抛） ----------
const unknown = await query({ kind: 'not-a-kind' })
assert.equal(unknown.ok, false)
assert.ok(unknown.hint, '未知 kind 应返回 hint')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('query tools tests passed')
