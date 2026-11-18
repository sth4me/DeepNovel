// 导出验证：正文以 draft 为准（final 可能是旧快照），导出文件项目包含全部文档。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-export-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-export-project-'))
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
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
})
await service.initProject(project, { title: '导出测试' })
await service.writeJson(project, 'story/plot/outline.json', {
  status: 'confirmed',
  logline: '',
  volumes: [{
    id: 'v1', title: '卷一',
    chapters: [
      { id: 'ch-1', number: 1, title: '第一章', synopsis: '梗概一', status: 'confirmed', wordBudget: 10 },
      { id: 'ch-2', number: 2, title: '第二章', synopsis: '梗概二', status: 'confirmed', wordBudget: 10 },
    ],
  }],
})
await service.saveChapterText(project, { number: 1, text: '第一章 新的正文内容。' })
// 造一个更旧的 final 快照，验证导出取 draft 而不是 final
await service.writeTextFile(project, 'story/chapters/001/final.md', '第一章 旧正文。')
await service.saveChapterText(project, { number: 2, text: '第二章 正文内容。' })

const md = await service.exportManuscript(project, { format: 'md' })
const mdPath = join(project, md.path)
const mdText = await readFile(mdPath, 'utf8')
assert.ok(mdText.includes('第一章 新的正文内容'), '导出应使用当前正文（draft），不能用旧 final')
assert.ok(!mdText.includes('第一章 旧正文'), '不应导出过期的 final')
assert.ok(mdText.includes('第二章 正文内容'))

const exportFile = await service.exportFileProject(project)
assert.ok(exportFile.path, '文件项目导出应返回路径')
const exportedStory = join(project, exportFile.path, 'story')
const files = await readdir(exportedStory, { recursive: true })
assert.ok(files.some((name) => String(name).includes('project.json')), '导出应包含项目文档')
assert.ok(files.some((name) => String(name).includes('chapters') && String(name).includes('draft.md')), '导出应包含正文')

await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('export tests passed')
