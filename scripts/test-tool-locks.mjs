// 助手工具统一锁：写动作走 host acquire/release、busy 不调 service、粒度修复、只读不锁。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-tool-locks-home-'))
process.env.DSH_HOME = home

const { setNovelWriter, setNovelLocks } = await import('../runtime.js')
const { apply } = await import('../agent.js')
const { runResource, locksConflict } = await import('../lock-rules.js')
const { acquireRun, releaseRun, listActiveLocks } = await import('../index.js')

let calls = 0
const service = {
  listChaptersPage: async () => ({ total: 0, chapters: [] }),
  readChapterParts: async () => ({ number: 1 }),
  searchChapterText: async () => ({ hits: [] }),
  draftChapter: async () => { calls += 1; return { number: 3 } },
  patchChapterText: async () => { calls += 1; return { replaced: 1 } },
  saveChapterText: async () => { calls += 1; return { saved: true } },
}
setNovelWriter(service)

const activeRuns = new Map()
setNovelLocks({
  acquire: (owner, action, params) => acquireRun(activeRuns, owner, action, params),
  release: (owner, handle) => releaseRun(activeRuns, owner, handle),
  listActive: () => listActiveLocks(activeRuns),
})
const registered = []
apply({
  tools: { register: (tool) => registered.push(tool) },
  systemPrompt: { section: () => {} },
})
const tool = (name) => registered.find((item) => item.name === name)
const runChapter = (args) => tool('novel_chapter').execute(args, { agent: 'session-1', signal: null })

// ---------- 1) 锁粒度映射 ----------
assert.equal(runResource('chapter-delete', { number: 5, removeOutline: true }), 'chapter:batch')
assert.equal(runResource('chapter-delete', { number: 5 }), 'chapter:5')
assert.equal(runResource('chapter-patch', { number: 5 }), 'chapter:5')
assert.equal(runResource('export-file-project'), 'project:export')
assert.equal(runResource('restore-project', {}), 'project')
assert.equal(locksConflict(new Map([['project', {}]]), 'chapter:5'), true, 'project 锁应与章节写互斥')
assert.equal(locksConflict(new Map([['chapter:5', {}]]), 'project:import'), true, '全项目动作应被任何锁阻塞')
assert.equal(locksConflict(new Map([['chapter:batch', {}]]), 'chapter:5'), true)

// ---------- 2) UI 占 chapter:3 → 助手 draft 返回 busy 且不调 service ----------
const uiHandle = acquireRun(activeRuns, 'ui:/project', 'chapter-draft', { number: 3 })
assert.equal(uiHandle.acquired, true)
assert.equal(uiHandle.resource, 'chapter:3')
const before = calls
const busy = await runChapter({ action: 'draft', number: 3 })
assert.equal(busy.ok, false, 'busy 时工具应返回结构化错误')
assert.match(busy.error, /资源忙/)
assert.ok(busy.hint)
assert.equal(calls, before, 'busy 时不应调用 service')
// 只读动作不被锁挡住
const listResult = await runChapter({ action: 'list' })
assert.equal(listResult.ok, undefined, '只读 list 应正常返回')
assert.equal(Array.isArray(listResult.chapters), true)
// listActive 能看到 UI 的活动锁
const active = listActiveLocks(activeRuns)
assert.equal(active.length, 1)
assert.equal(active[0].owner, 'ui:/project')
assert.equal(active[0].resource, 'chapter:3')
assert.equal(typeof active[0].startedAt, 'number')

// ---------- 3) 释放后助手可执行，且执行完锁自动释放 ----------
releaseRun(activeRuns, 'ui:/project', uiHandle)
assert.equal(listActiveLocks(activeRuns).length, 0)
const ok = await runChapter({ action: 'draft', number: 3 })
assert.equal(ok.ok, undefined, '释放后应正常执行')
assert.equal(calls, before + 1, '释放后应调用 service')
assert.equal(listActiveLocks(activeRuns).length, 0, '工具结束应释放锁')

// ---------- 4) delete removeOutline 占 chapter:batch，与单章写互斥 ----------
const deleteHandle = acquireRun(activeRuns, 'ui:/project', 'chapter-delete', { number: 5, removeOutline: true })
assert.equal(deleteHandle.resource, 'chapter:batch')
const blockedByBatch = acquireRun(activeRuns, 'agent:session-2', 'chapter-draft', { number: 9 })
assert.equal(blockedByBatch.busy, true, '批量删除期间其它章节写应 busy')
const blockedBatch = acquireRun(activeRuns, 'agent:session-2', 'chapter-delete', { number: 9, removeOutline: true })
assert.equal(blockedBatch.busy, true, '批量操作之间也互斥')
releaseRun(activeRuns, 'ui:/project', deleteHandle)

// ---------- 5) restore（全项目）与写互斥 ----------
const restoreHandle = acquireRun(activeRuns, 'ui:/project', 'restore-project', {})
assert.equal(restoreHandle.resource, 'project')
const blockedByRestore = acquireRun(activeRuns, 'agent:session-2', 'chapter-draft', { number: 3 })
assert.equal(blockedByRestore.busy, true, '恢复期间助手写应 busy')
releaseRun(activeRuns, 'ui:/project', restoreHandle)
const chapterHandle = acquireRun(activeRuns, 'ui:/project', 'chapter-draft', { number: 3 })
const restoreBusy = acquireRun(activeRuns, 'agent:session-2', 'restore-project', {})
assert.equal(restoreBusy.busy, true, '写进行中时恢复应 busy')
releaseRun(activeRuns, 'ui:/project', chapterHandle)
assert.equal(listActiveLocks(activeRuns).length, 0)

// ---------- 6) 助手执行期间 UI 视角能看到 agent 锁 ----------
const agentRun = await (async () => {
  // 用 patch（会调 service）观察执行期间的锁
  let during = null
  service.patchChapterText = async () => {
    during = listActiveLocks(activeRuns)
    return { replaced: 1 }
  }
  const result = await tool('novel_chapter').execute({ action: 'patch', number: 7, find: 'a', replace: 'b' }, { agent: 'session-3', signal: null })
  return { result, during }
})()
assert.equal(agentRun.result.ok, undefined)
assert.ok(Array.isArray(agentRun.during))
assert.equal(agentRun.during.length, 1, '执行期间应有 1 把 agent 锁')
assert.match(agentRun.during[0].owner, /^agent:/)
assert.equal(agentRun.during[0].resource, 'chapter:7')
assert.equal(listActiveLocks(activeRuns).length, 0, '执行结束锁应释放')

service.disposeStores?.()
await rm(home, { recursive: true, force: true })
console.log('tool locks tests passed')
