// 新宿主/Agent 接入测试：工具注册、HTTP API、写提案。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-host-'))
const routes = new Map()
const fakeWebServer = {
  register({ path, handler }) {
    routes.set(path, handler)
    return () => routes.delete(path)
  },
}
const hostCtx = {
  inject(_services, callback) {
    callback({ webServer: fakeWebServer, effect: (fn) => fn })
  },
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const handler = routes.get(url.pathname)
  if (!handler) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  await handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const { apply: applyHost } = await import('../writing/host.js')
applyHost(hostCtx)
assert.ok(routes.has('/deepnovel/api/init'))

const projectResponse = await fetch(`${base}/deepnovel/api/init`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, title: '接入测试', language: 'zh' }),
})
const projectPayload = await projectResponse.json()
assert.equal(projectPayload.ok, true)
assert.equal(projectPayload.data.initialized, true)

const treeResponse = await fetch(`${base}/deepnovel/api/tree?projectRoot=${encodeURIComponent(root)}`)
const treePayload = await treeResponse.json()
assert.equal(treePayload.ok, true)
assert.equal(treePayload.data.map.title, '接入测试')

const searchResponse = await fetch(`${base}/deepnovel/api/search`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, query: '接入测试' }),
})
const searchPayload = await searchResponse.json()
assert.equal(searchPayload.ok, true)
const exportResponse = await fetch(`${base}/deepnovel/api/export`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root }),
})
const exportPayload = await exportResponse.json()
assert.equal(exportPayload.ok, true)
assert.ok(exportPayload.data.content.includes('接入测试'))

const referenceSource = await mkdtemp(join(tmpdir(), 'deepnovel-host-refs-'))
await mkdir(join(referenceSource, 'nested'), { recursive: true })
await writeFile(join(referenceSource, 'canon.md'), '# 原作资料\n\n角色甲的原作记录。\n', 'utf8')
await writeFile(join(referenceSource, 'nested', 'notes.txt'), '研究笔记：角色甲时间线。\n', 'utf8')
const importResponse = await fetch(`${base}/deepnovel/api/references/import`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, sourcePath: referenceSource, kind: 'canon', tags: ['原作'] }),
})
const importPayload = await importResponse.json()
assert.equal(importPayload.ok, true)
assert.equal(importPayload.data.imported, 2)
const runWithoutAgents = await fetch(`${base}/deepnovel/api/run`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, role: 'prose', title: 't', prompt: 'p' }),
})
assert.equal(runWithoutAgents.status, 200)
const runQueued = await runWithoutAgents.json()
assert.ok(runQueued.data.task.id, 'run should enqueue a task')
await new Promise((resolve) => setTimeout(resolve, 50))
const tasksAfterRun = await fetch(`${base}/deepnovel/api/tasks?projectRoot=${encodeURIComponent(root)}`)
const tasksBody = await tasksAfterRun.json()
assert.ok(Array.isArray(tasksBody.data.tasks))
assert.match(tasksBody.data.tasks[0].error, /子代理/)
const runStatus = await fetch(`${base}/deepnovel/api/run/status?sessionIds=`)
assert.equal(runStatus.status, 200)
const emptyStatus = await runStatus.json()
assert.deepEqual(emptyStatus.data.statuses, {})
const runStop = await fetch(`${base}/deepnovel/api/run/stop`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, taskId: 'task-missing' }),
})
const stopBody = await runStop.json()
assert.equal(stopBody.data.stopped, false)

await new Promise((resolve) => setTimeout(resolve, 400))
const tasksFile = join(root, '.dsh-writing', 'tasks.json')
const persisted = JSON.parse(await readFile(tasksFile, 'utf8').catch(() => '{"tasks":[]}'))
assert.ok(Array.isArray(persisted.tasks), '任务记录应写入 .dsh-writing/tasks.json')
assert.ok(persisted.tasks.some((item) => item.title === 't'), '任务记录应包含已提交的任务')

