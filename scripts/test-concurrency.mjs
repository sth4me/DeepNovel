// 并发写（两个独立 service / 两个进程）+ SQLITE_BUSY 有界重试 + 纯文件项目反向导入。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-conc-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-conc-project-'))
const otherProject = await mkdtemp(join(tmpdir(), 'deepnovel-conc-other-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { openDatabase, withBusyRetry, isBusyError } = await import('../db.js')
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
const makeCtx = () => ({
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})
const makeService = () => new NovelWriterService(makeCtx())
const iso = new Date().toISOString()
const pad = (number) => String(number).padStart(3, '0')
const service = makeService()

// 构造 10 章项目（含正文/元数据/大纲）
await service.initProject(project, { title: '并发项目' })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: null,
  updatedAt: iso,
  volumes: [{
    id: 'v1',
    title: '卷一',
    chapters: Array.from({ length: 10 }, (_, index) => ({
      id: `c${index + 1}`,
      number: index + 1,
      title: `第${index + 1}章`,
      synopsis: '破庙里遇到神秘人',
      status: 'confirmed',
      wordBudget: 3000,
      inputs: {},
      plant: [],
      payoff: [],
    })),
  }],
})
for (let number = 1; number <= 10; number += 1) {
  await mkdir(join(project, 'story', 'chapters', pad(number)), { recursive: true })
  await service.writeTextFile(project, `story/chapters/${pad(number)}/draft.md`, `第${number}章：破庙里遇到神秘人。`)
  await service.writeJson(project, `story/chapters/${pad(number)}/meta.json`, {
    chapterId: `c${number}`,
    number,
    title: `第${number}章`,
    status: 'drafted',
    wordCount: 20,
    updatedAt: iso,
  })
}
const store = await service.storeFor(project)
const ftsCount = (number) => Number(store.db.prepare('SELECT COUNT(*) AS n FROM fts_chapters WHERE number = ?').get(number).n)

// ---------- 1) SQLITE_BUSY 有界重试（注入 busy_timeout=1 触发） ----------
{
  const dbPath = join(project, 'story', 'project.db')
  const dbA = openDatabase(dbPath)
  const dbB = openDatabase(dbPath)
  dbB.exec('PRAGMA busy_timeout = 1')
  dbA.exec('BEGIN IMMEDIATE')
  dbA.exec("INSERT OR REPLACE INTO project (id, title) VALUES (1, 'A')")
  let busyError = null
  try {
    dbB.prepare("INSERT OR REPLACE INTO project (id, title) VALUES (1, 'B')").run()
  } catch (error) {
    busyError = error
  }
  assert.ok(busyError && isBusyError(busyError), 'A 持写锁时 B 写入应得到 busy/locked 错误')
  let attempts = 0
  withBusyRetry(() => {
    attempts += 1
    if (attempts === 2) dbA.exec('COMMIT')
    return dbB.prepare("INSERT OR REPLACE INTO project (id, title) VALUES (1, 'B')").run()
  }, { attempts: 3, delayMs: 10 })
  assert.equal(attempts, 2, '重试第二次应成功（A 提交后 B 写入成功）')
  assert.equal(dbB.prepare('SELECT title FROM project WHERE id = 1').get().title, 'B')
  dbA.close()
  dbB.close()
  // 恢复 title，避免影响后续导入一致性断言
  const restore = openDatabase(dbPath)
  restore.exec("UPDATE project SET title = '并发项目' WHERE id = 1")
  restore.close()
}

// ---------- 2) 两个独立 service 实例交替写不同章节（各 100 次） ----------
{
  const svcA = makeService()
  const svcB = makeService()
  await svcA.storeFor(project)
  await svcB.storeFor(project)
  const writer = async (svc, startNumber, tag) => {
    for (let index = 0; index < 100; index += 1) {
      const number = startNumber + (index % 5)
      await svc.writeTextFile(project, `story/chapters/${pad(number)}/draft.md`, `${tag} 第${number}章 #${index}：破庙里遇到神秘人。`)
      await svc.writeJson(project, `story/chapters/${pad(number)}/meta.json`, {
        chapterId: `c${number}`,
        number,
        title: `第${number}章`,
        status: 'drafted',
        wordCount: index,
        updatedAt: iso,
      })
    }
  }
  await Promise.all([writer(svcA, 1, 'A'), writer(svcB, 6, 'B')])
  for (let number = 1; number <= 10; number += 1) {
    const meta = store.readChapterMeta(number)
    assert.ok(meta, `第${number}章 meta 应存在`)
    assert.equal(ftsCount(number), 1, `第${number}章 FTS 应只有 1 行`)
  }
  svcA.disposeStores()
  svcB.disposeStores()
}

