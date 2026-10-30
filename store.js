/**
 * SQLite 数据访问层（Phase 0）。
 * 所有读写都返回/接收与现有 JSON 文件一致的形状，service.js 后续可机械替换。
 * 正文（draft.md / final.md / revisions）仍保留在文件系统，不在这里管理；
 * 只有 FTS 索引在 reindex* 时读取正文建立。
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jsonGet, jsonSet, transaction, withBusyRetry } from './db.js'

const BIBLE_CATEGORIES = ['characters', 'locations', 'rules', 'factions', 'items']
export const MATERIAL_KINDS = ['片段', '资料', '桥段', '引用', '其他']
const MATERIAL_TAGS_LIMIT = 10

/** 素材标签：数组或逗号/空白分隔字符串 → 去重、最多 10 个。 */
function normalizeMaterialTags(tags) {
  const list = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(/[,，\s]+/) : [])
  const seen = new Set()
  const out = []
  for (const tag of list) {
    const value = String(tag ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value.slice(0, 40))
    if (out.length >= MATERIAL_TAGS_LIMIT) break
  }
  return out
}
const BIBLE_LABELS = { characters: '角色', locations: '地点', rules: '规则', factions: '势力', items: '物品' }

function now() {
  return new Date().toISOString()
}

/** 绑定参数时把 undefined 统一成 null（node:sqlite 不接受 undefined）。 */
function bind(value) {
  return value === undefined ? null : value
}

export class NovelStore {
  constructor(db, projectRoot) {
    this.db = db
    this.projectRoot = projectRoot
  }

  /* ------------------------------ 基础执行 ------------------------------ */

  run(sql, ...params) {
    return withBusyRetry(() => this.db.prepare(sql).run(...params.map(bind)))
  }

  get(sql, ...params) {
    return withBusyRetry(() => this.db.prepare(sql).get(...params.map(bind)))
  }

  all(sql, ...params) {
    return withBusyRetry(() => this.db.prepare(sql).all(...params.map(bind)))
  }

  tx(fn) {
    return transaction(this.db, fn)
  }

  /* ------------------------------ 项目 ------------------------------ */

  readProject() {
    const row = this.get('SELECT * FROM project WHERE id = 1')
    if (!row) return null
    const extra = jsonGet(row.extra_json, {})
    return {
      ...extra,
      schemaVersion: row.schema_version ?? 1,
      title: row.title ?? '',
      language: row.language ?? 'zh',
      logline: row.logline ?? null,
      writingNotes: row.writing_notes ?? '',
      craftAuto: row.craft_auto == null ? true : Boolean(row.craft_auto),
      automation: jsonGet(row.automation_json, {}),
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    }
  }

