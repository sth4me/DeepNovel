// 取消信号：诊断/修复必须透传 exec.signal，模型流在 abort 后本地立即退出。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-cancel-home-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')

const never = new Promise(() => {})
const service = new NovelWriterService({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: {
    resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
    stat: async () => null,
    readText: async () => '',
    writeText: async () => ({ operation: 'update', version: '1' }),
    listDir: async () => [],
    processPath: (target) => join(target.cwd, target.relativePath),
  },
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: {
    resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
    stream: async function* () {
      yield { type: 'text-delta', text: '正在写' }
      await never
    },
  },
})

const project = await mkdtemp(join(tmpdir(), 'deepnovel-cancel-project-'))
await service.initProject(project, { title: '取消测试' })

const controller = new AbortController()
setTimeout(() => controller.abort(), 30)
const started = Date.now()
await assert.rejects(
  service.callModel(project, { system: 's', messages: [{ role: 'user', content: 'x' }], signal: controller.signal }),
  (error) => error?.code === 'NOVEL_WRITER_CANCELLED',
  'abort 后 callModel 应立即以取消错误退出',
)
assert.ok(Date.now() - started < 2000, '取消不应等待模型自然结束')

const agentSource = await readFile(new URL('../agent.js', import.meta.url), 'utf8')
assert.ok(agentSource.includes('diagnoseChapter(exec.agent, { number: args?.number }, exec.signal)'), 'novel_diagnose 应传 exec.signal')
assert.ok(agentSource.includes('repairChapter(exec.agent, {'), 'novel_repair 应调用 repairChapter')
assert.ok(agentSource.includes('}, exec.signal)'), 'novel_repair 应传 exec.signal')
assert.ok(agentSource.includes('用户主动停止/中断回合时'), '应说明用户中断=放弃当前计划')
assert.ok(agentSource.includes("name: 'deepnovel:workspace-boundary'"), '应注册工作范围边界提示')
assert.ok(agentSource.includes('不要用 shell/Python 直接改 SQLite/JSON'), '应禁止绕过插件直接改库')

const serviceSource = await readFile(new URL('../service.js', import.meta.url), 'utf8')
assert.ok(serviceSource.includes('Promise.race([nextPromise, abortPromise])'), 'callModel 应在等待 chunk 时与 abort 竞速')
assert.ok(serviceSource.includes('throwIfAborted(signal)'), '诊断/修复应在关键点检查取消')

service.disposeStores?.()
await new Promise((resolve) => setTimeout(resolve, 50))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('cancel signal tests passed')
