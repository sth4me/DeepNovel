// 其余生成提示词：上下文用中文渲染，不把输入对象 JSON dump 给模型。
// 注意：章纲/设定属于“JSON 输出任务”，其输出 schema 字段名（如 synopsis/time）必须保留，
// 这里只检查“输入上下文”不是 JSON。
import assert from 'node:assert/strict'
import {
  buildPremiseUserPrompt,
  buildOutlineUserPrompt,
  buildBibleUserPrompt,
  buildVolumePlanUserPrompt,
} from '../templates.js'

function assertRendered(name, prompt, expectedSnippets) {
  for (const snippet of expectedSnippets) {
    assert.ok(prompt.includes(snippet), `${name} 提示词应包含：${snippet}`)
  }
  for (const jsonToken of ['{"', 'JSON.stringify', '"premise":', '"characters":', '"roster":']) {
    assert.ok(!prompt.includes(jsonToken), `${name} 提示词不应包含 JSON 片段：${jsonToken}`)
  }
}

assertRendered('构思', buildPremiseUserPrompt({
  title: '测试书',
  language: 'zh',
  count: 2,
  genre: ['武侠'],
  chosen: { title: '旧构思', premise: '旧核心', protagonist: '沈砚', genre: ['武侠'], length: { chapters: 12, wordsPerChapter: 2500 } },
  reference: { title: '基准', premise: '基准核心' },
  instruction: '更冷硬',
}), ['当前已选构思', '故事核心：旧核心', '主角：沈砚', '基准核心'])

assertRendered('章纲', buildOutlineUserPrompt({
  title: '测试书',
  language: 'zh',
  totalChapters: 12,
  wordBudget: 2500,
  premise: { title: '测试书', premise: '核心', protagonist: '沈砚', genre: ['武侠'] },
  styleFields: { pov: 'third-limited' },
  bible: { characters: [{ name: '沈砚', role: '刀客', description: '沉默' }] },
  power: { system: { name: '内力', tiers: [{ name: '入门', order: 1 }] }, characters: [{ name: '沈砚', tierName: '入门' }] },
  contextChapters: [{ number: 1, title: '第一章', synopsis: '旧剧情' }],
  fromChapter: 2,
  count: 3,
}), ['已确认构思：', '故事核心：核心', '【既有设定（必须遵守）】', '沈砚', '体系：内力', '相邻/已有章节摘要'])

assertRendered('设定', buildBibleUserPrompt({
  title: '测试书',
  language: 'zh',
  scope: 'all',
  premise: { title: '测试书', premise: '核心', protagonist: '沈砚' },
  existing: { characters: [{ name: '沈砚' }] },
  instruction: '少而精',
}), ['已确认构思：', '故事核心：核心'])

assertRendered('卷规划', buildVolumePlanUserPrompt({
  title: '测试书',
  language: 'zh',
  volume: { id: 'vol-1', title: '第 1 卷' },
  premise: { title: '测试书', premise: '核心', protagonist: '沈砚' },
  styleFields: { pov: 'third-limited' },
  roster: [{ name: '沈砚', role: '主角', status: '在场' }],
  previousEndState: {
    states: [{ number: 3, 处境: '受伤' }],
    unresolved: ['铜符来历'],
    summary: '上一卷末章摘要',
  },
  previousVolume: { title: '前卷', map: '边城', goal: '查明真相', exitCriteria: '见到盐商', lastChapter: { number: 12, title: '末章', synopsis: '对峙' } },
}), ['人物状态（末 3 章）', '未解冲突/承诺', '沈砚', '铜符来历', '上一卷：', '卷名：前卷', '离卷条件：见到盐商'])

console.log('prompt render (all) tests passed')