  writeProject(patch = {}) {
    const current = this.readProject() ?? {}
    const merged = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) }
    const known = new Set([
      'schemaVersion', 'title', 'language', 'logline', 'writingNotes',
      'craftAuto', 'automation', 'createdAt', 'updatedAt',
    ])
    const extra = {}
    for (const [key, value] of Object.entries(merged)) {
      if (!known.has(key)) extra[key] = value
    }
    const timestamp = now()
    this.run(
      `INSERT INTO project (id, schema_version, title, language, genre_json, logline, writing_notes, craft_auto, prompt_json, automation_json, extra_json, created_at, updated_at)
       VALUES (1, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         title = excluded.title,
         language = excluded.language,
         logline = excluded.logline,
         writing_notes = excluded.writing_notes,
         craft_auto = excluded.craft_auto,
         automation_json = excluded.automation_json,
         extra_json = excluded.extra_json,
         updated_at = excluded.updated_at`,
      Number(merged.schemaVersion) || 1,
      String(merged.title ?? ''),
      String(merged.language ?? 'zh'),
      bind(merged.logline ?? null),
      String(merged.writingNotes ?? ''),
      merged.craftAuto === false ? 0 : 1,
      jsonSet(merged.automation ?? {}),
      jsonSet(extra),
      merged.createdAt ?? timestamp,
      merged.updatedAt ?? timestamp,
    )
    return this.readProject()
  }

  /** 项目级提示词注入配置（story/prompt.json 的等价物）。 */
  readProjectPrompt() {
    const row = this.get('SELECT prompt_json FROM project WHERE id = 1')
    if (!row) return null
    return jsonGet(row.prompt_json, null)
  }

  writeProjectPrompt(value) {
    if (!this.get('SELECT id FROM project WHERE id = 1')) this.writeProject({})
    this.run('UPDATE project SET prompt_json = ?, updated_at = ? WHERE id = 1', jsonSet(value), now())
    return this.readProjectPrompt()
  }

  readAutomation() {
    const row = this.get('SELECT automation_json FROM project WHERE id = 1')
    if (!row) return null
    return jsonGet(row.automation_json, null)
  }

  writeAutomation(value) {
    if (!this.get('SELECT id FROM project WHERE id = 1')) this.writeProject({})
    this.run('UPDATE project SET automation_json = ?, updated_at = ? WHERE id = 1', jsonSet(value), now())
    return this.readAutomation()
  }

  /* ------------------------------ 构思 ------------------------------ */

  readPremise() {
    const row = this.get('SELECT * FROM premise WHERE id = 1')
    if (!row) return null
    const extra = jsonGet(row.extra_json, {})
    return {
      ...extra,
      status: row.status ?? 'candidate',
      candidates: jsonGet(row.candidates_json, []),
      chosen: jsonGet(row.chosen_json, null),
      chosenHash: row.chosen_hash ?? null,
      updatedAt: row.updated_at ?? null,
    }
  }

  writePremise(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const known = new Set(['status', 'candidates', 'chosen', 'chosenHash', 'updatedAt'])
    const extra = {}
    for (const [key, item] of Object.entries(source)) {
      if (!known.has(key)) extra[key] = item
    }
    const timestamp = now()
    this.run(
      `INSERT INTO premise (id, status, chosen_json, candidates_json, chosen_hash, extra_json, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         chosen_json = excluded.chosen_json,
         candidates_json = excluded.candidates_json,
         chosen_hash = excluded.chosen_hash,
         extra_json = excluded.extra_json,
         updated_at = excluded.updated_at`,
      bind(source.status ?? 'candidate'),
      jsonSet(source.chosen ?? null),
      jsonSet(Array.isArray(source.candidates) ? source.candidates : []),
      bind(source.chosenHash ?? null),
      jsonSet(extra),
      source.updatedAt ?? timestamp,
    )
    return this.readPremise()
  }

  /* ------------------------------ 文风 ------------------------------ */

  readStyleContract() {
    const row = this.get('SELECT * FROM style_contract WHERE id = 1')
    if (!row) return null
    return {
      status: row.status ?? 'candidate',
      templateId: row.template_id ?? null,
      fields: jsonGet(row.fields_json, {}),
      samples: jsonGet(row.samples_json, []),
      fieldsHash: row.fields_hash ?? null,
      updatedAt: row.updated_at ?? null,
    }
  }

  writeStyleContract(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const timestamp = now()
    this.run(
      `INSERT INTO style_contract (id, status, template_id, fields_json, samples_json, fields_hash, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         template_id = excluded.template_id,
         fields_json = excluded.fields_json,
         samples_json = excluded.samples_json,
         fields_hash = excluded.fields_hash,
         updated_at = excluded.updated_at`,
      bind(source.status ?? 'candidate'),
      bind(source.templateId ?? null),
      jsonSet(source.fields ?? {}),
      jsonSet(Array.isArray(source.samples) ? source.samples : []),
      bind(source.fieldsHash ?? null),
      source.updatedAt ?? timestamp,
    )
    return this.readStyleContract()
  }

  listStyleTemplates() {
    return this.all('SELECT * FROM style_templates ORDER BY created_at, id').map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      group: row.group_name ?? '自定义',
      tags: jsonGet(row.tags_json, []),
      description: row.description ?? '',
      fields: jsonGet(row.fields_json, {}),
      samples: jsonGet(row.samples_json, []),
      createdAt: row.created_at ?? null,
    }))
  }

  saveStyleTemplate(template = {}) {
    const source = template && typeof template === 'object' ? template : {}
    const id = String(source.id ?? '')
    if (!id) throw new Error('文风模板缺少 id')
    this.run(
      `INSERT INTO style_templates (id, name, group_name, description, tags_json, fields_json, samples_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         group_name = excluded.group_name,
         description = excluded.description,
         tags_json = excluded.tags_json,
         fields_json = excluded.fields_json,
         samples_json = excluded.samples_json`,
      id,
      String(source.name ?? id),
      String(source.group ?? '自定义'),
      String(source.description ?? ''),
      jsonSet(Array.isArray(source.tags) ? source.tags : []),
      jsonSet(source.fields ?? {}),
      jsonSet(Array.isArray(source.samples) ? source.samples : []),
      source.createdAt ?? now(),
    )
    return this.listStyleTemplates().find((item) => item.id === id) ?? null
  }

  deleteStyleTemplate(id) {
    const result = this.run('DELETE FROM style_templates WHERE id = ?', String(id ?? ''))
    return { deleted: String(id ?? ''), changes: result.changes }
  }

  /* ------------------------------ 设定 ------------------------------ */

  readBible() {
    const meta = this.get('SELECT * FROM bible_meta WHERE id = 1')
    const extra = meta ? jsonGet(meta.extra_json, {}) : {}
    const data = {
      status: meta?.status ?? 'missing',
      updatedAt: meta?.updated_at ?? null,
      confirmedAt: extra.confirmedAt ?? null,
    }
    for (const category of BIBLE_CATEGORIES) data[category] = []
    const rows = this.all('SELECT * FROM bible_entries ORDER BY category, sort_order, rowid')
    for (const row of rows) {
      if (!data[row.category]) continue
      const entry = {
        id: row.id,
        name: row.name ?? '',
      }
      if (row.role !== null) entry.role = row.role
      entry.description = row.description ?? ''
      if (row.traits_json !== null) entry.traits = jsonGet(row.traits_json, [])
      if (row.goal !== null) entry.goal = row.goal
      if (row.notes !== null) entry.notes = row.notes
      data[row.category].push(entry)
    }
    return data
  }

  writeBible(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const timestamp = source.updatedAt ?? now()
    return this.tx(() => {
      this.run('DELETE FROM bible_entries')
      let index = 0
      for (const category of BIBLE_CATEGORIES) {
        const entries = Array.isArray(source[category]) ? source[category] : []
        let order = 0
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue
          const id = String(entry.id ?? `${category}-${index + 1}`)
          this.run(
            `INSERT OR REPLACE INTO bible_entries
              (id, category, name, role, description, traits_json, goal, notes, sort_order, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            category,
            String(entry.name ?? ''),
            bind(entry.role ?? null),
            bind(entry.description ?? null),
            entry.traits === undefined ? null : jsonSet(Array.isArray(entry.traits) ? entry.traits : []),
            bind(entry.goal ?? null),
            bind(entry.notes ?? null),
            order,
            timestamp,
          )
          order += 1
          index += 1
        }
      }
      const extra = {}
      if (source.confirmedAt !== undefined) extra.confirmedAt = source.confirmedAt
      this.run(
        `INSERT INTO bible_meta (id, status, extra_json, updated_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, extra_json = excluded.extra_json, updated_at = excluded.updated_at`,
        bind(source.status ?? 'missing'),
        jsonSet(extra),
        timestamp,
      )
      return this.readBible()
    })
  }

  readRelations() {
    const meta = this.get('SELECT * FROM relations_meta WHERE id = 1')
    const relations = this.all('SELECT from_name, to_name, type, note FROM relations ORDER BY id').map((row) => ({
      from: row.from_name ?? '',
      to: row.to_name ?? '',
      type: row.type ?? '',
      note: row.note ?? '',
    }))
    const positions = {}
    for (const row of this.all('SELECT name, x, y FROM relation_positions')) {
      positions[row.name] = { x: row.x, y: row.y }
    }
    return {
      status: meta?.status ?? 'candidate',
      relations,
      positions,
      updatedAt: meta?.updated_at ?? null,
    }
  }

  writeRelations(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const timestamp = source.updatedAt ?? now()
    return this.tx(() => {
      this.run('DELETE FROM relations')
      for (const item of Array.isArray(source.relations) ? source.relations : []) {
        if (!item || typeof item !== 'object') continue
        this.run(
          'INSERT INTO relations (from_name, to_name, type, note) VALUES (?, ?, ?, ?)',
          String(item.from ?? ''),
          String(item.to ?? ''),
          String(item.type ?? ''),
          String(item.note ?? ''),
        )
      }
      this.run('DELETE FROM relation_positions')
      for (const [name, point] of Object.entries(source.positions ?? {})) {
        const x = Number(point?.x)
        const y = Number(point?.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        this.run('INSERT OR REPLACE INTO relation_positions (name, x, y) VALUES (?, ?, ?)', String(name), x, y)
      }
      this.run(
        `INSERT INTO relations_meta (id, status, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
        bind(source.status ?? 'candidate'),
        timestamp,
      )
      return this.readRelations()
    })
  }

  /* ------------------------------ 能力体系 ------------------------------ */

  readPower() {
    const row = this.get('SELECT json FROM power WHERE id = 1')
    return row ? jsonGet(row.json, null) : null
  }

  writePower(value) {
    const timestamp = (value && typeof value === 'object' && value.updatedAt) || now()
    this.run(
      `INSERT INTO power (id, json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      jsonSet(value ?? null),
      timestamp,
    )
    return this.readPower()
  }

  /* ------------------------------ 大纲 ------------------------------ */

  readOutline() {
    const meta = this.get('SELECT * FROM outline_meta WHERE id = 1')
    const extra = meta ? jsonGet(meta.extra_json, {}) : {}
    const volumes = this.all('SELECT * FROM volumes ORDER BY sort_order, rowid').map((row) => ({
      ...jsonGet(row.extra_json, {}),
      id: row.id,
      title: row.title ?? '',
      map: row.map ?? '',
      goal: row.goal ?? '',
      powerCeiling: row.power_ceiling ?? null,
      exitCriteria: row.exit_criteria ?? null,
      targetChapters: row.target_chapters ?? null,
      chapters: this.all(
        'SELECT * FROM outline_chapters WHERE volume_id = ? ORDER BY number, rowid',
        row.id,
      ).map((chapter) => this.chapterFromRow(chapter)),
    }))
    return {
      ...extra,
      status: meta?.status ?? 'candidate',
      logline: meta?.logline ?? null,
      volumes,
      updatedAt: meta?.updated_at ?? null,
    }
  }

  chapterFromRow(row) {
    return {
      ...jsonGet(row.extra_json, {}),
      id: row.id,
      number: Number(row.number),
      title: row.title ?? '',
      synopsis: row.synopsis ?? '',
      status: row.status ?? 'candidate',
      wordBudget: row.word_budget ?? null,
      inputs: jsonGet(row.inputs_json, {}),
      plant: jsonGet(row.plant_json, []),
      payoff: jsonGet(row.payoff_json, []),
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    }
  }

  writeOutline(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const volumes = Array.isArray(source.volumes) ? source.volumes : []
    const timestamp = source.updatedAt ?? now()
    return this.tx(() => {
      // diff：先收集要保留的 volume/chapter id，再删多余、upsert 现有。
      const volumeIds = new Set()
      const chapterIds = new Set()
      let volumeOrder = 0
      for (const volume of volumes) {
        if (!volume || typeof volume !== 'object') continue
        const volumeId = String(volume.id ?? `volume-${volumeOrder + 1}`)
        volumeIds.add(volumeId)
        this.run(
          `INSERT INTO volumes (id, title, map, goal, power_ceiling, exit_criteria, target_chapters, sort_order, extra_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, map = excluded.map, goal = excluded.goal,
             power_ceiling = excluded.power_ceiling, exit_criteria = excluded.exit_criteria,
             target_chapters = excluded.target_chapters, sort_order = excluded.sort_order,
             extra_json = excluded.extra_json`,
          volumeId,
          String(volume.title ?? ''),
          String(volume.map ?? ''),
          String(volume.goal ?? ''),
          bind(volume.powerCeiling ?? null),
          bind(volume.exitCriteria ?? null),
          Number.isFinite(Number(volume.targetChapters)) ? Number(volume.targetChapters) : null,
          volumeOrder,
          jsonSet(this.extraFields(volume, ['id', 'title', 'map', 'goal', 'powerCeiling', 'exitCriteria', 'targetChapters', 'chapters'])),
        )
        volumeOrder += 1
        const chapters = Array.isArray(volume.chapters) ? volume.chapters : []
        for (const chapter of chapters) {
          if (!chapter || typeof chapter !== 'object') continue
          const chapterId = String(chapter.id ?? '')
          if (!chapterId) continue
          chapterIds.add(chapterId)
          this.run(
            `INSERT INTO outline_chapters
              (id, number, volume_id, title, synopsis, status, word_budget, inputs_json, plant_json, payoff_json, created_at, updated_at, extra_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               number = excluded.number, volume_id = excluded.volume_id, title = excluded.title,
               synopsis = excluded.synopsis, status = excluded.status, word_budget = excluded.word_budget,
               inputs_json = excluded.inputs_json, plant_json = excluded.plant_json,
               payoff_json = excluded.payoff_json, created_at = excluded.created_at,
               updated_at = excluded.updated_at, extra_json = excluded.extra_json`,
            chapterId,
            Number.isFinite(Number(chapter.number)) ? Number(chapter.number) : null,
            volumeId,
            String(chapter.title ?? ''),
            bind(chapter.synopsis ?? null),
            bind(chapter.status ?? 'candidate'),
            Number.isFinite(Number(chapter.wordBudget)) ? Number(chapter.wordBudget) : null,
            jsonSet(chapter.inputs ?? {}),
            jsonSet(Array.isArray(chapter.plant) ? chapter.plant : []),
            jsonSet(Array.isArray(chapter.payoff) ? chapter.payoff : []),
            bind(chapter.createdAt ?? null),
            bind(chapter.updatedAt ?? null),
            jsonSet(this.extraFields(chapter, ['id', 'number', 'title', 'synopsis', 'status', 'wordBudget', 'inputs', 'plant', 'payoff', 'createdAt', 'updatedAt'])),
          )
        }
      }
      // 删除不再存在的行（先删 chapter 再删 volume，避免外键 SET NULL 留下孤儿）。
      const existingChapters = this.all('SELECT id FROM outline_chapters')
      for (const row of existingChapters) {
        if (!chapterIds.has(row.id)) this.run('DELETE FROM outline_chapters WHERE id = ?', row.id)
      }
      const existingVolumes = this.all('SELECT id FROM volumes')
      for (const row of existingVolumes) {
        if (!volumeIds.has(row.id)) this.run('DELETE FROM volumes WHERE id = ?', row.id)
      }
      this.run(
        `INSERT INTO outline_meta (id, status, logline, extra_json, updated_at) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, logline = excluded.logline,
           extra_json = excluded.extra_json, updated_at = excluded.updated_at`,
        bind(source.status ?? 'candidate'),
        bind(source.logline ?? null),
        jsonSet(this.extraFields(source, ['status', 'logline', 'volumes', 'updatedAt'])),
        timestamp,
      )
      return this.readOutline()
    })
  }

  /** 收集对象里已知字段之外的字段，用于 extra_json 兜底。 */
  extraFields(source, knownFields) {
    const known = new Set(knownFields)
    const extra = {}
    for (const [key, value] of Object.entries(source ?? {})) {
      if (known.has(key)) continue
      extra[key] = value
    }
    return extra
  }

  /* ------------------------------ 章节 ------------------------------ */

  readChapterMeta(number) {
    const row = this.get('SELECT json FROM chapter_meta WHERE number = ?', Number(number))
    return row ? jsonGet(row.json, null) : null
  }

  writeChapterMeta(number, value) {
    const source = value && typeof value === 'object' ? value : {}
    const n = Number(number)
    this.run(
      `INSERT INTO chapter_meta (number, json, status, word_count, outline_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(number) DO UPDATE SET json = excluded.json, status = excluded.status,
         word_count = excluded.word_count, outline_hash = excluded.outline_hash, updated_at = excluded.updated_at`,
      n,
      jsonSet(source),
      bind(source.status ?? null),
      Number.isFinite(Number(source.wordCount)) ? Number(source.wordCount) : null,
      bind(source.outlineHash ?? null),
      source.updatedAt ?? now(),
    )
    return this.readChapterMeta(n)
  }

  /**
   * 设置某章的正文存在性（schema v2）。没有 meta 行时补一行最小记录，
   * 保证外部直写正文（尚无 meta）也能持久化 flags。
   * 支持只传一个字段（例如写完 draft 只更新 hasDraft，另一列保持不变）。
   */
  setChapterProseFlags(number, flags = {}) {
    const n = Number(number)
    if (!Number.isFinite(n) || n < 1) return null
    const hasDraft = flags.hasDraft === undefined ? null : (flags.hasDraft === true ? 1 : 0)
    const hasFinal = flags.hasFinal === undefined ? null : (flags.hasFinal === true ? 1 : 0)
    return this.tx(() => {
      const exists = this.get('SELECT number FROM chapter_meta WHERE number = ?', n)
      if (!exists) {
        const meta = flags.meta && typeof flags.meta === 'object' ? flags.meta : {}
        this.writeChapterMeta(n, {
          ...meta,
          chapterId: meta.chapterId ?? `c${n}`,
          number: n,
          title: meta.title ?? `第 ${n} 章`,
          status: meta.status ?? (hasDraft === 1 ? 'drafted' : 'planned'),
          wordCount: Number(meta.wordCount) || 0,
          updatedAt: meta.updatedAt ?? now(),
        })
        this.run('UPDATE chapter_meta SET has_draft = ?, has_final = ? WHERE number = ?', hasDraft ?? 0, hasFinal ?? 0, n)
      } else {
        this.run(
          'UPDATE chapter_meta SET has_draft = COALESCE(?, has_draft), has_final = COALESCE(?, has_final) WHERE number = ?',
          hasDraft,
          hasFinal,
          n,
        )
      }
      const row = this.get('SELECT has_draft, has_final FROM chapter_meta WHERE number = ?', n)
      return { number: n, hasDraft: Boolean(row?.has_draft), hasFinal: Boolean(row?.has_final) }
    })
  }

  /** 全部章节的正文存在性：Map<number, { hasDraft, hasFinal }>。 */
  listChapterProseFlags() {
    const flags = new Map()
    for (const row of this.all('SELECT number, has_draft, has_final FROM chapter_meta')) {
      flags.set(Number(row.number), {
        hasDraft: Boolean(row.has_draft),
        hasFinal: Boolean(row.has_final),
      })
    }
    return flags
  }

  readChapterQa(number) {
    const row = this.get('SELECT * FROM chapter_qa WHERE number = ?', Number(number))
    if (!row) return { qa: null, styleQa: null, continuity: null }
    return {
      qa: jsonGet(row.qa_json, null),
      styleQa: jsonGet(row.style_qa_json, null),
      continuity: jsonGet(row.continuity_json, null),
    }
  }

  writeChapterQa(number, value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const n = Number(number)
    this.run(
      `INSERT INTO chapter_qa (number, qa_json, style_qa_json, continuity_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(number) DO UPDATE SET qa_json = excluded.qa_json,
         style_qa_json = excluded.style_qa_json, continuity_json = excluded.continuity_json`,
      n,
      jsonSet(source.qa ?? null),
      jsonSet(source.styleQa ?? null),
      jsonSet(source.continuity ?? null),
    )
    return this.readChapterQa(n)
  }

  readChapterState(number) {
    const row = this.get('SELECT json FROM chapter_state WHERE number = ?', Number(number))
    return row ? jsonGet(row.json, null) : null
  }

  writeChapterState(number, value) {
    const source = value && typeof value === 'object' ? value : {}
    const n = Number(number)
    const timestamp = source.updatedAt ?? source.approvedAt ?? now()
    this.run(
      `INSERT INTO chapter_state (number, json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(number) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      n,
      jsonSet(source),
      timestamp,
    )
    this.writeStateMeta(timestamp)
    return this.readChapterState(n)
  }

  readChapterSummary(number) {
    const row = this.get('SELECT json FROM chapter_summary WHERE number = ?', Number(number))
    return row ? jsonGet(row.json, null) : null
  }

  writeChapterSummary(number, value) {
    const source = value && typeof value === 'object' ? value : {}
    const n = Number(number)
    this.run(
      `INSERT INTO chapter_summary (number, json, summary, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(number) DO UPDATE SET json = excluded.json, summary = excluded.summary, updated_at = excluded.updated_at`,
      n,
      jsonSet(source),
      bind(source.summary ?? null),
      source.generatedAt ?? source.updatedAt ?? now(),
    )
    return this.readChapterSummary(n)
  }

  listChapterStates() {
    return this.all('SELECT number, json FROM chapter_state ORDER BY number').map((row) => ({
      number: Number(row.number),
      ...jsonGet(row.json, {}),
    }))
  }

  listChapterSummaries() {
    return this.all('SELECT number, json FROM chapter_summary ORDER BY number').map((row) => ({
      number: Number(row.number),
      ...jsonGet(row.json, {}),
    }))
  }

  /** state/index.json 的等价物：汇总条目 + updatedAt。 */
  readStateIndex() {
    const meta = this.get('SELECT updated_at FROM state_meta WHERE id = 1')
    return {
      chapters: this.listChapterStates().map((state) => ({
        id: state.chapterId ?? state.id ?? '',
        number: Number(state.number),
        title: state.title ?? '',
        status: 'approved',
        wordCount: Number(state.meta?.wordCount ?? 0),
        summary: state.summary ?? '',
        approvedAt: state.approvedAt ?? state.meta?.approvedAt ?? null,
        finalPath: `story/chapters/${String(state.number).padStart(3, '0')}/final.md`,
      })),
      updatedAt: meta?.updated_at ?? null,
    }
  }

  writeStateMeta(updatedAt = now()) {
    this.run(
      `INSERT INTO state_meta (id, updated_at) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      updatedAt,
    )
    return updatedAt
  }

  /**
   * state/index.json 的等价写入：章节汇总由 chapter_state 重建，这里只落 updatedAt。
   * service 在 stateSnapshot 里会单独 writeChapterState 写明细。
   */
  writeStateIndex(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    this.writeStateMeta(source.updatedAt ?? now())
    return this.readStateIndex()
  }

  deleteChapterRows(number) {
    const n = Number(number)
    return this.tx(() => {
      this.run('DELETE FROM chapter_meta WHERE number = ?', n)
      this.run('DELETE FROM chapter_qa WHERE number = ?', n)
      this.run('DELETE FROM chapter_state WHERE number = ?', n)
      this.run('DELETE FROM chapter_summary WHERE number = ?', n)
      this.run('DELETE FROM fts_chapters WHERE number = ?', n)
      return { deleted: n }
    })
  }

  /** 删除某章的大纲行（按 number），供 deleteChapter 在写回大纲前清理，避免 UNIQUE(number) 冲突。 */
  deleteOutlineChapter(number) {
    const n = Number(number)
    return this.tx(() => {
      this.run('DELETE FROM outline_chapters WHERE number = ?', n)
      return { deleted: n }
    })
  }

  /**
   * 删除中间章后的章号重排：把 fromNumber 的章节行整体迁移到 toNumber。
   * 在一个事务里完成（四张章节表 + FTS 行的 number 列一起改），失败自动回滚。
   * 调用方（service.deleteChapter）负责先把正文目录/state 文件改名。
   */
  renameChapterRows(fromNumber, toNumber) {
    const from = Number(fromNumber)
    const to = Number(toNumber)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return { renamed: false }
    this.tx(() => {
      for (const table of ['chapter_meta', 'chapter_qa', 'chapter_state', 'chapter_summary']) {
        this.run(`DELETE FROM ${table} WHERE number = ?`, to)
      }
      this.run('DELETE FROM fts_chapters WHERE number = ?', to)
      for (const table of ['chapter_meta', 'chapter_qa', 'chapter_state', 'chapter_summary']) {
        this.run(`UPDATE ${table} SET number = ? WHERE number = ?`, to, from)
      }
      this.run('UPDATE fts_chapters SET number = ? WHERE number = ?', to, from)
      // 同时修正 meta/summary/state JSON 里的 number 字段（service 只移动文件，不再单独写 meta）。
      for (const table of ['chapter_meta', 'chapter_summary', 'chapter_state']) {
        const row = this.get(`SELECT json FROM ${table} WHERE number = ?`, to)
        if (!row?.json) continue
        try {
          const value = JSON.parse(row.json)
          value.number = to
          if (table === 'chapter_meta') this.writeChapterMeta(to, value)
          else if (table === 'chapter_summary') this.writeChapterSummary(to, value)
          else this.writeChapterState(to, value)
        } catch {
          // 坏 JSON 保持原样
        }
      }
    })
    return { renamed: true, from, to }
  }

  /* ------------------------------ 统计 ------------------------------ */

  readStats() {
    const meta = this.get('SELECT updated_at FROM stats_meta WHERE id = 1')
    const events = this.all(
      'SELECT date, number, words, action, time FROM stats_events ORDER BY id',
    ).map((row) => ({
      date: row.date ?? '',
      number: Number(row.number) || 0,
      words: Number(row.words) || 0,
      action: row.action ?? 'write',
      time: row.time ?? null,
    }))
    return { events, updatedAt: meta?.updated_at ?? null }
  }

  appendStatsEvent(event = {}) {
    const source = event && typeof event === 'object' ? event : {}
    this.run(
      'INSERT INTO stats_events (date, number, words, action, time) VALUES (?, ?, ?, ?, ?)',
      String(source.date ?? new Date().toLocaleDateString('sv-SE')),
      Number(source.number) || 0,
      Number(source.words) || 0,
      String(source.action ?? 'write'),
      bind(source.time ?? now()),
    )
    this.run(
      `INSERT INTO stats_meta (id, updated_at) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      now(),
    )
    return this.readStats()
  }

  /** 整体写统计（迁移用）。 */
  writeStats(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    return this.tx(() => {
      this.run('DELETE FROM stats_events')
      for (const event of Array.isArray(source.events) ? source.events : []) {
        if (!event || typeof event !== 'object') continue
        this.run(
          'INSERT INTO stats_events (date, number, words, action, time) VALUES (?, ?, ?, ?, ?)',
          String(event.date ?? ''),
          Number(event.number) || 0,
          Number(event.words) || 0,
          String(event.action ?? 'write'),
          bind(event.time ?? null),
        )
      }
      this.run(
        `INSERT INTO stats_meta (id, updated_at) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
        source.updatedAt ?? now(),
      )
      return this.readStats()
    })
  }

  /* ------------------------------ 运行记录 ------------------------------ */

  saveRun(run = {}) {
    const source = run && typeof run === 'object' ? run : {}
    const runId = String(source.runId ?? '')
    if (!runId) throw new Error('运行记录缺少 runId')
    this.run(
      `INSERT INTO runs (run_id, kind, task, number, json, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET kind = excluded.kind, task = excluded.task,
         number = excluded.number, json = excluded.json, created_at = excluded.created_at`,
      runId,
      bind(source.kind ?? null),
      bind(source.task ?? null),
      Number.isFinite(Number(source.number)) ? Number(source.number) : null,
      jsonSet(source),
      source.createdAt ?? now(),
    )
    return this.readRun(runId)
  }

  readRun(runId) {
    const row = this.get('SELECT json FROM runs WHERE run_id = ?', String(runId ?? ''))
    return row ? jsonGet(row.json, null) : null
  }

  listRuns(limit = 20) {
    const max = Math.max(1, Math.min(500, Number(limit) || 20))
    return this.all(
      'SELECT json FROM runs ORDER BY created_at DESC, run_id DESC LIMIT ?',
      max,
    ).map((row) => jsonGet(row.json, null)).filter(Boolean)
  }

  /** 只保留最近 keep 条运行记录，返回删除条数（与 service.clearRuns 对应）。 */
  pruneRuns(keep = 20) {
    const max = Math.max(1, Math.min(500, Number(keep) || 20))
    const total = Number(this.get('SELECT COUNT(*) AS total FROM runs')?.total ?? 0)
    if (total <= max) return { removed: 0, kept: total }
    this.run(
      `DELETE FROM runs WHERE run_id NOT IN (
         SELECT run_id FROM runs ORDER BY created_at DESC, run_id DESC LIMIT ?
       )`,
      max,
    )
    return { removed: total - max, kept: max }
  }

  /* ------------------------------ 提示词覆盖 ------------------------------ */

  readPromptOverrides() {
    const out = {}
    for (const row of this.all('SELECT * FROM prompt_overrides ORDER BY key')) {
      out[row.key] = {
        text: row.text ?? '',
        baseHash: row.base_hash ?? null,
        // 注意：SQL NULL 不能走 Number(null)=0，必须显式判空。
        baseRevision: row.base_revision === null || row.base_revision === undefined
          ? null
          : (Number.isFinite(Number(row.base_revision)) ? Number(row.base_revision) : null),
      }
    }
    return out
  }

  writePromptOverride(key, value) {
    const name = String(key ?? '')
    if (!name) throw new Error('提示词覆盖缺少 key')
    let text = ''
    let baseHash = null
    let baseRevision = null
    if (typeof value === 'string') {
      text = value
    } else if (value && typeof value === 'object') {
      text = typeof value.text === 'string' ? value.text : ''
      baseHash = value.baseHash ?? null
      baseRevision = value.baseRevision === null || value.baseRevision === undefined
        ? null
        : (Number.isFinite(Number(value.baseRevision)) ? Number(value.baseRevision) : null)
    }
    const clean = text.trim().slice(0, 20000)
    if (!clean) return this.deletePromptOverride(name)
    this.run(
      `INSERT INTO prompt_overrides (key, text, base_hash, base_revision, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET text = excluded.text, base_hash = excluded.base_hash,
         base_revision = excluded.base_revision, updated_at = excluded.updated_at`,
      name,
      clean,
      bind(baseHash),
      baseRevision,
      now(),
    )
    return this.readPromptOverrides()
  }

  deletePromptOverride(key) {
    this.run('DELETE FROM prompt_overrides WHERE key = ?', String(key ?? ''))
    return this.readPromptOverrides()
  }

  /* ------------------------------ 备注 ------------------------------ */

  listNotes(number) {
    const rows = Number.isFinite(Number(number))
      ? this.all('SELECT * FROM notes WHERE chapter = ? ORDER BY id', Number(number))
      : this.all('SELECT * FROM notes ORDER BY id')
    return {
      notes: rows.map((row) => {
        const parsed = jsonGet(row.text, null)
        if (parsed && typeof parsed === 'object') {
          return { ...parsed, createdAt: parsed.createdAt ?? row.created_at ?? null }
        }
        return { text: row.text ?? '', source: row.source ?? null, createdAt: row.created_at ?? null }
      }),
    }
  }

  appendNote(note = {}) {
    const source = note && typeof note === 'object' ? note : {}
    const chapter = Number.isFinite(Number(source.chapter)) ? Number(source.chapter) : null
    const payload = source.text && typeof source.text === 'object' ? source.text : { text: String(source.text ?? '') }
    const createdAt = source.createdAt ?? now()
    this.run(
      'INSERT INTO notes (chapter, text, source, created_at) VALUES (?, ?, ?, ?)',
      chapter,
      jsonSet(payload),
      bind(source.source ?? null),
      createdAt,
    )
    return { chapter, ...payload, source: source.source ?? null, createdAt }
  }

  /** 整体替换某章备注（对应旧 notes/chapter-N.json 的 { notes: [...] } 写入语义）。 */
  replaceNotes(number, notes = []) {
    const chapter = Number.isFinite(Number(number)) ? Number(number) : null
    return this.tx(() => {
      if (chapter === null) this.run('DELETE FROM notes WHERE chapter IS NULL')
      else this.run('DELETE FROM notes WHERE chapter = ?', chapter)
      for (const note of Array.isArray(notes) ? notes : []) {
        this.appendNote({ chapter, text: note, source: 'legacy' })
      }
      return this.listNotes(chapter)
    })
  }

  /* ------------------------------ 检索 ------------------------------ */

  /** 转成 FTS5 短语查询，避免用户输入被当成 MATCH 语法。 */
  ftsQuery(query) {
    return `"${String(query ?? '').replace(/"/g, '""')}"`
  }

  likeSnippet(text, query, radius = 20) {
    const source = String(text ?? '')
    const index = source.indexOf(query)
    if (index < 0) return source.slice(0, radius * 2)
    const start = Math.max(0, index - radius)
    const end = Math.min(source.length, index + query.length + radius)
    return `${start > 0 ? '…' : ''}${source.slice(start, index)}[[${source.slice(index, index + query.length)}]]${source.slice(index + query.length, end)}${end < source.length ? '…' : ''}`
  }

  /**
   * 跨表检索。≥3 字走 FTS5(trigram) + snippet/bm25；1–2 字回退 LIKE。
   * 返回 { results: [{ type, number?, entryId?, title, snippet, score }] }。
   */
  search(query, options = {}) {
    const q = String(query ?? '').trim()
    if (!q) return { results: [] }
    const max = Math.max(1, Math.min(200, Number(options.limit) || 20))
    const chars = [...q].length
    const results = []
    if (chars >= 3) {
      const match = this.ftsQuery(q)
      for (const row of this.all(
        `SELECT number, title, snippet(fts_chapters, 2, '[[', ']]', '…', 12) AS snippet, bm25(fts_chapters) AS score
         FROM fts_chapters WHERE fts_chapters MATCH ? ORDER BY score LIMIT ?`,
        match,
        max,
      )) {
        results.push({
          type: 'chapter',
          number: Number(row.number),
          title: row.title || `第 ${row.number} 章`,
          snippet: row.snippet ?? '',
          score: Number(row.score) || 0,
        })
      }
      for (const row of this.all(
        `SELECT number, title, snippet(fts_outline, 2, '[[', ']]', '…', 12) AS snippet, bm25(fts_outline) AS score
         FROM fts_outline WHERE fts_outline MATCH ? ORDER BY score LIMIT ?`,
        match,
        max,
      )) {
        results.push({
          type: 'outline',
          number: Number(row.number),
          title: row.title || `第 ${row.number} 章`,
          snippet: row.snippet ?? '',
          score: Number(row.score) || 0,
        })
      }
      for (const row of this.all(
        `SELECT entry_id, category, name, snippet(fts_bible, 3, '[[', ']]', '…', 12) AS snippet, bm25(fts_bible) AS score
         FROM fts_bible WHERE fts_bible MATCH ? ORDER BY score LIMIT ?`,
        match,
        max,
      )) {
        results.push({
          type: 'bible',
          entryId: row.entry_id,
          title: row.name || `${BIBLE_LABELS[row.category] ?? row.category ?? ''} · ${row.entry_id}`,
          snippet: row.snippet ?? '',
          score: Number(row.score) || 0,
        })
      }
      for (const row of this.all(
        `SELECT number, snippet(fts_summaries, 1, '[[', ']]', '…', 12) AS snippet, bm25(fts_summaries) AS score
         FROM fts_summaries WHERE fts_summaries MATCH ? ORDER BY score LIMIT ?`,
        match,
        max,
      )) {
        results.push({
          type: 'summary',
          number: Number(row.number),
          title: `第 ${row.number} 章摘要`,
          snippet: row.snippet ?? '',
          score: Number(row.score) || 0,
        })
      }
      results.sort((a, b) => a.score - b.score)
      return { results: results.slice(0, max) }
    }
    const like = `%${q}%`
    for (const row of this.all(
      'SELECT number, title, body FROM fts_chapters WHERE body LIKE ? OR title LIKE ? ORDER BY number LIMIT ?',
      like, like, max,
    )) {
      results.push({
        type: 'chapter',
        number: Number(row.number),
        title: row.title || `第 ${row.number} 章`,
        snippet: this.likeSnippet(row.body, q),
        score: 0,
      })
    }
    for (const row of this.all(
      'SELECT number, title, synopsis FROM fts_outline WHERE synopsis LIKE ? OR title LIKE ? ORDER BY number LIMIT ?',
      like, like, max,
    )) {
      results.push({
        type: 'outline',
        number: Number(row.number),
        title: row.title || `第 ${row.number} 章`,
        snippet: this.likeSnippet(row.synopsis, q),
        score: 0,
      })
    }
    for (const row of this.all(
      'SELECT entry_id, category, name, description FROM fts_bible WHERE description LIKE ? OR name LIKE ? LIMIT ?',
      like, like, max,
    )) {
      results.push({
        type: 'bible',
        entryId: row.entry_id,
        title: row.name || `${BIBLE_LABELS[row.category] ?? row.category ?? ''} · ${row.entry_id}`,
        snippet: this.likeSnippet(row.description, q),
        score: 0,
      })
    }
    for (const row of this.all(
      'SELECT number, summary, characters, events FROM fts_summaries WHERE summary LIKE ? OR characters LIKE ? OR events LIKE ? ORDER BY number LIMIT ?',
      like, like, like, max,
    )) {
      results.push({
        type: 'summary',
        number: Number(row.number),
        title: `第 ${row.number} 章摘要`,
        snippet: this.likeSnippet(row.summary, q),
        score: 0,
      })
    }
    return { results: results.slice(0, max) }
  }

  /* ------------------------------ 索引 ------------------------------ */

  reindexChapter(number, { title = '', body = '' } = {}) {
    const n = Number(number)
    this.run('DELETE FROM fts_chapters WHERE number = ?', n)
    this.run(
      'INSERT INTO fts_chapters (number, title, body) VALUES (?, ?, ?)',
      n,
      String(title ?? ''),
      String(body ?? ''),
    )
    return { number: n }
  }

  reindexOutline() {
    this.run('DELETE FROM fts_outline')
    const rows = this.all(
      `SELECT c.number, c.title, c.synopsis FROM outline_chapters c ORDER BY c.number`,
    )
    for (const row of rows) {
      this.run(
        'INSERT INTO fts_outline (number, title, synopsis) VALUES (?, ?, ?)',
        Number(row.number),
        String(row.title ?? ''),
        String(row.synopsis ?? ''),
      )
    }
    return { outline: rows.length }
  }

  reindexBible() {
    this.run('DELETE FROM fts_bible')
    const rows = this.all('SELECT id, category, name, description FROM bible_entries')
    for (const row of rows) {
      this.run(
        'INSERT INTO fts_bible (entry_id, category, name, description) VALUES (?, ?, ?, ?)',
        String(row.id ?? ''),
        String(row.category ?? ''),
        String(row.name ?? ''),
        String(row.description ?? ''),
      )
    }
    return { bible: rows.length }
  }

  reindexSummaries() {
    this.run('DELETE FROM fts_summaries')
    const rows = this.all('SELECT number, json FROM chapter_summary ORDER BY number')
    for (const row of rows) {
      const summary = jsonGet(row.json, {})
      this.run(
        'INSERT INTO fts_summaries (number, summary, characters, events) VALUES (?, ?, ?, ?)',
        Number(row.number),
        String(summary.summary ?? ''),
        Array.isArray(summary.characters) ? summary.characters.join(' ') : '',
        Array.isArray(summary.events) ? summary.events.join(' ') : '',
      )
    }
    return { summaries: rows.length }
  }

  /** 读章节正文（final 优先，其次 draft），只用于 FTS；正文本身仍留在 Markdown。 */
  async readChapterBody(number) {
    const pad = String(Number(number)).padStart(3, '0')
    for (const name of ['final.md', 'draft.md']) {
      try {
        return await readFile(join(this.projectRoot, 'story', 'chapters', pad, name), 'utf8')
      } catch {
        // 两种正文都可能不存在
      }
    }
    return ''
  }

  /** 重新建全部 FTS（读正文）。返回各表行数。 */
  async reindexAll() {
    this.reindexOutline()
    this.reindexBible()
    this.reindexSummaries()
    const chapters = this.all('SELECT number, title FROM outline_chapters ORDER BY number')
    for (const row of chapters) {
      const body = await this.readChapterBody(row.number)
      this.reindexChapter(row.number, { title: row.title ?? '', body })
    }
    return this.ftsRowCounts()
  }

  ftsRowCounts() {
    const count = (table) => Number(this.get(`SELECT COUNT(*) AS total FROM ${table}`)?.total ?? 0)
    return {
      chapters: count('fts_chapters'),
      outline: count('fts_outline'),
      bible: count('fts_bible'),
      summaries: count('fts_summaries'),
    }
  }

  /* ------------------------------ 素材库 ------------------------------ */

  materialFromRow(row) {
    return {
      id: row.id,
      title: row.title ?? '',
      kind: row.kind ?? '其他',
      content: row.content ?? '',
      tags: jsonGet(row.tags_json, []),
      source: row.source ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    }
  }

  listMaterials() {
    return this.all('SELECT * FROM materials ORDER BY updated_at DESC, created_at DESC').map((row) => this.materialFromRow(row))
  }

  readMaterial(id) {
    const row = this.get('SELECT * FROM materials WHERE id = ?', String(id ?? ''))
    return row ? this.materialFromRow(row) : null
  }

  saveMaterial(input = {}) {
    const content = String(input.content ?? '')
    if (!content.trim()) throw new Error('素材内容不能为空')
    const kind = MATERIAL_KINDS.includes(input.kind) ? input.kind : '其他'
    const tags = normalizeMaterialTags(input.tags)
    const requestedId = String(input.id ?? '').trim()
    const existing = requestedId ? this.readMaterial(requestedId) : null
    const id = existing?.id ?? (requestedId || `mat-${Date.now()}-${randomUUID().slice(0, 8)}`)
    const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
    const title = String(input.title ?? '').trim().slice(0, 120) || firstLine.slice(0, 120) || '未命名素材'
    const timestamp = now()
    const createdAt = existing?.createdAt ?? timestamp
    this.run(
      `INSERT INTO materials (id, title, kind, content, tags_json, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         kind = excluded.kind,
         content = excluded.content,
         tags_json = excluded.tags_json,
         source = excluded.source,
         updated_at = excluded.updated_at`,
      id,
      title,
      kind,
      content,
      jsonSet(tags),
      input.source == null ? null : String(input.source).slice(0, 200),
      createdAt,
      timestamp,
    )
    return this.readMaterial(id)
  }

  deleteMaterial(id) {
    const result = this.run('DELETE FROM materials WHERE id = ?', String(id ?? ''))
    return Number(result?.changes ?? 0) > 0
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  checkpoint() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  /** 数据库 schema 版本（PRAGMA user_version），与项目数据版本（project.schema_version）区分。 */
  schemaVersion() {
    try {
      return Number(this.db.prepare('PRAGMA user_version').get()?.user_version) || 0
    } catch {
      return 0
    }
  }

  close() {
    this.db.close()
  }
}