// ---------- 3) 两个进程真并发写不同章节（各 100 次） ----------
{
  const workerPath = join(tmpdir(), `deepnovel-conc-worker-${Date.now()}.mjs`)
  const serviceUrl = new URL('../service.js', import.meta.url).href
  const workerSource = `
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
const [project, home, servicePath, startText, countText] = process.argv.slice(2)
process.env.DSH_HOME = home
const { NovelWriterService } = await import(servicePath)
const abs = (t) => join(t.cwd, t.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (t) => { try { const i = await stat(abs(t)); return { version: String(i.mtimeMs) } } catch { return null } },
  readText: async (t) => readFile(abs(t), 'utf8'),
  writeText: async (t, c) => { await (await import('node:fs/promises')).mkdir(dirname(abs(t)), { recursive: true }); await (await import('node:fs/promises')).writeFile(abs(t), c, 'utf8'); return { operation: 'update', version: '1' } },
  listDir: async (t) => (await readdir(abs(t), { withFileTypes: true })).map((e) => ({ type: e.isDirectory() ? 'directory' : 'file', name: e.name })),
  processPath: (t) => abs(t),
}
const svc = new NovelWriterService({
  workingDirectory: { ensure: async (a) => (typeof a === 'string' ? a : a.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})
const start = Number(startText)
const count = Number(countText)
for (let i = 0; i < count; i += 1) {
  const number = start + (i % 5)
  const padded = String(number).padStart(3, '0')
  await svc.writeTextFile(project, 'story/chapters/' + padded + '/draft.md', process.argv[7] + ' 第' + number + '章 #' + i + '：破庙里遇到神秘人。')
  await svc.writeJson(project, 'story/chapters/' + padded + '/meta.json', { chapterId: 'c' + number, number, title: '第' + number + '章', status: 'drafted', wordCount: i, updatedAt: new Date().toISOString() })
}
svc.disposeStores()
console.log('worker ok')
`
  await writeFile(workerPath, workerSource, 'utf8')
  const runWorker = (start, tag) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, project, home, serviceUrl, String(start), '100', tag], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`worker 退出码 ${code}: ${stderr}`))))
  })
  await Promise.all([runWorker(1, 'P1'), runWorker(6, 'P2')])
  for (let number = 1; number <= 10; number += 1) {
    assert.ok(store.readChapterMeta(number), `真并发后第${number}章 meta 应存在`)
    assert.equal(ftsCount(number), 1, `真并发后第${number}章 FTS 应只有 1 行`)
  }
  const concurrentText = await readFile(join(project, 'story', 'chapters', '005', 'draft.md'), 'utf8')
  assert.ok(/^P[12] 第5章 #\d+：破庙里遇到神秘人。$/.test(concurrentText.trim()), '正文应是某一次完整写入')
  await rm(workerPath, { force: true })
}

