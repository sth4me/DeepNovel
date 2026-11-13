// 资料库：原作、前作、研究资料与灵感副本。和小说正文/设定分开存放，只读参考。
import { readFile, readdir, stat } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { basename, extname, relative, resolve } from 'node:path'

export const REFERENCE_DIR = 'references'
export const REFERENCE_INDEX = 'references/index.json'
export const REFERENCE_SOURCES = 'references/sources'
export const REFERENCE_KINDS = ['canon', 'prior', 'research', 'idea']
export const REFERENCE_KIND_LABELS = {
  canon: '原作',
  prior: '我的前作',
  research: '研究资料',
  idea: '灵感',
}
export const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.csv', '.html', '.htm', '.docx', '.pdf'])
const MAX_FILES = 200
const MAX_FILE_CHARS = 2_000_000
const MAX_TOTAL_CHARS = 8_000_000

export function emptyReferenceIndex() {
  return { version: 1, updatedAt: null, sources: [] }
}

export function visibleTextLength(text) {
  const plain = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]/g, '')
  const cjk = (plain.match(/[\u3400-\u9fff]/g) ?? []).length
  const words = (plain.match(/[A-Za-z0-9]+/g) ?? []).length
  return cjk + words
}

export function kindLabel(kind) {
  return REFERENCE_KIND_LABELS[kind] ?? REFERENCE_KIND_LABELS.research
}

function normalizeKind(value) {
  return REFERENCE_KINDS.includes(value) ? value : 'research'
}

function normalizeTags(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
    : []
}

function normalizeEntry(item, index) {
  const id = String(item?.id ?? '').trim()
  if (!/^ref[A-Za-z0-9_-]{1,40}$/.test(id)) return null
  return {
    id,
    title: String(item?.title ?? '未命名资料').trim().slice(0, 200) || '未命名资料',
    kind: normalizeKind(item?.kind),
    path: `references/sources/${id}${String(item?.extension ?? '.md')}`,
    extension: String(item?.extension ?? '.md'),
    importedAt: String(item?.importedAt ?? ''),
    chars: Number(item?.chars) || 0,
    metricsVersion: Number(item?.metricsVersion) || 0,
    tags: normalizeTags(item?.tags),
    originalPath: typeof item?.originalPath === 'string' ? item.originalPath : '',
  }
}

function normalizeIndex(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    version: 1,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    sources: (Array.isArray(source.sources) ? source.sources : []).map(normalizeEntry).filter(Boolean),
  }
}

export async function readReferenceIndex(project) {
  const raw = await project.store.readJson(REFERENCE_INDEX, null).catch(() => null)
  return normalizeIndex(raw)
}

async function saveIndex(project, index) {
  const next = { ...index, version: 1, updatedAt: new Date().toISOString() }
  await project.store.writeJson(REFERENCE_INDEX, next)
  return next
}

function decodeXmlText(xml) {
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractDocxText(buffer) {
  const data = Buffer.from(buffer)
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  let end = -1
  for (let index = data.length - 22; index >= Math.max(0, data.length - 66000); index -= 1) {
    if (data.subarray(index, index + 4).equals(endSignature)) { end = index; break }
  }
  if (end < 0) throw new Error('无法读取 DOCX：不是有效的 zip 文件')
  const count = data.readUInt16LE(end + 10)
  let pointer = data.readUInt32LE(end + 16)
  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(pointer) !== 0x02014b50) break
    const method = data.readUInt16LE(pointer + 10)
    const compressedSize = data.readUInt32LE(pointer + 20)
    const nameLength = data.readUInt16LE(pointer + 28)
    const extraLength = data.readUInt16LE(pointer + 30)
    const commentLength = data.readUInt16LE(pointer + 32)
    const localOffset = data.readUInt32LE(pointer + 42)
    const name = data.toString('utf8', pointer + 46, pointer + 46 + nameLength)
    if (name === 'word/document.xml') {
      const localNameLength = data.readUInt16LE(localOffset + 26)
      const localExtraLength = data.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const compressed = data.subarray(start, start + compressedSize)
      const xml = method === 0 ? compressed : inflateRawSync(compressed)
      return decodeXmlText(xml.toString('utf8'))
    }
    pointer += 46 + nameLength + extraLength + commentLength
  }
  throw new Error('DOCX 中没有 word/document.xml')
}

async function walkFiles(root) {
  const files = []
  const stack = [root]
  while (stack.length && files.length < MAX_FILES) {
    const current = stack.pop()
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const absolute = resolve(current, entry.name)
      if (entry.isDirectory()) stack.push(absolute)
      else if (entry.isFile()) files.push(absolute)
      if (files.length >= MAX_FILES) break
    }
  }
  return files
}

function nextReferenceId(used) {
  let index = 1
  while (used.has(`ref${index}`)) index += 1
  return `ref${index}`
}

function looksBinary(text) {
  if (!text || text.includes('\u0000')) return true
  let controls = 0
  for (const char of text.slice(0, 2000)) {
    const code = char.charCodeAt(0)
    if (code < 9 || (code > 13 && code < 32)) controls += 1
  }
  return controls > 20
}

