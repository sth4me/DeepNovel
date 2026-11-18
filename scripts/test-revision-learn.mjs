// 修订学习：草稿→定稿差异提炼偏好（只读、不写文件/DB）。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-learn-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-learn-project-'))
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
const service = new NovelWriterService({ fs: fsCtx, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } })

await service.initProject(project, { title: '修订学习测试' })
const iso = new Date().toISOString()
const chapter = (number) => ({ id: `c${number}`, number, title: `第${number}章`, synopsis: '梗概', status: 'confirmed', wordBudget: 3000, inputs: {}, plant: [], payoff: [] })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: null,
  updatedAt: iso,
  volumes: [{ id: 'v1', title: '卷一', chapters: [chapter(1), chapter(2), chapter(3)] }],
})
const drafts = {
  1: '他走进破庙，仿佛整个世界都安静下来。他深吸一口气，缓缓开口。',
  2: '她站在雨里，眼中闪过一丝悲伤。她知道，一切都结束了。',
  3: '战斗开始了。他冲向敌人，嘴角勾起一抹冷笑。',
}
const finals = {
  1: '他走进破庙。庙里没人。他把包袱放下，手指在桌沿敲了两下。',
  2: '她站在雨里。伞没撑开。她把信折好，塞回口袋。',
  3: '战斗开始了。他冲向敌人。刀锋擦过肩膀，他退了半步。',
}
for (const number of [1, 2, 3]) {
  const pad = String(number).padStart(3, '0')
  await service.writeTextFile(project, `story/chapters/${pad}/draft.md`, drafts[number])
  await service.writeTextFile(project, `story/chapters/${pad}/final.md`, finals[number])
  await service.writeJson(project, `story/chapters/${pad}/meta.json`, {
    chapterId: `c${number}`, number, title: `第${number}章`, status: 'approved', wordCount: finals[number].length, updatedAt: iso,
  })
}

let captured = null
let nextParsed = null
service.callJsonModel = async (agent, options) => {
  captured = options
  return { parsed: nextParsed, usage: null, first: { model: null, durationMs: 0 } }
}

// ---------- 1) 正常：返回偏好/统计/章节，prompt 含稳定偏好与证据要求 ----------
nextParsed = {
  summary: '作者偏好短句与动作',
  preferences: [{ dimension: '句式', observation: '删掉套话', evidence: '仿佛→无', rule: '删掉仿佛/一丝类套话' }],
  stats: { chapters: 3 },
}
const result = await service.revisionLearn(project, { count: 3 })
assert.equal(result.summary, '作者偏好短句与动作')
assert.equal(result.preferences.length, 1)
assert.equal(result.preferences[0].rule, '删掉仿佛/一丝类套话')
assert.equal(result.stats.chapters, 3)
assert.equal(typeof result.stats.addedChars, 'number')
assert.equal(typeof result.stats.removedChars, 'number')
assert.ok(result.stats.addedChars >= 0 && result.stats.removedChars >= 0)
assert.deepEqual(result.chapters.map((item) => item.number).sort(), [1, 2, 3])
assert.ok(captured.system.includes('稳定'), 'system 应要求稳定偏好')
assert.ok(captured.system.includes('证据'), 'system 应要求证据')
assert.ok(captured.system.includes('只输出 JSON'))
const userText = captured.messages[0].content[0].text
assert.ok(userText.includes('删除片段'))
assert.ok(userText.includes('新增片段'))
assert.ok(userText.includes('草稿片段'))
assert.ok(userText.includes('定稿片段'))
assert.ok(userText.includes('第1章'))

// ---------- 2) 指定章号只分析该章 ----------
nextParsed = { summary: 's', preferences: [], stats: {} }
const single = await service.revisionLearn(project, { number: 2 })
assert.equal(single.chapters.length, 1)
assert.equal(single.chapters[0].number, 2)
assert.ok(captured.messages[0].content[0].text.includes('第2章'))
assert.equal(captured.messages[0].content[0].text.includes('第1章'), false)

// ---------- 3) count 上限 6 ----------
nextParsed = { summary: 's', preferences: [], stats: {} }
const capped = await service.revisionLearn(project, { count: 100 })
assert.ok(capped.chapters.length <= 6, 'count 上限应为 6')

// ---------- 4) 只有 draft 无 final → 报错 ----------
await unlink(join(project, 'story', 'chapters', '003', 'final.md'))
nextParsed = { summary: 's', preferences: [], stats: {} }
await assert.rejects(() => service.revisionLearn(project, { number: 3 }), /没有可学习的修订/)
const skipped = await service.revisionLearn(project, { count: 3 })
assert.deepEqual(skipped.chapters.map((item) => item.number).sort(), [1, 2], '无定稿的章应被跳过')

// ---------- 5) 模型返回不可解析 → 可读错误 ----------
nextParsed = null
await assert.rejects(() => service.revisionLearn(project, { number: 1 }), /可解析/)

// ---------- 6) 空 preferences 合法 ----------
nextParsed = { summary: '证据不足', preferences: [], stats: {} }
const empty = await service.revisionLearn(project, { number: 1 })
assert.deepEqual(empty.preferences, [])
assert.equal(empty.summary, '证据不足')

// ---------- 7) 只读：章节文件内容不变 ----------
const draftBefore = await readFile(join(project, 'story', 'chapters', '001', 'draft.md'), 'utf8')
const finalBefore = await readFile(join(project, 'story', 'chapters', '001', 'final.md'), 'utf8')
nextParsed = { summary: 's', preferences: [], stats: {} }
await service.revisionLearn(project, { number: 1 })
assert.equal(await readFile(join(project, 'story', 'chapters', '001', 'draft.md'), 'utf8'), draftBefore, 'draft 不应被修改')
assert.equal(await readFile(join(project, 'story', 'chapters', '001', 'final.md'), 'utf8'), finalBefore, 'final 不应被修改')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('revision learn tests passed')
