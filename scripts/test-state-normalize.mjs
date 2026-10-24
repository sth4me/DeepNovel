// 状态规范化测试：卷摘要必须只暴露 chapterCount 数字，避免前端误当数组。
import assert from 'node:assert/strict'
import { NovelWriterService } from '../service.js'

const service = new NovelWriterService({})
const normalized = service.normalizeVolumeSummary({
  id: 'vol-1',
  title: '第一卷',
  chapters: [{ number: 1 }, { number: 2 }],
})
assert.equal(normalized.chapterCount, 2)
assert.equal(normalized.chapters, undefined)
assert.equal(normalized.title, '第一卷')

const fromCount = service.normalizeVolumeSummary({ id: 'vol-2', chapterCount: 4 })
assert.equal(fromCount.chapterCount, 4)
assert.equal(fromCount.chapters, undefined)

const empty = service.normalizeVolumeSummary({})
assert.equal(empty.chapterCount, 0)
assert.equal(empty.id, '')

console.log('state normalize tests passed')
