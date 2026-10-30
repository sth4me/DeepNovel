// 提示词目录、覆盖、重置、导出导入，以及 v1→v2 覆盖存储升级。
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
const storePath = join(project, 'story', 'prompts', 'system.json')

// 1) 默认目录：每条带 revision:1，未定制时 defaultUpdated=false
const initial = await service.promptCatalog(project)
assert.ok(initial.prompts.length >= 7)
const premise = initial.prompts.find((item) => item.key === 'premise')
assert.equal(premise.customized, false)
assert.equal(premise.revision, 1)
assert.equal(premise.baseRevision, null)
assert.equal(premise.defaultUpdated, false)
assert.equal(premise.hash, premise.defaultHash)
assert.ok(premise.default.includes('premise'))

// 2) 保存改为 v2 结构：写入 text/baseHash/baseRevision，默认未改时不提示 defaultUpdated
const saved = await service.saveSystemPrompt(project, { key: 'premise', content: '自定义构思提示词' })
const savedPremise = saved.prompts.find((item) => item.key === 'premise')
assert.equal(savedPremise.customized, true)
assert.equal(savedPremise.content, '自定义构思提示词')
assert.equal(savedPremise.baseRevision, 1)
assert.equal(savedPremise.defaultUpdated, false)
// 覆盖存储已切到 SQLite：直接打开 DB 校验 v2 结构。
const { openDatabase } = await import('../db.js')
const { NovelStore } = await import('../store.js')
const usedDb = openDatabase(join(project, 'story', 'project.db'))
const rawStore = new NovelStore(usedDb, project)
const stored = rawStore.readPromptOverrides()
usedDb.close()
assert.equal(stored.premise.text, '自定义构思提示词')
assert.equal(stored.premise.baseRevision, 1)
assert.equal(typeof stored.premise.baseHash, 'string')

const overrides = await service.readSystemOverrides(project)
assert.equal(overrides.premise.text, '自定义构思提示词')
assert.equal(overrides.premise.baseRevision, 1)
assert.equal(await service.systemFor(project, 'premise', premise.default), '自定义构思提示词')

// 3) 保存内容与当前默认完全一致时删除覆盖
await service.saveSystemPrompt(project, { key: 'premise', content: premise.default })
assert.equal((await service.readSystemOverrides(project)).premise, undefined)

// 4) 重置恢复默认
await service.saveSystemPrompt(project, { key: 'premise', content: '自定义构思提示词' })
const reset = await service.resetSystemPrompt(project, { key: 'premise' })
assert.equal(reset.prompts.find((item) => item.key === 'premise').customized, false)

// 5) 兼容 v1 纯字符串格式 { [key]: string }
await service.writeJson(project, 'story/prompts/system.json', { premise: '旧版覆盖内容' })
const legacy = await service.readSystemOverrides(project)
assert.equal(legacy.premise.text, '旧版覆盖内容')
assert.equal(legacy.premise.baseHash, null)
assert.equal(legacy.premise.baseRevision, null)
const legacyCatalog = await service.promptCatalog(project)
assert.equal(legacyCatalog.prompts.find((item) => item.key === 'premise').content, '旧版覆盖内容')
assert.equal(await service.systemFor(project, 'premise', premise.default), '旧版覆盖内容')

// 6) 用户覆盖基于旧默认（baseRevision 落后）→ defaultUpdated=true
await service.writeJson(project, 'story/prompts/system.json', {
  version: 2,
  overrides: { premise: { text: '基于旧默认的覆盖', baseHash: 'oldhash', baseRevision: 0 } },
})
const stale = (await service.promptCatalog(project)).prompts.find((item) => item.key === 'premise')
assert.equal(stale.customized, true)
assert.equal(stale.baseRevision, 0)
assert.equal(stale.defaultUpdated, true)

// 7) 未真正手改的覆盖（文本 hash 等于 baseHash）→ systemFor 自动跟进当前默认
const oldDefault = '旧版默认内容'
await service.writeJson(project, 'story/prompts/system.json', {
  version: 2,
  overrides: { premise: { text: oldDefault, baseHash: service.hashInputs(oldDefault).slice(0, 16), baseRevision: 1 } },
})
assert.equal(await service.systemFor(project, 'premise', premise.default), premise.default)

