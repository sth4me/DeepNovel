// SQLite 数据层（Phase 0）：schema、CRUD、多卷大纲 move、FTS 检索、迁移、事务回滚。
// 使用真实 node:sqlite + 临时目录，不做 stub。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, SCHEMA_VERSION, transaction } from '../db.js'
import { NovelStore } from '../store.js'
import { migrateLegacyProject } from '../migrate.js'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-store-'))
await mkdir(join(root, 'story'), { recursive: true })
const dbPath = join(root, 'story', 'project.db')
const db = openDatabase(dbPath)
const store = new NovelStore(db, root)

// 1) schema：表 + FTS + user_version
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
for (const name of [
  'project', 'premise', 'style_contract', 'style_templates', 'bible_meta', 'bible_entries',
  'relations', 'relation_positions', 'power', 'volumes', 'outline_chapters', 'outline_meta',
  'chapter_meta', 'chapter_qa', 'chapter_state', 'chapter_summary', 'stats_events', 'runs',
  'prompt_overrides', 'notes', 'fts_chapters', 'fts_outline', 'fts_bible', 'fts_summaries',
]) {
  assert.ok(tables.includes(name), `缺少表：${name}`)
}
assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION)

// 2) 项目：写入/浅合并读回，models/context 等 extra 字段不丢
store.writeProject({
  schemaVersion: 1,
  layoutVersion: 1,
  title: '测试书',
  language: 'zh',
  presetId: 'novel-writer',
  autoFix: false,
  models: { draft: { provider: 'p', model: 'm' } },
  context: { recentStateChapters: 1 },
  automation: { autoFix: false, fixRounds: 2 },
  createdAt: '2026-01-01T00:00:00.000Z',
})
let project = store.readProject()
assert.equal(project.title, '测试书')
assert.equal(project.layoutVersion, 1)
assert.equal(project.autoFix, false)
assert.deepEqual(project.models, { draft: { provider: 'p', model: 'm' } })
assert.deepEqual(project.context, { recentStateChapters: 1 })
assert.deepEqual(store.readAutomation(), { autoFix: false, fixRounds: 2 })
store.writeAutomation({ autoFix: true })
assert.equal(store.readAutomation().autoFix, true)
store.writeProjectPrompt({ enabled: true, text: ' 注入 ' })
assert.equal(store.readProjectPrompt().text, ' 注入 ')
store.writeProject({ title: '改名' })
project = store.readProject()
assert.equal(project.title, '改名')
assert.deepEqual(project.models, { draft: { provider: 'p', model: 'm' } }, '浅合并不应丢 models')

// 3) 构思 / 文风 / 模板
store.writePremise({
  status: 'confirmed',
  candidates: [{ id: 'c1', title: 'a' }, { id: 'c2', title: 'b' }],
  chosen: { id: 'c1', title: 'a' },
  chosenHash: 'hash',
  confirmedAt: '2026-01-02T00:00:00.000Z',
})
let premise = store.readPremise()
assert.equal(premise.status, 'confirmed')
assert.equal(premise.candidates.length, 2)
assert.equal(premise.chosen.title, 'a')
assert.equal(premise.confirmedAt, '2026-01-02T00:00:00.000Z')

store.writeStyleContract({ status: 'confirmed', templateId: 't1', fields: { pov: 'third-limited' }, samples: ['样本'], fieldsHash: 'fh' })
assert.deepEqual(store.readStyleContract().fields, { pov: 'third-limited' })
assert.deepEqual(store.readStyleContract().samples, ['样本'])
store.saveStyleTemplate({ id: 'user-1', name: '我的模板', group: '自定义', tags: ['x'], description: 'd', fields: { pov: 'first' }, samples: [] })
assert.equal(store.listStyleTemplates().length, 1)
assert.deepEqual(store.listStyleTemplates()[0].fields, { pov: 'first' })
store.deleteStyleTemplate('user-1')
assert.equal(store.listStyleTemplates().length, 0)

