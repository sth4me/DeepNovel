// 旧版助手工具注册：确认文件存储改造后工具仍在，且资料库工具带类型语义。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-tools-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-tools-project-'))
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
const { NovelWriterService } = await import('../service.js')
const service = new NovelWriterService({ fs: fsCtx, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } })
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
setNovelWriter(service)

const tools = []
apply({ tools: { register: (tool) => tools.push(tool) }, systemPrompt: { section: () => {} } })
const names = tools.map((tool) => tool.name)
for (const expected of ['novel_reference', 'novel_material', 'novel_facts', 'novel_query']) {
  assert.ok(names.includes(expected), `应注册 ${expected}`)
}

const referenceTool = tools.find((tool) => tool.name === 'novel_reference')
assert.ok(referenceTool.description.includes('原作'), '工具描述要说明类型语义')

await service.initProject(project, { title: '工具测试' })
const listed = await referenceTool.execute({ action: 'list' }, { agent: project, signal: null })
assert.equal(listed.kinds.length, 4, '四种资料类型都要返回')
assert.ok(listed.kinds.every((kind) => kind.description.length > 5), '每种类型都要有语义说明')

const saved = await referenceTool.execute({
  action: 'save',
  title: '原作设定',
  kind: 'original',
  content: '世界观',
}, { agent: project, signal: null })
assert.equal(saved.kind, 'original')

const got = await referenceTool.execute({ action: 'get', id: saved.id }, { agent: project, signal: null })
assert.equal(got.content, '世界观')

const removed = await referenceTool.execute({ action: 'delete', id: saved.id }, { agent: project, signal: null })
assert.equal(removed.deleted, true)

await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('agent tools tests passed')
