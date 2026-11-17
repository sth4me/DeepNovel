// 新工具层：项目/读/搜/建/写提案/连续性。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-tools-'))
const tools = new Map()
const ctx = {
  workingDirectory: { ensure: async () => root },
  tools: { register: (tool) => tools.set(tool.name, tool) },
}
const { registerWritingTools } = await import('../writing/tools.js')
const registered = registerWritingTools(ctx)
assert.ok(registered.tools.includes('novel_write'))
assert.ok(tools.has('novel_read'))
assert.ok(tools.has('novel_reference'))
assert.ok(tools.has('novel_count'))
const rendered = tools.get('novel_project').output.render({}, { ok: true })
assert.ok(Array.isArray(rendered))
assert.equal(rendered[0].type, 'text')
assert.ok(rendered[0].text.includes('ok'))

const exec = { agent: { id: 'test-session' } }
const call = async (name, args = {}) => {
  const tool = tools.get(name)
  assert.ok(tool, `缺少工具 ${name}`)
  return tool.execute(args, exec)
}

const init = await call('novel_project', { action: 'init', title: '测试书', genre: '武侠' })
assert.equal(init.initialized, true)
assert.equal(init.map.stage, 'setup')
const blockedCreate = await call('novel_create', { kind: 'world', content: '# 过早的设定\n\n不应创建。\n' })
assert.equal(blockedCreate.ok, false)
assert.ok(blockedCreate.error.includes('定'))
const bookProposal = await call('novel_write', {
  action: 'propose',
  kind: 'book',
  content: '# 全书主线\n\n角色甲想下山，但江湖规矩不允许。\n',
})
await call('novel_write', { action: 'apply', proposalId: bookProposal.id, confirm: true })


const worldProposal = await call('novel_create', {
  kind: 'world', title: '示例规则', category: 'rules', content: '# 示例规则\n\n欠债还钱。\n',
})
assert.match(worldProposal.preview.id, /^w\d+$/)
const rejectedApply = await call('novel_write', { action: 'apply', proposalId: worldProposal.id, confirm: false })
assert.equal(rejectedApply.ok, false)
assert.equal((await call('novel_project', { action: 'status' })).map.world.length, 0)
const worldApplied = await call('novel_write', { action: 'apply', proposalId: worldProposal.id, confirm: true })
assert.equal(worldApplied.created, true)
const characterProposal = await call('novel_create', {
  kind: 'character', name: '角色甲', role: '主角', content: '# 角色甲\n\n想下山。\n',
})
await call('novel_write', { action: 'apply', proposalId: characterProposal.id, confirm: true })
const volumeProposal = await call('novel_create', { kind: 'volume', title: '第一卷', content: '# 第一卷\n\n出山。\n' })
const volumeApplied = await call('novel_write', { action: 'apply', proposalId: volumeProposal.id, confirm: true })
const chapterProposal = await call('novel_create', {
  kind: 'chapter', volumeId: volumeApplied.id, title: '初雪', content: '# 第 1 章 初雪\n\n章卡：接下引路。\n',
})
const chapterApplied = await call('novel_write', { action: 'apply', proposalId: chapterProposal.id, confirm: true })
const chapter = { id: chapterApplied.id }

const proposal = await call('novel_write', {
  action: 'propose',
  kind: 'chapter',
  id: chapter.id,
  content: '# 第 1 章 初雪\n\n章卡：接下引路。\n',
})
assert.equal(proposal.diff.changed, true)
const applied = await call('novel_write', { action: 'apply', proposalId: proposal.id, confirm: true })
assert.equal(applied.applied, true)