// 4) 设定 / 关系 / 能力
store.writeBible({
  status: 'confirmed',
  confirmedAt: '2026-01-03T00:00:00.000Z',
  characters: [{ id: 'C#01', name: '林昭', role: '主角', description: '剑客', traits: ['谨慎', '多疑'], goal: '查案' }],
  locations: [{ id: 'W#01', name: '破庙', description: '荒庙' }],
  rules: [], factions: [], items: [],
  updatedAt: '2026-01-03T00:00:00.000Z',
})
const bible = store.readBible()
assert.equal(bible.status, 'confirmed')
assert.equal(bible.confirmedAt, '2026-01-03T00:00:00.000Z')
assert.equal(bible.characters[0].name, '林昭')
assert.deepEqual(bible.characters[0].traits, ['谨慎', '多疑'])
assert.equal(bible.locations[0].name, '破庙')

store.writeRelations({
  status: 'confirmed',
  relations: [{ from: '林昭', to: '神秘人', type: '旧识', note: 'n' }],
  positions: { 林昭: { x: 1, y: 2 } },
  updatedAt: '2026-01-04T00:00:00.000Z',
})
const relations = store.readRelations()
assert.equal(relations.status, 'confirmed')
assert.equal(relations.relations[0].from, '林昭')
assert.deepEqual(relations.positions['林昭'], { x: 1, y: 2 })
assert.equal(relations.updatedAt, '2026-01-04T00:00:00.000Z')

store.writePower({ status: 'confirmed', system: { tiers: [] }, characters: [], chapterChanges: {}, updatedAt: '2026-01-04T00:00:00.000Z' })
assert.deepEqual(store.readPower().system, { tiers: [] })

