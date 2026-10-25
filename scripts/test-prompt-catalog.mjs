// 提示词目录、覆盖、重置、导出导入。
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
    try { const info = await stat(abs(target)); return { version: String(info.mtimeMs) } } catch { return null }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
}
const service = new NovelWriterService({ fs: fsCtx, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } })
await mkdir(join(project, 'story', 'prompts'), { recursive: true })
await writeFile(join(project, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: 't' }), 'utf8')

const initial = await service.promptCatalog(project)
assert.ok(initial.prompts.length >= 7)
const premise = initial.prompts.find((item) => item.key === 'premise')
assert.equal(premise.customized, false)
assert.ok(premise.default.includes('premise'))

const saved = await service.saveSystemPrompt(project, { key: 'premise', content: '自定义构思提示词' })
assert.equal(saved.prompts.find((item) => item.key === 'premise').customized, true)
assert.equal((await service.readSystemOverrides(project)).premise, '自定义构思提示词')

const reset = await service.resetSystemPrompt(project, { key: 'premise' })
assert.equal(reset.prompts.find((item) => item.key === 'premise').customized, false)

await service.saveSystemPrompt(project, { key: 'premise', content: '自定义构思提示词' })
const exported = await service.exportSystemPrompts(project)
assert.equal(exported.prompts.find((item) => item.key === 'premise').customized, true)
const imported = await service.importSystemPrompts(project, { data: exported })
assert.ok(imported.imported >= 1)
assert.equal(imported.catalog.prompts.find((item) => item.key === 'premise').content, '自定义构思提示词')

console.log('prompt catalog tests passed')
