// 助手行为：一次一步（交互节奏提示词）+ 大纲局部问题优先 update + 描述/参数/报错。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-rhythm-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-rhythm-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const { setNovelWriter } = await import('../runtime.js')
const { apply } = await import('../agent.js')

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

await service.initProject(project, { title: '助手行为' })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'candidate',
  logline: 'x',
  volumes: [{
    id: 'vol-1', title: '第 1 卷', map: '城区', goal: '目标',
    chapters: [
      { id: 'ch-001', number: 1, title: '第1章', synopsis: '旧梗概', status: 'confirmed', wordBudget: 3000 },
      { id: 'ch-002', number: 2, title: '第2章', synopsis: '第2章梗概', status: 'confirmed', wordBudget: 3000 },
    ],
  }],
})

const sections = []
const registered = []
apply({
  tools: { register: (tool) => registered.push(tool) },
  systemPrompt: { section: (section) => sections.push(section) },
})

// ---------- 1) 系统提示词：交互节奏段（一次一步） ----------
const rhythm = sections.find((section) => section.name === 'deepnovel:interaction-rhythm')
assert.ok(rhythm, '应有 deepnovel:interaction-rhythm 段')
assert.equal(rhythm.order, 10090, '交互节奏段 order 应为 10090')
const rhythmText = rhythm.text()
assert.ok(rhythmText.includes('一次一步'), '应说明一次一步')
assert.ok(rhythmText.includes('不要自动进入下一阶段'), '应禁止自动推进下一阶段')
assert.ok(rhythmText.includes('构思→设定→大纲→正文→审校→修订→定稿'), '应列出阶段顺序')
assert.ok(rhythmText.includes('commit'), '应说明 commit 后停')
assert.ok(rhythmText.includes('先问'), '不确定时应先问')
assert.ok(rhythmText.includes('不要重复调用'), '工具内部联动不应重复调用')

// ---------- 2) 10157 段：局部问题优先 update ----------
const guard = sections.find((section) => section.name === 'deepnovel:outline-repair-guard')
assert.ok(guard, '应有 outline-repair-guard 段')
const guardText = guard.text()
assert.ok(guardText.includes('action=update'), '应允许 update 修正明确错误')
assert.ok(guardText.includes('不要用 update 替生成模型设计新剧情'), 'update 不应替生成模型构思剧情')
assert.ok(guardText.includes('≥3 章'), '成规模才 regenerate')
assert.ok(guardText.includes('不要自动 repair/regenerate'), 'audit 后不自动修复')
assert.ok(guardText.includes('先说明影响范围'), '重规划要说明影响')

// ---------- 3) novel_outline：update 动作、参数、描述 ----------
const outlineTool = registered.find((tool) => tool.name === 'novel_outline')
assert.ok(outlineTool, '应有 novel_outline')
assert.ok(outlineTool.parameters.properties.action.enum.includes('update'), 'action enum 应含 update')
assert.ok(outlineTool.parameters.properties.chapterId, '应有 chapterId 参数')
assert.ok(outlineTool.parameters.properties.fields, '应有 fields 参数')
const fieldProps = outlineTool.parameters.properties.fields.properties
for (const key of ['title', 'synopsis', 'change', 'storyQuestion', 'promise', 'beats', 'wordBudget']) {
  assert.ok(fieldProps[key], `fields 应支持 ${key}`)
}
assert.ok(outlineTool.description.includes('只用于用户明确指定的局部修改'), '描述应限定 update 的用途')
assert.ok(outlineTool.description.includes('不要替它设计剧情方案'), '描述应禁止助手替生成模型设计剧情')
assert.ok(outlineTool.description.includes('成规模'), '描述应说明成规模才 regenerate')

// ---------- 4) update 调用参数：真实改单章不改动其它章 ----------
const updated = await outlineTool.execute({ action: 'update', number: 1, fields: { synopsis: '新梗概：主角主动反击', change: '拿到关键证据' } }, { agent: project, signal: null })
assert.equal(updated.number, 1)
assert.equal(updated.synopsis, '新梗概：主角主动反击')
assert.equal(updated.change, '拿到关键证据')
const outlineAfter = await service.readJson(project, 'story/plot/outline.json')
const chaptersAfter = outlineAfter.volumes[0].chapters
assert.equal(chaptersAfter.find((item) => Number(item.number) === 2).synopsis, '第2章梗概', '其它章不应被改动')
assert.equal(chaptersAfter.find((item) => Number(item.number) === 1).status, 'candidate', 'update 后该章为 candidate')
// chapterId 定位
const byId = await outlineTool.execute({ action: 'update', chapterId: 'ch-002', fields: { title: '新标题' } }, { agent: project, signal: null })
assert.equal(byId.title, '新标题')
// 章纲 extra 字段可局部修补，不需要 shell/直接改库
const byExtra = await outlineTool.execute({ action: 'update', number: 1, fields: { agency: { choice: '当众扣下三样', cost: '得罪霍崇山' }, device: '座次' } }, { agent: project, signal: null })
assert.equal(byExtra.agency?.choice, '当众扣下三样')
assert.equal(byExtra.device, '座次')
const unknownField = await outlineTool.execute({ action: 'update', number: 1, fields: { nope: 1 } }, { agent: project, signal: null })
assert.equal(unknownField.ok, false)
assert.ok(String(unknownField.error).includes('不支持字段'), '未知字段应明确报错而不是静默丢弃')

// ---------- 5) 缺参报错（可读错误，不崩） ----------
const noTarget = await outlineTool.execute({ action: 'update', fields: { title: 'x' } }, { agent: project, signal: null })
assert.equal(noTarget.ok, false)
assert.ok(String(noTarget.error).includes('chapterId 或 number'), '缺定位应给可读错误')
const noFields = await outlineTool.execute({ action: 'update', number: 1 }, { agent: project, signal: null })
assert.equal(noFields.ok, false)
assert.ok(String(noFields.error).includes('fields'), '缺 fields 应给可读错误')

// ---------- 6) novel_bible / novel_issues 描述 ----------
const bibleTool = registered.find((tool) => tool.name === 'novel_bible')
assert.ok(bibleTool.description.includes('commit 完成后必须停'), 'novel_bible 应要求 commit 后停')
const issuesTool = registered.find((tool) => tool.name === 'novel_issues')
assert.ok(issuesTool.description.includes('action=update 改 1–3 章'), 'novel_issues 应优先建议 update')
assert.ok(issuesTool.description.includes('成规模'), 'novel_issues 应说明成规模才 regenerate')

service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('assistant rhythm tests passed')
