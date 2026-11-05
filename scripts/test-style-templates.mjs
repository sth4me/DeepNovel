// 内置文风模板完整性测试：字段齐备、规则可判定、示例段足够长、格式化输出可用。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { STYLE_AUDIT_SYSTEM_PROMPT, STYLE_CONTRACT_SYSTEM_PROMPT, STYLE_TEMPLATES, buildChapterUserPrompt, formatStyleFields, findStyleTemplate, listStyleTemplates } from '../templates.js'

const REQUIRED_TEXT_FIELDS = ['voice', 'diction', 'imagery', 'sensoryFocus', 'dialogueStyle', 'pacing', 'notes']
const REQUIRED_LIST_FIELDS = ['must', 'never', 'adjust', 'bannedWords', 'bannedPatterns', 'genreFit', 'avoidGenre']
const REQUIRED_SCALAR_FIELDS = ['pov', 'tense', 'chapterWords', 'sentenceLength', 'paragraphLength', 'dialogueRatio', 'metaphorDensity', 'chapterTitleStyle']
const REQUIRED_DIMENSION_FIELDS = ['narrative', 'syntax', 'dialogue', 'description', 'emotion', 'diction', 'pacing']

assert.ok(STYLE_TEMPLATES.length >= 8, '至少 8 个内置模板')

const ids = new Set()
for (const template of STYLE_TEMPLATES) {
  assert.ok(template.id && !ids.has(template.id), `模板 id 唯一：${template.id}`)
  ids.add(template.id)
  assert.ok(template.name, `${template.id} 缺少 name`)
  assert.ok(template.group, `${template.id} 缺少 group`)
  assert.ok(Array.isArray(template.tags) && template.tags.length >= 2, `${template.id} 缺少 tags`)
  assert.ok(typeof template.description === 'string' && template.description.length >= 15, `${template.id} description 太短`)
  assert.ok(Array.isArray(template.samples), `${template.id} 缺少 samples`)
  assert.ok(template.samples.length >= 2 && template.samples.length <= 3, `${template.id} 示例段应为 2–3 段`)
  for (const sample of template.samples) {
    assert.ok(typeof sample === 'string' && sample.length >= 40, `${template.id} 示例段太短`)
  }
  for (const key of REQUIRED_SCALAR_FIELDS) {
    assert.ok(template.fields[key] !== undefined && template.fields[key] !== '', `${template.id} 缺少字段 ${key}`)
  }
  for (const key of REQUIRED_TEXT_FIELDS) {
    const value = template.fields[key]
    assert.ok(typeof value === 'string' && value.length >= 8, `${template.id} 字段 ${key} 太短或缺失`)
  }
  for (const key of REQUIRED_LIST_FIELDS) {
    const value = template.fields[key]
    assert.ok(Array.isArray(value) && value.length >= 2, `${template.id} 字段 ${key} 应为至少 2 项的数组`)
    for (const item of value) assert.ok(typeof item === 'string' && item.trim().length >= 2, `${template.id} 字段 ${key} 有空项`)
  }
  assert.ok(template.fields.must.length >= 3, `${template.id} must 至少 3 条`)
  assert.ok(template.fields.never.length >= 3, `${template.id} never 至少 3 条`)
  assert.ok(template.fields.genreFit.length >= 2, `${template.id} genreFit 至少 2 项`)
  for (const key of REQUIRED_DIMENSION_FIELDS) {
    const value = template.fields[key]
    assert.ok(typeof value === 'string' && value.length >= 12, `${template.id} 维度字段 ${key} 太短或缺失`)
  }
  const shape = template.fields.chapterShape
  assert.ok(shape && typeof shape === 'object', `${template.id} 缺少 chapterShape`)
  for (const key of ['opening', 'middle', 'ending']) {
    assert.ok(typeof shape[key] === 'string' && shape[key].trim().length >= 6, `${template.id} chapterShape.${key} 太短`)
  }
  const anchors = template.fields.anchors
  assert.ok(Array.isArray(anchors) && anchors.length === 2, `${template.id} anchors 应为 2 段`)
  for (const anchor of anchors) {
    assert.ok(typeof anchor === 'string' && anchor.length >= 80 && anchor.length <= 130, `${template.id} 锚点长度应为 80–130 字，实际 ${anchor.length}`)
  }
  assert.equal(anchors[0] === anchors[1], false, `${template.id} 两段锚点不能相同`)
  const selfCheck = template.fields.selfCheck
  assert.ok(Array.isArray(selfCheck) && selfCheck.length === 5, `${template.id} selfCheck 应为 5 条`)
  for (const item of selfCheck) assert.ok(typeof item === 'string' && item.trim().length >= 6, `${template.id} selfCheck 有空项`)
  const forbidden = template.fields.forbidden
  assert.ok(Array.isArray(forbidden) && forbidden.length >= 3 && forbidden.length <= 5, `${template.id} forbidden 应为 3–5 条`)
  for (const item of forbidden) assert.ok(typeof item === 'string' && item.trim().length >= 4, `${template.id} forbidden 有空项`)
}

