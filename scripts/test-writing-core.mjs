// 新文档核心：索引、对象创建、读写、提案/diff、连续性账本。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-writing-'))
const { Project } = await import('../writing/project.js')
const { MANIFEST_FILE } = await import('../writing/manifest.js')
const { deleteReference, extractDocxText, importReferences, listReferences, readReference, searchReferences, visibleTextLength } = await import('../writing/references.js')

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

const sameContent = (await opened.read('chapter', chapter.id)).content
const identical = await opened.proposeWrite('chapter', chapter.id, sameContent)
assert.equal(identical.unchanged, true, '提案内容与当前文档一致时必须标记 unchanged')
assert.equal(identical.id, undefined, '内容没变时不应生成提案 id')
await assert.rejects(() => opened.applyProposal(undefined, { confirm: true }), /不存在|过期/)

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

const beforeProposals = (await opened.listProposals()).length
const pendingProposal = await opened.proposeWrite('book', 'book', '# 全书主线\n\n待处理提案。\n')
const pendingList = await opened.listProposals()
assert.ok(pendingList.some((item) => item.id === pendingProposal.id))
await opened.rejectProposal(pendingProposal.id)
assert.equal((await opened.listProposals()).length, beforeProposals)

const revisionList = await opened.revisions('book', 'book')
assert.ok(revisionList.revisions.length >= 1)
const revisionRead = await opened.readRevision(revisionList.revisions[0].name)
assert.ok(revisionRead.content.includes('全书主线'))

const search = await opened.search('角色甲')
assert.ok(search.total >= 1)
const volumeExport = await opened.exportMarkdown({ scope: 'volume', volumeId: 'v1' })
assert.ok(volumeExport.filename.includes('第一卷'))
const chapterExport = await opened.exportMarkdown({ scope: 'chapter', chapterId: chapter.id })
assert.ok(chapterExport.content.includes('初雪'))

const exported = await opened.exportMarkdown()
assert.ok(exported.filename.endsWith('.md'))
assert.ok(exported.content.includes('测试书'))

function makeDocx(text) {
  const name = Buffer.from('word/document.xml')
  const xml = Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)
  const data = deflateRawSync(xml)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6)
  local.writeUInt16LE(8, 8); local.writeUInt32LE(0, 14); local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10); central.writeUInt32LE(0, 16); central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(xml.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32); central.writeUInt32LE(0, 42)
  const body = Buffer.concat([local, name, data])
  const directory = Buffer.concat([central, name])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, directory, end])
}
assert.equal(extractDocxText(makeDocx('DOCX 资料')), 'DOCX 资料')
assert.equal(visibleTextLength('# 标题\n\n**正文** 和 `code`'), 5)
const routingModule = await import('../writing/routing.js')
assert.equal(routingModule.pickEffort(['low', 'high'], 'off'), 'low')
assert.equal(routingModule.pickEffort(['off', 'high'], 'off'), 'off')
assert.equal(routingModule.pickEffort([], 'high'), '')
const inheritedRoute = routingModule.resolveRoute({}, 'prose', { provider: 'p', model: 'm', efforts: ['off', 'high'] })
assert.equal(inheritedRoute.inherited, true)
assert.equal(inheritedRoute.reasoningEffort, '')
const configuredRoute = routingModule.resolveRoute(
  { prose: { provider: 'opencode-go', model: 'mimo-v2.6-flash', reasoningEffort: 'off' } },
  'prose',
  { provider: 'p', model: 'm', efforts: ['low', 'high'] },
)
assert.equal(configuredRoute.reasoningEffort, 'low')
assert.match(configuredRoute.note, /回落/)
assert.equal(routingModule.describeRoute({ provider: '', model: '' }), '跟随当前会话')

const statsModule = await import('../writing/textstats.js')
const countModule = await import('../writing/count.js')

const stats = statsModule.countText('# 标题\n\n正文：中文标点，也算字符？\n\n**加粗** 和 `code` 以及 abc123\n\n“弯引号” 和 「角引号」 和 "直引号"')
assert.equal(stats.cjkChars > 0, true)
assert.equal(stats.latinWords, 1, '英文和数字按词计')
assert.equal(stats.netChars, stats.cjkChars + stats.latinWords)
assert.ok(stats.chars > stats.charsNoWhitespace, '字符总数包含空白')
assert.equal(stats.quotes.straight, 2)
assert.equal(stats.quotes.curly, 2)
assert.equal(stats.quotes.corner, 2)
assert.ok(statsModule.parseTarget('篇幅目标：**3,500–4,200 字**（净字符）').min === 3500)
assert.equal(statsModule.parseTarget('没有目标'), null)