const routingGet = await fetch(`${base}/deepnovel/api/routing?projectRoot=${encodeURIComponent(root)}`)
assert.equal(routingGet.status, 200)
const routingBody = await routingGet.json()
assert.equal(routingBody.ok, true)
assert.equal(routingBody.data.routing.draft.provider, '')
const routingPost = await fetch(`${base}/deepnovel/api/routing`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, routing: { draft: { provider: 'opencode-go', model: 'mimo-v2.6-flash', reasoningEffort: 'off' } } }),
})
const routingSaved = await routingPost.json()
assert.equal(routingSaved.data.routing.draft.model, 'mimo-v2.6-flash')
assert.equal(routingSaved.data.routing.draft.reasoningEffort, 'off')
const modelsResponse = await fetch(`${base}/deepnovel/api/models`)
assert.equal(modelsResponse.status, 200)

const referencesResponse = await fetch(`${base}/deepnovel/api/references?projectRoot=${encodeURIComponent(root)}`)
const referencesPayload = await referencesResponse.json()
assert.equal(referencesPayload.data.sources.length, 2)
const referenceId = referencesPayload.data.sources[0].id
const referenceResponse = await fetch(`${base}/deepnovel/api/reference?projectRoot=${encodeURIComponent(root)}&id=${referenceId}`)
const referencePayload = await referenceResponse.json()
assert.equal(referencePayload.ok, true)
const referenceSearchResponse = await fetch(`${base}/deepnovel/api/references/search`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, query: '角色甲' }),
})
const referenceSearchPayload = await referenceSearchResponse.json()
assert.ok(referenceSearchPayload.data.total >= 2)
const deleteReferenceResponse = await fetch(`${base}/deepnovel/api/references/delete`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, id: referenceId }),
})
assert.equal((await deleteReferenceResponse.json()).ok, true)
await rm(referenceSource, { recursive: true, force: true })

const docResponse = await fetch(`${base}/deepnovel/api/doc?projectRoot=${encodeURIComponent(root)}&kind=book&id=book`)
const docPayload = await docResponse.json()
assert.equal(docPayload.ok, true)
const savedResponse = await fetch(`${base}/deepnovel/api/save`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, kind: 'book', id: 'book', content: '# 全书主线\n\n手动保存测试。\n', expectedHash: docPayload.data.hash }),
})
const savedPayload = await savedResponse.json()
assert.equal(savedPayload.ok, true)
assert.ok(savedPayload.data.content.includes('手动保存测试'))
const revisionsResponse = await fetch(`${base}/deepnovel/api/revisions?projectRoot=${encodeURIComponent(root)}&kind=book&id=book`)
const revisionsPayload = await revisionsResponse.json()
assert.equal(revisionsPayload.ok, true)
assert.ok(revisionsPayload.data.revisions.length >= 1)
const revisionReadResponse = await fetch(`${base}/deepnovel/api/revision?projectRoot=${encodeURIComponent(root)}&name=${encodeURIComponent(revisionsPayload.data.revisions[0].name)}`)
const revisionReadPayload = await revisionReadResponse.json()
assert.equal(revisionReadPayload.ok, true)
assert.ok(revisionReadPayload.data.content.length > 0)

const staleResponse = await fetch(`${base}/deepnovel/api/save`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectRoot: root, kind: 'book', id: 'book', content: '# 全书主线\n\n旧内容\n', expectedHash: docPayload.data.hash }),
})
const stalePayload = await staleResponse.json()
assert.equal(stalePayload.ok, false)

const agentTools = new Map()
const sections = []
const agentCtx = new Proxy({
  workingDirectory: { ensure: async () => root },
  tools: { register: (tool) => agentTools.set(tool.name, tool) },
  get(name) {
    if (name === 'systemPrompt') return { section: (section) => sections.push(section) }
    return undefined
  },
}, {
  get(target, property) {
    if (property === 'systemPrompt') throw new Error('systemPrompt was not injected')
    return target[property]
  },
})
const { apply: applyAgent } = await import('../writing/agent.js')
applyAgent(agentCtx)
assert.ok(agentTools.has('novel_write'))
assert.ok(sections.some((section) => section.name === 'deepnovel:lead-author'))

const initTool = agentTools.get('novel_project')
const initResult = await initTool.execute({ action: 'status' }, { agent: { id: 'test' } })
assert.equal(initResult.map.title, '接入测试')

await new Promise((resolve) => server.close(resolve))
await rm(root, { recursive: true, force: true })
console.log('writing host/agent tests passed')