// 每类字段都能渲染成可读文本
const fast = findStyleTemplate('fast-web')
assert.ok(fast, 'fast-web 模板存在')
const rendered = formatStyleFields(fast.fields)
assert.ok(rendered.includes('【视角与时态】'), '渲染包含视角')
assert.ok(rendered.includes('【必须贯彻】'), '渲染包含必须贯彻')
assert.ok(rendered.includes('【绝对禁止】'), '渲染包含绝对禁止')
assert.ok(rendered.includes('【按场景调节】'), '渲染包含按场景调节')
assert.ok(rendered.includes('【禁用词】'), '渲染包含禁用词')
assert.ok(rendered.includes('【额外要求】'), '渲染包含额外要求')
assert.ok(!rendered.includes('{'), '渲染结果不应是 JSON')
for (const template of STYLE_TEMPLATES) {
  const output = formatStyleFields(template.fields)
  for (const label of ['【叙述视角】', '【句法节奏】', '【对白】', '【描写与感官】', '【情绪呈现】', '【章节形态】', '【风格锚点', '【自检】']) {
    assert.ok(output.includes(label), `${template.id} 渲染缺少 ${label}`)
  }
  assert.ok(output.includes(template.fields.anchors[0].slice(0, 12)), `${template.id} 渲染应包含第一段锚点`)
  assert.ok(output.includes(template.fields.anchors[1].slice(0, 12)), `${template.id} 渲染应包含第二段锚点`)
  assert.ok(output.includes(template.fields.selfCheck[0].slice(0, 8)), `${template.id} 渲染应包含自检条目`)
}
const renderedFast = formatStyleFields(fast.fields)
assert.ok(renderedFast.includes('【章节形态】'), 'fast-web 章节形态可渲染')
assert.ok(renderedFast.includes('章首：'), '章节形态应含章首')
assert.ok(renderedFast.includes('章尾：'), '章节形态应含章尾')

// 单独展示 notes 时可用 skipNotes 避免重复
const noNotes = formatStyleFields(fast.fields, { skipNotes: true })
assert.ok(!noNotes.includes('【额外要求】'), 'skipNotes 应去掉额外要求')
assert.ok(noNotes.includes('【必须贯彻】'), 'skipNotes 不影响其它段落')

// 旧契约（只有老字段）也要能渲染，不能抛错
const legacy = formatStyleFields({ pov: 'first', tense: 'past', sentenceLength: 'short', dialogueRatio: 0.4, notes: '老项目' })
assert.ok(legacy.includes('第一人称'), '旧字段视角可渲染')
assert.ok(legacy.includes('老项目'), '旧字段 notes 可渲染')
assert.equal(formatStyleFields(null), '（未设置文风契约）')
assert.equal(formatStyleFields({}), '（未设置文风契约）')

// 列表输出要带 group/tags/samples，供前端模板卡片展示
const listed = listStyleTemplates()
assert.equal(listed.length, STYLE_TEMPLATES.length)
for (const item of listed) {
  assert.ok(item.group, `${item.id} 列表输出缺少 group`)
  assert.ok(Array.isArray(item.tags), `${item.id} 列表输出缺少 tags`)
  assert.ok(Array.isArray(item.samples) && item.samples.length >= 2, `${item.id} 列表输出缺少 samples`)
}

