// 任务坞取消：UI 与助手任务能按项目/资源统一中止，不误伤其它项目。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { acquireRun, cancelRunsForProject, listActiveLocks } from '../index.js'

const runs = new Map()
const root = 'D:\\story\\项目A'
const otherRoot = 'D:\\story\\项目B'

const ui = acquireRun(runs, root, 'chapter-draft', { number: 1 }, root)
const helper = acquireRun(runs, 'agent:session-1', 'chapter-draft', { number: 2 }, root)
const otherProject = acquireRun(runs, 'agent:session-2', 'chapter-draft', { number: 5 }, otherRoot)
assert.equal(ui.acquired, true)
assert.equal(helper.acquired, true)
assert.equal(otherProject.acquired, true)

const locks = listActiveLocks(runs)
assert.equal(locks.find((lock) => lock.owner === root)?.projectRoot, root, 'UI 锁应记录项目根')
assert.equal(locks.find((lock) => lock.owner === 'agent:session-1')?.projectRoot, root, '助手锁应记录项目根')

const byResource = cancelRunsForProject(runs, root, 'chapter:2')
assert.equal(byResource, 1, '按资源取消只中止目标资源')
assert.equal(helper.controller.signal.aborted, true, '助手任务应被中止')
assert.equal(ui.controller.signal.aborted, false, '其它资源不应被中止')

const all = cancelRunsForProject(runs, root)
assert.equal(all, 2, '全部取消应覆盖当前项目所有任务')
assert.equal(ui.controller.signal.aborted, true, 'UI 任务应被中止')
assert.equal(otherProject.controller.signal.aborted, false, '其它项目同名资源不应被误伤')

const agentSource = await readFile(new URL('../agent.js', import.meta.url), 'utf8')
assert.ok(agentSource.includes('AbortSignal.any(signals)'), '工具层应合并 exec.signal 与锁 controller.signal')
assert.ok(agentSource.includes('locks.acquire(agentLockOwner(exec), lockAction, args ?? {}, projectRoot)'), '工具层应把项目根写入锁')

const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(clientSource.includes('.nw-task-dock{position:absolute;left:16px;bottom:16px'), '任务坞应在写作台左侧底部，避开宿主右下角 AI 按钮')
assert.ok(clientSource.includes("onClick: () => cancelTask(lock.resource)"), '助手任务行应提供取消按钮')
assert.ok(clientSource.includes("useState(false)") && clientSource.includes('nw-task-dock${taskOpen'), '任务坞默认收起')
assert.ok(!clientSource.includes('可在 AI 页停止'), '移除旧的“可在 AI 页停止”提示')

console.log('task cancel tests passed')
