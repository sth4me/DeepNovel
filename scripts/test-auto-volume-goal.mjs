// 第一卷空目标：根据构思开局自动生成候选卷目标并写入，然后生成章纲；候选失败时阻止生成。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-autogoal-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-autogoal-project-'))
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

await service.initProject(project, { title: '自动卷目标' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: {
    id: 'p1',
    title: '北岭带路',
    premise: '大雪封住山口，一队商旅折了大半人手，领队受伤，领头老者请山里的少年带路翻岭。',
    genre: ['武侠'],
    protagonist: '阿青',
    length: { chapters: 60, wordsPerChapter: 3000 },
  },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'ancient', fields: { pov: 'third-limited', chapterWords: 3000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '阿青', role: '主角', description: '少年', meta: { status: '活跃', firstChapter: 1, importance: '主角' } }],
  locations: [], rules: [], factions: [], items: [],
})

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
const candidates = [
  {
    title: '北岭归途',
    map: '北岭、青石镇、旧驿',
    goal: '把伤员与货箱送出北岭，同时查清岭上第二拨截路的人是谁。',
    whyNow: '大雪封路、追兵已进山，不走就困死。',
    cost: '主角背上引路之约，村里人视他为贪财。',
    risk: '引错路全队死；被对头记住脸。',
    exitCriteria: '人货出山、第二拨人的来路有答案。',
    targetChapters: 12,
  },
  {
    title: '北岭三夜',
    map: '北岭、旧驿、暖谷',
    goal: '封山前把伤员送出北岭，并保住阿禾不被对头带走。',
    whyNow: '对头已点名要阿禾。',
    cost: '主角要丢下羊群与村子。',
    risk: '阿禾被带走。',
    exitCriteria: '伤员出山、阿禾留下。',
    targetChapters: 10,
  },
]
const planPrompts = []
const generatePrompts = []
let planPayload = { candidates }
let generatePayload = { chapters: [{ number: 1, title: '北岭初雪', synopsis: '大雪后，阿青被请去带路。', change: '接下引路', storyQuestion: '能否翻岭', promise: '推进：出山', castUsed: ['阿青'], newNamed: [] }] }
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.volume-plan') {
    planPrompts.push(options.messages?.[0]?.content?.[0]?.text ?? '')
    return wrap(planPayload)
  }
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') {
    generatePrompts.push(options.messages?.[0]?.content?.[0]?.text ?? '')
    return wrap(generatePayload)
  }
  return wrap({})
}

const generated = await service.outlineGenerate(project, { fromChapter: 1, count: 1 })
assert.ok(generated)
const outline = await service.readJson(project, 'story/plot/outline.json')
const volume = outline.volumes[0]
assert.equal(volume.goal, candidates[0].goal, '应自动采用候选 1 的卷目标')
assert.equal(volume.targetChapters, 12, '应写入候选目标章数')
assert.ok(planPrompts[0].includes('大雪封住山口'), '卷规划应包含构思开局')
assert.ok(planPrompts[0].includes('本卷还没有章纲'), '第一卷规划应说明没有章纲')
assert.ok(generatePrompts[0].includes(candidates[0].goal), '生成 prompt 应包含已确认卷目标')

// 候选生成失败时必须阻止生成，不能空目标硬写
await service.writeJson(project, 'story/plot/outline.json', { status: 'candidate', volumes: [{ id: 'vol-1', title: '第 1 卷', goal: '', exitCriteria: '', targetChapters: 0, chapters: [] }] })
planPayload = {}
await assert.rejects(
  () => service.outlineGenerate(project, { fromChapter: 1, count: 1 }),
  /无法生成章纲/,
  '空目标且规划失败时应拒绝生成',
)

const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(clientSource.includes('targetChapters: Number(volumeDraft.targetChapters) || 12'), '卷设置应支持目标章数')
assert.ok(clientSource.includes("run('volume-plan'"), '页面应能生成卷设定')
assert.ok(clientSource.includes("run('volume-select'"), '页面应能采用候选目标')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 50))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('auto volume goal tests passed')
