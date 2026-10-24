// 章节 meta 规范化测试：缺失文件时不应伪造 drafted 状态。
import assert from 'node:assert/strict'
import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
const empty = service.normalizeChapterMeta(null, 3)
assert.equal(empty.number, 3)
assert.equal(empty.wordCount, 0)
assert.equal(empty.status, '')
assert.equal(empty.finalStale, false)

const normalized = service.normalizeChapterMeta({ number: '4', wordCount: '1200', status: 'revised', finalStale: 1 }, 0)
assert.equal(normalized.number, 4)
assert.equal(normalized.wordCount, 1200)
assert.equal(normalized.status, 'revised')
assert.equal(normalized.finalStale, true)

console.log('chapter meta tests passed')
