import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
service.assertInitialized = async () => {}
const chapter = {
  id: 'C#01',
  number: 1,
  title: '第 1 章',
  goal: 'g',
  conflict: 'c',
  turn: 't',
  outcome: 'o',
  hook: 'h',
  cast: ['甲', '乙'],
  foreshadow: { plant: [], payoff: [] },
}
service.readJson = async (agent, path) => {
  if (path === 'story/project.json') return { title: 'T', language: 'zh' }
  if (path === 'story/premise.json') return { status: 'confirmed', chosen: { logline: 'L' } }
  if (path === 'story/style/contract.json') return { status: 'confirmed', fields: {} }
  if (path === 'story/plot/outline.json') return { volumes: [{ chapters: [chapter] }] }
  return null
}
service.readBible = async () => ({
  characters: [{ name: '甲' }, { name: '乙' }],
  locations: [],
  rules: [],
  factions: [],
  items: [],
})
service.readPower = async () => ({
  system: { name: '境界', summary: '', tiers: [] },
  characters: [],
  chapterChanges: {},
})
service.readRelations = async () => ({
  relations: [
    { from: '甲', to: '乙', type: '敌对' },
    { from: '甲', to: '丙', type: '盟友' },
    { from: '丙', to: '丁', type: '同门' },
  ],
})
service.readChapterSummary = async () => null

const context = await service.buildStoryContext({}, chapter, 1)
const relations = context.relations ?? []
if (!Array.isArray(relations)) throw new Error('relations missing from story context')
if (relations.length !== 2) throw new Error(`expected 2 relations, got ${relations.length}`)
if (!relations.some((relation) => relation.from === '甲' && relation.to === '乙')) {
  throw new Error('expected 甲→乙 relation')
}
if (relations.some((relation) => relation.from === '丙' && relation.to === '丁')) {
  throw new Error('unrelated relation should be filtered out')
}
console.log('context relations tests passed', JSON.stringify(relations))
