// 项目：索引 + 文档树 + 写提案。创作内容不放在索引字段里。
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  MANIFEST_FILE,
  allChapters,
  defaultManifest,
  fileFor,
  findArc,
  findChapter,
  findVolume,
  isValidId,
  nextObjectId,
  normalizeManifest,
} from './manifest.js'
import { FileStore, contentHash, lineDiff } from './storage.js'
import { listReferences } from './references.js'

const DEFAULT_LEDGER = {
  version: 1,
  updatedAt: null,
  facts: [],
  knowledge: [],
  foreshadow: [],
  timeline: [],
  handoffs: [],
}

const DIRS = [
  'world',
  'characters',
  'plot',
  'plot/volumes',
  'plot/arcs',
  'plot/chapters',
  'manuscript',
  'continuity',
  'continuity/summaries',
  'revisions',
]

function compactText(text, max = 2400) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export class Project {
  constructor(root, manifest, store) {
    this.root = root
    this.manifest = normalizeManifest(manifest)
    this.store = store ?? new FileStore(root)
    this.proposals = new Map()
  }

  static async init(root, options = {}) {
    const store = new FileStore(root)
    const manifest = defaultManifest({
      title: options.title || basename(root) || '未命名',
      genre: options.genre,
      language: options.language,
      style: options.style,
    })
    await store.ensureDirs(DIRS)
    await store.writeText(fileFor('book'), '# 全书主线\n\n', { revision: false })
    await store.writeJson(fileFor('ledger'), DEFAULT_LEDGER, { revision: false })
    await store.writeJson(MANIFEST_FILE, manifest, { revision: false })
    return new Project(root, manifest, store)
  }

  static async open(root) {
    const store = new FileStore(root)
    const raw = await store.readJson(MANIFEST_FILE, null)
    if (!raw) throw new Error(`不是 DeepNovel 项目：${root} 缺少 ${MANIFEST_FILE}`)
    const project = new Project(root, raw, store)
    await project.ensureLayout()
    return project
  }

  async ensureLayout() {
    await this.store.ensureDirs(DIRS)
    if (!(await this.store.exists(fileFor('book')))) {
      await this.store.writeText(fileFor('book'), '# 全书主线\n\n', { revision: false })
    }
    if (!(await this.store.exists(fileFor('ledger')))) {
      await this.store.writeJson(fileFor('ledger'), DEFAULT_LEDGER, { revision: false })
    }
  }

  async save() {
    this.manifest.updatedAt = new Date().toISOString()
    await this.store.writeJson(MANIFEST_FILE, normalizeManifest(this.manifest))
    return this.manifest
  }

  get title() {
    return this.manifest.title
  }

  findChapter(id) {
    return findChapter(this.manifest, id)
  }

  findVolume(id) {
    return findVolume(this.manifest, id)
  }

  findArc(id) {
    return findArc(this.manifest, id)
  }

  objectTitle(kind, id) {
    if (kind === 'book') return this.manifest.plot.book.title
    if (kind === 'world') return this.manifest.world.find((item) => item.id === id)?.title ?? id
    if (kind === 'character') return this.manifest.characters.find((item) => item.id === id)?.name ?? id
    if (kind === 'volume') return this.findVolume(id)?.title ?? id
    if (kind === 'arc') return this.findArc(id)?.arc.title ?? id
    if (kind === 'chapter' || kind === 'manuscript' || kind === 'summary') return this.findChapter(id)?.chapter.title ?? id
    if (kind === 'ledger') return '连续性账本'
    return id
  }

  pathFor(kind, id = '') {
    return fileFor(kind, id)
  }

  async read(kind, id = '') {
    if (kind === 'ledger') {
      const ledger = await this.store.readJson(fileFor('ledger'), DEFAULT_LEDGER)
      const content = JSON.stringify(ledger, null, 2)
      return { kind, id, title: '连续性账本', file: fileFor('ledger'), content, object: ledger, hash: contentHash(content) }
    }
    if (kind === 'book') {
      const content = await this.store.readTextOrNull(fileFor('book')) ?? ''
      return { kind, id: 'book', title: this.manifest.plot.book.title, file: fileFor('book'), content, hash: contentHash(content) }
    }
    if (!id) throw new Error(`${kind} 需要对象 id`)
    if (kind === 'world' && !this.manifest.world.some((item) => item.id === id)) throw new Error(`找不到设定：${id}`)
    if (kind === 'character' && !this.manifest.characters.some((item) => item.id === id)) throw new Error(`找不到角色：${id}`)
    if (kind === 'volume' && !this.findVolume(id)) throw new Error(`找不到卷：${id}`)
    if (kind === 'arc' && !this.findArc(id)) throw new Error(`找不到剧情点：${id}`)
    if (['chapter', 'manuscript', 'summary'].includes(kind) && !this.findChapter(id)) throw new Error(`找不到章节：${id}`)
    const file = fileFor(kind === 'manuscript' ? 'manuscript' : kind === 'summary' ? 'summary' : kind, id)
    const content = await this.store.readTextOrNull(file) ?? ''
    return { kind, id, title: this.objectTitle(kind, id), file, content, hash: contentHash(content) }
  }

  async readJsonDoc(kind, id = '') {
    return this.store.readJson(fileFor(kind, id), null)
  }

  async write(kind, id, content) {
    const file = fileFor(kind === 'manuscript' ? 'manuscript' : kind === 'summary' ? 'summary' : kind, id)
    return this.store.writeText(file, String(content ?? ''))
  }

  async saveDoc(kind, id, content, { expectedHash = null } = {}) {
    const current = await this.read(kind, kind === 'book' || kind === 'ledger' ? '' : id)
    if (expectedHash && current.hash !== expectedHash) {
      const error = new Error('文档已被其他操作修改，请重新读取后再保存')
      error.code = 'DOC_CONFLICT'
      throw error
    }
    const result = await this.write(kind, kind === 'book' ? 'book' : id, content)
    return { ...current, content: String(content ?? ''), hash: result.afterHash, revision: result }
  }

  async revisions(kind, id = '') {
    const file = fileFor(kind === 'manuscript' ? 'manuscript' : kind === 'summary' ? 'summary' : kind, id)
    return { file, revisions: await this.store.listRevisions(file) }
  }

  async readRevision(name) {
    const path = String(name ?? '').replace(/\\/g, '/')
    if (!path.startsWith('revisions/') || path.includes('..')) throw new Error('非法修订路径')
    const content = await this.store.readText(path)
    return { name: path, content }
  }

  async setStyle(style) {
    this.manifest.style = { ...this.manifest.style, ...(style && typeof style === 'object' ? style : {}) }
    await this.save()
    return this.manifest.style
  }

  async setMeta(fields = {}) {
    if (fields.title !== undefined) this.manifest.title = String(fields.title).slice(0, 200)
    if (fields.genre !== undefined) this.manifest.genre = String(fields.genre).slice(0, 120)
    if (fields.language !== undefined) this.manifest.language = fields.language === 'en' ? 'en' : 'zh'
    if (fields.notes !== undefined) this.manifest.notes = String(fields.notes).slice(0, 12000)
    await this.save()
    return { title: this.manifest.title, genre: this.manifest.genre, language: this.manifest.language, notes: this.manifest.notes }
  }

  nextId(prefix, collection) {
    return nextObjectId(prefix, collection)
  }

  async createWorld({ title, category = 'general', content = '' } = {}) {
    const id = this.nextId('w', this.manifest.world)
    this.manifest.world.push({
      id,
      title: String(title || '未命名设定').slice(0, 200),
      category: String(category || 'general').slice(0, 80),
      order: this.manifest.world.length + 1,
    })
    await this.write('world', id, content)
    await this.save()
    return { id, kind: 'world', file: fileFor('world', id) }
  }

  async createCharacter({ name, role = '', content = '' } = {}) {
    const id = this.nextId('c', this.manifest.characters)
    this.manifest.characters.push({
      id,
      name: String(name || '未命名角色').slice(0, 200),
      role: String(role || '').slice(0, 120),
      order: this.manifest.characters.length + 1,
    })
    await this.write('character', id, content)
    await this.save()
    return { id, kind: 'character', file: fileFor('character', id) }
  }

  async createVolume({ title, content = '' } = {}) {
    const id = this.nextId('v', this.manifest.plot.volumes)
    this.manifest.plot.volumes.push({
      id,
      title: String(title || `第 ${this.manifest.plot.volumes.length + 1} 卷`).slice(0, 200),
      order: this.manifest.plot.volumes.length + 1,
      arcs: [],
      chapters: [],
    })
    await this.write('volume', id, content)
    await this.save()
    return { id, kind: 'volume', file: fileFor('volume', id) }
  }

  async createArc({ volumeId, title, content = '' } = {}) {
    const volume = this.findVolume(volumeId)
    if (!volume) throw new Error(`找不到卷：${volumeId}`)
    const id = this.nextId('a', volume.arcs)
    volume.arcs.push({
      id,
      title: String(title || '未命名剧情点').slice(0, 200),
      order: volume.arcs.length + 1,
    })
    await this.write('arc', id, content)
    await this.save()
    return { id, kind: 'arc', volumeId, file: fileFor('arc', id) }
  }

  async createChapter({ volumeId, title, arcId = null, content = '' } = {}) {
    const volume = this.findVolume(volumeId)
    if (!volume) throw new Error(`找不到卷：${volumeId}`)
    const id = this.nextId('ch', allChapters(this.manifest))
    const chapter = {
      id,
      title: String(title || `第 ${allChapters(this.manifest).length + 1} 章`).slice(0, 200),
      order: volume.chapters.length + 1,
      ...(arcId && volume.arcs.some((item) => item.id === arcId) ? { arcId } : {}),
    }
    volume.chapters.push(chapter)
    await this.write('chapter', id, content)
    await this.save()
    return { id, kind: 'chapter', volumeId, file: fileFor('chapter', id) }
  }

  async remove(kind, id) {
    if (kind === 'world') {
      this.manifest.world = this.manifest.world.filter((item) => item.id !== id)
    } else if (kind === 'character') {
      this.manifest.characters = this.manifest.characters.filter((item) => item.id !== id)
    } else if (kind === 'chapter') {
      const found = this.findChapter(id)
      if (!found) throw new Error(`找不到章节：${id}`)
      found.volume.chapters = found.volume.chapters.filter((item) => item.id !== id)
      await this.store.remove(fileFor('manuscript', id))
      await this.store.remove(fileFor('summary', id))
    } else if (kind === 'arc') {
      const found = this.findArc(id)
      if (!found) throw new Error(`找不到剧情点：${id}`)
      found.volume.arcs = found.volume.arcs.filter((item) => item.id !== id)
      for (const chapter of found.volume.chapters) if (chapter.arcId === id) delete chapter.arcId
    } else if (kind === 'volume') {
      this.manifest.plot.volumes = this.manifest.plot.volumes.filter((item) => item.id !== id)
    } else {
      throw new Error(`不支持删除：${kind}`)
    }
    await this.store.remove(fileFor(kind === 'chapter' ? 'chapter' : kind, id))
    await this.save()
    return { removed: true, kind, id }
  }

  async proposeCreate(input = {}) {
    const kind = String(input.kind ?? '')
    const content = String(input.content ?? '').trim()
    if (!['world', 'character', 'volume', 'arc', 'chapter'].includes(kind)) throw new Error(`不支持创建：${kind}`)
    if (!content) throw new Error('创建提案必须包含正文，不能创建空对象')
    const data = JSON.parse(JSON.stringify(this.manifest))
    let id
    let meta
    let parentVolume = null
    if (kind === 'world') {
      id = nextObjectId('w', data.world)
      meta = {
        id,
        title: String(input.title ?? content.split(/\r?\n/)[0]?.replace(/^#+\s*/, '') ?? '').trim().slice(0, 200) || '未命名设定',
        category: String(input.category ?? 'general').trim().slice(0, 80) || 'general',
        order: data.world.length + 1,
      }
    } else if (kind === 'character') {
      id = nextObjectId('c', data.characters)
      meta = {
        id,
        name: String(input.name ?? input.title ?? content.split(/\r?\n/)[0]?.replace(/^#+\s*/, '') ?? '').trim().slice(0, 200) || '未命名角色',
        role: String(input.role ?? '').trim().slice(0, 120),
        order: data.characters.length + 1,
      }
    } else if (kind === 'volume') {
      id = nextObjectId('v', data.plot.volumes)
      meta = {
        id,
        title: String(input.title ?? `第 ${data.plot.volumes.length + 1} 卷`).trim().slice(0, 200) || `第 ${data.plot.volumes.length + 1} 卷`,
        order: data.plot.volumes.length + 1,
        arcs: [],
        chapters: [],
      }
    } else {
      parentVolume = findVolume(data, input.volumeId)
      if (!parentVolume) throw new Error(`找不到所属卷：${input.volumeId ?? '（空）'}`)
      if (kind === 'arc') {
        id = nextObjectId('a', parentVolume.arcs)
        meta = {
          id,
          title: String(input.title ?? '未命名剧情点').trim().slice(0, 200) || '未命名剧情点',
          order: parentVolume.arcs.length + 1,
        }
      } else {
        id = nextObjectId('ch', allChapters(data))
        const arcId = input.arcId && parentVolume.arcs.some((arc) => arc.id === input.arcId) ? String(input.arcId) : undefined
        meta = {
          id,
          title: String(input.title ?? `第 ${allChapters(data).length + 1} 章`).trim().slice(0, 200) || `第 ${allChapters(data).length + 1} 章`,
          order: parentVolume.chapters.length + 1,
          ...(arcId ? { arcId } : {}),
        }
      }
    }
    const file = fileFor(kind === 'chapter' ? 'chapter' : kind, id)
    const before = ''
    const proposal = {
      id: `create-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      type: 'create',
      kind,
      targetId: id,
      parentVolumeId: parentVolume?.id ?? null,
      path: file,
      content,
      meta,
      beforeHash: contentHash(before),
      afterHash: contentHash(content),
      diff: lineDiff(before, content),
      createdAt: new Date().toISOString(),
    }
    this.proposals.set(proposal.id, { ...proposal, expiresAt: Date.now() + 30 * 60 * 1000 })
    await this.store.writeJson(`revisions/proposals/${proposal.id}.json`, proposal, { revision: false })
    const { content: _content, meta: _meta, ...visible } = proposal
    return { ...visible, preview: { kind, id, meta } }
  }

  async proposeWrite(kind, id, content) {
    if (['world', 'character'].includes(kind) && !(kind === 'world' ? this.manifest.world : this.manifest.characters).some((item) => item.id === id)) {
      throw new Error(`找不到${kind === 'world' ? '设定' : '人物'}：${id}`)
    }
    if (kind === 'volume' && !this.findVolume(id)) throw new Error(`找不到卷：${id}`)
    if (kind === 'arc' && !this.findArc(id)) throw new Error(`找不到剧情点：${id}`)
    if (['chapter', 'manuscript', 'summary'].includes(kind) && !this.findChapter(id)) throw new Error(`找不到章节：${id}`)
    const file = fileFor(kind === 'manuscript' ? 'manuscript' : kind === 'summary' ? 'summary' : kind, id)
    const preview = await this.store.previewWrite(file, content)
    const proposal = {
      id: `edit-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      kind,
      targetId: id,
      path: file,
      content: String(content ?? ''),
      beforeHash: preview.beforeHash,
      afterHash: preview.afterHash,
      diff: preview.diff,
      createdAt: new Date().toISOString(),
    }
    this.proposals.set(proposal.id, { ...proposal, expiresAt: Date.now() + 30 * 60 * 1000 })
    await this.store.writeJson(`revisions/proposals/${proposal.id}.json`, proposal, { revision: false })
    const { content: _content, ...visible } = proposal
    return visible
  }

  async applyCreateProposal(key, proposal) {
    if (this.findChapter(proposal.targetId) && proposal.kind === 'chapter') throw new Error(`章节已存在：${proposal.targetId}`)
    if (proposal.kind === 'world' && this.manifest.world.some((item) => item.id === proposal.targetId)) throw new Error(`设定已存在：${proposal.targetId}`)
    if (proposal.kind === 'character' && this.manifest.characters.some((item) => item.id === proposal.targetId)) throw new Error(`人物已存在：${proposal.targetId}`)
    if (proposal.kind === 'volume' && this.findVolume(proposal.targetId)) throw new Error(`卷已存在：${proposal.targetId}`)
    if (proposal.kind === 'arc' && this.findArc(proposal.targetId)) throw new Error(`剧情点已存在：${proposal.targetId}`)
    const next = JSON.parse(JSON.stringify(this.manifest))
    if (proposal.kind === 'world') {
      next.world.push(proposal.meta)
    } else if (proposal.kind === 'character') {
      next.characters.push(proposal.meta)
    } else if (proposal.kind === 'volume') {
      next.plot.volumes.push(proposal.meta)
    } else {
      const volume = findVolume(next, proposal.parentVolumeId)
      if (!volume) throw new Error(`找不到所属卷：${proposal.parentVolumeId}`)
      if (proposal.kind === 'arc') volume.arcs.push(proposal.meta)
      else volume.chapters.push(proposal.meta)
    }
    const file = proposal.path
    let written = false
    try {
      await this.store.writeText(file, proposal.content)
      written = true
      next.updatedAt = new Date().toISOString()
      await this.store.writeJson(MANIFEST_FILE, normalizeManifest(next))
      this.manifest = normalizeManifest(next)
    } catch (error) {
      if (written) await this.store.remove(file).catch(() => {})
      throw error
    }
    this.proposals.delete(key)
    await this.store.remove(`revisions/proposals/${key}.json`)
    return {
      applied: true,
      created: true,
      kind: proposal.kind,
      id: proposal.targetId,
      path: file,
      beforeHash: proposal.beforeHash,
      afterHash: proposal.afterHash,
      diff: proposal.diff,
      preview: { kind: proposal.kind, id: proposal.targetId, meta: proposal.meta },
    }
  }

  async listProposals() {
    const entries = await this.store.list('revisions/proposals').catch(() => [])
    const proposals = []
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -5)
      const proposal = await this.store.readJson(entry.path, null).catch(() => null)
      if (!proposal) continue
      if (proposal.expiresAt && proposal.expiresAt < Date.now()) {
        await this.store.remove(entry.path).catch(() => {})
        continue
      }
      const { content: _content, ...visible } = proposal
      proposals.push({
        ...visible,
        id: visible.id ?? id,
        contentPreview: String(proposal.content ?? '').slice(0, 600),
      })
    }
    return proposals.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
  }

  async rejectProposal(proposalId) {
    const id = String(proposalId ?? '')
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new Error('非法提案 id')
    this.proposals.delete(id)
    await this.store.remove(`revisions/proposals/${id}.json`).catch(() => {})
    return { rejected: true, id }
  }

  async applyProposal(proposalId, { confirm = false } = {}) {
    if (confirm !== true) throw new Error('应用修改需要 confirm: true')
    const key = String(proposalId ?? '')
    let proposal = this.proposals.get(key) ?? null
    if (!proposal) {
      proposal = await this.store.readJson(`revisions/proposals/${key}.json`, null)
    }
    if (!proposal) throw new Error('修改提案不存在或已过期')
    if (proposal.expiresAt && proposal.expiresAt < Date.now()) {
      this.proposals.delete(key)
      await this.store.remove(`revisions/proposals/${key}.json`)
      throw new Error('修改提案已过期，请重新生成')
    }
    if (proposal.type === 'create') return this.applyCreateProposal(key, proposal)
    const current = await this.store.readTextOrNull(proposal.path) ?? ''
    if (contentHash(current) !== proposal.beforeHash) return { applied: false, reason: 'content-changed' }
    const written = await this.store.writeText(proposal.path, proposal.content)
    this.proposals.delete(key)
    await this.store.remove(`revisions/proposals/${key}.json`)
    return {
      applied: true,
      path: proposal.path,
      beforeHash: proposal.beforeHash,
      afterHash: written.afterHash,
      diff: proposal.diff,
    }
  }

  readiness() {
    const missing = []
    if (!String(this.manifest.genre ?? '').trim()) missing.push('题材')
    if (!String(this.manifest.notes ?? '').trim()) missing.push('写作要求/核心方向')
    return { ready: missing.length === 0, missing }
  }

  async workflow() {
    const book = await this.store.readTextOrNull(fileFor('book')) ?? ''
    const directionText = String(book).replace(/^#\s*全书主线\s*/u, '').trim()
    const direction = directionText.length > 0
    const volumes = this.manifest.plot.volumes
    const chapters = allChapters(this.manifest)
    const hasWorld = this.manifest.world.length > 0
    const hasCharacters = this.manifest.characters.length > 0
    const hasVolume = volumes.length > 0
    const hasChapter = chapters.length > 0
    const manuscripts = []
    for (const chapter of chapters) {
      if (await this.store.exists(fileFor('manuscript', chapter.id))) manuscripts.push(chapter.id)
    }
    const summaries = []
    for (const chapter of chapters) {
      if (await this.store.exists(fileFor('summary', chapter.id))) summaries.push(chapter.id)
    }
    const stage = !direction ? 'opening'
      : (!hasWorld || !hasCharacters) ? 'foundation'
      : (!hasVolume || !hasChapter) ? 'outline'
      : manuscripts.length < chapters.length ? 'writing'
      : summaries.length < chapters.length ? 'continuity'
      : 'done'
    const checklist = stage === 'opening'
      ? [{ key: 'direction', label: '故事脊柱写入 plot/book.md', done: direction }]
      : stage === 'foundation'
        ? [
            { key: 'world', label: '世界规则（至少 1 条）', done: hasWorld },
            { key: 'character', label: '主要人物（至少 1 个）', done: hasCharacters },
          ]
        : stage === 'outline'
          ? [
              { key: 'volume', label: '分卷（至少 1 卷）', done: hasVolume },
              { key: 'chapter', label: '章卡（至少 1 章）', done: hasChapter },
            ]
          : stage === 'writing'
            ? [{ key: 'manuscript', label: `正文（${manuscripts.length}/${chapters.length} 章）`, done: manuscripts.length >= chapters.length }]
            : stage === 'continuity'
              ? [{ key: 'summary', label: `摘要/交接（${summaries.length}/${chapters.length} 章）`, done: summaries.length >= chapters.length }]
              : [{ key: 'done', label: '本卷主要产物已齐', done: true }]
    const next = stage === 'opening'
      ? { kind: 'direction', label: '和 AI 定故事方向', reason: '先把主角、持续压力和故事脊柱聊清楚，写入 plot/book.md。' }
      : stage === 'foundation'
        ? !hasWorld
          ? { kind: 'world', label: '让 AI 提 1–3 条世界规则', reason: '先有会影响人物选择的规则、势力或地点，后面写冲突才有依据。' }
          : { kind: 'character', label: '让 AI 设计主角和关键人物', reason: '至少有一个有欲望、有缺陷、会做选择的主角，故事才能推进。' }
        : stage === 'outline'
          ? !hasVolume
            ? { kind: 'outline', label: '让 AI 规划第一卷', reason: '先定本卷舞台、阻力和阶段目标，再拆章卡。' }
            : { kind: 'outline', label: '让 AI 补 2–3 张章卡', reason: '章卡写清每章任务和状态变化，正文才有依据。' }
          : stage === 'writing'
            ? { kind: 'manuscript', label: '让 AI 写下一章正文', reason: '章卡已就位，把缺失的正文补上。' }
            : stage === 'continuity'
              ? { kind: 'continuity', label: '让 AI 补摘要与下一章交接', reason: '正文完成后，把人物状态、摘要和交接写进连续性。' }
              : { kind: 'done', label: '查看连续性或规划下一卷', reason: '当前卷的主要产物已齐。' }
    const goals = {
      opening: '定下故事脊柱',
      foundation: '建立最小地基',
      outline: '规划第一卷和章卡',
      writing: '把本卷正文写出来',
      continuity: '补齐摘要和连续性',
      done: '本卷完成',
    }
    return {
      stage,
      direction,
      directionExcerpt: directionText.slice(0, 600),
      goal: goals[stage],
      checklist,
      counts: {
        world: this.manifest.world.length,
        characters: this.manifest.characters.length,
        volumes: volumes.length,
        chapters: chapters.length,
        manuscripts: manuscripts.length,
        summaries: summaries.length,
      },
      allowed: {
        direction: true,
        book: true,
        world: direction,
        character: direction,
        style: direction,
        volume: direction && hasWorld && hasCharacters,
        chapter: direction && hasWorld && hasCharacters && hasVolume,
        manuscript: direction && hasChapter,
        continuity: direction && manuscripts.length > 0,
        check: true,
      },
      next,
    }
  }

  async projectMap() {
    const volumes = []
    for (const volume of this.manifest.plot.volumes) {
      const chapters = []
      for (const chapter of volume.chapters) {
        chapters.push({
          id: chapter.id,
          title: chapter.title,
          order: chapter.order,
          arcId: chapter.arcId ?? null,
          hasCard: await this.store.exists(fileFor('chapter', chapter.id)),
          hasManuscript: await this.store.exists(fileFor('manuscript', chapter.id)),
          hasSummary: await this.store.exists(fileFor('summary', chapter.id)),
        })
      }
      volumes.push({
        id: volume.id,
        title: volume.title,
        order: volume.order,
        arcs: volume.arcs.map((item) => ({ id: item.id, title: item.title, order: item.order })),
        chapters,
      })
    }
    return {
      title: this.manifest.title,
      genre: this.manifest.genre,
      notes: this.manifest.notes,
      language: this.manifest.language,
      stage: await this.stage(),
      readiness: this.readiness(),
      workflow: await this.workflow(),
      style: this.manifest.style,
      references: await listReferences(this),
      world: this.manifest.world.map((item) => ({ id: item.id, title: item.title, category: item.category })),
      characters: this.manifest.characters.map((item) => ({ id: item.id, name: item.name, role: item.role })),
      plot: {
        book: { title: this.manifest.plot.book.title, file: this.manifest.plot.book.file },
        volumes,
      },
      continuity: { ledger: fileFor('ledger'), summaries: this.manifest.continuity.summaries },
    }
  }

  async stage() {
    const volumes = this.manifest.plot.volumes
    const chapters = allChapters(this.manifest)
    if (!this.manifest.style?.tone && this.manifest.world.length === 0) return 'setup'
    if (this.manifest.world.length === 0) return 'world'
    if (this.manifest.characters.length === 0) return 'character'
    if (volumes.length === 0 || chapters.length === 0) return 'plot'
    const missingManuscript = []
    for (const chapter of chapters) {
      if (!(await this.store.exists(fileFor('manuscript', chapter.id)))) missingManuscript.push(chapter.id)
    }
    if (missingManuscript.length > 0) return 'manuscript'
    return 'continuity'
  }

  async context({ focusKind = null, focusId = null, maxChars = 24000 } = {}) {
    const map = await this.projectMap()
    const parts = [`# 项目地图\n${JSON.stringify(map, null, 2)}`]
    if (this.manifest.notes) parts.push(`\n# 项目写作要求\n${compactText(this.manifest.notes, 4000)}`)
    let budget = Math.max(2000, Number(maxChars) || 24000)
    const add = (label, text, limit = 5000) => {
      const value = compactText(text, Math.min(limit, budget))
      if (!value.trim()) return
      parts.push(`\n# ${label}\n${value}`)
      budget -= value.length
    }
    if (focusKind) {
      try {
        const doc = await this.read(focusKind, focusId ?? '')
        add(`当前对象：${doc.title}`, doc.content, 8000)
      } catch {
        // 焦点对象不存在时只给地图。
      }
    }
    const summaries = this.store.list
      ? await this.store.list(this.manifest.continuity.summaries)
      : []
    for (const summary of summaries.slice(-3)) {
      if (budget <= 1000) break
      const text = await this.store.readTextOrNull(summary.path)
      if (text) add(`章节摘要 ${summary.name}`, text, 2500)
    }
    const ledger = await this.store.readJson(fileFor('ledger'), DEFAULT_LEDGER)
    add('连续性账本', JSON.stringify({
      facts: (ledger.facts ?? []).slice(-20),
      knowledge: (ledger.knowledge ?? []).slice(-20),
      foreshadow: (ledger.foreshadow ?? []).slice(-20),
      handoffs: (ledger.handoffs ?? []).slice(-10),
    }, null, 2), 5000)
    return parts.join('\n')
  }

  async readLedger() {
    const ledger = await this.store.readJson(fileFor('ledger'), DEFAULT_LEDGER)
    return { ...DEFAULT_LEDGER, ...(ledger && typeof ledger === 'object' ? ledger : {}) }
  }

  async commitChapter({ chapterId, summary = '', handoff = '', facts = [], knowledge = [], foreshadow = [], timeline = [] } = {}) {
    const found = this.findChapter(chapterId)
    if (!found) throw new Error(`找不到章节：${chapterId}`)
    const ledger = await this.readLedger()
    const at = new Date().toISOString()
    if (summary.trim()) await this.write('summary', chapterId, summary)
    const append = (key, entries) => {
      if (!Array.isArray(entries)) return
      for (const entry of entries) {
        if (entry === null || entry === undefined) continue
        ledger[key].push({ chapterId, at, ...(typeof entry === 'object' ? entry : { text: String(entry) }) })
      }
    }
    append('facts', facts)
    append('knowledge', knowledge)
    append('foreshadow', foreshadow)
    append('timeline', timeline)
    if (handoff) ledger.handoffs.push({ chapterId, at, text: String(handoff).slice(0, 4000) })
    ledger.updatedAt = at
    ledger.version = (Number(ledger.version) || 1) + 1
    await this.store.writeJson(fileFor('ledger'), ledger)
    return { chapterId, summaryPath: fileFor('summary', chapterId), ledgerVersion: ledger.version }
  }

  async exportMarkdown({ scope = 'all', volumeId = '', chapterId = '' } = {}) {
    const safeName = (value) => String(value ?? '').replace(/[\\/:*?"<>|]/g, '_') || 'novel'
    const allVolumes = this.manifest.plot.volumes
    const allChapters = allVolumes.flatMap((volume) => volume.chapters.map((chapter) => ({ ...chapter, volumeId: volume.id })))
    if (scope === 'chapter') {
      const chapter = allChapters.find((item) => item.id === chapterId)
      if (!chapter) throw new Error(`找不到章节：${chapterId}`)
      const parent = allVolumes.find((volume) => volume.id === chapter.volumeId)
      const card = await this.store.readTextOrNull(fileFor('chapter', chapter.id))
      const prose = await this.store.readTextOrNull(fileFor('manuscript', chapter.id))
      const summary = await this.store.readTextOrNull(fileFor('summary', chapter.id))
      const parts = [`# ${this.manifest.title}`, '', `## ${parent?.title ?? ''} · 第 ${chapter.order} 章 ${chapter.title}`, '']
      if (card) parts.push('### 章卡', '', card.trim(), '')
      if (prose) parts.push('### 正文', '', prose.trim(), '')
      if (summary) parts.push('### 摘要', '', summary.trim(), '')
      return { filename: `${safeName(this.manifest.title)}-第${chapter.order}章.md`, content: parts.join('\n') }
    }
    if (scope === 'volume') {
      const volume = allVolumes.find((item) => item.id === volumeId)
      if (!volume) throw new Error(`找不到卷：${volumeId}`)
      const parts = [`# ${this.manifest.title}`, '', `## 卷：${volume.title}`, '']
      const content = await this.store.readTextOrNull(fileFor('volume', volume.id))
      if (content) parts.push(content.trim(), '')
      for (const chapter of volume.chapters) {
        const card = await this.store.readTextOrNull(fileFor('chapter', chapter.id))
        const prose = await this.store.readTextOrNull(fileFor('manuscript', chapter.id))
        parts.push(`### 第 ${chapter.order} 章 ${chapter.title}`, '')
        if (card) parts.push('【章卡】', '', card.trim(), '')
        if (prose) parts.push('【正文】', '', prose.trim(), '')
      }
      return { filename: `${safeName(this.manifest.title)}-${safeName(volume.title)}.md`, content: parts.join('\n') }
    }
    const parts = [`# ${this.manifest.title}`, '', `题材：${this.manifest.genre || '未设置'}`, '']
    const book = await this.store.readTextOrNull(fileFor('book'))
    if (book) parts.push('## 全书主线', '', book.trim(), '')
    for (const item of this.manifest.world) {
      const content = await this.store.readTextOrNull(fileFor('world', item.id))
      if (content) parts.push(`## 设定：${item.title}`, '', content.trim(), '')
    }
    for (const item of this.manifest.characters) {
      const content = await this.store.readTextOrNull(fileFor('character', item.id))
      if (content) parts.push(`## 人物：${item.name}`, '', content.trim(), '')
    }
    for (const volume of allVolumes) {
      const content = await this.store.readTextOrNull(fileFor('volume', volume.id))
      if (content) parts.push(`## 卷：${volume.title}`, '', content.trim(), '')
      for (const chapter of volume.chapters) {
        const card = await this.store.readTextOrNull(fileFor('chapter', chapter.id))
        const prose = await this.store.readTextOrNull(fileFor('manuscript', chapter.id))
        parts.push(`### 第 ${chapter.order} 章 ${chapter.title}`, '')
        if (card) parts.push('【章卡】', '', card.trim(), '')
        if (prose) parts.push('【正文】', '', prose.trim(), '')
      }
    }
    return {
      filename: `${safeName(this.manifest.title)}.md`,
      content: parts.join('\n'),
    }
  }

  async search(query, { limit = 20 } = {}) {
    const text = String(query ?? '').trim()
    if (!text) return { query: text, total: 0, results: [] }
    const files = (await this.store.tree()).filter((path) => /\.(md|json)$/i.test(path) && !path.startsWith('revisions/'))
    const results = []
    for (const path of files) {
      if (results.length >= limit) break
      const content = await this.store.readTextOrNull(path)
      if (!content) continue
      let index = content.indexOf(text)
      while (index >= 0 && results.length < limit) {
        results.push({
          path,
          at: index,
          line: content.slice(0, index).split(/\r?\n/).length,
          context: content.slice(Math.max(0, index - 80), Math.min(content.length, index + text.length + 120)),
        })
        index = content.indexOf(text, index + text.length)
      }
    }
    return { query: text, total: results.length, results }
  }

  async tree() {
    const map = await this.projectMap()
    return {
      map,
      files: await this.store.tree(),
    }
  }
}

export { contentHash, lineDiff }
