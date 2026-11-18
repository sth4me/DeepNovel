// 并发资源锁测试：分类与互斥语义。
import assert from 'node:assert/strict'
import { runResource } from '../index.js'

assert.equal(runResource('chapter-draft', { number: 3 }), 'chapter:3')
assert.equal(runResource('chapter-revise', { number: 3 }), 'chapter:3')
assert.equal(runResource('chapter-qa', { number: 3 }), 'chapter:3')
assert.equal(runResource('chapter-audit', { number: 3 }), 'read:audit:3')
assert.equal(runResource('chapter-review', { number: 3 }), 'read:audit:3')
assert.equal(runResource('continuity-check', { number: 3 }), 'read:continuity:3')
assert.equal(runResource('continuity-audit', { number: 3 }), 'read:continuity:3')
assert.equal(runResource('outline-audit', {}), 'read:audit:outline')
assert.equal(runResource('chapter-draft', {}), 'chapter')
assert.equal(runResource('chapter-batch', { count: 3 }), 'chapter:batch')
assert.equal(runResource('outline-generate'), 'outline')
assert.equal(runResource('outline-commit'), 'outline')
assert.equal(runResource('bible-generate'), 'bible')
assert.equal(runResource('premise-candidates'), 'premise')
assert.equal(runResource('premise-chat-load'), 'premise')
assert.equal(runResource('premise-chat-save'), 'premise')
assert.equal(runResource('premise-restore-batch'), 'premise')
assert.equal(runResource('style-commit'), 'style')
assert.equal(runResource('prompt-save'), null)
assert.equal(runResource('project-update'), null)
assert.equal(runResource('export-manuscript'), null)
assert.equal(runResource('search-project'), null)
assert.equal(runResource('import-manuscript'), 'chapter:batch')

// 互斥语义：同资源不可重入，不同资源可并行，释放后可重新获取
const { acquireRun, releaseRun } = await import('../index.js')
const runs = new Map()
const a = acquireRun(runs, 'proj', 'chapter-draft', { number: 3 })
assert.equal(a.acquired, true)
const b = acquireRun(runs, 'proj', 'chapter-draft', { number: 3 })
assert.equal(b.busy, true)
const c = acquireRun(runs, 'proj', 'outline-generate', {})
assert.equal(c.acquired, true)
const d = acquireRun(runs, 'proj', 'chapter-draft', { number: 4 })
assert.equal(d.acquired, true)
releaseRun(runs, 'proj', a)
const e = acquireRun(runs, 'proj', 'chapter-draft', { number: 3 })
assert.equal(e.acquired, true)

// 连续写章与单章生成互斥（它们会写同一批章节文件）
const batchRuns = new Map()
const batch = acquireRun(batchRuns, 'proj', 'chapter-batch', { count: 3 })
assert.equal(batch.acquired, true)
assert.equal(acquireRun(batchRuns, 'proj', 'chapter-draft', { number: 5 }).busy, true)
assert.equal(acquireRun(batchRuns, 'proj', 'outline-generate', {}).acquired, true)
releaseRun(batchRuns, 'proj', batch)
assert.equal(acquireRun(batchRuns, 'proj', 'chapter-draft', { number: 5 }).acquired, true)

// 超时清理：卡死锁会被 abort 并移除
const { sweepStaleRuns } = await import('../index.js')
const staleRuns = new Map()
const stale = acquireRun(staleRuns, 'proj', 'chapter-draft', { number: 9 })
stale.controller.startedAt = Date.now() - 31 * 60 * 1000
assert.equal(sweepStaleRuns(staleRuns, 30 * 60 * 1000), 1)
assert.equal(stale.controller.signal.aborted, true)
assert.equal(staleRuns.has('proj'), false)

// 旧请求收尾不能误删清理后新建的同名锁
const replaceRuns = new Map()
const first = acquireRun(replaceRuns, 'proj', 'chapter-draft', { number: 9 })
replaceRuns.get('proj').delete('chapter:9')
const second = acquireRun(replaceRuns, 'proj', 'chapter-draft', { number: 9 })
releaseRun(replaceRuns, 'proj', first)
assert.equal(replaceRuns.get('proj').get('chapter:9'), second.controller)

console.log('run resource tests passed')
