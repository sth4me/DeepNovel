// 前端状态竞态：迟到的 project-state 响应不能覆盖新状态；文风页编辑中不能被外部覆盖。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')

assert.ok(client.includes('const loadSeqRef = useRef(0)'), '应有请求序号 ref')
assert.ok(client.includes('const seq = ++loadSeqRef.current'), 'load 应递增请求序号')
assert.ok(client.includes('if (seq !== loadSeqRef.current) return data'), '旧请求响应应被丢弃')
assert.ok(!/const data = await fetchProjectState\(target\)\s*setState\(data\)/.test(client), 'load 不应无条件 setState')

assert.ok(client.includes('const fieldsRef = useRef(fields)'), '文风页应跟踪最新表单值')
assert.ok(client.includes('const [externalUpdate, setExternalUpdate] = useState(false)'), '应提示外部更新')
assert.ok(client.includes('文风已在别处更新'), '应提示未保存修改被保留')
assert.ok(client.includes("if (JSON.stringify(fieldsRef.current ?? {}) !== JSON.stringify(contract.fields ?? {}))"), '编辑中不应接受外部覆盖')

console.log('ui state guard tests passed')
