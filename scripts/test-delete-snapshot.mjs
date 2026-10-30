// 删除尾部章节前必须自动创建快照。
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
await mkdir(join(project, 'story', 'plot'), { recursive: true })
await mkdir(join(project, 'story', 'state'), { recursive: true })
await writeFile(join(project, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: 't' }), 'utf8')
await writeFile(join(project, 'story', 'state', 'index.json'), JSON.stringify({ chapters: [] }), 'utf8')
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate',
  logline: null,
  volumes: [{
    id: 'v1',
    title: '卷',
    chapters: [
      { id: 'c1', number: 1, title: '一' },
      { id: 'c2', number: 2, title: '二' },
    ],
  }],
})
const result = await service.deleteTailChapters(project, { count: 1 })
assert.equal(result.from, 2)
assert.ok(result.snapshot?.path, 'snapshot path missing')
const snapshotMeta = join(project, result.snapshot.path, 'snapshot.json')
assert.ok(await stat(snapshotMeta), 'snapshot not created')
const outline = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outline.volumes[0].chapters.length, 1)
console.log('delete snapshot tests passed')
