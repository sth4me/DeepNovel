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

const deadContent = (await opened.read('chapter', chapter.id)).content
const deadHash = (await import('../writing/storage.js')).contentHash(deadContent)
await opened.store.writeJson('revisions/proposals/edit-dead-test.json', {
  id: 'edit-dead-test', kind: 'chapter', targetId: chapter.id, path: `plot/chapters/${chapter.id}.md`,
  content: deadContent, beforeHash: deadHash, afterHash: deadHash, diff: { changes: [] }, createdAt: new Date().toISOString(),
})
const listedAfterDead = await opened.listProposals()
assert.equal(listedAfterDead.some((item) => item.id === 'edit-dead-test'), false, '死提案不应出现在列表里')

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
assert.equal(routingModule.roleDefaultEffort('draft', ['off', 'low', 'high'], 'high'), 'off', '正文草稿默认关闭思考')
assert.equal(routingModule.roleDefaultEffort('outline', ['off', 'low', 'high'], 'high'), 'low', '章纲默认低思考')
assert.equal(routingModule.roleDefaultEffort('audit', ['medium', 'high'], 'high'), 'medium', '审稿在不支持 low 时回落')
assert.equal(routingModule.roleDefaultEffort('summary', ['off', 'high'], 'high'), 'high', '摘要继承当前档位')
const legacyExpanded = routingModule.expandLegacyRoutes({ prose: { provider: 'p', model: 'm', reasoningEffort: 'off' } })
assert.equal(legacyExpanded.draft.provider, 'p', '旧版 prose 展开到正文草稿')
assert.equal(legacyExpanded.revise.model, 'm')
assert.equal(legacyExpanded.premise.provider, '', '旧版 prose 不影响构思')
const outlineResolved = routingModule.resolveRoute({}, 'outline', { provider: 'p', model: 'm', efforts: ['off', 'low', 'high'], reasoningEffort: 'high' })
assert.equal(outlineResolved.reasoningEffort, 'low', '未配置时按任务默认档位')


const dialogueModule = await import('../writing/dialogue.js')
assert.deepEqual(dialogueModule.normalizeDialogue({}), { proseInline: false })
assert.deepEqual(dialogueModule.normalizeDialogue({ proseInline: true }), { proseInline: true })
assert.ok(dialogueModule.inlineProseBlock({ kind: 'manuscript', action: 'append', agent: { id: 's1', options: {} }, dialogue: {} }), '默认对话内正文写入应被拦截')
assert.equal(dialogueModule.inlineProseBlock({ kind: 'manuscript', action: 'append', agent: { id: 's1', options: {} }, dialogue: { proseInline: true } }), undefined, '开关打开后允许')
assert.equal(dialogueModule.inlineProseBlock({ kind: 'manuscript', action: 'append', agent: { id: 'q1', options: {} }, dialogue: {}, isQueuedSession: (id) => id === 'q1' }), undefined, '队列子代理允许')
assert.equal(dialogueModule.inlineProseBlock({ kind: 'chapter', action: 'append', agent: { id: 's1', options: {} }, dialogue: {} }), undefined, '章卡不受限')
assert.equal(dialogueModule.inlineProseBlock({ kind: 'manuscript', action: 'apply', agent: { id: 's1', options: {} }, dialogue: {} }), undefined, '应用提案不受限')

const styleModule = await import('../writing/stylecheck.js')
const styleSample = '不是取东西，是带人。\n\n然后他才开门。他把门推开，屋里比外头黑，眼睛适应了几秒才往里走，地上有水。'
const styleChecked = styleModule.checkStyle(styleSample)
assert.equal(styleChecked.verdict, 'needs-revision')
assert.equal(styleChecked.issues.find((item) => item.kind === 'contrast').count, 1)
assert.ok(styleChecked.issues.find((item) => item.kind === 'short-opener'), '短句开段应被检出')
const styleClean = styleModule.checkStyle('他把门推开，屋里比外头黑，眼睛适应了几秒才往里走，地上有水，走一步粘一下鞋底。')
assert.equal(styleClean.verdict, 'clean')
assert.equal(styleModule.checkStyle('这是一段文本。', { patterns: ['文本'] }).issues.some((item) => item.kind === 'custom'), true)

