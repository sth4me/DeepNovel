import { computeForeshadowEdges } from '../service.js'

const chapters = [
  { number: 1, foreshadow: { plant: ['断剑'], payoff: [] } },
  { number: 2, foreshadow: { plant: ['玉佩'], payoff: ['断剑重现'] } },
  { number: 3, foreshadow: { plant: [], payoff: ['玉佩归还'] } },
  { number: 4, foreshadow: { plant: [], payoff: ['无关联'] } },
  { number: 5, foreshadow: { plant: ['断剑'], payoff: [] } },
  { number: 6, foreshadow: { plant: [], payoff: ['断剑'] } },
]

const edges = computeForeshadowEdges(chapters)
const has = (from, to) => edges.some((edge) => edge.from === from && edge.to === to)
if (!has(0, 1)) throw new Error('expected 1→2 edge for 断剑')
if (!has(1, 2)) throw new Error('expected 2→3 edge for 玉佩')
if (!has(0, 5)) throw new Error('expected 1→6 edge for 断剑')
if (has(4, 5)) throw new Error('later plant should not also match when an earlier one does')
if (has(0, 3)) throw new Error('unrelated payoff should not create an edge')
console.log('foreshadow edge tests passed', JSON.stringify(edges))
