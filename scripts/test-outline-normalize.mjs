// 章纲 normalize：优先 synopsis；旧章纲从目标/冲突/转折/结果回退成一段梗概。
import assert from 'node:assert/strict'
import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
const inputs = { premiseHash: 'p', styleHash: 's' }
const explicit = service.normalizeOutlineChapter(
  { title: '一', synopsis: '他推门进去，屋里没人。' },
  1,
  { wordBudget: 3000, inputs },
)
assert.equal(explicit.synopsis, '他推门进去，屋里没人。')
assert.equal(explicit.title, '一')

const legacy = service.normalizeOutlineChapter(
  { title: '二', goal: '拿回刀', conflict: '被拦', turn: '旧友出现', outcome: '刀断人走' },
  2,
  { wordBudget: 3000, inputs },
)
assert.equal(legacy.synopsis, '拿回刀；被拦；旧友出现；刀断人走')

console.log('outline normalize tests passed')
