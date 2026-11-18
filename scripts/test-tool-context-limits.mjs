// 助手工具上下文预算：分页/分块/检索/大纲展开 + truncated/next* 标记。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-budget-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-budget-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')
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
  listDir: async (target) => (await readdir(abs(target), { withFileTypes: true })).map((entry) => ({
    type: entry.isDirectory() ? 'directory' : 'file',
    name: entry.name,
  })),
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
const registered = []
apply({
  tools: { register: (tool) => registered.push(tool) },
  systemPrompt: { section: () => {} },
})
const tool = (name) => registered.find((item) => item.name === name)
const chapter = (args) => tool('novel_chapter').execute(args, { agent: project, signal: null })
const query = (args) => tool('novel_query').execute(args, { agent: project, signal: null })

const iso = new Date().toISOString()
await service.initProject(project, { title: '300章预算' })
const volumes = [1, 2, 3].map((v) => ({
  id: `v${v}`,
  title: `第${v}卷`,
  map: '地图',
  goal: '目标',
  chapters: Array.from({ length: 100 }, (_, i) => {
    const number = (v - 1) * 100 + i + 1
    return {
      id: `c${number}`,
      number,
      title: `第${number}章`,
      synopsis: `第${number}章的剧情梗概，破庙里遇到神秘人。`,
      status: 'confirmed',
      wordBudget: 3000,
      inputs: {},
      plant: [],
      payoff: [],
    }
  }),
}))
await service.writeJson(project, 'story/plot/outline.json', { status: 'confirmed', logline: '一句话', volumes, updatedAt: iso })
const longDraft = '林昭在雨夜的破庙里遇到神秘人，对方留下半块玉佩。'.repeat(90) // 约 2000+ 字
const hugeDraft = '林昭在雨夜的破庙里遇到神秘人，对方留下半块玉佩。'.repeat(270) // 约 8000 字
for (const number of [1, 2, 3]) {
  const pad = String(number).padStart(3, '0')
  const body = number === 2 ? hugeDraft : longDraft
  await mkdir(join(project, 'story', 'chapters', pad), { recursive: true })
  await service.writeTextFile(project, `story/chapters/${pad}/draft.md`, body)
  await service.writeJson(project, `story/chapters/${pad}/meta.json`, {
    chapterId: `c${number}`, number, title: `第${number}章`, status: 'drafted', wordCount: body.length, updatedAt: iso,
  })
}

// ---------- 1) novel_chapter list 默认 40 条 + 翻页 ----------
const page1 = await chapter({ action: 'list' })
assert.equal(page1.total, 300, 'total 应为全量章节数')
assert.equal(page1.chapters.length, 30, '默认只返回 30 条')
assert.equal(page1.limit, 30)
assert.equal(page1.offset, 0)
assert.equal(page1.truncated, true)
assert.equal(page1.nextOffset, 30)
assert.equal(page1.chapters[0].number, 1)
assert.ok(page1.chapters[0].summary.length <= 60, 'summary 应截断 60 字')
assert.equal(typeof page1.chapters[0].hasDraft, 'boolean')
const page2 = await chapter({ action: 'list', offset: page1.nextOffset })
assert.equal(page2.chapters[0].number, 31, 'offset 翻页应从第 31 章开始')
assert.equal(page2.offset, 30)
const lastPage = await chapter({ action: 'list', offset: 280 })
assert.equal(lastPage.chapters.length, 20)
assert.equal(lastPage.truncated, false)
assert.equal(lastPage.nextOffset, null)
const bigPage = await chapter({ action: 'list', limit: 500 })
assert.equal(bigPage.chapters.length, 200, 'limit 上限 200')
const drafted = await chapter({ action: 'list', status: 'drafted' })
assert.equal(drafted.total, 3, 'status 过滤应只剩 3 章')
const volume2 = await chapter({ action: 'list', volumeId: 'v2' })
assert.equal(volume2.total, 100)
assert.equal(volume2.chapters[0].number, 101, 'volumeId 过滤后从第 101 章开始')

