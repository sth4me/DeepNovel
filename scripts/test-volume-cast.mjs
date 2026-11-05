// 按卷选角 + casting 预算：池选 ≤6、新增 ≤2、写盘、大纲只用阵容、复用、warning、action/工具。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-cast-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-cast-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { CAST_LIMITS } = await import('../writing-doctrine.js')
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

await service.initProject(project, { title: '选角测试' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: '角色1', length: { chapters: 30, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [] })
const poolNames = Array.from({ length: 17 }, (_, index) => `角色${index + 1}`)
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: poolNames.map((name, index) => ({
    id: `characters-${String(index + 1).padStart(2, '0')}`,
    name,
    role: index === 0 ? '主角' : '配角',
    description: `${name}的描述`,
  })),
  locations: [], rules: [], factions: [], items: [],
})
const baseVolume = (overrides = {}) => ({
  id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标', chapters: [], ...overrides,
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate', logline: '一句话', volumes: [baseVolume()],
})
const readOutline = () => service.readJson(project, 'story/plot/outline.json')

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let castCalls = 0
let generateCalls = 0
let capturedGeneratePrompt = ''
let capturedGenerateSystem = ''
let castPayload = null
let generatePayload = null
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.cast') {
    castCalls += 1
    return wrap(castPayload)
  }
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') {
    generateCalls += 1
    capturedGeneratePrompt = options.messages?.[0]?.content?.[0]?.text ?? ''
    capturedGenerateSystem = options.system ?? ''
    return wrap(generatePayload ?? { chapters: [] })
  }
  if (options.kind === 'outline.audit') return wrap({ issues: [] })
  return wrap({})
}

const makeCastPayload = (count = 6, newCount = 2) => ({
  rationale: '本卷选角理由',
  cast: poolNames.slice(0, count).map((name, index) => ({
    name,
    roleInVolume: '本卷作用',
    fromChapter: 1 + index,
    importance: index === 0 ? '主角' : '配角',
  })),
  newCharacters: Array.from({ length: newCount }, (_, index) => ({
    name: `新角色${index + 1}`,
    role: '配角',
    description: `新角色${index + 1}的描述`,
    reason: '角色池缺少这类角色',
    firstChapter: 2 + index,
  })),
})

// ---------- 1) planVolumeCast：池选 ≤6、新角色 ≤2、写盘 ----------
castPayload = makeCastPayload(6, 2)
const planned = await service.planVolumeCast(project, { volumeId: 'vol-1', fromChapter: 1, toChapter: 10 })
assert.equal(planned.volumeId, 'vol-1')
assert.equal(planned.cast.length, CAST_LIMITS.volumeCast)
assert.ok(planned.cast.every((item) => poolNames.includes(item.name)), '阵容必须来自角色池')
assert.equal(planned.newCharacters.length, CAST_LIMITS.newNamedPerVolume)
const outlineCast = await readOutline()
assert.equal(outlineCast.volumes[0].cast.length, 6, '应写入 volume.cast')
assert.equal(outlineCast.volumes[0].castRationale, '本卷选角理由')
assert.ok(outlineCast.volumes[0].castPlannedAt)
const bibleAfterPlan = await service.readBible(project)
const newEntry = bibleAfterPlan.characters.find((character) => character.name === '新角色1')
assert.ok(newEntry, '新角色应登记进角色池')
assert.deepEqual(newEntry.meta, { status: '未登场', firstChapter: 2, importance: '配角' })
const castMember = bibleAfterPlan.characters.find((character) => character.name === '角色1')
assert.equal(castMember.meta.firstChapter, 1, '选中角色应补 firstChapter')

// ---------- 2) 超限截断 ----------
castPayload = makeCastPayload(9, 4)
const capped = await service.planVolumeCast(project, { volumeId: 'vol-1', fromChapter: 1, toChapter: 10 })
assert.equal(capped.cast.length, CAST_LIMITS.volumeCast, '阵容应截断到上限')
assert.equal(capped.newCharacters.length, CAST_LIMITS.newNamedPerVolume, '新增角色应截断到上限')

