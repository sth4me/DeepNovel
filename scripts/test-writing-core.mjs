// 新文档核心：索引、对象创建、读写、提案/diff、连续性账本。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-writing-'))
const { Project } = await import('../writing/project.js')
const { MANIFEST_FILE } = await import('../writing/manifest.js')

const project = await Project.init(root, { title: '测试书', genre: '武侠', language: 'zh' })
assert.equal(project.manifest.title, '测试书')
const manifest = JSON.parse(await readFile(join(root, MANIFEST_FILE), 'utf8'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.plot.book.file, 'plot/book.md')
assert.equal(project.readiness().ready, false)
assert.ok(project.readiness().missing.includes('写作要求/核心方向'))

const openingFlow = await project.workflow()
assert.equal(openingFlow.stage, 'opening')
assert.equal(openingFlow.allowed.world, false)
await project.write('book', 'book', '# 全书主线\n\n角色甲想下山。\n')
const directionFlow = await project.workflow()
assert.equal(directionFlow.stage, 'foundation')
assert.equal(directionFlow.allowed.world, true)
assert.equal(directionFlow.allowed.volume, false)
assert.ok(directionFlow.directionExcerpt.includes('角色甲'))

const world = await project.createWorld({ title: '示例规则', category: 'rules', content: '# 示例规则\n\n欠债还钱。\n' })
assert.match(world.id, /^w\d+$/)
const character = await project.createCharacter({ name: '角色甲', role: '主角', content: '# 角色甲\n\n想下山。\n' })
const volume = await project.createVolume({ title: '第一卷', content: '# 第一卷\n\n出山。\n' })
const arc = await project.createArc({ volumeId: volume.id, title: '引路', content: '# 引路\n\n接下商队。\n' })
const chapter = await project.createChapter({
  volumeId: volume.id,
  arcId: arc.id,
  title: '初雪',
  content: '# 第 1 章 初雪\n\n章卡：接下引路。\n',
})
assert.equal(project.findChapter(chapter.id).volume.id, volume.id)

const book = await project.read('book')
assert.ok(book.content.includes('全书主线'))
const opened = await Project.open(root)
assert.equal(opened.manifest.world.length, 1)
assert.equal(opened.manifest.characters.length, 1)
assert.equal(opened.manifest.plot.volumes[0].chapters[0].title, '初雪')

const proposal = await opened.proposeWrite('chapter', chapter.id, '# 第 1 章 初雪\n\n章卡：接下引路，连夜出山。\n')
assert.equal(proposal.diff.changed, true)
const applied = await opened.applyProposal(proposal.id, { confirm: true })
assert.equal(applied.applied, true)
assert.ok((await opened.read('chapter', chapter.id)).content.includes('连夜出山'))

const stale = await opened.proposeWrite('chapter', chapter.id, '新内容')
await opened.write('chapter', chapter.id, '别人改过的内容')
const rejected = await opened.applyProposal(stale.id, { confirm: true })
assert.equal(rejected.applied, false)
assert.equal(rejected.reason, 'content-changed')

await opened.write('manuscript', chapter.id, '角色甲推门，雪落下来。\n')
await opened.commitChapter({
  chapterId: chapter.id,
  summary: '角色甲接下引路，雪夜出山。\n',
  handoff: '商队在山口等他。\n',
  facts: [{ text: '角色甲会认路' }],
  foreshadow: [{ text: '铜牌未解释' }],
})
const ledger = await opened.readLedger()
assert.equal(ledger.facts.length, 1)
assert.equal(ledger.handoffs.length, 1)
assert.equal(ledger.version, 2)


const beforeCreate = opened.manifest.world.length
const createProposal = await opened.proposeCreate({ kind: 'world', title: '新规则', category: 'rules', content: '# 新规则\n\n先付钱，后办事。\n' })
assert.equal(createProposal.type, 'create')
assert.equal(opened.manifest.world.length, beforeCreate, '提案阶段不应创建对象')
const createdWorld = await opened.applyProposal(createProposal.id, { confirm: true })
assert.equal(createdWorld.created, true)
assert.equal(opened.manifest.world.length, beforeCreate + 1)
const map = await opened.projectMap()
assert.equal(map.readiness.ready, false)
assert.equal(map.plot.volumes.length, 1)
assert.equal(map.plot.volumes[0].chapters[0].hasManuscript, true)
assert.ok((await opened.context({ focusKind: 'chapter', focusId: chapter.id })).includes('项目地图'))

const bookDoc = await opened.read('book')
const savedBook = await opened.saveDoc('book', '', '# 全书主线\n\n角色甲决定下山。\n', { expectedHash: bookDoc.hash })
assert.equal(savedBook.content.includes('决定下山'), true)
await assert.rejects(
  opened.saveDoc('book', '', '旧内容覆盖', { expectedHash: bookDoc.hash }),
  (error) => error.code === 'DOC_CONFLICT',
)

const search = await opened.search('角色甲')
assert.ok(search.total >= 1)
const exported = await opened.exportMarkdown()
assert.ok(exported.filename.endsWith('.md'))
assert.ok(exported.content.includes('测试书'))

await rm(root, { recursive: true, force: true })
console.log('writing core tests passed')
