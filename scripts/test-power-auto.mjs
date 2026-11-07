// 能力体系：设定生成时自动建立；章节草稿后自动追加能力变化。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-power-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-power-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')

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

await service.initProject(project, { title: '能力自动' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { id: 'p1', title: '北岭', premise: '大雪后少年为商旅带路', genre: ['武侠'], protagonist: '林川', length: { chapters: 60, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'ancient', fields: { pov: 'third-limited' }, samples: [] })

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'r', usage: null })
const powerPayload = {
  system: {
    name: '北岭武阶',
    summary: '外练筋骨、内养真气，共四层。',
    tiers: [
      { name: '粗胚', description: '只有力气' },
      { name: '气感', description: '能觉气' },
      { name: '内息', description: '气走周天' },
      { name: '外放', description: '真气离体' },
    ],
  },
  characters: [
    { name: '林川', tierName: '气感', stage: '初成', abilities: ['越涧'], notes: '身法好，内息未成' },
  ],
}
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'bible.generate.all') {
    return wrap({
      characters: [{ name: '林川', role: '主角', description: '少年' }],
      locations: [{ name: '青石村', description: '山村' }],
      rules: [{ name: '雪封', description: '大雪封山' }],
      factions: [{ name: '青山派', description: '正道大派' }],
      items: [{ name: '铁鞭', description: '旧铁鞭' }],
    })
  }
  if (options.kind === 'bible.power') return wrap(powerPayload)
  if (options.kind === 'chapter.power') {
    return wrap({
      changes: [{ character: '林川', from: '气感初成', to: '气感圆满', summary: '一夜调息，气走小周天' }],
      characters: [{ name: '林川', tierName: '气感', stage: '圆满', notes: '气息已稳' }],
    })
  }
  return wrap({})
}

const bible = await service.generateBible(project, { scope: 'all' })
assert.equal(bible.status, 'candidate')
const power = await service.readJson(project, 'story/power.json')
assert.equal(power.system.name, '北岭武阶', '设定生成应自动建立能力体系')
assert.equal(power.system.tiers.length, 4)
assert.equal(power.characters[0].name, '林川')
assert.equal(power.characters[0].tierName, '气感')

// 章节草稿后自动追加变化
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'vol-1', title: '第一卷', goal: '出山', exitCriteria: '出山', targetChapters: 12, chapters: [{ id: 'ch-001', number: 1, title: '初雪', synopsis: '少年带路', status: 'confirmed' }] }],
})
await service.writeTextFile(project, 'story/chapters/001/draft.md', '林川在旧屋里调息一夜，气走小周天，天亮时气息已稳。')
const updated = await service.updatePowerAfterChapter(project, 1)
assert.equal(updated.updated, true)
const powerAfter = await service.readJson(project, 'story/power.json')
assert.equal(powerAfter.chapterChanges['1'].length, 1)
assert.ok(powerAfter.chapterChanges['1'][0].includes('林川'))
assert.equal(powerAfter.characters[0].stage, '圆满', '角色当前层级应自动更新')

const agentSource = await readFile(new URL('../agent.js', import.meta.url), 'utf8')
assert.ok(agentSource.includes("'power-generate'"), '助手应可重新生成能力体系')
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(clientSource.includes('重新生成能力体系'), '页面应有重新生成入口')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 50))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('power auto tests passed')