// 章节生成提示词：文风契约以可读文本出现，示例段作为语感锚点
const chapterPrompt = buildChapterUserPrompt({
  title: '测试项目',
  language: 'zh-CN',
  number: 1,
  wordBudget: 3000,
  chapter: { number: 1, title: '开端', synopsis: '主角在雨夜收到一封信。' },
  styleFields: fast.fields,
  samples: fast.samples,
})
assert.ok(chapterPrompt.includes('【文风契约】'), '章节提示词包含文风契约')
assert.ok(chapterPrompt.includes('【必须贯彻】'), '章节提示词包含必须贯彻')
assert.ok(chapterPrompt.includes('【绝对禁止】'), '章节提示词包含绝对禁止')
assert.ok(chapterPrompt.includes('【文风示例'), '章节提示词包含文风示例')
assert.ok(!chapterPrompt.includes('"must":'), '文风契约不应是 JSON')
assert.ok(chapterPrompt.includes('【风格锚点'), '章节提示词应包含风格锚点')
assert.ok(chapterPrompt.includes(fast.fields.anchors[0].slice(0, 16)), '章节提示词应包含锚点示例内容')
assert.ok(chapterPrompt.includes('【自检】'), '章节提示词应包含自检清单')

// service.updateStyleFields 接受新字段（旧契约 + 新字段合并）
const home = await mkdtemp(join(tmpdir(), 'deepnovel-style-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-style-project-'))
process.env.DSH_HOME = home
const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await (await import('node:fs/promises')).stat(abs(target))
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
const ctx = {
  workingDirectory: { ensure: async (agent) => (typeof agent === 'string' ? agent : agent.cwd) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  fs: fsCtx,
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [] } }), stream: async function* () {} },
}
const { NovelWriterService } = await import('../service.js')
const service = new NovelWriterService(ctx)
await mkdir(join(project, 'story', 'style'), { recursive: true })
await writeFile(join(project, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: 't' }), 'utf8')
await writeFile(
  join(project, 'story', 'style', 'contract.json'),
  JSON.stringify({ status: 'candidate', templateId: 'fast-web', fields: { pov: 'third-limited' }, samples: [] }),
  'utf8',
)
const updated = await service.updateStyleFields(project, {
  voice: '冷静直白',
  must: ['开场 200 字内出现冲突'],
  never: ['用“他感到”直陈情绪'],
  genreFit: ['都市'],
})
assert.equal(updated.fields.voice, '冷静直白')
assert.deepEqual(updated.fields.must, ['开场 200 字内出现冲突'])
assert.deepEqual(updated.fields.genreFit, ['都市'])
assert.equal(updated.fields.pov, 'third-limited', '旧字段应保留')
const updatedDimensions = await service.updateStyleFields(project, {
  narrative: '第三人称限知，叙述距离贴',
  syntax: '短句为主',
  dialogue: '对白占 40%',
  description: '视觉优先',
  emotion: '用动作呈现',
  chapterShape: { opening: '动作开场', middle: '目标受挫', ending: '动作收束' },
  anchors: ['原创示例甲，写在雨夜的巷口。', '原创示例乙，写在清晨的站台。'],
  selfCheck: ['是否有短句推进', '是否没有直述情绪', '对白是否承担冲突', '章尾是否停在动作上', '比喻是否来自日常物'],
  forbidden: ['连续大段心理描写', '章末总结升华', '用巧合解决冲突'],
})
assert.equal(updatedDimensions.fields.narrative, '第三人称限知，叙述距离贴', '新字段 narrative 应可写')
assert.deepEqual(updatedDimensions.fields.chapterShape, { opening: '动作开场', middle: '目标受挫', ending: '动作收束' })
assert.equal(updatedDimensions.fields.anchors.length, 2)
assert.equal(updatedDimensions.fields.selfCheck.length, 5)

const contractPrompt = STYLE_CONTRACT_SYSTEM_PROMPT
for (const keyword of ['narrative', 'syntax', 'dialogue', 'description', 'emotion', 'diction', 'pacing', 'chapterShape', 'anchors', 'selfCheck', 'forbidden']) {
  assert.ok(contractPrompt.includes(keyword), `文风契约生成提示词应包含维度 ${keyword}`)
}
assert.ok(contractPrompt.includes('80–120'), '生成提示词应给出锚点长度要求')
assert.ok(contractPrompt.includes('可执行'), '生成提示词应要求可执行字段')

const auditPrompt = STYLE_AUDIT_SYSTEM_PROMPT
assert.ok(auditPrompt.includes('dimensions'), '审校提示词应输出 dimensions')
for (const label of ['叙述视角', '句法节奏', '对白', '描写与感官', '情绪呈现', '用词', '节奏', '章节形态']) {
  assert.ok(auditPrompt.includes(label), `审校提示词应包含维度 ${label}`)
}
assert.ok(auditPrompt.includes('改进建议') || auditPrompt.includes('advice'), '审校提示词应要求每维给改进建议')


console.log(`style template tests passed (${STYLE_TEMPLATES.length} templates)`)
