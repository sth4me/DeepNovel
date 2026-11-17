// 提示词渲染：不能把内部字段名与 JSON 结构直接塞给模型。
import assert from 'node:assert/strict'
import { buildChapterUserPrompt } from '../templates.js'

const prompt = buildChapterUserPrompt({
  title: '夜行刀客',
  language: 'zh',
  number: 2,
  chapter: {
    id: 'ch-002',
    number: 2,
    title: '盐铺问名',
    synopsis: '沈砚回城发现师父被杀，循铜符查到盐铺。',
    status: 'confirmed',
    wordBudget: 2200,
    plant: ['铜符上的盐渍'],
    payoff: ['师父握着的磨刀石'],
    change: '沈砚决定直接找盐商对质',
    castUsed: ['沈砚', '阿罗'],
  },
  styleFields: { pov: 'third-limited' },
  samples: [],
  wordBudget: 2200,
  storyContext: {
    premise: { title: '夜行刀客', premise: '刀客复仇', protagonist: '沈砚' },
    bible: { characters: [{ name: '沈砚', role: '刀客', description: '沉默寡言' }] },
    continuity: { recent: [{ number: 1, title: '雨夜归铺', summary: '发现灭门' }], previousTail: '他吹灭灶火。' },
    relations: [{ from: '沈砚', to: '阿罗', type: '保护' }],
    foreshadowing: [{ chapter: 1, text: '半枚铜符', overdue: true }],
    foreshadowingDue: ['师父握着的磨刀石'],
    timeline: [{ number: 1, day: 0, part: '夜', summary: '雨夜归城' }],
    notes: ['沈砚不说废话'],
  },
})

for (const label of ['剧情梗概', '本章要埋的伏笔', '本章要回收的伏笔', '故事背景', '相关设定', '人物关系', '未回收伏笔', '时间线']) {
  assert.ok(prompt.includes(label), `提示词应包含中文段落：${label}`)
}
for (const internal of ['wordBudget', 'synopsis', 'plant', 'payoff', 'foreshadow', 'castUsed', '"id"', 'JSON.stringify']) {
  assert.ok(!prompt.includes(internal), `提示词不应出现内部字段名：${internal}`)
}
assert.ok(prompt.includes('铜符上的盐渍'), '伏笔内容应保留')
assert.ok(prompt.includes('已超期'), '超期伏笔应有提示')

console.log('prompt render tests passed')
