// 章纲提示词：只要求 synopsis，并带上上一章落点。
import assert from 'node:assert/strict'
import { buildOutlineUserPrompt, OUTLINE_SYSTEM_PROMPT } from '../templates.js'

const prompt = buildOutlineUserPrompt({
  title: 't',
  language: 'zh',
  fromChapter: 3,
  toChapter: 4,
  totalChapters: 20,
  wordBudget: 3000,
  premise: {},
  styleFields: {},
  previousAnchor: {
    number: 2,
    title: '二',
    synopsis: '他在码头等到天亮。',
    summary: '他确认船不会再回来。',
    ending: '他把灯吹灭了。',
  },
})
assert.ok(prompt.includes('【上一章落点（下一章必须承接）】'))
assert.ok(prompt.includes('他把灯吹灭了。'))
assert.ok(prompt.includes('下一章的 synopsis 必须从这个落点自然继续'))
assert.ok(OUTLINE_SYSTEM_PROMPT.includes('synopsis: string'))
assert.ok(!OUTLINE_SYSTEM_PROMPT.includes('goal:'))
assert.ok(!OUTLINE_SYSTEM_PROMPT.includes('beats'))
console.log('outline prompt tests passed')
