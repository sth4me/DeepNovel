// 跨项目角色库与提示词版本化测试。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-library-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-library-project-'))
process.env.DSH_HOME = home

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

const { NovelWriterService } = await import('../service.js')
const service = new NovelWriterService(ctx)

await mkdir(join(project, 'story', 'bible'), { recursive: true })
await writeFile(join(project, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: '测试书' }), 'utf8')
const writeBible = async (characters) => {
  await writeFile(
    join(project, 'story', 'bible', 'index.json'),
    JSON.stringify({ status: 'confirmed', characters, locations: [], rules: [], factions: [], items: [] }, null, 2),
    'utf8',
  )
}
const readBible = async () => JSON.parse(await readFile(join(project, 'story', 'bible', 'index.json'), 'utf8'))

await writeBible([
  { id: 'C#01', name: '陆迟', role: '主角', description: '沉默的刀客', traits: ['寡言'], goal: '找到仇人' },
])

// 存入库
const saved = await service.saveLibraryCharacter(project, { name: '陆迟' })
assert.equal(saved.saved.name, '陆迟')
assert.equal(saved.saved.source.projectTitle, '测试书')
assert.equal(saved.updated, false)
const files = await readdir(join(home, 'novel-writer', 'library', 'characters'))
assert.equal(files.length, 1)

// 同名再存 → 覆盖而不是新增
const savedAgain = await service.saveLibraryCharacter(project, { name: '陆迟' })
assert.equal(savedAgain.updated, true)
assert.equal((await readdir(join(home, 'novel-writer', 'library', 'characters'))).length, 1)

// 项目里没有的角色 → 报错
await assert.rejects(() => service.saveLibraryCharacter(project, { name: '不存在' }), /没有这个角色/)

// 列表
const listed = await service.listLibraryCharacters()
assert.equal(listed.characters.length, 1)
assert.equal(listed.characters[0].name, '陆迟')

// 导入到另一个项目（新项目 → 新增）
const project2 = await mkdtemp(join(tmpdir(), 'deepnovel-library-project2-'))
await mkdir(join(project2, 'story', 'bible'), { recursive: true })
await writeFile(join(project2, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: '第二本' }), 'utf8')
await writeFile(
  join(project2, 'story', 'bible', 'index.json'),
  JSON.stringify({ status: 'confirmed', characters: [], locations: [], rules: [], factions: [], items: [] }),
  'utf8',
)
const importedNew = await service.importLibraryCharacter(project2, { id: listed.characters[0].id })
assert.equal(importedNew.imported, true)
assert.equal(importedNew.merged, false)
const bible2 = await service.readBible(project2)
assert.equal(bible2.characters.length, 1)
assert.equal(bible2.characters[0].name, '陆迟')
assert.ok(/^C#\d+/.test(bible2.characters[0].id), '新角色 id 符合 C#NN 规则')

// 导入到已有同名角色的项目 → 合并
const importedMerge = await service.importLibraryCharacter(project, { id: listed.characters[0].id })
assert.equal(importedMerge.merged, true)
const bible = await service.readBible(project)
assert.equal(bible.characters.length, 1, '合并时不应重复新增')
assert.equal(bible.characters[0].description, '沉默的刀客')

// 路径穿越被拒
await assert.rejects(() => service.deleteLibraryCharacter({ id: '../escape' }), /无效的角色卡 id/)
await assert.rejects(() => service.deleteLibraryCharacter({ id: '..' }), /无效的角色卡 id/)
await assert.rejects(() => service.deleteLibraryCharacter({ id: 'not-exists' }), /找不到/)

// 删除
const removed = await service.deleteLibraryCharacter({ id: listed.characters[0].id })
assert.equal(removed.deleted, listed.characters[0].id)
assert.equal((await service.listLibraryCharacters()).characters.length, 0)

// 提示词版本化：未覆盖 → defaultUpdated=false，revision 存在
const catalog = await service.promptCatalog(project)
const entry = catalog.prompts.find((item) => item.key === 'draft')
assert.ok(entry, 'draft 提示词存在')
assert.equal(entry.customized, false)
assert.equal(entry.defaultUpdated, false)
assert.equal(entry.revision, 1)
assert.equal(entry.baseRevision, null)

// 保存自定义 → defaultUpdated=false（基于当前版本），systemFor 返回自定义
await service.saveSystemPrompt(project, { key: 'draft', content: '自定义正文 system' })
const afterSave = await service.promptCatalog(project)
const savedEntry = afterSave.prompts.find((item) => item.key === 'draft')
assert.equal(savedEntry.customized, true)
assert.equal(savedEntry.baseRevision, 1)
assert.equal(savedEntry.defaultUpdated, false)
assert.equal(await service.systemFor(project, 'draft', '内置默认'), '自定义正文 system')

// 模拟「基于旧版本的覆盖」→ defaultUpdated=true（通过 service 写覆盖存储）
const writeOverrides = async (overrides) => {
  await service.writeJson(project, 'story/prompts/system.json', { version: 2, overrides })
}
await writeOverrides({ draft: { text: '自定义正文 system', baseHash: 'stale-hash', baseRevision: 0 } })
const staleEntry = (await service.promptCatalog(project)).prompts.find((item) => item.key === 'draft')
assert.equal(staleEntry.defaultUpdated, true)
assert.equal(staleEntry.baseRevision, 0)

// 覆盖内容就是「基于的那版默认」时，systemFor 自动跟进当前默认
const defaultText = (await service.promptCatalog(project)).prompts.find((item) => item.key === 'draft').default
const raw2 = await service.readSystemOverrides(project)
raw2.draft = { text: defaultText, baseHash: 'whatever', baseRevision: 0 }
await writeOverrides(raw2)
assert.equal(await service.systemFor(project, 'draft', defaultText), defaultText)

// 旧版纯字符串格式仍可读
await service.writeJson(project, 'story/prompts/system.json', { draft: '旧格式覆盖' })
assert.equal(await service.systemFor(project, 'draft', defaultText), '旧格式覆盖')
const legacyEntry = (await service.promptCatalog(project)).prompts.find((item) => item.key === 'draft')
assert.equal(legacyEntry.customized, true)

console.log('character library + prompt revision tests passed')
