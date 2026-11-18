// 写作规则单一来源：规则完整性、消费方抽查、去重（完整禁用词表只在 writing-rules.js）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const rules = await import('../writing-rules.js')
const templates = await import('../templates.js')
const { CRAFT_CARDS } = await import('../craft.js')
const { BUILTIN_REFERENCE_SKILLS } = await import('../builtin-skills.js')

// ---------- 1) 规则完整性 ----------
assert.equal(rules.AI_BANNED_WORDS.length, 35, '一级禁用词应为 35 个')
assert.equal(new Set(rules.AI_BANNED_WORDS).size, rules.AI_BANNED_WORDS.length, '禁用词不应重复')
assert.ok(rules.AI_BANNED_WORDS.every((word) => typeof word === 'string' && word.trim().length > 0))
assert.ok(Array.isArray(rules.AI_SENTENCE_PATTERNS) && rules.AI_SENTENCE_PATTERNS.length >= 5)
assert.ok(Array.isArray(rules.AI_HUMAN_BASELINE) && rules.AI_HUMAN_BASELINE.length >= 4)
assert.equal(rules.QUALITY_CHECKLIST.length, 5, '质检清单应有 5 组')
for (const group of rules.QUALITY_CHECKLIST) {
  assert.ok(group.id && group.title && Array.isArray(group.items) && group.items.length > 0, `清单组不完整：${group.id}`)
}
assert.ok(rules.DESLOP_RULES_TEXT.includes('改最少'), '应含「改最少」原则')
assert.ok(rules.DESLOP_RULES_TEXT.includes('只改“怎么说”'), '应含「只改怎么说」原则')
for (const word of rules.AI_BANNED_WORDS) {
  assert.ok(rules.DESLOP_RULES_TEXT.includes(word), `DESLOP_RULES_TEXT 应含禁用词：${word}`)
}

// ---------- 2) 流程提示词引用同一来源（抽查） ----------
for (const word of ['仿佛', '一丝', '眼中闪过', '不容置疑', '情不自禁']) {
  assert.ok(templates.DESLOP_SYSTEM_PROMPT.includes(word), `DESLOP 提示词应含：${word}`)
}
assert.ok(templates.DESLOP_SYSTEM_PROMPT.includes('"text"'), 'DESLOP 应保留输出 JSON text 字段')
assert.ok(templates.DESLOP_SYSTEM_PROMPT.includes('"changes"'), 'DESLOP 应保留输出 JSON changes 字段')
for (const word of ['仿佛', '目光如炬', '情不自禁']) {
  assert.ok(templates.STYLE_AUDIT_SYSTEM_PROMPT.includes(word), `STYLE_AUDIT 应含：${word}`)
  assert.ok(templates.CHAPTER_REVIEW_SYSTEM_PROMPT.includes(word), `CHAPTER_REVIEW 应含：${word}`)
}

// ---------- 3) 技能正文同源（抽查） ----------
const deslopCard = CRAFT_CARDS.find((card) => card.id === 'deslop')
assert.ok(deslopCard, '应有 deslop 技法卡')
for (const word of ['仿佛', '一丝', '缓缓', '眼中闪过']) {
  assert.ok(deslopCard.body.includes(word), `deslop 卡应含禁用词：${word}`)
}
for (const section of ['【适用】', '【通用原则】', '【按场景调节】', '【常见反例（不要这样写）】', '【自检】']) {
  assert.ok(deslopCard.body.includes(section), `deslop 卡应保留分节：${section}`)
}
const refQuality = BUILTIN_REFERENCE_SKILLS.find((skill) => skill.name === 'ref-quality')
assert.ok(refQuality, '应有 ref-quality 技能')
for (const group of rules.QUALITY_CHECKLIST) {
  assert.ok(refQuality.content.includes(group.title), `ref-quality 应含分组：${group.title}`)
  assert.ok(refQuality.content.includes(group.items[0]), `ref-quality 应含检查项：${group.items[0]}`)
}
assert.ok(refQuality.content.includes('不适用'), 'ref-quality 应保留判定说明')

// ---------- 4) 去重：完整禁用词表只在 writing-rules.js ----------
const longChain = rules.AI_BANNED_WORDS.slice(0, 6).join('、')
for (const file of ['templates.js', 'service.js', 'craft.js', 'builtin-skills.js']) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.equal(text.includes(longChain), false, `${file} 不应手写完整禁用词表`)
}
const rulesText = await readFile(new URL('../writing-rules.js', import.meta.url), 'utf8')
for (const word of rules.AI_BANNED_WORDS) {
  assert.ok(rulesText.includes(`'${word}'`), `writing-rules.js 应保留全部禁用词：${word}`)
}

console.log('writing rules tests passed')
