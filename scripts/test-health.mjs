import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
service.assertInitialized = async () => {}
service.readBible = async () => ({ characters: [{ name: '甲' }, { name: '乙' }] })
service.readJson = async (agent, path) => {
  if (path !== 'story/plot/outline.json') return null
  const filler = Array.from({ length: 9 }, (_, index) => ({
    number: index + 4,
    status: 'confirmed',
    title: String(index + 4),
    goal: 'g',
    conflict: 'c',
    turn: 't',
    outcome: 'o',
    hook: 'h',
  }))
  return {
    volumes: [
      {
        chapters: [
          {
            number: 1,
            status: 'confirmed',
            title: '一',
            goal: '',
            conflict: '',
            turn: '',
            outcome: '',
            hook: 'h',
            foreshadow: { plant: ['断剑'], payoff: [] },
            wordBudget: 3000,
          },
          {
            number: 2,
            status: 'confirmed',
            title: '二',
            goal: 'g',
            conflict: 'c',
            turn: 't',
            outcome: 'o',
            hook: 'h',
            foreshadow: { plant: [], payoff: [] },
            wordBudget: 3000,
          },
          {
            number: 3,
            status: 'candidate',
            title: '三',
            goal: 'g',
            conflict: 'c',
            turn: 't',
            outcome: 'o',
            hook: 'h',
          },
          ...filler,
        ],
      },
    ],
  }
}
service.chaptersSummary = async () => [
  { number: 1, hasDraft: true, hasFinal: false, wordCount: 5000, summary: '', finalStale: false },
  { number: 2, hasDraft: true, hasFinal: true, wordCount: 2000, summary: 's', finalStale: true },
]
service.readRelations = async () => ({ relations: [{ from: '甲', to: '丙', type: '敌对' }] })

const report = await service.buildHealthReport({})
const keys = report.issues.map((issue) => issue.key)
const expected = [
  'unconfirmed-outline',
  'missing-fields',
  'bad-relations',
  'drafted',
  'stale-finals',
  'over-words',
  'no-summary',
  'stale-foreshadow',
]
for (const key of expected) {
  if (!keys.includes(key)) throw new Error(`missing issue: ${key}`)
}
const firstNote = report.issues.findIndex((issue) => issue.level === 'note')
const lastWarn = report.issues.reduce((last, issue, index) => (issue.level === 'warn' ? index : last), -1)
if (lastWarn > firstNote && firstNote !== -1) throw new Error('warnings should sort before notes')
if (report.counts.chapters !== 12) throw new Error(`unexpected chapter count ${report.counts.chapters}`)
if (report.counts.words !== 7000) throw new Error(`unexpected word count ${report.counts.words}`)
console.log('health report tests passed', JSON.stringify({ issues: keys, counts: report.counts }))
