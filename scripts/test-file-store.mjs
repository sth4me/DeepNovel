// P1 文件存储测试：项目、提示词、自动化、构思、文风、设定、关系、能力。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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

// 未实现的方法必须显式失败
assert.throws(() => store.readOutline(), /尚未实现/)

// 重新打开仍能读到（没有数据库）
const reopened = new FileNovelStore(root)
assert.equal(reopened.readProject().title, '测试书')
assert.equal(reopened.listStyleTemplates().length, 0)
assert.equal(reopened.readBible().characters[0].name, '角色甲')

await rm(root, { recursive: true, force: true })
console.log('file-store P1 tests passed')
