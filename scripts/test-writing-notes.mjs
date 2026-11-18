// 项目写作要求：客户端不再有插入/复制按钮、自动注入与未保存提示；prompt 统一前置且唯一；约束优先级。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const projectDir = await mkdtemp(join(tmpdir(), 'deepnovel-writing-notes-'))
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'deepnovel-writing-notes-home-'))

const templates = await import('../templates.js')
const constraints = await import('../constraints.js')

const readSource = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')

// ---------- 1) 客户端：无「插入项目要求 / 复制要求」，有自动注入说明与未保存 ----
const clientSource = await readSource('client.js')
assert.equal(clientSource.includes('插入项目要求'), false, 'client 不应再有「插入项目要求」')
assert.equal(clientSource.includes('复制要求'), false, 'client 不应再有「复制要求」按钮')
assert.ok(clientSource.includes('这里的要求会自动注入设定/大纲/正文生成'), '文案应说明自动注入')
assert.ok(clientSource.includes('不需要复制到生成框'), '文案应说明不需要复制到生成框')
assert.ok(clientSource.includes('修改后点保存'), '文案应说明修改后点保存')
assert.ok(clientSource.includes("'未保存'"), '应有未保存提示')
assert.ok(clientSource.includes('notesDirty'), '应有未保存状态')
assert.ok(clientSource.includes('onBlur'), 'textarea 应在失焦时自动保存')
assert.ok(clientSource.includes("'写作要求已保存'"), '保存应 toast「写作要求已保存」')
assert.ok(clientSource.includes('writingNotes'), '应仍保存 writingNotes 字段')

// ---------- 2) 统一 helper：标题 + 冲突规则 ----------
const notes = '女性角色要立体；避免套路化爽点；控制节奏'
const rendered = templates.renderWritingNotesBlock(notes)
assert.equal(typeof templates.formatWritingNotes, 'function')
assert.ok(rendered.includes('【项目写作要求（用户长期设定，优先级高于文风契约/设定/章纲）】'), '应有统一标题')
assert.ok(rendered.includes(notes), '应包含要求正文')
assert.ok(rendered.includes('冲突规则：'), '应包含冲突规则')
assert.ok(rendered.includes('以本要求为准'), '冲突规则应说明以本要求为准')
assert.ok(rendered.includes('本轮额外要求与本要求冲突时以本轮为准'), '冲突规则应说明本轮优先')
assert.equal(templates.renderWritingNotesBlock(''), '')
assert.equal(templates.renderWritingNotesBlock(null), '')
const TITLE = '【项目写作要求（用户长期设定，优先级高于文风契约/设定/章纲）】'

// ---------- 3) outline prompt：唯一、前置到文风契约之前 ----------
const outlinePrompt = templates.buildOutlineUserPrompt({
  title: 't', language: 'zh', fromChapter: 1, toChapter: 1, totalChapters: 20, wordBudget: 3000,
  premise: {}, styleFields: {},
  instruction: '本章加一场雨戏',
  writingNotes: notes,
  volume: { title: '第 1 卷', map: '镇子', goal: '目标', exitCriteria: '离卷', targetChapters: 10 },
  progress: { volumeTitle: '第 1 卷', chapterNumber: 1, indexInVolume: 1, totalInVolume: 10, usedChapters: 0, remainingChapters: 9 },
})
assert.equal(outlinePrompt.split(TITLE).length - 1, 1, 'outline prompt 写作要求应唯一')
assert.ok(outlinePrompt.indexOf(TITLE) < outlinePrompt.indexOf('文风契约：'), '写作要求应在文风契约之前')
assert.ok(outlinePrompt.indexOf(TITLE) < outlinePrompt.indexOf('已确认构思'), '写作要求应在已确认构思之前')
assert.ok(outlinePrompt.indexOf('【本次额外要求') < outlinePrompt.indexOf(TITLE), '写作要求应在额外要求之后')
assert.ok(outlinePrompt.includes('以本要求为准'))