// ---------- 3) 池外名字 → 报错且不写盘 ----------
const beforeInvalid = JSON.stringify((await readOutline()).volumes[0].cast)
castPayload = { rationale: 'x', cast: [{ name: '池外角色', fromChapter: 1 }], newCharacters: [] }
await assert.rejects(() => service.planVolumeCast(project, { volumeId: 'vol-1', fromChapter: 1, toChapter: 10 }), /角色池外/)
assert.equal(JSON.stringify((await readOutline()).volumes[0].cast), beforeInvalid, '非法选角不应写盘')

// ---------- 4) 解析失败 → 报错且不写盘 ----------
castPayload = null
await assert.rejects(() => service.planVolumeCast(project, { volumeId: 'vol-1', fromChapter: 1, toChapter: 10 }), /无法解析/)
assert.equal(JSON.stringify((await readOutline()).volumes[0].cast), beforeInvalid)

// ---------- 5) outlineGenerate 无 cast → 自动选角；prompt 只含阵容内角色 ----------
await service.writeJson(project, 'story/plot/outline.json', { status: 'candidate', logline: '一句话', volumes: [baseVolume()] })
castPayload = makeCastPayload(6, 2)
castCalls = 0
generateCalls = 0
generatePayload = {
  chapters: [
    { number: 1, title: '第1章', synopsis: '角色1出场，展开第一个事件。', wordBudget: 3000, castUsed: ['角色1'], agency: { choice: '主角主动交涉', cost: '被跟踪' }, device: '交涉' },
    { number: 2, title: '第2章', synopsis: '角色2接手，局面变化。', wordBudget: 3000, castUsed: ['角色1'], agency: { choice: '主角主动交涉', cost: '被跟踪' }, device: '夜探' },
  ],
  castUsed: ['角色1', '角色2'],
  newNamed: [],
}
const generated = await service.outlineGenerate(project, { count: 2 })
assert.equal(castCalls, 1, '无 cast 时应自动选角一次')
assert.equal(generated.cast.names.length, 6)
assert.ok(capturedGeneratePrompt.includes('角色1'), '大纲 prompt 应含阵容角色')
assert.ok(capturedGeneratePrompt.includes('角色6'), '大纲 prompt 应含阵容角色')
for (const outside of ['角色7', '角色8', '角色9', '角色17']) {
  assert.equal(capturedGeneratePrompt.includes(outside), false, `大纲 prompt 不应含阵容外角色：${outside}`)
}
assert.ok(capturedGenerateSystem.includes('本卷阵容') || capturedGenerateSystem.includes('选角硬规则'), '大纲 system 应含选角规则')
assert.equal(generated.cast.warning, null)

// ---------- 6) 再生成复用已有 cast（不再调用选角） ----------
castCalls = 0
generatePayload = {
  chapters: [{ number: 3, title: '第3章', synopsis: '角色3推进事件。', wordBudget: 3000, castUsed: ['角色1'], agency: { choice: '主角主动交涉', cost: '被跟踪' }, device: '查账' }],
  castUsed: ['角色3'],
  newNamed: [],
}
await service.outlineGenerate(project, { fromChapter: 3, count: 1 })
assert.equal(castCalls, 0, '已有 cast 时不应重复选角')

// ---------- 7) newNamed 非空 → warning ----------
generatePayload = {
  chapters: [{ number: 4, title: '第4章', synopsis: '角色4遇到新角色X。', wordBudget: 3000, castUsed: ['角色1'], agency: { choice: '主角主动交涉', cost: '被跟踪' }, device: '交易' }],
  castUsed: ['角色4'],
  newNamed: ['新角色X'],
}
const warned = await service.outlineGenerate(project, { fromChapter: 4, count: 1 })
assert.ok(warned.cast.warning, '应返回 warning')
assert.ok(warned.cast.warning.includes('未登记'), 'warning 应说明未登记角色')
assert.deepEqual(warned.cast.newNamed, ['新角色X'])

