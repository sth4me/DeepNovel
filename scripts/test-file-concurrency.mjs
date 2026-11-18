// 文件存储的并发与原子写：多实例交替写、临时文件不残留、内容永远可解析。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileNovelStore } from '../file-store.js'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-file-conc-'))

// 两个独立实例模拟“两个写入方”
const a = new FileNovelStore(root)
const b = new FileNovelStore(root)

a.writeProject({ title: '并发测试' })
for (let index = 0; index < 50; index += 1) {
  a.writePremise({ status: 'candidate', chosenHash: `a-${index}` })
  b.writePremise({ status: 'candidate', chosenHash: `b-${index}` })
}
const premise = JSON.parse(await readFile(join(root, 'story', 'premise.json'), 'utf8'))
assert.ok(String(premise.chosenHash).startsWith('b-'), '后写覆盖先写')
assert.ok(premise.updatedAt, '内容始终完整')

// 多次写入后文件始终是合法 JSON，且没有临时文件残留
for (let index = 0; index < 20; index += 1) {
  b.writeStyleContract({ status: 'candidate', fields: { tone: `t${index}` } })
  const parsed = JSON.parse(await readFile(join(root, 'story', 'style', 'contract.json'), 'utf8'))
  assert.equal(parsed.fields.tone, `t${index}`)
}
const files = await readdir(join(root, 'story', 'style'))
assert.ok(files.every((name) => !name.includes('.tmp-')), '不能留下临时文件')

// 不同文档并发写互不影响
await Promise.all([
  Promise.resolve().then(() => b.writeBible({ status: 'candidate', characters: [{ id: 'ch-1', name: '甲' }] })),
  Promise.resolve().then(() => b.writeRelations({ status: 'candidate', relations: [{ from: '甲', to: '乙', type: '朋友' }] })),
  Promise.resolve().then(() => b.writePower({ tiers: [{ id: 'p1', name: '一' }] })),
])
assert.equal(b.readBible().characters[0].name, '甲')
assert.equal(b.readRelations().relations[0].type, '朋友')
assert.equal(b.readPower().tiers[0].name, '一')

// 新实例能读到最后一次写入
const fresh = new FileNovelStore(root)
assert.equal(fresh.readStyleContract().fields.tone, 't19')
assert.equal(fresh.readProject().title, '并发测试')

await rm(root, { recursive: true, force: true })
console.log('file concurrency tests passed')