// ---------- 4) 同一章并发写：不崩，最终值来自某一次完整写入 ----------
{
  const svcA = makeService()
  const svcB = makeService()
  await svcA.storeFor(project)
  await svcB.storeFor(project)
  const writer = async (svc, tag) => {
    for (let index = 0; index < 50; index += 1) {
      await svc.writeTextFile(project, 'story/chapters/001/draft.md', `${tag} 写第1章 #${index} 内容完整：破庙里遇到神秘人。`)
    }
  }
  await Promise.all([writer(svcA, 'A'), writer(svcB, 'B')])
  const finalText = (await readFile(join(project, 'story', 'chapters', '001', 'draft.md'), 'utf8')).trim()
  assert.ok(/^(A|B) 写第1章 #\d+ 内容完整：破庙里遇到神秘人。$/.test(finalText), '最终正文必须是某一次完整写入（不能半套）')
  assert.equal(ftsCount(1), 1, '同一章并发写后 FTS 仍只有 1 行')
  svcA.disposeStores()
  svcB.disposeStores()
}

// ---------- 5) deleteChapter 重排 + 另一实例同时写另一章 → 数据自洽 ----------
{
  const svcA = makeService()
  const svcB = makeService()
  await svcA.storeFor(project)
  await svcB.storeFor(project)
  const writer = async () => {
    for (let index = 0; index < 20; index += 1) {
      await svcB.writeTextFile(project, 'story/chapters/001/draft.md', `W 写第1章 #${index}：破庙里遇到神秘人。`)
    }
  }
  await Promise.all([
    svcA.deleteChapter(project, { number: 2, snapshot: false, removeOutline: true, renumber: true }),
    writer(),
  ])
  const outline = await service.readJson(project, 'story/plot/outline.json')
  const numbers = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? []).map((chapter) => Number(chapter.number))
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9], '重排后大纲章号应连续 1..9')
  assert.ok(store.readChapterMeta(1), '第1章 meta 应保留（另一实例仍在写它）')
  assert.equal(ftsCount(1), 1, '第1章 FTS 应只有 1 行')
  for (const number of numbers) {
    assert.ok(store.readChapterMeta(number), `第${number}章 meta 应与大纲一致`)
    assert.equal(ftsCount(number), 1, `第${number}章 FTS 应只有 1 行`)
  }
  svcA.disposeStores()
  svcB.disposeStores()
}

// ---------- 6) 纯文件项目反向导入：导出 → 导入空项目 → 一致性 ----------
{
  const exported = await service.exportFileProject(project)
  const exportDir = join(project, exported.path)
  assert.ok(existsSync(join(exportDir, 'story', 'project.json')), '导出目录应含 story/project.json')

  await service.initProject(otherProject, { title: '导入目标' })
  await service.writeJson(otherProject, 'story/plot/outline.json', {
    status: 'candidate', logline: null, updatedAt: iso, volumes: [],
  })
  const beforeOutline = await service.readJson(otherProject, 'story/plot/outline.json')

  // 失败路径：非法源目录 → 报错且当前项目不变
  const invalidDir = join(home, 'not-a-project')
  await mkdir(invalidDir, { recursive: true })
  await assert.rejects(
    () => service.importFileProject(otherProject, { path: invalidDir }),
    /源目录不是可导入的纯文件项目|至少需要一个章节目录/,
    '非法源目录应报错',
  )
  const afterFailure = await service.readJson(otherProject, 'story/plot/outline.json')
  assert.deepEqual(afterFailure, beforeOutline, '导入失败后当前项目不应改变')

  // 成功路径
  const imported = await service.importFileProject(otherProject, { path: exportDir })
  assert.equal(imported.imported, true)
  assert.ok(existsSync(join(otherProject, imported.backupPath)), '应保留导入前备份')
  const importedLayer = await service.dataStatus(otherProject)
  assert.equal(importedLayer.walBytes, 0, '导入结束应 checkpoint（WAL 归零）')
  const sourceOutline = await service.readJson(project, 'story/plot/outline.json')
  const importedOutline = await service.readJson(otherProject, 'story/plot/outline.json')
  assert.deepEqual(importedOutline, sourceOutline, '导入后大纲应与源项目一致')
  const sourceDraft = await service.readText(project, 'story/chapters/001/draft.md')
  const importedDraft = await service.readText(otherProject, 'story/chapters/001/draft.md')
  assert.equal(importedDraft, sourceDraft, '导入后正文应与源项目一致')
  const search = await service.searchProject(otherProject, { query: '破庙里' })
  assert.ok(search.results.some((item) => item.type === 'chapter'), '导入后 FTS 检索应命中')
  const importedStatus = await service.dataStatus(otherProject)
  const sourceStatus = await service.dataStatus(project)
  assert.equal(importedStatus.chapters, sourceStatus.chapters, '导入后章节数应与源项目一致')
  assert.equal(importedStatus.ftsRows.chapters, sourceStatus.ftsRows.chapters, '导入后 FTS 章节行数应与源项目一致')
}

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 100))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
await rm(otherProject, { recursive: true, force: true })
console.log('concurrency + import tests passed')