const guardModule = await import('../writing/guard.js')
assert.ok(guardModule.directWriteGuard({ name: 'write', arguments: { path: 'manuscript/ch1.md', content: 'x' } }), '原生 write 写正文必须被阻止')
assert.ok(guardModule.directWriteGuard({ name: 'edit', arguments: { file_path: '%ROOT%/plot/book.md' } }), '原生 edit 写大纲必须被阻止')
assert.ok(guardModule.directWriteGuard({ name: 'pwsh', arguments: { command: 'Set-Content manuscript/ch1.md -Value x' } }), '命令行写正文必须被阻止')
assert.equal(guardModule.directWriteGuard({ name: 'write', arguments: { path: 'notes/todo.md', content: 'x' } }), undefined, '非项目文档不拦')
assert.equal(guardModule.directWriteGuard({ name: 'read', arguments: { path: 'manuscript/ch1.md' } }), undefined, '读取不拦')
assert.equal(guardModule.directWriteGuard({ name: 'pwsh', arguments: { command: 'Get-Content manuscript/ch1.md' } }), undefined, '只读命令不拦')
assert.ok(guardModule.directWriteGuard({ name: 'bash', arguments: { command: 'python -c "open(\'manuscript/ch1.md\',\'w\').write(x)"' } }), '脚本写文件必须被阻止')
assert.ok(guardModule.directWriteGuard({ name: 'bash', arguments: { command: 'node -e "fs.writeFileSync(\'plot/book.md\', x)"' } }), 'node 写文件必须被阻止')

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
  assert.equal(counted.chapter.remaining, 3460)
  assert.equal(counted.chapter.netChars, 40)
  const volume = await countModule.countProject(p2, { scope: 'volume', volumeId: 'v1' })
  assert.equal(volume.total.netChars, 40)
  const whole = await countModule.countProject(p2, { scope: 'project' })
  assert.equal(whole.total.chapters, 1)
  await rm(root2, { recursive: true, force: true })
}

{
  const briefRoot = await mkdtemp(join(tmpdir(), 'deepnovel-brief-'))
  const bp = await Project.init(briefRoot, { title: '简报书', genre: '科幻' })
  await bp.createVolume({ id: 'v1', title: '卷一' })
  await bp.createChapter({ id: 'ch1', title: '第一章', volumeId: 'v1' })
  await bp.write('chapter', 'ch1', '# 章卡\n\n篇幅目标：3,500–4,200 字\n')
  await bp.write('manuscript', 'ch1', '已有正文。'.repeat(20))
  const briefModule = await import('../writing/brief.js')
  const brief = await briefModule.buildTaskBrief(bp, { role: 'prose', chapterId: 'ch1' })
  assert.match(brief, /任务简报/)
  assert.match(brief, /简报书/)
  assert.match(brief, /第一章/)
  assert.match(brief, /3,500/)
  assert.match(brief, /不要为了“了解一下”去全项目搜索|不要为了/)
  assert.match(brief, /action=append/)
  await rm(briefRoot, { recursive: true, force: true })
}

const hubModule = await import('../writing/taskhub.js')
const noticeText = hubModule.taskNotice({ title: '扩写第一章', state: 'done', sessionId: 'session-1', route: { model: 'mimo-v2.6-flash', reasoningEffort: 'off' } })
assert.match(noticeText, /后台任务完成/)
assert.match(noticeText, /扩写第一章/)
assert.match(noticeText, /mimo-v2\.6-flash/)
assert.match(noticeText, /汇报/)
assert.match(noticeText, /不要自行开始新的任务/)
const failNotice = hubModule.taskNotice({ title: '写正文', state: 'failed', error: '模型不可用' })
assert.match(failNotice, /失败/)
assert.match(failNotice, /模型不可用/)

const accessModule = await import('../writing/access.js')
const scopesModule = await import('../writing/scopes.js')
const queueModule = await import('../writing/taskqueue.js')

{
  let rejectRun
  const queue = queueModule.createTaskQueue({
    run: () => new Promise((_resolve, reject) => { rejectRun = reject }),
    cancelRun: () => {},
    maxConcurrent: 1,
  })
  const queued = queue.enqueue('q5', { title: '写正文', role: 'prose', prompt: 'x', access: { write: ['manuscript/ch1.md'] } })
  queue.cancel('q5', queued.task.id)
  rejectRun(new Error('aborted'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const stopped = queue.snapshot('q5').find((item) => item.id === queued.task.id)
  assert.equal(stopped.state, 'stopped', '停止后的任务不能被失败覆盖')
}


{
  const events = []
  const queue = queueModule.createTaskQueue({ run: () => new Promise(() => {}), maxConcurrent: 2, onChange: (root, tasks) => events.push({ root, count: tasks.length }) })
  queue.enqueue('q3', { title: '写', role: 'prose', prompt: 'a', access: { write: ['manuscript/ch1.md'] } })
  assert.ok(events.length >= 1, '入队应触发 onChange')
  assert.equal(events[0].root, 'q3')
  queue.hydrate('q4', [
    { id: 'old-1', title: '旧的正文任务', role: 'prose', state: 'running', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'old-2', title: '旧的已完成', role: 'plan', state: 'done', createdAt: '2026-01-02T00:00:00.000Z' },
  ])
  const hydrated = queue.snapshot('q4')
  assert.equal(hydrated.find((item) => item.id === 'old-1').state, 'stopped', '重启后未完成任务标记为中断')
  assert.match(hydrated.find((item) => item.id === 'old-1').error, /中断/)
  assert.equal(hydrated.find((item) => item.id === 'old-2').state, 'done')
  queue.hydrate('q4', [{ id: 'ignored', title: 'x', state: 'done' }])
  assert.equal(queue.snapshot('q4').some((item) => item.id === 'ignored'), false, '重复 hydrate 应被忽略')
}


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
  const all = queue.snapshotAll()
  assert.equal(all.length, 1)
  assert.equal(all[0].root, 'q2')
  assert.equal(all[0].active, 2)
  assert.equal(all[0].tasks.filter((item) => item.state === 'running').length, 1)
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
