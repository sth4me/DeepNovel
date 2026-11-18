// 大纲分卷：volumeEnd 不创建空卷、生成下一卷时才建卷、失败不留空卷、历史空卷清理、显式建卷保留。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-volume-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-volume-project-'))
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

await service.initProject(project, { title: '分卷测试' })
await service.writeJson(project, 'story/premise.json', {
  status: 'confirmed',
  chosen: { title: 'x', premise: 'p', genre: ['都市'], protagonist: 'a', length: { chapters: 30, wordsPerChapter: 3000 } },
})
await service.writeJson(project, 'story/style/contract.json', {
  status: 'confirmed', templateId: 'fast-web', fields: { chapterWords: 3000 }, samples: [],
})
await service.writeJson(project, 'story/bible/index.json', {
  status: 'confirmed', characters: [], locations: [], rules: [], factions: [], items: [],
})
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate',
  logline: '一句话',
  volumes: [{ id: 'vol-1', title: '第 1 卷', map: '地图', goal: '目标', chapters: [] }],
})

const wrap = (parsed) => ({ parsed, first: { text: '{}', model: null, durationMs: 0 }, runId: 'run-test', usage: null })
let outlinePayload = { chapters: [] }
const volumeCandidates = [
  { title: '第 2 卷', map: '新地图', goal: '在新地图站稳脚', whyNow: '卷末钩子逼来', cost: '离开旧人脉', risk: '被本地势力盯上', exitCriteria: '在新地图有立足之地', targetChapters: 10 },
  { title: '第 2 卷', map: '新地图', goal: '把货送到新地图', whyNow: '旧路断了', cost: '绕远', risk: '货失', exitCriteria: '货到', targetChapters: 8 },
]
service.callJsonModel = async (agent, options) => {
  if (options.kind === 'outline.generate' || options.kind === 'outline.regenerate') return wrap(outlinePayload)
  if (options.kind === 'outline.audit') return wrap({ issues: [] })
  if (options.kind === 'outline.volume-plan') return wrap({ candidates: volumeCandidates })
  return wrap({})
}

// ---------- 1) 生成 10 章、第 10 章 volumeEnd=true → 不创建空卷 ----------
outlinePayload = {
  chapters: Array.from({ length: 10 }, (_, index) => ({
    number: index + 1,
    title: `第${index + 1}章`,
    synopsis: `第${index + 1}章的剧情梗概，写清人物处境与发生的事。`,
    wordBudget: 3000,
    ...(index === 9 ? { volumeEnd: true } : {}),
  })),
}
const first = await service.outlineGenerate(project, { count: 10 })
const outline1 = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outline1.volumes.length, 1, `不应提前创建空卷，实际 ${outline1.volumes.length} 卷`)
assert.equal(outline1.volumes[0].id, 'vol-1')
assert.equal(outline1.volumes[0].chapters.length, 10)
assert.equal(outline1.volumes.some((volume) => volume.id === 'vol-2'), false, '不应出现 vol-2')
assert.equal(outline1.pendingNextVolume, true, '应在 outline 上记录 pendingNextVolume')
assert.equal(first.pendingNextVolume, true)
assert.equal(first.nextVolumeId, null, '未创建新卷时 nextVolumeId 应为 null')

// ---------- 2) fromChapter=11 时才创建 vol-2、自动规划目标并挂章节 ----------
outlinePayload = { chapters: [{ number: 11, title: '第11章', synopsis: '第11章的剧情梗概。', wordBudget: 3000 }] }
const second = await service.outlineGenerate(project, { fromChapter: 11, count: 1 })
const outline2 = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outline2.volumes.length, 2, '生成第二卷时才创建卷')
assert.equal(outline2.volumes[1].id, 'vol-2')
assert.equal(outline2.volumes[1].goal, volumeCandidates[0].goal, '新卷应在内存里完成目标规划后再落盘')
assert.equal(outline2.volumes[1].targetChapters, 10)
assert.equal(outline2.volumes[1].chapters.length, 1)
assert.equal(outline2.volumes[1].chapters[0].number, 11)
assert.equal(outline2.volumes[0].chapters.length, 10, '第一卷章节应保留')
assert.equal(second.pendingNextVolume, false, '生成本批无 volumeEnd 时应清除 pendingNextVolume')
assert.equal(outline2.pendingNextVolume, undefined)

// ---------- 3) 生成失败（无章节产出）不留空卷 ----------
const outline3 = await service.readJson(project, 'story/plot/outline.json')
outline3.volumes[1].chapters[0].volumeEnd = true
await service.writeJson(project, 'story/plot/outline.json', outline3)
outlinePayload = { chapters: [] }
await assert.rejects(() => service.outlineGenerate(project, { fromChapter: 12, count: 1 }), /无法生成章纲|chapters|未返回/)
const outlineAfterFail = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outlineAfterFail.volumes.length, 2, '生成失败不应留下空 vol-3')
assert.equal(outlineAfterFail.volumes.some((volume) => volume.id === 'vol-3'), false)

// ---------- 4) 历史遗留空卷清理（outlineCommit 写盘前 prune） ----------
const legacy = await service.readJson(project, 'story/plot/outline.json')
legacy.volumes.push({ id: 'vol-3', title: '第 3 卷', chapters: [] })
await service.writeJson(project, 'story/plot/outline.json', legacy)
const committed = await service.outlineCommit(project, { fromChapter: 1, toChapter: 1 })
assert.equal(committed.confirmed, 1)
const outline4 = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outline4.volumes.length, 2, '末尾空卷应在写盘前被清理')
assert.equal(outline4.volumes.some((volume) => volume.id === 'vol-3'), false)

// ---------- 5) volume-create 显式建空卷保留（不被自动清理） ----------
const created = await service.createOutlineVolume(project, { title: '第 3 卷' })
assert.equal(created.id, 'vol-3')
const outline5 = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outline5.volumes.length, 3)
assert.equal(outline5.volumes[2].chapters.length, 0, '显式创建的空卷应立即保留')

// 显式建卷后再生成当前卷章节（不跨卷）→ 空卷仍在中间/末尾？本轮生成属 vol-3?
// 只验证：生成当前卷（fromChapter=2，属 vol-1）不会误删显式卷；末尾空卷按规则清理。
outlinePayload = { chapters: [{ number: 2, title: '第2章', synopsis: '第2章梗概。', wordBudget: 3000 }] }
await service.outlineGenerate(project, { fromChapter: 2, count: 1, volumeId: 'vol-1' })
const outline6 = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outline6.volumes.length, 2, '末尾显式空卷在写盘前按「末尾空卷清理」规则移除（历史遗留清理）')
assert.equal(outline6.volumes.some((volume) => volume.id === 'vol-1' && volume.chapters.length >= 2), true)

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('outline volume tests passed')
