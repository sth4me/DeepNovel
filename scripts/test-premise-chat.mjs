// 构思对话落盘与候选批次恢复测试。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
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
const ctx = {
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
}
const service = new NovelWriterService(ctx)
await mkdir(join(project, 'story'), { recursive: true })
await writeFile(join(project, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: 't' }), 'utf8')
await writeFile(
  join(project, 'story', 'premise.json'),
  JSON.stringify({ status: 'candidate', candidates: [], chosen: null }),
  'utf8',
)

const candidates = [
  { id: 'c1', logline: '候选一', hook: '钩子一' },
  { id: 'c2', logline: '候选二', hook: '钩子二' },
]
await service.savePremiseChat(project, {
  messages: [
    { id: 'm1', role: 'user', content: '要一个冷硬的故事' },
    { id: 'm2', role: 'assistant', content: '1. 候选一', batchId: 'b1' },
  ],
  batches: [{
    id: 'b1',
    createdAt: new Date().toISOString(),
    mode: 'candidates',
    instruction: '要一个冷硬的故事',
    candidates,
    ideas: [],
  }],
  activeBatchId: 'b1',
})
const loaded = await service.readPremiseChat(project)
assert.equal(loaded.messages.length, 2)
assert.equal(loaded.messages[1].batchId, 'b1')
assert.equal(loaded.batches.length, 1)
assert.equal(loaded.batches[0].candidates.length, 2)
assert.equal(loaded.activeBatchId, 'b1')

// 新一代候选落盘后可以恢复旧批次
await writeFile(
  join(project, 'story', 'premise.json'),
  JSON.stringify({ status: 'candidate', candidates: [{ id: 'new', logline: '新候选' }], chosen: null }),
  'utf8',
)
const restored = await service.restorePremiseBatch(project, { batchId: 'b1' })
assert.equal(restored.candidates.length, 2)
const premise = JSON.parse(await readFile(join(project, 'story', 'premise.json'), 'utf8'))
assert.equal(premise.candidates[0].id, 'c1')
assert.equal(premise.status, 'candidate')

// 讨论消息的可应用动作和 discuss 批次需要保留
await service.savePremiseChat(project, {
  messages: [{ id: 'm3', role: 'assistant', content: '建议改冷硬', actions: [{ type: 'premise-candidate-update', fields: { hook: '更冷' } }] }],
  batches: [{ id: 'b2', mode: 'discuss', instruction: '改冷硬', candidates: [], ideas: [] }],
  activeBatchId: 'b2',
})
const discussed = await service.readPremiseChat(project)
assert.equal(discussed.messages[0].actions.length, 1)
assert.equal(discussed.batches[0].mode, 'discuss')

// 输入截断，避免对话文件无限增长
const long = 'x'.repeat(5000)
await service.savePremiseChat(project, { messages: [{ role: 'user', content: long }] })
const truncated = await service.readPremiseChat(project)
assert.equal(truncated.messages[0].content.length, 4000)

console.log('premise chat tests passed')
