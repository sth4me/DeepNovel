// 章末伏笔回收的规则检查：只做提示，不因为改写措辞直接判错。
import assert from 'node:assert/strict'
import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
const chapter = { foreshadow: { payoff: ['旧河神牌', '井底那封信'] } }
assert.deepEqual(service.missingForeshadowPayoffs(chapter, '她把旧河神牌埋进井里。'), ['井底那封信'])
assert.deepEqual(service.missingForeshadowPayoffs(chapter, ''), [])
assert.deepEqual(service.missingForeshadowPayoffs({}, '正文'), [])
assert.deepEqual(
  service.missingForeshadowPayoffs(chapter, '旧河神牌被扔进水里，井底那封信也没留下。'),
  [],
)
console.log('foreshadow payoff tests passed')
