// 服务层测试：用 mock ctx 驱动 NovelWriterService，验证注入读写与 callModel 实际发送的 system。
// 全局配置写入临时 DSH_HOME，不污染真实环境。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')

const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await stat(abs(target))
      return { version: String(info.mtimeMs) }
    } catch {
      return null
    }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
}

const streamCalls = []
const ctx = {
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: {
    resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
    stream: async function* (request) {
      streamCalls.push(request)
      yield { type: 'text-delta', text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  },
}

const service = new NovelWriterService(ctx)

// 项目初始化标记
await mkdir(join(project, 'story'), { recursive: true })
await writeFile(
  join(project, 'story', 'project.json'),
  JSON.stringify({ schemaVersion: 1, title: 't', models: {} }),
  'utf8',
)

// 1) 项目级：未设置时为默认（未启用、仅正文类）
const projectDefault = await service.projectInjection(project)
assert.equal(projectDefault.enabled, false)
assert.deepEqual(projectDefault.tasks, ['draft', 'revise', 'fix'])

// 2) 项目级保存与回读
const saved = await service.saveProjectInjection(project, {
  enabled: true,
  position: 'suffix',
  tasks: ['draft'],
  text: ' 项目注入 ',
})
assert.equal(saved.enabled, true)
assert.deepEqual(saved.tasks, ['draft'])
assert.equal(saved.text, ' 项目注入 ')
const projectStored = await service.projectInjection(project)
assert.deepEqual(projectStored, saved)
const fileText = JSON.parse(await readFile(join(project, 'story', 'prompt.json'), 'utf8'))
assert.equal(fileText.text, ' 项目注入 ')

// 3) 全局级：保存到临时 DSH_HOME，未启用时注入文本为空
const globalDefault = service.globalInjectionConfig()
assert.equal(globalDefault.enabled, false)
assert.equal(service.globalInjectionText(), '')

await service.saveGlobalInjection({ enabled: true, position: 'suffix', tasks: [], text: ' 全局注入 ' })
assert.equal(service.globalInjectionText(), '全局注入')
const globalFile = JSON.parse(await readFile(join(home, 'novel-writer', 'prompt-injection.json'), 'utf8'))
assert.equal(globalFile.text, ' 全局注入 ')

// 4) injectedSystemFor：全局在前、项目在后；任务不匹配时只注入全局
const draftSystem = await service.injectedSystemFor(project, 'BASE', 'draft')
assert.equal(draftSystem, 'BASE\n\n全局注入\n\n项目注入')
const outlineSystem = await service.injectedSystemFor(project, 'BASE', 'outline')
assert.equal(outlineSystem, 'BASE\n\n全局注入')

// 5) callModel 实际发送的 system 与 run ledger 一致
await service.callModel(project, { task: 'draft', system: 'BASE', messages: [] })
assert.equal(streamCalls.at(-1).system, 'BASE\n\n全局注入\n\n项目注入')

// 6) callJsonModel 的 ledger 记录注入后的 system
const jsonCalls = []
ctx.llm.stream = async function* (request) {
  jsonCalls.push(request)
  yield { type: 'text-delta', text: '{"candidates":[]}' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const jsonResult = await service.callJsonModel(project, {
  kind: 'test.json',
  task: 'premise',
  system: 'PREMISE BASE',
  messages: [],
  maxTokens: 100,
})
assert.ok(jsonResult.parsed)
const ledger = await service.readRun(project, { runId: jsonResult.runId })
assert.equal(ledger.system, 'PREMISE BASE\n\n全局注入')

// 7) 关闭项目注入后只剩全局
await service.saveProjectInjection(project, { enabled: false, text: '项目注入' })
assert.equal(await service.injectedSystemFor(project, 'BASE', 'draft'), 'BASE\n\n全局注入')

// 8) 关闭全局注入后项目注入独立生效
await service.saveGlobalInjection({ enabled: false, text: '全局注入' })
assert.equal(service.globalInjectionText(), '')
assert.equal(await service.injectedSystemFor(project, 'BASE', 'draft'), 'BASE')

service.disposeStores()
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('prompt injection service tests passed')
