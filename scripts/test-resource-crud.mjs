// 资源级联与批量 CRUD：关系单边、设定删除清理、素材/资料批量删除、删章清理提案。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile, stat as fsStat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-crud-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-crud-project-'))
process.env.DSH_HOME = home

const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await fsStat(abs(target))
      return { version: String(info.size) }
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

const { NovelWriterService } = await import('../service.js')
const service = new NovelWriterService({
  fs: fsCtx,
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
})
await service.initProject(project, { title: 'CRUD 测试' })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '沈砚' }, { id: 'c2', name: '阿罗' }],
  locations: [], rules: [], factions: [], items: [],
})

// 关系单边增删
await service.upsertRelation(project, { from: '沈砚', to: '阿罗', type: '保护', note: '主从' })
await service.upsertRelation(project, { from: '沈砚', to: '阿罗', type: '保护', note: '师徒' })
let relations = (await service.readRelations(project)).relations
assert.equal(relations.length, 1, '同 from/to/type 应更新而不是重复')
assert.equal(relations[0].note, '师徒')
await service.removeRelation(project, { from: '沈砚', to: '阿罗', type: '保护' })
assert.equal((await service.readRelations(project)).relations.length, 0, '可删除单条关系')

// 删除设定条目并清理关系/术语
await service.upsertRelation(project, { from: '沈砚', to: '阿罗', type: '保护' })
await service.saveFact(project, { kind: '称呼', key: '阿罗', value: '哑女' })
const removed = await service.deleteBibleEntry(project, { category: 'characters', id: 'c2', cleanup: true })
assert.equal(removed.deleted, 'c2')
assert.ok(removed.cleanup.relations >= 1, '应清理涉及该角色的关系')
const bible = await service.readBible(project)
assert.ok(!bible.characters.some((item) => item.id === 'c2'))
assert.equal((await service.readRelations(project)).relations.length, 0)
assert.ok(!(await service.listFacts(project)).facts.some((fact) => fact.key === '阿罗'), '应清理同名称呼事实')

// 素材批量删除
const materialA = await service.materialSave(project, { content: '素材一' })
const materialB = await service.materialSave(project, { content: '素材二' })
const materialC = await service.materialSave(project, { content: '素材三' })
const deletedMaterials = await service.deleteMaterials(project, { ids: [materialA.id, materialB.id] })
assert.equal(deletedMaterials.deleted, 2)
assert.deepEqual((await service.materialsList(project)).materials.map((item) => item.id), [materialC.id])

// 资料批量删除（含正文文件）
const refA = await service.saveReference(project, { title: '资料一', kind: 'research', content: '甲' })
const refB = await service.saveReference(project, { title: '资料二', kind: 'idea', content: '乙' })
const sourcesDir = join(project, 'story', 'references', 'sources')
assert.ok(existsSync(join(sourcesDir, `${refA.id}.md`)))
const deletedRefs = await service.deleteReferences(project, { ids: [refA.id, refB.id] })
assert.equal(deletedRefs.deleted, 2)
assert.equal((await service.listReferences(project)).sources.length, 0)
assert.ok(!existsSync(join(sourcesDir, `${refA.id}.md`)), '批量删除应删除资料正文文件')

// 删章清理相关待审提案
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: '',
  volumes: [{ id: 'v1', title: '卷一', chapters: [
    { id: 'ch-1', number: 1, title: '第一章', synopsis: '一', status: 'confirmed' },
    { id: 'ch-2', number: 2, title: '第二章', synopsis: '二', status: 'confirmed' },
  ] }],
})
await service.proposeChapterText(project, { number: 1, text: '旧正文' })
await service.proposeChapterText(project, { number: 2, text: '第二章正文' })
assert.equal((await service.listProposals(project)).proposals.length, 2)
const chapterDeleted = await service.deleteChapter(project, { number: 1, snapshot: false, removeOutline: true, renumber: true })
assert.equal(chapterDeleted.proposalsRejected, 1, '删除的章对应提案应被拒绝')
const pending = (await service.listProposals(project)).proposals
assert.equal(pending.length, 1)
assert.equal(pending[0].number, 1, '后续章提案号应随重排前移')

// 删除卷：默认拒绝；cascade 时连同正文一起删除
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: '',
  volumes: [
    { id: 'v1', title: '卷一', chapters: [
      { id: 'ch-1', number: 1, title: '第一章', synopsis: '一', status: 'confirmed' },
      { id: 'ch-2', number: 2, title: '第二章', synopsis: '二', status: 'confirmed' },
    ] },
    { id: 'v2', title: '卷二', chapters: [] },
  ],
})
await service.saveChapterText(project, { number: 1, text: '第一章正文' })
await service.saveChapterText(project, { number: 2, text: '第二章正文' })
await assert.rejects(
  () => service.deleteOutlineVolume(project, { volumeId: 'v1' }),
  /卷内还有章节/,
  '默认必须拒绝删除有章节的卷',
)
const volumeDeleted = await service.deleteOutlineVolume(project, { volumeId: 'v1', cascade: true, snapshot: false })
assert.deepEqual(volumeDeleted.removedChapters.sort(), [1, 2])
assert.ok(!existsSync(join(project, 'story', 'chapters', '001')), '级联应删除章节目录')
const outlineAfterDelete = await service.readJson(project, 'story/plot/outline.json')
assert.deepEqual(outlineAfterDelete.volumes.map((item) => item.id), ['v2'])
assert.ok(!existsSync(join(project, 'story', 'state', '001.json')), '级联应清理章节状态文件')

await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('resource crud tests passed')
