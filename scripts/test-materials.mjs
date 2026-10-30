// 素材库：schema v3 迁移、CRUD、校验、助手查询、导出。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-materials-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-materials-project-'))
const legacyProject = await mkdtemp(join(tmpdir(), 'deepnovel-materials-legacy-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { DatabaseSync } = await import('node:sqlite')
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
}
const service = new NovelWriterService({ fs: fsCtx, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } })

// ---------- 1) v2 旧库升级 v3：materials 表可用、旧数据不丢 ----------
await mkdir(join(legacyProject, 'story'), { recursive: true })
const legacyDb = new DatabaseSync(join(legacyProject, 'story', 'project.db'))
legacyDb.exec(`
CREATE TABLE project (
  id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER, title TEXT, language TEXT,
  genre_json TEXT, logline TEXT, writing_notes TEXT, craft_auto INTEGER DEFAULT 1,
  prompt_json TEXT, automation_json TEXT, extra_json TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE chapter_meta (
  number INTEGER PRIMARY KEY, json TEXT, status TEXT, word_count INTEGER,
  outline_hash TEXT, has_draft INTEGER DEFAULT 0, has_final INTEGER DEFAULT 0, updated_at TEXT
);
`)
legacyDb.prepare('INSERT INTO project (id, schema_version, title, language) VALUES (1, 2, ?, ?)').run('旧项目', 'zh')
legacyDb.prepare('INSERT INTO chapter_meta (number, json, status) VALUES (1, ?, ?)').run(JSON.stringify({ number: 1, title: '旧章' }), 'drafted')
legacyDb.exec('PRAGMA user_version = 2')
legacyDb.close()
const legacyStore = await service.storeFor(legacyProject)
assert.equal(legacyStore.schemaVersion(), 3, '旧库应升级到 v3')
assert.equal(legacyStore.readProject().title, '旧项目', '旧项目数据应保留')
assert.equal(legacyStore.readChapterMeta(1).title, '旧章', '旧章节数据应保留')
const legacyMaterial = legacyStore.saveMaterial({ content: '升级后写入的素材' })
assert.ok(legacyMaterial.id.startsWith('mat-'), '升级后 materials 表应可用')
assert.equal(legacyStore.listMaterials().length, 1)

// ---------- 2) CRUD：id 生成、title 兜底、kind 缺省、tags 去重 ----------
await service.initProject(project, { title: '素材测试' })
const created = await service.materialSave(project, {
  content: '第一行标题\n正文内容',
  tags: ['参考', '参考', '片段'],
})
assert.ok(created.id.startsWith('mat-'), '无 id 应生成 mat-*')
assert.equal(created.title, '第一行标题', 'title 缺省取 content 首行')
assert.equal(created.kind, '其他', 'kind 缺省其他')
assert.deepEqual(created.tags, ['参考', '片段'], 'tags 应去重')
const listed = await service.materialsList(project)
assert.equal(listed.materials.length, 1)
assert.equal(listed.materials[0].id, created.id)
const updated = await service.materialSave(project, {
  id: created.id,
  title: '改后的标题',
  kind: '桥段',
  content: '新内容',
  tags: ['场景'],
})
assert.equal(updated.title, '改后的标题')
assert.equal(updated.kind, '桥段')
assert.equal(updated.tags[0], '场景')
assert.equal((await service.materialsList(project)).materials.length, 1, '同 id 更新不应新增')

// 校验
await assert.rejects(() => service.materialSave(project, { content: '   ' }), /素材内容不能为空/)
await assert.rejects(() => service.materialDelete(project, { id: 'no-such' }), /找不到素材/)
const longTitle = await service.materialSave(project, { title: '长'.repeat(200), content: 'x' })
assert.ok(longTitle.title.length <= 120, 'title 应截断到 120')
const manyTags = await service.materialSave(project, { content: 'tag 测试', tags: Array.from({ length: 20 }, (_, index) => `t${index}`) })
assert.ok(manyTags.tags.length <= 10, 'tags 最多 10 个')
const badKind = await service.materialSave(project, { content: 'kind 测试', kind: '非法类型' })
assert.equal(badKind.kind, '其他', '非法 kind 回退其他')

// 删除
const deleted = await service.materialDelete(project, { id: created.id })
assert.deepEqual(deleted, { id: created.id, deleted: true })
assert.equal((await service.materialsList(project)).materials.length, 3, '删除后应少一条')

// ---------- 3) 助手查询：kind=materials（keyword/limit/content 截断 400） ----------
await service.materialSave(project, {
  title: '雨夜素材',
  kind: '片段',
  content: '破庙里遇到神秘人，对方留下半块玉佩。'.repeat(30),
  tags: ['场景', '雨夜'],
})
const byKeyword = await service.queryProjectData(project, { kind: 'materials', keyword: '玉佩' })
assert.ok(byKeyword.materials.length >= 1, 'keyword 应命中 content')
assert.ok(byKeyword.materials.every((item) => item.content.length <= 400), 'content 应截断 400')
assert.equal(byKeyword.materials[0].title, '雨夜素材')
const byTag = await service.queryProjectData(project, { kind: 'materials', keyword: '雨夜' })
assert.ok(byTag.materials.some((item) => item.title === '雨夜素材'), 'keyword 应命中 tags')
const limited = await service.queryProjectData(project, { kind: 'materials', limit: 1 })
assert.equal(limited.materials.length, 1, 'limit 生效')
const all = await service.queryProjectData(project, { kind: 'materials' })
assert.ok(all.materials.length >= 3, '默认返回全部素材')

// ---------- 4) 导出包含 materials；快照复制 story/ 自然包含 ----------
const exported = await service.exportFileProject(project)
const exportedMaterials = JSON.parse(await readFile(join(project, exported.path, 'story', 'materials.json'), 'utf8'))
assert.ok(Array.isArray(exportedMaterials.materials))
assert.ok(exportedMaterials.materials.some((item) => item.title === '雨夜素材'), '导出应包含素材库')
const snapshot = await service.createProjectSnapshot(project)
assert.ok(snapshot.name)
assert.ok(await stat(join(project, snapshot.path, 'story', 'project.db')).then(() => true).catch(() => false), '快照应包含 story/project.db')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
await rm(legacyProject, { recursive: true, force: true })
console.log('materials tests passed')