// 5) 大纲：多卷写入 / 章节 move / 删除卷
const outline = {
  status: 'candidate',
  logline: '一句话',
  volumes: [
    {
      id: 'v1', title: '第一卷', map: '山', goal: 'g1', powerCeiling: '筑基', exitCriteria: 'e1', targetChapters: 2,
      chapters: [
        {
          id: 'c1', number: 1, title: '雨夜', synopsis: '破庙里遇到神秘人', status: 'confirmed', wordBudget: 3000,
          inputs: { premise: 'h' }, plant: ['玉佩'], payoff: [],
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', editedAt: '2026-01-05T00:00:00.000Z',
        },
        { id: 'c2', number: 2, title: '进城', synopsis: '进城', status: 'candidate', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
      ],
    },
    {
      id: 'v2', title: '第二卷', map: '城', goal: 'g2', powerCeiling: '金丹', exitCriteria: 'e2', targetChapters: 1,
      chapters: [
        { id: 'c3', number: 3, title: '风波', synopsis: '风波', status: 'candidate', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
      ],
    },
  ],
  updatedAt: '2026-01-05T00:00:00.000Z',
}
store.writeOutline(outline)
let outlineRead = store.readOutline()
assert.equal(outlineRead.volumes.length, 2)
assert.equal(outlineRead.volumes[0].chapters.length, 2)
assert.equal(outlineRead.volumes[1].chapters[0].number, 3)
assert.equal(outlineRead.volumes[0].powerCeiling, '筑基')
assert.equal(outlineRead.volumes[0].chapters[0].editedAt, '2026-01-05T00:00:00.000Z', '章节未知字段应保留在 extra')

const moved = JSON.parse(JSON.stringify(outline))
const secondChapter = moved.volumes[0].chapters.pop()
moved.volumes[1].chapters.push(secondChapter)
store.writeOutline(moved)
outlineRead = store.readOutline()
assert.equal(outlineRead.volumes[0].chapters.length, 1)
assert.equal(outlineRead.volumes[1].chapters.length, 2)
assert.equal(outlineRead.volumes[1].chapters.find((chapter) => chapter.id === 'c2').number, 2)

const removedVolume = JSON.parse(JSON.stringify(moved))
removedVolume.volumes = [removedVolume.volumes[1]]
store.writeOutline(removedVolume)
outlineRead = store.readOutline()
assert.equal(outlineRead.volumes.length, 1)
assert.equal(outlineRead.volumes[0].chapters.length, 2)

// 6) 章节 meta / qa / state / summary
store.writeChapterMeta(1, {
  chapterId: 'c1', number: 1, title: '雨夜', status: 'approved', wordCount: 120,
  outlineHash: 'oh', inputs: { premise: 'h' }, approvedAt: '2026-01-06T00:00:00.000Z',
  updatedAt: '2026-01-06T00:00:00.000Z',
})
assert.equal(store.readChapterMeta(1).wordCount, 120)
assert.equal(store.readChapterMeta(1).outlineHash, 'oh')
store.writeChapterQa(1, { qa: { status: 'pass', issues: [] }, styleQa: { score: 80 }, continuity: { status: 'pass', issues: [] } })
const qa = store.readChapterQa(1)
assert.equal(qa.qa.status, 'pass')
assert.equal(qa.styleQa.score, 80)
assert.equal(store.readChapterQa(2).qa, null)
store.writeChapterState(1, { chapterId: 'c1', number: 1, title: '雨夜', outline: { id: 'c1' }, meta: { wordCount: 120 }, summary: '摘要', approvedAt: '2026-01-06T00:00:00.000Z' })
assert.equal(store.readChapterState(1).summary, '摘要')
assert.equal(store.listChapterStates().length, 1)
const stateIndex = store.readStateIndex()
assert.equal(stateIndex.chapters.length, 1)
assert.equal(stateIndex.chapters[0].number, 1)
assert.equal(stateIndex.chapters[0].wordCount, 120)
store.writeChapterSummary(1, {
  number: 1, summary: '林昭在破庙里遇到神秘人，得到半块玉佩。', characters: ['林昭'],
  events: ['遇袭'], openThreads: [], generatedAt: '2026-01-06T00:00:00.000Z',
})
assert.equal(store.readChapterSummary(1).summary, '林昭在破庙里遇到神秘人，得到半块玉佩。')
assert.equal(store.listChapterSummaries().length, 1)

// 7) 统计 / 运行记录 / 提示词覆盖 / 备注
store.appendStatsEvent({ date: '2026-01-06', number: 1, words: 120, action: 'draft', time: 't1' })
store.appendStatsEvent({ date: '2026-01-07', number: 2, words: 200, action: 'approve', time: 't2' })
const stats = store.readStats()
assert.equal(stats.events.length, 2)
assert.equal(stats.events[0].action, 'draft')
assert.ok(stats.updatedAt)

store.saveRun({ runId: 'run-1', kind: 'chapter.draft', task: 'draft', number: 1, output: 'x', createdAt: '2026-01-06T00:00:00.000Z' })
assert.equal(store.readRun('run-1').kind, 'chapter.draft')
assert.equal(store.listRuns(5)[0].runId, 'run-1')
store.writePromptOverride('premise', { text: ' 覆盖 ', baseHash: 'h', baseRevision: 1 })
assert.equal(store.readPromptOverrides().premise.text, '覆盖')
assert.equal(store.readPromptOverrides().premise.baseRevision, 1)
store.deletePromptOverride('premise')
assert.equal(store.readPromptOverrides().premise, undefined)
store.appendNote({ chapter: 1, text: { conclusion: '结论', suggestions: ['s'] }, source: 'legacy' })
store.appendNote({ chapter: 1, text: '纯文本备注', source: 'manual' })
const notes = store.listNotes(1)
assert.equal(notes.notes.length, 2)
assert.equal(notes.notes[0].conclusion, '结论')
assert.equal(notes.notes[1].text, '纯文本备注')

// 8) FTS：reindexAll 读正文、3 字 FTS 检索、2 字 LIKE 兜底
await mkdir(join(root, 'story', 'chapters', '001'), { recursive: true })
await mkdir(join(root, 'story', 'chapters', '002'), { recursive: true })
await writeFile(join(root, 'story', 'chapters', '001', 'final.md'), '林昭在雨夜的破庙里遇到神秘人，对方留下半块玉佩。', 'utf8')
await writeFile(join(root, 'story', 'chapters', '002', 'draft.md'), '第二日清晨，林昭进城寻找线索。', 'utf8')
// 恢复包含 1/2/3 章的原始大纲，供 reindexAll 遍历
store.writeOutline(outline)
const ftsCounts = await store.reindexAll()
assert.equal(ftsCounts.chapters, 3, '按大纲章数建 FTS')
assert.equal(ftsCounts.outline, 3)
assert.equal(ftsCounts.bible, 2)
assert.equal(ftsCounts.summaries, 1)

const hit3 = store.search('破庙里', { limit: 10 })
assert.ok(hit3.results.length > 0, '3 字应命中')
assert.ok(hit3.results.some((item) => item.type === 'chapter' && item.snippet.includes('[破庙里]')))
assert.ok(hit3.results.some((item) => item.type === 'outline'))
assert.ok(hit3.results.some((item) => item.type === 'summary'))
console.log('  snippet(3字/FTS):', JSON.stringify(hit3.results[0].snippet))

const hit2 = store.search('破庙', { limit: 10 })
assert.ok(hit2.results.length > 0, '2 字应走 LIKE 兜底')
assert.ok(hit2.results.some((item) => item.type === 'chapter'))
assert.ok(hit2.results.some((item) => item.entryId || item.type === 'outline'))
console.log('  snippet(2字/LIKE):', JSON.stringify(hit2.results[0].snippet))

// 9) 删除章节行同时清 FTS
store.deleteChapterRows(1)
assert.equal(store.readChapterMeta(1), null)
assert.equal(store.readChapterQa(1).qa, null)
assert.equal(store.readChapterState(1), null)
assert.equal(store.readChapterSummary(1), null)
assert.equal(store.search('破庙里', { limit: 10 }).results.some((item) => item.type === 'chapter' && item.number === 1), false)

// 10) 事务回滚：writeOutline 内部 UNIQUE 冲突 → 原有大纲不变
const beforeRollback = store.readOutline()
const brokenOutline = JSON.parse(JSON.stringify(outline))
brokenOutline.volumes[0].chapters.push({ ...brokenOutline.volumes[0].chapters[0], id: 'duplicate-number' })
assert.throws(() => store.writeOutline(brokenOutline), /UNIQUE|constraint/i)
const afterRollback = store.readOutline()
assert.deepEqual(afterRollback.volumes.map((volume) => volume.id), beforeRollback.volumes.map((volume) => volume.id))
assert.equal(afterRollback.volumes[0].chapters.length, beforeRollback.volumes[0].chapters.length)
assert.equal(afterRollback.updatedAt, beforeRollback.updatedAt)

// 11) 事务回滚：外层 transaction 手动抛错
const beforeProjectTitle = store.readProject().title
assert.throws(() => transaction(db, () => {
  store.writeProject({ title: '不应保存' })
  throw new Error('boom')
}), /boom/)
assert.equal(store.readProject().title, beforeProjectTitle)

store.close()
await rm(root, { recursive: true, force: true })

// 12) 迁移：旧 JSON 目录 → SQLite（含坏文件跳过、第二次 migrated:false）
const migrationRoot = await mkdtemp(join(tmpdir(), 'deepnovel-migrate-'))
const mStory = join(migrationRoot, 'story')
await mkdir(join(mStory, 'chapters', '001'), { recursive: true })
await mkdir(join(mStory, 'state'), { recursive: true })
await mkdir(join(mStory, 'style', 'templates'), { recursive: true })
await mkdir(join(mStory, 'bible'), { recursive: true })
await mkdir(join(mStory, 'plot'), { recursive: true })
await mkdir(join(mStory, 'prompts'), { recursive: true })
await mkdir(join(migrationRoot, '.dsh-writing', 'runs'), { recursive: true })
await mkdir(join(migrationRoot, '.dsh-writing', 'notes'), { recursive: true })

const writeJson = (relativePath, value) => writeFile(join(migrationRoot, relativePath), JSON.stringify(value), 'utf8')
await writeJson('story/project.json', {
  schemaVersion: 1, layoutVersion: 1, title: '旧书', language: 'zh',
  models: { draft: { provider: 'p', model: 'm' } }, context: { recentStateChapters: 2 },
  automation: { autoFix: true }, createdAt: '2026-01-01T00:00:00.000Z',
})
await writeJson('story/premise.json', { status: 'confirmed', candidates: [{ id: 'c1' }], chosen: { id: 'c1', title: '旧构思' }, chosenHash: 'h' })
await writeJson('story/style/contract.json', { status: 'confirmed', templateId: null, fields: { pov: 'first' }, samples: [], updatedAt: '2026-01-02T00:00:00.000Z' })
await writeJson('story/style/templates/user-1.json', { id: 'user-1', name: '旧模板', fields: { pov: 'third' }, samples: [], createdAt: '2026-01-02T00:00:00.000Z' })
await writeJson('story/bible/index.json', {
  status: 'confirmed', confirmedAt: '2026-01-03T00:00:00.000Z',
  characters: [{ id: 'C#01', name: '林昭', role: '主角', description: '破庙里的剑客', traits: ['谨慎'], goal: '查案' }],
  locations: [{ id: 'W#01', name: '破庙', description: '荒庙' }],
  rules: [], factions: [], items: [], updatedAt: '2026-01-03T00:00:00.000Z',
})
await writeJson('story/bible/relations.json', { status: 'confirmed', relations: [{ from: '林昭', to: '神秘人', type: '旧识', note: '' }], positions: {}, updatedAt: '2026-01-03T00:00:00.000Z' })
await writeJson('story/power.json', { schemaVersion: 1, status: 'confirmed', system: { tiers: [] }, characters: [], chapterChanges: {}, updatedAt: '2026-01-03T00:00:00.000Z' })
await writeJson('story/plot/outline.json', {
  status: 'confirmed', logline: '旧一句话',
  volumes: [
    { id: 'v1', title: '第一卷', map: '山', goal: 'g', powerCeiling: '筑基', exitCriteria: 'e', targetChapters: 2, chapters: [
      { id: 'c1', number: 1, title: '雨夜', synopsis: '破庙里遇到神秘人', status: 'confirmed', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
      { id: 'c2', number: 2, title: '进城', synopsis: '进城', status: 'candidate', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
    ] },
    { id: 'v2', title: '第二卷', map: '城', goal: 'g2', powerCeiling: '金丹', exitCriteria: 'e2', targetChapters: 1, chapters: [
      { id: 'c3', number: 3, title: '风波', synopsis: '风波', status: 'candidate', wordBudget: 3000, inputs: {}, plant: [], payoff: [] },
    ] },
  ],
  updatedAt: '2026-01-05T00:00:00.000Z',
})
await writeFile(join(mStory, 'chapters', '001', 'meta.json'), JSON.stringify({ chapterId: 'c1', number: 1, title: '雨夜', status: 'approved', wordCount: 120, updatedAt: '2026-01-06T00:00:00.000Z' }), 'utf8')
await writeFile(join(mStory, 'chapters', '001', 'qa.json'), JSON.stringify({ status: 'pass', issues: [] }), 'utf8')
await writeFile(join(mStory, 'chapters', '001', 'style-qa.json'), JSON.stringify({ score: 82 }), 'utf8')
await writeFile(join(mStory, 'chapters', '001', 'continuity.json'), JSON.stringify({ status: 'pass', issues: [] }), 'utf8')
await writeFile(join(mStory, 'chapters', '001', 'summary.json'), JSON.stringify({ number: 1, summary: '旧摘要：破庙里遇到神秘人。', characters: ['林昭'], events: ['遇袭'], openThreads: [], generatedAt: '2026-01-06T00:00:00.000Z' }), 'utf8')
await writeFile(join(mStory, 'chapters', '001', 'final.md'), '林昭在雨夜的破庙里遇到神秘人，对方留下半块玉佩。', 'utf8')
await writeJson('story/state/index.json', { chapters: [{ id: 'c1', number: 1, title: '雨夜', status: 'approved', wordCount: 120, summary: '旧摘要', approvedAt: '2026-01-06T00:00:00.000Z', finalPath: 'story/chapters/001/final.md' }], updatedAt: '2026-01-09T00:00:00.000Z' })
await writeJson('story/state/001.json', { chapterId: 'c1', number: 1, title: '雨夜', outline: { id: 'c1' }, meta: { wordCount: 120 }, summary: '旧摘要', approvedAt: '2026-01-06T00:00:00.000Z' })
await writeFile(join(mStory, 'stats.json'), '{ 这不是合法 JSON', 'utf8') // 坏文件：迁移应跳过并记录
await writeJson('story/prompts/system.json', { version: 2, overrides: { premise: { text: '旧覆盖', baseHash: 'h', baseRevision: 1 } } })
await writeJson('.dsh-writing/runs/run-1.json', { runId: 'run-1', kind: 'chapter.draft', createdAt: '2026-01-06T00:00:00.000Z', output: 'x' })
await writeJson('.dsh-writing/notes/chapter-1.json', { notes: [{ conclusion: '旧结论', suggestions: [], todos: [], risks: [] }] })

const migration = await migrateLegacyProject({ projectRoot: migrationRoot })
assert.equal(migration.migrated, true)
assert.ok(migration.skipped.includes('story/stats.json'), `坏文件应跳过：${migration.skipped.join(',')}`)
assert.equal(migration.counts.project, 1)
assert.equal(migration.counts.premise, 1)
assert.equal(migration.counts.style, 1)
assert.equal(migration.counts.styleTemplates, 1)
assert.equal(migration.counts.bibleEntries, 2)
assert.equal(migration.counts.relations, 1)
assert.equal(migration.counts.power, 1)
assert.equal(migration.counts.volumes, 2)
assert.equal(migration.counts.chapters, 3)
assert.equal(migration.counts.chapterMeta, 1)
assert.equal(migration.counts.chapterQa, 1)
assert.equal(migration.counts.chapterState, 1)
assert.equal(migration.counts.chapterSummary, 1)
assert.equal(migration.counts.statsEvents, 0)
assert.equal(migration.counts.runs, 1)
assert.equal(migration.counts.promptOverrides, 1)
assert.equal(migration.counts.notes, 1)

const migratedDb = openDatabase(join(mStory, 'project.db'))
const migratedStore = new NovelStore(migratedDb, migrationRoot)
assert.equal(migratedStore.readProject().title, '旧书')
assert.deepEqual(migratedStore.readProject().models, { draft: { provider: 'p', model: 'm' } })
assert.deepEqual(migratedStore.readProject().context, { recentStateChapters: 2 })
assert.equal(migratedStore.readOutline().volumes.length, 2)
assert.equal(migratedStore.readOutline().volumes[0].chapters.length, 2)
assert.equal(migratedStore.readChapterMeta(1).wordCount, 120)
assert.equal(migratedStore.readChapterQa(1).styleQa.score, 82)
assert.equal(migratedStore.readChapterSummary(1).summary, '旧摘要：破庙里遇到神秘人。')
assert.equal(migratedStore.readStateIndex().updatedAt, '2026-01-09T00:00:00.000Z')
assert.equal(migratedStore.readPromptOverrides().premise.text, '旧覆盖')
assert.equal(migratedStore.listNotes(1).notes[0].conclusion, '旧结论')
assert.equal(migratedStore.ftsRowCounts().chapters, 3)
assert.equal(migratedStore.ftsRowCounts().bible, 2)
const migratedHit = migratedStore.search('破庙里', { limit: 5 })
assert.ok(migratedHit.results.some((item) => item.type === 'chapter' && item.number === 1))
console.log('  snippet(迁移后):', JSON.stringify(migratedHit.results[0].snippet))
migratedStore.close()

const secondMigration = await migrateLegacyProject({ projectRoot: migrationRoot })
assert.equal(secondMigration.migrated, false, 'DB 已存在时不重复迁移')
await rm(migrationRoot, { recursive: true, force: true })

console.log('store tests passed')
