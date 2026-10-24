// 上下文预算测试：超预算时先删低优先级，不误删本章必须回收的伏笔。
import assert from 'node:assert/strict'
import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
const context = {
  premise: { logline: '核心' },
  style: { notes: '很长'.repeat(400), pov: 'third' },
  bible: {
    characters: Array.from({ length: 12 }, (_, index) => ({ name: `角色${index}`, description: '描述'.repeat(20) })),
    factions: Array.from({ length: 8 }, (_, index) => ({ name: `势力${index}` })),
    items: Array.from({ length: 8 }, (_, index) => ({ name: `物品${index}` })),
    locations: Array.from({ length: 8 }, (_, index) => ({ name: `地点${index}` })),
  },
  power: {
    characters: Array.from({ length: 8 }, (_, index) => ({ name: `角色${index}` })),
    recentChanges: Array.from({ length: 5 }, (_, index) => ({ chapter: index, changes: [] })),
  },
  continuity: {
    recent: Array.from({ length: 4 }, (_, index) => ({ number: index, summary: '摘要'.repeat(40) })),
    previousTail: '尾'.repeat(1200),
  },
  summaryHistory: Array.from({ length: 8 }, (_, index) => ({ number: index, summary: '摘要'.repeat(30) })),
  relevantSummaries: Array.from({ length: 4 }, (_, index) => ({ number: index, summary: '摘要'.repeat(30) })),
  foreshadowing: Array.from({ length: 8 }, (_, index) => ({ text: `伏笔${index}`, plantedAt: index, overdue: index > 5 })),
  foreshadowingDue: ['必须回收的伏笔'],
  relations: Array.from({ length: 8 }, (_, index) => ({ from: `甲${index}`, to: `乙${index}` })),
  timeline: Array.from({ length: 5 }, (_, index) => ({ number: index, title: `第${index}章` })),
  notes: Array.from({ length: 3 }, () => ({ conclusion: '很长的备注'.repeat(30) })),
}
const before = JSON.stringify(context).length
const changed = service.fitStoryContext(context, 1200)
const after = JSON.stringify(context).length
assert.equal(changed, true)
assert.ok(after <= 1200, `expected <= 1200, got ${after}`)
assert.deepEqual(context.foreshadowingDue, ['必须回收的伏笔'])
assert.ok(after < before)

// 已低于预算时不应改变
const small = { premise: { logline: '短' } }
assert.equal(service.fitStoryContext(small, 1200), false)
assert.equal(small.premise.logline, '短')

console.log('context budget tests passed')
