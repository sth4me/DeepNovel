// 字数下限与自动扩写：短稿触发扩写、达标判定、仍短保存最长版+warning、扩写失败不阻塞。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-word-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-word-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { buildChapterUserPrompt } = await import('../templates.js')

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

const countChinese = (text) => (String(text).match(/[\u4e00-\u9fff]/g) ?? []).length
const shortDraft = '他在雨里走了很久。'.repeat(40)
const longDraft = '他在雨里走了很久，脚下的青石板浮着一层水光。他停下来，回头看了一眼前面长长的巷子，把领口往上拉了拉，继续走。'.repeat(40)

await service.initProject(project, { title: '字数测试' })
await service.writeJson(project, 'story/project.json', { schemaVersion: 1, title: '字数测试', automation: { autoAudit: false, autoFix: false } })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: '主角', length: { chapters: 10, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { pov: 'third-limited', chapterWords: 2000 }, samples: [] })
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed',
  characters: [{ id: 'c1', name: '主角', role: '主角', description: '主角' }, { id: 'c2', name: '配角', role: '配角', description: '配角' }],
  locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标',
    cast: [{ name: '主角', roleInVolume: '主角', fromChapter: 1, importance: '主角' }],
    chapters: [{ id: 'ch-001', number: 1, title: '第1章', synopsis: '主角在雨夜追查线索。', status: 'confirmed', wordBudget: 2000, change: '拿到线索', storyQuestion: '谁寄的信', promise: '推进：查信' }],
  }],
})

let draftText = shortDraft
const expandPayloads = []
const expandCalls = []
service.callModel = async (agent, options) => {
  if (options.task === 'draft') return { text: draftText, usage: null, model: null, durationMs: 0 }
  if (options.task === 'expand') {
    expandCalls.push(options)
    const payload = expandPayloads.shift()
    if (payload instanceof Error) throw payload
    return { text: payload ?? '', usage: null, model: null, durationMs: 0 }
  }
  return { text: '', usage: null, model: null, durationMs: 0 }
}
service.callJsonModel = async () => ({ parsed: {}, runId: 'run-test', usage: null })

// ---------- 1) 短稿触发一次扩写 → 达标、原句保留、返回字数信息 ----------
expandPayloads.push(longDraft)
const first = await service.draftChapter(project, { number: 1 })
assert.equal(first.expanded, true, '短稿应触发扩写')
assert.equal(first.wordTarget, 2000, '目标字数应取文风契约 chapterWords')
assert.ok(first.wordCount >= 1600, `扩写后应达到下限，实际 ${first.wordCount}`)
assert.equal(first.wordCountWarning, null)
assert.equal(first.wordCount, countChinese(longDraft))
assert.ok(expandCalls[0].messages[0].content[0].text.includes('目标字数：2000'), '扩写 prompt 应含目标字数')
assert.ok(expandCalls[0].messages[0].content[0].text.includes('【现有正文】'), '扩写 prompt 应含现有正文')
assert.ok(expandCalls[0].messages[0].content[0].text.includes('主角'), '扩写 prompt 应含本卷阵容')
assert.ok(expandCalls[0].messages[0].content[0].text.includes('他在雨里走了很久'), '扩写输入应包含原句')
const draftAfter = await service.readText(project, 'story/chapters/001/draft.md')
assert.equal(draftAfter.trim(), longDraft.trim(), '写盘应为扩写后的完整正文')
assert.ok(draftAfter.includes('他在雨里走了很久'), '扩写结果应保留原句（不改变情节）')

// ---------- 2) 扩写仍不足 → 再试一次，保存最长版 + warning ----------
const shortA = '雨还在下。'.repeat(150)      // ~600 汉字
const shortB = '雨还在下，他把伞收起来。'.repeat(100)
expandPayloads.push(shortA, shortB)
const second = await service.draftChapter(project, { number: 1 })
assert.equal(second.expanded, true)
assert.ok(second.wordCountWarning && second.wordCountWarning.includes('80%'), '不足下限应返回 warning')
assert.ok(second.wordCount >= countChinese(shortA), '应保存两次中最长的版本')
const draftSecond = await service.readText(project, 'story/chapters/001/draft.md')
assert.equal(draftSecond.trim(), (countChinese(shortB) >= countChinese(shortA) ? shortB : shortA).trim(), '写盘应为最长版本')

// ---------- 3) 扩写失败不阻塞 draft ----------
expandPayloads.push(new Error('expand boom'))
draftText = shortDraft
const third = await service.draftChapter(project, { number: 1 })
assert.ok(third.runId, '扩写失败时 draft 仍应成功')
assert.equal(third.expanded, false)
assert.ok(third.wordCountWarning && third.wordCountWarning.includes('自动扩写失败'), '应返回扩写失败 warning')
const draftThird = await service.readText(project, 'story/chapters/001/draft.md')
assert.equal(draftThird.trim(), shortDraft.trim(), '扩写失败应保存原稿')

// ---------- 4) 章节 prompt 字数硬约束 ----------
const prompt = buildChapterUserPrompt({
  title: 't', language: 'zh-CN', number: 1, wordBudget: 3000,
  chapter: { number: 1, title: '开端', synopsis: 'x' },
  styleFields: {},
})
assert.ok(prompt.includes('目标 3000 字'), 'prompt 应明确目标字数')
assert.ok(prompt.includes('【字数硬要求】'), 'prompt 应含字数硬要求段')
assert.ok(prompt.includes('低于 2400 字视为未完成'), 'prompt 应写明下限')
assert.ok(prompt.includes('不要用概述句凑字数'), 'prompt 应禁止注水凑字数')

// ---------- 5) 目标字数兜底：style 无 chapterWords 时用章纲 wordBudget ----------
await service.writeJson(project, 'story/style/contract.json', { status: 'confirmed', templateId: 'fast-web', fields: { pov: 'third-limited' }, samples: [] })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标',
    chapters: [{ id: 'ch-001', number: 1, title: '第1章', synopsis: 'x', status: 'confirmed', wordBudget: 2800, change: '变化', storyQuestion: '问题', promise: '承诺' }],
  }],
})
draftText = shortDraft
expandPayloads.push('达标文本。'.repeat(400))
const fourth = await service.draftChapter(project, { number: 1 })
assert.equal(fourth.wordTarget, 2800, '无 style.chapterWords 时应取章纲 wordBudget')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('word budget tests passed')
