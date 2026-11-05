// 写作基础原则（doctrine）+ 角色生命周期 meta（schema v5）。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-doctrine-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-doctrine-project-'))
const legacy = await mkdtemp(join(tmpdir(), 'deepnovel-doctrine-legacy-'))
process.env.DSH_HOME = home

const doctrine = await import('../writing-doctrine.js')
const templates = await import('../templates.js')
const { NovelWriterService } = await import('../service.js')
const { DatabaseSync } = await import('node:sqlite')

// ---------- 1) doctrine 内容 ----------
assert.ok(doctrine.WRITING_DOCTRINE.includes('本轮用户明确要求优先'), '应含用户要求优先')
assert.ok(doctrine.WRITING_DOCTRINE.includes('不是本书事实'), '应含上下文≠事实')
assert.ok(doctrine.WRITING_DOCTRINE.includes('技能是写作方法，不是本书设定'), '应含技能≠设定')
assert.ok(doctrine.WRITING_DOCTRINE.includes('发现冲突先指出'), '应含冲突先指出+最小改动')
assert.ok(doctrine.WRITING_DOCTRINE.includes('不得新增未登记的命名角色'), '应含不新增未登记角色')
assert.ok(doctrine.WRITING_DOCTRINE.includes('不为凑爽点'), '应含负向约束')
assert.ok(doctrine.WRITING_DOCTRINE.length >= 600, 'doctrine 应有足够内容')
assert.ok(doctrine.CAST_RULES.includes('≤6'), 'CAST_RULES 应含本卷阵容上限')
assert.ok(doctrine.CAST_RULES.includes('≤2'), 'CAST_RULES 应含每卷新增上限')
assert.equal(doctrine.CAST_LIMITS.volumeCast, 6)
assert.equal(doctrine.CAST_LIMITS.newNamedPerVolume, 2)

// ---------- 2) composeWritingSystem 顺序与空行 ----------
const composed = doctrine.composeWritingSystem('DOCTRINE_A\n\n\n\nTASK_B', 'TASK_PROMPT')
assert.ok(composed.startsWith('DOCTRINE_A'), 'doctrine 应在最前')
assert.ok(composed.includes('TASK_PROMPT'))
assert.equal(composed.includes('\n\n\n'), false, '不应有连续空行')

// ---------- 3) service systemFor 前置 doctrine ----------
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
await service.initProject(project, { title: 'doctrine' })
for (const key of ['outline', 'draft', 'revise', 'fix', 'bible', 'bibleCharacters', 'premise']) {
  const system = await service.systemFor(project, key, `TASK_${key.toUpperCase()}`)
  assert.ok(system.includes('写作基础原则'), `${key} system 应含写作基础原则`)
  assert.ok(system.includes(`TASK_${key.toUpperCase()}`), `${key} 应保留任务提示词`)
  assert.ok(system.includes('选角规则'), `${key} system 应含选角规则`)
}
const reviewSystem = await service.systemFor(project, 'review', 'REVIEW_TASK')
assert.equal(reviewSystem.includes('写作基础原则'), false, '非写作类 system 不应注入 doctrine')
assert.ok(templates.BIBLE_SYSTEM_PROMPT.includes('meta'), '设定生成提示词应要求 meta')
assert.ok(templates.BIBLE_CHARACTERS_SYSTEM_PROMPT.includes('meta'), '角色生成提示词应要求 meta')

// ---------- 4) readBible 默认 meta / bibleCast / upsert meta ----------
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [
    { id: 'characters-01', name: '林昭', role: '主角', description: '主角描述' },
    { id: 'characters-02', name: '苏晚', role: '配角', description: '配角描述' },
    { id: 'characters-03', name: '反派', role: '对手', description: '对手描述' },
  ],
  locations: [],
  rules: [],
  factions: [],
  items: [],
})
const bible = await service.readBible(project)
assert.deepEqual(bible.characters[0].meta, { status: '未登场', firstChapter: null, importance: '配角' })
const cast = await service.bibleCast(project, ['林昭', '苏晚'])
assert.equal(cast.length, 2)
assert.ok(cast.every((character) => character.meta && character.meta.status === '未登场'))
assert.equal((await service.bibleCast(project)).length, 3, '无 names 返回全部角色')
const updatedEntry = await service.upsertBibleEntry(project, {
  category: 'characters',
  id: 'characters-01',
  fields: { meta: { status: '活跃', firstChapter: 1, importance: '主角' } },
})
assert.deepEqual(updatedEntry.meta, { status: '活跃', firstChapter: 1, importance: '主角' })
const roundTripBible = await service.readBible(project)
assert.deepEqual(roundTripBible.characters.find((character) => character.name === '林昭').meta, {
  status: '活跃',
  firstChapter: 1,
  importance: '主角',
})

// ---------- 5) schema v4 → v5 升级 + meta 往返 ----------
await mkdir(join(legacy, 'story'), { recursive: true })
const legacyDb = new DatabaseSync(join(legacy, 'story', 'project.db'))
legacyDb.exec(`
CREATE TABLE project (
  id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER, title TEXT, language TEXT,
  genre_json TEXT, logline TEXT, writing_notes TEXT, craft_auto INTEGER DEFAULT 1,
  prompt_json TEXT, automation_json TEXT, extra_json TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE bible_meta (id INTEGER PRIMARY KEY CHECK (id = 1), status TEXT, extra_json TEXT, updated_at TEXT);
CREATE TABLE bible_entries (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT, role TEXT, description TEXT,
  traits_json TEXT, goal TEXT, notes TEXT, sort_order INTEGER, updated_at TEXT
);
`)
legacyDb.prepare('INSERT INTO project (id, schema_version, title, language) VALUES (1, 4, ?, ?)').run('旧项目', 'zh')
legacyDb.prepare('INSERT INTO bible_meta (id, status, extra_json) VALUES (1, ?, ?)').run('confirmed', '{}')
legacyDb.prepare('INSERT INTO bible_entries (id, category, name, role, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('characters-01', 'characters', '林昭', '主角', '旧角色', 0)
legacyDb.exec('PRAGMA user_version = 4')
legacyDb.close()
const legacyStore = await service.storeFor(legacy)
assert.equal(legacyStore.schemaVersion(), 5, 'v4 旧库应升级到 v5')
const legacyBible = legacyStore.readBible()
assert.equal(legacyBible.characters.length, 1, '旧角色数据不丢')
assert.deepEqual(legacyBible.characters[0].meta, {}, '旧行 meta 默认 {}')
legacyBible.characters[0].meta = { status: '活跃', firstChapter: 3, importance: '核心' }
legacyStore.writeBible(legacyBible)
assert.deepEqual(legacyStore.readBible().characters[0].meta, { status: '活跃', firstChapter: 3, importance: '核心' }, 'meta 应可往返')
const legacyServiceBible = await service.readBible(legacy)
assert.deepEqual(legacyServiceBible.characters[0].meta, { status: '活跃', firstChapter: 3, importance: '核心' })

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
await rm(legacy, { recursive: true, force: true })
console.log('writing doctrine tests passed')
