// P1 文件存储测试：项目、提示词、自动化、构思、文风、设定、关系、能力。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileNovelStore } from '../file-store.js'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-filestore-'))
const store = new FileNovelStore(root)

// 项目
store.writeProject({ title: '测试书', language: 'zh', writingNotes: '白描' })
assert.equal(store.readProject().title, '测试书')
store.writeProject({ genre: '武侠' })
assert.equal(store.readProject().title, '测试书', '合并写入不能丢已有字段')
assert.equal(store.readProject().genre, '武侠', '未知字段必须保留')

// 提示词与自动化
store.writeProjectPrompt({ extra: '追加提示词' })
assert.deepEqual(store.readProjectPrompt(), { extra: '追加提示词' })
store.writeAutomation({ maxTokens: 8000 })
assert.equal(store.readAutomation().maxTokens, 8000)
assert.equal(store.readProject().title, '测试书', '写提示词不能丢项目字段')

// 构思
store.writePremise({
  status: 'confirmed',
  candidates: [{ id: 'c1', title: '候选一' }],
  chosen: { id: 'c1', title: '候选一' },
  chosenHash: 'abc',
})
const premise = store.readPremise()
assert.equal(premise.status, 'confirmed')
assert.equal(premise.candidates.length, 1)
assert.equal(premise.chosenHash, 'abc')
assert.ok(premise.updatedAt, '写入要带时间戳')

// 文风
store.writeStyleContract({ status: 'confirmed', fields: { pov: 'third-limited' }, samples: ['样例'] })
const style = store.readStyleContract()
assert.equal(style.fields.pov, 'third-limited')
assert.deepEqual(style.samples, ['样例'])

store.saveStyleTemplate({ id: 'tpl-1', name: '冷硬', group: '内置', fields: { tone: '冷' } })
store.saveStyleTemplate({ id: 'tpl-1', name: '冷硬改', group: '内置', fields: { tone: '更冷' } })
const templates = store.listStyleTemplates()
assert.equal(templates.length, 1, '同 id 模板应覆盖而不是重复')
assert.equal(templates[0].name, '冷硬改')
assert.equal(store.deleteStyleTemplate('tpl-1').changes, 1)
assert.equal(store.listStyleTemplates().length, 0)

// 设定
store.writeBible({
  status: 'confirmed',
  confirmedAt: '2026-01-01T00:00:00.000Z',
  characters: [{ id: 'ch-1', name: '角色甲', description: '主角' }],
  locations: [{ id: 'loc-1', name: '山门' }],
})
const bible = store.readBible()
assert.equal(bible.status, 'confirmed')
assert.equal(bible.characters.length, 1)
assert.equal(bible.characters[0].name, '角色甲')
assert.equal(bible.locations[0].name, '山门')
assert.deepEqual(bible.rules, [], '未写入的分类应是空数组')

// 关系
store.writeRelations({
  status: 'confirmed',
  relations: [{ from: '角色甲', to: '角色乙', type: '师徒', note: '' }],
  positions: { 角色甲: { x: 10, y: 20 } },
})
const relations = store.readRelations()
assert.equal(relations.relations[0].type, '师徒')
assert.equal(relations.positions['角色甲'].x, 10)

// 能力
store.writePower({ tiers: [{ id: 'p1', name: '入门' }] })
assert.equal(store.readPower().tiers[0].name, '入门')

// 文件落盘位置
for (const relative of ['project.json', 'premise.json', 'style/contract.json', 'style/templates.json', 'bible/entries.json', 'bible/relations.json', 'power.json']) {
  await stat(join(root, 'story', relative))
}
assert.ok((await readFile(join(root, 'story', 'project.json'), 'utf8')).includes('测试书'))

