// 一次性迁移：把旧项目元数据和文风搬到新文档结构，旧数据整体备份后移除。
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.argv[2] || '/path/to/project'
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(root, '.deepnovel-backup', `legacy-${stamp}`)
const dbPath = join(root, 'story/project.db')

const { Project } = await import('../writing/project.js')
const existing = await Project.open(root).catch(() => null)
if (existing) throw new Error('项目已经是新文档结构，不需要迁移')

const db = new DatabaseSync(dbPath, { readOnly: true })
const projectRow = db.prepare('select * from project limit 1').get()
const styleRow = db.prepare('select * from style_contract limit 1').get()
db.close()
if (!projectRow) throw new Error('旧项目缺少 project 记录')

const styleFields = styleRow?.fields_json ? JSON.parse(styleRow.fields_json) : {}
const samples = styleRow?.samples_json ? JSON.parse(styleRow.samples_json) : []
const style = {
  ...styleFields,
  ...(samples.length ? { samples } : {}),
  ...(styleRow?.status ? { status: styleRow.status } : {}),
  ...(styleRow?.template_id ? { templateId: styleRow.template_id } : {}),
}
const title = String(projectRow.title || '未命名')
const language = projectRow.language === 'en' ? 'en' : 'zh'
const notes = String(projectRow.writing_notes || '')

// 先复制旧数据到备份；复制成功后再创建新项目，避免先删后失败。
await mkdir(backup, { recursive: true })
for (const name of ['story', '.dsh-writing']) {
  try {
    await stat(join(root, name))
    await cp(join(root, name), join(backup, name), { recursive: true, force: true })
  } catch {
    // 不存在则跳过
  }
}

const project = await Project.init(root, { title, language, genre: '', style })
await project.setStyle(style)
if (notes) await project.setMeta({ notes })
await project.save()

for (const name of ['story', '.dsh-writing']) {
  try {
    await rm(join(root, name), { recursive: true, force: true })
  } catch (error) {
    console.warn(`旧目录未能删除：${name}：${error instanceof Error ? error.message : error}`)
  }
}

const map = await project.projectMap()
console.log(JSON.stringify({
  migrated: true,
  root,
  backup,
  title: map.title,
  language: map.language,
  stage: map.stage,
  styleKeys: Object.keys(map.style ?? {}).length,
  notesChars: String(map.notes ?? '').length,
}, null, 2))
