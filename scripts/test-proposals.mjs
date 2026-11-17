// 写盘前审阅：提案创建、应用、冲突、拒绝。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-prop-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-prop-project-'))
process.env.DSH_HOME = home

const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await readFile(abs(target))
      return { version: String(info.length) }
    } catch {
      return null
    }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
}
const { NovelWriterService } = await import('../service.js')
const service = new NovelWriterService({ fs: fsCtx, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } })

await service.initProject(project, { title: '提案测试' })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: '',
  volumes: [{
    id: 'v1', title: '卷一', map: '', goal: '',
    chapters: [{ id: 'ch-1', number: 1, title: '第一章', synopsis: '旧要点', status: 'confirmed', wordBudget: 1000, inputs: {}, plant: [], payoff: [] }],
  }],
})

const first = await service.proposeChapterText(project, { number: 1, text: '第一段。\n第二段。' })
assert.equal(first.status, 'proposed', '应生成提案')
assert.equal(first.diff.addedParagraphs, 2)

const listed = await service.listProposals(project)
assert.equal(listed.proposals.length, 1)
assert.equal(listed.proposals[0].kind, 'chapter-text')

const applied = await service.applyProposal(project, { id: first.id })
assert.equal(applied.applied, true, '无冲突时应写入')
const draft = await readFile(join(project, 'story', 'chapters', '001', 'draft.md'), 'utf8')
assert.ok(draft.includes('第一段'))
assert.equal((await service.listProposals(project)).proposals.length, 0, '应用后不再待审')

// 冲突：提案后正文被别处改过
const second = await service.proposeChapterText(project, { number: 1, text: '第一段。\n修改后的第二段。' })
await writeFile(join(project, 'story', 'chapters', '001', 'draft.md'), '第一段。\n第三只手改过。', 'utf8')
const conflict = await service.applyProposal(project, { id: second.id })
assert.equal(conflict.applied, false)
assert.equal(conflict.conflict, true, '正文已变化时必须报冲突')
assert.ok(conflict.currentText.includes('第三只手改过'))
await service.rejectProposal(project, { id: second.id })
assert.equal((await service.listProposals(project)).proposals.length, 0)

// 章卡提案
const card = await service.proposeChapterCard(project, { number: 1, fields: { title: '雨夜归铺', synopsis: '新要点' } })
assert.equal(card.status, 'proposed')
await service.applyProposal(project, { id: card.id })
const outline = await service.readJson(project, 'story/plot/outline.json')
assert.equal(outline.volumes[0].chapters[0].title, '雨夜归铺')
assert.equal(outline.volumes[0].chapters[0].synopsis, '新要点')

// 无变更不产生提案
const same = await service.proposeChapterText(project, { number: 1, text: '第一段。\n第三只手改过。' })
assert.equal(same.status, 'unchanged')

await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('proposal tests passed')