// ---------- 8) cast-list / cast-update / novel_cast ----------
const listed = await service.listVolumeCast(project, { volumeId: 'vol-1' })
assert.equal(listed.cast.length, 6)
assert.deepEqual(listed.limits, { volumeCast: 6, namedExtrasPerVolume: 3, newNamedPerVolume: 2 })
const updated = await service.updateVolumeCast(project, {
  volumeId: 'vol-1',
  cast: [{ name: '角色1', roleInVolume: '主角', fromChapter: 1, importance: '主角' }, { name: '角色2', roleInVolume: '配角', fromChapter: 2, importance: '配角' }],
})
assert.equal(updated.cast.length, 2)
await assert.rejects(() => service.updateVolumeCast(project, { volumeId: 'vol-1', cast: [{ name: '池外角色' }] }), /角色池/)
await assert.rejects(() => service.updateVolumeCast(project, {
  volumeId: 'vol-1',
  cast: poolNames.slice(0, 7).map((name) => ({ name })),
}), /最多/)

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
for (const action of ['cast-list', 'cast-plan', 'cast-update']) {
  assert.ok(indexSource.includes(`case '${action}'`), `project-action 应包含 ${action}`)
}
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const tool = registered.find((item) => item.name === 'novel_cast')
assert.ok(tool, '应注册 novel_cast')
const toolList = await tool.execute({ action: 'list', volumeId: 'vol-1' }, { agent: project, signal: null })
assert.equal(toolList.cast.length, 2)
const toolUpdate = await tool.execute({
  action: 'update', volumeId: 'vol-1',
  cast: [{ name: '角色1', roleInVolume: '主角', fromChapter: 1, importance: '主角' }],
}, { agent: project, signal: null })
assert.equal(toolUpdate.cast.length, 1)


// ---------- 9) 空项目（无分卷）先 cast-plan：自动创建 vol-1，之后可继续大纲生成 ----------
await service.writeJson(project, 'story/plot/outline.json', { status: 'candidate', logline: '一句话', volumes: [] })
castPayload = makeCastPayload(6, 2)
const emptyPlanned = await service.planVolumeCast(project, { fromChapter: 1, toChapter: 10 })
assert.equal(emptyPlanned.volumeId, 'vol-1', '无卷时应创建 vol-1')
assert.equal(emptyPlanned.cast.length, 6, '空项目也应按上限选角')
const emptyOutline = await readOutline()
assert.equal(emptyOutline.volumes.length, 1, '应创建默认第一卷')
assert.equal(emptyOutline.volumes[0].id, 'vol-1')
assert.equal(emptyOutline.volumes[0].title, '第1卷')
assert.equal(emptyOutline.volumes[0].targetChapters, 10, 'targetChapters 应取 toChapter-fromChapter+1')
assert.equal(emptyOutline.volumes[0].cast.length, 6, '阵容应写入新卷')
generatePayload = {
  chapters: [{ number: 1, title: '第1章', synopsis: '角色1登场，展开事件。', wordBudget: 3000, castUsed: ['角色1'], agency: { choice: '主角主动交涉', cost: '被跟踪' }, device: '救人' }],
  castUsed: ['角色1'],
  newNamed: [],
}
castCalls = 0
const genAfterEmpty = await service.outlineGenerate(project, { fromChapter: 1, count: 1 })
assert.equal(genAfterEmpty.volumeId, 'vol-1', '大纲生成应复用新建的卷')
assert.equal(castCalls, 0, '已选角后生成不应重复选角')
assert.equal((await readOutline()).volumes.length, 1, '不应多出空卷')

// 空项目选角失败（池外名字）不应留下空卷
await service.writeJson(project, 'story/plot/outline.json', { status: 'candidate', logline: '一句话', volumes: [] })
castPayload = { rationale: 'x', cast: [{ name: '池外角色', fromChapter: 1 }], newCharacters: [] }
await assert.rejects(() => service.planVolumeCast(project, { fromChapter: 1, toChapter: 10 }), /角色池外/)
assert.equal((await readOutline()).volumes.length, 0, '失败路径不应留下空卷')

