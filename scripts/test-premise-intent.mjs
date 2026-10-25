// 意图摘要：必须把整段对话交给摘要模型，而不是只取最后一句。
import assert from 'node:assert/strict'
import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
service.assertInitialized = async () => {}
let captured = null
service.systemFor = async (agent, task, base) => base
service.callJsonModel = async (agent, options) => {
  captured = options
  return { parsed: { intent: '用户想要低设定的职业场景抽卡，每张卡换职业和触发事件。' } }
}
const result = await service.premiseIntent('project', {
  history: [
    { role: 'user', content: '只给定一个职业，不要设定' },
    { role: 'assistant', content: '候选 A' },
    { role: 'user', content: '每张卡不要都写同一种职业' },
  ],
  instruction: '再抽一批',
})
assert.match(result.intent, /每张卡换职业/)
assert.match(captured.messages[0].content[0].text, /只给定一个职业/)
assert.match(captured.messages[0].content[0].text, /每张卡不要都写同一种职业/)
assert.equal(captured.kind, 'premise.intent')

console.log('premise intent tests passed')
