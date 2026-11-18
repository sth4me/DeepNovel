// 章节跨卷移动
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-move-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-move-project-'))
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
const service = new NovelWriterService({
  fs: fsCtx,
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
})
await service.initProject(project, { title: '移动测试' })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: '',
  volumes: [
    { id: 'v1', title: '卷一', chapters: [{ id: 'ch-1', number: 1, title: '第一章', synopsis: '一', status: 'confirmed' }] },
    { id: 'v2', title: '卷二', chapters: [{ id: 'ch-2', number: 2, title: '第二章', synopsis: '二', status: 'confirmed' }] },
  ],
})

await service.moveOutlineChapter(project, { number: 1, volumeId: 'v2' })
const outline = await service.readJson(project, 'story/plot/outline.json')
const v1 = outline.volumes.find((item) => item.id === 'v1')
const v2 = outline.volumes.find((item) => item.id === 'v2')
assert.equal(v1.chapters.length, 0, '原卷不应再有该章')
assert.equal(v2.chapters.length, 2, '目标卷应包含移入的章')
assert.ok(v2.chapters.some((item) => Number(item.number) === 1), '移动后章号保持不变')

await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('chapter move tests passed')