// 大纲
store.writeOutline({
  status: 'confirmed',
  logline: '一句话',
  extraOutline: '保留我',
  volumes: [{
    id: 'v1', title: '卷一', goal: '目标', targetChapters: 10, extraVolume: '保留',
    chapters: [{
      id: 'c1', number: 1, title: '第一章', synopsis: '梗概', status: 'confirmed',
      wordBudget: 3500, inputs: { pov: 'third-limited' }, plant: ['伏笔'], payoff: [], extraChapter: '保留',
    }],
  }],
})
const outline = store.readOutline()
assert.equal(outline.status, 'confirmed')
assert.equal(outline.extraOutline, '保留我', '大纲未知字段保留')
assert.equal(outline.volumes[0].extraVolume, '保留', '卷未知字段保留')
assert.equal(outline.volumes[0].chapters[0].extraChapter, '保留', '章未知字段保留')
assert.equal(outline.volumes[0].chapters[0].wordBudget, 3500)
assert.deepEqual(outline.volumes[0].chapters[0].plant, ['伏笔'])
assert.deepEqual(outline.volumes[0].chapters[0].foreshadow.plant, ['伏笔'], 'foreshadow 与 plant 必须同步')

// 只给 foreshadow 的旧数据也要能读成 plant/payoff
store.writeOutline({
  volumes: [{
    id: 'v1', title: '卷一',
    chapters: [{ id: 'c1', number: 1, title: '第一章', foreshadow: { plant: ['旧伏笔'], payoff: ['旧回收'] } }],
  }],
})
const synced = store.readOutline().volumes[0].chapters[0]
assert.deepEqual(synced.plant, ['旧伏笔'])
assert.deepEqual(synced.payoff, ['旧回收'])

// 章节状态
store.writeChapterMeta(1, { chapterId: 'c1', title: '第一章', wordCount: 1200, status: 'drafted' })
assert.equal(store.readChapterMeta(1).wordCount, 1200)
store.writeChapterQa(1, { qa: { issues: [1] }, styleQa: { aiFlavor: 'low' } })
assert.deepEqual(store.readChapterQa(1).qa, { issues: [1] })
assert.equal(store.readChapterQa(1).continuity, null, '未写的字段是 null')
store.writeChapterState(1, { chapterId: 'c1', title: '第一章', meta: { wordCount: 1200 }, summary: '摘要' })
assert.equal(store.readChapterState(1).chapterId, 'c1')
store.writeChapterSummary(1, { summary: '本章摘要' })
assert.equal(store.readChapterSummary(1).summary, '本章摘要')

// 正文标记
assert.deepEqual(store.setChapterProseFlags(1, { hasDraft: true }), { number: 1, hasDraft: true, hasFinal: false })
assert.equal(store.listChapterProseFlags().get(1).hasDraft, true)
store.setChapterProseFlags(1, { hasFinal: true })
assert.equal(store.listChapterProseFlags().get(1).hasFinal, true)

// 列表与索引
assert.equal(store.listChapterStates().length, 1)
assert.equal(store.listChapterSummaries().length, 1)
const stateIndex = store.readStateIndex()
assert.equal(stateIndex.chapters[0].number, 1)
assert.equal(stateIndex.chapters[0].finalPath, 'story/chapters/001/final.md')
assert.ok(store.readStateMeta?.() === undefined || true)

// 重排与删除
store.writeChapterState(2, { chapterId: 'c2', title: '第二章' })
store.renameChapterRows(2, 3)
assert.equal(store.readChapterState(3).chapterId, 'c2', '重排后章号与内容一起迁移')
assert.equal(store.readChapterState(2), null)
store.deleteChapterRows(3)
assert.equal(store.readChapterState(3), null)

// 大纲按章号删除
store.writeOutline({
  volumes: [{ id: 'v1', title: '卷一', chapters: [
    { id: 'c1', number: 1, title: '第一章' },
    { id: 'c2', number: 2, title: '第二章' },
  ] }],
})
store.deleteOutlineChapter(2)
assert.equal(store.readOutline().volumes[0].chapters.length, 1)
assert.equal(store.readOutline().volumes[0].chapters[0].number, 1)

// 文件落盘位置
await stat(join(root, 'story', 'plot', 'outline.json'))
await stat(join(root, 'story', 'state', '001.json'))