// ---------- 4) 设定 prompt（三个）唯一且前置 ----------
const bibleInput = { title: 't', language: 'zh', premise: {}, styleFields: {}, writingNotes: notes, instruction: '多写对手' }
for (const [name, builder] of [
  ['bible', templates.buildBibleUserPrompt],
  ['characters', templates.buildBibleCharactersUserPrompt],
  ['world', templates.buildBibleWorldUserPrompt],
]) {
  const prompt = builder(bibleInput)
  assert.equal(prompt.split(TITLE).length - 1, 1, `${name} prompt 写作要求应唯一`)
  assert.ok(prompt.indexOf(TITLE) < prompt.indexOf('已确认构思'), `${name} prompt 写作要求应在构思之前`)
  assert.ok(prompt.indexOf(TITLE) < prompt.indexOf('文风契约：'), `${name} prompt 写作要求应在文风契约之前`)
}

// ---------- 5) chapter prompt：唯一、在章纲/文风/故事背景之前 ----------
const chapterPrompt = templates.buildChapterUserPrompt({
  title: 't', language: 'zh', number: 3, wordBudget: 3000,
  chapter: { number: 3, title: '三', synopsis: '剧情' },
  styleFields: { pov: 'third-limited' },
  writingNotes: notes,
  storyContext: { premise: { title: 'p' }, bible: { characters: [] } },
})
assert.equal(chapterPrompt.split(TITLE).length - 1, 1, 'chapter prompt 写作要求应唯一')
assert.ok(chapterPrompt.indexOf(TITLE) < chapterPrompt.indexOf('【章纲】'), '写作要求应在章纲之前')
assert.ok(chapterPrompt.indexOf(TITLE) < chapterPrompt.indexOf('【文风契约】'), '写作要求应在文风契约之前')
assert.ok(chapterPrompt.indexOf(TITLE) < chapterPrompt.indexOf('【故事背景'), '写作要求应在故事背景之前')
// 不传 writingNotes 时不出现
const plainPrompt = templates.buildChapterUserPrompt({ title: 't', language: 'zh', number: 3, wordBudget: 3000, chapter: {}, styleFields: {} })
assert.equal(plainPrompt.includes(TITLE), false)

// ---------- 6) 约束优先级：explicit > facts > requirements > bible > outline > style > notes ----------
assert.deepEqual(constraints.CONSTRAINT_PRIORITY, ['explicit', 'facts', 'requirements', 'bible', 'outline', 'style', 'notes'])
const resolved = constraints.resolveChapterConstraints({
  instruction: '本章用第一人称写',
  writingNotes: '本书统一用第三人称叙述',
  styleFields: { pov: 'third-limited', tense: 'past' },
})
assert.ok(resolved.layers.some((layer) => layer.level === 'requirements'), '应有 requirements 层')
assert.ok(resolved.conflicts.some((item) => item.a === 'explicit' && item.b === 'style' && item.winner === 'explicit'), 'explicit 应胜 style')
// requirements 高于 style：写作要求 vs 文风契约冲突时应以 requirements 为准
const notesVsStyle = constraints.resolveChapterConstraints({
  writingNotes: '用第三人称，多用短句',
  styleFields: { pov: 'first', sentenceLength: 'long' },
})
assert.ok(notesVsStyle.conflicts.some((item) => item.a === 'requirements' && item.b === 'style' && item.winner === 'requirements'), 'requirements 应胜 style')

// ---------- 7) service 侧阶段过滤不受影响（writingNotesFor） ----------
const { NovelWriterService } = await import('../service.js')
const service = new NovelWriterService({
  workingDirectory: { ensure: async (agent) => agent },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: {
    resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
    stat: async () => null,
    readText: async () => '',
    writeText: async () => ({ operation: 'update', version: '1' }),
    listDir: async () => [],
    processPath: (target) => join(target.cwd, target.relativePath),
  },
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
})
assert.ok(typeof service.writingNotesFor === 'function')

await rm(projectDir, { recursive: true, force: true })
console.log('writing notes tests passed')
