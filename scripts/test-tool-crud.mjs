// 工具补齐：构思/文风/章纲/素材的 update/delete，以及章纲 agency/device 局部修补。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-crud-home-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { apply } = await import('../agent.js')
const { setNovelWriter } = await import('../runtime.js')

const abs = (target) => join(target.cwd, target.relativePath)
const service = new NovelWriterService({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: {
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
    listDir: async () => [],
    processPath: (target) => abs(target),
  },
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})
setNovelWriter(service)

const project = await mkdtemp(join(tmpdir(), 'deepnovel-crud-project-'))
await service.initProject(project, { title: 'CRUD 测试' })

// 构思 update/delete
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { id: 'p1', title: '旧标题', premise: '旧构思', genre: ['武侠'], protagonist: '主角', length: { chapters: 10, wordsPerChapter: 3000 } },
})
const updated = await service.updatePremise(project, { title: '新标题', genre: ['武侠', '悬疑'] })
assert.equal(updated.chosen.title, '新标题')
assert.deepEqual(updated.chosen.genre, ['武侠', '悬疑'])
await service.deletePremise(project)
assert.equal(await service.readJson(project, 'story/premise.json').catch(() => null), null, '构思应被删除')

// 文风 update/delete
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', fields: { pov: 'third', sentenceLength: 'long' } })
const styleUpdated = await service.updateStyleFields(project, { sentenceLength: 'short', dialogueRatio: 0.3 })
assert.equal(styleUpdated.fields.sentenceLength, 'short')
await service.deleteStyleContract(project)
assert.equal(await service.readJson(project, 'story/style/contract.json').catch(() => null), null, '文风契约应被删除')

// 章纲 delete（只删章纲、重排后续章号）
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate',
  volumes: [{ id: 'vol-1', title: '第一卷', chapters: [
    { id: 'c1', number: 1, title: '一' },
    { id: 'c2', number: 2, title: '二' },
    { id: 'c3', number: 3, title: '三' },
  ] }],
})
const deleted = await service.deleteOutlineChapter(project, { number: 2 })
assert.equal(deleted.deleted, 2)
const outline = await service.readJson(project, 'story/plot/outline.json')
const numbers = outline.volumes[0].chapters.map((chapter) => chapter.number)
assert.deepEqual(numbers, [1, 2], '删除后后续章号应前移')
assert.equal(outline.volumes[0].chapters[1].title, '三')

// 修订预览：buildRevisionPlan 必须能拿到 signal（曾因未定义 signal 报错）
await service.writeTextFile(project, 'story/chapters/001/draft.md', '第一段原文。\n\n第二段原文。')
service.callModel = async () => ({ text: '第一段改直白。\n\n第二段改直白。', usage: null, model: null, durationMs: 0 })
const preview = await service.previewRevision(project, { number: 1, instruction: '改直白' })
assert.ok(preview.nextText.includes('改直白'), '修订预览应返回改写文本')

// 素材 save/list/update/delete
const material = await service.materialSave(project, { title: '参考', kind: '片段', content: '雨夜，刀光。', tags: ['雨', '刀'] })
assert.ok(material.id)
const listed = await service.materialsList(project)
assert.equal(listed.materials.length, 1)
await service.materialSave(project, { id: material.id, content: '雨夜，刀光，血。' })
assert.equal((await service.materialsList(project)).materials[0].content, '雨夜，刀光，血。')
await service.materialDelete(project, { id: material.id })
assert.equal((await service.materialsList(project)).materials.length, 0)

// 工具声明：新增动作存在
const tools = []
apply({ tools: { register: (tool) => tools.push(tool) }, systemPrompt: { section: () => {} } })
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
assert.ok(byName.novel_premise.parameters.properties.action.enum.includes('update'))
assert.ok(byName.novel_premise.parameters.properties.action.enum.includes('delete'))
assert.ok(byName.novel_style.parameters.properties.action.enum.includes('update'))
assert.ok(byName.novel_style.parameters.properties.action.enum.includes('delete'))
assert.ok(byName.novel_outline.parameters.properties.action.enum.includes('delete'))
assert.ok(byName.novel_outline.parameters.properties.action.enum.includes('volume-update'))
assert.ok(byName.novel_outline.parameters.properties.action.enum.includes('volume-delete'))
assert.ok(byName.novel_cast.parameters.properties.action.enum.includes('delete'))
assert.ok(byName.novel_material, '应有素材工具')

const agentSource = await readFile(new URL('../agent.js', import.meta.url), 'utf8')
assert.ok(agentSource.includes('deleteOutlineChapter'), '应支持只删章纲')
assert.ok(agentSource.includes('materialDelete'), '素材应支持删除')

service.disposeStores?.()
await new Promise((resolve) => setTimeout(resolve, 50))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('tool crud tests passed')