// ---------- 10) 三层角色：extras（具名龙套 ≤3） ----------
const makeCastWithExtras = (extrasCount = 2) => ({
  rationale: '含龙套的选角',
  cast: poolNames.slice(0, 6).map((name, index) => ({ name, roleInVolume: '本卷作用', fromChapter: 1 + index, importance: index === 0 ? '主角' : '配角' })),
  extras: poolNames.slice(6, 6 + extrasCount).map((name, index) => ({ name, roleInVolume: '信息源', fromChapter: 1 + index, note: '提供线索，不推动关键转折' })),
  newCharacters: [],
})
await service.writeJson(project, 'story/plot/outline.json', { status: 'candidate', logline: '一句话', volumes: [baseVolume()] })
castPayload = makeCastWithExtras(2)
const withExtras = await service.planVolumeCast(project, { volumeId: 'vol-1', fromChapter: 1, toChapter: 10 })
assert.equal(withExtras.cast.length, 6, '核心阵容应 ≤6')
assert.equal(withExtras.extras.length, 2, '应输出具名龙套')
assert.equal(withExtras.warning, null)
assert.equal(withExtras.limits.namedExtrasPerVolume, 3, 'limits 应含龙套上限')
const outlineExtras = await readOutline()
assert.equal(outlineExtras.volumes[0].extras.length, 2, 'extras 应写入 volume')
assert.ok(outlineExtras.volumes[0].extras[0].note.includes('不推动关键转折'), 'note 应说明不推动关键转折')
const bibleExtras = await service.readBible(project)
const extraEntry = bibleExtras.characters.find((character) => character.name === withExtras.extras[0].name)
assert.equal(extraEntry.meta.firstChapter, withExtras.extras[0].fromChapter, '龙套 meta.firstChapter 应补填')

// 10b) extras 超限截断；池外/与阵容重名跳过
castPayload = {
  rationale: 'x',
  cast: poolNames.slice(0, 6).map((name) => ({ name, fromChapter: 1 })),
  extras: [...poolNames.slice(6, 10), '池外角色'].map((name) => ({ name, roleInVolume: '信息源', fromChapter: 1, note: '不推动关键转折' })),
  newCharacters: [],
}
const cappedExtras = await service.planVolumeCast(project, { volumeId: 'vol-1', fromChapter: 1, toChapter: 10 })
assert.equal(cappedExtras.extras.length, 3, '龙套应截断到上限')
assert.ok(cappedExtras.warning && cappedExtras.warning.includes('截断'), '超限应返回 warning')
assert.ok(cappedExtras.extras.every((item) => poolNames.includes(item.name)), '龙套必须来自角色池')
assert.ok(cappedExtras.extras.every((item) => !cappedExtras.cast.some((castItem) => castItem.name === item.name)), '龙套不得与阵容重名')

// 10c) cast-update 同时更新 cast/extras 并校验
const updatedBoth = await service.updateVolumeCast(project, {
  volumeId: 'vol-1',
  cast: [{ name: '角色1' }, { name: '角色2' }],
  extras: [{ name: '角色7', roleInVolume: '信息源', fromChapter: 1, note: '不推动关键转折' }],
})
assert.equal(updatedBoth.cast.length, 2)
assert.equal(updatedBoth.extras.length, 1)
assert.equal(updatedBoth.limits.namedExtrasPerVolume, 3)
await assert.rejects(() => service.updateVolumeCast(project, { volumeId: 'vol-1', cast: [{ name: '角色1' }], extras: [{ name: '角色1' }] }), /重名/)
await assert.rejects(() => service.updateVolumeCast(project, { volumeId: 'vol-1', cast: [{ name: '角色1' }], extras: poolNames.slice(6, 10).map((name) => ({ name })) }), /最多/)
const listedBoth = await service.listVolumeCast(project, { volumeId: 'vol-1' })
assert.equal(listedBoth.extras.length, 1, 'cast-list 应返回 extras')
assert.equal(listedBoth.limits.namedExtrasPerVolume, 3)
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('volume cast tests passed')
