// 主模型失败时按项目配置降级到备用模型。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-fb-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-fb-project-'))
process.env.DSH_HOME = home

const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await readFile(abs(target))
      return { version: String(info.length) }
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

let calls = []
const llm = {
  listProviders: () => [],
  listModels: async () => [],
  resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
  stream: ({ provider, model }) => {
    calls.push(`${provider}/${model}`)
    return (async function* () {
      if (provider === 'primary') throw new Error('primary failed')
      yield { type: 'text-delta', text: '备用模型输出' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  },
}

const { NovelWriterService } = await import('../service.js')
const service = new NovelWriterService({
  fs: fsCtx,
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  agentDefaultModel: { currentSelection: () => ({ provider: 'primary', model: 'm1' }) },
  llm,
})
await service.initProject(project, { title: '降级测试' })
const current = await service.readJson(project, 'story/project.json')
await service.writeJson(project, 'story/project.json', {
  ...current,
  models: { draft: { provider: 'primary', model: 'm1' }, fallback: { provider: 'backup', model: 'm2' } },
})

const result = await service.callModel(project, {
  task: 'draft',
  system: 'system',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
})
assert.equal(result.text, '备用模型输出', '应返回备用模型输出')
assert.ok(result.fallback, '结果应带降级信息')
assert.equal(result.fallback.to, 'backup/m2')
assert.deepEqual(calls, ['primary/m1', 'backup/m2'], '先主后备，各一次')
const store = await service.storeFor(project)
const runs = store.listRuns(20)
const fallbackRun = runs.find((run) => run.kind === 'model.fallback')
assert.ok(fallbackRun, '降级应写入运行记录')
assert.equal(fallbackRun.fallback.to, 'backup/m2')

// 没有备用模型时主模型错误直接抛出
await service.writeJson(project, 'story/project.json', { ...current, models: { draft: { provider: 'primary', model: 'm1' } } })
await assert.rejects(
  () => service.callModel(project, { task: 'draft', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }),
  /primary failed/,
)

await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('model fallback tests passed')
