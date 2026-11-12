// 文件存储：UTF-8 Markdown/JSON + 原子写 + 修订备份 + 简单 diff。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const MAX_FILE_CHARS = 2_000_000
const MAX_DIFF_LINES = 400

export function contentHash(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

export function lineDiff(before, after) {
  const left = String(before ?? '').split(/\r?\n/)
  const right = String(after ?? '').split(/\r?\n/)
  const changes = []
  const max = Math.max(left.length, right.length)
  for (let index = 0; index < max && changes.length < MAX_DIFF_LINES; index += 1) {
    if (left[index] === right[index]) continue
    changes.push({
      line: index + 1,
      before: left[index] ?? null,
      after: right[index] ?? null,
    })
  }
  return {
    changed: changes.length > 0,
    linesAdded: Math.max(0, right.length - left.length),
    linesRemoved: Math.max(0, left.length - right.length),
    changes,
    truncated: changes.length >= MAX_DIFF_LINES,
  }
}

function safeRelative(root, relativePath) {
  const normalized = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) throw new Error('非法文件路径')
  const absolute = resolve(root, normalized)
  const rootAbsolute = resolve(root)
  if (absolute !== rootAbsolute && !absolute.startsWith(`${rootAbsolute}${sep}`)) {
    throw new Error('文件路径越过项目目录')
  }
  return { relative: normalized, absolute, rawRelative: relative(rootAbsolute, absolute) }
}

export class FileStore {
  constructor(root, { revisions = 'revisions' } = {}) {
    if (typeof root !== 'string' || !root.trim()) throw new Error('项目路径不能为空')
    this.root = resolve(root)
    this.revisionsDir = revisions
  }

  path(relativePath) {
    return safeRelative(this.root, relativePath).absolute
  }

  async readText(relativePath) {
    const { absolute } = safeRelative(this.root, relativePath)
    return readFile(absolute, 'utf8')
  }

  async readTextOrNull(relativePath) {
    try {
      return await this.readText(relativePath)
    } catch {
      return null
    }
  }

  async readJson(relativePath, fallback = null) {
    const text = await this.readTextOrNull(relativePath)
    if (text === null) return fallback
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`JSON 解析失败：${relativePath}`)
    }
  }

  async exists(relativePath) {
    try {
      await stat(safeRelative(this.root, relativePath).absolute)
      return true
    } catch {
      return false
    }
  }

  async list(relativeDir = '') {
    try {
      const { absolute } = safeRelative(this.root, relativeDir || '.')
      const entries = await readdir(absolute, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => ({ name: entry.name, path: relativeDir ? `${relativeDir}/${entry.name}` : entry.name }))
        .sort((left, right) => left.name.localeCompare(right.name))
    } catch {
      return []
    }
  }

  async writeText(relativePath, content, { revision = true } = {}) {
    const text = String(content ?? '')
    if (text.length > MAX_FILE_CHARS) throw new Error('单个文档超过 2,000,000 字符')
    const { absolute, relative: normalized } = safeRelative(this.root, relativePath)
    const before = await this.readTextOrNull(normalized)
    if (revision && before !== null && before !== text) {
      await this.backup(normalized, before)
    }
    await mkdir(dirname(absolute), { recursive: true })
    const temp = `${absolute}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    await writeFile(temp, text, 'utf8')
    await rename(temp, absolute)
    return {
      path: normalized,
      beforeHash: before === null ? null : contentHash(before),
      afterHash: contentHash(text),
      created: before === null,
    }
  }

  async writeJson(relativePath, value, options = {}) {
    return this.writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`, options)
  }

  async remove(relativePath) {
    try {
      await unlink(safeRelative(this.root, relativePath).absolute)
      return true
    } catch {
      return false
    }
  }

  async backup(relativePath, content) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = `${this.revisionsDir}/${stamp}-${relativePath.replace(/[\\/]/g, '__')}`
    try {
      const absolute = this.path(target)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, content, 'utf8')
    } catch {
      // 修订备份失败不阻塞主写入。
    }
  }

  async previewWrite(relativePath, content) {
    const before = await this.readTextOrNull(relativePath) ?? ''
    const after = String(content ?? '')
    return {
      path: String(relativePath),
      beforeHash: contentHash(before),
      afterHash: contentHash(after),
      bytesBefore: before.length,
      bytesAfter: after.length,
      diff: lineDiff(before, after),
    }
  }

  async ensureDirs(paths) {
    for (const relativePath of paths) {
      await mkdir(this.path(relativePath), { recursive: true })
    }
  }

  async tree() {
    const files = []
    const walk = async (relativeDir) => {
      const dir = this.path(relativeDir || '.')
      let entries = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === this.revisionsDir) continue
        const child = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(child)
        else if (entry.isFile()) files.push(child)
      }
    }
    await walk('')
    return files.sort()
  }
}

export { join }
