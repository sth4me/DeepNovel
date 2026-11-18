// 构思卡：标题 + 2–4 句核心故事，不是 logline/开场事件。
import assert from 'node:assert/strict'
import { PREMISE_SYSTEM_PROMPT, buildPremiseUserPrompt } from '../templates.js'

assert.ok(PREMISE_SYSTEM_PROMPT.includes('- title: string'))
assert.ok(PREMISE_SYSTEM_PROMPT.includes('- premise: string，2–4 句话的核心故事'))
assert.ok(!PREMISE_SYSTEM_PROMPT.includes('logline'))
assert.ok(!PREMISE_SYSTEM_PROMPT.includes('hook'))
assert.ok(!PREMISE_SYSTEM_PROMPT.includes('boundaries'))
assert.ok(!PREMISE_SYSTEM_PROMPT.includes('risks'))

const prompt = buildPremiseUserPrompt({
  title: 't',
  language: 'zh',
  count: 3,
  intent: '用户要普通职业场景里的故事，不要设定说明。',
})
assert.ok(prompt.includes('对话意图摘要'))
assert.ok(prompt.includes('每个 title 简洁'))
assert.ok(prompt.includes('premise 写 2–4 句话'))
assert.ok(!prompt.includes('logline'))

console.log('premise prompt tests passed')
