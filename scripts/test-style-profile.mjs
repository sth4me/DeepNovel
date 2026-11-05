// Phase 3-B：风格指纹（统计 + 注入参考 + 偏离诊断）。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-style-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-style-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { computeStyleProfile, compareStyleProfile, renderStyleProfile } = await import('../style-profile.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')

// ---------- 1) computeStyleProfile：指标计算 ----------
const sample = '他推门进去。屋里没有人。\n\n“谁？”他问。水还是温的。'
const profile = computeStyleProfile([sample])
assert.ok(profile, '应返回指纹')
assert.equal(profile.chapterCount, 1)
assert.equal(profile.characters, 18, `汉字数应为 18，实际 ${profile.characters}`)
assert.equal(profile.metrics.avgSentenceLen, 3.6, '平均句长')
assert.equal(profile.metrics.shortSentenceRatio, 1, '短句比例（全部 ≤10 字）')
assert.equal(profile.metrics.paraSentenceAvg, 2.5, '段落平均句数')
assert.equal(typeof profile.metrics.dialogueRatio, 'number')
assert.ok(profile.metrics.dialogueRatio > 0 && profile.metrics.dialogueRatio < 0.2)
assert.ok(profile.metrics.modifierDensity >= 0 && profile.metrics.modifierDensity <= 1)
assert.equal(computeStyleProfile([]), null, '空文本应安全返回 null')
assert.equal(computeStyleProfile(['   ']), null)
const repeated = computeStyleProfile(['屋子里没有人。屋子里很安静。屋子里有风。'])
assert.ok(repeated.metrics.topWords.some((item) => item.word === '屋子' && item.count >= 2), '高频词应统计重复词')

// ---------- 2) compareStyleProfile：分级 ----------
const base = computeStyleProfile(['他推门。屋里没人。他坐下。水很凉。'])
const same = compareStyleProfile(base, '他推门。屋里没人。他坐下。水很凉。')
assert.equal(same.score, 100)
assert.ok(same.deviations.every((item) => item.level === 'low'), '同文风应全部 low')
const mediumText = '他推门走了很久才停下脚步，屋里的空气有点凉。'
const medium = compareStyleProfile(base, mediumText)
assert.ok(medium.deviations.some((item) => item.metric === 'avgSentenceLen' && item.level !== 'low'), '句长变化应触发偏离')
const highText = '他推开门，慢慢走进屋子，在靠窗的位置坐下，把手里提着的旧皮箱轻轻放在脚边，抬头看着天花板上的裂缝，过了很久才轻轻叹了一口气。'
const high = compareStyleProfile(base, highText)
assert.ok(high.deviations.some((item) => item.metric === 'avgSentenceLen' && item.level === 'high'), '句长大幅偏离应为 high')
const dialogueText = '“你来了。”“我来了。”“坐吧。”“好。”'.repeat(3)
const dialogueDrift = compareStyleProfile(base, dialogueText)
assert.ok(dialogueDrift.deviations.some((item) => item.metric === 'dialogueRatio' && item.level === 'high'), '对话占比绝对差大应为 high')
const rendered = renderStyleProfile(base)
assert.ok(rendered.includes('平均句长') && rendered.includes('短句') && rendered.includes('对话') && rendered.includes('段落'), '渲染摘要应含各指标')

// ---------- 3) buildStyleProfile / getStyleProfile ----------
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
  listDir: async () => [],
  processPath: (target) => abs(target),
}
const service = new NovelWriterService({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})
setNovelWriter(service)

await service.initProject(project, { title: '风格指纹' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: 'a', length: { chapters: 10, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', {
  status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [],
})
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed', characters: [], locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{ id: 'v1', title: '一', chapters: [{ id: 'c1', number: 1, title: '一', synopsis: '概要', status: 'confirmed', wordBudget: 3000 }] }],
})
await assert.rejects(() => service.buildStyleProfile(project), /定稿/, '无定稿应报错')
const finalText = ('他推门。屋里没人。他坐下。水很凉。' .repeat(30))
await service.writeTextFile(project, 'story/chapters/001/final.md', finalText)
const built = await service.buildStyleProfile(project)
assert.equal(built.chapterCount, 1)
assert.ok(built.generatedAt)
const stored = JSON.parse(await readFile(join(project, 'story/style/profile.json'), 'utf8'))
assert.deepEqual(stored.metrics, built.metrics)
const loaded = await service.getStyleProfile(project)
assert.deepEqual(loaded.metrics, built.metrics)

// ---------- 4) draft prompt 含风格指纹块（在文风契约之后） ----------
let draftPrompt = ''
service.callModel = async (agent, options) => {
  if (options.task === 'draft') draftPrompt = options.messages?.[0]?.content?.[0]?.text ?? ''
  return { text: '他推门进去。屋里没人。他坐下。', usage: null, model: null, durationMs: 0 }
}
const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
service.callJsonModel = async () => wrap({})
await service.draftChapter(project, { number: 1 })
assert.ok(draftPrompt.includes('【风格指纹（参考，不覆盖文风契约）】'), 'draft prompt 应含风格指纹块')
assert.ok(draftPrompt.indexOf('【风格指纹（参考，不覆盖文风契约）】') > draftPrompt.indexOf('【文风契约】'), '指纹块应在文风契约之后')

// ---------- 5) diagnoseChapter styleDrift：all 出现、logic 不跑 ----------
const longDraft = '他推开门，慢慢走进屋子，在靠窗的位置坐下，把手里提着的旧皮箱轻轻放在脚边，抬头看着天花板上的裂缝，过了很久才轻轻叹了一口气。'.repeat(6)
await service.writeTextFile(project, 'story/chapters/001/draft.md', longDraft)
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'chapter.logic-audit') return wrap({ logicIssues: [] })
  if (options.kind === 'chapter.review') return wrap({ score: 85, styleIssues: [], continuityIssues: [], aiFlavor: { level: '轻', score: 85 } })
  if (options.kind === 'chapter.story-audit') return wrap({ changeHappened: true, questionProgress: 'advanced', promiseProgress: 'kept', newQuestion: '', causalChain: 'ok', contrived: 'none', issues: [], summary: '' })
  return wrap({})
}
const allDiagnose = await service.diagnoseChapter(project, { number: 1, scope: 'all' })
assert.ok(allDiagnose.styleDrift, 'scope=all 应返回 styleDrift')
assert.ok(Array.isArray(allDiagnose.styleDrift.deviations))
assert.ok(allDiagnose.issues.some((issue) => issue.source === 'styleProfile' && issue.level === 'soft'), '偏离大应生成 soft issue（source styleProfile）')
const logicDiagnose = await service.diagnoseChapter(project, { number: 1, scope: 'logic' })
assert.equal(logicDiagnose.styleDrift, null, 'scope=logic 不跑风格偏离')
const storyDiagnose = await service.diagnoseChapter(project, { number: 1, scope: 'story' })
assert.equal(storyDiagnose.styleDrift, null, 'scope=story 不跑风格偏离')

// ---------- 6) novel_style profile-build / profile-get ----------
const registered = []
apply({ tools: { register: (tool) => registered.push(tool) }, systemPrompt: { section: () => {} } })
const tool = registered.find((item) => item.name === 'novel_style')
assert.ok(tool, '应注册 novel_style')
const toolBuild = await tool.execute({ action: 'profile-build', count: 5 }, { agent: project, signal: null })
assert.ok(toolBuild.metrics?.avgSentenceLen != null)
const toolGet = await tool.execute({ action: 'profile-get' }, { agent: project, signal: null })
assert.ok(toolGet.profile?.metrics)

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('style profile tests passed')
