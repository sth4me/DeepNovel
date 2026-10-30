// 多步写操作事务：deleteChapter（删章 + 章号重排）成功路径落库一致；事务内抛错时 DB 回滚无半套状态。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-tx-home-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const abs = (target) => join(target.cwd, target.relativePath)
const statFile = async (path) => {
  try {
    return await stat(path)
  } catch {
    return null
  }
}
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    const info = await statFile(abs(target))
    return info ? { version: String(info.mtimeMs) } : null
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await (await import('node:fs/promises')).writeFile(abs(target), content, 'utf8')
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
  llm: {
    resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
    stream: async function* () {
      yield { type: 'text-delta', text: '{"summary":"摘要","characters":[],"events":[],"openThreads":[]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  },
})

const iso = new Date().toISOString()
const setupProject = async (count) => {
  const project = await mkdtemp(join(tmpdir(), 'deepnovel-tx-project-'))
  await service.initProject(project, { title: `事务${count}章` })
  const volumes = [{
    id: 'v1',
    title: '卷一',
    chapters: Array.from({ length: count }, (_, index) => ({
      id: `c${index + 1}`,
      number: index + 1,
      title: `第${index + 1}章`,
      synopsis: `破庙里遇到神秘人（第${index + 1}章）`,
      status: 'confirmed',
      wordBudget: 3000,
      inputs: {},
      plant: [],
      payoff: [],
    })),
  }]
  await service.writeJson(project, 'story/plot/outline.json', { status: 'confirmed', logline: null, volumes, updatedAt: iso })
  for (let number = 1; number <= count; number += 1) {
    const pad = String(number).padStart(3, '0')
    await mkdir(join(project, 'story', 'chapters', pad), { recursive: true })
    await service.writeTextFile(project, `story/chapters/${pad}/draft.md`, `第${number}章正文：破庙里遇到神秘人。`)
    await service.writeJson(project, `story/chapters/${pad}/meta.json`, {
      chapterId: `c${number}`,
      number,
      title: `第${number}章`,
      status: 'drafted',
      wordCount: 20,
      updatedAt: iso,
    })
    await service.writeJson(project, `story/state/${pad}.json`, {
      chapterId: `c${number}`,
      number,
      title: `第${number}章`,
      summary: `第${number}章摘要`,
      approvedAt: iso,
    })
  }
  await service.writeJson(project, 'story/power.json', {
    schemaVersion: 1,
    status: 'confirmed',
    system: { tiers: [] },
    characters: [],
    chapterChanges: { 3: 'x', 4: 'y', 5: 'z' },
    updatedAt: iso,
  })
  return project
}
const outlineNumbers = async (project) => {
  const outline = await service.readJson(project, 'story/plot/outline.json')
  return (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? []).map((chapter) => Number(chapter.number))
}
const ftsCount = (store, number) => Number(store.db.prepare('SELECT COUNT(*) AS n FROM fts_chapters WHERE number = ?').get(number).n)

// ---------- 1) 成功路径：删第 3 章并重排 ----------
{
  const project = await setupProject(5)
  const store = await service.storeFor(project)
  const result = await service.deleteChapter(project, {
    number: 3,
    snapshot: false,
    removeOutline: true,
    renumber: true,
  })
  assert.equal(result.outlineRemoved, true)
  assert.equal(result.renumbered, true)

  // 大纲：1,2,4,5 → 1,2,3,4
  const numbers = await outlineNumbers(project)
  assert.deepEqual(numbers, [1, 2, 3, 4], '大纲章号应重排连续')
  const outline = await service.readJson(project, 'story/plot/outline.json')
  const titles = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? []).map((chapter) => chapter.title)
  assert.deepEqual(titles, ['第1章', '第2章', '第4章', '第5章'], '重排后标题应随章移动')

  // DB：原第 4、5 章的行迁到 3、4
  assert.equal(store.readChapterMeta(3).title, '第4章', '原第4章的 meta 应迁到第3章')
  assert.equal(store.readChapterMeta(4).title, '第5章', '原第5章的 meta 应迁到第4章')
  assert.equal(store.readChapterMeta(5), null, '原第5章行应被迁移走')
  assert.equal(store.readChapterMeta(5), null)
  assert.equal(ftsCount(store, 5), 0, 'FTS 不应残留原第5章行')
  assert.equal(ftsCount(store, 4), 1, 'FTS 第4章应只有 1 行')

  // 文件：004 → 003、005 → 004，且 005 目录消失
  assert.ok(await statFile(join(project, 'story', 'chapters', '003')), '第3章目录应存在（原第4章）')
  assert.ok(await statFile(join(project, 'story', 'chapters', '004')), '第4章目录应存在（原第5章）')
  assert.equal(await statFile(join(project, 'story', 'chapters', '005')), null, '原第5章目录应已改名')
  const movedBody = await readFile(join(project, 'story', 'chapters', '003', 'draft.md'), 'utf8')
  assert.ok(movedBody.includes('第4章正文'), '目录重命名后第3章正文应是原第4章内容')

  // state 汇总：1..4，无重复
  const state = store.readStateIndex()
  assert.deepEqual(state.chapters.map((chapter) => Number(chapter.number)), [1, 2, 3, 4], 'state 汇总应重排为 1..4')

  // power.chapterChanges 键重排（>3 的键减 1，被删章的键被覆盖）
  const power = await service.readJson(project, 'story/power.json')
  assert.deepEqual(Object.keys(power.chapterChanges).sort(), ['3', '4'], 'power 键应随章号前移（被删章键被覆盖）')

  // 搜索：原第5章正文现在属于第4章
  const search = await service.searchProject(project, { query: '第5章正文' })
  assert.ok(
    search.results.some((item) => item.type === 'chapter' && Number(item.number) === 4),
    'FTS 应随重排把原第5章正文归到第4章',
  )

  service.disposeStores()
  await rm(project, { recursive: true, force: true })
}

