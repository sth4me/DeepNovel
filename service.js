import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, watch } from 'node:fs'
import { mkdir, rename, unlink, writeFile, cp, rm, readdir, stat as fsStat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { CRAFT_CARDS } from './craft.js'
import { BUILTIN_REFERENCE_SKILLS } from './builtin-skills.js'
import {
  craftCardIdFromSkill,
  craftSkillBody,
  craftSkillName,
  deleteImportedSkill,
  allSkillRoots,
  builtinReferenceBody,
  builtinSkillDisabled,
  isBuiltinSkillName,
  importSkill as importSkillToProject,
  projectSkillRoots,
  scanImportedSkills,
} from './skills.js'


/** 规范化模型返回的 aiFlavor；结构不合法返回 null。 */
function normalizeAiFlavor(raw) {
  if (!raw || typeof raw !== 'object') return null
  const score = Number(raw.score)
  if (!Number.isFinite(score)) return null
  const level = raw.level === '轻' || raw.level === '中' || raw.level === '重'
    ? raw.level
    : (score >= 80 ? '轻' : score >= 60 ? '中' : '重')
  const markers = Array.isArray(raw.markers)
    ? raw.markers.slice(0, 20).map((marker) => ({
        type: ['禁用词', '句式', '结构', '节奏'].includes(marker?.type) ? marker.type : '句式',
        quote: String(marker?.quote ?? '').slice(0, 80),
        ...(marker?.word ? { word: String(marker.word).slice(0, 20) } : {}),
      })).filter((marker) => marker.quote)
    : []
  return { level, score: Math.max(0, Math.min(100, Math.round(score))), markers }
}

/** 启发式 AI 味估算（禁用词密度），用于审查兜底与 deslop 前后对比。 */
function estimateAiFlavor(text) {
  const source = String(text ?? '')
  const chars = countChars(source)
  let hits = 0
  for (const word of AI_BANNED_WORDS) hits += (source.match(new RegExp(word, 'g')) ?? []).length
  const density = chars > 0 ? (hits * 1000) / chars : 0
  const score = Math.max(0, Math.min(100, Math.round(100 - density * 12)))
  const level = score >= 80 ? '轻' : score >= 60 ? '中' : '重'
  const markers = AI_BANNED_WORDS
    .filter((word) => source.includes(word))
    .slice(0, 10)
    .map((word) => ({ type: '禁用词', word, quote: word }))
  return { level, score, markers, density: Math.round(density * 10) / 10 }
}
import { openDatabase } from './db.js'
import { migrateLegacyProject } from './migrate.js'
import { MATERIAL_KINDS, NovelStore } from './store.js'
import { AI_BANNED_WORDS } from './writing-rules.js'
import {
  BIBLE_SYSTEM_PROMPT,
  BIBLE_CHARACTERS_SYSTEM_PROMPT,
  BIBLE_WORLD_SYSTEM_PROMPT,
  CHAPTER_REVIEW_SYSTEM_PROMPT,
  CHAPTER_SYSTEM_PROMPT,
  CONTINUITY_SYSTEM_PROMPT,
  DECONSTRUCT_STRUCTURE_SYSTEM_PROMPT,
  DECONSTRUCT_CHARACTERS_SYSTEM_PROMPT,
  DECONSTRUCT_TECHNIQUE_SYSTEM_PROMPT,
  DESLOP_SYSTEM_PROMPT,
  INSPIRATION_SYSTEM_PROMPT,
  OUTLINE_AUDIT_SYSTEM_PROMPT,
  OUTLINE_REPAIR_SYSTEM_PROMPT,
  OUTLINE_SYSTEM_PROMPT,
  PREMISE_INTENT_SYSTEM_PROMPT,
  PREMISE_SYSTEM_PROMPT,
  PROMPT_CATALOG,
  REVERSE_OUTLINE_SYSTEM_PROMPT,
  REVISION_LEARN_SYSTEM_PROMPT,
  STYLE_AUDIT_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  VOLUME_PLAN_SYSTEM_PROMPT,
  buildBibleUserPrompt,
  buildBibleCharactersUserPrompt,
  buildBibleWorldUserPrompt,
  buildReverseOutlineUserPrompt,
  buildVolumePlanUserPrompt,
  buildChapterUserPrompt,
  formatCraftCards,
  buildOutlineUserPrompt,
  buildPremiseUserPrompt,
  findStyleTemplate,
  listStyleTemplates,
} from './templates.js'

const MARKER = 'story/project.json'
const LAYOUT_VERSION = 1
const SCHEMA_VERSION = 1

const BIBLE_CATEGORIES = ['characters', 'locations', 'rules', 'factions', 'items']
const BIBLE_PREFIX = { characters: 'C', locations: 'W', rules: 'R', factions: 'F', items: 'I' }
const POWER_FILE = 'story/power.json'
const DEFAULT_POWER_TIERS = [
  { id: 'mortal', name: '未入流', order: 0, description: '只有外功与气感，尚未形成稳定内息。' },
  { id: 'third', name: '三流', order: 1, description: '内息初成，可强筋壮骨，不能外放。' },
  { id: 'second', name: '二流', order: 2, description: '内息贯通经脉，可贯入兵刃，仍不能真气外放。' },
  { id: 'first', name: '一流', order: 3, description: '可真气外放、踏水断木，是江湖高手的分水岭。' },
  { id: 'peak', name: '绝顶', order: 4, description: '罡气护体、掌风裂石，一派宗师。' },
]
const BIBLE_LABELS = { characters: '角色', locations: '地点', rules: '规则', factions: '势力', items: '物品' }

const PROSE_TASKS = new Set(['draft', 'revise', 'fix'])
const MODEL_TASKS = ['premise', 'bible', 'outline', 'draft', 'revise', 'fix', 'audit', 'summary', 'continuity']
const progressContext = new AsyncLocalStorage()

export function runWithProgress(progress, fn) {
  return progressContext.run(progress, fn)
}

const PROJECT_PROMPT_PATH = 'story/prompt.json'
const DSH_HOME = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const GLOBAL_PROMPT_DIR = join(DSH_HOME, 'novel-writer')
const GLOBAL_PROMPT_PATH = join(GLOBAL_PROMPT_DIR, 'prompt-injection.json')
const LIBRARY_DIR = join(DSH_HOME, 'novel-writer', 'library')
const LIBRARY_CHARACTER_DIR = join(LIBRARY_DIR, 'characters')
const LIBRARY_CRAFT_DIR = join(LIBRARY_DIR, 'craft')
const PROMPT_STORE_VERSION = 2
const PROSE_PROMPT_TASKS = ['draft', 'revise', 'fix']

/*
 * 写作台自动刷新用的目录监听：Host 没有文件变更推送，而轮询逐章 stat 在长篇项目里
 * 成本偏高，所以用 fs.watch 维护一个单调递增的修订号，页面只比较「指纹 + 修订号」。
 * 监听建不起来（非本地盘、权限异常等）时由 projectSignature 退回 stat 指纹。
 */
/**
 * 解析 chapters 目录监听事件的文件名（Electron 的 fs.watch 使用）：
 * `001/draft.md` / `001\\final.md`（相对 story/chapters）→ { number: 1, file: 'draft' }。
 */
export function parseChapterWatchEventPath(filename) {
  const name = String(filename ?? '').replace(/\\/g, '/')
  const match = name.match(/(?:^|\/)(\d{1,6})\/(draft|final)\.md$/)
  if (!match) return null
  return { number: Number(match[1]), file: match[2] }
}

const SIGNATURE_WATCH_LIMIT = 8
const signatureWatches = new Map()

function closeSignatureWatch(hostDir) {
  const entry = signatureWatches.get(hostDir)
  if (!entry) return
  signatureWatches.delete(hostDir)
  try {
    entry.watcher?.close()
  } catch {
    // 监听已经失效时忽略
  }
}

function ensureSignatureWatch(hostDir) {
  const existing = signatureWatches.get(hostDir)
  if (existing) {
    // 重新插入，保持 LRU 顺序
    signatureWatches.delete(hostDir)
    signatureWatches.set(hostDir, existing)
    return existing
  }
  const entry = { revision: 0, watcher: null }
  try {
    entry.watcher = watch(hostDir, { recursive: true }, () => {
      entry.revision += 1
    })
    entry.watcher.on?.('error', () => closeSignatureWatch(hostDir))
  } catch {
    return null
  }
  signatureWatches.set(hostDir, entry)
  while (signatureWatches.size > SIGNATURE_WATCH_LIMIT) {
    closeSignatureWatch(signatureWatches.keys().next().value)
  }
  return entry
}

export function disposeSignatureWatches() {
  for (const hostDir of [...signatureWatches.keys()]) closeSignatureWatch(hostDir)
}

function defaultInjectionConfig() {
  return { enabled: false, position: 'suffix', tasks: [...PROSE_PROMPT_TASKS], text: '' }
}

/**
 * 归一化一条提示词注入配置：enabled / position(prefix|suffix) / tasks(空数组=全部任务) / text。
 * 供项目级与全局级共用。
 */
export function normalizeInjectionConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const position = source.position === 'prefix' ? 'prefix' : 'suffix'
  const tasks = Array.isArray(source.tasks)
    ? [...new Set(source.tasks.filter((task) => MODEL_TASKS.includes(task)))]
    : [...PROSE_PROMPT_TASKS]
  const text = typeof source.text === 'string' ? source.text.slice(0, 20000) : ''
  return { enabled: Boolean(source.enabled), position, tasks, text }
}

/** 该任务实际应注入的文本；未启用、空文本或任务不匹配时返回空串。 */
export function injectionTextFor(config, task) {
  if (!config?.enabled) return ''
  const text = typeof config.text === 'string' ? config.text.trim() : ''
  if (!text) return ''
  const tasks = Array.isArray(config.tasks) ? config.tasks : []
  if (tasks.length > 0 && !tasks.includes(task)) return ''
  return text
}

/** 把多条注入按位置拼到 system 上；调用顺序即拼接顺序（先全局、后项目）。 */
export function applyInjectionToSystem(system, injections, task) {
  const base = typeof system === 'string' ? system : ''
  if (!Array.isArray(injections) || injections.length === 0) return base
  let prefix = ''
  let suffix = ''
  for (const config of injections) {
    const text = injectionTextFor(config, task)
    if (!text) continue
    if (config.position === 'prefix') prefix = prefix ? `${prefix}\n\n${text}` : text
    else suffix = suffix ? `${suffix}\n\n${text}` : text
  }
  if (!prefix && !suffix) return base
  return [prefix, base, suffix].filter((part) => part.length > 0).join('\n\n')
}

const DIRS = [
  'story',
  'story/style',
  'story/style/samples',
  'story/bible',
  'story/bible/characters',
  'story/bible/locations',
  'story/plot',
  'story/chapters',
  'story/state',
  '.dsh-writing',
  '.dsh-writing/runs',
  '.dsh-writing/index',
]

function now() {
  return new Date().toISOString()
}

/** 草稿→定稿的简单 diff：长度差 + 段落级删除/新增片段（各最多 3 条、每条 ≤120 字）。 */
function diffChapterTexts(draft, final) {
  const draftText = String(draft ?? '')
  const finalText = String(final ?? '')
  const draftChars = countChars(draftText)
  const finalChars = countChars(finalText)
  const addedChars = Math.max(0, finalChars - draftChars)
  const removedChars = Math.max(0, draftChars - finalChars)
  const paragraphs = (text) => text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const draftParagraphs = paragraphs(draftText)
  const finalParagraphs = paragraphs(finalText)
  const finalSet = new Set(finalParagraphs)
  const draftSet = new Set(draftParagraphs)
  const removed = draftParagraphs.filter((part) => !finalSet.has(part)).slice(0, 3).map((part) => part.slice(0, 120))
  const added = finalParagraphs.filter((part) => !draftSet.has(part)).slice(0, 3).map((part) => part.slice(0, 120))
  return {
    addedChars,
    removedChars,
    removed,
    added,
    diffChars: addedChars + removedChars + (removed.length + added.length) * 20,
  }
}

/** 从提示词文本提取 `{{name}}` 或 `${name}` 占位符（去重、最多 20 个）。 */
function extractTemplateVariables(text) {
  const source = String(text ?? '')
  const found = []
  const seen = new Set()
  const regex = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\$\{\s*([A-Za-z0-9_.-]+)\s*\}/g
  for (const match of source.matchAll(regex)) {
    const name = match[1] ?? match[2]
    if (!name || seen.has(name)) continue
    seen.add(name)
    found.push(name)
    if (found.length >= 20) break
  }
  return found
}

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function countChars(text) {
  return String(text ?? '').replace(/\s+/g, '').length
}

/** 角色卡库条目归一化：字段收敛为固定结构，坏值不进入库。 */
function normalizeLibraryCharacter(raw, fallbackId = '') {
  const source = raw && typeof raw === 'object' ? raw : {}
  const origin = source.source && typeof source.source === 'object' ? source.source : {}
  return {
    id: String(source.id ?? fallbackId).slice(0, 120),
    name: String(source.name ?? '').slice(0, 120),
    role: String(source.role ?? '').slice(0, 120),
    description: String(source.description ?? '').slice(0, 4000),
    traits: Array.isArray(source.traits) ? source.traits.map(String).filter(Boolean).slice(0, 30) : [],
    goal: String(source.goal ?? '').slice(0, 1000),
    notes: String(source.notes ?? '').slice(0, 4000),
    source: {
      projectTitle: String(origin.projectTitle ?? '').slice(0, 200),
      projectRoot: String(origin.projectRoot ?? '').slice(0, 1000),
    },
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
  }
}

/** 角色卡文件绝对路径；只接受库目录内的安全文件名，拒绝路径穿越。 */
function libraryCharacterFile(id) {
  const value = String(id ?? '').trim()
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error('无效的角色卡 id')
  }
  return join(LIBRARY_CHARACTER_DIR, `${value}.json`)
}

/**
 * 提示词覆盖归一化：兼容 v1（{ [key]: string }）与 v2（{ version: 2, overrides }）。
 * 统一返回 { [key]: { text, baseHash, baseRevision } }。
 */
function normalizePromptOverrides(data) {
  const source = data && typeof data === 'object' ? data : {}
  const raw = source.overrides && typeof source.overrides === 'object' ? source.overrides : source
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'version' || key === 'overrides') continue
    let text = ''
    let baseHash = null
    let baseRevision = null
    if (typeof value === 'string') {
      text = value
    } else if (value && typeof value === 'object') {
      text = typeof value.text === 'string' ? value.text : ''
      baseHash = typeof value.baseHash === 'string' && value.baseHash ? value.baseHash : null
      baseRevision = value.baseRevision === null || value.baseRevision === undefined
        ? null
        : (Number.isFinite(Number(value.baseRevision)) ? Number(value.baseRevision) : null)
    }
    const clean = text.trim().slice(0, 20000)
    if (!clean) continue
    out[key] = { text: clean, baseHash, baseRevision }
  }
  return out
}

/** 技法卡片归一化：内置与用户卡片共用，body 保持原文。 */
function normalizeCraftCard(raw, fallbackId = '', source = 'user') {
  const card = raw && typeof raw === 'object' ? raw : {}
  const id = String(card.id ?? fallbackId).trim().slice(0, 80)
  return {
    id,
    title: String(card.title ?? '').trim().slice(0, 120) || id,
    summary: String(card.summary ?? '').trim().slice(0, 300),
    tags: Array.isArray(card.tags)
      ? card.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
      : [],
    tasks: Array.isArray(card.tasks)
      ? card.tasks.map(String).map((task) => task.trim()).filter(Boolean).slice(0, 10)
      : [],
    body: String(card.body ?? '').slice(0, 4000),
    source,
  }
}

const USER_CRAFT_ID = /^[a-z0-9-]{2,32}$/
const USER_CRAFT_TASKS = ['draft', 'revise', 'fix', 'outline', 'deslop']

/** 保存用户技法卡片到 DSH_HOME/novel-writer/library/craft/<id>.json。 */
async function saveUserCraftCard(input = {}) {
  const id = String(input.id ?? '').trim()
  if (!USER_CRAFT_ID.test(id)) throw new Error('技法卡片 id 需为 2–32 位小写字母、数字或连字符')
  const body = String(input.body ?? '').trim()
  if (body.length < 100 || body.length > 4000) throw new Error('技法卡片正文需 100–4000 字')
  const tasks = Array.isArray(input.tasks) ? input.tasks.map(String).map((task) => task.trim()).filter(Boolean) : []
  if (tasks.length === 0 || tasks.some((task) => !USER_CRAFT_TASKS.includes(task))) {
    throw new Error('tasks 只能包含：' + USER_CRAFT_TASKS.join('/'))
  }
  const card = {
    id,
    title: String(input.title ?? id).trim().slice(0, 80) || id,
    summary: String(input.summary ?? '').trim().slice(0, 200),
    tags: (Array.isArray(input.tags) ? input.tags : []).map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
    tasks,
    body,
    updatedAt: now(),
  }
  await mkdir(LIBRARY_CRAFT_DIR, { recursive: true })
  await writeFile(join(LIBRARY_CRAFT_DIR, `${id}.json`), JSON.stringify(card, null, 2), 'utf8')
  return { id, source: 'user' }
}

/** 删除用户技法卡片；若是内置 id 的覆盖，删除后自动恢复内置卡片。 */
async function deleteUserCraftCard(id) {
  const target = join(LIBRARY_CRAFT_DIR, `${String(id ?? '').trim()}.json`)
  if (!existsSync(target)) throw new Error(`用户技法卡片不存在：${id}`)
  await unlink(target)
  return { id, deleted: true }
}

/** 从 instruction 提取 2–4 字中文片段与英文词，用于与卡片标题/摘要/标签做重叠匹配。 */
function craftInstructionKeywords(instruction) {
  const source = String(instruction ?? '')
  const words = new Set()
  for (const match of source.matchAll(/[\u4e00-\u9fa5]{2,4}/g)) {
    const run = match[0]
    for (let start = 0; start < run.length; start += 1) {
      for (let length = 2; length <= 4 && start + length <= run.length; length += 1) {
        words.add(run.slice(start, start + length))
      }
    }
  }
  for (const match of source.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g)) words.add(match[0].toLowerCase())
  return [...words]
}

/** 确定性 hash（FNV-1a）：用于同分轮转，保证同一章每次挑选结果稳定、不同章尽量不同。 */
function craftSeedHash(text) {
  let hash = 2166136261
  for (const char of String(text)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 注入提示词前加一句契约优先说明（只影响注入文本，不改卡片本身）。 */
function withCraftContractNote(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return cards
  const [first, ...rest] = cards
  return [{ ...first, body: '（本卡只是参考；与文风契约冲突时，一律以文风契约为准。）\n' + first.body }, ...rest]
}

/** 读 DSH_HOME 下的用户技法卡片；坏文件跳过，同 id 由调用方覆盖内置。 */
async function loadUserCraftCards() {
  let entries = []
  try {
    entries = await readdir(LIBRARY_CRAFT_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const cards = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const raw = JSON.parse(await readFile(join(LIBRARY_CRAFT_DIR, entry.name), 'utf8'))
      const card = normalizeCraftCard(raw, entry.name.replace(/\.json$/, ''), 'user')
      if (!card.id || !card.body) continue
      cards.push(card)
    } catch {
      // 坏文件跳过，不影响其它卡片
    }
  }
  return cards
}

/* ------------------------------ 拆书流水线归一化 ------------------------------ */

function normalizeDeconstructUnits(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 40).map((item, index) => {
    const unit = item && typeof item === 'object' ? item : {}
    return {
      index: Number.isFinite(Number(unit.index)) ? Number(unit.index) : index + 1,
      span: String(unit.span ?? '').slice(0, 200),
      summary: String(unit.summary ?? '').slice(0, 400),
      function: String(unit.function ?? '').slice(0, 40),
    }
  })
}

function normalizeDeconstructCharacters(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 30).map((item) => {
    const character = item && typeof item === 'object' ? item : {}
    return {
      name: String(character.name ?? '').slice(0, 120),
      role: String(character.role ?? '').slice(0, 120),
      description: String(character.description ?? '').slice(0, 600),
      traits: Array.isArray(character.traits)
        ? character.traits.map(String).map((trait) => trait.trim()).filter(Boolean).slice(0, 10)
        : [],
      goal: String(character.goal ?? '').slice(0, 300),
    }
  }).filter((character) => character.name)
}

function normalizeDeconstructSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const list = (value) => (Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 40)
    : [])
  return {
    locations: list(source.locations),
    rules: list(source.rules),
    factions: list(source.factions),
    items: list(source.items),
  }
}

function normalizeDeconstructRelations(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 60).map((item) => {
    const relation = item && typeof item === 'object' ? item : {}
    return {
      from: String(relation.from ?? '').slice(0, 120),
      to: String(relation.to ?? '').slice(0, 120),
      type: String(relation.type ?? '').slice(0, 60),
      note: String(relation.note ?? '').slice(0, 400),
    }
  }).filter((relation) => relation.from && relation.to)
}

function normalizeDeconstructTechniques(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 8).map((item) => {
    const technique = item && typeof item === 'object' ? item : {}
    return {
      name: String(technique.name ?? '').slice(0, 120),
      how: String(technique.how ?? '').slice(0, 600),
      example: String(technique.example ?? '').slice(0, 120),
    }
  }).filter((technique) => technique.name)
}

const JSON_REPAIR_SYSTEM = [
  '你是 JSON 修复器。',
  '输入是模型生成的内容，本应是 JSON，但可能夹带解释、Markdown 围栏或语法错误。',
  '只输出修复后的合法 JSON。不要改变字段与内容，不要解释，不要输出代码围栏。',
].join('\n')

function extractJson(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('模型返回为空，无法解析 JSON')
  }
  let source = text.trim()
  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) source = fence[1].trim()
  try {
    return JSON.parse(source)
  } catch {
    // fall through to bracket scanning
  }
  const start = source.search(/[{\[]/)
  if (start < 0) throw new Error('模型返回中找不到 JSON 起始符')
  const opener = source[start]
  const closer = opener === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === opener) depth += 1
    else if (char === closer) {
      depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
  }
  if (end < 0) throw new Error('模型返回的 JSON 括号不完整')
  const candidate = source.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(candidate)
}

function isStaleWriteError(error) {
  const code = String(error?.code ?? '')
  const message = String(error?.message ?? '')
  return code.includes('STALE') || /stale/i.test(message)
}

function notImplemented(name) {
  const error = new Error(`NOT_IMPLEMENTED: ${name}（P0 仅定义接口，生成流程在下一步实现）`)
  error.code = 'NOVEL_WRITER_NOT_IMPLEMENTED'
  throw error
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const method = entry.stored ? 0 : 8
    const compressed = method === 0 ? data : deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(33, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const centralBuffer = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralBuffer, eocd])
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function computeForeshadowEdges(chapters = []) {
  const plantIndex = new Map()
  chapters.forEach((chapter, index) => {
    for (const text of chapter.foreshadow?.plant ?? []) plantIndex.set(`${chapter.number}|${text}`, index)
  })
  const edges = []
  chapters.forEach((chapter, index) => {
    for (const text of chapter.foreshadow?.payoff ?? []) {
      for (const [key, plantIdx] of plantIndex) {
        const [plantNumber, plantText] = key.split('|')
        if (Number(plantNumber) >= Number(chapter.number)) continue
        const probe = plantText.slice(0, Math.min(10, plantText.length))
        if (!probe || !text.includes(probe)) continue
        edges.push({ from: plantIdx, to: index })
        break
      }
    }
  })
  return edges
}

export class NovelWriterService {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = config
    this.marker = MARKER
    this.layoutVersion = LAYOUT_VERSION
    this.schemaVersion = SCHEMA_VERSION
    this.modelInfoCache = new Map()
    this.stores = new Map()
    this.chapterFileCache = new Map()
    // 外部改正文监听（轮询签名；测试可改小 poll 间隔）
    this.chapterWatches = new Map()
    this.chapterWatchDebounceMs = 800
    this.chapterWatchPollMs = 5000
    this.recentSelfWrites = new Map()
    // Electron 生产运行时用 fs.watch；其它环境（含测试）用轮询兜底。
    this.useNativeWatch = Boolean(process.versions?.electron)
    // 正文存在性扫描分支计数（测试断言 DB 命中时不做目录扫描）。
    this.proseScanCount = 0
    // 测试注入用：failHook(stage) 抛错可验证事务回滚
    this.failHook = null
  }

  shouldPause() {
    const progress = progressContext.getStore()
    try {
      return Boolean(progress?.shouldPause?.())
    } catch {
      return false
    }
  }

  reportStage(stage, detail) {
    const progress = progressContext.getStore()
    if (!progress?.onStage) return
    try {
      progress.onStage({ stage: String(stage), detail: detail ?? null, at: Date.now() })
    } catch {
      // progress reporting must never break generation
    }
  }

  /* ------------------------------ 基础能力 ------------------------------ */

  async cwd(agent) {
    if (typeof agent === 'string') return agent
    return this.ctx.workingDirectory.ensure(agent)
  }

  /* ------------------------------ SQLite store 接入 ------------------------------ */

  dbPathFor(cwd) {
    return join(cwd, 'story', 'project.db')
  }

  /** 相对路径 → 宿主路径；测试 stub 没有 processPath 时用 join 兜底。 */
  hostPathOf(target, fallbackCwd = '') {
    return this.ctx.fs.processPath?.(target) ?? join(target?.cwd ?? fallbackCwd, target?.relativePath ?? '')
  }

  /** 迁移用的 fs 适配器：优先用 ctx.fs，缺的方法用 node fs 兜底（测试 stub 常缺 listDir）。 */
  legacyFsFor(cwd) {
    const fs = this.ctx.fs
    const hostOf = (target) => this.hostPathOf(target, cwd)
    return {
      resolve: (relativePath, options) => (fs.resolve
        ? fs.resolve(relativePath, options)
        : Promise.resolve({ cwd: options?.cwd ?? cwd, relativePath })),
      stat: fs.stat
        ? (target) => fs.stat(target)
        : async (target) => {
            try {
              const info = await fsStat(hostOf(target))
              return { version: String(info.mtimeMs) }
            } catch {
              return null
            }
          },
      readText: fs.readText
        ? (target) => fs.readText(target)
        : async (target) => readFile(hostOf(target), 'utf8'),
      listDir: fs.listDir
        ? (target) => fs.listDir(target)
        : async (target) => {
            const entries = await readdir(hostOf(target), { withFileTypes: true })
            return entries.map((entry) => ({ type: entry.isDirectory() ? 'directory' : 'file', name: entry.name }))
          },
    }
  }

  /**
   * 取项目对应的 NovelStore（LRU 8）。
   * 首次打开：DB 不存在但有 legacy story/project.json 时自动迁移，再打开 DB。
   */
  async storeFor(agent) {
    const cwd = await this.cwd(agent)
    const cached = this.stores.get(cwd)
    if (cached) {
      this.stores.delete(cwd)
      this.stores.set(cwd, cached)
      this.ensureChapterWatch(cwd)
      return cached
    }
    const exists = async (relativePath) => {
      try {
        const target = await this.ctx.fs.resolve(relativePath, { cwd })
        return Boolean(await this.ctx.fs.stat(target))
      } catch {
        return false
      }
    }
    const dbExists = await exists('story/project.db')
    if (!dbExists) {
      const legacyExists = await exists(this.marker)
      if (!legacyExists) {
        const error = new Error('当前目录尚未初始化写作项目，请先调用 novel_init')
        error.code = 'NOVEL_WRITER_NOT_INITIALIZED'
        throw error
      }
      await migrateLegacyProject({
        projectRoot: cwd,
        fs: this.legacyFsFor(cwd),
        resolveHostPath: (relativePath) => join(cwd, relativePath),
      })
    }
    const db = openDatabase(this.dbPathFor(cwd))
    const store = new NovelStore(db, cwd)
    this.stores.set(cwd, store)
    while (this.stores.size > 8) {
      const oldestKey = this.stores.keys().next().value
      const oldest = this.stores.get(oldestKey)
      this.stores.delete(oldestKey)
      try {
        oldest.close()
      } catch {
        // 已关闭
      }
      this.closeChapterWatch(oldestKey)
    }
    this.ensureChapterWatch(cwd)
    // 懒回填正文存在性（旧库升级/首次打开只扫一次；迁移项目已带标记会跳过）
    try {
      const project = store.readProject()
      if (!project?.proseFlagsBackfilled) {
        const files = await this.scanChapterFilesFromDisk(cwd)
        this.proseScanCount += 1
        this.backfillProseFlags(store, files)
        store.writeProject({ ...(project ?? {}), proseFlagsBackfilled: true })
        this.chapterFileCache.set(cwd, { at: Date.now(), files })
      }
    } catch {
      // 回填失败不阻塞项目打开（下次访问再试）
    }
    return store
  }

  disposeStores() {
    for (const store of this.stores.values()) {
      try {
        store.close()
      } catch {
        // 已关闭
      }
    }
    this.stores.clear()
    this.chapterFileCache.clear()
    for (const cwd of [...this.chapterWatches.keys()]) this.closeChapterWatch(cwd)
    this.recentSelfWrites.clear()
  }

  /* ------------------------------ 外部正文改动监听 ------------------------------ */

  /**
   * 扫 story/chapters 下 draft/final 的 (mtime:size) 签名，用于检测外部直写文件。
   * 只读本地盘（一次递归 readdir + 并发 stat），不依赖 fs.watch。
   */
  async scanChapterFileSignatures(cwd) {
    const hostDir = join(cwd, 'story', 'chapters')
    const entries = await readdir(hostDir, { recursive: true, withFileTypes: true })
    const signatures = new Map()
    const files = entries.filter((entry) => entry.isFile() && (entry.name === 'draft.md' || entry.name === 'final.md'))
    for (let index = 0; index < files.length; index += 100) {
      await Promise.all(files.slice(index, index + 100).map(async (entry) => {
        const parent = String(entry.parentPath ?? entry.path ?? '')
        const parentName = parent.split(/[\\/]/).filter(Boolean).pop() ?? ''
        const number = Number(parentName)
        if (!Number.isFinite(number)) return
        try {
          const info = await fsStat(join(parent, entry.name))
          signatures.set(`${number}/${entry.name}`, `${info.mtimeMs}:${info.size}`)
        } catch {
          // 文件刚被删除时忽略
        }
      }))
    }
    return signatures
  }

  /**
   * 监听 story/chapters/<pad>/(draft|final).md 的外部写入（写作助手/编辑器直写文件）。
   * 实现说明：Windows 上 Node 的 fs.watch(recursive) 在 debug 构建会触发 libuv 断言，
   * 因此用轻量轮询（默认 5s 一次 mtime:size 签名对比）+ 可手动 flush，效果等价且更稳。
   * 检测到变化后批量 reindex + 修正 wordCount + 失效正文存在性缓存；disposeStores 时关闭。
   */
  ensureChapterWatch(cwd) {
    if (this.chapterWatches.has(cwd)) return this.chapterWatches.get(cwd)
    const entry = {
      watcher: null,
      pending: new Set(),
      timer: null,
      debounceTimer: null,
      known: new Map(),
      primed: false,
    }
    this.chapterWatches.set(cwd, entry)
    if (this.useNativeWatch) {
      // Electron 生产运行时 fs.watch 正常：直接监听 chapters 目录（递归），事件解析后走同一 flush。
      try {
        const hostDir = join(cwd, 'story', 'chapters')
        entry.watcher = watch(hostDir, { recursive: true }, (_eventType, filename) => {
          this.collectChapterWatchEvent(cwd, filename)
        })
        entry.watcher.on?.('error', () => {
          try {
            entry.watcher?.close()
          } catch {
            // 忽略
          }
          entry.watcher = null
          this.startChapterPolling(cwd)
        })
        this.flushChapterWatchByCwd(cwd).catch(() => {})
        return entry
      } catch {
        entry.watcher = null
      }
    }
    this.startChapterPolling(cwd)
    // 首次立即建立签名基线（不触发 reindex）
    this.flushChapterWatchByCwd(cwd).catch(() => {})
    return entry
  }

  /** 轮询兜底：定期比较 mtime:size 签名（非 Electron / watch 创建失败时使用）。 */
  startChapterPolling(cwd) {
    const entry = this.chapterWatches.get(cwd)
    if (!entry || entry.timer) return
    entry.timer = setInterval(() => {
      this.scheduleChapterFlush(cwd)
    }, this.chapterWatchPollMs)
    entry.timer.unref?.()
  }

  /** 原生监听事件入口（Electron）：解析 `NNN/(draft|final).md` 后并入 pending 并去抖。 */
  collectChapterWatchEvent(cwd, filename) {
    const parsed = parseChapterWatchEventPath(filename)
    if (!parsed) return null
    const entry = this.chapterWatches.get(cwd)
    if (!entry) return null
    entry.pending.add(parsed.number)
    this.scheduleChapterFlush(cwd)
    return parsed
  }

  /** 轮询发现可能变化后，按 800ms 去抖再批量处理（连续写入只重建一次）。 */
  scheduleChapterFlush(cwd) {
    const entry = this.chapterWatches.get(cwd)
    if (!entry || entry.debounceTimer) return
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null
      this.flushChapterWatchByCwd(cwd).catch(() => {})
    }, this.chapterWatchDebounceMs)
    entry.debounceTimer.unref?.()
  }

  closeChapterWatch(cwd) {
    const entry = this.chapterWatches.get(cwd)
    if (!entry) return
    this.chapterWatches.delete(cwd)
    if (entry.timer) clearInterval(entry.timer)
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    try {
      entry.watcher?.close()
    } catch {
      // 已失效
    }
  }

  /**
   * 删除/重命名章节目录时临时关闭监听：Windows 下 libuv 的 recursive fs.watch
   * 在监视树内目录被删除时会触发断言/误报，先暂停再操作，结束后恢复。
   */
  async withWatchSuspended(cwd, fn) {
    const had = this.chapterWatches.has(cwd)
    if (had) this.closeChapterWatch(cwd)
    try {
      return await fn()
    } finally {
      if (had) this.ensureChapterWatch(cwd)
    }
  }

  /** 立即处理当前待处理的外部改动（测试与退出前调用）。 */
  async flushChapterWatch(agent) {
    const cwd = await this.cwd(agent)
    return this.flushChapterWatchByCwd(cwd)
  }

  async flushChapterWatchByCwd(cwd) {
    const entry = this.chapterWatches.get(cwd)
    if (!entry) return { reindexed: [] }
    let signatures
    try {
      signatures = await this.scanChapterFileSignatures(cwd)
    } catch {
      return { reindexed: [] }
    }
    const changed = new Set()
    const changedKeys = new Set()
    if (!entry.primed) {
      entry.known = signatures
      entry.primed = true
      return { reindexed: [] }
    }
    for (const [key, signature] of signatures) {
      if (entry.known.get(key) === signature) continue
      changed.add(Number(key.split('/')[0]))
      changedKeys.add(key)
    }
    for (const key of entry.known.keys()) {
      if (signatures.has(key)) continue
      changed.add(Number(key.split('/')[0]))
      changedKeys.add(key)
    }
    entry.known = signatures
    for (const number of entry.pending) changed.add(number)
    entry.pending.clear()
    if (changed.size === 0) return { reindexed: [] }
    const numbers = [...changed].filter((number) => Number.isFinite(number))
    const reindexed = []
    try {
      const store = await this.storeFor(cwd)
      const outline = store.readOutline()
      const titles = new Map()
      for (const volume of outline?.volumes ?? []) {
        for (const chapter of volume.chapters ?? []) titles.set(Number(chapter.number), String(chapter.title ?? ''))
      }
      const selfWrites = this.recentSelfWrites.get(cwd) ?? new Map()
      const flagsByNumber = new Map()
      for (const key of signatures.keys()) {
        const [num, name] = key.split('/')
        const number = Number(num)
        if (!Number.isFinite(number)) continue
        const item = flagsByNumber.get(number) ?? { hasDraft: false, hasFinal: false }
        if (name === 'draft.md') item.hasDraft = true
        else if (name === 'final.md') item.hasFinal = true
        flagsByNumber.set(number, item)
      }
      for (const number of numbers) {
        const lastSelf = Number(selfWrites.get(number) ?? 0)
        if (Date.now() - lastSelf < 500) continue
        const paths = this.chapterPaths(number)
        let body = await this.readText(cwd, paths.final).catch(() => null)
        if (body === null) body = await this.readText(cwd, paths.draft).catch(() => null)
        if (body === null) body = ''
        store.setChapterProseFlags(number, flagsByNumber.get(number) ?? { hasDraft: false, hasFinal: false })
        store.reindexChapter(number, { title: titles.get(number) ?? '', body })
        const actual = countChars(body)
        const finalChanged = [...changedKeys].some((key) => key === `${number}/final.md`)
        const meta = store.readChapterMeta(number)
        if (!meta) {
          if (body) {
            store.writeChapterMeta(number, {
              chapterId: `c${number}`,
              number,
              title: titles.get(number) ?? '',
              status: 'manual',
              wordCount: actual,
              updatedAt: now(),
              ...(finalChanged ? { finalStale: true } : {}),
            })
          }
        } else {
          // 非自写的外部改动：标 manual；改的是 final 则标记定稿待复核。
          store.writeChapterMeta(number, {
            ...meta,
            status: 'manual',
            wordCount: actual,
            updatedAt: now(),
            ...(finalChanged ? { finalStale: true } : {}),
          })
        }
        this.chapterFileCache.delete(cwd)
        reindexed.push(number)
      }
      if (reindexed.length > 0) {
        await this.writeRun(cwd, {
          runId: `run-${Date.now()}-${randomUUID().slice(0, 8)}`,
          kind: 'chapter.external-edit',
          createdAt: now(),
          model: { provider: 'fs', model: 'watch' },
          system: null,
          messages: [],
          output: JSON.stringify({ numbers: reindexed }),
          usage: null,
          durationMs: 0,
          inputHash: null,
        })
      }
      if (reindexed.length >= 20) store.checkpoint()
    } catch {
      // 项目可能在 flush 期间被关闭/切换：静默降级
    }
    return { reindexed }
  }

  /** 识别需要改走 SQLite 的实体路径（其余文件路径继续走 fs）。 */
  dataPathKind(relativePath) {
    const path = String(relativePath ?? '').replace(/\\/g, '/')
    if (path === this.marker) return { type: 'project' }
    if (path === 'story/premise.json') return { type: 'premise' }
    if (path === 'story/style/contract.json') return { type: 'styleContract' }
    if (path === 'story/bible/index.json') return { type: 'bible' }
    if (path === 'story/bible/relations.json') return { type: 'relations' }
    if (path === POWER_FILE) return { type: 'power' }
    if (path === 'story/plot/outline.json') return { type: 'outline' }
    if (path === 'story/state/index.json') return { type: 'stateIndex' }
    if (path === 'story/stats.json') return { type: 'stats' }
    if (path === 'story/prompts/system.json') return { type: 'promptOverrides' }
    let match = path.match(/^story\/chapters\/(\d+)\/(meta|qa|style-qa|continuity|summary)\.json$/)
    if (match) return { type: 'chapterPart', number: Number(match[1]), part: match[2] }
    match = path.match(/^story\/state\/(\d+)\.json$/)
    if (match) return { type: 'chapterState', number: Number(match[1]) }
    match = path.match(/^\.dsh-writing\/runs\/([^/]+)\.json$/)
    if (match) return { type: 'run', runId: match[1] }
    match = path.match(/^\.dsh-writing\/notes\/chapter-(\d+)\.json$/)
    if (match) return { type: 'notes', number: Number(match[1]) }
    match = path.match(/^story\/style\/templates\/([^/]+)\.json$/)
    if (match) return { type: 'styleTemplate', id: match[1] }
    return null
  }

  storeRead(kind, store, agent) {
    switch (kind.type) {
      case 'project': return store.readProject()
      case 'premise': return store.readPremise()
      case 'styleContract': return store.readStyleContract()
      case 'bible': return store.readBible()
      case 'relations': return store.readRelations()
      case 'power': return store.readPower()
      case 'outline': return store.readOutline()
      case 'stateIndex': return store.readStateIndex()
      case 'stats': return store.readStats()
      case 'promptOverrides': return store.readPromptOverrides()
      case 'chapterPart': {
        if (kind.part === 'meta') return store.readChapterMeta(kind.number)
        if (kind.part === 'summary') return store.readChapterSummary(kind.number)
        const qa = store.readChapterQa(kind.number)
        if (kind.part === 'qa') return qa.qa
        if (kind.part === 'style-qa') return qa.styleQa
        return qa.continuity
      }
      case 'chapterState': return store.readChapterState(kind.number)
      case 'run': return store.readRun(kind.runId)
      case 'notes': return store.listNotes(kind.number)
      case 'styleTemplate': return store.listStyleTemplates().find((item) => item.id === kind.id) ?? null
      default: return null
    }
  }

  storeWrite(kind, store, value) {
    switch (kind.type) {
      case 'project':
        store.writeProject(value)
        break
      case 'premise':
        store.writePremise(value)
        break
      case 'styleContract':
        store.writeStyleContract(value)
        break
      case 'bible':
        store.writeBible(value)
        store.reindexBible()
        break
      case 'relations':
        store.writeRelations(value)
        break
      case 'power':
        store.writePower(value)
        break
      case 'outline':
        store.writeOutline(value)
        store.reindexOutline()
        break
      case 'stateIndex':
        store.writeStateIndex(value)
        break
      case 'stats':
        store.writeStats(value)
        break
      case 'promptOverrides': {
        const source = value && typeof value === 'object' ? value : {}
        const overrides = source.overrides && typeof source.overrides === 'object' ? source.overrides : source
        const existing = store.readPromptOverrides()
        for (const key of Object.keys(existing)) {
          if (!overrides[key]) store.deletePromptOverride(key)
        }
        for (const [key, item] of Object.entries(overrides)) {
          if (key === 'version' || key === 'overrides') continue
          store.writePromptOverride(key, item)
        }
        break
      }
      case 'chapterPart': {
        if (kind.part === 'meta') {
          store.writeChapterMeta(kind.number, value)
        } else if (kind.part === 'summary') {
          store.writeChapterSummary(kind.number, value)
          store.reindexSummaries()
        } else {
          const current = store.readChapterQa(kind.number)
          if (kind.part === 'qa') store.writeChapterQa(kind.number, { ...current, qa: value })
          else if (kind.part === 'style-qa') store.writeChapterQa(kind.number, { ...current, styleQa: value })
          else store.writeChapterQa(kind.number, { ...current, continuity: value })
        }
        break
      }
      case 'chapterState':
        store.writeChapterState(kind.number, value)
        break
      case 'run':
        store.saveRun(value)
        break
      case 'notes':
        store.replaceNotes(kind.number, value?.notes ?? [])
        break
      case 'styleTemplate':
        store.saveStyleTemplate(value)
        break
      default:
        break
    }
  }

  async policy(agent) {
    if (typeof agent === 'string') {
      return { mode: 'workspace-write', workspaceRoot: agent }
    }
    return this.ctx.sandboxPolicy.resolve({ session: agent.session })
  }

  async readJson(agent, relativePath) {
    const kind = this.dataPathKind(relativePath)
    if (kind) {
      try {
        const store = await this.storeFor(agent)
        return this.storeRead(kind, store, agent)
      } catch (error) {
        if (error?.code === 'NOVEL_WRITER_NOT_INITIALIZED') return null
        throw error
      }
    }
    return this.readJsonFile(agent, relativePath)
  }

  async readJsonFile(agent, relativePath) {
    const cwd = await this.cwd(agent)
    const hostPath = join(cwd, relativePath)
    // 本地盘优先直读（免 ctx.fs 沙箱往返，stateFor 里多个只读 JSON 收益明显）。
    try {
      return JSON.parse(await readFile(hostPath, 'utf8'))
    } catch {
      // 本地读不到：若项目目录本身在本地，则「文件不存在」直接返回 null，不再空跑 ctx.fs；
      // 只有「文件存在但读/解析失败」才回退 ctx.fs（兼容虚拟 fs / 沙箱读）。
    }
    let localProject = false
    try {
      localProject = Boolean(await fsStat(cwd))
    } catch {
      localProject = false
    }
    if (localProject) {
      try {
        await fsStat(hostPath)
      } catch {
        return null
      }
    }
    const target = await this.ctx.fs.resolve(relativePath, { cwd })
    const info = await this.ctx.fs.stat(target)
    if (!info) return null
    const text = await this.ctx.fs.readText(target)
    return JSON.parse(text)
  }

  async ensureDir(agent, relativeDir) {
    if (!relativeDir || relativeDir === '.') return
    const cwd = await this.cwd(agent)
    await mkdir(join(cwd, relativeDir), { recursive: true })
  }

  async writeJson(agent, relativePath, value) {
    const kind = this.dataPathKind(relativePath)
    if (kind) {
      try {
        const store = await this.storeFor(agent)
        this.storeWrite(kind, store, value)
      } catch (error) {
        if (error?.code !== 'NOVEL_WRITER_NOT_INITIALIZED') throw error
        // 未初始化时（初始化前写 marker 的极端路径）退回文件写。
        return this.writeJsonFile(agent, relativePath, value)
      }
      return { path: relativePath, operation: 'db', version: null }
    }
    return this.writeJsonFile(agent, relativePath, value)
  }

  async writeJsonFile(agent, relativePath, value) {
    if (typeof relativePath !== 'string') {
      throw new Error(`writeJson 收到非法路径：${String(relativePath)}\n${new Error().stack}`)
    }
    const cwd = await this.cwd(agent)
    const parent = dirname(relativePath)
    await this.ensureDir(agent, parent)
    const target = await this.ctx.fs.resolve(relativePath, { cwd })
    const content = `${JSON.stringify(value, null, 2)}\n`
    const policy = await this.policy(agent)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const info = await this.ctx.fs.stat(target)
        const expected = info
          ? { kind: 'replaceIfVersion', version: info.version }
          : { kind: 'createIfAbsent' }
        const outcome = await this.ctx.fs.writeText(target, content, expected, undefined, policy)
        return { path: relativePath, operation: outcome.operation, version: outcome.version }
      } catch (error) {
        if (attempt === 0 && isStaleWriteError(error)) continue
        throw new Error(`写入 ${relativePath} 失败：${errorText(error)}`)
      }
    }
    throw new Error(`写入 ${relativePath} 失败：未知写入错误`)
  }

  async readText(agent, relativePath) {
    const cwd = await this.cwd(agent)
    const hostPath = join(cwd, relativePath)
    // 本地盘优先直读，失败再按「本地是否存在」决定是否回退 ctx.fs。
    try {
      return await readFile(hostPath, 'utf8')
    } catch {
      // fall through
    }
    let localProject = false
    try {
      localProject = Boolean(await fsStat(cwd))
    } catch {
      localProject = false
    }
    if (localProject) {
      try {
        await fsStat(hostPath)
      } catch {
        return null
      }
    }
    const target = await this.ctx.fs.resolve(relativePath, { cwd })
    const info = await this.ctx.fs.stat(target)
    if (!info) return null
    return this.ctx.fs.readText(target)
  }

  async writeBinaryFile(agent, relativePath, buffer) {
    const cwd = await this.cwd(agent)
    await this.ensureDir(agent, dirname(relativePath))
    const target = await this.ctx.fs.resolve(relativePath, { cwd })
    const hostPath = this.ctx.fs.processPath?.(target) ?? target
    await writeFile(hostPath, buffer)
    return { path: relativePath }
  }

  async writeTextFile(agent, relativePath, content) {
    const cwd = await this.cwd(agent)
    await this.ensureDir(agent, dirname(relativePath))
    const target = await this.ctx.fs.resolve(relativePath, { cwd })
    const policy = await this.policy(agent)
    let result = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const info = await this.ctx.fs.stat(target)
        const expected = info
          ? { kind: 'replaceIfVersion', version: info.version }
          : { kind: 'createIfAbsent' }
        const outcome = await this.ctx.fs.writeText(target, content, expected, undefined, policy)
        result = { path: relativePath, operation: outcome.operation, version: outcome.version }
        break
      } catch (error) {
        if (attempt === 0 && isStaleWriteError(error)) continue
        throw new Error(`写入 ${relativePath} 失败：${errorText(error)}`)
      }
    }
    if (!result) throw new Error(`写入 ${relativePath} 失败：未知写入错误`)
    // 正文变化后同步更新 FTS（draft/final 才会命中），并让正文存在性缓存失效。
    const match = String(relativePath).replace(/\\/g, '/').match(/^story\/chapters\/(\d+)\/(draft|final)\.md$/)
    if (match) {
      try {
        const cwd = await this.cwd(agent)
        this.chapterFileCache.delete(cwd)
        // 记录「最近自写章节」，watcher 500ms 内跳过同章，避免与自身写入重复。
        let selfWrites = this.recentSelfWrites.get(cwd)
        if (!selfWrites) {
          selfWrites = new Map()
          this.recentSelfWrites.set(cwd, selfWrites)
        }
        selfWrites.set(Number(match[1]), Date.now())
        this.ensureChapterWatch(cwd)
        // 正文存在性入库（schema v2），之后 project-state 不再扫目录判断。
        const store = await this.storeFor(agent).catch(() => null)
        if (store) {
          store.setChapterProseFlags(Number(match[1]), match[2] === 'final' ? { hasFinal: true } : { hasDraft: true })
        }
      } catch {
        // 缓存失效失败不影响写入
      }
      await this.reindexChapterText(agent, Number(match[1]), String(content ?? ''))
    }
    return result
  }

  /** 写正文后更新 FTS；标题取大纲里的章节标题，失败不阻塞写作。 */
  async reindexChapterText(agent, number, body) {
    try {
      const store = await this.storeFor(agent)
      let title = ''
      const outline = store.readOutline()
      for (const volume of outline?.volumes ?? []) {
        const chapter = (volume.chapters ?? []).find((item) => Number(item.number) === Number(number))
        if (chapter) {
          title = chapter.title ?? ''
          break
        }
      }
      store.reindexChapter(number, { title, body })
    } catch {
      // 索引失败不影响正文写入
    }
  }

  /* --------------------------- 提示词注入（项目级 / 全局级） --------------------------- */

  /**
   * 全局级注入：跨项目共享，落在 DSH home 下。
   * 同步读取，供 novel-writer 预设的系统提示词段按步实时求值。
   */
  globalInjectionConfig() {
    try {
      return normalizeInjectionConfig(JSON.parse(readFileSync(GLOBAL_PROMPT_PATH, 'utf8')))
    } catch {
      return defaultInjectionConfig()
    }
  }

  /** 预设会话（novel-writer preset）要追加到系统提示词的文本；未启用时为空串。 */
  globalInjectionText() {
    const config = this.globalInjectionConfig()
    if (!config.enabled) return ''
    return String(config.text ?? '').trim()
  }

  async saveGlobalInjection(config) {
    const normalized = normalizeInjectionConfig(config)
    await mkdir(GLOBAL_PROMPT_DIR, { recursive: true })
    await writeFile(GLOBAL_PROMPT_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    return normalized
  }

  /** 项目级注入：随项目走，存在 story/prompt.json；未设置时返回默认（未启用）。 */
  async projectInjection(agent) {
    const value = await this.readJson(agent, PROJECT_PROMPT_PATH).catch(() => null)
    return value ? normalizeInjectionConfig(value) : defaultInjectionConfig()
  }

  async saveProjectInjection(agent, config) {
    await this.assertInitialized(agent)
    const normalized = normalizeInjectionConfig(config)
    await this.writeJson(agent, PROJECT_PROMPT_PATH, normalized)
    return normalized
  }

  async promptInjectionStatus(agent) {
    return {
      project: await this.projectInjection(agent).catch(() => defaultInjectionConfig()),
      global: this.globalInjectionConfig(),
      projectPath: PROJECT_PROMPT_PATH,
      globalPath: GLOBAL_PROMPT_PATH,
      globalPathDisplay: GLOBAL_PROMPT_PATH.startsWith(homedir())
        ? `~${GLOBAL_PROMPT_PATH.slice(homedir().length)}`
        : GLOBAL_PROMPT_PATH,
    }
  }

  /**
   * 计算一次模型调用的实际 system：全局注入在前、项目注入在后。
   * JSON 修复器不接受注入，避免破坏修复格式。
   */
  async injectedSystemFor(agent, system, task) {
    if (system === JSON_REPAIR_SYSTEM) return system
    const injections = []
    try {
      injections.push(this.globalInjectionConfig())
    } catch {
      // 全局配置不可读时忽略
    }
    try {
      injections.push(await this.projectInjection(agent))
    } catch {
      // 项目未初始化或读取失败时忽略
    }
    return applyInjectionToSystem(system, injections, task)
  }

  async isInitialized(agent) {
    const cwd = await this.cwd(agent)
    // 已打开的 store 一定来自已初始化项目（storeFor 只在 DB/legacy 就绪时缓存）：
    // 直接命中缓存，避免每个 service 调用都重复 stat DB 与 legacy 标记。
    if (this.stores.has(cwd)) return true
    const dbTarget = await this.ctx.fs.resolve('story/project.db', { cwd })
    if (await this.ctx.fs.stat(dbTarget)) {
      try {
        const store = await this.storeFor(agent)
        if (store.readProject()) return true
      } catch {
        // DB 打不开时退回 legacy 判断
      }
    }
    const target = await this.ctx.fs.resolve(this.marker, { cwd })
    return Boolean(await this.ctx.fs.stat(target))
  }

  async assertInitialized(agent) {
    if (!(await this.isInitialized(agent))) {
      const error = new Error('当前目录尚未初始化写作项目，请先调用 novel_init')
      error.code = 'NOVEL_WRITER_NOT_INITIALIZED'
      throw error
    }
  }

  hashInputs(parts) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  }

  defaultSelection() {
    const selection = this.ctx.agentDefaultModel.currentSelection() ?? {}
    const provider =
      typeof selection.provider === 'string'
        ? selection.provider
        : selection.provider?.provider ?? selection.provider?.id
    const model =
      typeof selection.model === 'string'
        ? selection.model
        : selection.model?.model ?? selection.model?.id
    if (!provider || !model) {
      throw new Error(`无法解析默认模型选择：${JSON.stringify(selection)}`)
    }
    return {
      provider,
      model,
      reasoningEffort: selection.reasoningEffort ?? undefined,
    }
  }

  taskModelConfig(project, task) {
    const entry = project?.models?.[task]
    if (!entry || typeof entry !== 'object') return null
    if (typeof entry.provider !== 'string' || typeof entry.model !== 'string') return null
    return {
      provider: entry.provider,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort ?? undefined,
    }
  }

  async modelInfoRaw(provider, model) {
    const key = `${provider}::${model}`
    if (this.modelInfoCache.has(key)) return this.modelInfoCache.get(key)
    const info = await this.ctx.llm.resolveModelInfo(provider, model).catch(() => null)
    this.modelInfoCache.set(key, info)
    return info
  }

  async modelCatalog() {
    const providers = this.ctx.llm.listProviders?.() ?? []
    const defaultSelection = this.defaultSelection()
    const models = {}
    for (const provider of providers.slice(0, 8)) {
      const list = await this.ctx.llm.listModels(provider.id).catch(() => [])
      models[provider.id] = await Promise.all(
        list.slice(0, 20).map(async (model) => {
          const info = await this.modelInfoRaw(provider.id, model.id)
          return { ...model, reasoning: info?.reasoning ?? null }
        }),
      )
    }
    return { providers, models, defaultSelection }
  }

  async modelInfo(provider, model) {
    const info = await this.modelInfoRaw(provider, model)
    return {
      provider,
      model,
      name: info?.name ?? model,
      reasoning: info?.reasoning ?? null,
      defaultMaxTokens: info?.defaultMaxTokens ?? null,
    }
  }

  async effectiveModels(agent) {
    const result = {}
    for (const task of MODEL_TASKS) {
      result[task] = await this.resolveModel(agent, task)
    }
    return result
  }

  async resolveModel(agent, task = 'default') {
    const selection = this.defaultSelection()
    const project = agent ? await this.readJson(agent, this.marker).catch(() => null) : null
    const configured = this.taskModelConfig(project, task)
    const provider = configured?.provider || selection.provider
    const model = configured?.model || selection.model
    if (!provider || !model) {
      throw new Error(`无法解析模型：${JSON.stringify({ provider, model })}`)
    }
    const info = await this.modelInfoRaw(provider, model)
    const effortIds = info?.reasoning?.efforts?.map((effort) => effort.id) ?? []
    const configuredEffort = configured?.reasoningEffort
    let reasoningEffort
    if (configuredEffort && configuredEffort !== 'auto') {
      reasoningEffort = configuredEffort
    } else if (PROSE_TASKS.has(task)) {
      reasoningEffort = effortIds.find((id) => id === 'off') ?? effortIds.find((id) => id === 'low') ?? undefined
    } else if (task === 'audit' || task === 'outline') {
      reasoningEffort = effortIds.find((id) => id === 'low') ?? effortIds.find((id) => id === 'off') ?? undefined
    } else if (!configured) {
      reasoningEffort = selection.reasoningEffort
      if (reasoningEffort && effortIds.length > 0 && !effortIds.includes(reasoningEffort)) {
        reasoningEffort = undefined
      }
    }
    return { provider, model, reasoningEffort }
  }

  async llmSessionId(agent) {
    const cwd = await this.cwd(agent).catch(() => '')
    const seed = String(cwd || 'novel-writer')
    return `novel-writer:${createHash('sha1').update(seed).digest('hex').slice(0, 20)}`
  }

  async callModel(agent, { task = 'default', system, messages, signal, maxTokens = 2000, temperature = 0.8, reasoningEffort, onDelta, number }) {
    const model = await this.resolveModel(agent, task)
    const effort = reasoningEffort ?? model.reasoningEffort
    const modelInfo = await this.modelInfoRaw(model.provider, model.model).catch(() => null)
    const budgetCap = Math.max(8000, Number(modelInfo?.defaultMaxTokens) || 64000)
    const effectiveSystem = await this.injectedSystemFor(agent, system, task)
    const sessionId = await this.llmSessionId(agent)
    const started = Date.now()
    const runOnce = async (budget, effort) => {
      let text = ''
      let reasoning = ''
      let usage = null
      let finish = null
      for await (const chunk of this.ctx.llm.stream({
        provider: model.provider,
        model: model.model,
        system: effectiveSystem,
        messages,
        maxTokens: Math.min(budget, budgetCap),
        temperature,
        ...(effort ? { reasoningEffort: effort } : {}),
        sessionId,
        signal,
      })) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
          if (onDelta) onDelta(chunk.text)
        }
        else if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') {
          finish = chunk.reason
          if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
            throw new Error(`模型调用失败：${JSON.stringify(chunk.reason)}`)
          }
        }
        else if (typeof chunk.type === 'string' && /reason|think/i.test(chunk.type)) {
          // 兼容各提供方的思考流（reasoning-delta / thinking-delta 等），只收集不展示。
          const piece = chunk.text ?? chunk.reasoning ?? chunk.delta ?? ''
          if (typeof piece === 'string') reasoning += piece
        }
      }
      return { text, usage, finish, reasoning }
    }
    let result = await runOnce(maxTokens, effort)
    if (!result.text.trim() && result.finish?.kind === 'max-tokens' && maxTokens < budgetCap) {
      // 截断只会发生在预算不足时：加倍预算重试，思考等级保持用户配置不变。
      result = await runOnce(Math.min(budgetCap, Math.max(maxTokens * 2, 6000)), effort)
    }
    if (result.text.trim().length === 0) {
      // 再按原参数重试一次，排除瞬时空响应；不擅自修改思考等级。
      result = await runOnce(maxTokens, effort)
    }
    if (result.text.trim().length === 0) {
      const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
      await this.writeRun(agent, {
        runId,
        kind: 'model.empty',
        number: Number(number) || null,
        createdAt: now(),
        model,
        system: effectiveSystem,
        messages,
        output: '',
        usage: result.usage,
        finish: result.finish,
        durationMs: Date.now() - started,
      }).catch(() => {})
      const finishKind = result.finish?.kind ?? 'unknown'
      const outputTokens = Number(result.usage?.outputTokens) || 0
      const reason = finishKind === 'max-tokens'
        ? '输出被截断（max-tokens）'
        : outputTokens > 0
          ? '模型只返回了思考内容，正文为空'
          : '模型返回空响应'
      const error = new Error(
        `模型未返回正文：${reason}（finish=${JSON.stringify(result.finish)} usage=${JSON.stringify(result.usage)} maxTokens=${maxTokens}）。已自动重试；仍失败时请更换模型，或把该任务的思考等级改为关闭。`,
      )
      error.code = 'NOVEL_WRITER_EMPTY_OUTPUT'
      error.runId = runId
      throw error
    }
    return {
      text: result.text,
      usage: result.usage,
      finish: result.finish,
      model,
      durationMs: Date.now() - started,
      system: effectiveSystem,
    }
  }

  async callJsonModel(agent, options) {
    const { kind, task = 'default', system, messages, signal, maxTokens = 3000, temperature = 0.8, inputHash, reasoningEffort, number, onDelta } = options
    const first = await this.callModel(agent, { task, system, messages, signal, maxTokens, temperature, reasoningEffort, number, onDelta })
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    let parsed = null
    let parseError = null
    let repair = null
    try {
      parsed = extractJson(first.text)
    } catch (error) {
      parseError = error
    }
    if (!parsed) {
      try {
        repair = await this.callModel(agent, {
          task,
          system: JSON_REPAIR_SYSTEM,
          messages: [{ role: 'user', content: [{ type: 'text', text: first.text }] }],
          signal,
          maxTokens: Math.min(12000, Math.max(6000, maxTokens)),
          temperature: 0,
        })
        parsed = extractJson(repair.text)
        parseError = null
      } catch (error) {
        parseError = error
      }
    }
    await this.writeRun(agent, {
      runId,
      kind,
      number: Number(number) || null,
      createdAt: now(),
      model: first.model,
      system: first.system ?? system,
      messages,
      output: first.text,
      reasoning: String(first.reasoning ?? '').slice(0, 30000),
      repairOutput: repair?.text ?? null,
      usage: first.usage,
      repairUsage: repair?.usage ?? null,
      durationMs: first.durationMs + (repair?.durationMs ?? 0),
      inputHash,
      parseError: parseError ? errorText(parseError) : null,
    })
    if (!parsed) {
      const error = new Error(
        `模型返回无法解析为 JSON；原始输出已保存到 run ${runId}，可在写作台查看并重试`,
      )
      error.code = 'NOVEL_WRITER_BAD_MODEL_OUTPUT'
      error.raw = first.text
      error.runId = runId
      throw error
    }
    return { parsed, runId, first, repair, usage: first.usage }
  }

  async writeRun(agent, run) {
    return this.writeJson(agent, `.dsh-writing/runs/${run.runId}.json`, run)
  }

  /* ------------------------------ P0：初始化与状态 ------------------------------ */

  async initProject(agent, options = {}) {
    const cwd = await this.cwd(agent)
    if (await this.isInitialized(agent)) {
      return { initialized: false, alreadyInitialized: true, cwd, project: await this.readJson(agent, this.marker) }
    }

    for (const dir of DIRS) {
      await mkdir(join(cwd, dir), { recursive: true })
    }

    const createdAt = now()
    const title = options.title?.trim() || basename(cwd)

    // 先建 SQLite 库并放进缓存：下面的 writeJson 会路由到 store，不再写 JSON 文件。
    const db = openDatabase(this.dbPathFor(cwd))
    const store = new NovelStore(db, cwd)
    this.stores.set(cwd, store)

    const files = [
      [
        this.marker,
        {
          schemaVersion: SCHEMA_VERSION,
          layoutVersion: LAYOUT_VERSION,
          proseFlagsBackfilled: true,
          title,
          language: options.language ?? 'zh',
          presetId: options.presetId ?? 'novel-writer',
          autoFix: false,
          models: {},
          context: {
            recentStateChapters: 1,
            maxTailChars: 1200,
            maxBibleCharacters: 12,
            maxRules: 6,
            maxForeshadow: 8,
            maxTimeline: 5,
            includeForeshadowing: true,
          },
          automation: {
            autoAudit: true,
            autoFix: false,
            autoRepairOutline: true,
            fixRounds: 2,
            stylePassScore: 60,
            batchCount: 3,
            targetWords: 0,
          },
          createdAt,
        },
      ],
      [
        'story/premise.json',
        { status: 'candidate', candidates: [], chosen: null, updatedAt: createdAt },
      ],
      [
        'story/style/contract.json',
        {
          status: 'candidate',
          templateId: null,
          fields: {
            pov: 'third-limited',
            tense: 'past',
            chapterWords: 3000,
            sentenceLength: 'mixed',
            paragraphLength: 'medium',
            dialogueRatio: 0.35,
            metaphorDensity: 'low',
            bannedWords: [],
            chapterTitleStyle: '',
            notes: '',
          },
          samples: [],
          updatedAt: createdAt,
        },
      ],
      [
        'story/plot/outline.json',
        { status: 'candidate', logline: null, volumes: [], updatedAt: createdAt },
      ],
      [
        'story/bible/index.json',
        { characters: [], locations: [], rules: [], factions: [], items: [], updatedAt: createdAt },
      ],
      [
        'story/power.json',
        {
          schemaVersion: 1,
          status: 'candidate',
          system: {
            name: '武道境界',
            summary: '境界从低到高：未入流、三流、二流、一流、绝顶；一流才可真气外放。',
            tiers: DEFAULT_POWER_TIERS,
          },
          characters: [],
          chapterChanges: {},
          updatedAt: createdAt,
        },
      ],
      ['story/state/index.json', { chapters: [], updatedAt: createdAt }],
    ]

    const written = []
    for (const [path, value] of files) {
      written.push(await this.writeJson(agent, path, value))
    }
    store.reindexOutline()
    store.reindexBible()
    store.reindexSummaries()

    return { initialized: true, cwd, title, written, next: 'premise' }
  }

  async uninitializeProject(agent) {
    const cwd = await this.cwd(agent)
    this.disposeStores()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRelative = `.deepnovel-backup/${stamp}`
    const backupAbsolute = join(cwd, backupRelative)
    await mkdir(backupAbsolute, { recursive: true })
    const moved = []
    for (const dir of ['story', '.dsh-writing']) {
      try {
        const target = await this.ctx.fs.resolve(dir, { cwd })
        const info = await this.ctx.fs.stat(target)
        if (!info) continue
        await rename(join(cwd, dir), join(backupAbsolute, dir))
        moved.push(dir)
      } catch {
        // directory is absent or already moved
      }
    }
    if (moved.length === 0) throw new Error('没有可解除的初始化数据')
    return { uninitialized: true, backupPath: backupRelative, moved }
  }

  async createProjectSnapshot(agent) {
    const cwd = await this.cwd(agent)
    // 快照会复制 story/（内含 project.db）：先 checkpoint 把 WAL 合并进主文件。
    try {
      const store = await this.storeFor(agent)
      store.checkpoint()
    } catch {
      // 快照允许在未初始化/无 store 时继续
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const name = stamp
    const root = join(cwd, '.deepnovel-snapshots', name)
    const story = join(cwd, 'story')
    await fsStat(story)
    await mkdir(root, { recursive: true })
    await cp(story, join(root, 'story'), { recursive: true })
    try {
      await fsStat(join(cwd, '.dsh-writing'))
      await cp(join(cwd, '.dsh-writing'), join(root, '.dsh-writing'), { recursive: true })
    } catch {
      // runtime data is optional
    }
    await writeFile(join(root, 'snapshot.json'), JSON.stringify({ name, createdAt: now() }, null, 2), 'utf8')
    return { name, createdAt: now(), path: `.deepnovel-snapshots/${name}` }
  }

  async listProjectSnapshots(agent) {
    const cwd = await this.cwd(agent)
    const root = join(cwd, '.deepnovel-snapshots')
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }
    const list = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      try {
        const storyStat = await fsStat(join(dir, 'story'))
        if (!storyStat.isDirectory()) continue
        const meta = JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8').catch(() => '{}'))
        list.push({
          name: entry.name,
          createdAt: meta.createdAt ?? storyStat.mtime.toISOString(),
          path: `.deepnovel-snapshots/${entry.name}`,
        })
      } catch {
        // skip incomplete snapshots
      }
    }
    return list.sort((a, b) => String(b.name).localeCompare(String(a.name)))
  }

  async restoreProjectSnapshot(agent, options = {}) {
    const cwd = await this.cwd(agent)
    const name = String(options.name ?? '')
    if (!name || name.includes('..') || /[\\/]/.test(name)) throw new Error('无效的快照名称')
    const snapshot = join(cwd, '.deepnovel-snapshots', name)
    await fsStat(join(snapshot, 'story'))
    // 恢复会替换 story/project.db：先 checkpoint，再关闭缓存连接，恢复后下次调用重新打开。
    try {
      const store = await this.storeFor(agent)
      store.checkpoint()
    } catch {
      // 无 store 时直接恢复
    }
    this.disposeStores()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(cwd, '.deepnovel-backup', `pre-restore-${stamp}`)
    await mkdir(backupRoot, { recursive: true })
    const moved = []
    for (const dir of ['story', '.dsh-writing']) {
      try {
        await fsStat(join(cwd, dir))
        await rename(join(cwd, dir), join(backupRoot, dir))
        moved.push(dir)
      } catch {
        // absent
      }
    }
    await cp(join(snapshot, 'story'), join(cwd, 'story'), { recursive: true })
    try {
      await fsStat(join(snapshot, '.dsh-writing'))
      await cp(join(snapshot, '.dsh-writing'), join(cwd, '.dsh-writing'), { recursive: true })
    } catch {
      // optional
    }
    return {
      restored: name,
      backupPath: `.deepnovel-backup/pre-restore-${stamp}`,
      moved,
    }
  }

  normalizeVolumeSummary(volume = {}) {
    return {
      id: String(volume.id ?? ''),
      title: String(volume.title ?? ''),
      goal: String(volume.goal ?? ''),
      map: String(volume.map ?? ''),
      powerCeiling: String(volume.powerCeiling ?? ''),
      exitCriteria: String(volume.exitCriteria ?? ''),
      chapterCount: Array.isArray(volume.chapters) ? volume.chapters.length : Number(volume.chapterCount) || 0,
    }
  }

  /**
   * 一次性读取写作台页面需要的批量数据：
   * DB 用聚合查询（chapter_meta/chapter_qa/chapter_summary 一次取全），
   * 文件只做「一次 listDir + 分块并发 listDir」判断正文存在性，
   * 供 projectStatus / chaptersSummary / buildHealthReport / buildCharacterIndex / storyOverview 复用。
   */
  async readProjectSnapshotData(agent) {
    await this.assertInitialized(agent)
    const store = await this.storeFor(agent)
    const parse = (text) => {
      if (text === null || text === undefined || text === '') return null
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    }
    const metas = new Map()
    for (const row of store.db.prepare('SELECT number, json FROM chapter_meta').all()) {
      metas.set(Number(row.number), parse(row.json))
    }
    const qaMap = new Map()
    for (const row of store.db.prepare('SELECT number, qa_json, style_qa_json, continuity_json FROM chapter_qa').all()) {
      qaMap.set(Number(row.number), {
        qa: parse(row.qa_json),
        styleQa: parse(row.style_qa_json),
        continuity: parse(row.continuity_json),
      })
    }
    const sums = new Map()
    for (const item of store.listChapterSummaries()) sums.set(Number(item.number), item)
    const cwd = await this.cwd(agent)
    const files = await this.scanChapterFiles(agent, cwd)
    return {
      project: store.readProject(),
      premise: store.readPremise(),
      style: store.readStyleContract(),
      bible: store.readBible(),
      power: store.readPower(),
      outline: store.readOutline(),
      stateIndex: store.readStateIndex(),
      relations: store.readRelations(),
      sums,
      metas,
      qaMap,
      files,
    }
  }

  /**
   * 扫描 story/chapters 下各章的 draft.md / final.md 存在性。
   * - 优先用一次 Node 原生递归 readdir（本地盘一次系统调用，零 ctx.fs 往返）；
   * - 结果按 cwd 缓存 5 秒，写正文/快照恢复/切项目时主动失效；
   * - 无 processPath 的虚拟 fs 回退到「顶层 listDir + 分块并发 listDir」。
   */
  /** 从磁盘扫描正文存在性（唯一需要目录 IO 的路径，仅回填/回填未完成时使用）。 */
  async scanChapterFilesFromDisk(cwd) {
    const files = new Map()
    let scanned = false
    try {
      const target = await this.ctx.fs.resolve('story/chapters', { cwd })
      const hostDir = this.ctx.fs.processPath?.(target) ?? join(target?.cwd ?? cwd, target?.relativePath ?? 'story/chapters')
      const top = await readdir(hostDir, { withFileTypes: true })
      for (const entry of top) {
        if (!entry.isDirectory()) continue
        const number = Number(entry.name)
        if (Number.isFinite(number)) files.set(number, { hasDraft: false, hasFinal: false })
      }
      const entries = await readdir(hostDir, { recursive: true, withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (entry.name !== 'draft.md' && entry.name !== 'final.md') continue
        const parent = String(entry.parentPath ?? entry.path ?? '')
        const parentName = parent.split(/[\\/]/).filter(Boolean).pop() ?? ''
        const number = Number(parentName)
        if (!Number.isFinite(number)) continue
        const item = files.get(number) ?? { hasDraft: false, hasFinal: false }
        if (entry.name === 'draft.md') item.hasDraft = true
        else item.hasFinal = true
        files.set(number, item)
      }
      scanned = true
    } catch {
      scanned = false
    }
    if (!scanned) {
      let entries = []
      try {
        entries = await this.ctx.fs.listDir(await this.ctx.fs.resolve('story/chapters', { cwd }))
      } catch {
        entries = []
      }
      const dirs = entries.filter((entry) => entry.type === 'directory' && Number.isFinite(Number(entry.name)))
      for (let index = 0; index < dirs.length; index += 50) {
        await Promise.all(dirs.slice(index, index + 50).map(async (entry) => {
          const number = Number(entry.name)
          try {
            const items = await this.ctx.fs.listDir(await this.ctx.fs.resolve(`story/chapters/${entry.name}`, { cwd }))
            const names = new Set(items.filter((item) => item.type === 'file').map((item) => item.name))
            files.set(number, { hasDraft: names.has('draft.md'), hasFinal: names.has('final.md') })
          } catch {
            files.set(number, { hasDraft: false, hasFinal: false })
          }
        }))
      }
    }
    return files
  }

  /** 把扫描结果写回 DB flags（只写有变化的章，并清掉已不存在的正文标记）。 */
  backfillProseFlags(store, files) {
    const existing = store.listChapterProseFlags()
    for (const [number, item] of files) {
      const previous = existing.get(number)
      if (!previous || previous.hasDraft !== item.hasDraft || previous.hasFinal !== item.hasFinal) {
        store.setChapterProseFlags(number, { hasDraft: item.hasDraft, hasFinal: item.hasFinal })
      }
    }
    for (const number of existing.keys()) {
      if (!files.has(number)) store.setChapterProseFlags(number, { hasDraft: false, hasFinal: false })
    }
  }

  /**
   * 正文存在性：优先读 DB flags（schema v2，零文件 IO）；只有回填未完成时才扫一次目录。
   * 回填完成后由 writeTextFile / 监听 flush / reindex 维护 flags。
   */
  async scanChapterFiles(agent, cwd) {
    const store = await this.storeFor(agent).catch(() => null)
    if (store) {
      try {
        const project = store.readProject()
        if (project?.proseFlagsBackfilled) {
          const flags = store.listChapterProseFlags()
          this.chapterFileCache.set(cwd, { at: Date.now(), files: flags })
          return flags
        }
        const files = await this.scanChapterFilesFromDisk(cwd)
        this.proseScanCount += 1
        this.backfillProseFlags(store, files)
        store.writeProject({ ...(project ?? {}), proseFlagsBackfilled: true })
        this.chapterFileCache.set(cwd, { at: Date.now(), files })
        return files
      } catch {
        // DB 不可用时退回磁盘扫描
      }
    }
    const cached = this.chapterFileCache.get(cwd)
    if (cached && Date.now() - cached.at < 5000) return cached.files
    const files = await this.scanChapterFilesFromDisk(cwd)
    this.proseScanCount += 1
    this.chapterFileCache.set(cwd, { at: Date.now(), files })
    return files
  }

  async projectStatus(agent, snapshot = null) {
    const cwd = await this.cwd(agent)
    const initialized = await this.isInitialized(agent)
    if (!initialized) {
      return {
        cwd,
        initialized: false,
        next: 'init',
        workflow: { next: 'init', blockers: ['尚未初始化写作项目'] },
      }
    }

    const project = snapshot ? snapshot.project : await this.readJson(agent, this.marker)
    const premise = snapshot ? snapshot.premise : await this.readJson(agent, 'story/premise.json')
    const style = snapshot ? snapshot.style : await this.readJson(agent, 'story/style/contract.json')
    const bible = snapshot ? snapshot.bible : await this.readBible(agent)
    const power = snapshot ? snapshot.power : await this.readPower(agent).catch(() => null)
    const outline = snapshot ? snapshot.outline : await this.readJson(agent, 'story/plot/outline.json')
    const state = snapshot ? snapshot.stateIndex : await this.readJson(agent, 'story/state/index.json')

    let chapters = 0
    if (snapshot) {
      chapters = snapshot.files.size
    } else {
      try {
        const target = await this.ctx.fs.resolve('story/chapters', { cwd })
        const entries = await this.ctx.fs.listDir(target)
        chapters = entries.filter((entry) => entry.type === 'directory').length
      } catch {
        chapters = 0
      }
    }

    const outlineChapters = (outline?.volumes ?? []).reduce(
      (sum, volume) => sum + (volume.chapters?.length ?? 0),
      0,
    )
    const confirmedOutlineChapters = (outline?.volumes ?? []).reduce(
      (sum, volume) =>
        sum + (volume.chapters ?? []).filter((chapter) => chapter.status === 'confirmed').length,
      0,
    )

    const premiseHash = premise?.chosenHash ?? null
    const styleHash = style?.fieldsHash ?? null
    const bibleHash = this.hashInputs(bible)
    const powerHash = this.hashInputs(power ?? {})
    const characterIndex = await this.buildCharacterIndex(agent, snapshot)
    const volumes = (outline?.volumes ?? []).map((volume) => this.normalizeVolumeSummary(volume))
    const stale = []
    for (const volume of outline?.volumes ?? []) {
      for (const chapter of volume.chapters ?? []) {
        const reasons = []
        if (chapter?.inputs?.premise && premiseHash && chapter.inputs.premise !== premiseHash) {
          reasons.push('premise')
        }
        if (chapter?.inputs?.style && styleHash && chapter.inputs.style !== styleHash) {
          reasons.push('style')
        }
        if (chapter?.inputs?.bible && bibleHash && chapter.inputs.bible !== bibleHash) {
          reasons.push('bible')
        }
        if (chapter?.inputs?.power && powerHash && chapter.inputs.power !== powerHash) {
          reasons.push('power')
        }
        if (reasons.length > 0) {
          stale.push({ kind: 'outline', id: chapter.id, reasons })
        }
      }
    }

    const premiseStatus = premise?.status ?? 'missing'
    const styleStatus = style?.status ?? 'missing'
    const bibleStatus = bible.status
    const blockers = []
    if (premiseStatus !== 'confirmed') blockers.push('构思未确认')
    if (styleStatus !== 'confirmed') blockers.push('文风未确认')
    if (bibleStatus !== 'confirmed') blockers.push('设定未确认')
    if (outlineChapters === 0) blockers.push('还没有章纲')
    else if (confirmedOutlineChapters < outlineChapters) blockers.push('章纲未全部确认')
    const next =
      premiseStatus !== 'confirmed'
        ? 'premise'
        : styleStatus !== 'confirmed'
          ? 'style'
          : bibleStatus !== 'confirmed'
            ? 'bible'
            : outlineChapters === 0
              ? 'outline'
              : confirmedOutlineChapters < outlineChapters
                ? 'outline'
                : 'draft'

    return {
      cwd,
      initialized: true,
      project,
      workflow: { next, blockers },
      stage: {
        premise: premiseStatus,
        style: styleStatus,
        bible: bibleStatus,
        outline: outline?.status ?? 'missing',
        chapters,
        outlineChapters,
        confirmedOutlineChapters,
        approvedChapters: state?.chapters?.length ?? 0,
        staleCount: stale.length,
      },
      volumes,
      characterIndex: characterIndex.slice(0, 24),
      bible: {
        status: bibleStatus,
        characters: bible.characters.length,
        locations: bible.locations.length,
        rules: bible.rules.length,
      },
      premise: {
        status: premiseStatus,
        candidateCount: premise?.candidates?.length ?? 0,
        chosenId: premise?.chosen?.id ?? null,
      },
      style: {
        status: styleStatus,
        templateId: style?.templateId ?? null,
      },
      outline: {
        status: outline?.status ?? 'missing',
        chapters: outlineChapters,
        confirmed: confirmedOutlineChapters,
        stale: stale.filter((item) => item.kind === 'outline').length,
      },
      stale,
    }
  }

  /**
   * 轻量指纹：只 stat 写作台关心的关键文件与目录，供 UI 判断项目是否被改动。
   * 不读文件内容，开销固定，可以安全地高频轮询。
   */
  async projectSignature(agent) {
    const cwd = await this.cwd(agent)
    const paths = [
      this.marker,
      'story/project.db',
      'story/project.db-wal',
      'story/premise.json',
      'story/style/contract.json',
      'story/bible/index.json',
      'story/plot/outline.json',
      'story/state/index.json',
      'story/chapters',
      'story/plot',
    ]
    const parts = []
    for (const relative of paths) {
      try {
        const target = await this.ctx.fs.resolve(relative, { cwd })
        const hostPath = this.ctx.fs.processPath?.(target) ?? target
        const info = await fsStat(hostPath)
        parts.push(`${relative}:${Math.trunc(info.mtimeMs)}:${info.size}`)
      } catch {
        parts.push(`${relative}:-`)
      }
    }
    /*
     * 优先用目录监听：story/ 下任何文件变动都会抬高修订号，长篇项目也不用逐章 stat。
     * 监听不可用（非本地盘、权限异常等）时退回逐章 stat 指纹。
     */
    let watchRevision = null
    try {
      const storyTarget = await this.ctx.fs.resolve('story', { cwd })
      const hostStory = this.ctx.fs.processPath?.(storyTarget) ?? null
      if (hostStory) {
        const entry = ensureSignatureWatch(hostStory)
        if (entry) watchRevision = entry.revision
      }
    } catch {
      watchRevision = null
    }
    if (watchRevision !== null) parts.push(`watch:${watchRevision}`)
    /*
     * 章节正文文件的内容修改不会改变所在目录的 mtime，所以逐章 stat draft/final，
     * 否则「只改正文内容」不会触发页面刷新。分块并发，章节多时也不至于堵住事件循环。
     */
    if (watchRevision === null) try {
      const chaptersTarget = await this.ctx.fs.resolve('story/chapters', { cwd })
      const entries = await this.ctx.fs.listDir(chaptersTarget)
      const dirs = entries
        .filter((entry) => entry.type === 'directory')
        .map((entry) => entry.name)
        .sort()
      parts.push(`chapters:${dirs.join(',')}`)
      const hostChapters = this.ctx.fs.processPath?.(chaptersTarget) ?? null
      const statChapterFile = async (name, file) => {
        try {
          const hostPath = hostChapters
            ? join(hostChapters, name, file)
            : this.ctx.fs.processPath?.(await this.ctx.fs.resolve(`story/chapters/${name}/${file}`, { cwd }))
          if (!hostPath) return `${name}/${file}:-`
          const info = await fsStat(hostPath)
          return `${name}/${file}:${Math.trunc(info.mtimeMs)}:${info.size}`
        } catch {
          return `${name}/${file}:-`
        }
      }
      const tasks = []
      for (const name of dirs) {
        for (const file of ['draft.md', 'final.md']) tasks.push(() => statChapterFile(name, file))
      }
      for (let index = 0; index < tasks.length; index += 32) {
        const chunk = tasks.slice(index, index + 32).map((task) => task())
        parts.push(...(await Promise.all(chunk)))
      }
    } catch {
      parts.push('chapters:-')
    }
    return {
      cwd,
      signature: createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16),
    }
  }

  /* ------------------------------ P0：构思 ------------------------------ */

  async premiseIntent(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const history = Array.isArray(options.history) ? options.history.slice(-12) : []
    const instruction = String(options.instruction ?? '').trim()
    if (!history.length && !instruction) return { intent: '' }
    const system = await this.systemFor(agent, 'premiseIntent', PREMISE_INTENT_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: [
          '对话历史：',
          ...history.map((message) => `${message.role === 'assistant' ? '助手' : '用户'}：${String(message.content ?? '').slice(0, 1500)}`),
          instruction ? `本轮输入：${instruction}` : '',
          '只输出 {"intent": "..."}。',
        ].filter(Boolean).join('\n'),
      }],
    }]
    const generated = await this.callJsonModel(agent, {
      kind: 'premise.intent',
      task: 'premise',
      system,
      messages,
      signal,
      maxTokens: 600,
      temperature: 0.2,
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    return { intent: String(parsed.intent ?? '').trim().slice(0, 800) }
  }

  async premiseCandidates(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const count = clamp(Number(options.count ?? 3) || 3, 1, 5)
    const project = await this.readJson(agent, this.marker)
    const premise = (await this.readJson(agent, 'story/premise.json')) ?? {
      status: 'candidate',
      candidates: [],
      chosen: null,
    }

    const system = await this.systemFor(agent, 'premise', PREMISE_SYSTEM_PROMPT)
    const userText = buildPremiseUserPrompt({
      title: project.title,
      language: project.language ?? 'zh',
      count,
      genre: options.genre,
      audience: options.audience,
      instruction: options.instruction,
      chosen: premise.chosen,
      reference: options.reference,
      intent: options.intent,
      history: Array.isArray(options.history) ? options.history : [],
    })
    const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }]

    this.reportStage('generating', '构思候选')
    const generated = await this.callJsonModel(agent, {
      kind: 'premise.candidates',
      task: 'premise',
      system,
      messages,
      signal,
      maxTokens: options.maxTokens ?? 256000,
      temperature: options.temperature ?? 0.9,
      onDelta: options.onDelta,
      inputHash: this.hashInputs({
        project: project.title,
        count,
        genre: options.genre,
        audience: options.audience,
        instruction: options.instruction,
        reference: options.reference,
        intent: options.intent,
        history: options.history,
      }),
    })

    const rawCandidates = Array.isArray(generated.parsed)
      ? generated.parsed
      : generated.parsed?.candidates
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
      const error = new Error('构思候选解析成功但未返回 candidates 数组')
      error.code = 'NOVEL_WRITER_BAD_MODEL_OUTPUT'
      error.raw = generated.first.text
      error.runId = generated.runId
      throw error
    }

    const candidates = rawCandidates.slice(0, count).map((candidate, index) => ({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `premise-${index + 1}`,
      title: String(candidate.title ?? ''),
      premise: String(candidate.premise ?? ''),
      genre: Array.isArray(candidate.genre) ? candidate.genre.map(String) : [],
      protagonist: String(candidate.protagonist ?? ''),
      length: {
        chapters: Number(candidate.length?.chapters ?? 0) || 0,
        wordsPerChapter: Number(candidate.length?.wordsPerChapter ?? 0) || 0,
      },
    }))

    const runId = generated.runId
    const updatedAt = now()
    const next = {
      status: 'candidate',
      candidates,
      chosen: premise.chosen ?? null,
      updatedAt,
      lastRunId: runId,
    }
    await this.writeJson(agent, 'story/premise.json', next)

    return {
      runId,
      candidates,
      usage: generated.usage,
      durationMs: generated.first.durationMs,
    }
  }

  normalizePremiseChat(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {}
    const messages = Array.isArray(source.messages)
      ? source.messages
          .filter((message) => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'system'))
          .slice(-200)
          .map((message, index) => ({
            id: String(message.id ?? `msg-${index + 1}`),
            role: message.role,
            content: String(message.content ?? '').slice(0, 4000),
            createdAt: message.createdAt ?? null,
            batchId: message.batchId ?? null,
            actions: Array.isArray(message.actions) ? message.actions.slice(0, 8) : [],
          }))
      : []
    const batches = Array.isArray(source.batches)
      ? source.batches
          .filter((batch) => batch && typeof batch === 'object')
          .slice(-30)
          .map((batch, index) => ({
            id: String(batch.id ?? `batch-${index + 1}`),
            createdAt: batch.createdAt ?? null,
            mode: ['candidates', 'sparks', 'discuss'].includes(batch.mode) ? batch.mode : 'candidates',
            instruction: String(batch.instruction ?? '').slice(0, 4000),
            candidates: Array.isArray(batch.candidates) ? batch.candidates.slice(0, 6) : [],
            ideas: Array.isArray(batch.ideas) ? batch.ideas.slice(0, 6) : [],
          }))
      : []
    return {
      version: 1,
      messages,
      batches,
      brief: String(source.brief ?? '').slice(0, 2000),
      activeBatchId: source.activeBatchId ?? null,
      updatedAt: source.updatedAt ?? null,
    }
  }

  async readPremiseChat(agent) {
    const raw = await this.readJson(agent, 'story/plot/premise-chat.json').catch(() => null)
    return this.normalizePremiseChat(raw ?? {})
  }

  async savePremiseChat(agent, options = {}) {
    const data = this.normalizePremiseChat({
      ...(await this.readPremiseChat(agent)),
      ...options,
    })
    data.updatedAt = now()
    await this.writeJson(agent, 'story/plot/premise-chat.json', data)
    return data
  }

  async restorePremiseBatch(agent, options = {}) {
    const batchId = String(options.batchId ?? '')
    const chat = await this.readPremiseChat(agent)
    const batch = chat.batches.find((item) => item.id === batchId)
    if (!batch || batch.mode !== 'candidates' || batch.candidates.length === 0) {
      throw new Error('找不到可恢复的候选批次')
    }
    const premise = await this.readJson(agent, 'story/premise.json')
    const next = {
      ...premise,
      status: 'candidate',
      candidates: batch.candidates,
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/premise.json', next)
    await this.savePremiseChat(agent, { activeBatchId: batchId })
    return { batchId, candidates: batch.candidates }
  }

  async commitPremise(agent, options = {}) {
    await this.assertInitialized(agent)
    const premise = await this.readJson(agent, 'story/premise.json')
    if (!premise || !Array.isArray(premise.candidates) || premise.candidates.length === 0) {
      throw new Error('还没有构思候选，请先调用 novel_premise action=candidates')
    }
    const candidateId = options.candidateId ?? premise.candidates[0].id
    const candidate = premise.candidates.find((item) => item.id === candidateId)
    if (!candidate) {
      throw new Error(`找不到候选 ${candidateId}；可用：${premise.candidates.map((item) => item.id).join(', ')}`)
    }
    const chosen = { ...candidate, ...(options.overrides ?? {}) }
    const next = {
      ...premise,
      status: 'confirmed',
      chosen,
      chosenHash: this.hashInputs(chosen),
      confirmedAt: now(),
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/premise.json', next)
    return { status: next.status, chosen, chosenHash: next.chosenHash }
  }

  async updatePremise(agent, fields = {}) {
    await this.assertInitialized(agent)
    const premise = await this.readJson(agent, 'story/premise.json')
    if (!premise?.chosen) throw new Error('还没有已确认的构思可供修改')
    const chosen = {
      id: premise.chosen.id,
      title: premise.chosen.title ?? '',
      premise: premise.chosen.premise ?? '',
      genre: Array.isArray(premise.chosen.genre) ? premise.chosen.genre : [],
      protagonist: premise.chosen.protagonist ?? '',
      length: {
        chapters: Number(premise.chosen.length?.chapters ?? 0) || 0,
        wordsPerChapter: Number(premise.chosen.length?.wordsPerChapter ?? 0) || 0,
      },
    }
    for (const key of ['title', 'premise', 'protagonist']) {
      if (fields[key] !== undefined) chosen[key] = String(fields[key])
    }
    if (fields.genre !== undefined) {
      chosen.genre = Array.isArray(fields.genre) ? fields.genre.map(String) : chosen.genre
    }
    if (fields.length !== undefined) {
      chosen.length = {
        chapters: Number(fields.length?.chapters ?? chosen.length?.chapters ?? 0) || 0,
        wordsPerChapter: Number(fields.length?.wordsPerChapter ?? chosen.length?.wordsPerChapter ?? 0) || 0,
      }
    }
    const next = {
      ...premise,
      status: 'confirmed',
      chosen,
      chosenHash: this.hashInputs(chosen),
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/premise.json', next)
    return { chosen, chosenHash: next.chosenHash }
  }

  /* ------------------------------ P0：文风 ------------------------------ */

  styleTemplates() {
    return { templates: listStyleTemplates() }
  }

  async userStyleTemplates(agent) {
    try {
      const store = await this.storeFor(agent)
      return store.listStyleTemplates().map((item) => ({ ...item, builtin: false }))
    } catch {
      return []
    }
  }

  async styleTemplateList(agent) {
    return { templates: [...listStyleTemplates(), ...(await this.userStyleTemplates(agent))] }
  }

  async saveStyleTemplate(agent, options = {}) {
    await this.assertInitialized(agent)
    const contract = await this.readJson(agent, 'story/style/contract.json')
    const fields = options.fields ?? contract?.fields
    if (!fields) throw new Error('还没有可保存的文风字段')
    const samples = Array.isArray(options.samples)
      ? options.samples.map((item) => String(item)).filter(Boolean).slice(0, 3)
      : (Array.isArray(contract?.samples) ? contract.samples : [])
    const id = `user-${Date.now().toString(36)}`
    const template = {
      id,
      name: String(options.name ?? '').trim() || '自定义模板',
      fields,
      samples,
      createdAt: now(),
    }
    await this.writeJson(agent, `story/style/templates/${id}.json`, template)
    return template
  }

  async exportStyleTemplate(agent, options = {}) {
    const id = String(options.id ?? '')
    const builtin = findStyleTemplate(id)
    const custom = builtin ? null : (await this.userStyleTemplates(agent)).find((item) => item.id === id)
    const template = builtin ?? custom
    if (!template) throw new Error(`未知文风模板 ${id}`)
    return { template, json: JSON.stringify(template, null, 2) }
  }

  async importStyleTemplate(agent, options = {}) {
    await this.assertInitialized(agent)
    const template = options.template && typeof options.template === 'object' ? options.template : null
    if (!template || !template.fields || typeof template.fields !== 'object') {
      throw new Error('模板内容为空或缺少 fields')
    }
    const id = `user-${Date.now().toString(36)}`
    const saved = {
      id,
      name: String(template.name ?? '').trim() || '导入模板',
      fields: template.fields,
      samples: Array.isArray(template.samples) ? template.samples.slice(0, 3) : [],
      createdAt: now(),
    }
    await this.writeJson(agent, `story/style/templates/${id}.json`, saved)
    return saved
  }

  async deleteStyleTemplate(agent, options = {}) {
    await this.assertInitialized(agent)
    const id = String(options.id ?? '')
    if (!/^user-[A-Za-z0-9-]+$/.test(id)) throw new Error('只能删除自定义模板')
    const store = await this.storeFor(agent)
    if (!store.listStyleTemplates().some((item) => item.id === id)) {
      throw new Error(`未知文风模板 ${id}`)
    }
    store.deleteStyleTemplate(id)
    return { deleted: id }
  }

  async applyStyleTemplate(agent, options = {}) {
    await this.assertInitialized(agent)
    const premise = await this.readJson(agent, 'story/premise.json')
    if (premise?.status !== 'confirmed' || !premise?.chosen) {
      throw new Error('固定流程要求先确认构思：请先在「构思」里生成并确认一个候选，再设置文风')
    }
    const builtin = findStyleTemplate(options.templateId)
    const custom = builtin ? null : (await this.userStyleTemplates(agent)).find((item) => item.id === options.templateId)
    const template = builtin ?? custom
    if (!template) {
      throw new Error(
        `未知文风模板 ${options.templateId}；可用：${[...listStyleTemplates(), ...(await this.userStyleTemplates(agent))].map((item) => item.id).join(', ')}`,
      )
    }
    const contract = {
      status: 'candidate',
      templateId: template.id,
      fields: { ...template.fields, ...(options.fields ?? {}) },
      samples: Array.isArray(template.samples) ? template.samples : [],
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/style/contract.json', contract)
    return contract
  }

  async saveStyleSamples(agent, samples = []) {
    await this.assertInitialized(agent)
    const contract = await this.readJson(agent, 'story/style/contract.json')
    if (!contract) throw new Error('还没有文风契约')
    const next = {
      ...contract,
      samples: Array.isArray(samples)
        ? samples.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
        : [],
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/style/contract.json', next)
    return next
  }

  async updateStyleFields(agent, fields = {}) {
    await this.assertInitialized(agent)
    const contract = await this.readJson(agent, 'story/style/contract.json')
    if (!contract) throw new Error('还没有文风契约')
    const allowed = [
      'pov', 'tense', 'chapterWords', 'sentenceLength', 'paragraphLength', 'dialogueRatio', 'metaphorDensity',
      'bannedWords', 'chapterTitleStyle', 'notes',
      'voice', 'diction', 'imagery', 'sensoryFocus', 'dialogueStyle', 'pacing',
      'must', 'never', 'adjust', 'bannedPatterns', 'genreFit', 'avoidGenre',
    ]
    const nextFields = { ...(contract.fields ?? {}) }
    for (const key of allowed) {
      if (fields[key] !== undefined) nextFields[key] = fields[key]
    }
    const next = {
      ...contract,
      status: contract.status === 'confirmed' ? 'confirmed' : 'candidate',
      fields: nextFields,
      fieldsHash: this.hashInputs(nextFields),
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/style/contract.json', next)
    return { status: next.status, fields: nextFields, fieldsHash: next.fieldsHash }
  }

  async updatePremiseCandidate(agent, options = {}) {
    await this.assertInitialized(agent)
    const premise = await this.readJson(agent, 'story/premise.json')
    if (!premise) throw new Error('还没有构思数据')
    const candidateId = String(options.candidateId ?? '')
    const fields = options.fields ?? {}
    const allowed = ['title', 'premise', 'protagonist', 'genre']
    const applyFields = (target) => {
      for (const key of allowed) {
        if (fields[key] === undefined) continue
        target[key] = Array.isArray(fields[key]) ? fields[key].map(String) : String(fields[key])
      }
      if (fields.length !== undefined) {
        target.length = {
          chapters: Number(fields.length?.chapters ?? target.length?.chapters ?? 0) || 0,
          wordsPerChapter: Number(fields.length?.wordsPerChapter ?? target.length?.wordsPerChapter ?? 0) || 0,
        }
      }
      return target
    }
    let updated = null
    const candidates = (premise.candidates ?? []).map((candidate) => {
      if (candidate.id !== candidateId) return candidate
      updated = applyFields({ ...candidate })
      return updated
    })
    let chosen = premise.chosen
    if (chosen?.id === candidateId) {
      chosen = applyFields({ ...chosen })
      updated = chosen
    }
    if (!updated) throw new Error('找不到要修改的构思候选')
    const next = {
      ...premise,
      candidates,
      chosen,
      chosenHash: chosen ? this.hashInputs(chosen) : premise.chosenHash,
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/premise.json', next)
    return { id: candidateId, fields: updated }
  }

  async commitStyle(agent, options = {}) {
    await this.assertInitialized(agent)
    const premise = await this.readJson(agent, 'story/premise.json')
    if (premise?.status !== 'confirmed' || !premise?.chosen) {
      throw new Error('固定流程要求先确认构思，再确认文风契约')
    }
    const contract = await this.readJson(agent, 'story/style/contract.json')
    if (!contract) throw new Error('还没有文风契约，请先调用 novel_style action=apply')
    const fields = { ...contract.fields, ...(options.fields ?? {}) }
    const next = {
      ...contract,
      status: 'confirmed',
      fields,
      fieldsHash: this.hashInputs(fields),
      confirmedAt: now(),
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/style/contract.json', next)
    return { status: next.status, templateId: next.templateId, fieldsHash: next.fieldsHash }
  }

  /* ------------------------------ P0：设定 ------------------------------ */

  normalizePower(raw) {
    const source = raw && typeof raw === 'object' ? raw : {}
    const sourceSystem = source.system && typeof source.system === 'object' ? source.system : {}
    const tiersSource = Array.isArray(sourceSystem.tiers) && sourceSystem.tiers.length > 0
      ? sourceSystem.tiers
      : DEFAULT_POWER_TIERS
    const tiers = tiersSource
      .map((tier, index) => ({
        id: String(tier?.id ?? `tier-${index + 1}`),
        name: String(tier?.name ?? '').trim(),
        order: Number.isFinite(Number(tier?.order)) ? Number(tier.order) : index,
        description: String(tier?.description ?? ''),
      }))
      .filter((tier) => tier.name)
      .sort((a, b) => a.order - b.order)
    const tierById = new Map(tiers.map((tier) => [tier.id, tier]))
    const characters = (Array.isArray(source.characters) ? source.characters : [])
      .map((character, index) => {
        const tierId = String(character?.tierId ?? '')
        const tierName = tierById.get(tierId)?.name ?? String(character?.tierName ?? '')
        const stage = String(character?.stage ?? '')
        return {
          id: String(character?.id ?? `P#${String(index + 1).padStart(2, '0')}`),
          name: String(character?.name ?? '').trim(),
          tierId,
          tierName,
          stage,
          current: String(character?.current ?? `${tierName}${stage}`.trim()),
          abilities: Array.isArray(character?.abilities) ? character.abilities.map(String) : [],
          notes: String(character?.notes ?? ''),
        }
      })
      .filter((character) => character.name)
    const chapterChanges = {}
    const rawChanges = source.chapterChanges && typeof source.chapterChanges === 'object' ? source.chapterChanges : {}
    for (const [number, value] of Object.entries(rawChanges)) {
      if (!Array.isArray(value)) continue
      const list = value
        .map((item) => {
          if (typeof item === 'string') return item.trim()
          if (item && typeof item === 'object') {
            return [item.character, item.from, item.to, item.summary].filter(Boolean).join('：').trim()
          }
          return ''
        })
        .filter(Boolean)
      if (list.length > 0) chapterChanges[String(number)] = list
    }
    return {
      schemaVersion: 1,
      status: source.status ?? 'candidate',
      system: {
        name: String(sourceSystem.name ?? '武道境界'),
        summary: String(sourceSystem.summary ?? ''),
        tiers,
      },
      characters,
      chapterChanges,
      updatedAt: source.updatedAt ?? null,
    }
  }

  defaultPower() {
    return this.normalizePower({
      status: 'candidate',
      system: { name: '武道境界', summary: '境界从低到高：未入流、三流、二流、一流、绝顶；一流才可真气外放。', tiers: DEFAULT_POWER_TIERS },
      characters: [],
      chapterChanges: {},
    })
  }

  async readPower(agent) {
    const raw = await this.readJson(agent, POWER_FILE).catch(() => null)
    if (!raw) return this.defaultPower()
    return this.normalizePower(raw)
  }

  async savePower(agent, options = {}) {
    await this.assertInitialized(agent)
    const raw = options.power && typeof options.power === 'object' ? options.power : options
    const power = this.normalizePower({ ...raw, status: raw.status ?? 'confirmed', updatedAt: now() })
    await this.writeJson(agent, POWER_FILE, power)
    return power
  }

  async readBible(agent) {
    const raw = await this.readJson(agent, 'story/bible/index.json').catch(() => null)
    const bible = raw && typeof raw === 'object' ? raw : {}
    const data = {
      status: bible.status ?? 'missing',
      updatedAt: bible.updatedAt ?? null,
      confirmedAt: bible.confirmedAt ?? null,
    }
    for (const category of BIBLE_CATEGORIES) {
      data[category] = Array.isArray(bible[category]) ? bible[category] : []
    }
    return data
  }

  async readSystemOverrides(agent) {
    const data = await this.readJson(agent, 'story/prompts/system.json').catch(() => null)
    return normalizePromptOverrides(data)
  }

  async writeSystemOverrides(agent, overrides = {}) {
    await this.writeJson(agent, 'story/prompts/system.json', {
      version: PROMPT_STORE_VERSION,
      overrides,
    })
    return overrides
  }

  promptDefaultHash(entry) {
    return this.hashInputs(entry.default).slice(0, 16)
  }

  /**
   * 取某条提示词实际生效的 system：
   * - 无覆盖 → 用当前默认；
   * - 覆盖文本就是当前默认，或覆盖所基于的默认正是它自己（用户没手改，只是旧版默认）
   *   → 自动跟进当前默认；
   * - 其余（用户确实改过）→ 用用户文本。
   */
  async systemFor(agent, key, fallback) {
    const overrides = await this.readSystemOverrides(agent)
    const entry = overrides?.[key]
    if (!entry) return fallback
    if (entry.text === fallback) return fallback
    if (entry.baseHash && this.hashInputs(entry.text).slice(0, 16) === entry.baseHash) return fallback
    return entry.text
  }

  async saveSystemOverrides(agent, overrides = {}) {
    await this.assertInitialized(agent)
    const clean = {}
    for (const entry of PROMPT_CATALOG) {
      const raw = overrides?.[entry.key]
      const text = typeof raw === 'string'
        ? raw
        : (raw && typeof raw === 'object' && typeof raw.text === 'string' ? raw.text : '')
      const content = text.trim().slice(0, 20000)
      if (!content || content === entry.default) continue
      clean[entry.key] = {
        text: content,
        baseHash: this.promptDefaultHash(entry),
        baseRevision: entry.revision ?? 1,
      }
    }
    await this.writeSystemOverrides(agent, clean)
    return clean
  }

  async promptCatalog(agent) {
    const overrides = await this.readSystemOverrides(agent)
    const prompts = PROMPT_CATALOG.map((entry) => {
      const revision = entry.revision ?? 1
      const override = overrides?.[entry.key]
      const defaultHash = this.promptDefaultHash(entry)
      const customized = Boolean(override && override.text !== entry.default)
      const baseRevision = override?.baseRevision ?? null
      const content = customized ? override.text : entry.default
      return {
        key: entry.key,
        label: entry.label,
        category: entry.category,
        group: entry.group ?? 'other',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        description: entry.description,
        content,
        default: entry.default,
        customized,
        revision,
        baseRevision,
        defaultUpdated: Boolean(
          customized &&
          override.baseHash !== defaultHash &&
          baseRevision !== revision,
        ),
        hash: this.hashInputs(content).slice(0, 16),
        defaultHash,
      }
    })
    return { prompts }
  }

  /**
   * 提示词渲染预览（只读，不调 LLM）：返回默认/当前生效文本、覆盖状态与可替换占位符。
   * 函数拼装的模板不执行，返回 variablesHint。
   */
  async previewPromptTemplate(agent, options = {}) {
    const key = String(options.key ?? '').trim()
    const entry = PROMPT_CATALOG.find((item) => item.key === key)
    if (!entry) throw new Error(`未知提示词：${key}`)
    const overrides = await this.readSystemOverrides(agent)
    const override = overrides?.[key]
    const revision = entry.revision ?? 1
    const defaultIsFunction = typeof entry.default === 'function'
    const defaultText = defaultIsFunction ? null : String(entry.default)
    const customized = Boolean(override && override.text !== entry.default)
    const currentText = defaultIsFunction
      ? (customized ? override.text : null)
      : (customized ? override.text : defaultText)
    const baseRevision = override?.baseRevision ?? null
    const variables = defaultIsFunction ? [] : extractTemplateVariables(currentText ?? defaultText ?? '')
    const result = {
      key: entry.key,
      label: entry.label,
      group: entry.group ?? 'other',
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      defaultText,
      currentText,
      customized,
      baseRevision,
      revision,
      variables,
    }
    if (defaultIsFunction) result.variablesHint = '该模板由代码拼装，无可替换占位符'
    return result
  }

  async saveSystemPrompt(agent, options = {}) {
    await this.assertInitialized(agent)
    const key = String(options.key ?? '')
    const entry = PROMPT_CATALOG.find((item) => item.key === key)
    if (!entry) throw new Error(`未知提示词：${key}`)
    const overrides = await this.readSystemOverrides(agent)
    const content = typeof options.content === 'string' ? options.content.trim().slice(0, 20000) : ''
    if (!content || content === entry.default) {
      delete overrides[key]
    } else {
      overrides[key] = {
        text: content,
        baseHash: this.promptDefaultHash(entry),
        baseRevision: entry.revision ?? 1,
      }
    }
    await this.writeSystemOverrides(agent, overrides)
    return this.promptCatalog(agent)
  }

  async resetSystemPrompt(agent, options = {}) {
    await this.assertInitialized(agent)
    const key = String(options.key ?? '')
    if (!PROMPT_CATALOG.some((item) => item.key === key)) throw new Error(`未知提示词：${key}`)
    const overrides = await this.readSystemOverrides(agent)
    delete overrides[key]
    await this.writeSystemOverrides(agent, overrides)
    return this.promptCatalog(agent)
  }

  async exportSystemPrompts(agent) {
    const overrides = await this.readSystemOverrides(agent)
    return {
      version: PROMPT_STORE_VERSION,
      exportedAt: now(),
      prompts: PROMPT_CATALOG.map((entry) => {
        const override = overrides?.[entry.key]
        const customized = Boolean(override && override.text !== entry.default)
        return {
          key: entry.key,
          label: entry.label,
          customized,
          content: customized ? override.text : entry.default,
          revision: entry.revision ?? 1,
          baseRevision: override?.baseRevision ?? null,
          baseHash: override?.baseHash ?? null,
        }
      }),
    }
  }

  async importSystemPrompts(agent, options = {}) {
    await this.assertInitialized(agent)
    const source = options.data && typeof options.data === 'object' ? options.data : options
    const entries = new Map(PROMPT_CATALOG.map((entry) => [entry.key, entry]))
    let incoming = Array.isArray(source.prompts)
      ? source.prompts
      : (Array.isArray(source.systemPrompts) ? source.systemPrompts : [])
    if (incoming.length === 0 && source && typeof source === 'object') {
      // 兼容最早期直接导出 { [key]: string } 的形式。
      const mapped = Object.entries(source)
        .filter(([key, value]) => entries.has(key) && typeof value === 'string')
        .map(([key, content]) => ({ key, content }))
      if (mapped.length) incoming = mapped
    }
    const overrides = await this.readSystemOverrides(agent)
    let imported = 0
    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue
      const key = String(item.key ?? '')
      const entry = entries.get(key)
      if (!entry) continue
      if (item.customized === false) {
        delete overrides[key]
        continue
      }
      const content = typeof item.content === 'string' ? item.content.trim().slice(0, 20000) : ''
      if (!content || content === entry.default) {
        delete overrides[key]
        continue
      }
      // 导入视为「用户此刻确认了这份内容」：重新锚定到当前默认，忽略导出文件里的旧版本信息。
      overrides[key] = {
        text: content,
        baseHash: this.promptDefaultHash(entry),
        baseRevision: entry.revision ?? 1,
      }
      imported += 1
    }
    await this.writeSystemOverrides(agent, overrides)
    return { imported, catalog: await this.promptCatalog(agent) }
  }

  async buildHealthReport(agent, snapshot = null) {
    await this.assertInitialized(agent)
    let data = snapshot
    if (!data) {
      // 兼容无 snapshot 的直接调用/测试 stub：按原路径读取一次。
      const bible = await this.readBible(agent).catch(() => ({ characters: [] }))
      const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
      const relations = (await this.readRelations(agent).catch(() => ({ relations: [] }))).relations
      const chapterStats = await this.chaptersSummary(agent).catch(() => [])
      data = { bible, outline, relations: { relations }, chapterStats }
    }
    const bible = data.bible ?? { characters: [] }
    const outline = data.outline ?? null
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const chapterStats = data.chapterStats ?? await this.chaptersSummary(agent, data).catch(() => [])
    const relations = (data.relations ?? { relations: [] }).relations
    const names = new Set((bible.characters ?? []).map((entry) => String(entry.name ?? '')).filter(Boolean))
    const issues = []
    const unconfirmed = chapters.filter((chapter) => chapter.status !== 'confirmed')
    if (unconfirmed.length) {
      issues.push({
        key: 'unconfirmed-outline',
        level: 'warn',
        message: `${unconfirmed.length} 章章纲未确认（第 ${unconfirmed.slice(0, 8).map((chapter) => chapter.number).join('、')} 章）`,
        tab: 'outline',
        count: unconfirmed.length,
        numbers: unconfirmed.map((chapter) => Number(chapter.number)),
      })
    }
    const missingFields = chapters.filter((chapter) => {
      return !String(chapter.title ?? '').trim() || !String(chapter.synopsis ?? '').trim()
    })
    if (missingFields.length) {
      issues.push({
        key: 'missing-fields',
        level: 'warn',
        message: `${missingFields.length} 章章纲缺标题或剧情梗概`,
        tab: 'outline',
        count: missingFields.length,
        numbers: missingFields.map((chapter) => Number(chapter.number)),
      })
    }
    const drafted = chapterStats.filter((item) => item.hasDraft && !item.hasFinal)
    if (drafted.length) {
      issues.push({
        key: 'drafted',
        level: 'note',
        message: `${drafted.length} 章有草稿未定稿`,
        tab: 'chapters',
        count: drafted.length,
        numbers: drafted.map((item) => Number(item.number)),
      })
    }
    const staleFinals = chapterStats.filter((item) => item.hasFinal && item.finalStale)
    if (staleFinals.length) {
      issues.push({
        key: 'stale-finals',
        level: 'note',
        message: `${staleFinals.length} 章定稿落后于草稿（定稿待更新）`,
        tab: 'chapters',
        count: staleFinals.length,
        numbers: staleFinals.map((item) => Number(item.number)),
      })
    }
    const badRelations = relations.filter((relation) => !names.has(relation.from) || !names.has(relation.to))
    if (badRelations.length) {
      issues.push({
        key: 'bad-relations',
        level: 'warn',
        message: `${badRelations.length} 条关系引用了不存在的角色`,
        tab: 'bible',
        count: badRelations.length,
      })
    }
    const budgetByNumber = new Map(chapters.map((chapter) => [Number(chapter.number), Number(chapter.wordBudget ?? 0)]))
    const overWords = chapterStats.filter((item) => {
      const target = budgetByNumber.get(Number(item.number)) ?? 0
      return target > 0 && Number(item.wordCount) > target * 1.45
    })
    if (overWords.length) {
      issues.push({
        key: 'over-words',
        level: 'note',
        message: `${overWords.length} 章字数超目标 45%`,
        tab: 'chapters',
        count: overWords.length,
        numbers: overWords.map((item) => Number(item.number)),
      })
    }
    const noSummary = chapterStats.filter((item) => item.hasDraft && !String(item.summary ?? '').trim())
    if (noSummary.length) {
      issues.push({
        key: 'no-summary',
        level: 'note',
        message: `${noSummary.length} 章有草稿但没有摘要`,
        tab: 'chapters',
        count: noSummary.length,
        numbers: noSummary.map((item) => Number(item.number)),
      })
    }
    const latest = chapters.reduce((max, chapter) => Math.max(max, Number(chapter.number) || 0), 0)
    const plants = []
    const payoffs = []
    for (const chapter of chapters) {
      for (const text of chapter.foreshadow?.plant ?? []) plants.push({ chapter: Number(chapter.number), text: String(text) })
      for (const text of chapter.foreshadow?.payoff ?? []) payoffs.push({ chapter: Number(chapter.number), text: String(text) })
    }
    const staleForeshadow = plants.filter((plant) =>
      !payoffs.some((payoff) => payoff.chapter > plant.chapter && payoff.text.includes(plant.text.slice(0, Math.min(10, plant.text.length)))) &&
      latest - plant.chapter > 8,
    )
    if (staleForeshadow.length) {
      issues.push({
        key: 'stale-foreshadow',
        level: 'warn',
        message: `${staleForeshadow.length} 条伏笔超过 8 章未回收（第 ${[...new Set(staleForeshadow.map((plant) => plant.chapter))].slice(0, 8).join('、')} 章埋设）`,
        tab: 'bible',
        count: staleForeshadow.length,
        numbers: [...new Set(staleForeshadow.map((plant) => plant.chapter))],
      })
    }
    const outlineNumbers = new Set(chapters.map((chapter) => Number(chapter.number)))
    let orphans = null
    if (snapshot) {
      // DB 为唯一真源：孤儿 = 章节目录/章节状态在 DB 之外多出来（不再逐目录做 fs 扫描）。
      orphans = {
        chapterDirs: [...(snapshot.files?.keys() ?? [])]
          .filter((number) => !outlineNumbers.has(number))
          .map((number) => String(number)),
        stateFiles: (snapshot.stateIndex?.chapters ?? [])
          .filter((state) => !outlineNumbers.has(Number(state.number)))
          .map((state) => `${String(Number(state.number)).padStart(3, '0')}.json`),
      }
    } else {
      orphans = await this.findOrphans(agent).catch(() => ({ chapterDirs: [], stateFiles: [] }))
    }
    const orphanDirs = (orphans.chapterDirs ?? []).map((name) => Number(name))
    const orphanCount = (orphans.chapterDirs ?? []).length + (orphans.stateFiles ?? []).length
    if (orphanCount) {
      issues.push({
        key: 'orphans',
        level: 'note',
        message: `${orphanCount} 个孤立文件（${orphanDirs.length ? `第 ${orphanDirs.slice(0, 8).join('、')} 章目录` : ''}${orphanDirs.length && (orphans.stateFiles ?? []).length ? '；' : ''}${(orphans.stateFiles ?? []).length ? `${(orphans.stateFiles ?? []).length} 个状态文件` : ''}）`,
        tab: 'project',
        count: orphanCount,
        numbers: orphanDirs,
      })
    }
    issues.sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1))
    return {
      issues,
      counts: {
        chapters: chapters.length,
        confirmed: chapters.length - unconfirmed.length,
        drafted: drafted.length,
        finals: chapterStats.filter((item) => item.hasFinal).length,
        words: chapterStats.reduce((sum, item) => sum + (Number(item.wordCount) || 0), 0),
      },
      generatedAt: now(),
    }
  }

  async readRelations(agent) {
    const raw = await this.readJson(agent, 'story/bible/relations.json').catch(() => null)
    const data = raw && typeof raw === 'object' ? raw : {}
    return {
      status: data.status ?? 'candidate',
      relations: Array.isArray(data.relations) ? data.relations : [],
      positions: data.positions && typeof data.positions === 'object' ? data.positions : {},
      updatedAt: data.updatedAt ?? null,
    }
  }

  async saveRelations(agent, options = {}) {
    await this.assertInitialized(agent)
    const relations = Array.isArray(options?.relations)
      ? options.relations
      : (Array.isArray(options) ? options : [])
    const positions = options && typeof options.positions === 'object' ? options.positions : null
    const bible = await this.readBible(agent)
    const names = new Set((bible.characters ?? []).map((entry) => String(entry.name ?? '')).filter(Boolean))
    const seen = new Set()
    const next = []
    for (const item of relations) {
      const from = String(item?.from ?? '').trim()
      const to = String(item?.to ?? '').trim()
      const type = String(item?.type ?? '').trim()
      if (!from || !to || !type || from === to) continue
      if (!names.has(from) || !names.has(to)) continue
      const key = `${from}|${to}|${type}`
      if (seen.has(key)) continue
      seen.add(key)
      next.push({ from, to, type, note: String(item?.note ?? '').slice(0, 200) })
    }
    const previous = await this.readJson(agent, 'story/bible/relations.json').catch(() => null)
    const cleanPositions = {}
    const source = positions ?? previous?.positions ?? {}
    for (const [name, point] of Object.entries(source ?? {})) {
      if (!names.has(name)) continue
      const x = Number(point?.x)
      const y = Number(point?.y)
      if (Number.isFinite(x) && Number.isFinite(y)) cleanPositions[name] = { x, y }
    }
    const payload = {
      status: 'confirmed',
      relations: next.slice(0, 200),
      positions: cleanPositions,
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/bible/relations.json', payload)
    return payload
  }

  async exportCharacterCard(agent, options = {}) {
    await this.assertInitialized(agent)
    const name = String(options.name ?? '').trim()
    if (!name) throw new Error('请提供角色名')
    const bible = await this.readBible(agent)
    const character = (bible.characters ?? []).find((entry) => entry.name === name)
    if (!character) throw new Error(`找不到角色「${name}」`)
    const relations = (await this.readRelations(agent)).relations.filter(
      (relation) => relation.from === name || relation.to === name,
    )
    const card = {
      name: character.name,
      role: character.role ?? '',
      description: character.description ?? '',
      traits: Array.isArray(character.traits) ? character.traits : [],
      goal: character.goal ?? '',
      relations,
    }
    return { card, json: JSON.stringify(card, null, 2) }
  }

  async importCharacterCard(agent, options = {}) {
    await this.assertInitialized(agent)
    const card = options.card && typeof options.card === 'object' ? options.card : null
    if (!card) throw new Error('角色卡内容为空')
    const name = String(card.name ?? '').trim()
    if (!name) throw new Error('角色卡缺少名称')
    const bible = await this.readBible(agent)
    const existing = (bible.characters ?? []).find((entry) => entry.name === name)
    if (existing && options.overwrite !== true) throw new Error(`角色「${name}」已存在；勾选覆盖后再导入`)
    await this.upsertBibleEntry(agent, {
      category: 'characters',
      ...(existing ? { id: existing.id } : {}),
      fields: {
        name,
        role: card.role ?? '',
        description: card.description ?? '',
        traits: Array.isArray(card.traits) ? card.traits : [],
        goal: card.goal ?? '',
      },
    })
    const relations = Array.isArray(card.relations) ? card.relations : []
    if (relations.length > 0) {
      const current = (await this.readRelations(agent)).relations
      await this.saveRelations(agent, [...current, ...relations])
    }
    return { imported: name, relations: relations.length }
  }

  normalizeBibleEntry(category, entry, index) {
    const prefix = BIBLE_PREFIX[category] ?? 'X'
    return {
      id:
        typeof entry?.id === 'string' && entry.id
          ? entry.id
          : `${prefix}#${String(index + 1).padStart(2, '0')}`,
      name: String(entry?.name ?? ''),
      role: entry?.role ? String(entry.role) : undefined,
      description: String(entry?.description ?? ''),
      ...(Array.isArray(entry?.traits) ? { traits: entry.traits.map(String) } : {}),
      ...(entry?.goal ? { goal: String(entry.goal) } : {}),
    }
  }

  async generateInspiration(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const premise = await this.readJson(agent, 'story/premise.json').catch(() => null)
    const style = await this.readJson(agent, 'story/style/contract.json').catch(() => null)
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const topic = String(options.topic ?? '').trim()
    const count = Math.max(1, Math.min(6, Number(options.count) || 3))
    const system = await this.systemFor(agent, 'inspiration', INSPIRATION_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: [
          `项目：${premise?.chosen?.premise ?? ''}`,
          `已有章纲：${JSON.stringify(chapters.slice(-6).map((chapter) => ({ number: chapter.number, title: chapter.title, synopsis: chapter.synopsis })))}`,
          `文风要点：${String(style?.fields?.notes ?? '').slice(0, 600)}`,
          topic ? `本次主题/要求：${topic}` : '',
          Array.isArray(options.history) && options.history.length
            ? `之前的灵感对话：${JSON.stringify(options.history.slice(-8))}`
            : '',
          `请给 ${count} 个不同的点子。`,
        ].filter(Boolean).join('\n\n'),
      }],
    }]
    const generated = await this.callJsonModel(agent, {
      kind: 'inspiration.generate',
      task: 'premise',
      system,
      messages,
      signal,
      maxTokens: 4000,
      temperature: 0.9,
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const ideas = Array.isArray(parsed.ideas)
      ? parsed.ideas.slice(0, 6).map((idea) => ({
          title: String(idea.title ?? '').slice(0, 100),
          hook: String(idea.hook ?? '').slice(0, 200),
          scene: String(idea.scene ?? '').slice(0, 600),
          note: String(idea.note ?? '').slice(0, 300),
        }))
      : []
    return { ideas, usage: generated.usage }
  }

  async readRun(agent, options = {}) {
    await this.assertInitialized(agent)
    const runId = String(options.runId ?? '')
    if (!/^run-[A-Za-z0-9-]+$/.test(runId)) throw new Error('无效的运行记录')
    const data = await this.readJson(agent, `.dsh-writing/runs/${runId}.json`).catch(() => null)
    if (!data) throw new Error('找不到运行记录')
    return {
      runId: data.runId ?? runId,
      kind: data.kind ?? null,
      createdAt: data.createdAt ?? null,
      model: data.model ?? null,
      usage: data.usage ?? null,
      durationMs: data.durationMs ?? null,
      finish: data.finish ?? null,
      parseError: data.parseError ?? null,
      system: typeof data.system === 'string' ? data.system.slice(0, 20000) : null,
      messages: Array.isArray(data.messages) ? data.messages : [],
      output: typeof data.output === 'string' ? data.output.slice(0, 30000) : null,
    }
  }

  async clearRuns(agent, options = {}) {
    await this.assertInitialized(agent)
    const keep = Math.max(1, Math.min(500, Number(options.keep) || 20))
    const cwd = await this.cwd(agent)
    const pruneDb = async () => {
      const store = await this.storeFor(agent).catch(() => null)
      store?.pruneRuns(keep)
    }
    const dir = await this.ctx.fs.resolve('.dsh-writing/runs', { cwd })
    let entries = []
    try {
      entries = await this.ctx.fs.listDir(dir)
    } catch {
      if (!options.dryRun) await pruneDb()
      return { removed: 0, kept: 0 }
    }
    const names = entries
      .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
      .reverse()
    const remove = names.slice(keep)
    if (options.dryRun) {
      return { total: names.length, remove: remove.length, kept: Math.min(keep, names.length), dryRun: true }
    }
    let removed = 0
    for (const name of remove) {
      const target = await this.ctx.fs.resolve(`.dsh-writing/runs/${name}`, { cwd })
      const hostPath = this.ctx.fs.processPath?.(target)
      if (!hostPath) continue
      try {
        await unlink(hostPath)
        removed += 1
      } catch {
        // ignore
      }
    }
    await pruneDb()
    return { removed, kept: names.length - removed }
  }

  async readDeconstructions(agent) {
    const data = await this.readJson(agent, '.dsh-writing/deconstructions.json').catch(() => null)
    return { items: Array.isArray(data?.items) ? data.items : [] }
  }

  async deconstructText(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const text = String(options.text ?? '').trim()
    if (!text) throw new Error('请粘贴要拆解的小说文本')
    const title = String(options.title ?? '').trim() || '拆书'
    const source = text.slice(0, 12000)
    const stages = []
    const runStage = async ({ key, kind, promptKey, fallback, detail, sections }) => {
      this.reportStage(key, detail)
      try {
        const system = await this.systemFor(agent, promptKey, fallback)
        const generated = await this.callJsonModel(agent, {
          kind,
          task: 'outline',
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: `标题：${title}\n\n文本：\n${source}` }] }],
          signal,
          maxTokens: 6000,
          temperature: 0.4,
        })
        stages.push({ key, ok: true, sections })
        return generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
      } catch (error) {
        stages.push({ key, ok: false, error: errorText(error), sections })
        return {}
      }
    }
    const structure = await runStage({
      key: 'deconstruct.structure',
      kind: 'deconstruct.structure',
      promptKey: 'deconstructStructure',
      fallback: DECONSTRUCT_STRUCTURE_SYSTEM_PROMPT,
      detail: '拆书·结构',
      sections: ['summary', 'units'],
    })
    const cast = await runStage({
      key: 'deconstruct.characters',
      kind: 'deconstruct.characters',
      promptKey: 'deconstructCharacters',
      fallback: DECONSTRUCT_CHARACTERS_SYSTEM_PROMPT,
      detail: '拆书·人物设定',
      sections: ['characters', 'settings', 'relations'],
    })
    const technique = await runStage({
      key: 'deconstruct.technique',
      kind: 'deconstruct.technique',
      promptKey: 'deconstructTechnique',
      fallback: DECONSTRUCT_TECHNIQUE_SYSTEM_PROMPT,
      detail: '拆书·技法',
      sections: ['techniques', 'hooks', 'pacing'],
    })
    const analysis = {
      title,
      summary: String(structure.summary ?? '').slice(0, 2000),
      style: {},
      characters: normalizeDeconstructCharacters(cast.characters),
      hooks: Array.isArray(technique.hooks)
        ? technique.hooks.map(String).map((hook) => hook.trim()).filter(Boolean).slice(0, 30)
        : [],
      units: normalizeDeconstructUnits(structure.units),
      settings: normalizeDeconstructSettings(cast.settings),
      relations: normalizeDeconstructRelations(cast.relations),
      techniques: normalizeDeconstructTechniques(technique.techniques),
      pacing: String(technique.pacing ?? '').slice(0, 1000),
    }
    const path = '.dsh-writing/deconstructions.json'
    const data = (await this.readJson(agent, path).catch(() => null)) ?? { items: [] }
    const items = [{ ...analysis, stages, createdAt: now() }, ...(Array.isArray(data.items) ? data.items : [])].slice(0, 10)
    await this.writeJson(agent, path, { items, updatedAt: now() })
    return { analysis, items, stages }
  }

  async readInspirations(agent) {
    const data = await this.readJson(agent, '.dsh-writing/inspirations.json').catch(() => null)
    return { items: Array.isArray(data?.items) ? data.items : [] }
  }

  async saveInspiration(agent, options = {}) {
    await this.assertInitialized(agent)
    const ideas = Array.isArray(options.ideas) ? options.ideas.slice(0, 6) : []
    if (ideas.length === 0) return { saved: 0, items: [] }
    const path = '.dsh-writing/inspirations.json'
    const data = (await this.readJson(agent, path).catch(() => null)) ?? { items: [] }
    const entry = {
      topic: String(options.topic ?? '').slice(0, 200),
      ideas,
      createdAt: now(),
    }
    const items = [entry, ...(Array.isArray(data.items) ? data.items : [])].slice(0, 20)
    await this.writeJson(agent, path, { items, updatedAt: now() })
    return { saved: ideas.length, items }
  }
  /* ------------------------------ 素材库 ------------------------------ */

  async materialsList(agent) {
    await this.assertInitialized(agent)
    const store = await this.storeFor(agent)
    return { materials: store.listMaterials() }
  }

  async materialSave(agent, options = {}) {
    await this.assertInitialized(agent)
    const store = await this.storeFor(agent)
    const content = String(options.content ?? '')
    if (!content.trim()) throw new Error('素材内容不能为空')
    const kind = MATERIAL_KINDS.includes(options.kind) ? options.kind : '其他'
    return store.saveMaterial({ ...options, content, kind })
  }

  async materialDelete(agent, options = {}) {
    await this.assertInitialized(agent)
    const store = await this.storeFor(agent)
    const id = String(options.id ?? '').trim()
    if (!id) throw new Error('请指定素材 id')
    if (!store.deleteMaterial(id)) throw new Error(`找不到素材：${id}`)
    return { id, deleted: true }
  }

  async generateBible(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const premise = await this.readJson(agent, 'story/premise.json')
    if (premise?.status !== 'confirmed' || !premise?.chosen) {
      throw new Error('请先确认构思，再生成设定')
    }
    const style = await this.readJson(agent, 'story/style/contract.json')
    const project = await this.readJson(agent, this.marker)
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const outlineChapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const scope = ['all', 'characters', 'world'].includes(options.scope) ? options.scope : 'all'
    const existing = await this.readBible(agent)
    const scopeConfig = scope === 'characters'
      ? {
          key: 'bibleCharacters',
          system: BIBLE_CHARACTERS_SYSTEM_PROMPT,
          build: buildBibleCharactersUserPrompt,
          categories: ['characters'],
          label: '角色',
        }
      : scope === 'world'
        ? {
            key: 'bibleWorld',
            system: BIBLE_WORLD_SYSTEM_PROMPT,
            build: buildBibleWorldUserPrompt,
            categories: ['locations', 'rules', 'factions', 'items'],
            label: '世界条目',
          }
        : {
            key: 'bible',
            system: BIBLE_SYSTEM_PROMPT,
            build: buildBibleUserPrompt,
            categories: [...BIBLE_CATEGORIES],
            label: '设定条目',
          }
    const system = await this.systemFor(agent, scopeConfig.key, scopeConfig.system)
    const userText = scopeConfig.build({
      title: project.title,
      language: project.language ?? 'zh',
      premise: premise.chosen,
      styleFields: style?.fields ?? {},
      outlineChapters,
      instruction: options.instruction,
      writingNotes: this.writingNotesFor(project, 'bible'),
    })
    const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }]
    this.reportStage('generating', scopeConfig.label)
    const generated = await this.callJsonModel(agent, {
      kind: `bible.generate.${scope}`,
      task: 'bible',
      system,
      messages,
      signal,
      maxTokens: scope === 'all' ? 7000 : 5000,
      temperature: 0.7,
      inputHash: this.hashInputs({ premise: premise.chosenHash, instruction: options.instruction, scope }),
    })
    const parsed = generated.parsed ?? {}
    const bible = { status: 'candidate', updatedAt: now(), confirmedAt: null }
    for (const category of BIBLE_CATEGORIES) {
      if (!scopeConfig.categories.includes(category)) {
        bible[category] = Array.isArray(existing[category]) ? existing[category] : []
        continue
      }
      const list = Array.isArray(parsed[category]) ? parsed[category] : []
      bible[category] = list
        .map((entry, index) => this.normalizeBibleEntry(category, entry, index))
        .filter((entry) => entry.name)
    }
    const missing = scope === 'characters'
      ? []
      : ['locations', 'rules'].filter((category) => (bible[category] ?? []).length === 0)
    if (missing.length > 0) {
      const supplement = await this.callJsonModel(agent, {
        kind: 'bible.generate.missing',
        task: 'bible',
        system,
        messages: [{
          role: 'user',
          content: [{
            type: 'text',
            text: `只补全这些分类：${missing.join('、')}。仍然只输出 JSON，每类至少 2 条，描述 1–3 句。已确认构思：${JSON.stringify(premise.chosen)}`,
          }],
        }],
        signal,
        maxTokens: 3500,
        temperature: 0.7,
        inputHash: this.hashInputs({ premise: premise.chosenHash, missing }),
      })
      const extra = supplement.parsed ?? {}
      for (const category of missing) {
        const list = Array.isArray(extra[category]) ? extra[category] : []
        bible[category] = list
          .map((entry, index) => this.normalizeBibleEntry(category, entry, index))
          .filter((entry) => entry.name)
      }
    }
    if (scope !== 'world' && bible.characters.length === 0) {
      throw new Error('设定生成结果里没有角色，请重试或补充要求')
    }
    if (scope === 'world' && (bible.locations.length === 0 || bible.rules.length === 0)) {
      throw new Error('世界设定结果里缺少地点或规则，请重试或补充要求')
    }
    await this.writeJson(agent, 'story/bible/index.json', bible)
    return bible
  }

  async upsertBibleEntry(agent, options = {}) {
    await this.assertInitialized(agent)
    const category = options.category
    if (!BIBLE_CATEGORIES.includes(category)) throw new Error(`未知设定分类：${category}`)
    const bible = await this.readBible(agent)
    const list = bible[category]
    let entry = options.id ? list.find((item) => item.id === options.id) : undefined
    if (options.id && !entry) throw new Error(`找不到设定条目：${options.id}`)
    if (!entry) {
      entry = {
        id: `${BIBLE_PREFIX[category]}#${String(list.length + 1).padStart(2, '0')}`,
        name: '',
        description: '',
      }
      list.push(entry)
    }
    if (options.fields?.name !== undefined) entry.name = String(options.fields.name)
    if (options.fields?.role !== undefined) entry.role = String(options.fields.role)
    if (options.fields?.description !== undefined) entry.description = String(options.fields.description)
    if (options.fields?.traits !== undefined) {
      entry.traits = Array.isArray(options.fields.traits) ? options.fields.traits.map(String).filter(Boolean) : undefined
    }
    if (options.fields?.goal !== undefined) entry.goal = String(options.fields.goal)
    bible[category] = list
    bible.status = 'candidate'
    bible.updatedAt = now()
    await this.writeJson(agent, 'story/bible/index.json', bible)
    return entry
  }

  async deleteBibleEntry(agent, options = {}) {
    await this.assertInitialized(agent)
    const category = options.category
    if (!BIBLE_CATEGORIES.includes(category)) throw new Error(`未知设定分类：${category}`)
    const bible = await this.readBible(agent)
    const before = bible[category].length
    bible[category] = bible[category].filter((item) => item.id !== options.id)
    if (bible[category].length === before) throw new Error(`找不到设定条目：${options.id}`)
    bible.status = 'candidate'
    bible.updatedAt = now()
    await this.writeJson(agent, 'story/bible/index.json', bible)
    return { deleted: options.id }
  }

  async commitBible(agent) {
    await this.assertInitialized(agent)
    const bible = await this.readBible(agent)
    if (bible.characters.length === 0) throw new Error('还没有角色设定，请先生成或添加角色')
    bible.status = 'confirmed'
    bible.confirmedAt = now()
    bible.updatedAt = now()
    await this.writeJson(agent, 'story/bible/index.json', bible)
    return bible
  }

  /* --------------------- 跨项目角色卡库（全局，位于 DSH_HOME） --------------------- */

  async listLibraryCharacters() {
    let entries = []
    try {
      entries = await readdir(LIBRARY_CHARACTER_DIR, { withFileTypes: true })
    } catch {
      return { characters: [] }
    }
    const characters = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await readFile(join(LIBRARY_CHARACTER_DIR, entry.name), 'utf8'))
        const item = normalizeLibraryCharacter(raw, entry.name.replace(/\.json$/, ''))
        if (!item.name) continue
        characters.push(item)
      } catch {
        // 坏文件跳过，不影响其它角色卡
      }
    }
    return {
      characters: characters.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
    }
  }

  async saveLibraryCharacter(agent, options = {}) {
    const name = String(options.name ?? '').trim()
    if (!name) throw new Error('请指定要保存的角色')
    const bible = await this.readBible(agent)
    const characters = bible.characters ?? []
    const entry = characters.find((item) => item.name === name) ??
      characters.find((item) => String(item.name ?? '').trim() === name)
    if (!entry) throw new Error('当前项目里没有这个角色')
    const project = await this.readJson(agent, 'story/project.json').catch(() => null)
    const root = await this.cwd(agent)
    const library = await this.listLibraryCharacters()
    const existing = library.characters.find((item) => item.name === String(entry.name ?? '').trim())
    const id = existing?.id || randomUUID()
    const record = normalizeLibraryCharacter({
      id,
      name: String(entry.name ?? '').trim(),
      role: entry.role ?? '',
      description: entry.description ?? '',
      traits: entry.traits ?? [],
      goal: entry.goal ?? '',
      notes: existing?.notes ?? '',
      source: { projectTitle: String(project?.title ?? ''), projectRoot: root },
      createdAt: existing?.createdAt ?? now(),
    })
    await mkdir(LIBRARY_CHARACTER_DIR, { recursive: true })
    await writeFile(join(LIBRARY_CHARACTER_DIR, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    return { saved: record, updated: Boolean(existing) }
  }

  async importLibraryCharacter(agent, options = {}) {
    const id = String(options.id ?? '').trim()
    if (!id) throw new Error('请指定要导入的角色卡')
    const file = libraryCharacterFile(id)
    let raw = null
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      throw new Error('找不到要导入的角色卡')
    }
    const card = normalizeLibraryCharacter(raw, id)
    if (!card.name) throw new Error('角色卡缺少角色名')
    const bible = await this.readBible(agent)
    const characters = bible.characters ?? []
    const existing = characters.find((item) => item.name === card.name) ??
      characters.find((item) => String(item.name ?? '').trim() === card.name)
    if (existing) {
      existing.description = card.description
      existing.traits = [...card.traits]
      existing.goal = card.goal
      if (card.role) existing.role = card.role
      bible.status = 'candidate'
      bible.updatedAt = now()
      await this.writeJson(agent, 'story/bible/index.json', bible)
      return { imported: true, merged: true, name: card.name }
    }
    const used = new Set(characters.map((item) => String(item.id ?? '')))
    let index = characters.length + 1
    let newId = `${BIBLE_PREFIX.characters}#${String(index).padStart(2, '0')}`
    while (used.has(newId)) {
      index += 1
      newId = `${BIBLE_PREFIX.characters}#${String(index).padStart(2, '0')}`
    }
    characters.push({
      id: newId,
      name: card.name,
      role: card.role,
      description: card.description,
      traits: [...card.traits],
      goal: card.goal,
    })
    bible.status = 'candidate'
    bible.updatedAt = now()
    await this.writeJson(agent, 'story/bible/index.json', bible)
    return { imported: true, merged: false, name: card.name }
  }

  async deleteLibraryCharacter(options = {}) {
    const id = String(options.id ?? '').trim()
    if (!id) throw new Error('请指定要删除的角色卡')
    const file = libraryCharacterFile(id)
    try {
      await unlink(file)
    } catch {
      throw new Error('找不到要删除的角色卡')
    }
    return { deleted: id }
  }

  /* --------------------------- 写作技法库（内置 + 用户卡片） --------------------------- */

  /** 合并内置技法卡片与 DSH_HOME 用户卡片；同 id 用户卡片覆盖内置，并带上 enabled/hasOverride。 */
  async allCraftCards(agent = null) {
    const disabled = new Set(agent ? await this.readCraftDisabled(agent) : [])
    const builtinIds = new Set(CRAFT_CARDS.map((card) => normalizeCraftCard(card, '', 'builtin').id).filter(Boolean))
    const merged = new Map()
    for (const card of CRAFT_CARDS) {
      const normalized = normalizeCraftCard(card, '', 'builtin')
      if (!normalized.id) continue
      merged.set(normalized.id, { ...normalized, enabled: !disabled.has(normalized.id), hasOverride: false })
    }
    for (const card of await loadUserCraftCards()) {
      merged.set(card.id, {
        ...card,
        enabled: !disabled.has(card.id),
        hasOverride: builtinIds.has(card.id),
      })
    }
    return [...merged.values()]
  }

  /** 卡片目录（不含 body，省流量）：带 source/enabled/hasOverride。 */
  async listCraftCards(agent = null) {
    const cards = await this.allCraftCards(agent)
    return {
      cards: cards.map(({ id, title, summary, tags, tasks, source, enabled, hasOverride }) => ({
        id, title, summary, tags, tasks, source, enabled, hasOverride,
      })),
    }
  }

  /** 读取完整卡片（含 body、source、enabled）；未知 id 抛错。 */
  async readCraftCard(agent, options = {}) {
    const id = String(options.id ?? '').trim()
    if (!id) throw new Error('请指定技法卡片 id')
    const cards = await this.allCraftCards(agent)
    const card = cards.find((item) => item.id === id)
    if (!card) throw new Error(`找不到技法卡片：${id}`)
    return card
  }

  /** 项目级逐卡禁用列表（story/project.json 的 craftDisabled，缺省空）。 */
  async readCraftDisabled(agent) {
    const project = await this.readJson(agent, this.marker).catch(() => null)
    if (!project || typeof project !== 'object') return []
    return Array.isArray(project.craftDisabled) ? project.craftDisabled.filter((id) => typeof id === 'string') : []
  }

  /** 逐卡启用/禁用（写 project.craftDisabled）。 */
  async setCraftCardEnabled(agent, options = {}) {
    const id = String(options.id ?? '').trim()
    if (!id) throw new Error('请指定技法卡片 id')
    const cards = await this.allCraftCards(agent)
    if (!cards.some((card) => card.id === id)) throw new Error(`找不到技法卡片：${id}`)
    const project = await this.readJson(agent, this.marker)
    const disabled = new Set(Array.isArray(project.craftDisabled) ? project.craftDisabled : [])
    if (options.enabled === false) disabled.add(id)
    else disabled.delete(id)
    project.craftDisabled = [...disabled]
    await this.writeJson(agent, this.marker, project)
    return { id, enabled: !disabled.has(id) }
  }

  /** 保存/删除用户卡片（Host 侧管理；同 id 覆盖内置，删除后恢复内置）。 */
  async saveCraftCard(agent, options = {}) {
    return saveUserCraftCard(options)
  }

  async deleteCraftCard(agent, id) {
    return deleteUserCraftCard(id)
  }

  /**
   * 按任务 / 指令 / 题材给卡片打分，返回前 max 张（默认 2，最多 5）。
   * task 命中 +3；instruction 命中 tags 每个 +2；instruction/title/summary 关键词重叠每个 +1（上限 +3）；genre +1。
   * 同分用 hash(chapterNumber + card.id) 确定性轮转，避免每章固定选文件前两张；
   * instruction 为空且没有 genre 命中时只返回 1 张（降低固定偏向）。
   */
  async selectCraftCards(agent = null, options = {}) {
    const task = String(options.task ?? '').trim()
    const instruction = String(options.instruction ?? '').trim()
    const genre = Array.isArray(options.genre) ? options.genre.map(String) : []
    const chapterNumber = Number(options.chapterNumber) || 0
    const max = Math.max(1, Math.min(5, Number(options.max ?? 2) || 2))
    const cards = await this.allCraftCards(agent)
    const keywords = craftInstructionKeywords(instruction)
    const scored = []
    for (const card of cards) {
      if (card.enabled === false) continue
      let score = 0
      if (task && card.tasks.includes(task)) score += 3
      for (const tag of card.tags) {
        if (tag && instruction.includes(tag)) score += 2
      }
      let overlap = 0
      const haystack = [card.title, card.summary, ...card.tags].join(' ')
      for (const keyword of keywords) {
        if (keyword && haystack.includes(keyword)) overlap += 1
      }
      score += Math.min(3, overlap)
      let genreHit = false
      for (const item of genre) {
        if (!item) continue
        if (card.tags.some((tag) => tag === item || tag.includes(item) || item.includes(tag))) {
          score += 1
          genreHit = true
        }
      }
      if (score <= 0) continue
      scored.push({ card, score, genreHit })
    }
    const seedBase = chapterNumber > 0 ? String(chapterNumber) : instruction
    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return craftSeedHash(seedBase + left.card.id) - craftSeedHash(seedBase + right.card.id)
    })
    const anyGenreHit = scored.some((entry) => entry.genreHit)
    const limit = (!instruction && !anyGenreHit) ? 1 : max
    return {
      cards: scored.slice(0, limit).map(({ card, score }) => ({
        ...card,
        score,
        body: card.body.length > 1200 ? card.body.slice(0, 1200) : card.body,
      })),
    }
  }

  /** 项目开关：story/project.json 的 craftAuto，缺省 true（未初始化也返回 true）。 */
  async readCraftAuto(agent) {
    const project = await this.readJson(agent, this.marker).catch(() => null)
    if (!project || typeof project !== 'object') return true
    return project.craftAuto !== false
  }

  async setCraftAuto(agent, options = {}) {
    await this.assertInitialized(agent)
    const project = await this.readJson(agent, this.marker)
    const enabled = options.enabled !== false
    project.craftAuto = enabled
    await this.writeJson(agent, this.marker, project)
    return { craftAuto: enabled }
  }

  /** 章节生成/修订/修复时按项目题材挑卡；关闭 craftAuto 时返回空数组。注入前加契约优先说明。 */
  async craftCardsFor(agent, options = {}) {
    if (!(await this.readCraftAuto(agent))) return []
    const premise = await this.readJson(agent, 'story/premise.json').catch(() => null)
    const genre = Array.isArray(premise?.chosen?.genre) ? premise.chosen.genre : []
    const { cards } = await this.selectCraftCards(agent, {
      task: options.task,
      instruction: options.instruction,
      genre,
      chapterNumber: options.chapterNumber,
    })
    return withCraftContractNote(cards)
  }

  /** provider 用：按 cwd 读项目 craftDisabled（未初始化/无 DB → 空）。 */
  async readCraftDisabledByCwd(cwd) {
    if (typeof cwd !== 'string' || !cwd) return []
    try {
      const store = await this.storeFor(cwd)
      const project = store.readProject()
      return Array.isArray(project?.craftDisabled) ? project.craftDisabled.filter((id) => typeof id === 'string') : []
    } catch {
      return []
    }
  }

  /** 合并后的技能目录：内置 craft-* + 项目导入（scope project）+ 全局导入（scope global）；同名按 rank 小者胜。 */
  async listSkills(agent) {
    const cwd = await this.cwd(agent)
    const disabled = await this.readCraftDisabled(agent)
    const imported = await scanImportedSkills(allSkillRoots(cwd, DSH_HOME))
    const builtinNames = new Set([
      ...CRAFT_CARDS.map((card) => craftSkillName(card.id)),
      ...BUILTIN_REFERENCE_SKILLS.map((skill) => skill.name),
    ])
    const merged = new Map()
    for (const card of CRAFT_CARDS) {
      merged.set(craftSkillName(card.id), {
        name: craftSkillName(card.id),
        description: card.summary,
        source: 'builtin',
        scope: 'builtin',
        enabled: !builtinSkillDisabled(disabled, craftSkillName(card.id)),
        canDelete: false,
        overridesBuiltin: false,
        tags: card.tags ?? [],
        tasks: card.tasks ?? [],
      })
    }
    for (const skill of BUILTIN_REFERENCE_SKILLS) {
      merged.set(skill.name, {
        name: skill.name,
        description: skill.description,
        source: 'builtin',
        scope: 'builtin',
        enabled: !builtinSkillDisabled(disabled, skill.name),
        canDelete: false,
        overridesBuiltin: false,
        tags: skill.tags ?? [],
        tasks: [],
      })
    }
    for (const skill of imported) {
      merged.set(skill.name, {
        name: skill.name,
        description: skill.description,
        source: 'imported',
        scope: skill.scope === 'global' ? 'global' : 'project',
        enabled: true,
        canDelete: true,
        overridesBuiltin: builtinNames.has(skill.name),
        rank: skill.rank,
        path: skill.filePath,
      })
    }
    return { skills: [...merged.values()] }
  }

  /** 技能开关：内置 craft-* 写项目 craftDisabled；导入技能不支持开关（应删除）。 */
  async toggleSkill(agent, options = {}) {
    const name = String(options.name ?? '').trim()
    if (!isBuiltinSkillName(name)) {
      throw new Error('导入技能不支持开关；如需移除请删除')
    }
    const cardId = craftCardIdFromSkill(name)
    const isCraftCard = Boolean(cardId) && CRAFT_CARDS.some((card) => card.id === cardId)
    const isRefSkill = BUILTIN_REFERENCE_SKILLS.some((skill) => skill.name === name)
    if (!isCraftCard && !isRefSkill) {
      throw new Error('导入技能不支持开关；如需移除请删除')
    }
    const project = await this.readJson(agent, this.marker)
    const disabled = new Set(Array.isArray(project.craftDisabled) ? project.craftDisabled : [])
    // 统一存技能名；旧数据里的裸 craft id 一并清理
    if (cardId) disabled.delete(cardId)
    if (options.enabled === false) disabled.add(name)
    else disabled.delete(name)
    project.craftDisabled = [...disabled]
    await this.writeJson(agent, this.marker, project)
    return { name, enabled: !disabled.has(name) }
  }

  /** 导入技能：scope=project 写项目 .dsh/skills；scope=global 写 DSH_HOME/novel-writer/library/skills。 */
  async importSkill(agent, options = {}) {
    const cwd = await this.cwd(agent)
    return importSkillToProject({
      projectRoot: cwd,
      sourcePath: options.path,
      scope: options.scope === 'global' ? 'global' : 'project',
      dshHome: DSH_HOME,
    })
  }

  /** 删除导入技能（项目或全局；内置不可删；路径必须位于技能根目录内）。 */
  async deleteSkill(agent, options = {}) {
    const cwd = await this.cwd(agent)
    const name = typeof options === 'string' ? options : String(options?.name ?? '').trim()
    const scope = typeof options === 'object' ? options?.scope : undefined
    return deleteImportedSkill({
      roots: allSkillRoots(cwd, DSH_HOME),
      name,
      scope: scope === 'global' || scope === 'project' ? scope : undefined,
    })
  }

  /** 读取技能全文：内置返回卡片正文（带适配性提示），项目/全局导入返回 SKILL.md 正文。 */
  async readSkill(agent, name, scope) {
    const cwd = await this.cwd(agent)
    const skillName = String(name ?? '').trim()
    const refSkill = BUILTIN_REFERENCE_SKILLS.find((skill) => skill.name === skillName)
    if (refSkill) {
      return {
        name: refSkill.name,
        source: 'builtin',
        scope: 'builtin',
        description: refSkill.description,
        content: builtinReferenceBody(refSkill),
      }
    }
    const cardId = craftCardIdFromSkill(skillName)
    if (cardId) {
      const card = CRAFT_CARDS.find((item) => item.id === cardId)
      if (!card) throw new Error(`找不到技能：${skillName}`)
      return { name: skillName, source: 'builtin', scope: 'builtin', description: card.summary, content: craftSkillBody(card) }
    }
    const imported = await scanImportedSkills(allSkillRoots(cwd, DSH_HOME))
    const wantedScope = scope === 'global' || scope === 'project' ? scope : null
    const skill = imported.find((item) => item.name === skillName && (!wantedScope || item.scope === wantedScope))
    if (!skill) throw new Error(`找不到技能：${skillName}`)
    return { name: skill.name, source: 'imported', scope: skill.scope, description: skill.description, content: skill.content, path: skill.filePath }
  }

  async buildChapterFacts(agent, chapter, number) {
    const bible = await this.readBible(agent)
    const text = JSON.stringify(chapter)
    const match = (entry) => entry.name && text.includes(entry.name)
    const facts = {
      bible: {
        characters: bible.characters.filter(match).slice(0, 12),
        locations: bible.locations.filter(match).slice(0, 6),
        rules: bible.rules.slice(0, 8),
        factions: bible.factions.filter(match).slice(0, 4),
        items: bible.items.filter(match).slice(0, 4),
      },
    }
    if (Number(number) > 1) {
      const previous = this.chapterPaths(Number(number) - 1)
      const previousState = await this.readJson(agent, `story/state/${previous.pad}.json`).catch(() => null)
      if (previousState) facts.previousState = previousState
    }
    return facts
  }

  contextConfig(project) {
    const context = project?.context ?? {}
    return {
      recentStateChapters: clamp(Number(context.recentStateChapters ?? 1) || 0, 0, 3),
      maxTailChars: clamp(Number(context.maxTailChars ?? 1200) || 0, 0, 4000),
      maxBibleCharacters: clamp(Number(context.maxBibleCharacters ?? 12) || 0, 0, 20),
      maxRules: clamp(Number(context.maxRules ?? 6) || 0, 0, 20),
      maxForeshadow: clamp(Number(context.maxForeshadow ?? 8) || 0, 0, 30),
      maxTimeline: clamp(Number(context.maxTimeline ?? 5) || 0, 0, 20),
      maxContextChars: clamp(Number(context.maxContextChars ?? 16000) || 16000, 4000, 60000),
      includeForeshadowing: context.includeForeshadowing !== false,
    }
  }

  async buildStoryContext(agent, chapter, number) {
    const project = await this.readJson(agent, this.marker)
    const premise = await this.readJson(agent, 'story/premise.json')
    const style = await this.readJson(agent, 'story/style/contract.json')
    const bible = await this.readBible(agent)
    const power = await this.readPower(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const config = this.contextConfig(project)
    const allChapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const chapterText = JSON.stringify(chapter)
    const matches = (entry) => entry.name && chapterText.includes(entry.name)
    const chosen = premise?.chosen ?? {}
    const bibleContext = {
      characters: bible.characters.filter(matches).slice(0, config.maxBibleCharacters),
      locations: bible.locations.filter(matches).slice(0, 6),
      rules: bible.rules.slice(0, config.maxRules),
      factions: bible.factions.filter(matches).slice(0, 6),
      items: bible.items.filter(matches).slice(0, 6),
    }
    if (bibleContext.characters.length === 0) {
      bibleContext.characters = bible.characters.slice(0, Math.min(4, config.maxBibleCharacters))
    }

    const castNames = new Set(
      bible.characters.filter(matches).map((entry) => String(entry.name)),
    )
    const relations = await this.readRelations(agent).catch(() => null)
    const relationList = (relations?.relations ?? [])
      .filter((relation) =>
        castNames.has(String(relation.from)) ||
        castNames.has(String(relation.to)) ||
        chapterText.includes(String(relation.from)) ||
        chapterText.includes(String(relation.to)),
      )
      .slice(0, 12)
    const powerCharacters = power.characters
      .filter((character) => castNames.has(character.name) || chapterText.includes(character.name))
      .slice(0, 8)
    if (powerCharacters.length === 0 && power.characters.length > 0) {
      powerCharacters.push(...power.characters.slice(0, Math.min(4, power.characters.length)))
    }
    const currentPowerChanges = power.chapterChanges[String(number)] ?? []
    const recentPowerChanges = Object.entries(power.chapterChanges)
      .filter(([chapterNumber]) => Number(chapterNumber) < Number(number))
      .sort(([a], [b]) => Number(a) - Number(b))
      .slice(-3)
      .map(([chapterNumber, changes]) => ({ chapter: Number(chapterNumber), changes }))
    const powerContext = {
      system: {
        name: power.system.name,
        summary: power.system.summary,
        tiers: power.system.tiers,
      },
      characters: powerCharacters,
      currentChanges: currentPowerChanges,
      recentChanges: recentPowerChanges,
    }

    const recent = []
    const summaryCache = new Map()
    const loadSummary = async (chapterNumber) => {
      const key = Number(chapterNumber)
      if (summaryCache.has(key)) return summaryCache.get(key)
      const summary = await this.readChapterSummary(agent, key).catch(() => null)
      summaryCache.set(key, summary)
      return summary
    }
    for (let offset = 1; offset <= config.recentStateChapters; offset += 1) {
      const previousNumber = Number(number) - offset
      if (previousNumber < 1) break
      const previousChapter = allChapters.find((item) => Number(item.number) === previousNumber)
      if (!previousChapter) continue
      const previousPaths = this.chapterPaths(previousNumber)
      const state = await this.readJson(agent, `story/state/${previousPaths.pad}.json`).catch(() => null)
      const summary = await loadSummary(previousNumber)
      recent.push({
        number: previousNumber,
        title: previousChapter.title,
        synopsis: previousChapter.synopsis || '',
        summary: summary?.summary ?? state?.summary ?? (
          previousChapter.synopsis
            ? `（本章尚未定稿，以下为章纲剧情）${previousChapter.synopsis}`
            : null
        ),
      })
    }

    const queryText = [
      chapter.title,
      chapter.synopsis,
    ].filter(Boolean).join(' ')
    const queryTerms = new Set()
    for (let index = 0; index < queryText.length - 1; index += 1) {
      const term = queryText.slice(index, index + 2)
      if (/^[\u4e00-\u9fa5A-Za-z0-9]{2}$/.test(term)) queryTerms.add(term)
    }
    const summaryRows = []
    const previousForSummaries = allChapters
      .filter((item) => Number(item.number) < Number(number))
      .slice(-40)
    const previousSummaries = await Promise.all(
      previousForSummaries.map(async (previousChapter) => ({
        chapter: previousChapter,
        summary: await loadSummary(previousChapter.number),
      })),
    )
    for (const { chapter: previousChapter, summary } of previousSummaries) {
      if (!summary?.summary) continue
      let score = 0
      for (const name of summary.characters ?? []) {
        if (queryText.includes(name)) score += 8
      }
      for (const term of queryTerms) {
        if (String(summary.summary).includes(term)) score += 1
      }
      summaryRows.push({
        number: Number(previousChapter.number),
        title: previousChapter.title,
        summary: String(summary.summary).slice(0, 360),
        characters: (summary.characters ?? []).slice(0, 8),
        score,
      })
    }
    const summaryHistory = summaryRows.slice(-8).map(({ score, ...item }) => item)
    const recentNumbers = new Set(summaryHistory.map((item) => item.number))
    const relevantSummaries = summaryRows
      .filter((item) => !recentNumbers.has(item.number) && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(({ score, ...item }) => ({ ...item, score }))

    let previousTail = ''
    if (Number(number) > 1 && config.maxTailChars > 0) {
      const previous = this.chapterPaths(Number(number) - 1)
      const text =
        (await this.readText(agent, previous.final).catch(() => null)) ??
        (await this.readText(agent, previous.draft).catch(() => null)) ??
        ''
      previousTail = text.trim().slice(-config.maxTailChars)
    }

    let foreshadowing = []
    if (config.includeForeshadowing && config.maxForeshadow > 0) {
      const planted = []
      for (const item of allChapters.filter((entry) => Number(entry.number) < Number(number))) {
        for (const text of item.foreshadow?.plant ?? []) {
          planted.push({ text: String(text), plantedAt: Number(item.number), paidAt: null })
        }
        for (const text of item.foreshadow?.payoff ?? []) {
          const value = String(text)
          const open = planted.find(
            (entry) => !entry.paidAt && (entry.text === value || value.includes(entry.text) || entry.text.includes(value)),
          )
          if (open) open.paidAt = Number(item.number)
        }
      }
      foreshadowing = planted
        .filter((item) => !item.paidAt)
        .slice(-config.maxForeshadow)
        .map((item) => ({
          ...item,
          age: Number(number) - Number(item.plantedAt),
          overdue: Number(number) - Number(item.plantedAt) >= 8,
        }))
    }

    const timeline = allChapters
      .filter((item) => Number(item.number) <= Number(number))
      .slice(-config.maxTimeline)
      .map((item) => ({
        number: Number(item.number),
        title: item.title,
        status: item.status,
      }))

    const notes = []
    try {
      const noteFile = await this.readJson(agent, `.dsh-writing/notes/chapter-${number}.json`).catch(() => null)
      for (const note of (noteFile?.notes ?? []).slice(-3)) {
        notes.push({
          conclusion: note.conclusion,
          suggestions: note.suggestions,
          todos: note.todos,
          risks: note.risks,
        })
      }
    } catch {
      // notes are optional
    }

    const storyContext = {
      premise: {
        title: chosen.title,
        premise: chosen.premise,
        genre: chosen.genre,
        protagonist: chosen.protagonist,
      },
      style: style?.fields ?? {},
      bible: bibleContext,
      power: powerContext,
      continuity: { recent, previousTail },
      summaryHistory,
      relevantSummaries,
      foreshadowing,
      foreshadowingDue: (chapter.foreshadow?.payoff ?? []).map(String),
      relations: relationList,
      timeline,
      notes,
    }
    const truncated = this.fitStoryContext(storyContext, config.maxContextChars)
    storyContext.meta = {
      chars: JSON.stringify(storyContext).length,
      estimatedTokens: Math.ceil(JSON.stringify(storyContext).length / 1.8),
      budgetChars: config.maxContextChars,
      truncated,
      counts: {
        recent: recent.length,
        previousTailChars: previousTail.length,
        characters: bibleContext.characters.length,
        powerCharacters: powerCharacters.length,
        powerCurrentChanges: currentPowerChanges.length,
        powerRecentChanges: recentPowerChanges.length,
        locations: bibleContext.locations.length,
        rules: bibleContext.rules.length,
        foreshadowing: foreshadowing.length,
        relations: relationList.length,
        timeline: timeline.length,
        notes: notes.length,
        summaryHistory: summaryHistory.length,
        relevantSummaries: relevantSummaries.length,
      },
    }
    return storyContext
  }

  /**
   * 先按优先级删低价值上下文，不直接砍章纲和本章核心设定。
   * 目标只是防止长篇后期上下文无限膨胀，不是精确 token 计费。
   */
  fitStoryContext(context, maxChars) {
    if (!context || !Number.isFinite(maxChars) || maxChars <= 0) return false
    const size = () => JSON.stringify(context).length
    if (size() <= maxChars) return false
    let changed = false
    const dropLast = (array) => {
      if (Array.isArray(array) && array.length) {
        array.pop()
        changed = true
        return true
      }
      return false
    }
    const trimTail = () => {
      if (context.continuity?.previousTail) {
        const tail = String(context.continuity.previousTail)
        context.continuity.previousTail = tail.slice(-Math.max(400, Math.floor(tail.length / 2)))
        changed = true
        return true
      }
      return false
    }
    const shrinkSteps = [
      () => dropLast(context.notes),
      () => dropLast(context.relevantSummaries),
      () => dropLast(context.timeline),
      () => dropLast(context.relations),
      () => dropLast(context.summaryHistory),
      () => dropLast(context.bible?.factions),
      () => dropLast(context.bible?.items),
      () => dropLast(context.bible?.locations),
      () => dropLast(context.power?.recentChanges),
      () => dropLast(context.foreshadowing),
      () => trimTail(),
      () => dropLast(context.continuity?.recent),
      () => dropLast(context.power?.characters),
      () => dropLast(context.bible?.characters),
      () => {
        if (context.style && Object.keys(context.style).length) {
          context.style = {}
          changed = true
          return true
        }
        return false
      },
    ]
    while (size() > maxChars) {
      let progressed = false
      for (const step of shrinkSteps) {
        if (size() <= maxChars) break
        if (step()) progressed = true
      }
      if (!progressed) break
    }
    return changed
  }

  async contextPreview(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const { chapter } = await this.findOutlineChapter(agent, number)
    if (!chapter) throw new Error(`找不到第 ${number} 章章纲`)
    const context = await this.buildStoryContext(agent, chapter, number)
    return {
      number,
      title: chapter.title,
      context,
    }
  }

  /* ------------------------------ P0：章纲 ------------------------------ */

  async currentInputs(agent) {
    const premise = await this.readJson(agent, 'story/premise.json')
    const style = await this.readJson(agent, 'story/style/contract.json')
    return {
      premiseStatus: premise?.status ?? 'missing',
      styleStatus: style?.status ?? 'missing',
      chosen: premise?.chosen ?? null,
      premiseHash: premise?.chosenHash ?? null,
      styleFields: style?.fields ?? null,
      styleHash: style?.fieldsHash ?? null,
      styleTemplateId: style?.templateId ?? null,
    }
  }

  normalizeOutlineChapter(raw, number, { wordBudget, inputs }) {
    const id = `ch-${String(number).padStart(3, '0')}`
    const synopsis = String(raw.synopsis ?? raw.summary ?? '').trim() ||
      [raw.goal, raw.conflict, raw.turn, raw.outcome].filter(Boolean).join('；')
    return {
      id,
      number,
      status: 'candidate',
      title: String(raw.title ?? ''),
      synopsis,
      wordBudget: Number(raw.wordBudget ?? wordBudget) || wordBudget,
      ...(raw?.volumeEnd === true ? { volumeEnd: true } : {}),
      inputs: {
        premise: inputs.premiseHash,
        style: inputs.styleHash,
        ...(inputs.bible ? { bible: inputs.bible } : {}),
        ...(inputs.power ? { power: inputs.power } : {}),
      },
      generatedAt: now(),
    }
  }

  async outlineGenerate(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const inputs = await this.currentInputs(agent)
    if (inputs.premiseStatus !== 'confirmed' || !inputs.chosen) {
      throw new Error('需要先确认构思（novel_premise action=commit）才能生成章纲')
    }
    if (inputs.styleStatus !== 'confirmed') {
      throw new Error('固定流程要求先确认文风契约，再生成章纲')
    }
    const bible = await this.readBible(agent)
    if (bible.status !== 'confirmed') {
      throw new Error('固定流程要求先确认角色/世界设定，再生成章纲')
    }
    const power = await this.readPower(agent)

    const project = await this.readJson(agent, this.marker)
    const outline = (await this.readJson(agent, 'story/plot/outline.json')) ?? {
      status: 'candidate',
      logline: null,
      volumes: [],
      updatedAt: null,
    }
    const volumes = Array.isArray(outline.volumes) ? outline.volumes : []
    const requestedVolumeId = String(options.volumeId ?? '')
    // 未指定卷时落到“最新章所在卷”，避免第二卷续写被挂回第一卷。
    let volume = volumes.find((item) => item.id === requestedVolumeId) ?? null
    if (!volume) {
      let latest = null
      let latestNumber = -1
      for (const item of volumes) {
        for (const chapter of item.chapters ?? []) {
          const number = Number(chapter.number) || 0
          if (number >= latestNumber) {
            latestNumber = number
            latest = item
          }
        }
      }
      volume = latest ?? volumes[0] ?? { id: 'vol-1', title: '第一卷', goal: '', chapters: [] }
    }
    // 新开一卷：当前卷最后一章已标阶段收束时，下一次“续写/生成后”自动落到下一卷，
    // 不要求用户先手动切卷；重生成仍留在原卷。
    if (!options.regenerate && Array.isArray(volume.chapters) && volume.chapters.length > 0) {
      const sorted = volume.chapters.slice().sort((a, b) => Number(a.number) - Number(b.number))
      const last = sorted[sorted.length - 1]
      if (last?.volumeEnd === true) {
        const ordinal = Number(String(volume.id ?? '').replace(/\D+/g, '')) || 0
        let next = volumes.find((item) => item.id === `vol-${ordinal + 1}`)
        if (!next) {
          next = {
            id: `vol-${ordinal + 1}`,
            title: `第 ${ordinal + 1} 卷`,
            goal: '',
            map: '',
            chapters: [],
          }
          volumes.push(next)
        }
        volume = next
      }
    }
    if (!volumes.some((item) => item.id === volume.id)) volumes.push(volume)
    if (!String(volume.map ?? '').trim() || !String(volume.goal ?? '').trim()) {
      const planned = await this.planVolume(agent, {
        volumeId: volume.id,
        instruction: options.instruction,
      }, signal).catch(() => null)
      if (planned?.volume) Object.assign(volume, planned.volume)
    }
    const existing = Array.isArray(volume.chapters) ? volume.chapters : []
    const allExisting = volumes.flatMap((item) => item.chapters ?? [])
    const maxNumber = allExisting.reduce((max, chapter) => {
      const number =
        Number(chapter.number) || Number(String(chapter.id ?? '').replace(/\D+/g, '')) || 0
      return Math.max(max, number)
    }, 0)

    const totalChapters = Number(inputs.chosen.length?.chapters ?? 0) || 0
    const regenerate = Boolean(options.regenerate)
    const fromChapter = clamp(
      Number(options.fromChapter ?? (regenerate ? Math.max(1, maxNumber) : maxNumber + 1)) || 1,
      1,
      999,
    )
    const requestedCount = clamp(Number(options.count ?? 8) || 8, 1, 12)
    const toChapter = clamp(
      Number(options.toChapter ?? fromChapter + requestedCount - 1) || fromChapter + requestedCount - 1,
      fromChapter,
      totalChapters > 0 ? Math.max(totalChapters, fromChapter) : 999,
    )

    const range = []
    for (let number = fromChapter; number <= toChapter; number += 1) range.push(number)
    const inRange = (chapter) => {
      const number = Number(chapter.number) || 0
      return number >= fromChapter && number <= toChapter
    }
    const contextChapters = existing
      .filter((chapter) => !inRange(chapter))
      .filter((chapter) => {
        const number = Number(chapter.number) || 0
        return number < fromChapter || number === toChapter + 1
      })
      .slice(-6)

    const wordBudget = Number(inputs.styleFields?.chapterWords ?? 3000) || 3000
    const system = await this.systemFor(agent, 'outline', OUTLINE_SYSTEM_PROMPT)
    const volumeIndex = volumes.findIndex((item) => item.id === volume.id)
    const previousVolume = volumeIndex > 0 ? volumes[volumeIndex - 1] : null
    const previousLastChapter = previousVolume
      ? (previousVolume.chapters ?? []).slice().sort((a, b) => Number(b.number) - Number(a.number))[0] ?? null
      : null
    const anchorChapter = existing.find((chapter) => Number(chapter.number) === fromChapter - 1) || previousLastChapter
    let previousAnchor = null
    if (anchorChapter) {
      const anchorSummary = await this.readChapterSummary(agent, anchorChapter.number).catch(() => null)
      const anchorPaths = this.chapterPaths(anchorChapter.number)
      const anchorText = (await this.readText(agent, anchorPaths.final).catch(() => null)) ??
        (await this.readText(agent, anchorPaths.draft).catch(() => null)) ??
        ''
      previousAnchor = {
        number: anchorChapter.number,
        title: anchorChapter.title,
        synopsis: anchorChapter.synopsis || '',
        summary: anchorSummary?.summary ?? '',
        ending: anchorText.trim().slice(-600),
      }
    }
    const userText = buildOutlineUserPrompt({
      title: project.title,
      language: project.language ?? 'zh',
      premise: inputs.chosen,
      styleFields: inputs.styleFields ?? {},
      bible: {
        characters: bible.characters.slice(0, 20),
        rules: bible.rules.slice(0, 10),
        locations: bible.locations.slice(0, 10),
      },
      power: {
        system: power.system,
        characters: power.characters,
        recentChanges: Object.entries(power.chapterChanges)
          .filter(([chapterNumber]) => Number(chapterNumber) < fromChapter)
          .sort(([a], [b]) => Number(a) - Number(b))
          .slice(-4)
          .map(([chapterNumber, changes]) => ({ chapter: Number(chapterNumber), changes })),
      },
      fromChapter,
      toChapter,
      totalChapters,
      wordBudget,
      volume: {
        title: volume.title,
        goal: volume.goal,
        map: volume.map,
        powerCeiling: volume.powerCeiling,
        exitCriteria: volume.exitCriteria,
        targetChapters: volume.targetChapters ?? project.automation?.volumeChapters ?? 10,
      },
      previousVolume: previousVolume ? {
        title: previousVolume.title,
        map: previousVolume.map,
        goal: previousVolume.goal,
        exitCriteria: previousVolume.exitCriteria,
        lastChapter: previousLastChapter ? {
          number: previousLastChapter.number,
          title: previousLastChapter.title,
          synopsis: previousLastChapter.synopsis,
        } : null,
      } : null,
      previousAnchor,
      contextChapters,
      instruction: options.instruction,
      writingNotes: this.writingNotesFor(project, 'outline'),
      regenerate,
    })
    const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }]
    this.reportStage('generating', `章纲 ${fromChapter}–${toChapter}`)
    const generated = await this.callJsonModel(agent, {
      kind: regenerate ? 'outline.regenerate' : 'outline.generate',
      task: 'outline',
      system,
      messages,
      signal,
      maxTokens: 256000,
      temperature: 0.6,
      inputHash: this.hashInputs({
        premise: inputs.premiseHash,
        style: inputs.styleHash,
        fromChapter,
        toChapter,
        instruction: options.instruction,
      }),
    })

    const rawChapters = Array.isArray(generated.parsed)
      ? generated.parsed
      : generated.parsed?.chapters
    if (!Array.isArray(rawChapters) || rawChapters.length === 0) {
      const error = new Error('章纲解析成功但未返回 chapters 数组')
      error.code = 'NOVEL_WRITER_BAD_MODEL_OUTPUT'
      error.raw = generated.first.text
      error.runId = generated.runId
      throw error
    }

    const contextHashes = {
      bible: this.hashInputs(bible),
      power: this.hashInputs(power ?? {}),
    }
    const normalized = rawChapters
      .slice(0, range.length)
      .map((raw, index) =>
        this.normalizeOutlineChapter(raw, range[index], {
          wordBudget,
          inputs: { ...inputs, ...contextHashes },
        }),
      )
    const requiredFields = ['title']
    const missingFields = normalized
      .map((chapter) => ({
        number: chapter.number,
        fields: requiredFields.filter((field) => !String(chapter[field] ?? '').trim()),
      }))
      .filter((item) => item.fields.length > 0)
    if (missingFields.length > 0) {
      const error = new Error(
        `第 ${missingFields[0].number} 章章纲缺少必填字段（${missingFields[0].fields.join('/')}），本轮未写入，请重试`,
      )
      error.code = 'NOVEL_WRITER_BAD_MODEL_OUTPUT'
      error.runId = generated.runId
      error.raw = generated.first.text
      throw error
    }
    for (const chapter of normalized) {
      if (!String(chapter.synopsis ?? '').trim()) {
        chapter.synopsis = chapter.title || `第 ${chapter.number} 章`
      }
    }
    // 缺章补齐：先整批重试 1 次，再按缺失章逐个单章补（单章输出更稳）。
    let missing = range.slice(normalized.length)
    const mergeBatch = (retryChapters) => {
      if (!Array.isArray(retryChapters) || retryChapters.length === 0) return
      const retryNormalized = retryChapters
        .slice(0, range.length)
        .map((raw, index) =>
          this.normalizeOutlineChapter(raw, range[index], {
            wordBudget,
            inputs: { ...inputs, ...contextHashes },
          }),
        )
      for (const candidate of retryNormalized) {
        const number = Number(candidate.number)
        if (!missing.includes(number)) continue
        if (normalized.some((item) => Number(item.number) === number)) continue
        if (!String(candidate.synopsis ?? '').trim()) {
          candidate.synopsis = candidate.title || `第 ${number} 章`
        }
        normalized.push(candidate)
        missing = missing.filter((value) => Number(value) !== number)
      }
      normalized.sort((a, b) => Number(a.number) - Number(b.number))
    }
    if (missing.length > 0) {
      const retry = await this.callJsonModel(agent, {
        kind: 'outline.generate.retry',
        task: 'outline',
        system,
        messages,
        signal,
        maxTokens: 256000,
        temperature: 0.6,
      }).catch(() => null)
      mergeBatch(Array.isArray(retry?.parsed) ? retry.parsed : retry?.parsed?.chapters)
    }
    for (let attempt = 0; missing.length > 0 && attempt < 8; attempt += 1) {
      const number = missing[0]
      const singleText = buildOutlineUserPrompt({
        title: project.title,
        language: project.language ?? 'zh',
        premise: inputs.chosen,
        styleFields: inputs.styleFields ?? {},
        bible: {
          characters: bible.characters.slice(0, 20),
          rules: bible.rules.slice(0, 10),
          locations: bible.locations.slice(0, 10),
        },
        power: {
          system: power.system,
          characters: power.characters,
          recentChanges: Object.entries(power.chapterChanges)
            .filter(([chapterNumber]) => Number(chapterNumber) < number)
            .sort(([a], [b]) => Number(a) - Number(b))
            .slice(-4)
            .map(([chapterNumber, changes]) => ({ chapter: Number(chapterNumber), changes })),
        },
        fromChapter: number,
        toChapter: number,
        totalChapters,
        wordBudget,
        contextChapters,
        instruction: options.instruction,
        writingNotes: this.writingNotesFor(project, 'outline'),
        regenerate: false,
      })
      const single = await this.callJsonModel(agent, {
        kind: 'outline.generate.retry',
        task: 'outline',
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: singleText }] }],
        signal,
        maxTokens: 256000,
        temperature: 0.6,
      }).catch(() => null)
      const singleChapters = Array.isArray(single?.parsed) ? single.parsed : single?.parsed?.chapters
      if (!Array.isArray(singleChapters) || singleChapters.length === 0) continue
      const candidate = this.normalizeOutlineChapter(singleChapters[0], number, {
        wordBudget,
        inputs: { ...inputs, ...contextHashes },
      })
      if (!String(candidate.synopsis ?? '').trim()) {
        candidate.synopsis = candidate.title || `第 ${number} 章`
      }
      if (normalized.some((item) => Number(item.number) === Number(number))) {
        missing = missing.filter((value) => Number(value) !== Number(number))
        continue
      }
      normalized.push(candidate)
      missing = missing.filter((value) => Number(value) !== Number(number))
      normalized.sort((a, b) => Number(a.number) - Number(b.number))
    }
    const partial = normalized.length < range.length
    const missingChapters = range.filter((number) => !normalized.some((item) => Number(item.number) === Number(number)))
    const missingList = missingChapters
    const actualTo = fromChapter + normalized.length - 1
    const merged = existing.filter((chapter) => !inRange(chapter))
    merged.push(...normalized)
    merged.sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0))

    const runId = generated.runId
    const updatedAt = now()
    // 自动分卷：只有模型标记“阶段收束章”（volumeEnd: true）才开启下一卷；章数只作参考，不强制分卷。
    const targetChapters = Math.max(3, Number(options.targetChapters ?? project.automation?.volumeChapters ?? 10) || 10)
    const volumeEnded = normalized.some((chapter) => chapter.volumeEnd === true)
    let nextVolumeId = null
    const autoNext = options.autoNextVolume !== false && project.automation?.autoNextVolume !== false
    if (autoNext && volumeEnded) {
      const maxVol = volumes.reduce((max, item) => {
        const number = Number(String(item.id ?? '').replace(/\D+/g, '')) || 0
        return Math.max(max, number)
      }, 0)
      const already = volumes.some((item) => item.id === `vol-${maxVol + 1}`)
      if (!already) {
        const nextVolume = {
          id: `vol-${maxVol + 1}`,
          title: `第 ${maxVol + 1} 卷`,
          goal: '',
          map: '',
          targetChapters,
          chapters: [],
        }
        volumes.push(nextVolume)
        nextVolumeId = nextVolume.id
      }
    }
    const next = {
      ...outline,
      status: 'candidate',
      logline: outline.logline || inputs.chosen.premise || null,
      volumes: volumes.map((item) => item.id === volume.id ? { ...volume, chapters: merged } : item),
      updatedAt,
      lastRunId: runId,
    }
    await this.writeJson(agent, 'story/plot/outline.json', next)

    if (options.deferAudit === true) {
      return {
        runId,
        fromChapter,
        toChapter: actualTo,
        requestedToChapter: toChapter,
        chapters: normalized,
        usage: generated.usage,
        durationMs: generated.first.durationMs,
        audit: null,
        repaired: [],
        rolledBack: false,
        deferred: true,
        partial,
        missing: missingList,
        volumeId: volume.id,
        nextVolumeId,
        volumeEnded,
      }
    }

    // 大纲文本量小：生成/重生成后自动审查；默认自动修复，但修复后重审，问题数没有减少就回滚。
    const audit = await this.auditOutline(agent, { fromChapter, toChapter: actualTo }, signal).catch(() => null)
    const projectNow = await this.readJson(agent, this.marker).catch(() => null)
    const autoRepair = projectNow?.automation?.autoRepairOutline !== false
    let finalAudit = audit
    let repair = null
    let rolledBack = false
    if (autoRepair && audit?.issues?.length) {
      const before = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
      repair = await this.repairOutlineIssues(agent, { issues: audit.issues, instruction: options.instruction }, signal).catch(() => null)
      if (repair?.repaired?.length) {
        const audit2 = await this.auditOutline(agent, { fromChapter, toChapter: actualTo }, signal).catch(() => null)
        if (audit2 && audit2.issues.length < audit.issues.length) {
          finalAudit = audit2
        } else {
          if (before) await this.writeJson(agent, 'story/plot/outline.json', before).catch(() => {})
          repair = { repaired: [] }
          rolledBack = true
        }
      }
    }
    const repaired = repair?.repaired ?? []
    await this.writeJson(agent, 'story/plot/outline-audit.json', {
      ...(finalAudit ?? {}),
      repaired,
      ...(rolledBack ? { rolledBack: true } : {}),
      updatedAt: now(),
    }).catch(() => {})

    return {
      runId,
      fromChapter,
      toChapter: actualTo,
      requestedToChapter: toChapter,
      chapters: normalized,
      usage: generated.usage,
      durationMs: generated.first.durationMs,
      audit: finalAudit,
      repaired,
      rolledBack,
      partial,
      missing: missingList,
      volumeId: volume.id,
      nextVolumeId,
      volumeEnded,
    }
  }

  async planVolume(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
    const volumeId = String(options.volumeId ?? '')
    const index = volumes.findIndex((item) => item.id === volumeId)
    if (index < 0) throw new Error('找不到要规划的分卷')
    const volume = volumes[index]
    const previousVolume = index > 0 ? volumes[index - 1] : null
    const previousChapters = (previousVolume?.chapters ?? []).slice().sort((a, b) => Number(a.number) - Number(b.number))
    const premise = await this.readJson(agent, 'story/premise.json').catch(() => null)
    const style = await this.readJson(agent, 'story/style/contract.json').catch(() => null)
    const project = await this.readJson(agent, this.marker)
    const system = await this.systemFor(agent, 'volumePlan', VOLUME_PLAN_SYSTEM_PROMPT)
    const userText = buildVolumePlanUserPrompt({
      title: project.title,
      language: project.language ?? 'zh',
      premise: premise?.chosen ?? {},
      styleFields: style?.fields ?? {},
      volume,
      previousVolume: previousVolume ? {
        ...previousVolume,
        lastChapter: previousChapters[previousChapters.length - 1] ?? null,
      } : null,
      chapters: volume.chapters ?? [],
      instruction: options.instruction,
    })
    const generated = await this.callJsonModel(agent, {
      kind: 'outline.volume-plan',
      task: 'outline',
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      signal,
      maxTokens: 4000,
      temperature: 0.35,
      inputHash: this.hashInputs({ volumeId, chapters: (volume.chapters ?? []).map((chapter) => chapter.number) }),
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const nextVolume = {
      ...volume,
      title: String(parsed.title ?? '').trim() || volume.title || `第 ${index + 1} 卷`,
      map: String(parsed.map ?? '').trim() || volume.map || '',
      goal: String(parsed.goal ?? '').trim() || volume.goal || '',
      powerCeiling: String(parsed.powerCeiling ?? '').trim() || volume.powerCeiling || '',
      exitCriteria: String(parsed.exitCriteria ?? '').trim() || volume.exitCriteria || '',
      targetChapters: clamp(Number(parsed.targetChapters ?? volume.targetChapters ?? 12) || 12, 1, 100),
    }
    if (!nextVolume.map) throw new Error('模型没有返回可用的本卷地图')
    volumes[index] = nextVolume
    await this.writeJson(agent, 'story/plot/outline.json', {
      ...outline,
      volumes,
      updatedAt: now(),
    })
    return { volume: nextVolume, runId: generated.runId }
  }

  async reverseOutline(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const project = await this.readJson(agent, this.marker)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
    const chapters = volumes.flatMap((volume) => volume.chapters ?? [])
      .filter((chapter) => Number.isFinite(Number(chapter.number)))
      .sort((a, b) => Number(a.number) - Number(b.number))
    const fromChapter = clamp(Number(options.fromChapter ?? 1) || 1, 1, 999)
    const toChapter = clamp(Number(options.toChapter ?? chapters.length) || chapters.length, fromChapter, 999)
    const selected = chapters.filter((chapter) => Number(chapter.number) >= fromChapter && Number(chapter.number) <= toChapter)
    if (selected.length === 0) throw new Error('没有可反推的章节')
    const system = await this.systemFor(agent, 'reverseOutline', REVERSE_OUTLINE_SYSTEM_PROMPT)
    const updates = new Map()
    for (let offset = 0; offset < selected.length; offset += 4) {
      const batch = selected.slice(offset, offset + 4)
      const input = []
      for (const chapter of batch) {
        const paths = this.chapterPaths(chapter.number)
        const text = (await this.readText(agent, paths.final).catch(() => null)) ??
          (await this.readText(agent, paths.draft).catch(() => null)) ??
          ''
        if (text.trim()) input.push({ number: chapter.number, title: chapter.title, text })
      }
      if (input.length === 0) continue
      this.reportStage('generating', `反推第 ${input[0].number}–${input[input.length - 1].number} 章`)
      const generated = await this.callJsonModel(agent, {
        kind: 'outline.reverse',
        task: 'outline',
        system,
        messages: [{
          role: 'user',
          content: [{
            type: 'text',
            text: buildReverseOutlineUserPrompt({
              title: project.title,
              language: project.language ?? 'zh',
              fromChapter: input[0].number,
              toChapter: input[input.length - 1].number,
              chapters: input,
            }),
          }],
        }],
        signal,
        maxTokens: Math.max(1600, input.length * 1400),
        temperature: 0.2,
        inputHash: this.hashInputs({ from: input[0].number, to: input[input.length - 1].number }),
      })
      for (const item of generated.parsed?.chapters ?? []) {
        const number = Number(item.number)
        const synopsis = String(item.synopsis ?? '').trim()
        if (Number.isFinite(number) && synopsis) updates.set(number, synopsis)
      }
    }
    if (updates.size === 0) throw new Error('模型没有返回可用的 synopsis')
    let updated = 0
    for (const volume of volumes) {
      for (const chapter of volume.chapters ?? []) {
        const synopsis = updates.get(Number(chapter.number))
        if (!synopsis) continue
        chapter.synopsis = synopsis
        chapter.status = 'candidate'
        updated += 1
      }
    }
    const next = { ...outline, status: 'candidate', volumes, updatedAt: now() }
    await this.writeJson(agent, 'story/plot/outline.json', next)
    return { updated, fromChapter, toChapter }
  }

  async outlineCommit(agent, options = {}) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    if (chapters.length === 0) throw new Error('还没有章纲可供确认')
    const fromChapter = Number(options.fromChapter ?? 1)
    const rawTo = options.toChapter === undefined ? Number.MAX_SAFE_INTEGER : Number(options.toChapter)
    let confirmed = 0
    for (const chapter of chapters) {
      const number = Number(chapter.number) || 0
      if (number >= fromChapter && number <= rawTo) {
        chapter.status = 'confirmed'
        chapter.confirmedAt = now()
        confirmed += 1
      }
    }
    const allConfirmed = chapters.every((chapter) => chapter.status === 'confirmed')
    const next = {
      ...outline,
      status: allConfirmed ? 'confirmed' : 'candidate',
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/plot/outline.json', next)
    return {
      confirmed,
      total: chapters.length,
      status: next.status,
      fromChapter,
      toChapter: rawTo === Number.MAX_SAFE_INTEGER ? null : rawTo,
    }
  }

  async updateProject(agent, fields = {}) {
    await this.assertInitialized(agent)
    const project = await this.readJson(agent, this.marker)
    const next = { ...project }
    if (fields.title !== undefined) next.title = String(fields.title)
    if (fields.language !== undefined) next.language = String(fields.language)
    if (fields.autoFix !== undefined) next.autoFix = Boolean(fields.autoFix)
    if (fields.automation && typeof fields.automation === 'object') {
      next.automation = { ...(project.automation ?? {}), ...fields.automation }
      if (fields.automation.autoFix !== undefined) next.autoFix = Boolean(fields.automation.autoFix)
    }
    if (fields.models && typeof fields.models === 'object') {
      next.models = fields.models
    }
    if (fields.context && typeof fields.context === 'object') {
      next.context = { ...(project.context ?? {}), ...fields.context }
    }
    if (fields.writingNotes !== undefined) next.writingNotes = String(fields.writingNotes).slice(0, 4000)
    if (Array.isArray(fields.writingNotesTasks)) {
      next.writingNotesTasks = fields.writingNotesTasks.filter((item) => ['bible', 'outline', 'draft', 'revise'].includes(item))
    }
    next.updatedAt = now()
    await this.writeJson(agent, this.marker, next)
    return next
  }

  writingNotesFor(project, stage) {
    const notes = String(project?.writingNotes ?? '').trim()
    if (!notes) return ''
    const tasks = Array.isArray(project?.writingNotesTasks) ? project.writingNotesTasks : []
    return tasks.length === 0 || tasks.includes(stage) ? notes : ''
  }

  automationConfig(project) {
    const auto = project?.automation ?? {}
    return {
      autoAudit: Boolean(auto.autoAudit ?? project?.autoFix ?? false),
      autoRepairOutline: Boolean(auto.autoRepairOutline ?? true),
      autoFix: Boolean(auto.autoFix ?? project?.autoFix ?? false),
      fixRounds: clamp(Number(auto.fixRounds ?? 2) || 2, 1, 3),
      stylePassScore: clamp(Number(auto.stylePassScore ?? 60) || 60, 0, 100),
      batchCount: clamp(Number(auto.batchCount ?? 3) || 3, 1, 5),
      targetWords: Math.max(0, Number(auto.targetWords ?? 0) || 0),
    }
  }

  async updateOutlineChapter(agent, options = {}) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const target = chapters.find(
      (chapter) =>
        (options.chapterId && chapter.id === options.chapterId) ||
        (options.number !== undefined && Number(chapter.number) === Number(options.number)),
    )
    if (!target) throw new Error(`找不到章纲节点：${options.chapterId ?? options.number}`)

    const fields = options.fields ?? {}
    if (fields.title !== undefined) target.title = String(fields.title)
    if (fields.synopsis !== undefined) target.synopsis = String(fields.synopsis)
    if (fields.wordBudget !== undefined) {
      target.wordBudget = Number(fields.wordBudget) || target.wordBudget || 3000
    }
    target.status = 'candidate'
    target.editedAt = now()
    outline.status = 'candidate'
    outline.updatedAt = now()
    await this.writeJson(agent, 'story/plot/outline.json', outline)
    return target
  }

  async createOutlineVolume(agent, options = {}) {
    await this.assertInitialized(agent)
    const outline = (await this.readJson(agent, 'story/plot/outline.json').catch(() => null)) ?? {
      status: 'candidate',
      logline: null,
      volumes: [],
      updatedAt: null,
    }
    outline.volumes = Array.isArray(outline.volumes) ? outline.volumes : []
    const max = outline.volumes.reduce((value, volume) => {
      const number = Number(String(volume.id ?? '').replace(/\D+/g, '')) || 0
      return Math.max(value, number)
    }, 0)
    const volume = {
      id: `vol-${max + 1}`,
      title: String(options.title ?? `第 ${max + 1} 卷`).trim() || `第 ${max + 1} 卷`,
      goal: String(options.goal ?? ''),
      map: String(options.map ?? ''),
      powerCeiling: String(options.powerCeiling ?? ''),
      exitCriteria: String(options.exitCriteria ?? ''),
      chapters: [],
    }
    outline.volumes.push(volume)
    outline.updatedAt = now()
    await this.writeJson(agent, 'story/plot/outline.json', outline)
    return volume
  }

  async updateOutlineVolume(agent, options = {}) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const volume = (outline?.volumes ?? []).find((item) => item.id === options.volumeId)
    if (!volume) throw new Error('找不到卷')
    if (options.title !== undefined) volume.title = String(options.title)
    if (options.goal !== undefined) volume.goal = String(options.goal)
    if (options.map !== undefined) volume.map = String(options.map)
    if (options.powerCeiling !== undefined) volume.powerCeiling = String(options.powerCeiling)
    if (options.exitCriteria !== undefined) volume.exitCriteria = String(options.exitCriteria)
    outline.updatedAt = now()
    await this.writeJson(agent, 'story/plot/outline.json', outline)
    return volume
  }

  async deleteOutlineVolume(agent, options = {}) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const volume = (outline?.volumes ?? []).find((item) => item.id === options.volumeId)
    if (!volume) throw new Error('找不到卷')
    if ((volume.chapters ?? []).length > 0) throw new Error('卷内还有章节，先把章节移到其他卷再删除')
    outline.volumes = (outline.volumes ?? []).filter((item) => item.id !== options.volumeId)
    if (outline.volumes.length === 0) {
      outline.volumes = [{ id: 'vol-1', title: '第一卷', goal: '', chapters: [] }]
    }
    outline.updatedAt = now()
    await this.writeJson(agent, 'story/plot/outline.json', outline)
    return { deleted: options.volumeId }
  }

  async moveOutlineChapter(agent, options = {}) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const volumes = outline?.volumes ?? []
    const target = volumes.find((volume) => volume.id === options.volumeId)
    if (!target) throw new Error('找不到目标卷')
    let moved = null
    for (const volume of volumes) {
      const index = (volume.chapters ?? []).findIndex((chapter) => Number(chapter.number) === Number(options.number))
      if (index < 0) continue
      const [chapter] = volume.chapters.splice(index, 1)
      chapter.volumeId = target.id
      target.chapters = [...(target.chapters ?? []), chapter].sort((a, b) => Number(a.number) - Number(b.number))
      moved = chapter
      break
    }
    if (!moved) throw new Error(`找不到第 ${options.number} 章章纲`)
    outline.updatedAt = now()
    await this.writeJson(agent, 'story/plot/outline.json', outline)
    return moved
  }

  /* ------------------------------ P0：章节 ------------------------------ */

  chapterPaths(number) {
    const pad = String(Number(number)).padStart(3, '0')
    const dir = `story/chapters/${pad}`
    return {
      number: Number(number),
      pad,
      dir,
      meta: `${dir}/meta.json`,
      draft: `${dir}/draft.md`,
      final: `${dir}/final.md`,
      qa: `${dir}/qa.json`,
      styleQa: `${dir}/style-qa.json`,
      continuity: `${dir}/continuity.json`,
      revisions: `${dir}/revisions`,
    }
  }

  async clearRevisions(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const keep = Math.max(1, Math.min(20, Number(options.keep) || 5))
    const paths = this.chapterPaths(number)
    const cwd = await this.cwd(agent)
    const target = await this.ctx.fs.resolve(paths.revisions, { cwd })
    let entries = []
    try {
      entries = await this.ctx.fs.listDir(target)
    } catch {
      return { removed: 0, kept: 0 }
    }
    const names = entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.name)
      .sort()
      .reverse()
    const remove = names.slice(keep)
    if (options.dryRun) {
      return { total: names.length, remove: remove.length, kept: Math.min(keep, names.length), dryRun: true }
    }
    let removed = 0
    for (const name of remove) {
      const fileTarget = await this.ctx.fs.resolve(`${paths.revisions}/${name}`, { cwd })
      const hostPath = this.ctx.fs.processPath?.(fileTarget)
      if (!hostPath) continue
      try {
        await unlink(hostPath)
        removed += 1
      } catch {
        // ignore unlink failures
      }
    }
    return { removed, kept: names.length - removed }
  }

  async findOrphans(agent) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const known = new Set(chapters.map((chapter) => String(Number(chapter.number)).padStart(3, '0')))
    const cwd = await this.cwd(agent)
    const chapterDirs = []
    try {
      const entries = await this.ctx.fs.listDir(await this.ctx.fs.resolve('story/chapters', { cwd }))
      for (const entry of entries) {
        if (entry.type !== 'dir' || !/^\d{3}$/.test(entry.name)) continue
        if (!known.has(entry.name)) chapterDirs.push(entry.name)
      }
    } catch {
      // chapters directory missing
    }
    const stateFiles = []
    try {
      const entries = await this.ctx.fs.listDir(await this.ctx.fs.resolve('story/state', { cwd }))
      for (const entry of entries) {
        if (entry.type !== 'file' || !/^\d{3}\.json$/.test(entry.name)) continue
        if (!known.has(entry.name.slice(0, 3))) stateFiles.push(entry.name)
      }
    } catch {
      // state directory missing
    }
    chapterDirs.sort()
    stateFiles.sort()
    return { chapterDirs, stateFiles }
  }

  async cleanOrphans(agent) {
    const { chapterDirs, stateFiles } = await this.findOrphans(agent)
    const cwd = await this.cwd(agent)
    let removedDirs = 0
    for (const name of chapterDirs) {
      const target = await this.ctx.fs.resolve(`story/chapters/${name}`, { cwd })
      const hostPath = this.ctx.fs.processPath?.(target)
      if (!hostPath) continue
      try {
        await rm(hostPath, { recursive: true, force: true })
        removedDirs += 1
      } catch {
        // ignore
      }
    }
    let removedFiles = 0
    for (const name of stateFiles) {
      const target = await this.ctx.fs.resolve(`story/state/${name}`, { cwd })
      const hostPath = this.ctx.fs.processPath?.(target)
      if (!hostPath) continue
      try {
        await unlink(hostPath)
        removedFiles += 1
      } catch {
        // ignore
      }
    }
    return { removedDirs, removedFiles, chapterDirs, stateFiles }
  }

  async clearChapterInstruction(agent, number) {
    const paths = this.chapterPaths(number)
    try {
      const cwd = await this.cwd(agent)
      const target = await this.ctx.fs.resolve(paths.instruction, { cwd })
      const hostPath = this.ctx.fs.processPath?.(target)
      if (hostPath) await unlink(hostPath)
    } catch {
      // no pending instruction
    }
  }

  /** 相对路径 → 宿主路径（虚拟 fs 无 processPath 时用 join 兜底；失败返回 null）。 */
  async resolveHostPath(relativePath, cwd) {
    try {
      const target = await this.ctx.fs.resolve(relativePath, { cwd })
      return this.ctx.fs.processPath?.(target) ?? join(target?.cwd ?? cwd, target?.relativePath ?? relativePath)
    } catch {
      return null
    }
  }

  /**
   * 删除尾部连续章节。文件删除先做（失败即报错，DB 未动→现场保留），
   * DB 的删行/大纲落库/状态时间戳在同一个事务里提交。
   */
  async deleteTailChapters(agent, options = {}) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const volumes = outline?.volumes ?? []
    const chapters = volumes.flatMap((volume) => volume.chapters ?? [])
    const numbers = chapters.map((chapter) => Number(chapter.number)).sort((a, b) => a - b)
    if (numbers.length === 0) throw new Error('还没有章节可删除')
    const count = Math.max(1, Math.min(50, Number(options.count) || 0))
    if (!count) throw new Error('请指定要删除的章节数')
    if (count >= numbers.length) throw new Error(`不能删除全部章节（当前共 ${numbers.length} 章）`)
    const tail = numbers.slice(numbers.length - count)
    for (let index = 1; index < tail.length; index += 1) {
      if (tail[index] !== tail[index - 1] + 1) throw new Error('只能删除尾部连续的章节')
    }
    const last = numbers[numbers.length - 1]
    const to = tail[tail.length - 1]
    if (to !== last) throw new Error('只能从最后一章往前删除')
    const from = tail[0]
    const preview = { from, to, numbers: tail, count: tail.length }
    if (options.dryRun) return { ...preview, dryRun: true }
    const snapshot = options.snapshot === false ? null : await this.createProjectSnapshot(agent)
    const cwd = await this.cwd(agent)
    const removed = []
    await this.withWatchSuspended(cwd, async () => {
      for (const number of tail) {
        const paths = this.chapterPaths(number)
        const dirHost = await this.resolveHostPath(paths.dir, cwd)
        if (dirHost) {
          try {
            await rm(dirHost, { recursive: true, force: true })
          } catch (error) {
            throw new Error(`删除第 ${number} 章目录失败：${errorText(error)}`)
          }
          removed.push(paths.dir)
        }
        const stateHost = await this.resolveHostPath(`story/state/${paths.pad}.json`, cwd)
        if (stateHost) {
          try {
            await unlink(stateHost)
            removed.push(`story/state/${paths.pad}.json`)
          } catch (error) {
            if (error?.code !== 'ENOENT') throw new Error(`删除第 ${number} 章状态文件失败：${errorText(error)}`)
          }
        }
      }
    })
    const tailSet = new Set(tail)
    for (const volume of volumes) {
      volume.chapters = (volume.chapters ?? []).filter((chapter) => !tailSet.has(Number(chapter.number)))
    }
    outline.updatedAt = now()
    const store = await this.storeFor(agent)
    // DB 一个事务：删行 + 大纲落库 + 状态时间戳一起提交。
    store.tx(() => {
      if (this.failHook) this.failHook('delete-tail')
      for (const number of tail) store.deleteChapterRows(number)
      store.writeOutline(outline)
      // 大纲删除后同步 FTS（与 DB 同事务，失败一起回滚）。
      store.reindexOutline()
      store.writeStateMeta(now())
    })
    store.checkpoint()
    return { ...preview, removed, snapshot }
  }

  /**
   * 删除单章正文产物（草稿/定稿/质检/修订/状态/摘要），保留章纲，便于重新生成。
   * 用于清理生成失败或写错的章节；删除前自动创建项目快照。
   */
  /** 把一章的正文目录与状态文件从 fromNumber 移到 toNumber（删除中间章后的章号重排）。 */
  async moveChapterArtifacts(agent, fromNumber, toNumber, cwd, options = {}) {
    const strict = options.strict === true
    const writeMeta = options.writeMeta !== false
    const from = this.chapterPaths(fromNumber)
    const to = this.chapterPaths(toNumber)
    const resolveHost = async (relative) => {
      const target = await this.ctx.fs.resolve(relative, { cwd })
      return { target, host: this.ctx.fs.processPath?.(target) ?? null }
    }
    const movePath = async (fromRelative, toRelative) => {
      const fromResolved = await resolveHost(fromRelative)
      if (!fromResolved.host) return false
      const fromInfo = await fsStat(fromResolved.host).catch(() => null)
      if (!fromInfo) return false
      const toResolved = await resolveHost(toRelative)
      if (!toResolved.host) return false
      const exists = await this.ctx.fs.stat(toResolved.target).catch(() => null)
      if (exists) {
        if (strict) throw new Error(`重命名目标已存在：${toRelative}`)
        return false
      }
      try {
        await rename(fromResolved.host, toResolved.host)
      } catch (error) {
        if (strict) throw new Error(`重命名 ${fromRelative} → ${toRelative} 失败：${errorText(error)}`)
        return false
      }
      return true
    }
    const movedDir = await movePath(from.dir, to.dir)
    if (movedDir && writeMeta) {
      const meta = await this.readJson(agent, to.meta).catch(() => null)
      if (meta && typeof meta === 'object') {
        meta.number = toNumber
        await this.writeJson(agent, to.meta, meta).catch(() => {})
      }
    }
    const movedState = await movePath(`story/state/${from.pad}.json`, `story/state/${to.pad}.json`)
    if (movedState && writeMeta) {
      const state = await this.readJson(agent, `story/state/${to.pad}.json`).catch(() => null)
      if (state && typeof state === 'object') {
        state.number = toNumber
        await this.writeJson(agent, `story/state/${to.pad}.json`, state).catch(() => {})
      }
    }
    return { movedDir, movedState }
  }

  /**
   * 删除单章（可选删除章纲并重排后续章号）。
   * 顺序：文件操作（删除/改名，失败即报错，DB 未动→现场保留）→ DB 单事务（删行/行迁移/大纲/状态/力量体系）。
   */
  async deleteChapter(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    if (!Number.isFinite(number) || number < 1) throw new Error('请指定要删除的章号')
    const { chapter } = await this.findOutlineChapter(agent, number)
    const paths = this.chapterPaths(number)
    const cwd = await this.cwd(agent)
    const exists = async (relative) => {
      try {
        const target = await this.ctx.fs.resolve(relative, { cwd })
        return Boolean(await this.ctx.fs.stat(target))
      } catch {
        return false
      }
    }
    const hasDir = await exists(paths.dir)
    const hasState = await exists(`story/state/${paths.pad}.json`)
    if (!chapter && !hasDir && !hasState) throw new Error(`第 ${number} 章不存在`)
    const preview = {
      number,
      title: chapter?.title ?? null,
      hasOutline: Boolean(chapter),
      hasDir,
      hasState,
    }
    if (options.dryRun) return { ...preview, dryRun: true }
    const snapshot = options.snapshot === false ? null : await this.createProjectSnapshot(agent)
    const removed = []
    // 1) 删除目标章的文件产物：失败直接抛错（DB 未动，现场保留）。
    await this.withWatchSuspended(cwd, async () => {
      if (hasDir) {
        const dirHost = await this.resolveHostPath(paths.dir, cwd)
        if (dirHost) {
          try {
            await rm(dirHost, { recursive: true, force: true })
          } catch (error) {
            throw new Error(`删除第 ${number} 章目录失败：${errorText(error)}`)
          }
          removed.push(paths.dir)
        }
      }
      if (hasState) {
        const stateHost = await this.resolveHostPath(`story/state/${paths.pad}.json`, cwd)
        if (stateHost) {
          try {
            await unlink(stateHost)
            removed.push(`story/state/${paths.pad}.json`)
          } catch (error) {
            if (error?.code !== 'ENOENT') throw new Error(`删除第 ${number} 章状态文件失败：${errorText(error)}`)
          }
        }
      }
    })
    const store = await this.storeFor(agent)
    let outlineRemoved = false
    let renumbered = false
    let outline = null
    let maxNumberBefore = 0
    let power = null
    if (options.removeOutline && chapter) {
      outline = await this.readJson(agent, 'story/plot/outline.json')
      const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
      const allBefore = volumes.flatMap((volume) => volume.chapters ?? [])
      maxNumberBefore = allBefore.reduce((max, item) => Math.max(max, Number(item.number) || 0), 0)
      for (const volume of volumes) {
        volume.chapters = (volume.chapters ?? []).filter((item) => Number(item.number) !== number)
      }
      outlineRemoved = true
      if (options.renumber !== false) {
        for (const volume of volumes) {
          for (const item of volume.chapters ?? []) {
            const current = Number(item.number) || 0
            if (current > number) item.number = current - 1
          }
        }
        renumbered = true
        power = await this.readJson(agent, 'story/power.json').catch(() => null)
      }
      outline.updatedAt = now()
      // 2) 后续章产物前移：strict 模式，失败即报错（DB 尚未提交）。
      if (renumbered) {
        await this.withWatchSuspended(cwd, async () => {
          for (let current = number + 1; current <= maxNumberBefore; current += 1) {
            await this.moveChapterArtifacts(agent, current, current - 1, cwd, { strict: true, writeMeta: false })
          }
        })
      }
    }
    // 3) DB：一个事务内完成删行/行迁移/大纲/状态/力量体系，抛错自动回滚。
    store.tx(() => {
      if (this.failHook) this.failHook('delete-chapter')
      store.deleteChapterRows(number)
      store.deleteOutlineChapter(number)
      if (outline) {
        if (renumbered) {
          for (let current = number + 1; current <= maxNumberBefore; current += 1) {
            store.renameChapterRows(current, current - 1)
          }
          if (power && power.chapterChanges && typeof power.chapterChanges === 'object') {
            const next = {}
            for (const [key, value] of Object.entries(power.chapterChanges)) {
              const current = Number(key)
              if (Number.isFinite(current) && current > number) {
                if (current - 1 >= 1) next[String(current - 1)] = value
              } else {
                next[key] = value
              }
            }
            power.chapterChanges = next
            store.writePower(power)
          }
        }
        store.writeOutline(outline)
        // 大纲删除/重排后同步 FTS（与 DB 行同事务，失败一起回滚）。
        store.reindexOutline()
      }
      store.writeStateMeta(now())
    })
    store.checkpoint()
    return {
      ...preview,
      removed,
      snapshot,
      outlineKept: Boolean(chapter) && !outlineRemoved,
      outlineRemoved,
      renumbered,
    }
  }

  async findOutlineChapter(agent, number) {
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const chapter = chapters.find((item) => Number(item.number) === Number(number))
    return { outline, chapter }
  }

  async previousChapterTail(agent, number) {
    if (Number(number) <= 1) return ''
    const previous = this.chapterPaths(Number(number) - 1)
    const text =
      (await this.readText(agent, previous.final).catch(() => null)) ??
      (await this.readText(agent, previous.draft).catch(() => null)) ??
      ''
    return text.trim().slice(-700)
  }

  normalizeChapterMeta(raw = {}, number = 0) {
    const source = raw && typeof raw === 'object' ? raw : {}
    return {
      ...source,
      number: Number(source.number ?? number) || Number(number) || 0,
      wordCount: Number(source.wordCount) || 0,
      status: String(source.status ?? ''),
      finalStale: Boolean(source.finalStale),
      updatedAt: source.updatedAt ?? null,
    }
  }

  async chapterDetail(agent, number) {
    await this.assertInitialized(agent)
    const { chapter } = await this.findOutlineChapter(agent, number)
    if (!chapter) throw new Error(`找不到第 ${number} 章章纲`)
    const paths = this.chapterPaths(number)
    const meta = this.normalizeChapterMeta(await this.readJson(agent, paths.meta).catch(() => null), number)
    const draft = await this.readText(agent, paths.draft).catch(() => null)
    const final = await this.readText(agent, paths.final).catch(() => null)
    const qa = await this.readJson(agent, paths.qa).catch(() => null)
    const styleQa = await this.readJson(agent, paths.styleQa).catch(() => null)
    const continuity = await this.readJson(agent, paths.continuity).catch(() => null)
    const summary = await this.readChapterSummary(agent, number)
    let revisions = []
    try {
      const cwd = await this.cwd(agent)
      const target = await this.ctx.fs.resolve(paths.revisions, { cwd })
      const entries = await this.ctx.fs.listDir(target)
      revisions = entries
        .filter((entry) => entry.type === 'file')
        .map((entry) => entry.name)
        .sort()
        .reverse()
        .slice(0, 12)
    } catch {
      revisions = []
    }
    const outlineStamp = Date.parse(chapter.editedAt ?? chapter.updatedAt ?? chapter.generatedAt ?? '')
    const draftStamp = Date.parse(meta?.draftedAt ?? meta?.updatedAt ?? '')
    const outlineChanged = Boolean(
      (meta?.outlineHash && meta.outlineHash !== this.hashInputs(chapter)) ||
      (Number.isFinite(outlineStamp) && Number.isFinite(draftStamp) && outlineStamp > draftStamp),
    )
    return {
      number: Number(number),
      chapter,
      meta,
      outlineChanged,
      draft,
      final,
      hasDraft: Boolean(draft),
      hasFinal: Boolean(final),
      qa,
      styleQa,
      continuity,
      summary,
      revisions,
      wordCount: meta?.wordCount ?? countChars(draft ?? final ?? ''),
    }
  }

  /** 章节列表分页（助手上下文预算）：只返回 limit 条，带 total/offset/truncated/nextOffset。 */
  async listChaptersPage(agent, options = {}) {
    await this.assertInitialized(agent)
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 30))
    const offset = Math.max(0, Number(options.offset) || 0)
    const volumeId = String(options.volumeId ?? '').trim()
    const status = String(options.status ?? '').trim()
    const all = await this.chaptersSummary(agent)
    let filtered = all
    if (volumeId) filtered = filtered.filter((item) => String(item.volumeId ?? '') === volumeId)
    if (status) {
      filtered = filtered.filter((item) => item.status === status || item.outlineStatus === status)
    }
    const page = filtered.slice(offset, offset + limit).map((item) => ({
      number: item.number,
      title: item.title,
      volumeId: item.volumeId,
      volumeTitle: item.volumeTitle,
      status: item.status,
      outlineStatus: item.outlineStatus,
      hasDraft: item.hasDraft,
      hasFinal: item.hasFinal,
      wordCount: item.wordCount,
      qaStatus: item.qaStatus,
      finalStale: item.finalStale,
      summary: String(item.summary ?? '').slice(0, 60),
    }))
    const truncated = offset + page.length < filtered.length
    return {
      total: filtered.length,
      offset,
      limit,
      chapters: page,
      truncated,
      nextOffset: truncated ? offset + page.length : null,
    }
  }

  /** 单章正文分块读取（助手上下文预算）：支持 range 区间 / maxChars 截断 / draft|final|both。 */
  async readChapterParts(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const detail = await this.chapterDetail(agent, number)
    const part = ['draft', 'final', 'both'].includes(options.part) ? options.part : 'both'
    const maxChars = Math.max(200, Math.min(40000, Number(options.maxChars) || 6000))
    const rawRange = options.range && typeof options.range === 'object' ? options.range : null
    const hasRange = Boolean(rawRange && Number.isFinite(Number(rawRange.start)) && Number.isFinite(Number(rawRange.end)))
    const slicePart = (text) => {
      const source = String(text ?? '')
      if (hasRange) {
        const start = Math.max(0, Math.min(source.length, Math.floor(Number(rawRange.start))))
        const end = Math.max(start, Math.min(source.length, Math.floor(Number(rawRange.end))))
        return {
          text: source.slice(start, end),
          start,
          end,
          truncated: start > 0 || end < source.length,
          nextRange: end < source.length ? { start: end, end: Math.min(source.length, end + Math.max(1, end - start)) } : null,
        }
      }
      const truncated = source.length > maxChars
      return {
        text: source.slice(0, maxChars),
        start: 0,
        end: Math.min(source.length, maxChars),
        truncated,
        nextRange: truncated ? { start: maxChars, end: Math.min(source.length, maxChars * 2) } : null,
      }
    }
    const result = {
      number,
      title: detail.chapter?.title ?? '',
      wordCount: detail.wordCount,
      hasDraft: detail.hasDraft,
      hasFinal: detail.hasFinal,
      outlineChanged: detail.outlineChanged,
      meta: detail.meta,
      qa: detail.qa,
      styleQa: detail.styleQa,
      summary: detail.summary,
      revisionCount: (detail.revisions ?? []).length,
      revisions: (detail.revisions ?? []).slice(0, 3),
    }
    if (part === 'draft' || part === 'both') result.draft = detail.draft ? slicePart(detail.draft) : null
    if (part === 'final' || part === 'both') result.final = detail.final ? slicePart(detail.final) : null
    result.truncated = Boolean(result.draft?.truncated || result.final?.truncated)
    return result
  }

  /** 单章正文片段检索（patch 前定位精确原文）：返回命中位置与前后 80 字上下文。 */
  async searchChapterText(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const query = String(options.query ?? '')
    if (!query) throw new Error('请提供要查找的片段 query')
    const limit = Math.max(1, Math.min(20, Number(options.limit) || 5))
    const target = ['draft', 'final'].includes(options.target) ? options.target : 'both'
    const detail = await this.chapterDetail(agent, number)
    const hits = []
    for (const key of target === 'both' ? ['draft', 'final'] : [target]) {
      const text = String(detail[key] ?? '')
      let index = text.indexOf(query)
      while (index >= 0 && hits.length < limit) {
        hits.push({
          target: key,
          index,
          context: text.slice(Math.max(0, index - 80), Math.min(text.length, index + query.length + 80)),
        })
        index = text.indexOf(query, index + Math.max(1, query.length))
      }
    }
    return { number, query, hits, truncated: hits.length >= limit }
  }

  async chaptersSummary(agent, snapshot = null) {
    await this.assertInitialized(agent)
    const data = snapshot ?? await this.readProjectSnapshotData(agent)
    const chapters = (data.outline?.volumes ?? []).flatMap((volume) =>
      (volume.chapters ?? []).map((chapter) => ({
        ...chapter,
        volumeId: chapter.volumeId ?? volume.id,
        volumeTitle: volume.title,
      })),
    )
    const list = []
    for (const chapter of chapters) {
      const number = Number(chapter.number)
      const meta = data.metas.get(number) ?? null
      const summary = data.sums.get(number) ?? null
      const files = data.files.get(number) ?? { hasDraft: false, hasFinal: false }
      const hasDraft = files.hasDraft
      const hasFinal = files.hasFinal
      const qaEntry = data.qaMap.get(number) ?? {}
      list.push({
        number,
        title: chapter.title || `第 ${chapter.number} 章`,
        volumeId: chapter.volumeId,
        volumeTitle: chapter.volumeTitle,
        summary: summary?.summary ?? meta?.summary ?? '',
        outlineStatus: chapter.status ?? 'candidate',
        status: meta?.status ?? (hasDraft ? 'drafted' : 'planned'),
        wordCount: meta?.wordCount ?? 0,
        hasDraft,
        hasFinal,
        qaStatus: hasDraft ? (qaEntry.qa?.status ?? null) : null,
        styleStatus: hasDraft ? (qaEntry.styleQa?.status ?? null) : null,
        styleScore: hasDraft ? (qaEntry.styleQa?.score ?? null) : null,
        finalStale: Boolean(meta?.finalStale),
      })
    }
    return list
  }

  async storyOverview(agent, snapshot = null) {
    await this.assertInitialized(agent)
    const data = snapshot ?? await this.readProjectSnapshotData(agent)
    const outline = data.outline
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const state = data.stateIndex
    const timeline = chapters.map((chapter) => ({
      number: Number(chapter.number),
      title: chapter.title ?? '',
      synopsis: chapter.synopsis ?? '',
      status: chapter.status ?? 'candidate',
    }))
    const foreshadowing = []
    for (const chapter of chapters) {
      const plants = Array.isArray(chapter.foreshadow?.plant) ? chapter.foreshadow.plant : []
      for (const text of plants) {
        foreshadowing.push({
          id: `F#${chapter.number}-${foreshadowing.length + 1}`,
          text: String(text),
          plantedAt: Number(chapter.number),
          paidAt: null,
        })
      }
      const payoffs = Array.isArray(chapter.foreshadow?.payoff) ? chapter.foreshadow.payoff : []
      for (const text of payoffs) {
        const value = String(text)
        const open = foreshadowing.find(
          (item) => !item.paidAt && (item.text === value || value.includes(item.text) || item.text.includes(value)),
        )
        if (open) open.paidAt = Number(chapter.number)
        else foreshadowing.push({ id: `F#${chapter.number}-p${foreshadowing.length + 1}`, text: value, plantedAt: null, paidAt: Number(chapter.number) })
      }
    }
    return {
      timeline,
      foreshadowing,
      openForeshadowing: foreshadowing.filter((item) => item.plantedAt && !item.paidAt),
      stateChapters: state?.chapters ?? [],
    }
  }

  async importManuscript(agent, options = {}) {
    const sourcePath = String(options.sourcePath ?? '').trim()
    if (!/^([A-Za-z]:[\\/]|\/)/.test(sourcePath)) throw new Error('请选择要导入的绝对目录')
    if (!(await this.isInitialized(agent))) {
      await this.initProject(agent, { title: basename(sourcePath) })
    }
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const existing = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    if (existing.length > 0) throw new Error('项目里已经有章节，暂不支持重复导入')
    const cwd = await this.cwd(agent)
    const dir = await this.ctx.fs.resolve(sourcePath, { cwd })
    const entries = await this.ctx.fs.listDir(dir)
    const files = entries
      .filter((entry) => entry.type === 'file' && /\.(md|txt)$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 100)
    if (files.length === 0) throw new Error('目录里没有 .md / .txt 文件')
    const chapters = []
    const states = []
    for (let index = 0; index < files.length; index += 1) {
      const number = index + 1
      const target = await this.ctx.fs.resolve(files[index].name, { cwd: sourcePath })
      const text = await this.ctx.fs.readText(target)
      const paths = this.chapterPaths(number)
      const title =
        (text.match(/^#\s+(.+)$/m)?.[1] ?? files[index].name.replace(/\.(md|txt)$/i, '')).trim()
      await this.writeTextFile(agent, paths.final, text)
      const meta = {
        chapterId: `ch-${String(number).padStart(3, '0')}`,
        number,
        title,
        status: 'approved',
        wordCount: countChars(text),
        updatedAt: now(),
        approvedAt: now(),
        imported: true,
      }
      await this.writeJson(agent, paths.meta, meta)
      chapters.push({
        id: `ch-${String(number).padStart(3, '0')}`,
        number,
        status: 'confirmed',
        title,
        synopsis: '',
        wordBudget: 3000,
        imported: true,
      })
      states.push({
        id: `ch-${String(number).padStart(3, '0')}`,
        number,
        title,
        status: 'approved',
        wordCount: meta.wordCount,
        summary: '',
        approvedAt: meta.approvedAt,
        finalPath: paths.final,
      })
      await this.writeJson(agent, `story/state/${paths.pad}.json`, {
        chapterId: `ch-${String(number).padStart(3, '0')}`,
        number,
        title,
        imported: true,
        approvedAt: meta.approvedAt,
      })
    }
    const nextOutline = {
      ...(outline ?? {}),
      status: 'confirmed',
      volumes: [{ id: 'vol-1', title: '第一卷', chapters }],
      updatedAt: now(),
    }
    await this.writeJson(agent, 'story/plot/outline.json', nextOutline)
    await this.writeJson(agent, 'story/state/index.json', { chapters: states, updatedAt: now() })
    return { imported: chapters.length, chapters: chapters.map((chapter) => ({ number: chapter.number, title: chapter.title })) }
  }

  /* ------------------------------ 数据层诊断 / 索引 / 导出 ------------------------------ */

  /** 最近运行记录（走 SQLite runs 表，不再列文件目录）。 */
  async recentRuns(agent, limit = 6) {
    const store = await this.storeFor(agent).catch(() => null)
    if (!store) return []
    return store.listRuns(limit).map((run) => ({
      runId: run.runId,
      kind: run.kind,
      number: run.number ?? null,
      createdAt: run.createdAt,
      usage: run.usage ?? null,
      parseError: run.parseError ?? null,
    }))
  }

  /** 重建全部 FTS 索引（正文读文件，其余来自 DB）；顺带全量刷新正文存在性 flags；完成后截断 WAL。 */
  async reindexProject(agent) {
    await this.assertInitialized(agent)
    const store = await this.storeFor(agent)
    const counts = await store.reindexAll()
    // 全量扫描一次正文，刷新正文存在性 flags（之后 project-state 不再扫目录）
    try {
      const cwd = await this.cwd(agent)
      const files = await this.scanChapterFilesFromDisk(cwd)
      this.proseScanCount += 1
      this.backfillProseFlags(store, files)
      this.chapterFileCache.delete(cwd)
      const project = store.readProject()
      if (!project?.proseFlagsBackfilled) store.writeProject({ ...(project ?? {}), proseFlagsBackfilled: true })
    } catch {
      // 刷新失败不影响 reindex 结果
    }
    store.checkpoint()
    return { indexed: true, ...counts }
  }

  /** 数据层状态：库体积、FTS 行数、章节数、schema 版本、是否还有旧 JSON 存档。 */
  async dataStatus(agent) {
    await this.assertInitialized(agent)
    const cwd = await this.cwd(agent)
    const store = await this.storeFor(agent)
    // 体积/旧存档判断直读本地文件系统，避免每次 stateFor 都走 ctx.fs 沙箱往返。
    const localSize = async (relativePath) => {
      try {
        const info = await fsStat(join(cwd, relativePath))
        return Number(info.size) || 0
      } catch {
        try {
          const target = await this.ctx.fs.resolve(relativePath, { cwd })
          const info = await this.ctx.fs.stat(target)
          return Number(info?.size) || 0
        } catch {
          return 0
        }
      }
    }
    const dbBytes = await localSize('story/project.db')
    const walBytes = await localSize('story/project.db-wal')
    const ftsRows = store.ftsRowCounts()
    const outline = store.readOutline()
    const chapters = (outline?.volumes ?? []).reduce((sum, volume) => sum + (volume.chapters?.length ?? 0), 0)
    let legacyFiles = false
    try {
      legacyFiles = Boolean(await fsStat(join(cwd, this.marker)))
    } catch {
      legacyFiles = false
    }
    return {
      engine: 'sqlite',
      dbBytes,
      walBytes,
      ftsRows,
      chapters,
      schemaVersion: store.schemaVersion(),
      projectSchemaVersion: this.schemaVersion,
      legacyFiles,
    }
  }

  /** 导出为纯文件项目（JSON 镜像 + 正文复制），用于可移植/备份；反向导入由 migrate 支持。 */
  async exportFileProject(agent) {
    await this.assertInitialized(agent)
    const data = await this.readProjectSnapshotData(agent)
    const store = await this.storeFor(agent)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = `exports/file-project-${stamp}`
    const cwd = await this.cwd(agent)
    const files = []
    const pushJson = async (relativePath, value) => {
      await this.writeJsonFile(agent, `${base}/${relativePath}`, value)
      files.push(`${base}/${relativePath}`)
    }
    await pushJson('story/project.json', data.project)
    await pushJson('story/premise.json', data.premise)
    await pushJson('story/style/contract.json', data.style)
    await pushJson('story/bible/index.json', data.bible)
    await pushJson('story/bible/relations.json', data.relations)
    await pushJson('story/power.json', data.power)
    await pushJson('story/plot/outline.json', data.outline)
    await pushJson('story/state/index.json', data.stateIndex)
    for (const template of store.listStyleTemplates()) {
      await pushJson(`story/style/templates/${template.id}.json`, {
        id: template.id,
        name: template.name,
        fields: template.fields,
        samples: template.samples,
        createdAt: template.createdAt ?? null,
      })
    }
    const chapters = (data.outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    for (const chapter of chapters) {
      const number = Number(chapter.number)
      const pad = String(number).padStart(3, '0')
      const dir = `story/chapters/${pad}`
      const meta = data.metas.get(number)
      if (meta) await pushJson(`${dir}/meta.json`, meta)
      const qaEntry = data.qaMap.get(number)
      if (qaEntry?.qa) await pushJson(`${dir}/qa.json`, qaEntry.qa)
      if (qaEntry?.styleQa) await pushJson(`${dir}/style-qa.json`, qaEntry.styleQa)
      if (qaEntry?.continuity) await pushJson(`${dir}/continuity.json`, qaEntry.continuity)
      const summary = data.sums.get(number)
      if (summary) await pushJson(`${dir}/summary.json`, summary)
      for (const name of ['draft.md', 'final.md']) {
        try {
          const target = await this.ctx.fs.resolve(`${dir}/${name}`, { cwd })
          if (!(await this.ctx.fs.stat(target))) continue
          const text = await this.ctx.fs.readText(target)
          await this.writeTextFile(agent, `${base}/${dir}/${name}`, text)
          files.push(`${base}/${dir}/${name}`)
        } catch {
          // 正文缺失时跳过
        }
      }
    }
    await pushJson('story/materials.json', { materials: store.listMaterials() })
    await pushJson('story/stats.json', store.readStats())
    for (const run of store.listRuns(50)) await pushJson(`.dsh-writing/runs/${run.runId}.json`, run)
    store.checkpoint()
    return { path: base, files: files.length, chapters: chapters.length }
  }

  /**
   * 纯文件项目反向导入：用导出的 file-project 目录（story/ JSON + 正文）覆盖当前项目。
   * 流程：校验源 → 备份当前 story 到 .dsh-writing/backups/import-<stamp>/ → disposeStores
   *      → 覆盖 story/ → 删旧 db/-wal/-shm → 迁移 + reindexAll。
   * 任一步失败：恢复备份并抛错（不静默半套）。
   */
  async importFileProject(agent, options = {}) {
    const sourcePath = String(options.path ?? '').trim()
    if (!/^([A-Za-z]:[\\/]|\/)/.test(sourcePath)) throw new Error('请提供要导入的纯文件项目绝对路径')
    const cwd = await this.cwd(agent)
    const sourceRoot = sourcePath.replace(/[\\/]+$/, '')
    const sourceStory = join(sourceRoot, 'story')
    const sourceProject = join(sourceStory, 'project.json')
    const sourceDb = join(sourceStory, 'project.db')
    if (!existsSync(sourceProject) && !existsSync(sourceDb)) {
      throw new Error('源目录不是可导入的纯文件项目（缺少 story/project.json）')
    }
    let chapterDirs = []
    try {
      chapterDirs = (await readdir(join(sourceStory, 'chapters'), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
    } catch {
      chapterDirs = []
    }
    if (chapterDirs.length === 0) throw new Error('源目录至少需要一个章节目录（story/chapters/<章号>/）')

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRel = `.dsh-writing/backups/import-${stamp}`
    const backupStory = join(cwd, backupRel, 'story')
    const storyPath = join(cwd, 'story')
    const hadStory = existsSync(storyPath)
    await mkdir(join(cwd, backupRel), { recursive: true })
    if (hadStory) await cp(storyPath, backupStory, { recursive: true })

    this.closeChapterWatch(cwd)
    this.disposeStores()
    try {
      if (hadStory) await rm(storyPath, { recursive: true, force: true })
      await cp(sourceStory, storyPath, { recursive: true })
      let migration = { migrated: false, counts: null }
      if (existsSync(sourceDb)) {
        // 源自带 DB：保留，直接打开即可（reindexAll 会重建 FTS）
      } else {
        for (const name of ['project.db', 'project.db-wal', 'project.db-shm']) {
          await rm(join(storyPath, name), { force: true })
        }
        migration = await migrateLegacyProject({
          projectRoot: cwd,
          fs: this.legacyFsFor(cwd),
          resolveHostPath: (relativePath) => join(cwd, relativePath),
        })
      }
      const store = await this.storeFor(agent)
      await store.reindexAll()
      store.checkpoint()
      this.chapterFileCache.delete(cwd)
      return {
        imported: true,
        path: sourceRoot,
        counts: migration.counts ?? {},
        backupPath: backupRel,
      }
    } catch (error) {
      // 恢复导入前的项目（story/ 与旧 DB 从备份重建）
      try {
        if (existsSync(storyPath)) await rm(storyPath, { recursive: true, force: true })
        if (hadStory) await cp(backupStory, storyPath, { recursive: true })
      } catch {
        // 恢复失败也继续抛出原始错误
      }
      this.disposeStores()
      throw new Error(`导入失败，已恢复导入前的项目：${errorText(error)}`)
    }
  }

  /** 写作助手只读查询（白名单 kind，不开放裸 SQL）。 */
  async queryProjectData(agent, options = {}) {
    await this.assertInitialized(agent)
    const kind = String(options.kind ?? '').trim()
    const number = Number.isFinite(Number(options.number)) && Number(options.number) > 0 ? Number(options.number) : null
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 30))
    const keyword = String(options.keyword ?? '').trim()
    const store = await this.storeFor(agent)
    const match = (text) => !keyword || String(text ?? '').includes(keyword)
    switch (kind) {
      case 'chapter': {
        if (number) {
          const detail = await this.chapterDetail(agent, number)
          return {
            kind,
            number,
            chapter: detail.chapter,
            meta: detail.meta,
            qa: detail.qa,
            styleQa: detail.styleQa,
            continuity: detail.continuity,
            summary: detail.summary,
            hasDraft: Boolean(detail.draft),
            hasFinal: Boolean(detail.final),
            wordCount: detail.wordCount,
            draftPreview: detail.draft ? String(detail.draft).slice(0, 600) : null,
          }
        }
        const outline = store.readOutline()
        const chapterLimit = Math.max(1, Math.min(200, Number(options.limit) || 30))
        const filtered = (outline?.volumes ?? [])
          .flatMap((volume) => volume.chapters ?? [])
          .filter((chapter) => match(chapter.title) || match(chapter.synopsis))
        const chapters = filtered.slice(0, chapterLimit).map((chapter) => ({
          number: chapter.number,
          id: chapter.id,
          title: chapter.title,
          status: chapter.status,
          synopsis: String(chapter.synopsis ?? '').slice(0, 200),
        }))
        return {
          kind,
          total: filtered.length,
          chapters,
          truncated: chapters.length < filtered.length,
          nextOffset: chapters.length < filtered.length ? chapters.length : null,
        }
      }
      case 'outline': {
        const outline = store.readOutline()
        const expand = options.expand === 'chapters'
        const volumeId = String(options.volumeId ?? '').trim()
        const fromNumber = Number.isFinite(Number(options.fromNumber)) ? Number(options.fromNumber) : null
        const toNumber = Number.isFinite(Number(options.toNumber)) ? Number(options.toNumber) : null
        const volumes = (outline?.volumes ?? []).map((volume) => ({
          id: volume.id,
          title: volume.title,
          goal: volume.goal,
          map: volume.map,
          chapterCount: (volume.chapters ?? []).length,
        }))
        if (!expand) {
          return {
            kind,
            status: outline?.status ?? null,
            logline: outline?.logline ?? null,
            volumes,
            expanded: false,
            hint: '默认不展开章节；需要章节明细时用 expand=chapters（可配 volumeId/fromNumber/toNumber/limit）',
          }
        }
        const chapterLimit = Math.max(1, Math.min(200, Number(options.limit) || 20))
        const collected = []
        for (const volume of outline?.volumes ?? []) {
          if (volumeId && String(volume.id) !== volumeId) continue
          for (const chapter of volume.chapters ?? []) {
            const chapterNo = Number(chapter.number)
            if (fromNumber !== null && chapterNo < fromNumber) continue
            if (toNumber !== null && chapterNo > toNumber) continue
            collected.push({
              number: chapterNo,
              id: chapter.id,
              volumeId: volume.id,
              title: chapter.title,
              status: chapter.status,
              synopsis: String(chapter.synopsis ?? '').slice(0, 160),
            })
          }
        }
        const chapters = collected.slice(0, chapterLimit)
        return {
          kind,
          status: outline?.status ?? null,
          logline: outline?.logline ?? null,
          volumes,
          expanded: true,
          chapters,
          total: collected.length,
          truncated: chapters.length < collected.length,
          nextNumber: chapters.length < collected.length ? chapters[chapters.length - 1].number + 1 : null,
        }
      }
      case 'bible': {
        const bible = store.readBible()
        const pick = (category) => (bible[category] ?? [])
          .filter((entry) => match(entry.name) || match(entry.role) || match(entry.description))
          .slice(0, limit)
        return {
          kind,
          status: bible.status,
          characters: pick('characters'),
          locations: pick('locations'),
          rules: pick('rules'),
          factions: pick('factions'),
          items: pick('items'),
        }
      }
      case 'state': {
        const states = store.listChapterStates()
        return {
          kind,
          chapters: (number ? states.filter((state) => Number(state.number) === number) : states).slice(0, limit),
        }
      }
      case 'summary': {
        const summaries = store.listChapterSummaries()
        const list = (number ? summaries.filter((item) => Number(item.number) === number) : summaries)
          .filter((item) => match(item.summary) || match((item.characters ?? []).join(' ')))
          .slice(0, limit)
        return { kind, summaries: list }
      }
      case 'stats':
        return { kind, stats: store.readStats() }
      case 'runs':
        return { kind, runs: store.listRuns(limit) }
      case 'relations': {
        const data = await this.readRelations(agent)
        const relations = (data.relations ?? [])
          .filter((item) => match(item.from) || match(item.to) || match(item.type) || match(item.note))
          .slice(0, limit)
        return { kind, status: data.status, relations, positions: data.positions }
      }
      case 'power': {
        const power = await this.readPower(agent)
        const tiers = (power.system?.tiers ?? []).filter((tier) => match(tier.name) || match(tier.description))
        const characters = (power.characters ?? [])
          .filter((item) => match(item.name) || match(item.current) || match(item.tierName))
          .slice(0, limit)
        const changes = Object.entries(power.chapterChanges ?? {})
          .map(([chapter, detail]) => ({ chapter: Number(chapter), detail }))
          .sort((a, b) => b.chapter - a.chapter)
          .slice(0, limit)
        return {
          kind,
          status: power.status,
          system: { name: power.system?.name ?? '', summary: power.system?.summary ?? '' },
          tiers,
          characters,
          changes,
        }
      }
      case 'inspirations': {
        const data = await this.readInspirations(agent)
        const items = (data.items ?? [])
          .filter((item) => match(item.topic) || match((item.ideas ?? []).join(' ')) || match(item.title) || match(item.hook) || match(item.scene))
          .slice(0, Number(options.limit) || 10)
          .map((item) => ({
            topic: item.topic ?? '',
            ideas: (item.ideas ?? []).slice(0, 6).map((idea) => String(idea).slice(0, 200)),
            createdAt: item.createdAt ?? null,
          }))
        return { kind, items }
      }
      case 'materials': {
        const store = await this.storeFor(agent)
        const materials = store.listMaterials()
          .filter((item) => match(item.title) || match(item.content) || (item.tags ?? []).some((tag) => match(tag)))
          .slice(0, Number(options.limit) || 20)
          .map((item) => ({
            id: item.id,
            title: item.title,
            kind: item.kind,
            content: String(item.content ?? '').slice(0, 400),
            tags: item.tags ?? [],
            updatedAt: item.updatedAt ?? null,
          }))
        return { kind, materials }
      }
      case 'deconstructions': {
        const data = await this.readDeconstructions(agent)
        const items = data.items ?? []
        const entryId = String(options.entryId ?? '').trim()
        const index = Number(options.number)
        if (entryId || (Number.isFinite(index) && index > 0)) {
          const item = entryId
            ? items.find((entry) => String(entry.title ?? '') === entryId || String(entry.createdAt ?? '') === entryId)
            : items[Math.floor(index) - 1]
          if (!item) throw new Error(`找不到拆书记录：${entryId || `第 ${index} 条`}`)
          return { kind, item }
        }
        const list = items.slice(0, Number(options.limit) || 5).map((item) => ({
          title: item.title ?? '',
          createdAt: item.createdAt ?? null,
          summary: String(item.summary ?? '').slice(0, 300),
          counts: {
            units: Array.isArray(item.units) ? item.units.length : 0,
            characters: Array.isArray(item.characters) ? item.characters.length : 0,
            techniques: Array.isArray(item.techniques) ? item.techniques.length : 0,
            hooks: Array.isArray(item.hooks) ? item.hooks.length : 0,
            settings: Array.isArray(item.settings) ? item.settings.length : 0,
            relations: Array.isArray(item.relations) ? item.relations.length : 0,
          },
        }))
        return { kind, items: list }
      }
      case 'prompt-overrides': {
        const catalog = await this.promptCatalog(agent)
        const overrides = (catalog.prompts ?? [])
          .filter((prompt) => prompt.customized)
          .filter((prompt) => match(prompt.key) || match(prompt.label))
          .slice(0, limit)
          .map((prompt) => ({
            key: prompt.key,
            customized: prompt.customized,
            baseRevision: prompt.baseRevision,
            revision: prompt.revision,
            preview: String(prompt.content ?? '').slice(0, 120),
          }))
        return { kind, overrides }
      }
      case 'premise-chat': {
        const chat = await this.readPremiseChat(agent)
        const messages = (chat.messages ?? [])
          .filter((message) => match(message.content))
          .slice(-(Number(options.limit) || 20))
          .map((message) => ({
            role: message.role,
            content: String(message.content ?? '').slice(0, 400),
            at: message.createdAt ?? null,
          }))
        const batches = (chat.batches ?? []).map((batch) => ({
          id: batch.id,
          mode: batch.mode,
          createdAt: batch.createdAt ?? null,
          candidateCount: (batch.candidates ?? []).length,
        }))
        return { kind, messages, batches }
      }
      default:
        throw new Error(`未知查询类型：${kind}；可用：chapter/outline/bible/state/summary/stats/runs/relations/power/inspirations/deconstructions/prompt-overrides/premise-chat`)
    }
  }

  async searchProject(agent, options = {}) {
    await this.assertInitialized(agent)
    const query = String(options.query ?? '').trim()
    if (!query) return { query, results: [], total: 0 }
    const store = await this.storeFor(agent)
    // 结构化数据可能在迁移/初始化后更新过，搜索前惰性重建非正文章节的 FTS（幂等且很快）。
    store.reindexOutline()
    store.reindexBible()
    store.reindexSummaries()
    const { results } = store.search(query, { limit: Number(options.limit ?? 60) || 60 })
    return {
      query,
      results: results.map((item) => ({
        source: item.type,
        type: item.type,
        title: item.title,
        text: item.snippet,
        snippet: item.snippet,
        number: item.number ?? null,
        entryId: item.entryId ?? null,
        id: item.entryId ?? null,
        score: item.score ?? null,
      })),
      total: results.length,
    }
  }

  async recordWritingEvent(agent, entry = {}) {
    const stats =
      (await this.readJson(agent, 'story/stats.json').catch(() => null)) ?? { events: [], updatedAt: null }
    const date = new Date().toLocaleDateString('sv-SE')
    const events = [
      ...(stats.events ?? []),
      {
        date,
        number: Number(entry.number) || 0,
        words: Number(entry.words) || 0,
        action: String(entry.action ?? 'write'),
        time: now(),
      },
    ].slice(-2000)
    const next = { events, updatedAt: now() }
    await this.writeJson(agent, 'story/stats.json', next)
    return next
  }

  async writingStats(agent) {
    const stats = await this.readJson(agent, 'story/stats.json').catch(() => null)
    const events = stats?.events ?? []
    const date = new Date().toLocaleDateString('sv-SE')
    const todayWords = events.filter((event) => event.date === date).reduce((sum, event) => sum + (Number(event.words) || 0), 0)
    const days = [...new Set(events.map((event) => event.date))].sort().reverse()
    let streakDays = 0
    const cursor = new Date()
    for (;;) {
      const key = cursor.toLocaleDateString('sv-SE')
      if (!days.includes(key)) break
      streakDays += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    const byAction = {}
    for (const event of events) {
      byAction[event.action] = (byAction[event.action] ?? 0) + (Number(event.words) || 0)
    }
    return { todayWords, streakDays, byAction, events: events.slice(-30) }
  }

  missingForeshadowPayoffs(chapter, text) {
    const source = String(text ?? '')
    if (!source) return []
    return (chapter?.foreshadow?.payoff ?? [])
      .map((item) => String(item).trim())
      .filter((item) => item && !source.includes(item) && !source.includes(item.slice(0, 12)))
  }

  async evaluateChapter(agent, chapter, text) {
    const inputs = await this.currentInputs(agent)
    const style = inputs.styleFields ?? {}
    const issues = []
    const chars = countChars(text)
    const targetWords = Number(style.chapterWords ?? chapter.wordBudget ?? 3000) || 3000
    if (chars === 0) issues.push({ level: 'error', code: 'EMPTY', message: '正文为空' })
    if (chars > 0 && chars < targetWords * 0.7) {
      issues.push({ level: 'warn', code: 'WORD_COUNT_LOW', message: `字数 ${chars}，低于目标 ${targetWords} 的 70%` })
    }
    if (chars > targetWords * 1.45) {
      issues.push({ level: 'warn', code: 'WORD_COUNT_HIGH', message: `字数 ${chars}，超过目标 ${targetWords} 的 145%` })
    }
    const banned = Array.isArray(style.bannedWords) ? style.bannedWords : []
    const paragraphList = String(text).split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
    for (const word of banned) {
      if (word && text.includes(word)) {
        const paragraph = paragraphList.findIndex((item) => item.includes(word))
        issues.push({
          level: 'error',
          code: 'BANNED_WORD',
          message: `出现禁用词「${word}」`,
          quote: word,
          ...(paragraph >= 0 ? { paragraph } : {}),
        })
      }
    }
    const paragraphs = String(text).split(/\n+/).filter((line) => line.trim().length > 0).length
    if (chars > 0 && paragraphs < 4) {
      issues.push({ level: 'warn', code: 'PARAGRAPH_FEW', message: `段落数 ${paragraphs}，偏少` })
    }
    const missingPayoffs = this.missingForeshadowPayoffs(chapter, text)
    if (missingPayoffs.length > 0) {
      issues.push({
        level: 'warn',
        code: 'FORESHADOW_PAYOFF_MISSING',
        message: `本章章纲要回收 ${missingPayoffs.length} 条伏笔，正文未检测到对应内容：${missingPayoffs.slice(0, 3).join('；')}`,
      })
    }
    if (chars > 500) {
      const quotes = (String(text).match(/[“”"]/g) ?? []).length
      const dialogueRatio = quotes / 2 / chars
      const targetRatio = Number(style.dialogueRatio)
      if (Number.isFinite(targetRatio) && targetRatio > 0 && Math.abs(dialogueRatio - targetRatio) > 0.25) {
        issues.push({ level: 'warn', code: 'DIALOGUE_RATIO', message: `对话占比约 ${dialogueRatio.toFixed(2)}，契约 ${targetRatio}` })
      }
      if (style.pov === 'first') {
        const firstPerson = (String(text).match(/我/g) ?? []).length
        if (firstPerson < chars * 0.004) {
          issues.push({ level: 'warn', code: 'POV_FIRST', message: '第一人称视角下“我”出现偏少' })
        }
      }
    }
    const chapterInputs = chapter.inputs ?? {}
    if (chapterInputs.premise && inputs.premiseHash && chapterInputs.premise !== inputs.premiseHash) {
      issues.push({ level: 'warn', code: 'STALE_PREMISE', message: '构思已变化，本章基于旧输入生成' })
    }
    if (chapterInputs.style && inputs.styleHash && chapterInputs.style !== inputs.styleHash) {
      issues.push({ level: 'warn', code: 'STALE_STYLE', message: '文风契约已变化，本章基于旧输入生成' })
    }
    const status = issues.some((issue) => issue.level === 'error') ? 'fail' : issues.length > 0 ? 'warn' : 'pass'
    return {
      status,
      issues,
      metrics: { chars, targetWords, paragraphs },
      checkedAt: now(),
    }
  }

  async qaChapter(agent, options = {}) {
    await this.assertInitialized(agent)
    this.reportStage('qa', '规则质检')
    const number = Number(options.number)
    const { chapter } = await this.findOutlineChapter(agent, number)
    if (!chapter) throw new Error(`找不到第 ${number} 章章纲`)
    const paths = this.chapterPaths(number)
    const text =
      (await this.readText(agent, paths.draft).catch(() => null)) ??
      (await this.readText(agent, paths.final).catch(() => null))
    if (!text) throw new Error(`第 ${number} 章还没有正文，请先生成草稿`)
    const qa = await this.evaluateChapter(agent, chapter, text)
    await this.writeJson(agent, paths.qa, qa)
    return qa
  }

  detectAiStyle(text) {
    const source = String(text ?? '')
    const chars = countChars(source)
    const issues = []
    const phraseCounts = {}
    const phrases = ['仿佛', '似乎', '不禁', '缓缓', '微微', '淡淡', '深吸一口气', '嘴角勾起', '眼中闪过', '空气仿佛凝固', '时间仿佛静止', '值得一提', '不得不说', '总而言之', '与此同时']
    const phraseThreshold = Math.max(3, Math.round(chars / 1200))
    for (const phrase of phrases) {
      const count = (source.match(new RegExp(phrase, 'g')) ?? []).length
      if (count > 0) phraseCounts[phrase] = count
      if (count >= phraseThreshold) {
        issues.push({ level: 'warn', code: 'AI_PHRASE', message: `「${phrase}」出现 ${count} 次，可能是套话/AI 味`, quote: phrase })
      }
    }
    const tellingWords = ['感到', '意识到', '明白', '觉得']
    let tellingCount = 0
    for (const word of tellingWords) tellingCount += (source.match(new RegExp(word, 'g')) ?? []).length
    if (tellingCount >= Math.max(4, Math.round(chars / 900))) {
      issues.push({ level: 'warn', code: 'TELLING', message: `“感到/意识到/明白”等告知性表达出现 ${tellingCount} 次，建议改成动作/细节呈现` })
    }
    const patterns = [
      { regex: /不是[^。！？\n]{1,24}而是/g, code: 'NOT_BUT', message: '“不是……而是”句式偏多' },
      { regex: /仿佛[^。！？\n]{1,24}(?:一般|一样)/g, code: 'AS_IF', message: '“仿佛……一般/一样”比喻句式偏多' },
      { regex: /像是[^。！？\n]{1,24}又像是/g, code: 'LIKE_AND', message: '“像是……又像是”句式偏多' },
    ]
    for (const pattern of patterns) {
      const count = (source.match(pattern.regex) ?? []).length
      if (count >= 2) issues.push({ level: 'warn', code: pattern.code, message: `${pattern.message}（${count} 次）` })
    }
    const sentences = source.split(/[。！？\n]+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 8)
    const starts = {}
    for (const sentence of sentences) {
      const start = sentence.slice(0, 6)
      starts[start] = (starts[start] ?? 0) + 1
    }
    for (const [start, count] of Object.entries(starts)) {
      if (count >= 3) issues.push({ level: 'warn', code: 'REPEAT_START', message: `连续句子以「${start}」开头（${count} 次）`, quote: start })
    }
    const paragraphLengths = source.split(/\n{2,}/).map((paragraph) => countChars(paragraph)).filter((length) => length > 0)
    if (paragraphLengths.length >= 6) {
      const mean = paragraphLengths.reduce((sum, value) => sum + value, 0) / paragraphLengths.length
      const variance = paragraphLengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / paragraphLengths.length
      if (mean > 0 && Math.sqrt(variance) / mean < 0.22) {
        issues.push({ level: 'warn', code: 'UNIFORM_PARAGRAPHS', message: '段落长度过于均匀，可能显得机械' })
      }
    }
    return {
      status: issues.length > 0 ? 'warn' : 'pass',
      issues,
      metrics: { chars, sentences: sentences.length, paragraphs: paragraphLengths.length, phrases: phraseCounts, tellingCount },
      checkedAt: now(),
    }
  }

  /**
   * 修订学习：分析草稿→定稿差异，提炼稳定写作偏好（只读，不写文件/DB/写作要求）。
   * 返回 { summary, preferences, stats, chapters }。
   */
  async revisionLearn(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const requestedNumber = Number(options.number)
    const hasNumber = Number.isFinite(requestedNumber) && requestedNumber > 0
    const count = Math.max(1, Math.min(6, Number(options.count) || 3))
    const maxChars = Math.max(200, Math.min(4000, Number(options.maxChars) || 1200))
    const store = await this.storeFor(agent)
    const outline = store.readOutline()
    const allChapters = (outline?.volumes ?? [])
      .flatMap((volume) => volume.chapters ?? [])
      .filter((chapter) => Number(chapter.number) > 0)
    this.reportStage('collecting', '收集修订差异')
    const candidates = []
    for (const chapter of allChapters) {
      const number = Number(chapter.number)
      if (hasNumber && number !== requestedNumber) continue
      const paths = this.chapterPaths(number)
      const draft = await this.readText(agent, paths.draft).catch(() => null)
      const final = await this.readText(agent, paths.final).catch(() => null)
      if (!draft || !final || draft === final) continue
      candidates.push({ number, draft, final, ...diffChapterTexts(draft, final) })
      if (hasNumber) break
    }
    if (candidates.length === 0) {
      throw new Error('没有可学习的修订：需要同时存在草稿与定稿且内容不同')
    }
    candidates.sort((left, right) => right.diffChars - left.diffChars)
    const selected = candidates.slice(0, hasNumber ? 1 : count)
    const system = await this.systemFor(agent, 'revisionLearn', REVISION_LEARN_SYSTEM_PROMPT)
    const userLines = [
      '分析作者从草稿到定稿的修改，提炼稳定的写作偏好。只依据下面的差异证据，不要编造。',
      `本次分析 ${selected.length} 章：${selected.map((item) => `第${item.number}章`).join('、')}`,
    ]
    for (const item of selected) {
      userLines.push(
        '',
        `【第${item.number}章】`,
        `删除片段（最多 3 条）：${item.removed.length > 0 ? item.removed.join(' / ') : '无'}`,
        `新增片段（最多 3 条）：${item.added.length > 0 ? item.added.join(' / ') : '无'}`,
        `草稿片段（截断）：${item.draft.slice(0, maxChars)}`,
        `定稿片段（截断）：${item.final.slice(0, maxChars)}`,
      )
    }
    userLines.push(
      '',
      '只输出 JSON：{"summary":"一句话总评","preferences":[{"dimension":"删减|补充|句式|节奏|对白|情绪|用词|结构","observation":"稳定偏好","evidence":"修改证据","rule":"可执行规则"}],"stats":{}}。',
      '偏好需稳定（同类修改至少 2 次）、rule 可执行、最多 8 条；证据不足返回空 preferences。',
    )
    this.reportStage('analyzing', '提炼写作偏好')
    const generated = await this.callJsonModel(agent, {
      kind: 'chapter.revision-learn',
      task: 'audit',
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userLines.join('\n') }] }],
      signal,
      maxTokens: 6000,
      temperature: 0.3,
      inputHash: this.hashInputs({ numbers: selected.map((item) => item.number), maxChars }),
    })
    const parsed = generated?.parsed && typeof generated.parsed === 'object' ? generated.parsed : null
    if (!parsed) throw new Error('模型没有返回可解析的修订学习结果，请重试')
    const preferences = Array.isArray(parsed.preferences)
      ? parsed.preferences.slice(0, 8).map((item) => ({
          dimension: String(item?.dimension ?? '').slice(0, 20),
          observation: String(item?.observation ?? '').slice(0, 300),
          evidence: String(item?.evidence ?? '').slice(0, 300),
          rule: String(item?.rule ?? '').slice(0, 300),
        })).filter((item) => item.observation && item.rule)
      : []
    const stats = {
      chapters: selected.length,
      addedChars: selected.reduce((sum, item) => sum + item.addedChars, 0),
      removedChars: selected.reduce((sum, item) => sum + item.removedChars, 0),
    }
    return {
      summary: String(parsed.summary ?? ''),
      preferences,
      stats,
      chapters: selected.map((item) => ({ number: item.number, addedChars: item.addedChars, removedChars: item.removedChars })),
    }
  }

  async styleAudit(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const detail = await this.chapterDetail(agent, number)
    const text = detail.draft ?? detail.final
    if (!text) throw new Error(`第 ${number} 章还没有正文，无法检测风格`)
    const inputs = await this.currentInputs(agent)
    const project = await this.readJson(agent, this.marker)
    const threshold = this.automationConfig(project).stylePassScore
    const heuristics = this.detectAiStyle(text)
    const system = await this.systemFor(agent, 'styleAudit', STYLE_AUDIT_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{ type: 'text', text: `文风契约：${JSON.stringify(inputs.styleFields ?? {})}\n\n正文：\n${text}` }],
    }]
    let generated = null
    let llmError = null
    this.reportStage('auditing', 'AI 风格审稿')
    try {
      generated = await this.callJsonModel(agent, {
        kind: 'chapter.style-audit',
        task: 'audit',
        number,
        system,
        messages,
        signal,
        maxTokens: 5000,
        temperature: 0.3,
        inputHash: this.hashInputs({ chapter: detail.chapter.id, text: this.hashInputs(text) }),
      })
    } catch (error) {
      llmError = errorText(error)
    }
    const llm = generated?.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const styleParagraphs = String(text).split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
    const llmIssues = Array.isArray(llm.issues) ? llm.issues.map((issue) => {
      const quote = issue.quote ? String(issue.quote).slice(0, 60) : ''
      const paragraph = quote ? styleParagraphs.findIndex((item) => item.includes(quote.slice(0, 18))) : -1
      return {
        level: issue.severity === 'high' ? 'error' : 'warn',
        severity: issue.severity ?? 'medium',
        code: `AI_${String(issue.category ?? 'STYLE').toUpperCase()}`,
        message: `${issue.category ?? '风格问题'}：${issue.advice ?? ''}${issue.quote ? `（例：「${quote}」）` : ''}`,
        ...(quote ? { quote } : {}),
        ...(paragraph >= 0 ? { paragraph } : {}),
      }
    }) : []
    const issues = [...heuristics.issues, ...llmIssues]
    const aiFlavor = normalizeAiFlavor(llm.aiFlavor) ?? estimateAiFlavor(text)
    const score = llmError ? null : Number(llm.score ?? (issues.length > 0 ? 60 : 85))
    const status = llmError
      ? heuristics.status
      : score < threshold || llmIssues.some((issue) => issue.level === 'error')
        ? 'fail'
        : issues.length > 0
          ? 'warn'
          : 'pass'
    const result = {
      status,
      score,
      summary: String(llm.summary ?? ''),
      aiFlavor,
      issues,
      heuristics,
      metrics: heuristics.metrics,
      llmError,
      checkedAt: now(),
    }
    await this.writeJson(agent, this.chapterPaths(number).styleQa, result)
    return result
  }

  async chapterReview(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const detail = await this.chapterDetail(agent, number)
    const text = detail.draft ?? detail.final
    if (!text) throw new Error(`第 ${number} 章还没有正文，无法审校`)
    const inputs = await this.currentInputs(agent)
    const project = await this.readJson(agent, this.marker)
    const threshold = this.automationConfig(project).stylePassScore
    const heuristics = this.detectAiStyle(text)
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const previous = []
    for (const chapter of chapters.filter((item) => Number(item.number) < number).slice(-8)) {
      const summary = await this.readChapterSummary(agent, chapter.number)
      previous.push({
        number: chapter.number,
        title: chapter.title,
        outline: {
          synopsis: chapter.synopsis,
        },
        summary: summary?.summary ?? null,
        characters: summary?.characters ?? [],
        events: summary?.events ?? [],
      })
    }
    const bible = await this.readBible(agent).catch(() => null)
    const system = await this.systemFor(agent, 'review', CHAPTER_REVIEW_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: [
          `当前章：第 ${number} 章《${detail.chapter.title || '未命名'}》`,
          `文风契约：${JSON.stringify(inputs.styleFields ?? {})}`,
          `当前章纲：${JSON.stringify(detail.chapter)}`,
          `前文摘要：${JSON.stringify(previous)}`,
          `设定：${JSON.stringify(bible?.characters ?? [])}`,
          `当前正文：\n${text}`,
        ].join('\n\n'),
      }],
    }]
    let generated = null
    let llmError = null
    this.reportStage('auditing', '统一审校')
    try {
      generated = await this.callJsonModel(agent, {
        kind: 'chapter.review',
        task: 'audit',
        number,
        system,
        messages,
        signal,
        maxTokens: 6000,
        temperature: 0.3,
        inputHash: this.hashInputs({ chapter: detail.chapter.id, text: this.hashInputs(text) }),
      })
    } catch (error) {
      llmError = errorText(error)
    }
    const llm = generated?.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const styleParagraphs = String(text).split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
    const llmStyleIssues = Array.isArray(llm.styleIssues) ? llm.styleIssues.map((issue) => {
      const quote = issue.quote ? String(issue.quote).slice(0, 60) : ''
      const paragraph = quote ? styleParagraphs.findIndex((item) => item.includes(quote.slice(0, 18))) : -1
      return {
        level: issue.severity === 'high' ? 'error' : 'warn',
        severity: issue.severity ?? 'medium',
        code: `AI_${String(issue.category ?? 'STYLE').toUpperCase()}`,
        message: `${issue.category ?? '风格问题'}：${issue.advice ?? ''}${issue.quote ? `（例：「${quote}」）` : ''}`,
        ...(quote ? { quote } : {}),
        ...(paragraph >= 0 ? { paragraph } : {}),
      }
    }) : []
    const styleIssues = [...heuristics.issues, ...llmStyleIssues]
    const aiFlavor = normalizeAiFlavor(llm.aiFlavor) ?? estimateAiFlavor(text)
    const score = llmError ? null : Number(llm.score ?? (styleIssues.length > 0 ? 60 : 85))
    const styleStatus = llmError
      ? heuristics.status
      : score < threshold || llmStyleIssues.some((issue) => issue.level === 'error')
        ? 'fail'
        : styleIssues.length > 0
          ? 'warn'
          : 'pass'
    const styleQa = {
      status: styleStatus,
      score,
      summary: String(llm.summary ?? ''),
      aiFlavor,
      issues: styleIssues,
      heuristics,
      metrics: heuristics.metrics,
      llmError,
      checkedAt: now(),
    }
    await this.writeJson(agent, this.chapterPaths(number).styleQa, styleQa)

    const continuityIssues = Array.isArray(llm.continuityIssues)
      ? llm.continuityIssues.map((issue) => ({
          level: issue.level === 'error' ? 'error' : 'warn',
          code: 'AI_CONTINUITY',
          message: String(issue.message ?? '').slice(0, 500),
          advice: String(issue.advice ?? '').slice(0, 500),
          chapter: Number(issue.chapter) || undefined,
        })).filter((issue) => issue.message)
      : []
    const continuity = {
      number,
      issues: continuityIssues,
      checkedAt: now(),
      ai: true,
      status: continuityIssues.length ? 'warn' : 'pass',
    }
    const savedContinuity = await this.saveContinuity(agent, number, continuity).catch(() => null)
    return { styleQa, continuity: savedContinuity ?? continuity }
  }

  async fixByQa(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const verify = options.verify !== false
    const instruction = String(options.instruction ?? '').trim()
    const inputs = await this.currentInputs(agent)
    const project = await this.readJson(agent, this.marker)
    const defaultRounds = this.automationConfig(project).fixRounds
    const rounds = clamp(Number(options.rounds ?? defaultRounds) || defaultRounds, 1, 3)
    const paths = this.chapterPaths(number)
    const fixBase = await this.systemFor(agent, 'fix', CHAPTER_SYSTEM_PROMPT)
    const system = [
      fixBase,
      '- 这是质检修复任务：只修复列出的问题，不改变情节、事实、人物关系、段落顺序；不要新增剧情。',
      '- 如果问题涉及 AI 味，优先做具体化改写：删套话、把解释改成动作、拆掉模板句式，而不是同义替换。',
      '- 若质检 issues 含 AI味 或正文命中禁用词（仿佛/一丝/缓缓/微微/眼中闪过/嘴角勾起/说道/感到…），按去 AI 味规则改：禁用词换具体动作或白描、抽象情绪外化、删章末总结/升华、拆排比、去“说道”标签；只改相关句子，不要重写无关段落。',
    ].join('\n')
    const attempts = []
    let lastUsage = null
    let best = null
    const initialDetail = await this.chapterDetail(agent, number)
    if (
      initialDetail.draft &&
      typeof initialDetail.styleQa?.score === 'number'
    ) {
      best = {
        text: initialDetail.draft,
        score: initialDetail.styleQa.score,
        styleQa: initialDetail.styleQa,
        qa: initialDetail.qa,
        round: 0,
      }
    }
    let lastIssueCount = null
    for (let round = 1; round <= rounds; round += 1) {
      if (signal?.aborted) break
      const detail = await this.chapterDetail(agent, number)
      const text = detail.draft ?? detail.final
      if (!text) throw new Error(`第 ${number} 章还没有正文，无法修复`)
      const ruleIssues = (detail.qa?.issues ?? []).map((issue) => {
        const quote = issue.quote ? `（原文片段：「${String(issue.quote).slice(0, 60)}」）` : ''
        return `[规则/${issue.level}] ${issue.message}${quote}`
      })
      const styleIssues = (detail.styleQa?.issues ?? [])
        .filter((issue) => issue.severity !== 'low')
        .map((issue) => {
          const quote = issue.quote ? `（原文片段：「${String(issue.quote).slice(0, 80)}」）` : ''
          return `[风格/${issue.severity ?? issue.level}] ${issue.message}${quote}`
        })
      const continuityIssues = (detail.continuity?.issues ?? [])
        .filter((issue) => issue.level !== 'note')
        .map((issue) => {
          const advice = issue.advice ? `；建议：${String(issue.advice).slice(0, 160)}` : ''
          return `[连续性/${issue.level ?? 'warn'}] ${issue.message}${advice}`
        })
      const issueList = [...ruleIssues, ...styleIssues, ...continuityIssues]
      if (issueList.length === 0 && !instruction) break
      const bannedWords = Array.isArray(inputs.styleFields?.bannedWords) ? inputs.styleFields.bannedWords : []
      const fixTargetWords = Number(inputs.styleFields?.chapterWords ?? detail.chapter.wordBudget ?? 3000) || 3000
      const userText = [
        `项目：${project.title}`,
        `任务：按质检问题修复第 ${number} 章《${detail.chapter.title || '未命名'}》（第 ${round}/${rounds} 轮）。`,
        '',
        '【文风契约】',
        JSON.stringify(inputs.styleFields ?? {}, null, 2),
        '',
        '【章纲】',
        JSON.stringify(detail.chapter, null, 2),
        '',
        '【需要修复的问题】',
        issueList.length ? issueList.join('\n') : '无（按额外要求处理）',
        `【字数】目标约 ${fixTargetWords} 字；当前 ${countChars(text)} 字。超标就压缩（合并过场、删重复解释），不足就补场景，但不要删情节与人物互动细节。`,
        `【禁用词】${bannedWords.length ? bannedWords.join('、') : '无'}；正文中不得出现这些词，逐处改写而不是只做同义替换。`,
        instruction ? `\n【额外要求】\n${instruction}` : '',
        '',
        '【当前正文】',
        text,
        '',
        '请输出修复后的完整正文，只输出正文。',
      ].filter((line) => line !== '').join('\n')
      const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }]
      this.reportStage('fixing', `第 ${round}/${rounds} 轮修复`)
      const call = await this.callModel(agent, { task: 'fix', number, system, messages, signal, maxTokens: 256000, temperature: 0.7 })
      const clean = call.text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim()
      if (!clean) throw new Error('模型没有返回修复后的正文')
      const sourceChars = countChars(text)
      const targetWords = Number(inputs.styleFields?.chapterWords ?? detail.chapter.wordBudget ?? 3000) || 3000
      const minChars = Math.max(1200, Math.round(Math.min(sourceChars, targetWords) * 0.6))
      const maxChars = Math.round(Math.max(sourceChars, targetWords) * 1.8)
      const cleanChars = countChars(clean)
      if (cleanChars < minChars || cleanChars > maxChars) {
        attempts.push({
          round,
          rejected: true,
          wordCount: cleanChars,
          reason: `修复后字数异常（${cleanChars}，允许 ${minChars}–${maxChars}）`,
          passed: false,
        })
        break
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await this.writeTextFile(agent, `${paths.revisions}/fix-${stamp}.md`, text)
      await this.writeTextFile(agent, paths.draft, clean)
      const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
      const meta = {
        ...(detail.meta ?? {}),
        chapterId: detail.chapter.id,
        number,
        title: detail.chapter.title,
        status: 'revised',
        wordCount: countChars(clean),
        updatedAt: now(),
        lastRunId: runId,
        fixRound: round,
      }
      await this.writeJson(agent, paths.meta, meta)
      await this.recordWritingEvent(agent, { number, words: meta.wordCount, action: 'fix' })
      await this.writeRun(agent, {
        runId,
        kind: 'chapter.qa-fix',
        createdAt: meta.updatedAt,
        model: call.model,
        system,
        messages,
        output: call.text,
        usage: call.usage,
        durationMs: call.durationMs,
        inputHash: this.hashInputs({
          chapter: detail.chapter.id,
          issues: issueList,
          instruction,
          round,
        }),
      })
      const qa = await this.qaChapter(agent, { number })
      this.reportStage('qa', `第 ${round}/${rounds} 轮规则质检`)
      let styleQa
      let continuity
      if (verify) {
        this.reportStage('auditing', `第 ${round}/${rounds} 轮统一审校`)
        const review = await this.chapterReview(agent, { number }, signal)
        styleQa = review.styleQa
        continuity = review.continuity
      } else {
        styleQa = this.detectAiStyle(clean)
        await this.writeJson(agent, paths.styleQa, styleQa)
      }
      const continuityErrors = (continuity?.issues ?? []).some((issue) => issue.level === 'error')
      const passed = qa.status !== 'fail' && styleQa.status !== 'fail' && !continuityErrors
      const previousBestScore = best?.score ?? null
      if (typeof styleQa.score === 'number' && (!best || styleQa.score > best.score)) {
        best = { text: clean, score: styleQa.score, styleQa, qa, round }
      }
      attempts.push({
        round,
        runId,
        wordCount: meta.wordCount,
        qaStatus: qa.status,
        styleStatus: styleQa.status,
        styleScore: styleQa.score ?? null,
        issueCount: issueList.length,
        passed,
      })
      lastUsage = call.usage
      if (passed) break
      if (typeof styleQa.score === 'number' && previousBestScore != null && styleQa.score < previousBestScore - 8) {
        break
      }
      // 收敛：问题数没有减少、分数也没有提升时停止，避免无限"修出一批新问题"。
      const improvedScore =
        typeof styleQa.score === 'number' && previousBestScore != null && styleQa.score > previousBestScore
      if (lastIssueCount != null && issueList.length >= lastIssueCount && !improvedScore) {
        break
      }
      lastIssueCount = issueList.length
    }

    let keptBest = false
    if (best) {
      const currentDetail = await this.chapterDetail(agent, number)
      const currentText = currentDetail.draft ?? currentDetail.final ?? ''
      if (best.text !== currentText) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await this.writeTextFile(agent, `${paths.revisions}/fix-best-${stamp}.md`, currentText)
        await this.writeTextFile(agent, paths.draft, best.text)
        await this.qaChapter(agent, { number })
        await this.writeJson(agent, paths.styleQa, best.styleQa)
        keptBest = true
      }
    }

    const finalDetail = await this.chapterDetail(agent, number)
    const remaining = [
      ...(finalDetail.qa?.issues ?? []).map((issue) => `[规则/${issue.level}] ${issue.message}`),
      ...(finalDetail.styleQa?.issues ?? []).map((issue) => `[风格/${issue.level}] ${issue.message}`),
    ]
    const passed =
      attempts.length > 0
        ? attempts[attempts.length - 1].passed
        : finalDetail.qa?.status !== 'fail' && finalDetail.styleQa?.status !== 'fail'
    const meta = {
      ...(finalDetail.meta ?? {}),
      status: passed ? 'revised' : 'needs-review',
      updatedAt: now(),
      wordCount: countChars(finalDetail.draft ?? finalDetail.final ?? ''),
      lastFixPassed: passed,
      keptBest,
      bestStyleScore: best?.score ?? null,
      remainingIssues: remaining.slice(0, 30),
    }
    await this.writeJson(agent, paths.meta, meta)
    return {
      number,
      wordCount: meta.wordCount,
      attempts,
      passed,
      keptBest,
      bestStyleScore: best?.score ?? null,
      qa: finalDetail.qa,
      styleQa: finalDetail.styleQa,
      remainingIssues: remaining,
      usage: lastUsage,
    }
  }

  async auditChapter(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const qa = await this.qaChapter(agent, { number })
    const styleQa = await this.styleAudit(agent, { number }, signal)
    return { number, qa, styleQa }
  }

  async exportManuscript(agent, options = {}) {
    await this.assertInitialized(agent)
    const project = await this.readJson(agent, this.marker)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const collected = []
    let words = 0
    for (const chapter of chapters) {
      const paths = this.chapterPaths(chapter.number)
      const final = await this.readText(agent, paths.final).catch(() => null)
      const draft = await this.readText(agent, paths.draft).catch(() => null)
      const text = final ?? draft
      if (!text) continue
      words += countChars(text)
      collected.push({ number: Number(chapter.number), title: chapter.title || '', text: text.trim() })
    }
    if (collected.length === 0) throw new Error('还没有可导出的章节')
    const stamp = new Date().toISOString().slice(0, 10)
    const format = options.format === 'html' ? 'html' : options.format === 'epub' ? 'epub' : options.format === 'docx' ? 'docx' : 'md'
    if (format === 'docx') {
      const title = escapeXml(project.title || '未命名')
      const run = (text, size = 24, bold = false) =>
        `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
      const paragraph = (text, { heading = false, firstLine = true, title = false } = {}) => {
        const style = title ? 'Title' : heading ? 'Heading1' : 'Normal'
        return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${firstLine && !heading && !title ? '<w:ind w:firstLine="480"/>' : ''}</w:pPr>${run(text, title ? 40 : heading ? 32 : 24, heading || title)}</w:p>`
      }
      const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      const sections = collected.map((chapter, index) => {
        const paragraphs = chapter.text
          .split(/\n{2,}/)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => paragraph(item, { firstLine: true }))
          .join('')
        return `${index > 0 ? pageBreak : ''}${paragraph(`第 ${chapter.number} 章 ${chapter.title}`, { heading: true, firstLine: false })}${paragraphs}`
      }).join('')
      const toc = `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr>${run('目录', 32, true)}</w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>打开文档后更新目录</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraph(project.title || '未命名', { title: true, firstLine: false })}
${paragraph(`Novel Studio · ${stamp}`, { firstLine: false })}
${pageBreak}
${toc}
${pageBreak}
${sections}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`
      const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`
      const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
      const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
      const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`
      const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${title}</dc:title><dc:creator>DeepNovel</dc:creator><cp:lastModifiedBy>DeepNovel</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`
      const path = `exports/novel-${stamp}.docx`
      await this.writeBinaryFile(agent, path, makeZip([
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rels },
        { name: 'docProps/core.xml', data: core },
        { name: 'word/document.xml', data: documentXml },
        { name: 'word/styles.xml', data: styles },
        { name: 'word/settings.xml', data: settings },
        { name: 'word/_rels/document.xml.rels', data: documentRels },
      ]))
      return { path, format, chapters: collected.length, words }
    }
    if (format === 'epub') {
      const uuid = `urn:uuid:${randomUUID()}`
      const title = escapeXml(project.title || '未命名')
      const chapterFiles = collected.map((chapter) => {
        const filename = `chap-${String(chapter.number).padStart(3, '0')}.xhtml`
        const paragraphs = chapter.text
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .map((paragraph) => `<p>${escapeXml(paragraph).replace(/\n/g, '<br/>')}</p>`)
          .join('\n')
        const body = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
<head><meta charset="utf-8"/><title>第 ${chapter.number} 章 ${escapeXml(chapter.title)}</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>第 ${chapter.number} 章 ${escapeXml(chapter.title)}</h2>
${paragraphs}
</body></html>`
        return { filename, itemId: `chap${chapter.number}`, chapter, body }
      })
      const manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="style" href="style.css" media-type="text/css"/>',
        ...chapterFiles.map((file) => `<item id="${file.itemId}" href="${file.filename}" media-type="application/xhtml+xml"/>`),
      ].join('\n')
      const spine = chapterFiles.map((file) => `<itemref idref="${file.itemId}"/>`).join('\n')
      const navItems = chapterFiles.map((file) => `<li><a href="${file.filename}">第 ${file.chapter.number} 章 ${escapeXml(file.chapter.title)}</a></li>`).join('\n')
      const navPoints = chapterFiles.map((file, index) => `
<navPoint id="navPoint-${index + 1}" playOrder="${index + 1}">
  <navLabel><text>第 ${file.chapter.number} 章 ${escapeXml(file.chapter.title)}</text></navLabel>
  <content src="${file.filename}"/>
</navPoint>`).join('')
      const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${uuid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`
      const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title><link rel="stylesheet" href="style.css"/></head>
<body><nav epub:type="toc"><h1>目录</h1><ol>
${navItems}
</ol></nav></body></html>`
      const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${uuid}"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>${navPoints}</navMap>
</ncx>`
      const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
      const style = 'body{font-family:"Songti SC","STSong","Noto Serif SC",serif;line-height:1.9;margin:1.4em}h1,h2{font-weight:600}p{margin:0 0 .9em;text-indent:2em;text-align:justify}'
      const entries = [
        { name: 'mimetype', data: 'application/epub+zip', stored: true },
        { name: 'META-INF/container.xml', data: container },
        { name: 'OEBPS/content.opf', data: opf },
        { name: 'OEBPS/nav.xhtml', data: nav },
        { name: 'OEBPS/toc.ncx', data: ncx },
        { name: 'OEBPS/style.css', data: style },
        ...chapterFiles.map((file) => ({ name: `OEBPS/${file.filename}`, data: file.body })),
      ]
      const path = `exports/novel-${stamp}.epub`
      await this.writeBinaryFile(agent, path, makeZip(entries))
      return { path, format, chapters: collected.length, words }
    }
    if (format === 'html') {
      const escape = (value) =>
        String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      const sections = collected.map((chapter) => {
        const paragraphs = chapter.text
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
          .join('\n')
        return `<section><h2>第 ${chapter.number} 章 ${escape(chapter.title)}</h2>\n${paragraphs}</section>`
      })
      const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${escape(project.title || '未命名')}</title>
<style>
body{margin:0;background:#f6f3ec;color:#24211c;font-family:"Songti SC","STSong","Noto Serif SC",Georgia,serif;line-height:1.9}
main{max-width:760px;margin:0 auto;padding:56px 32px 96px}
h1{font-size:30px;letter-spacing:.04em;margin:0 0 8px}
.meta{color:#7b7468;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:40px}
section{margin:0 0 42px;page-break-inside:auto}
h2{font-size:19px;margin:0 0 18px;padding-bottom:8px;border-bottom:1px solid #d9d2c5}
p{margin:0 0 14px;text-align:justify;text-indent:2em}
@media print{body{background:#fff}main{padding:0}h2{page-break-after:avoid}section{page-break-before:auto}}
</style></head><body><main>
<div class="meta">Novel Studio · ${stamp}</div>
<h1>${escape(project.title || '未命名')}</h1>
${sections.join('\n')}
</main></body></html>`
      const path = `exports/novel-${stamp}.html`
      await this.writeTextFile(agent, path, html)
      return { path, format, chapters: collected.length, words }
    }
    const markdown = [
      `# ${project.title || '未命名'}`,
      ...collected.map((chapter) => `## 第 ${chapter.number} 章 ${chapter.title}\n\n${chapter.text}`),
    ].join('\n\n')
    const path = `exports/novel-${stamp}.md`
    await this.writeTextFile(agent, path, markdown)
    return { path, format: 'md', chapters: collected.length, words }
  }

  async autoFixChapter(agent, options = {}, signal) {
    this.reportStage('fixing', '准备自动修复')
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const detail = await this.chapterDetail(agent, number)
    if (!detail.draft && !detail.final) throw new Error(`第 ${number} 章还没有正文，无法自动修复`)
    const styleStale =
      !detail.styleQa ||
      (detail.meta?.updatedAt &&
        detail.styleQa.checkedAt &&
        detail.styleQa.checkedAt < detail.meta.updatedAt)
    if (styleStale) await this.styleAudit(agent, { number }, signal)
    return this.fixByQa(
      agent,
      {
        number,
        rounds: options.rounds ?? 2,
        verify: true,
        instruction: options.instruction,
      },
      signal,
    )
  }

  async draftChapter(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number ?? options.chapter ?? options.chapterNumber)
    const { chapter } = await this.findOutlineChapter(agent, number)
    if (!chapter) throw new Error(`找不到第 ${number} 章章纲，请先生成并确认章纲`)
    if (chapter.status !== 'confirmed') {
      throw new Error(`第 ${number} 章章纲尚未确认；请先在大纲里确认本章，再生成草稿`)
    }
    const inputs = await this.currentInputs(agent)
    if (inputs.styleStatus !== 'confirmed') throw new Error('文风契约尚未确认，无法生成正文')
    const bible = await this.readBible(agent)
    if (bible.status !== 'confirmed') throw new Error('角色/世界设定尚未确认，无法生成正文')
    const project = await this.readJson(agent, this.marker)
    const paths = this.chapterPaths(number)
    await this.ensureDir(agent, paths.dir)
    await this.ensureDir(agent, paths.revisions)
    this.reportStage('context', '组装本章上下文')
    const storyContext = await this.buildStoryContext(agent, chapter, number)
    const wordBudget = Number(inputs.styleFields?.chapterWords ?? chapter.wordBudget ?? 3000) || 3000
    const styleContract = await this.readJson(agent, 'story/style/contract.json').catch(() => null)
    const system = await this.systemFor(agent, 'draft', CHAPTER_SYSTEM_PROMPT)
    const userText = buildChapterUserPrompt({
      title: project.title,
      language: project.language ?? 'zh',
      number,
      chapter,
      styleFields: inputs.styleFields ?? {},
      samples: Array.isArray(styleContract?.samples) ? styleContract.samples : [],
      writingNotes: this.writingNotesFor(project, 'draft'),
      storyContext,
      instruction: options.instruction,
      wordBudget,
    })
    const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }]
    this.reportStage('writing', `生成第 ${number} 章正文`)
    const call = await this.callModel(agent, {
      task: 'draft',
      number,
      system,
      messages,
      signal,
      maxTokens: 256000,
      temperature: 0.85,
    })
    const clean = call.text
      .replace(/^```[a-zA-Z]*\s*/, '')
      .replace(/```$/, '')
      .trim()
    if (!clean) {
      const error = new Error('模型没有返回正文')
      error.code = 'NOVEL_WRITER_EMPTY_OUTPUT'
      throw error
    }
    const existingDraft = await this.readText(agent, paths.draft).catch(() => null)
    if (existingDraft && existingDraft.trim()) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await this.writeTextFile(agent, `${paths.revisions}/draft-${stamp}.md`, existingDraft)
    }
    await this.writeTextFile(agent, paths.draft, clean)
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const previousMeta = await this.readJson(agent, paths.meta).catch(() => null)
    const existingFinal = await this.readText(agent, paths.final).catch(() => null)
    const meta = {
      ...(previousMeta ?? {}),
      chapterId: chapter.id,
      number,
      title: chapter.title,
      status: 'drafted',
      wordCount: countChars(clean),
      updatedAt: now(),
      lastRunId: runId,
      inputs: { premise: inputs.premiseHash, style: inputs.styleHash },
      outlineHash: this.hashInputs(chapter),
      finalStale: Boolean(existingFinal),
      draftedAt: now(),
    }
    await this.writeJson(agent, paths.meta, meta)
    await this.recordWritingEvent(agent, { number, words: meta.wordCount, action: 'draft' })
    await this.writeRun(agent, {
      runId,
      kind: 'chapter.draft',
      createdAt: meta.updatedAt,
      model: call.model,
      system,
      messages,
      output: call.text,
      usage: call.usage,
      durationMs: call.durationMs,
      context: storyContext.meta,
      inputHash: this.hashInputs({
        premise: inputs.premiseHash,
        style: inputs.styleHash,
        chapter: chapter.id,
        instruction: options.instruction,
      }),
    })
    const qa = await this.qaChapter(agent, { number })
    this.reportStage('qa', '规则质检')
    let autoFix = null
    const automation = this.automationConfig(project)
    if (automation.autoAudit || automation.autoFix) {
      try {
        this.reportStage('auditing', 'AI 风格审稿')
        await this.styleAudit(agent, { number }, signal)
      } catch {
        // heuristic audit will still run; style audit failure must not fail the draft
      }
    }
    if (automation.autoFix) {
      try {
        this.reportStage('fixing', '自动修复')
        autoFix = await this.autoFixChapter(agent, { number, rounds: automation.fixRounds }, signal)
      } catch (error) {
        autoFix = { error: errorText(error) }
      }
    }
    return {
      runId,
      number,
      wordCount: autoFix?.wordCount ?? meta.wordCount,
      draftPath: paths.draft,
      qa: autoFix?.qa ?? qa,
      styleQa: autoFix?.styleQa ?? null,
      autoFixed: Boolean(autoFix?.passed),
      autoFixAttempts: autoFix?.attempts ?? [],
      autoFixRemaining: autoFix?.remainingIssues ?? [],
      autoFixError: autoFix?.error ?? null,
      usage: call.usage,
    }
  }

  async batchWrite(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const project = await this.readJson(agent, this.marker)
    const defaultCount = this.automationConfig(project).batchCount
    const count = clamp(Number(options.count ?? defaultCount) || defaultCount, 1, 5)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    let number = Number(options.fromChapter ?? 0)
    if (!number) {
      for (const chapter of chapters) {
        const previous = this.chapterPaths(chapter.number)
        const draft = await this.readText(agent, previous.draft).catch(() => null)
        if (!draft) {
          number = Number(chapter.number)
          break
        }
      }
    }
    if (!number) number = Math.max(0, ...chapters.map((chapter) => Number(chapter.number))) + 1

    const results = []
    let paused = false
    for (let index = 0; index < count; index += 1) {
      if (signal?.aborted) {
        results.push({ number, cancelled: true })
        break
      }
      if (this.shouldPause()) {
        paused = true
        break
      }
      const chapter = chapters.find((item) => Number(item.number) === number)
      if (!chapter) {
        const error = new Error(
          `第 ${number} 章还没有章纲，请先在「大纲」里生成（本次已完成 ${results.filter((item) => item.ok).length} 章）`,
        )
        error.partial = results
        throw error
      }
      if (chapter.status !== 'confirmed') {
        const error = new Error(
          `第 ${number} 章章纲尚未确认，请先在大纲页确认本章，再连续写作（本次已完成 ${results.filter((item) => item.ok).length} 章）`,
        )
        error.partial = results
        throw error
      }
      const paths = this.chapterPaths(number)
      const existing = await this.readText(agent, paths.draft).catch(() => null)
      if (existing && !options.overwrite) {
        results.push({ number, skipped: true })
        number += 1
        continue
      }
      try {
        const draft = await this.draftChapter(agent, { number }, signal)
        results.push({
          number,
          ok: true,
          wordCount: draft.wordCount,
          qa: draft.qa?.status ?? null,
          autoFixed: Boolean(draft.autoFixed),
        })
      } catch (error) {
        if (signal?.aborted) {
          results.push({ number, cancelled: true })
          break
        }
        const wrapped = new Error(
          `第 ${number} 章生成失败：${errorText(error)}（本次已完成 ${results.filter((item) => item.ok).length} 章）`,
        )
        wrapped.partial = results
        throw wrapped
      }
      number += 1
      if (this.shouldPause()) {
        paused = true
        break
      }
    }
    return { results, nextChapter: number, paused }
  }

  async buildRevisionPlan(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number ?? options.chapter ?? options.chapterNumber)
    const detail = await this.chapterDetail(agent, number)
    const current = detail.draft ?? detail.final
    if (!current) throw new Error(`第 ${number} 章还没有正文，请先生成草稿`)
    const instruction = String(options.instruction ?? '').trim()
    if (!instruction) throw new Error('请填写修订要求，例如“开头更冷硬”“压缩心理描写”')
    const fromParagraph = Number(options.fromParagraph ?? 0)
    const toParagraph = Number(options.toParagraph ?? 0)
    const paragraphs = current.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
    const hasRange = fromParagraph > 0 && toParagraph > 0
    let targetText = ''
    if (hasRange) {
      if (fromParagraph > toParagraph) throw new Error('段落范围起点不能大于终点')
      if (toParagraph > paragraphs.length) throw new Error(`全文只有 ${paragraphs.length} 段，范围超出`)
      targetText = paragraphs.slice(fromParagraph - 1, toParagraph).join('\n\n')
    }
    const inputs = await this.currentInputs(agent)
    const project = await this.readJson(agent, this.marker)
    const paths = this.chapterPaths(number)
    this.reportStage('context', '组装修订上下文')
    const storyContext = await this.buildStoryContext(agent, detail.chapter, number)
    const reviseBase = await this.systemFor(agent, 'revise', CHAPTER_SYSTEM_PROMPT)
    const deslopRule = '- 去 AI 味：禁用词（仿佛/一丝/缓缓/微微/眼中闪过/嘴角勾起…）换成具体动作或白描，抽象情绪外化，删章末总结/升华，拆掉“，带着…”“XX说道”等模板句式；只改相关句子，不重写无关段落。'
    const system = hasRange
      ? `${reviseBase}\n- 这是局部重写任务：只重写指定段落，保持其他段落与前后衔接不变。\n${deslopRule}`
      : `${reviseBase}\n- 这是修订任务：在保留章纲事实与前文衔接的前提下，按修订要求重写整章。\n${deslopRule}`
    const userText = [
      `项目：${project.title}（语言：${project.language ?? 'zh'}）`,
      `任务：${hasRange ? `局部重写第 ${number} 章的第 ${fromParagraph}–${toParagraph} 段（全文共 ${paragraphs.length} 段）。` : `修订第 ${number} 章《${detail.chapter.title || '未命名'}》。`}`,
      '',
      '【文风契约】',
      JSON.stringify(inputs.styleFields ?? {}, null, 2),
      '',
      this.writingNotesFor(project, 'revise') ? `【项目写作要求（必须遵守）】\n${this.writingNotesFor(project, 'revise')}\n` : '',
      '【章纲】',
      JSON.stringify(detail.chapter, null, 2),
      '',
      '【故事背景】',
      JSON.stringify(storyContext.premise ?? {}, null, 2),
      '',
      '【设定上下文（必须遵守）】',
      JSON.stringify(storyContext.bible ?? {}, null, 2),
      '',
      '【连续性】',
      JSON.stringify(storyContext.continuity ?? {}, null, 2),
      '',
      storyContext.foreshadowing?.length ? '【未回收伏笔】\n' + JSON.stringify(storyContext.foreshadowing, null, 2) : '',
      storyContext.foreshadowingDue?.length ? '【本章章纲要求回收的伏笔】\n' + JSON.stringify(storyContext.foreshadowingDue, null, 2) : '',
      '',
      '【修订要求】',
      instruction,
      '',
      craftCards.length ? formatCraftCards(craftCards) : '',
      '',
      hasRange ? '【需要重写的原段落】\n' + targetText : '',
      '',
      '【当前正文】',
      current,
      '',
      hasRange
        ? '请只输出重写后的这几段，段落之间用两个换行分隔；不要输出其他段落、标题或解释。'
        : '请输出修订后的完整正文，只输出正文。',
    ].filter((line) => line !== '').join('\n')
    return {
      number,
      detail,
      current,
      instruction,
      fromParagraph,
      toParagraph,
      paragraphs,
      hasRange,
      targetText,
      inputs,
      project,
      paths,
      storyContext,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    }
  }

  async previewRevision(agent, options = {}, signal) {
    const plan = await this.buildRevisionPlan(agent, options)
    this.reportStage('preview', '生成重写预览')
    const call = await this.callModel(agent, {
      task: 'revise',
      number,
      system: plan.system,
      messages: plan.messages,
      signal,
      maxTokens: 256000,
      temperature: 0.8,
    })
    const clean = call.text
      .replace(/^```[a-zA-Z]*\s*/, '')
      .replace(/```$/, '')
      .trim()
    if (!clean) throw new Error('模型没有返回修订后的正文')
    const rewrittenParagraphs = clean.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
    const nextText = plan.hasRange
      ? [...plan.paragraphs.slice(0, plan.fromParagraph - 1), ...rewrittenParagraphs, ...plan.paragraphs.slice(plan.toParagraph)].join('\n\n')
      : clean
    return {
      number: plan.number,
      current: plan.current,
      nextText,
      wordCount: countChars(nextText),
      range: plan.hasRange ? { fromParagraph: plan.fromParagraph, toParagraph: plan.toParagraph } : null,
      usage: call.usage,
      durationMs: call.durationMs,
    }
  }

  async reviseChapter(agent, options = {}, signal) {
    const plan = await this.buildRevisionPlan(agent, options)
    const {
      number,
      detail,
      current,
      instruction,
      fromParagraph,
      toParagraph,
      paragraphs,
      hasRange,
      inputs,
      paths,
      storyContext,
      system,
      messages,
    } = plan
    let call
    let nextText
    if (options.proposedText) {
      nextText = String(options.proposedText).replace(/\s+$/, '')
      if (!nextText.trim()) throw new Error('重写预览为空，无法应用')
      call = { text: nextText, usage: null, model: null, durationMs: 0 }
    } else {
      this.reportStage('writing', `修订第 ${number} 章`)
      call = await this.callModel(agent, {
        task: 'revise',
        number,
        system,
        messages,
        signal,
        maxTokens: 256000,
        temperature: 0.8,
      })
      const clean = call.text
        .replace(/^```[a-zA-Z]*\s*/, '')
        .replace(/```$/, '')
        .trim()
      if (!clean) throw new Error('模型没有返回修订后的正文')
      const rewrittenParagraphs = clean.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
      nextText = hasRange
        ? [...paragraphs.slice(0, fromParagraph - 1), ...rewrittenParagraphs, ...paragraphs.slice(toParagraph)].join('\n\n')
        : clean
    }
    this.reportStage('saving', '写入修订稿')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await this.writeTextFile(agent, `${paths.revisions}/revise-${stamp}.md`, current)
    await this.writeTextFile(agent, paths.draft, nextText)
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const existingFinal = await this.readText(agent, paths.final).catch(() => null)
    const meta = {
      ...(detail.meta ?? {}),
      chapterId: detail.chapter.id,
      number,
      title: detail.chapter.title,
      status: 'revised',
      wordCount: countChars(nextText),
      updatedAt: now(),
      lastRunId: runId,
      lastInstruction: instruction,
      inputs: { premise: inputs.premiseHash, style: inputs.styleHash },
      outlineHash: this.hashInputs(detail.chapter),
      draftedAt: now(),
      finalStale: Boolean(existingFinal),
    }
    await this.writeJson(agent, paths.meta, meta)
    await this.recordWritingEvent(agent, { number, words: meta.wordCount, action: hasRange ? 'revise-range' : 'revise' })
    await this.writeRun(agent, {
      runId,
      kind: hasRange ? 'chapter.revise.range' : 'chapter.revise',
      createdAt: meta.updatedAt,
      model: call.model,
      system,
      messages,
      output: call.text,
      usage: call.usage,
      durationMs: call.durationMs,
      context: storyContext.meta,
      inputHash: this.hashInputs({
        chapter: detail.chapter.id,
        instruction,
        range: hasRange ? { fromParagraph, toParagraph } : null,
        previous: this.hashInputs(current),
      }),
    })
    this.reportStage('qa', '规则质检')
    const qa = await this.qaChapter(agent, { number })
    await this.clearChapterInstruction(agent, number)
    return {
      runId,
      number,
      wordCount: meta.wordCount,
      revisionPath: `${paths.revisions}/revise-${stamp}.md`,
      range: hasRange ? { fromParagraph, toParagraph } : null,
      qa,
      usage: call.usage,
    }
  }

  async saveChapterText(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const text = String(options.text ?? '').trim()
    if (!text) throw new Error('正文不能为空')
    const { chapter } = await this.findOutlineChapter(agent, number)
    if (!chapter) throw new Error(`找不到第 ${number} 章章纲`)
    const paths = this.chapterPaths(number)
    const previous = (await this.readText(agent, paths.draft).catch(() => null)) ?? (await this.readText(agent, paths.final).catch(() => null))
    if (previous) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await this.writeTextFile(agent, `${paths.revisions}/manual-${stamp}.md`, previous)
    }
    await this.writeTextFile(agent, paths.draft, text)
    const inputs = await this.currentInputs(agent)
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const existingFinal = await this.readText(agent, paths.final).catch(() => null)
    const meta = {
      ...((await this.readJson(agent, paths.meta).catch(() => null)) ?? {}),
      chapterId: chapter.id,
      number,
      title: chapter.title,
      status: 'manual',
      wordCount: countChars(text),
      updatedAt: now(),
      lastRunId: runId,
      inputs: { premise: inputs.premiseHash, style: inputs.styleHash },
      outlineHash: this.hashInputs(chapter),
      draftedAt: now(),
      finalStale: Boolean(existingFinal),
    }
    await this.writeJson(agent, paths.meta, meta)
    const cwd = await this.cwd(agent)
    for (const file of [paths.qa, paths.styleQa]) {
      try {
        const target = await this.ctx.fs.resolve(file, { cwd })
        const hostPath = this.ctx.fs.processPath?.(target)
        if (hostPath) await unlink(hostPath)
      } catch {
        // QA files may not exist
      }
    }
    await this.writeRun(agent, {
      runId,
      kind: 'chapter.manual',
      createdAt: meta.updatedAt,
      model: { provider: 'manual', model: 'manual' },
      system: null,
      messages: [],
      output: text,
      usage: null,
      durationMs: 0,
      inputHash: this.hashInputs({ chapter: chapter.id, text: this.hashInputs(text) }),
    })
    await this.recordWritingEvent(agent, { number, words: meta.wordCount, action: 'manual' })
    return { number, wordCount: meta.wordCount, status: 'manual' }
  }

  /**
   * 碎片化改正文：只替换一小段，不生成整章、不调用 LLM。
   * 适合模型输出受限/内容审查中断时小步推进；find 必须唯一（或 all=true）。
   */
  /**
   * 去 AI 味改写：只改“怎么说”不改“说什么”。先备份再写回，失败不落盘；
   * 长度变化超出 ±30% 视为乱改，直接失败。dryRun 只返回预览。
   */
  async deslopChapter(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    if (!Number.isFinite(number) || number < 1) throw new Error('请指定章号')
    const detail = await this.chapterDetail(agent, number)
    if (!detail.chapter) throw new Error(`找不到第 ${number} 章章纲`)
    const paths = this.chapterPaths(number)
    const explicitTarget = options.target === 'final' || options.target === 'draft' ? options.target : null
    const target = explicitTarget ?? (detail.final ? 'final' : 'draft')
    const original = target === 'final' ? detail.final : detail.draft
    if (!original) throw new Error(`第 ${number} 章还没有${target === 'final' ? '定稿' : '草稿'}，先 action=read 确认`)
    const instruction = String(options.instruction ?? '').trim()
    const dryRun = options.dryRun === true
    const inputs = await this.currentInputs(agent)
    const bannedWords = Array.isArray(inputs.styleFields?.bannedWords) ? inputs.styleFields.bannedWords : []
    const system = await this.systemFor(agent, 'deslop', DESLOP_SYSTEM_PROMPT)
    const userText = [
      `任务：对第 ${number} 章《${detail.chapter.title || '未命名'}》做去 AI 味改写。只改“怎么说”，不改“说什么”；改最少、效果最大。`,
      '',
      '【文风契约】',
      JSON.stringify(inputs.styleFields ?? {}, null, 2),
      '',
      '【一级禁用词（正文中不得出现）】',
      AI_BANNED_WORDS.join('、'),
      bannedWords.length ? `【项目自定义禁用词】${bannedWords.join('、')}` : '',
      '',
      instruction ? `【额外要求】\n${instruction}` : '',
      '',
      '【当前正文】',
      original,
      '',
      '请输出 JSON：{"text": "改写后全文", "changes": [...]}。',
    ].filter((line) => line !== '').join('\n')
    const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }]
    this.reportStage('deslop', '去 AI 味改写')
    const generated = await this.callJsonModel(agent, {
      kind: 'chapter.deslop',
      task: 'deslop',
      number,
      system,
      messages,
      signal,
      maxTokens: 256000,
      temperature: 0.4,
      inputHash: this.hashInputs({ chapter: detail.chapter.id, target, text: this.hashInputs(original), instruction }),
    })
    const parsed = generated?.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const nextText = String(parsed.text ?? '').trim()
    if (!nextText) throw new Error('模型没有返回改写后的正文')
    const changes = Array.isArray(parsed.changes) ? parsed.changes.slice(0, 30).map((change) => ({
      from: String(change?.from ?? '').slice(0, 200),
      to: String(change?.to ?? '').slice(0, 200),
      reason: String(change?.reason ?? '').slice(0, 60),
    })) : []
    const beforeChars = countChars(original)
    const afterChars = countChars(nextText)
    if (beforeChars > 0 && (afterChars < beforeChars * 0.7 || afterChars > beforeChars * 1.3)) {
      throw new Error(`改写后字数变化过大（${beforeChars} → ${afterChars}），已放弃写入；可减少改写幅度后重试`)
    }
    const beforeAiFlavor = estimateAiFlavor(original)
    const afterAiFlavor = estimateAiFlavor(nextText)
    if (dryRun) {
      return {
        number,
        target,
        dryRun: true,
        changed: changes.length,
        changes,
        beforeAiFlavor,
        afterAiFlavor,
        wordCount: afterChars,
        text: nextText,
      }
    }
    // 先备份原文，再写回；写回失败恢复原文（失败不落盘）。
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const revisionPath = `${paths.revisions}/deslop-${stamp}.md`
    await this.writeTextFile(agent, revisionPath, original)
    const targetPath = target === 'final' ? paths.final : paths.draft
    try {
      await this.writeTextFile(agent, targetPath, nextText)
    } catch (error) {
      await this.writeTextFile(agent, targetPath, original).catch(() => {})
      throw error
    }
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const meta = {
      ...((await this.readJson(agent, paths.meta).catch(() => null)) ?? {}),
      chapterId: detail.chapter.id,
      number,
      title: detail.chapter.title,
      status: 'manual',
      wordCount: afterChars,
      updatedAt: now(),
      lastRunId: runId,
      lastInstruction: instruction,
      inputs: { premise: inputs.premiseHash, style: inputs.styleHash },
      outlineHash: this.hashInputs(detail.chapter),
    }
    if (target === 'final') meta.finalStale = true
    await this.writeJson(agent, paths.meta, meta)
    // 正文变了，旧质检失效（与 saveChapterText / patchChapterText 一致）。
    const cwd = await this.cwd(agent)
    for (const file of [paths.qa, paths.styleQa]) {
      try {
        const qaTarget = await this.ctx.fs.resolve(file, { cwd })
        const hostPath = this.ctx.fs.processPath?.(qaTarget)
        if (hostPath) await unlink(hostPath)
      } catch {
        // QA 文件可能不存在
      }
    }
    await this.writeRun(agent, {
      runId,
      kind: 'chapter.deslop',
      number,
      createdAt: meta.updatedAt,
      model: generated?.first?.model ?? null,
      system,
      messages,
      output: JSON.stringify({ target, changed: changes.length, beforeAiFlavor, afterAiFlavor }),
      usage: generated?.usage ?? null,
      durationMs: generated?.first?.durationMs ?? 0,
      inputHash: this.hashInputs({ chapter: detail.chapter.id, target, before: this.hashInputs(original), after: this.hashInputs(nextText) }),
    })
    await this.recordWritingEvent(agent, { number, words: afterChars, action: 'deslop' })
    return {
      number,
      target,
      changed: changes.length,
      changes,
      beforeAiFlavor,
      afterAiFlavor,
      wordCount: afterChars,
      revisionPath,
    }
  }

  async patchChapterText(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    if (!Number.isFinite(number) || number < 1) throw new Error('请指定章号')
    const target = options.target === 'final' ? 'final' : 'draft'
    const find = String(options.find ?? '')
    const replace = String(options.replace ?? '')
    if (!find) throw new Error('请提供要替换的原文片段 find')
    if (find === replace) throw new Error('find 与 replace 相同，无需修改')
    const { chapter } = await this.findOutlineChapter(agent, number)
    if (!chapter) throw new Error(`找不到第 ${number} 章章纲`)
    const paths = this.chapterPaths(number)
    const targetPath = target === 'final' ? paths.final : paths.draft
    const original = await this.readText(agent, targetPath).catch(() => null)
    if (original === null) {
      throw new Error(`第 ${number} 章还没有${target === 'final' ? '定稿' : '草稿'}，先用 action=read 确认或 action=draft 生成`)
    }
    const occurrences = original.split(find).length - 1
    if (occurrences === 0) throw new Error('没找到要替换的片段（可能已被修改，先 action=read 确认）')
    if (occurrences > 1 && options.all !== true) {
      throw new Error(`片段出现 ${occurrences} 次，用 all=true 或提供更长的上下文`)
    }
    const nextText = options.all === true
      ? original.split(find).join(replace)
      : (() => {
          const index = original.indexOf(find)
          return original.slice(0, index) + replace + original.slice(index + find.length)
        })()
    const replaced = options.all === true ? occurrences : 1
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const revisionPath = `${paths.revisions}/manual-${stamp}.md`
    // 先备份替换前全文，再原子写回（writeTextFile 会自动重建该章 FTS）
    await this.writeTextFile(agent, revisionPath, original)
    await this.writeTextFile(agent, targetPath, nextText)
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const inputs = await this.currentInputs(agent)
    const meta = {
      ...((await this.readJson(agent, paths.meta).catch(() => null)) ?? {}),
      chapterId: chapter.id,
      number,
      title: chapter.title,
      status: 'manual',
      wordCount: countChars(nextText),
      updatedAt: now(),
      lastRunId: runId,
      inputs: { premise: inputs.premiseHash, style: inputs.styleHash },
      outlineHash: this.hashInputs(chapter),
    }
    if (target === 'final') meta.finalStale = true
    await this.writeJson(agent, paths.meta, meta)
    // 正文变了，旧质检失效（与 saveChapterText 一致）
    const cwd = await this.cwd(agent)
    for (const file of [paths.qa, paths.styleQa]) {
      try {
        const target2 = await this.ctx.fs.resolve(file, { cwd })
        const hostPath = this.ctx.fs.processPath?.(target2)
        if (hostPath) await unlink(hostPath)
      } catch {
        // QA 文件可能不存在
      }
    }
    await this.writeRun(agent, {
      runId,
      kind: 'chapter.patch',
      createdAt: meta.updatedAt,
      model: { provider: 'manual', model: 'manual' },
      system: null,
      messages: [],
      output: JSON.stringify({
        target,
        find: find.slice(0, 120),
        replace: replace.slice(0, 120),
        all: options.all === true,
        replaced,
        note: String(options.note ?? '').slice(0, 200),
      }),
      usage: null,
      durationMs: 0,
      inputHash: this.hashInputs({ chapter: chapter.id, target, find, replace }),
    })
    await this.recordWritingEvent(agent, { number, words: meta.wordCount, action: 'patch' })
    return {
      number,
      target,
      replaced,
      wordCount: meta.wordCount,
      revisionPath,
      staleFinal: Boolean(meta.finalStale),
    }
  }

  async readRevisionDetail(agent, number, name) {
    const paths = this.chapterPaths(number)
    if (!/^[A-Za-z0-9._-]+\.md$/.test(name)) throw new Error('非法的修订文件名')
    const text = await this.readText(agent, `${paths.revisions}/${name}`).catch(() => null)
    if (!text) throw new Error('找不到该修订版本')
    const detail = await this.chapterDetail(agent, number)
    return { number: Number(number), name, text, current: detail.draft ?? detail.final ?? '' }
  }

  async restoreRevision(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const revision = await this.readRevisionDetail(agent, number, String(options.name ?? ''))
    const paths = this.chapterPaths(number)
    const current = revision.current
    if (current) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await this.writeTextFile(agent, `${paths.revisions}/restore-${stamp}.md`, current)
    }
    await this.writeTextFile(agent, paths.draft, revision.text)
    const meta = {
      ...((await this.readJson(agent, paths.meta).catch(() => null)) ?? {}),
      number,
      status: 'revised',
      wordCount: countChars(revision.text),
      updatedAt: now(),
    }
    await this.writeJson(agent, paths.meta, meta)
    const qa = await this.qaChapter(agent, { number })
    return { number, wordCount: meta.wordCount, restoredFrom: revision.name, qa }
  }

  chapterSummaryPath(number) {
    return `${this.chapterPaths(number).dir}/summary.json`
  }

  async readChapterSummary(agent, number) {
    return this.readJson(agent, this.chapterSummaryPath(number)).catch(() => null)
  }

  async summarizeChapter(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const detail = await this.chapterDetail(agent, number)
    const text = String(options.text ?? detail.final ?? detail.draft ?? '').trim()
    if (!text) throw new Error(`第 ${number} 章还没有正文，无法生成摘要`)
    const system = await this.systemFor(agent, 'summary', SUMMARY_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{ type: 'text', text: `第 ${number} 章《${detail.chapter.title ?? ''}》\n\n${text.slice(0, 20000)}` }],
    }]
    this.reportStage('summary', `第 ${number} 章摘要`)
    const generated = await this.callJsonModel(agent, {
      kind: 'chapter.summary',
      task: 'summary',
      number,
      system,
      messages,
      signal,
      maxTokens: 1200,
      temperature: 0.3,
      inputHash: this.hashInputs(text),
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const summary = {
      number,
      summary: String(parsed.summary ?? '').trim().slice(0, 2000),
      characters: Array.isArray(parsed.characters) ? parsed.characters.map(String).filter(Boolean).slice(0, 24) : [],
      events: Array.isArray(parsed.events) ? parsed.events.map(String).filter(Boolean).slice(0, 16) : [],
      openThreads: Array.isArray(parsed.openThreads) ? parsed.openThreads.map(String).filter(Boolean).slice(0, 16) : [],
      sourceHash: this.hashInputs(text),
      generatedAt: now(),
      runId: generated.runId,
    }
    if (options.deferWrite !== true) {
      await this.writeJson(agent, this.chapterSummaryPath(number), summary)
      const meta = (await this.readJson(agent, this.chapterPaths(number).meta).catch(() => null)) ?? {}
      await this.writeJson(agent, this.chapterPaths(number).meta, {
        ...meta,
        summary: summary.summary,
        summaryAt: summary.generatedAt,
      })
    }
    return summary
  }
  async summarizeMissing(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const results = []
    for (const chapter of chapters.sort((a, b) => Number(a.number) - Number(b.number))) {
      if (signal?.aborted) break
      if (options.number && Number(options.number) !== Number(chapter.number)) continue
      const detail = await this.chapterDetail(agent, chapter.number).catch(() => null)
      const text = detail?.final ?? detail?.draft ?? ''
      if (!text) continue
      const existing = await this.readChapterSummary(agent, chapter.number)
      if (existing?.sourceHash === this.hashInputs(text)) continue
      this.reportStage('summary', `补全第 ${chapter.number} 章摘要`)
      try {
        const summary = await this.summarizeChapter(agent, { number: chapter.number, text }, signal)
        results.push({ number: chapter.number, ok: true, summary: summary.summary })
      } catch (error) {
        results.push({ number: chapter.number, ok: false, error: errorText(error) })
      }
    }
    // 批量定稿结束统一截断 WAL（每章的状态写入仍各自在一个事务内）。
    const store = await this.storeFor(agent).catch(() => null)
    if (store && results.some((item) => item.ok)) store.checkpoint()
    return { results, count: results.filter((item) => item.ok).length }
  }

  async buildCharacterIndex(agent, snapshot = null) {
    const data = snapshot ?? null
    const outline = data ? data.outline : await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const bible = data ? (data.bible ?? { characters: [] }) : await this.readBible(agent).catch(() => ({ characters: [] }))
    const known = new Set((bible.characters ?? []).map((entry) => entry.name))
    let summaries = data?.sums ?? null
    if (!summaries) {
      summaries = new Map()
      try {
        const store = await this.storeFor(agent)
        for (const item of store.listChapterSummaries()) summaries.set(Number(item.number), item)
      } catch {
        // 未初始化时没有摘要
      }
    }
    const index = new Map()
    const add = (name, number, source) => {
      const key = String(name ?? '').trim()
      if (!key) return
      if (!index.has(key)) index.set(key, { name: key, chapters: [], lastChapter: 0, sources: new Set() })
      const entry = index.get(key)
      if (!entry.chapters.includes(Number(number))) entry.chapters.push(Number(number))
      entry.lastChapter = Math.max(entry.lastChapter, Number(number))
      entry.sources.add(source)
    }
    for (const chapter of chapters) {
      const text = String(chapter.synopsis ?? '')
      for (const character of bible.characters ?? []) {
        if (text.includes(String(character.name ?? ''))) add(character.name, chapter.number, 'outline')
      }
      const summary = summaries.get(Number(chapter.number))
      for (const name of summary?.characters ?? []) add(name, chapter.number, 'summary')
    }
    for (const character of bible.characters ?? []) add(character.name, 0, 'bible')
    return [...index.values()]
      .map((entry) => ({
        name: entry.name,
        chapters: entry.chapters.filter((number) => number > 0).sort((a, b) => a - b),
        lastChapter: entry.lastChapter,
        sources: [...entry.sources],
        inBible: known.has(entry.name),
      }))
      .sort((a, b) => b.lastChapter - a.lastChapter || a.name.localeCompare(b.name))
  }

  async continuityReport(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const detail = await this.chapterDetail(agent, number)
    const text = detail.draft ?? detail.final ?? ''
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const allChapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const bible = await this.readBible(agent).catch(() => ({ characters: [] }))
    const bibleNames = new Set((bible.characters ?? []).map((entry) => entry.name))
    const issues = []
    const push = (level, code, message, extra = {}) => issues.push({ level, code, message, ...extra })

    const textParagraphs = String(text).split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
    for (const chapter of allChapters.filter((item) => Number(item.number) < number)) {
      const summary = await this.readChapterSummary(agent, chapter.number)
      if (!summary) {
        push('note', 'SUMMARY_MISSING', `第 ${chapter.number} 章还没有连续性摘要，长篇上下文会变弱`, { chapter: chapter.number })
      } else {
        for (const name of summary.characters ?? []) {
          if (name && !bibleNames.has(name)) {
            push('warn', 'CHARACTER_NOT_IN_BIBLE', `第 ${chapter.number} 章摘要出现未入设定的角色「${name}」`, { chapter: chapter.number })
          }
        }
      }
    }

    const planted = []
    for (const chapter of allChapters.filter((item) => Number(item.number) <= number)) {
      for (const item of chapter.foreshadow?.plant ?? []) {
        planted.push({ text: String(item), plantedAt: Number(chapter.number), paidAt: null })
      }
      for (const item of chapter.foreshadow?.payoff ?? []) {
        const value = String(item)
        const open = planted.find(
          (entry) => !entry.paidAt && (entry.text === value || value.includes(entry.text) || entry.text.includes(value)),
        )
        if (open) open.paidAt = Number(chapter.number)
      }
    }
    for (const item of planted.filter((entry) => !entry.paidAt && number - entry.plantedAt >= 8)) {
      push('warn', 'FORESHADOW_OVERDUE', `伏笔「${item.text.slice(0, 40)}」已埋 ${number - item.plantedAt} 章仍未回收`, {
        chapter: item.plantedAt,
      })
    }

    const missingSummaries = []
    for (const chapter of allChapters.filter((item) => Number(item.number) <= number)) {
      if (!(await this.readChapterSummary(agent, chapter.number))) missingSummaries.push(Number(chapter.number))
    }
    if (missingSummaries.length > 0) {
      push('note', 'SUMMARY_BACKLOG', `${missingSummaries.length} 章还没有摘要，可在项目页补全`, { chapters: missingSummaries })
    }

    const status = issues.some((issue) => issue.level === 'error') ? 'fail' : issues.some((issue) => issue.level === 'warn') ? 'warn' : 'pass'
    const result = {
      number,
      status,
      issues,
      checkedAt: now(),
      ai: false,
      summaryCount: allChapters.filter((item) => Number(item.number) <= number).length,
      paragraphCount: textParagraphs.length,
    }
    const saved = await this.saveContinuity(agent, number, result).catch(() => null)
    return saved ?? result
  }

  async saveContinuity(agent, number, result) {
    const paths = this.chapterPaths(number)
    const previous = await this.readJson(agent, paths.continuity).catch(() => null)
    const saved = {
      ...result,
      applied: previous?.applied ?? {},
      updatedAt: now(),
    }
    await this.writeJson(agent, paths.continuity, saved)
    return saved
  }

  async markContinuityIssues(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const keys = Array.isArray(options.issues) ? options.issues.map(String).filter(Boolean) : []
    if (!Number.isFinite(number) || number < 1 || keys.length === 0) return { applied: 0 }
    const paths = this.chapterPaths(number)
    const current =
      (await this.readJson(agent, paths.continuity).catch(() => null)) ?? { number, issues: [], applied: {} }
    const applied = { ...(current.applied ?? {}) }
    for (const key of keys) applied[key] = { at: now(), revision: options.revision ?? null }
    await this.writeJson(agent, paths.continuity, { ...current, applied, updatedAt: now() })
    return { applied: keys.length }
  }

  async continuityAudit(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const number = Number(options.number)
    const detail = await this.chapterDetail(agent, number)
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const previous = []
    for (const chapter of chapters.filter((item) => Number(item.number) < number).slice(-8)) {
      const summary = await this.readChapterSummary(agent, chapter.number)
      previous.push({
        number: chapter.number,
        title: chapter.title,
        outline: chapter,
        summary: summary?.summary ?? null,
        characters: summary?.characters ?? [],
        events: summary?.events ?? [],
      })
    }
    const bible = await this.readBible(agent).catch(() => null)
    const system = await this.systemFor(agent, 'continuity', CONTINUITY_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: [
          `当前章：第 ${number} 章`,
          `章纲：${JSON.stringify(detail.chapter)}`,
          `前文摘要：${JSON.stringify(previous)}`,
          `设定：${JSON.stringify(bible?.characters ?? [])}`,
        ].join('\n\n'),
      }],
    }]
    const generated = await this.callJsonModel(agent, {
      kind: 'chapter.continuity',
      task: 'continuity',
      number,
      system,
      messages,
      signal,
      maxTokens: 2500,
      temperature: 0.2,
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const issues = Array.isArray(parsed.issues) ? parsed.issues.map((issue) => ({
      level: issue.level === 'error' ? 'error' : 'warn',
      code: 'AI_CONTINUITY',
      message: String(issue.message ?? '').slice(0, 500),
      advice: String(issue.advice ?? '').slice(0, 500),
      chapter: Number(issue.chapter) || undefined,
    })) : []
    const result = { number, issues, checkedAt: now(), ai: true, status: issues.length ? 'warn' : 'pass' }
    const saved = await this.saveContinuity(agent, number, result).catch(() => null)
    return saved ?? result
  }

  async auditOutline(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    if (chapters.length === 0) throw new Error('还没有章纲可审查')
    const numbers = chapters.map((chapter) => Number(chapter.number) || 0).filter((number) => number > 0)
    const fromChapter = Math.max(1, Number(options.fromChapter ?? 1) || 1)
    const toChapter = Math.max(fromChapter, Number(options.toChapter ?? Math.max(...numbers)) || Math.max(...numbers))
    const inRange = chapters.filter((chapter) => Number(chapter.number) >= fromChapter && Number(chapter.number) <= toChapter)
    const context = chapters.filter(
      (chapter) => Number(chapter.number) === fromChapter - 1 || Number(chapter.number) === toChapter + 1,
    )
    const bible = await this.readBible(agent).catch(() => ({ characters: [], rules: [], locations: [] }))
    const power = await this.readPower(agent).catch(() => null)
    const premise = await this.readJson(agent, 'story/premise.json').catch(() => null)
    const slim = (chapter) => ({
      number: chapter.number,
      title: chapter.title,
      synopsis: chapter.synopsis || '',
    })
    const system = await this.systemFor(agent, 'outlineAudit', OUTLINE_AUDIT_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: [
          `项目：${premise?.chosen?.premise ?? outline?.logline ?? ''}`,
          `审查范围：第 ${fromChapter}–${toChapter} 章`,
          `角色：${JSON.stringify((bible.characters ?? []).map((entry) => ({ name: entry.name, role: entry.role, description: entry.description })))}`,
          `规则：${JSON.stringify((bible.rules ?? []).map((entry) => ({ name: entry.name, description: entry.description })))}`,
          `地点：${JSON.stringify((bible.locations ?? []).map((entry) => ({ name: entry.name, description: entry.description })))}`,
          `能力体系：${JSON.stringify(power ? { system: power.system, characters: power.characters, chapterChanges: power.chapterChanges } : null)}`,
          `章纲（JSON）：${JSON.stringify([...inRange, ...context].map(slim))}`,
        ].join('\n\n'),
      }],
    }]
    const generated = await this.callJsonModel(agent, {
      kind: 'outline.audit',
      task: 'outline',
      system,
      messages,
      signal,
      maxTokens: 5000,
      temperature: 0.2,
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue) => ({
          level: issue.level === 'error' ? 'error' : 'warn',
          number: Number(issue.number) || null,
          message: String(issue.message ?? '').slice(0, 400),
          advice: String(issue.advice ?? '').slice(0, 400),
        })).filter((issue) => issue.message)
      : []
    const result = {
      fromChapter,
      toChapter,
      issues,
      checkedAt: now(),
      runId: generated.runId,
    }
    await this.writeJson(agent, 'story/plot/outline-audit.json', result)
    return result
  }

  async repairOutlineIssues(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const issues = Array.isArray(options.issues) ? options.issues : []
    const userRequirement = String(options.instruction ?? '').trim()
    if (issues.length === 0) return { repaired: [] }
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const numbers = [...new Set(issues.map((issue) => Number(issue.number)).filter((n) => Number.isFinite(n) && n > 0))]
    const targets = chapters.filter((chapter) => numbers.includes(Number(chapter.number)))
    if (targets.length === 0) return { repaired: [] }
    const context = chapters.filter((chapter) =>
      targets.some((target) => Math.abs(Number(target.number) - Number(chapter.number)) === 1),
    )
    const bible = await this.readBible(agent).catch(() => ({ characters: [], rules: [], locations: [] }))
    const power = await this.readPower(agent).catch(() => null)
    const slim = (chapter) => ({
      number: chapter.number,
      title: chapter.title,
      synopsis: chapter.synopsis || '',
    })
    const system = await this.systemFor(agent, 'outlineRepair', OUTLINE_REPAIR_SYSTEM_PROMPT)
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: [
          `受影响章：${JSON.stringify(targets.map(slim))}`,
          `上下文章：${JSON.stringify(context.map(slim))}`,
          `冲突清单：${JSON.stringify(issues)}`,
          userRequirement ? `用户本次额外要求（不得违背）：${userRequirement}` : '',
          `角色设定：${JSON.stringify((bible.characters ?? []).map((entry) => ({ name: entry.name, role: entry.role, description: entry.description })))}`,
          `规则：${JSON.stringify((bible.rules ?? []).map((entry) => ({ name: entry.name, description: entry.description })))}`,
          `能力体系：${JSON.stringify(power ? { system: power.system, characters: power.characters, chapterChanges: power.chapterChanges } : null)}`,
        ].filter(Boolean).join('\n\n'),
      }],
    }]
    const generated = await this.callJsonModel(agent, {
      kind: 'outline.repair',
      task: 'outline',
      system,
      messages,
      signal,
      maxTokens: 6000,
      temperature: 0.3,
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const patches = Array.isArray(parsed.chapters) ? parsed.chapters : []
    if (patches.length === 0) return { repaired: [] }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await this.writeJson(agent, `story/plot/backups/outline-${stamp}.json`, outline).catch(() => {})
    const repaired = []
    for (const patch of patches) {
      const target = chapters.find((chapter) => Number(chapter.number) === Number(patch.number))
      if (!target) continue
      for (const key of ['title', 'synopsis']) {
        if (typeof patch[key] === 'string' && patch[key].trim()) target[key] = patch[key]
      }
      target.status = 'candidate'
      target.editedAt = now()
      repaired.push(Number(target.number))
    }
    if (repaired.length === 0) return { repaired: [] }
    outline.status = 'candidate'
    outline.updatedAt = now()
    await this.writeJson(agent, 'story/plot/outline.json', outline)
    return { repaired }
  }

  async syncOutlineChapters(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const numbers = Array.isArray(options.numbers)
      ? [...new Set(options.numbers.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))]
      : []
    if (numbers.length === 0) return { revised: [], stale: [], skipped: [] }
    const instructionBase = String(options.instruction ?? '').trim()
    const audit = await this.readJson(agent, 'story/plot/outline-audit.json').catch(() => null)
    const revised = []
    const stale = []
    const skipped = []
    for (const number of numbers.sort((a, b) => a - b)) {
      if (signal?.aborted) break
      const detail = await this.chapterDetail(agent, number).catch(() => null)
      if (!detail?.draft) {
        skipped.push(number)
        continue
      }
      const related = (audit?.issues ?? [])
        .filter((issue) => Number(issue.number) === number)
        .map((issue) => `${issue.message}${issue.advice ? `（建议：${issue.advice}）` : ''}`)
      const instruction =
        instructionBase || `按更新后的章纲与大纲审查意见调整本章细节，保持文风与人设：${related.join('；') || '对齐新章纲的时间线与因果'}`
      const result = await this.reviseChapter(agent, { number, instruction }, signal).catch(() => null)
      if (result) revised.push(number)
      else skipped.push(number)
      if (detail.final) {
        const paths = this.chapterPaths(number)
        const meta = (await this.readJson(agent, paths.meta).catch(() => null)) ?? {}
        await this.writeJson(agent, paths.meta, { ...meta, finalStale: true, updatedAt: now() }).catch(() => {})
        stale.push(number)
      }
    }
    return { revised, stale, skipped }
  }

  async approveChapter(agent, options = {}) {
    await this.assertInitialized(agent)
    const number = Number(options.number ?? options.chapter ?? options.chapterNumber)
    const { chapter } = await this.findOutlineChapter(agent, number)
    if (!chapter) throw new Error(`找不到第 ${number} 章章纲`)
    const paths = this.chapterPaths(number)
    const draft = await this.readText(agent, paths.draft).catch(() => null)
    if (!draft) throw new Error(`第 ${number} 章还没有草稿，无法定稿`)
    await this.writeTextFile(agent, paths.final, draft)
    const meta = {
      ...((await this.readJson(agent, paths.meta).catch(() => null)) ?? {}),
      chapterId: chapter.id,
      number,
      title: chapter.title,
      status: 'approved',
      wordCount: countChars(draft),
      updatedAt: now(),
      approvedAt: now(),
      finalStale: false,
    }
    this.reportStage('summary', '生成本章摘要')
    // 摘要生成（模型调用）在事务外，写库与状态更新进一个事务。
    const summary = await this.summarizeChapter(agent, { number, text: draft, deferWrite: true }).catch(() => null)
    if (summary) {
      meta.summary = summary.summary
      meta.summaryAt = summary.generatedAt
    }
    const store = await this.storeFor(agent)
    let stateEntry = null
    let stateRow = null
    try {
      const collected = await this.stateSnapshot(agent, { chapter, meta, paths, summary: summary?.summary, write: false })
      stateEntry = collected.entry
      stateRow = collected.row
    } catch {
      stateEntry = null
    }
    store.tx(() => {
      if (this.failHook) this.failHook('approve')
      store.writeChapterMeta(number, meta)
      if (summary) store.writeChapterSummary(number, summary)
      if (stateRow) store.writeChapterState(number, stateRow)
      store.writeStateMeta(now())
      store.appendStatsEvent({ number, words: meta.wordCount, action: 'approve' })
    })
    return { number, finalPath: paths.final, wordCount: meta.wordCount, approvedAt: meta.approvedAt, stateEntry, summary: summary?.summary ?? null }
  }

  async approveAllDrafts(agent, options = {}, signal) {    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const results = []
    for (const chapter of chapters.sort((a, b) => Number(a.number) - Number(b.number))) {
      if (signal?.aborted) break
      const detail = await this.chapterDetail(agent, chapter.number).catch(() => null)
      if (!detail?.draft || detail?.final) continue
      try {
        this.reportStage('approve', `定稿第 ${chapter.number} 章`)
        const result = await this.approveChapter(agent, { number: chapter.number })
        results.push({ number: chapter.number, ok: true, wordCount: result.wordCount })
      } catch (error) {
        results.push({ number: chapter.number, ok: false, error: errorText(error) })
      }
    }
    // 批量定稿结束统一截断 WAL（每章的状态写入仍各自在一个事务内）。
    const store = await this.storeFor(agent).catch(() => null)
    if (store && results.some((item) => item.ok)) store.checkpoint()
    return { results, count: results.filter((item) => item.ok).length }
  }

  async approveVolumeDrafts(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const volumeId = String(options.volumeId ?? '')
    if (!volumeId) throw new Error('请指定卷')
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const volume = (outline?.volumes ?? []).find((item) => item.id === volumeId)
    if (!volume) throw new Error('找不到卷')
    const chapters = (volume.chapters ?? []).slice().sort((a, b) => Number(a.number) - Number(b.number))
    const results = []
    for (const chapter of chapters) {
      if (signal?.aborted) break
      const detail = await this.chapterDetail(agent, chapter.number).catch(() => null)
      if (!detail?.draft || detail?.final) continue
      try {
        this.reportStage('approve', `定稿第 ${chapter.number} 章`)
        const result = await this.approveChapter(agent, { number: chapter.number })
        results.push({ number: chapter.number, ok: true, wordCount: result.wordCount })
      } catch (error) {
        results.push({ number: chapter.number, ok: false, error: errorText(error) })
      }
    }
    // 批量定稿结束统一截断 WAL（每章的状态写入仍各自在一个事务内）。
    const store = await this.storeFor(agent).catch(() => null)
    if (store && results.some((item) => item.ok)) store.checkpoint()
    return { results, count: results.filter((item) => item.ok).length }
  }

  async approveStaleFinals(agent, options = {}, signal) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const results = []
    for (const chapter of chapters.sort((a, b) => Number(a.number) - Number(b.number))) {
      if (signal?.aborted) break
      const paths = this.chapterPaths(chapter.number)
      const meta = await this.readJson(agent, paths.meta).catch(() => null)
      if (!meta?.finalStale) continue
      try {
        this.reportStage('approve', `刷新第 ${chapter.number} 章定稿`)
        const result = await this.approveChapter(agent, { number: chapter.number })
        results.push({ number: chapter.number, ok: true, wordCount: result.wordCount })
      } catch (error) {
        results.push({ number: chapter.number, ok: false, error: errorText(error) })
      }
    }
    // 批量定稿结束统一截断 WAL（每章的状态写入仍各自在一个事务内）。
    const store = await this.storeFor(agent).catch(() => null)
    if (store && results.some((item) => item.ok)) store.checkpoint()
    return { results, count: results.filter((item) => item.ok).length }
  }

  async stateSnapshot(agent, options) {
    const { chapter, meta, paths } = options
    const entry = {
      id: chapter.id,
      number: Number(chapter.number),
      title: chapter.title ?? '',
      status: 'approved',
      wordCount: meta?.wordCount ?? 0,
      summary: String(options.summary ?? '').trim() || String(chapter.synopsis ?? '').slice(0, 420),
      approvedAt: meta?.approvedAt ?? now(),
      finalPath: paths.final,
    }
    const row = {
      chapterId: chapter.id,
      number: Number(chapter.number),
      title: chapter.title ?? '',
      outline: chapter,
      meta,
      summary: entry.summary,
      approvedAt: entry.approvedAt,
    }
    // write=false 时只组装数据，由调用方在同一事务里落库（approveChapter 使用）。
    if (options.write !== false) {
      await this.writeJson(agent, `story/state/${paths.pad}.json`, row)
      await this.writeJson(agent, 'story/state/index.json', { chapters: [], updatedAt: now() })
    }
    return { entry, row }
  }
}