// 8) 导出带 version 2，导入兼容 v1/v2
await service.saveSystemPrompt(project, { key: 'premise', content: '自定义构思提示词' })
const exported = await service.exportSystemPrompts(project)
assert.equal(exported.version, 2)
assert.equal(exported.prompts.find((item) => item.key === 'premise').customized, true)
assert.equal(exported.prompts.find((item) => item.key === 'premise').revision, 1)
const imported = await service.importSystemPrompts(project, { data: exported })
assert.ok(imported.imported >= 1)
assert.equal(imported.catalog.prompts.find((item) => item.key === 'premise').content, '自定义构思提示词')

const v1 = { version: 1, prompts: [{ key: 'premise', customized: true, content: '来自 v1 的覆盖' }] }
const importedV1 = await service.importSystemPrompts(project, { data: v1 })
assert.equal(importedV1.imported, 1)
assert.equal(importedV1.catalog.prompts.find((item) => item.key === 'premise').content, '来自 v1 的覆盖')

// 兼容最早期 { [key]: string } 形式
const importedMap = await service.importSystemPrompts(project, { data: { outline: '来自 map 的覆盖' } })
assert.equal(importedMap.imported, 1)
assert.equal(importedMap.catalog.prompts.find((item) => item.key === 'outline').content, '来自 map 的覆盖')

// 9) 批量保存同步新结构
const bulk = await service.saveSystemOverrides(project, { premise: '批量保存内容' })
assert.equal(bulk.premise.text, '批量保存内容')
assert.equal(bulk.premise.baseRevision, 1)
assert.equal((await service.readSystemOverrides(project)).premise.text, '批量保存内容')

// 10) 分类元数据 + 渲染预览（prompt-preview）
const catalogNow = await service.promptCatalog(project)
const groups = new Set(['premise', 'style', 'outline', 'bible', 'chapter', 'review', 'craft', 'data', 'other'])
for (const item of catalogNow.prompts) {
  assert.ok(groups.has(item.group), `未知 group：${item.key} → ${item.group}`)
  assert.ok(Array.isArray(item.tags), `${item.key} tags 应为数组`)
}
assert.equal(new Set(catalogNow.prompts.map((item) => item.key)).size, catalogNow.prompts.length, 'key 应唯一')
// 清掉前面的覆盖，验证无覆盖时的预览
await service.resetSystemPrompt(project, { key: 'premise' })
const preview = await service.previewPromptTemplate(project, { key: 'premise' })
assert.equal(preview.key, 'premise')
assert.equal(preview.group, 'premise')
assert.ok(Array.isArray(preview.tags) && preview.tags.length > 0)
assert.ok(preview.defaultText.length > 0)
assert.equal(preview.currentText, preview.defaultText, '无覆盖时 currentText 等于默认')
assert.equal(preview.customized, false)
assert.equal(preview.baseRevision, null)
assert.equal(preview.revision, 1)
assert.deepEqual(preview.variables, [])
await service.saveSystemPrompt(project, {
  key: 'premise',
  content: '请围绕 {{theme}} 写一段，${protagonist} 出场，再次强调 {{theme}}。',
})
const customizedPreview = await service.previewPromptTemplate(project, { key: 'premise' })
assert.equal(customizedPreview.customized, true)
assert.equal(customizedPreview.currentText, '请围绕 {{theme}} 写一段，${protagonist} 出场，再次强调 {{theme}}。')
assert.equal(customizedPreview.baseRevision, 1)
assert.equal(customizedPreview.revision, 1)
assert.deepEqual(customizedPreview.variables, ['theme', 'protagonist'], '应提取 {{name}} 与 ${name} 并去重')
await assert.rejects(() => service.previewPromptTemplate(project, { key: 'no-such' }), /未知提示词/)
const catalogItem = (await service.promptCatalog(project)).prompts.find((item) => item.key === 'premise')
assert.equal(catalogItem.group, 'premise')
assert.ok(Array.isArray(catalogItem.tags))

console.log('prompt catalog tests passed')