// ---------- 2) 失败路径：事务内抛错 → DB 回滚无半套 ----------
{
  const project = await setupProject(3)
  const store = await service.storeFor(project)
  const beforeNumbers = await outlineNumbers(project)
  const beforePower = await service.readJson(project, 'story/power.json')

  service.failHook = (stage) => {
    if (stage === 'delete-chapter') throw new Error('injected failure')
  }
  await assert.rejects(
    () => service.deleteChapter(project, { number: 2, snapshot: false, removeOutline: true, renumber: true }),
    /injected failure/,
    '注入失败应向上抛错（不静默）',
  )
  service.failHook = null

  // DB 必须保持原样（未出现半套：章号仍 1,2,3，行未迁移/未删）
  assert.deepEqual(await outlineNumbers(project), beforeNumbers, '大纲应回滚到删除前')
  assert.ok(store.readChapterMeta(2), '第2章 meta 不应被删除')
  assert.equal(store.readChapterMeta(3).title, '第3章', '第3章 meta 不应被提前重排')
  assert.equal(ftsCount(store, 2), 1, 'FTS 第2章应保留')
  assert.equal(ftsCount(store, 3), 1, 'FTS 第3章应保留')
  const powerAfter = await service.readJson(project, 'story/power.json')
  assert.deepEqual(powerAfter.chapterChanges, beforePower.chapterChanges, 'power.chapterChanges 应回滚')

  service.disposeStores()
  await rm(project, { recursive: true, force: true })
}

// ---------- 3) approveChapter 事务：失败时 meta/state/summary 不落半套 ----------
{
  const project = await setupProject(1)
  const store = await service.storeFor(project)
  await service.writeTextFile(project, 'story/chapters/001/draft.md', '第1章正文：破庙里遇到神秘人。')
  service.failHook = (stage) => {
    if (stage === 'approve') throw new Error('injected approve failure')
  }
  await assert.rejects(() => service.approveChapter(project, { number: 1 }), /injected approve failure/)
  service.failHook = null
  const meta = store.readChapterMeta(1)
  assert.equal(meta.status, 'drafted', '定稿失败后 meta.status 不应变成 approved')
  assert.equal(store.readChapterState(1).approvedAt, iso, '定稿失败后 chapter_state 不应被改成新时间')
  assert.equal(store.readChapterSummary(1), null, '定稿失败后不应写入摘要')

  // 正常定稿：一个事务提交 meta + summary + state
  const approved = await service.approveChapter(project, { number: 1 })
  assert.equal(approved.wordCount > 0, true)
  assert.equal(store.readChapterMeta(1).status, 'approved')
  assert.ok(store.readChapterSummary(1), '正常定稿应写入摘要')
  assert.equal(store.readChapterState(1).approvedAt !== iso, true, '正常定稿应刷新 chapter_state')

  service.disposeStores()
  await rm(project, { recursive: true, force: true })
}

await rm(home, { recursive: true, force: true })
console.log('transaction tests passed')