// ---------- 2) novel_chapter read 分块 ----------
const readDefault = await chapter({ action: 'read', number: 2 })
assert.equal(readDefault.hasDraft, true)
assert.ok(readDefault.draft.text.length > 0)
assert.equal(readDefault.draft.truncated, hugeDraft.length > 6000, '默认 6000 字上限')
assert.equal(readDefault.draft.text.length, 6000, '默认 read 应截到 6000 字')
assert.ok(readDefault.wordCount > 0)
const readChunk = await chapter({ action: 'read', number: 1, maxChars: 500, part: 'draft' })
assert.equal(readChunk.draft.truncated, true)
assert.equal(readChunk.draft.text.length, 500)
assert.deepEqual(readChunk.draft.nextRange, { start: 500, end: 1000 })
assert.equal(readChunk.truncated, true)
assert.equal('final' in readChunk, false, 'part=draft 时不应返回 final')
const readRange = await chapter({ action: 'read', number: 1, range: { start: 100, end: 300 }, part: 'draft' })
assert.equal(readRange.draft.text.length, 200)
assert.equal(readRange.draft.start, 100)
assert.equal(readRange.draft.end, 300)
assert.equal(readRange.draft.truncated, true, '区间外还有内容 → truncated')
const readTail = await chapter({ action: 'read', number: 1, range: { start: 0, end: longDraft.length }, part: 'draft' })
assert.equal(readTail.draft.truncated, false)
assert.equal(readTail.draft.text.length, longDraft.length)
assert.ok(readChunk.revisions.length <= 3, 'revisions 只回前 3 个文件名')

// ---------- 3) novel_chapter search ----------
const search = await chapter({ action: 'search', number: 1, query: '半块玉佩' })
assert.ok(search.hits.length >= 1)
assert.equal(search.hits[0].target, 'draft')
assert.ok(search.hits[0].index >= 0)
assert.ok(search.hits[0].context.includes('半块玉佩'))
assert.ok(search.hits[0].context.length <= 80 + 4 + 80 + 2)
const searchLimited = await chapter({ action: 'search', number: 1, query: '神秘人', limit: 2 })
assert.ok(searchLimited.hits.length <= 2)
assert.equal(searchLimited.truncated, true, '命中被 limit 截断时 truncated=true')
const searchFinal = await chapter({ action: 'search', number: 1, query: '不存在片段' })
assert.equal(searchFinal.hits.length, 0)

// ---------- 4) novel_query outline 默认不展开 / expand 受 limit ----------
const outlineDefault = await query({ kind: 'outline' })
assert.equal(outlineDefault.expanded, false)
assert.equal(outlineDefault.volumes.length, 3)
assert.equal(outlineDefault.volumes[0].chapterCount, 100)
assert.equal('chapters' in outlineDefault.volumes[0], false, '默认不展开章节')
const outlineExpanded = await query({ kind: 'outline', expand: 'chapters' })
assert.equal(outlineExpanded.expanded, true)
assert.equal(outlineExpanded.chapters.length, 20, 'expand 默认 20 条')
assert.equal(outlineExpanded.total, 300)
assert.equal(outlineExpanded.truncated, true)
assert.equal(outlineExpanded.nextNumber, 21)
const outlineRange = await query({ kind: 'outline', expand: 'chapters', fromNumber: 250, toNumber: 260 })
assert.equal(outlineRange.total, 11)
assert.equal(outlineRange.chapters.length, 11)
assert.equal(outlineRange.chapters[0].number, 250)
const outlineVolume = await query({ kind: 'outline', expand: 'chapters', volumeId: 'v3' })
assert.equal(outlineVolume.total, 100)
assert.equal(outlineVolume.chapters[0].number, 201)
const outlineSmall = await query({ kind: 'outline', expand: 'chapters', limit: 5 })
assert.equal(outlineSmall.chapters.length, 5)
assert.equal(outlineSmall.truncated, true)

assert.ok(outlineExpanded.chapters[0].synopsis.length <= 160, 'outline 展开的 synopsis 应截断 160 字')

// ---------- 5) novel_query kind=chapter 无 number 时 limit 默认 30 ----------
const chapterQuery = await query({ kind: 'chapter' })
assert.equal(chapterQuery.chapters.length, 30)
assert.equal(chapterQuery.total, 300)
assert.equal(chapterQuery.truncated, true)
assert.equal(chapterQuery.nextOffset, 30)

// ---------- 6) 典型调用序列化长度 < 8192（不被 DSH 默认裁剪器截断） ----------
const serializeLength = (value) => JSON.stringify(value).length
const typicalLengths = {
  list: serializeLength(page1),
  read: serializeLength(readDefault),
  outline: serializeLength(outlineExpanded),
  search: serializeLength(await chapter({ action: 'search', number: 2, query: '神秘人' })),
}
for (const [name, length] of Object.entries(typicalLengths)) {
  assert.ok(length < 8192, `${name} 典型输出应 <8192 字符，实测 ${length}`)
}
console.log('典型输出长度(JSON 字符数):', typicalLengths)

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('tool context limits tests passed')