const counted = await call('novel_count', { scope: 'text', text: '正文测试。abc 123' })
assert.equal(counted.netChars, 6)
assert.equal(counted.latinWords, 2)
const inlineBlocked = await call('novel_write', { action: 'append', kind: 'manuscript', id: 'ch1', content: '对话内直接写正文。' })
assert.equal(inlineBlocked.ok, false, '默认对话内不能直接改正文')
assert.match(inlineBlocked.error, /对话内直接改正文|novel_task/)
const dialogueOn = await call('novel_route', { action: 'set', role: 'draft', dialogueProseInline: true })
assert.equal(dialogueOn.dialogue.proseInline, true)
const appended = await call('novel_write', { action: 'append', kind: 'manuscript', id: 'ch1', content: '追加的一段场景。' })
assert.ok(appended.stats, 'append 应返回字数统计')
assert.ok(appended.stats.delta > 0, 'append 后净字数应增加')
const chapterText = (await call('novel_read', { kind: 'chapter', id: 'ch1' })).content ?? ''
const patchTarget = chapterText.split('\n')[0] || chapterText.slice(0, 6)
const patched = await call('novel_write', { action: 'patch', kind: 'chapter', id: 'ch1', find: patchTarget, replace: `${patchTarget}（改）` })
assert.ok(patched.id || patched.reuse, 'patch 应生成提案')
const badPatch = await call('novel_write', { action: 'patch', kind: 'chapter', id: 'ch1', find: '不存在的文本片段', replace: 'x' })
assert.equal(badPatch.ok, false, 'find 不存在时应报错')
const styleCheck = await call('novel_style_check', { scope: 'text', text: '不是害怕，是还没想好。\n\n然后他走了。他把门带上。' })
assert.equal(styleCheck.verdict, 'needs-revision', '对照句应被检出')
assert.equal(styleCheck.issues.find((item) => item.kind === 'contrast').count, 1)
const styleOk = await call('novel_style_check', { scope: 'text', text: '他把门带上，走廊里的灯灭了两盏，脚步声一直跟到楼梯口才停。' })
assert.equal(styleOk.verdict, 'clean')
const proposalList = await call('novel_write', { action: 'list' })
assert.ok(Array.isArray(proposalList.proposals), '应能列出待处理提案')
const chapterNow = await call('novel_read', { kind: 'chapter', id: 'ch1' })
const dupPropose = await call('novel_write', { action: 'propose', kind: 'chapter', id: 'ch1', content: chapterNow.content ?? '' })
assert.equal(dupPropose.ok, false, '与当前文档相同的提案必须失败')
assert.match(dupPropose.error, /完全相同|没有任何字被修改/)
const freshPropose = await call('novel_write', { action: 'propose', kind: 'chapter', id: 'ch1', content: '# 第一章\n\n新内容甲。\n' })
assert.ok(freshPropose.id, '新内容应生成提案')
const reusedPropose = await call('novel_write', { action: 'propose', kind: 'chapter', id: 'ch1', content: '# 第一章\n\n新内容甲。\n' })
assert.equal(reusedPropose.reuse, true, '相同内容的待处理提案应复用')
const manuscriptPropose = await call('novel_write', { action: 'propose', kind: 'manuscript', id: 'ch1', content: '第一章正文。'.repeat(20) })
assert.ok(manuscriptPropose.stats, '正文提案应返回字数统计')
assert.equal(manuscriptPropose.stats.afterNet, 100)
assert.ok(manuscriptPropose.stats.delta > 0, '新正文应比当前多')
const routeSet = await call('novel_route', { action: 'set', role: 'draft', provider: 'opencode-go', model: 'mimo-v2.6-flash', reasoningEffort: 'off' })
assert.equal(routeSet.routing.draft.model, 'mimo-v2.6-flash')
assert.equal(routeSet.applied.draft, true)
const routeGet = await call('novel_route', { action: 'get' })
assert.equal(routeGet.routing.draft.reasoningEffort, 'off')
const routeClear = await call('novel_route', { action: 'set', role: 'draft', clear: true })
assert.equal(routeClear.applied.draft, false)
const styleSet = await call('novel_style', { action: 'set', style: { tone: '冷峻' } })
assert.equal(styleSet.style.tone, '冷峻')
const styleGet = await call('novel_style', { action: 'get' })
assert.equal(styleGet.style.tone, '冷峻')

const otherRoot = await mkdtemp(join(tmpdir(), 'deepnovel-tools-other-'))
const openedOther = await call('novel_project', { action: 'init', projectRoot: otherRoot, title: '另一本' })
assert.equal(openedOther.root, otherRoot)
const otherBook = await call('novel_read', { kind: 'book' })
assert.ok(otherBook.content.includes('全书主线'))
await call('novel_project', { action: 'open', projectRoot: root })

const referenceList = await call('novel_reference', { action: 'list' })
assert.equal(referenceList.total, 0)
const read = await call('novel_read', { kind: 'chapter', id: chapter.id })
assert.ok(read.content.includes('接下引路'))
const search = await call('novel_search', { query: '引路' })
assert.ok(search.results.length >= 1)
const stage = await call('novel_stage')
assert.ok(stage.stage)

await call('novel_write', { action: 'propose', kind: 'manuscript', id: chapter.id, content: '角色甲推门，雪落下来。\n' })
const manuscriptProposal = await call('novel_write', { action: 'propose', kind: 'manuscript', id: chapter.id, content: '角色甲推门，雪落下来。\n' })
await call('novel_write', { action: 'apply', proposalId: manuscriptProposal.id, confirm: true })
const continuity = await call('novel_continuity', {
  action: 'commit',
  chapterId: chapter.id,
  summary: '角色甲接下引路。',
  handoff: '商队在等他。',
  facts: [{ text: '角色甲会认路' }],
})
assert.equal(continuity.ledgerVersion, 2)

await rm(root, { recursive: true, force: true })
await rm(otherRoot, { recursive: true, force: true })
console.log('writing tools tests passed')
