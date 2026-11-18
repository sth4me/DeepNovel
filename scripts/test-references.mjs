// 资料库存储测试：类型语义、增删改查、文件落盘。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileNovelStore } from '../file-store.js'
import { REFERENCE_KINDS, REFERENCE_KIND_LABELS } from '../storage/references.js'

const root = await mkdtemp(join(tmpdir(), 'deepnovel-refs-'))
const store = new FileNovelStore(root)

const empty = store.listReferences()
assert.equal(empty.sources.length, 0)
assert.deepEqual(REFERENCE_KINDS, ['original', 'prior', 'research', 'idea'])
assert.equal(REFERENCE_KIND_LABELS.original, '原作')
assert.equal(empty.kinds.length, 4)
for (const kind of empty.kinds) {
  assert.ok(kind.description && kind.description.length > 5, `${kind.kind} 必须有语义说明`)
}

const saved = store.saveReference({
  title: '原作设定',
  kind: 'original',
  content: '# 世界观\n剑与魔法。',
  tags: ['设定', '设定'],
  note: '只借世界观',
})
assert.equal(saved.kind, 'original')
assert.deepEqual(saved.tags, ['设定'])
assert.ok(saved.content.includes('剑与魔法'))

const read = store.readReference(saved.id)
assert.equal(read.title, '原作设定')
assert.equal(read.content.includes('剑与魔法'), true)
await stat(join(root, 'story', 'references', 'index.json'))
await stat(join(root, 'story', 'references', 'sources', `${saved.id}.md`))
assert.ok((await readFile(join(root, 'story', 'references', 'index.json'), 'utf8')).includes('原作设定'))
assert.ok((await readFile(join(root, 'story', 'references', 'sources', `${saved.id}.md`), 'utf8')).includes('剑与魔法'))

// 改类型：类型必须可编辑
const changed = store.saveReference({ id: saved.id, title: '原作设定', kind: 'research', content: '改为研究资料' })
assert.equal(changed.kind, 'research')
assert.equal(store.listReferences().sources.length, 1, '同 id 覆盖而不是新增')

// 未知类型回退为研究资料
const fallback = store.saveReference({ title: '未知类型', kind: 'nope', content: 'x' })
assert.equal(fallback.kind, 'research')
assert.throws(() => store.saveReference({ title: '  ', content: 'x' }), /标题不能为空/)

assert.equal(store.deleteReference(saved.id).deleted, true)
assert.equal(store.readReference(saved.id), null)
assert.equal(store.listReferences().sources.length, 1)

await rm(root, { recursive: true, force: true })
console.log('references tests passed')
