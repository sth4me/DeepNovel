import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
service.assertInitialized = async () => {}
service.readBible = async () => ({ characters: [{ name: '甲' }, { name: '乙' }] })
service.readJson = async (agent, path) =>
  path === 'story/bible/relations.json' ? { positions: { 甲: { x: 1, y: 2 } } } : null
let saved = null
service.writeJson = async (agent, path, data) => {
  saved = data
}

await service.saveRelations({}, {
  relations: [
    { from: '甲', to: '乙', type: '敌对', note: 'a' },
    { from: '甲', to: '乙', type: '敌对', note: 'dup' },
    { from: '甲', to: '丙', type: '敌对' },
    { from: '甲', to: '甲', type: '同门' },
    { from: '乙', to: '甲', type: '盟友' },
  ],
  positions: { 甲: { x: 1, y: 2 }, 乙: { x: 3, y: 4 }, 丙: { x: 9, y: 9 } },
})

if (!saved || !Array.isArray(saved.relations)) throw new Error('relations were not saved')
if (saved.relations.length !== 2) throw new Error(`expected 2 relations, got ${saved.relations.length}`)
if (!saved.relations.some((relation) => relation.from === '甲' && relation.to === '乙')) {
  throw new Error('missing 甲→乙 relation')
}
if (saved.relations.some((relation) => relation.to === '丙' || relation.from === '丙')) {
  throw new Error('unknown character should be dropped')
}
if (saved.relations.some((relation) => relation.from === '甲' && relation.to === '甲')) {
  throw new Error('self relation should be dropped')
}
if (!saved.positions['甲'] || !saved.positions['乙']) throw new Error('known positions should be kept')
if (saved.positions['丙']) throw new Error('unknown position should be dropped')
console.log('relations tests passed', JSON.stringify({ relations: saved.relations.length, positions: Object.keys(saved.positions) }))
