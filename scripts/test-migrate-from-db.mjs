// 验证旧 SQLite 项目迁移到文件存储。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db.js'
import { NovelStore } from '../store.js'
import { migrateProjectDb } from '../migrate-from-db.js'
import { FileNovelStore } from '../file-store.js'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-migrate-'))
mkdirSync(join(root, 'story'), { recursive: true })
const db = openDatabase(join(root, 'story', 'project.db'))
const old = new NovelStore(db, root)

old.writeProject({ title: '迁移测试', language: 'zh', writingNotes: '白描' })
old.writePremise({ status: 'confirmed', candidates: [{ id: 'c1' }], chosen: { id: 'c1' } })
old.writeStyleContract({ status: 'confirmed', fields: { pov: 'third-limited' } })
old.writeBible({ status: 'confirmed', characters: [{ id: 'ch-1', name: '角色甲' }] })
old.writeRelations({ relations: [{ from: '角色甲', to: '角色乙', type: '师徒' }] })
old.writeOutline({ status: 'confirmed', volumes: [{ id: 'v1', title: '卷一', chapters: [{ id: 'c1', number: 1, title: '第一章' }] }] })
old.writeChapterMeta(1, { chapterId: 'c1', title: '第一章', wordCount: 800 })
old.writeChapterQa(1, { qa: { issues: [] } })
old.writeChapterState(1, { chapterId: 'c1', title: '第一章' })
old.writeChapterSummary(1, { summary: '本章摘要' })
old.setChapterProseFlags(1, { hasDraft: true })
const material = old.saveMaterial({ content: '素材内容', kind: '片段' })
old.saveFact({ key: '夜之城', value: 'Night City', kind: '术语' })
old.saveRun({ runId: 'r1', kind: 'draft', number: 1 })
old.appendStatsEvent({ date: '2026-01-01', number: 1, words: 800 })
old.writePromptOverride('draft', '自定义提示词')
db.close()
assert.ok(existsSync(join(root, 'story', 'project.db')))

const result = migrateProjectDb(root)
assert.equal(result.migrated, true)
assert.equal(existsSync(join(root, 'story', 'project.db')), false, '迁移后旧库改名')
assert.ok(existsSync(join(root, 'story', 'project.db.migrated')))

const next = new FileNovelStore(root)
assert.equal(next.readProject().title, '迁移测试')
assert.equal(next.readPremise().status, 'confirmed')
assert.equal(next.readStyleContract().fields.pov, 'third-limited')
assert.equal(next.readBible().characters[0].name, '角色甲')
assert.equal(next.readRelations().relations[0].type, '师徒')
assert.equal(next.readOutline().volumes[0].chapters[0].title, '第一章')
assert.equal(next.readChapterMeta(1).wordCount, 800)
assert.deepEqual(next.readChapterQa(1).qa, { issues: [] })
assert.equal(next.readChapterState(1).chapterId, 'c1')
assert.equal(next.readChapterSummary(1).summary, '本章摘要')
assert.equal(next.listChapterProseFlags().get(1).hasDraft, true)
assert.equal(next.listMaterials()[0].id, material.id)
assert.equal(next.listFacts()[0].key, '夜之城')
assert.equal(next.listRuns(5)[0].runId, 'r1')
assert.equal(next.readStats().events[0].words, 800)
assert.equal(next.readPromptOverrides().draft.text, '自定义提示词')

// 再次调用应跳过
assert.equal(migrateProjectDb(root).migrated, false)
await rm(root, { recursive: true, force: true })
console.log('migrate-from-db tests passed')