export async function importReferences(project, sourcePath, { kind = 'research', tags = [] } = {}) {
  const source = resolve(String(sourcePath ?? '').trim())
  if (!source) throw new Error('缺少资料路径')
  const info = await stat(source).catch(() => null)
  if (!info) throw new Error(`资料路径不存在：${source}`)
  const candidates = info.isDirectory() ? await walkFiles(source) : [source]
  const index = await readReferenceIndex(project)
  const used = new Set(index.sources.map((item) => item.id))
  const entries = []
  const written = []
  let totalChars = 0
  try {
    for (const file of candidates) {
      if (entries.length >= MAX_FILES) break
      const sourceExtension = extname(file).toLowerCase() || '.md'
      if (!TEXT_EXTENSIONS.has(sourceExtension)) continue
      const raw = await readFile(file).catch(() => null)
      if (!raw) continue
      let content = ''
      let extension = sourceExtension
      if (sourceExtension === '.docx') {
        try { content = extractDocxText(raw).trim() } catch { content = '' }
        extension = '.md'
      } else if (sourceExtension === '.pdf') {
        try {
          const { PDFParse } = await import('pdf-parse')
          const parser = new PDFParse({ data: raw })
          try {
            const parsed = await parser.getText()
            content = String(parsed?.text ?? '').trim()
          } finally {
            await parser.destroy?.().catch?.(() => {})
          }
        } catch {
          content = ''
        }
        extension = '.md'
      } else {
        content = raw.toString('utf8')
      }
      if (!content.trim() || looksBinary(content) || content.length > MAX_FILE_CHARS) continue
      if (totalChars + content.length > MAX_TOTAL_CHARS) break
      const id = nextReferenceId(used)
      used.add(id)
      const target = `references/sources/${id}${extension}`
      await project.store.writeText(target, content)
      written.push(target)
      const relativeTitle = info.isDirectory()
        ? relative(source, file).replace(/\\/g, '/')
        : basename(file)
      entries.push({
        id,
        title: relativeTitle.slice(0, 200),
        kind: normalizeKind(kind),
        path: target,
        extension,
        importedAt: new Date().toISOString(),
        chars: visibleTextLength(content),
        metricsVersion: 1,
        tags: normalizeTags(tags),
        originalPath: file,
      })
      totalChars += content.length
    }
    if (entries.length === 0) throw new Error('没有找到可导入的文本资料（支持 md/txt/json/yaml/csv/html/docx/pdf）')
    const next = { ...index, sources: [...index.sources, ...entries] }
    await saveIndex(project, next)
    return { imported: entries.length, entries, chars: totalChars }
  } catch (error) {
    for (const target of written) await project.store.remove(target).catch(() => {})
    throw error
  }
}

export async function listReferences(project) {
  const index = await readReferenceIndex(project)
  let changed = false
  for (const entry of index.sources) {
    if (entry.metricsVersion === 1) continue
    const content = await project.store.readTextOrNull(entry.path)
    entry.chars = visibleTextLength(content ?? '')
    entry.metricsVersion = 1
    changed = true
  }
  if (changed) await saveIndex(project, index).catch(() => {})
  return index.sources
}

export async function readReference(project, id) {
  const index = await readReferenceIndex(project)
  const entry = index.sources.find((item) => item.id === id)
  if (!entry) throw new Error(`找不到资料：${id}`)
  const content = await project.store.readTextOrNull(entry.path)
  if (content === null) throw new Error(`资料文件不存在：${entry.path}`)
  return { ...entry, content }
}

export async function deleteReference(project, id) {
  const index = await readReferenceIndex(project)
  const entry = index.sources.find((item) => item.id === id)
  if (!entry) throw new Error(`找不到资料：${id}`)
  await project.store.remove(entry.path).catch(() => {})
  const next = { ...index, sources: index.sources.filter((item) => item.id !== id) }
  await saveIndex(project, next)
  return { deleted: id }
}

export async function updateReference(project, id, fields = {}) {
  const index = await readReferenceIndex(project)
  const entry = index.sources.find((item) => item.id === id)
  if (!entry) throw new Error(`找不到资料：${id}`)
  if (fields.title !== undefined) entry.title = String(fields.title).trim().slice(0, 200) || entry.title
  if (fields.kind !== undefined) entry.kind = normalizeKind(fields.kind)
  if (fields.tags !== undefined) entry.tags = normalizeTags(fields.tags)
  const next = { ...index, sources: index.sources.map((item) => item.id === id ? entry : item) }
  await saveIndex(project, next)
  return entry
}

export async function searchReferences(project, query, { limit = 20 } = {}) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return { query: '', total: 0, results: [] }
  const sources = await listReferences(project)
  const results = []
  for (const entry of sources) {
    const content = await project.store.readTextOrNull(entry.path)
    if (!content) continue
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line.toLowerCase().includes(needle)) continue
      results.push({
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
        path: entry.path,
        line: index + 1,
        context: line.trim().slice(0, 500),
      })
      if (results.length >= Math.max(1, Number(limit) || 20)) break
    }
    if (results.length >= Math.max(1, Number(limit) || 20)) break
  }
  return { query: String(query), total: results.length, results }
}