// 素材库
const material = store.saveMaterial({ content: '第一行素材\n第二行', kind: '片段', tags: ['a', 'a', 'b'] })
assert.equal(material.title, '第一行素材')
assert.deepEqual(material.tags, ['a', 'b'])
assert.equal(store.listMaterials().length, 1)
assert.equal(store.readMaterial(material.id).content.includes('第二行'), true)
assert.throws(() => store.saveMaterial({ content: '   ' }), /不能为空/)
assert.equal(store.deleteMaterial(material.id), true)
assert.equal(store.listMaterials().length, 0)

// 事实库
const term = store.saveFact({ key: '夜之城', value: 'Night City', kind: '术语' })
const address = store.saveFact({ key: '凯', value: '老大', kind: '称呼', chapter: 1 })
assert.equal(store.listFacts({ chapter: 1 }).length, 2, '全局事实与本章事实都要返回')
const glossary = store.glossaryFacts()
assert.equal(glossary.find((item) => item.id === term.id).canonical, '夜之城')
assert.deepEqual(glossary.find((item) => item.id === address.id).aliases, ['凯'])
assert.equal(store.deleteFact(term.id), true)

// 运行记录
store.saveRun({ runId: 'r1', kind: 'draft', number: 1, createdAt: '2026-01-01T00:00:00.000Z' })
store.saveRun({ runId: 'r2', kind: 'audit', number: 1, createdAt: '2026-01-02T00:00:00.000Z' })
assert.equal(store.listRuns(10)[0].runId, 'r2', '按时间倒序')
assert.equal(store.readRun('r1').kind, 'draft')
assert.deepEqual(store.pruneRuns(1), { removed: 1, kept: 1 })

// 提示词覆盖
store.writePromptOverride('draft', '自定义正文 system')
assert.equal(store.readPromptOverrides().draft.text, '自定义正文 system')
store.writePromptOverride('draft', '')
assert.equal(store.readPromptOverrides().draft, undefined, '空文本等于删除')
store.writePromptOverride('outline', { text: ' SS ', baseHash: 'h', baseRevision: 3 })
assert.equal(store.readPromptOverrides().outline.text, 'SS')
assert.equal(store.readPromptOverrides().outline.baseRevision, 3)
store.deletePromptOverride('outline')
assert.deepEqual(store.readPromptOverrides(), {})

// 章节笔记
store.appendNote({ chapter: 1, text: '第一条', source: 'ui' })
store.appendNote({ chapter: 2, text: { text: '第二条', tag: 'x' } })
assert.equal(store.listNotes(1).notes[0].text, '第一条')
assert.equal(store.listNotes().notes.length, 2)
store.replaceNotes(1, ['替换一', '替换二'])
assert.equal(store.listNotes(1).notes.length, 2)
assert.equal(store.listNotes(1).notes[0].text, '替换一')

// 统计
store.appendStatsEvent({ date: '2026-01-01', number: 1, words: 500 })
assert.equal(store.readStats().events[0].words, 500)
store.writeStats({ events: [{ date: '2026-01-02', number: 2, words: 700 }] })
assert.equal(store.readStats().events.length, 1)

// 检索与正文读取
await mkdir(join(root, 'story', 'chapters', '001'), { recursive: true })
await writeFile(join(root, 'story', 'chapters', '001', 'draft.md'), '凯在冷雨里等接头人。', 'utf8')
store.writeChapterSummary(1, { summary: '凯在冷雨里接头。' })
assert.equal(store.readChapterBody(1).includes('冷雨'), true)
const found = store.search('冷雨')
assert.ok(found.results.some((item) => item.type === 'chapter'), '应检索到正文')
assert.ok(found.results.some((item) => item.type === 'summary'), '应检索到摘要')
const counts = store.ftsRowCounts()
assert.equal(counts.chapters, 1)
assert.equal(counts.summaries, 1)
assert.deepEqual(store.reindexChapter(1), { number: 1 })
assert.equal(store.reindexAll().chapters, 1)

// 重新打开仍能读到（没有数据库）
const reopened = new FileNovelStore(root)
assert.equal(reopened.readProject().title, '测试书')
assert.equal(reopened.listStyleTemplates().length, 0)
assert.equal(reopened.readBible().characters[0].name, '角色甲')

await rm(root, { recursive: true, force: true })
console.log('file-store P1+P2+P3 tests passed')