{
  const root2 = await mkdtemp(join(tmpdir(), 'deepnovel-count-'))
  const p2 = await Project.init(root2, { title: 'c', genre: 'g' })
  await p2.createVolume({ id: 'v1', title: '卷一' })
  await p2.createChapter({ id: 'ch1', title: '第一章', volumeId: 'v1' })
  await p2.write('chapter', 'ch1', '# 章卡\n\n篇幅目标：3,500–4,200 字\n')
  await p2.write('manuscript', 'ch1', '一百个字。'.repeat(10))
  const counted = await countModule.countProject(p2, { scope: 'chapter', chapterId: 'ch1' })
  assert.equal(counted.chapter.target.max, 4200)
  assert.equal(counted.chapter.progress.reached, false)
  assert.equal(counted.chapter.netChars, 40)
  const volume = await countModule.countProject(p2, { scope: 'volume', volumeId: 'v1' })
  assert.equal(volume.total.netChars, 40)
  const whole = await countModule.countProject(p2, { scope: 'project' })
  assert.equal(whole.total.chapters, 1)
  await rm(root2, { recursive: true, force: true })
}

const accessModule = await import('../writing/access.js')
const scopesModule = await import('../writing/scopes.js')
const queueModule = await import('../writing/taskqueue.js')

assert.equal(accessModule.conflicts({ write: ['manuscript/ch1.md'] }, { write: ['manuscript/ch1.md'] }), true, '同文件写写冲突')
assert.equal(accessModule.conflicts({ write: ['manuscript/ch1.md'] }, { write: ['manuscript/ch2.md'] }), false, '不同文件写写可并行')
assert.equal(accessModule.conflicts({ write: ['plot/chapters/'] }, { read: ['plot/chapters/ch1.md'] }), true, '目录前缀覆盖读写冲突')
assert.equal(accessModule.conflicts({ readAll: true }, { write: ['world/'] }), true, '只读任务与写任务冲突')
assert.equal(accessModule.conflicts({ readAll: true }, { readAll: true }), false, '只读任务之间可并行')

assert.equal(scopesModule.scopeForTask({ title: '检查连续性' }).readAll, true)
assert.deepEqual(scopesModule.scopeForTask({ title: '写正文', chapterId: 'ch1' }).write, ['manuscript/ch1.md'])
assert.deepEqual(scopesModule.scopeForTask({ title: '补人物' }).write, ['characters/'])
assert.equal(scopesModule.scopeForTask({ title: '未知任务' }).writeAll, true, '未知任务按整项目写处理')

{
  const started = []
  const pending = []
  const queue = queueModule.createTaskQueue({
    run: (task) => new Promise((resolve) => { started.push(task.title); pending.push(resolve) }),
    maxConcurrent: 3,
  })
  queue.enqueue('q1', { title: '写ch1', role: 'prose', prompt: 'a', access: { write: ['manuscript/ch1.md'] } })
  queue.enqueue('q1', { title: '写ch1续', role: 'prose', prompt: 'b', access: { write: ['manuscript/ch1.md'] } })
  assert.deepEqual(started, ['写ch1'], '同文件任务必须排队')
  queue.enqueue('q1', { title: '写ch2', role: 'prose', prompt: 'c', access: { write: ['manuscript/ch2.md'] } })
  assert.deepEqual(started, ['写ch1', '写ch2'], '不同文件任务可以并行')
  assert.equal(queue.snapshot('q1').filter((item) => item.state === 'waiting').length, 1)
  pending.shift()()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(started, ['写ch1', '写ch2', '写ch1续'], '前一任务结束后排队任务开始')
  pending.forEach((resolve) => resolve())
}
{
  const queue = queueModule.createTaskQueue({ run: () => new Promise(() => {}), maxConcurrent: 3 })
  queue.enqueue('q2', { title: '检查', role: 'plan', prompt: 'x', access: { readAll: true } })
  queue.enqueue('q2', { title: '写', role: 'prose', prompt: 'y', access: { write: ['manuscript/ch1.md'] } })
  assert.equal(queue.snapshot('q2').filter((item) => item.state === 'waiting').length, 1, '只读任务挡住写任务')
  const duplicate = queue.enqueue('q2', { title: '检查', role: 'plan', prompt: 'x', access: { readAll: true } })
  assert.equal(duplicate.duplicate, true, '相同任务应去重')
}

function makePdf(text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = `BT /F1 18 Tf 50 200 Td (${escaped}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}


const referenceSource = await mkdtemp(join(tmpdir(), 'deepnovel-refs-'))
await mkdir(join(referenceSource, 'nested'), { recursive: true })
await writeFile(join(referenceSource, 'canon.md'), '# 原作资料\n\n角色甲的原作设定。\n', 'utf8')
await writeFile(join(referenceSource, 'nested', 'notes.txt'), '研究笔记：角色甲的时间线。\n', 'utf8')
await writeFile(join(referenceSource, 'research.pdf'), makePdf('PDF 研究资料'), 'utf8')
const imported = await importReferences(project, referenceSource, { kind: 'canon', tags: ['原作'] })
assert.equal(imported.imported, 3)
const references = await listReferences(project)
assert.equal(references.length, 3)
const reference = await readReference(project, references[0].id)
assert.ok(reference.content.includes('原作资料') || reference.content.includes('研究笔记'))
const referenceSearch = await searchReferences(project, '角色甲')
assert.ok(referenceSearch.total >= 2)
await deleteReference(project, references[0].id)
assert.equal((await listReferences(project)).length, 2)
await rm(referenceSource, { recursive: true, force: true })

await rm(root, { recursive: true, force: true })
console.log('writing core tests passed')
