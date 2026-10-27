import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile, cp, rm, readdir, stat as fsStat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import {
  BIBLE_SYSTEM_PROMPT,
  BIBLE_CHARACTERS_SYSTEM_PROMPT,
  BIBLE_WORLD_SYSTEM_PROMPT,
  CHAPTER_REVIEW_SYSTEM_PROMPT,
  CHAPTER_SYSTEM_PROMPT,
  CONTINUITY_SYSTEM_PROMPT,
  DECONSTRUCT_SYSTEM_PROMPT,
  DISCUSSION_SYSTEM_PROMPT,
  INSPIRATION_SYSTEM_PROMPT,
  OUTLINE_AUDIT_SYSTEM_PROMPT,
  OUTLINE_REPAIR_SYSTEM_PROMPT,
  OUTLINE_SYSTEM_PROMPT,
  PREMISE_INTENT_SYSTEM_PROMPT,
  PREMISE_SYSTEM_PROMPT,
  PROMPT_CATALOG,
  REVERSE_OUTLINE_SYSTEM_PROMPT,
  STYLE_AUDIT_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  VOLUME_PLAN_SYSTEM_PROMPT,
  buildBibleUserPrompt,
  buildBibleCharactersUserPrompt,
  buildBibleWorldUserPrompt,
  buildReverseOutlineUserPrompt,
  buildVolumePlanUserPrompt,
  buildChapterUserPrompt,
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
const MODEL_TASKS = ['premise', 'bible', 'outline', 'draft', 'revise', 'fix', 'audit', 'discussion', 'summary', 'continuity']
const progressContext = new AsyncLocalStorage()

export function runWithProgress(progress, fn) {
  return progressContext.run(progress, fn)
}

const PROJECT_PROMPT_PATH = 'story/prompt.json'
const DSH_HOME = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const GLOBAL_PROMPT_DIR = join(DSH_HOME, 'novel-writer')
const GLOBAL_PROMPT_PATH = join(GLOBAL_PROMPT_DIR, 'prompt-injection.json')
const PROSE_PROMPT_TASKS = ['draft', 'revise', 'fix']

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

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function countChars(text) {
  return String(text ?? '').replace(/\s+/g, '').length
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

  async policy(agent) {
    if (typeof agent === 'string') {
      return { mode: 'workspace-write', workspaceRoot: agent }
    }
    return this.ctx.sandboxPolicy.resolve({ session: agent.session })
  }

  async readJson(agent, relativePath) {
    const cwd = await this.cwd(agent)
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
      }
      return { text, usage, finish }
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

    const files = [
      [
        this.marker,
        {
          schemaVersion: SCHEMA_VERSION,
          layoutVersion: LAYOUT_VERSION,
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

    return { initialized: true, cwd, title, written, next: 'premise' }
  }

  async uninitializeProject(agent) {
    const cwd = await this.cwd(agent)
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

  async projectStatus(agent) {
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

    const project = await this.readJson(agent, this.marker)
    const premise = await this.readJson(agent, 'story/premise.json')
    const style = await this.readJson(agent, 'story/style/contract.json')
    const bible = await this.readBible(agent)
    const power = await this.readPower(agent).catch(() => null)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const state = await this.readJson(agent, 'story/state/index.json')

    let chapters = 0
    try {
      const target = await this.ctx.fs.resolve('story/chapters', { cwd })
      const entries = await this.ctx.fs.listDir(target)
      chapters = entries.filter((entry) => entry.type === 'directory').length
    } catch {
      chapters = 0
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
    const characterIndex = await this.buildCharacterIndex(agent)
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
    const cwd = await this.cwd(agent)
    try {
      const dir = await this.ctx.fs.resolve('story/style/templates', { cwd })
      const entries = await this.ctx.fs.listDir(dir)
      const templates = []
      for (const entry of entries.filter((item) => item.type === 'file' && item.name.endsWith('.json'))) {
        const raw = await this.readJson(agent, `story/style/templates/${entry.name}`).catch(() => null)
        if (raw?.fields) {
          templates.push({
            id: raw.id ?? entry.name.replace(/\.json$/, ''),
            name: raw.name ?? raw.id ?? entry.name,
            fields: raw.fields,
            builtin: false,
          })
        }
      }
      return templates
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
    const cwd = await this.cwd(agent)
    const target = await this.ctx.fs.resolve(`story/style/templates/${id}.json`, { cwd })
    const hostPath = this.ctx.fs.processPath?.(target)
    if (!hostPath) throw new Error('无法解析模板路径')
    await unlink(hostPath)
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
    const allowed = ['pov', 'tense', 'chapterWords', 'sentenceLength', 'paragraphLength', 'dialogueRatio', 'metaphorDensity', 'bannedWords', 'chapterTitleStyle', 'notes']
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
    return data && typeof data === 'object' ? data : {}
  }

  async systemFor(agent, key, fallback) {
    const overrides = await this.readSystemOverrides(agent)
    const value = overrides?.[key]
    return typeof value === 'string' && value.trim() ? value : fallback
  }

  async saveSystemOverrides(agent, overrides = {}) {
    await this.assertInitialized(agent)
    const keys = new Set(PROMPT_CATALOG.map((entry) => entry.key))
    const clean = {}
    for (const key of keys) {
      const value = overrides?.[key]
      if (typeof value === 'string' && value.trim()) clean[key] = value.trim().slice(0, 20000)
    }
    await this.writeJson(agent, 'story/prompts/system.json', clean)
    return clean
  }

  async promptCatalog(agent) {
    const overrides = await this.readSystemOverrides(agent)
    const prompts = PROMPT_CATALOG.map((entry) => {
      const custom = typeof overrides?.[entry.key] === 'string' && overrides[entry.key].trim()
        ? overrides[entry.key]
        : ''
      const content = custom || entry.default
      return {
        key: entry.key,
        label: entry.label,
        category: entry.category,
        description: entry.description,
        content,
        default: entry.default,
        customized: Boolean(custom),
        hash: this.hashInputs(content).slice(0, 16),
        defaultHash: this.hashInputs(entry.default).slice(0, 16),
      }
    })
    return { prompts }
  }

  async saveSystemPrompt(agent, options = {}) {
    await this.assertInitialized(agent)
    const key = String(options.key ?? '')
    if (!PROMPT_CATALOG.some((entry) => entry.key === key)) throw new Error(`未知提示词：${key}`)
    const overrides = await this.readSystemOverrides(agent)
    const content = typeof options.content === 'string' ? options.content.trim().slice(0, 20000) : ''
    if (content) overrides[key] = content
    else delete overrides[key]
    await this.writeJson(agent, 'story/prompts/system.json', overrides)
    return this.promptCatalog(agent)
  }

  async resetSystemPrompt(agent, options = {}) {
    await this.assertInitialized(agent)
    const key = String(options.key ?? '')
    if (!PROMPT_CATALOG.some((entry) => entry.key === key)) throw new Error(`未知提示词：${key}`)
    const overrides = await this.readSystemOverrides(agent)
    delete overrides[key]
    await this.writeJson(agent, 'story/prompts/system.json', overrides)
    return this.promptCatalog(agent)
  }

  async exportSystemPrompts(agent) {
    const overrides = await this.readSystemOverrides(agent)
    return {
      version: 1,
      exportedAt: now(),
      prompts: PROMPT_CATALOG.map((entry) => ({
        key: entry.key,
        label: entry.label,
        customized: typeof overrides?.[entry.key] === 'string' && Boolean(overrides[entry.key].trim()),
        content: typeof overrides?.[entry.key] === 'string' && overrides[entry.key].trim()
          ? overrides[entry.key]
          : entry.default,
      })),
    }
  }

  async importSystemPrompts(agent, options = {}) {
    await this.assertInitialized(agent)
    const source = options.data && typeof options.data === 'object' ? options.data : options
    const incoming = Array.isArray(source.prompts)
      ? source.prompts
      : (Array.isArray(source.systemPrompts) ? source.systemPrompts : [])
    const known = new Set(PROMPT_CATALOG.map((entry) => entry.key))
    const overrides = await this.readSystemOverrides(agent)
    let imported = 0
    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue
      const key = String(item.key ?? '')
      if (!known.has(key)) continue
      if (item.customized === false) {
        delete overrides[key]
        continue
      }
      const content = typeof item.content === 'string' ? item.content.trim().slice(0, 20000) : ''
      if (!content) continue
      overrides[key] = content
      imported += 1
    }
    await this.writeJson(agent, 'story/prompts/system.json', overrides)
    return { imported, catalog: await this.promptCatalog(agent) }
  }

  async buildHealthReport(agent) {
    await this.assertInitialized(agent)
    const bible = await this.readBible(agent).catch(() => ({ characters: [] }))
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const chapterStats = await this.chaptersSummary(agent).catch(() => [])
    const relations = (await this.readRelations(agent).catch(() => ({ relations: [] }))).relations
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
    const overWords = chapterStats.filter((item) => {
      const chapter = chapters.find((entry) => Number(entry.number) === Number(item.number))
      const target = Number(chapter?.wordBudget ?? 0)
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
    const orphans = await this.findOrphans(agent).catch(() => ({ chapterDirs: [], stateFiles: [] }))
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
    const dir = await this.ctx.fs.resolve('.dsh-writing/runs', { cwd })
    let entries = []
    try {
      entries = await this.ctx.fs.listDir(dir)
    } catch {
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
    const system = await this.systemFor(agent, 'deconstruct', DECONSTRUCT_SYSTEM_PROMPT)
    const messages = [{ role: 'user', content: [{ type: 'text', text: `标题：${title}\n\n文本：\n${text.slice(0, 12000)}` }] }]
    const generated = await this.callJsonModel(agent, {
      kind: 'deconstruct.analyze',
      task: 'outline',
      system,
      messages,
      signal,
      maxTokens: 6000,
      temperature: 0.4,
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const analysis = {
      title,
      summary: String(parsed.summary ?? '').slice(0, 2000),
      style: parsed.style && typeof parsed.style === 'object' ? parsed.style : {},
      characters: Array.isArray(parsed.characters) ? parsed.characters.slice(0, 30) : [],
      hooks: Array.isArray(parsed.hooks) ? parsed.hooks.map(String).slice(0, 30) : [],
    }
    const path = '.dsh-writing/deconstructions.json'
    const data = (await this.readJson(agent, path).catch(() => null)) ?? { items: [] }
    const items = [{ ...analysis, createdAt: now() }, ...(Array.isArray(data.items) ? data.items : [])].slice(0, 10)
    await this.writeJson(agent, path, { items, updatedAt: now() })
    return { analysis, items }
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
    let volume = volumes.find((item) => item.id === requestedVolumeId) ??
      volumes[0] ?? { id: 'vol-1', title: '第一卷', goal: '', chapters: [] }
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
      instruction: `${dir}/instruction.json`,
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
    for (const number of tail) {
      const paths = this.chapterPaths(number)
      try {
        const dirTarget = await this.ctx.fs.resolve(paths.dir, { cwd })
        const dirHost = this.ctx.fs.processPath?.(dirTarget)
        if (dirHost) {
          await rm(dirHost, { recursive: true, force: true })
          removed.push(paths.dir)
        }
      } catch {
        // ignore
      }
      try {
        const stateTarget = await this.ctx.fs.resolve(`story/state/${paths.pad}.json`, { cwd })
        const stateHost = this.ctx.fs.processPath?.(stateTarget)
        if (stateHost) {
          await unlink(stateHost)
          removed.push(`story/state/${paths.pad}.json`)
        }
      } catch {
        // ignore
      }
    }
    const tailSet = new Set(tail)
    for (const volume of volumes) {
      volume.chapters = (volume.chapters ?? []).filter((chapter) => !tailSet.has(Number(chapter.number)))
    }
    outline.updatedAt = now()
    await this.writeJson(agent, 'story/plot/outline.json', outline)
    const state = await this.readJson(agent, 'story/state/index.json').catch(() => null)
    if (state && Array.isArray(state.chapters)) {
      state.chapters = state.chapters.filter((entry) => !tailSet.has(Number(entry.number)))
      state.updatedAt = now()
      await this.writeJson(agent, 'story/state/index.json', state)
    }
    return { ...preview, removed, snapshot }
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
    const pendingInstruction = await this.readJson(agent, paths.instruction).catch(() => null)
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
      qa,
      styleQa,
      pendingInstruction,
      continuity,
      summary,
      revisions,
      wordCount: meta?.wordCount ?? countChars(draft ?? final ?? ''),
    }
  }

  async chaptersSummary(agent) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) =>
      (volume.chapters ?? []).map((chapter) => ({
        ...chapter,
        volumeId: chapter.volumeId ?? volume.id,
        volumeTitle: volume.title,
      })),
    )
    const cwd = await this.cwd(agent)
    const list = []
    for (const chapter of chapters) {
      const paths = this.chapterPaths(chapter.number)
      const meta = await this.readJson(agent, paths.meta).catch(() => null)
      const summary = await this.readChapterSummary(agent, chapter.number).catch(() => null)
      let hasDraft = false
      let hasFinal = false
      try {
        const target = await this.ctx.fs.resolve(paths.draft, { cwd })
        hasDraft = Boolean(await this.ctx.fs.stat(target))
      } catch {
        hasDraft = false
      }
      try {
        const target = await this.ctx.fs.resolve(paths.final, { cwd })
        hasFinal = Boolean(await this.ctx.fs.stat(target))
      } catch {
        hasFinal = false
      }
      const qa = hasDraft ? await this.readJson(agent, paths.qa).catch(() => null) : null
      const styleQa = hasDraft ? await this.readJson(agent, paths.styleQa).catch(() => null) : null
      list.push({
        number: Number(chapter.number),
        title: chapter.title || `第 ${chapter.number} 章`,
        volumeId: chapter.volumeId,
        volumeTitle: chapter.volumeTitle,
        summary: summary?.summary ?? meta?.summary ?? '',
        outlineStatus: chapter.status ?? 'candidate',
        status: meta?.status ?? (hasDraft ? 'drafted' : 'planned'),
        wordCount: meta?.wordCount ?? 0,
        hasDraft,
        hasFinal,
        qaStatus: qa?.status ?? null,
        styleStatus: styleQa?.status ?? null,
        styleScore: styleQa?.score ?? null,
        finalStale: Boolean(meta?.finalStale),
      })
    }
    return list
  }

  async storyOverview(agent) {
    await this.assertInitialized(agent)
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const state = await this.readJson(agent, 'story/state/index.json').catch(() => null)
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

  async searchProject(agent, options = {}) {
    await this.assertInitialized(agent)
    const query = String(options.query ?? '').trim()
    if (!query) return { query, results: [], total: 0 }
    const needle = query.toLowerCase()
    const results = []
    const add = (source, title, text, extra = {}) => {
      const haystack = String(text ?? '')
      const index = haystack.toLowerCase().indexOf(needle)
      if (index < 0) return false
      const start = Math.max(0, index - 42)
      const end = Math.min(haystack.length, index + query.length + 72)
      results.push({
        source,
        title,
        snippet: `${start > 0 ? '…' : ''}${haystack.slice(start, end).replace(/\s+/g, ' ')}${end < haystack.length ? '…' : ''}`,
        ...extra,
      })
      return true
    }
    const outline = await this.readJson(agent, 'story/plot/outline.json')
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    for (const chapter of chapters) {
      const number = Number(chapter.number)
      const title = `第 ${number} 章 ${chapter.title || ''}`.trim()
      add('outline', title, [
        chapter.title,
        chapter.synopsis,
      ].filter(Boolean).join(' '), { number })
      const paths = this.chapterPaths(number)
      const final = await this.readText(agent, paths.final).catch(() => null)
      const draft = await this.readText(agent, paths.draft).catch(() => null)
      if (final || draft) add('chapter', title, final ?? draft, { number })
      if (results.length >= 60) break
    }
    const bible = await this.readBible(agent)
    for (const category of BIBLE_CATEGORIES) {
      for (const entry of bible[category] ?? []) {
        add('bible', `${BIBLE_LABELS[category]} · ${entry.name}`, [entry.name, entry.role, entry.description].filter(Boolean).join(' '), {
          category,
          id: entry.id,
        })
        if (results.length >= 60) break
      }
    }
    try {
      const cwd = await this.cwd(agent)
      const target = await this.ctx.fs.resolve('.dsh-writing/discussions', { cwd })
      const entries = await this.ctx.fs.listDir(target)
      for (const entry of entries.filter((item) => item.type === 'file' && item.name.endsWith('.json'))) {
        const thread = await this.readJson(agent, `.dsh-writing/discussions/${entry.name}`).catch(() => null)
        if (!thread) continue
        const text = (thread.messages ?? []).map((message) => message.text).join('\n')
        add('discussion', thread.topic || entry.name, text, { topicId: thread.topicId ?? null })
      }
    } catch {
      // discussion folder may not exist
    }
    return { query, results: results.slice(0, 60), total: results.length }
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
    const system = hasRange
      ? `${reviseBase}\n- 这是局部重写任务：只重写指定段落，保持其他段落与前后衔接不变。`
      : `${reviseBase}\n- 这是修订任务：在保留章纲事实与前文衔接的前提下，按修订要求重写整章。`
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
    await this.writeJson(agent, this.chapterSummaryPath(number), summary)
    const meta = (await this.readJson(agent, this.chapterPaths(number).meta).catch(() => null)) ?? {}
    await this.writeJson(agent, this.chapterPaths(number).meta, {
      ...meta,
      summary: summary.summary,
      summaryAt: summary.generatedAt,
    })
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
    return { results, count: results.filter((item) => item.ok).length }
  }

  async buildCharacterIndex(agent) {
    const outline = await this.readJson(agent, 'story/plot/outline.json').catch(() => null)
    const chapters = (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
    const bible = await this.readBible(agent).catch(() => ({ characters: [] }))
    const known = new Set((bible.characters ?? []).map((entry) => entry.name))
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
      const summary = await this.readChapterSummary(agent, chapter.number)
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
    await this.writeJson(agent, paths.meta, meta)
    this.reportStage('summary', '生成本章摘要')
    const summary = await this.summarizeChapter(agent, { number, text: draft }).catch(() => null)
    const stateEntry = await this.stateSnapshot(agent, { chapter, meta, paths, summary: summary?.summary })
    await this.recordWritingEvent(agent, { number, words: meta.wordCount, action: 'approve' })
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
    return { results, count: results.filter((item) => item.ok).length }
  }

  async readDiscussion(root, topicId) {
    const thread = await this.readJson(root, `.dsh-writing/discussions/${topicId}.json`).catch(() => null)
    return thread ?? { topicId, topic: '', messages: [], updatedAt: null }
  }

  async buildDiscussionContext(root, options, thread) {
    const topicId = String(options.topicId ?? 'general')
    const topic = String(options.topic ?? '创作讨论')
    const message = String(options.message ?? '').trim()
    const item = options.item ?? null
    const parts = [`讨论对象：${topic}`]
    if (item) parts.push(`对象内容：${JSON.stringify(item).slice(0, 4000)}`)
    const chapterNumber = Number(item?.number ?? String(topicId).match(/chapter-(\d+)/)?.[1])
    const isChapterTopic = String(topicId).startsWith('chapter-') || item?.kind === 'chapter'
    if (isChapterTopic && Number.isFinite(chapterNumber) && chapterNumber > 0) {
      try {
        const detail = await this.chapterDetail(root, chapterNumber)
        parts.push(`本章章纲（必须遵守，不要另起设定）：${JSON.stringify(detail.chapter).slice(0, 3000)}`)
        const story = await this.buildStoryContext(root, detail.chapter, chapterNumber)
        parts.push(`相关设定与上下文（人物/地点/规则/最近章节/伏笔/时间线）：${JSON.stringify(story).slice(0, 6000)}`)
        if (detail.pendingInstruction?.instruction) {
          parts.push(`已载入的待用修订要求：${String(detail.pendingInstruction.instruction).slice(0, 1200)}`)
        }
        const currentText = detail.draft ?? detail.final ?? ''
        if (currentText) parts.push(`本章当前正文（节选）：${String(currentText).slice(0, 5000)}`)
      } catch {
        // outline may be missing; item excerpt is still usable
      }
    }
    const historyText = (thread.messages ?? [])
      .slice(-6)
      .map((entry) => `${entry.role === 'assistant' ? '助手' : '用户'}：${String(entry.text ?? '').slice(0, 800)}`)
      .join('\n')
    if (historyText) parts.push(`先前讨论：\n${historyText}`)
    try {
      const outline = await this.readJson(root, 'story/plot/outline.json').catch(() => null)
      const bible = await this.readBible(root).catch(() => null)
      const premise = await this.readJson(root, 'story/premise.json').catch(() => null)
      const targetIndex = {
        chapters: (outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
          .slice(0, 120)
          .map((chapter) => ({ number: Number(chapter.number), title: chapter.title || '' })),
        bible: BIBLE_CATEGORIES.flatMap((category) => (bible?.[category] ?? []).slice(0, 30).map((entry) => ({
          category,
          id: entry.id,
          name: entry.name,
        }))),
        style: true,
        premiseCandidates: (premise?.candidates ?? []).slice(0, 10).map((candidate) => ({ id: candidate.id, title: candidate.title })),
      }
      parts.push(`【可操作对象索引（关联修改时用于 target）】${JSON.stringify(targetIndex).slice(0, 6000)}`)
    } catch {
      // optional index
    }
    parts.push('', '用户说：', message)
    return parts.filter(Boolean).join('\n')
  }

  async discussionSystemPrompt(agent, topicId = '', item = null) {
    const kind = String(topicId).startsWith('chapter-')
      ? 'chapter'
      : String(topicId).startsWith('outline-')
        ? 'outline'
        : String(topicId).startsWith('bible-')
          ? 'bible'
          : String(topicId) === 'style'
            ? 'style'
            : String(topicId).startsWith('premise-')
              ? 'premise'
              : 'other'
    const allowed = kind === 'other'
      ? []
      : [
          'chapter-instruction（target: {"kind":"chapter","number":章节号}；instruction 必须是可直接执行的修订说明）',
          'outline-update（target: {"kind":"outline","number":章节号} 或 {"kind":"outline","id":"章纲 id"}；fields: title/synopsis/wordBudget）',
          'bible-update（target: {"kind":"bible","category":"characters|locations|rules|factions|items","id":"条目 id"}；fields: name/role/description）',
          'style-update（target: {"kind":"style"}；fields: 文风字段）',
          'premise-candidate-update（target: {"kind":"premise","id":"候选 id"}；fields: title/premise/protagonist/genre）',
        ]
    const base = await this.systemFor(agent, 'discussion', DISCUSSION_SYSTEM_PROMPT)
    return [
      base,
      '当前对象已锁定；只有缺少关键信息时才 clarify。需要澄清时给 2–4 个 options，并允许用户自定义回答。',
      '如果修改的是关联对象，action.target 必须写清楚；不写 target 时默认当前对象。不要修改未在 target 中声明的对象。',
      allowed.length
        ? `actions 只允许：${allowed.join('；')}。没有明确、可落盘的修改时 actions 必须为空数组，不要为了凑数生成动作。`
        : 'actions 必须为空数组。',
    ].join('\n')
  }

  normalizeDiscussionActions(raw, options = {}) {
    if (!Array.isArray(raw)) return []
    const allowedFields = {
      outline: ['title', 'synopsis', 'wordBudget'],
      bible: ['name', 'role', 'description'],
      style: ['pov', 'tense', 'chapterWords', 'sentenceLength', 'paragraphLength', 'dialogueRatio', 'metaphorDensity', 'bannedWords', 'chapterTitleStyle', 'notes'],
      premise: ['title', 'premise', 'protagonist', 'genre'],
    }
    const typeKinds = {
      'chapter-instruction': 'chapter',
      'outline-update': 'outline',
      'bible-update': 'bible',
      'style-update': 'style',
      'premise-candidate-update': 'premise',
    }
    const normalizeTarget = (target, kind) => {
      if (!target || typeof target !== 'object') return null
      const targetKind = typeKinds[target.kind] ?? target.kind
      if (!['chapter', 'outline', 'bible', 'style', 'premise'].includes(targetKind)) return null
      const normalized = { kind: targetKind }
      if (target.number !== undefined) {
        const number = Number(target.number)
        if (Number.isFinite(number) && number > 0) normalized.number = number
      }
      if (target.id !== undefined) normalized.id = String(target.id).slice(0, 120)
      if (target.category !== undefined) normalized.category = String(target.category).slice(0, 40)
      if (targetKind === kind && !normalized.number && !normalized.id && !normalized.category) return null
      return normalized
    }
    const out = []
    for (const action of raw) {
      if (!action || typeof action !== 'object') continue
      const type = String(action.type ?? '')
      const kind = typeKinds[type]
      if (!kind) continue
      const reason = String(action.reason ?? '').slice(0, 500)
      const target = normalizeTarget(action.target, kind)
      if (type === 'chapter-instruction') {
        const instruction = String(action.instruction ?? '').trim().slice(0, 3000)
        if (instruction) out.push({ type, instruction, target, reason })
      } else if (type === 'outline-update' || type === 'bible-update' || type === 'style-update' || type === 'premise-candidate-update') {
        const fields = {}
        for (const key of allowedFields[kind]) {
          if (action.fields?.[key] === undefined) continue
          const value = action.fields[key]
          if (key === 'chapterWords' || key === 'dialogueRatio') {
            const number = Number(value)
            if (Number.isFinite(number)) fields[key] = number
          } else if (Array.isArray(value)) {
            fields[key] = value.map(String).slice(0, 30)
          } else {
            fields[key] = String(value).slice(0, 1600)
          }
        }
        if (Object.keys(fields).length) out.push({ type, fields, target, reason })
      }
    }
    return out.slice(0, 8)
  }

  async discuss(root, options = {}) {
    const topicId = String(options.topicId ?? 'general')
    const topic = String(options.topic ?? '创作讨论')
    const message = String(options.message ?? '').trim()
    if (!message) throw new Error('讨论内容不能为空')
    const thread = await this.readDiscussion(root, topicId)
    const context = await this.buildDiscussionContext(root, options, thread)
    const system = await this.discussionSystemPrompt(root, topicId, options.item)
    const messages = [{ role: 'user', content: [{ type: 'text', text: context }] }]
    const generated = await this.callJsonModel(root, {
      kind: 'discussion.reply',
      task: 'discussion',
      system,
      messages,
      maxTokens: 6000,
      temperature: 0.8,
    })
    const parsed = generated.parsed && typeof generated.parsed === 'object' ? generated.parsed : {}
    const reply = String(parsed.reply ?? generated.text ?? '').trim()
    const actions = this.normalizeDiscussionActions(parsed.actions, options)
    const optionsList = Array.isArray(parsed.options)
      ? parsed.options.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : []
    const stage = ['reply', 'clarify', 'propose'].includes(parsed.stage)
      ? parsed.stage
      : (optionsList.length ? 'clarify' : actions.length ? 'propose' : 'reply')
    const result = {
      stage,
      question: String(parsed.question ?? '').trim().slice(0, 800),
      options: optionsList,
      allowCustom: parsed.allowCustom !== false,
      conclusion: String(parsed.conclusion ?? '').trim(),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
      todos: Array.isArray(parsed.todos) ? parsed.todos.map(String) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      actions,
    }
    const entryTime = now()
    const next = {
      topicId,
      topic,
      item: options.item ?? null,
      updatedAt: entryTime,
      messages: [
        ...(thread.messages ?? []),
        { role: 'user', text: message, time: entryTime },
        { role: 'assistant', text: reply, result, time: entryTime },
      ],
    }
    await this.writeJson(root, `.dsh-writing/discussions/${topicId}.json`, next)
    return { reply, result, messages: next.messages, usage: generated.usage, context }
  }

  async discussStream(root, options = {}, onDelta) {
    const topicId = String(options.topicId ?? 'general')
    const topic = String(options.topic ?? '创作讨论')
    const message = String(options.message ?? '').trim()
    if (!message) throw new Error('讨论内容不能为空')
    const thread = await this.readDiscussion(root, topicId)
    const context = await this.buildDiscussionContext(root, options, thread)
    const system = await this.discussionSystemPrompt(root, topicId, options.item)
    const messages = [{ role: 'user', content: [{ type: 'text', text: context }] }]
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const generated = await this.callModel(root, {
      task: 'discussion',
      system,
      messages,
      maxTokens: 6000,
      temperature: 0.8,
      signal: options.signal,
      onDelta,
    })
    let parsed = null
    try {
      parsed = extractJson(generated.text)
    } catch {
      // streamed plain text is still usable as a reply
    }
    const reply = String(parsed?.reply ?? generated.text ?? '').trim()
    const actions = this.normalizeDiscussionActions(parsed?.actions, options)
    const optionsList = Array.isArray(parsed?.options)
      ? parsed.options.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : []
    const stage = ['reply', 'clarify', 'propose'].includes(parsed?.stage)
      ? parsed.stage
      : (optionsList.length ? 'clarify' : actions.length ? 'propose' : 'reply')
    const result = {
      stage,
      question: String(parsed?.question ?? '').trim().slice(0, 800),
      options: optionsList,
      allowCustom: parsed?.allowCustom !== false,
      conclusion: String(parsed?.conclusion ?? '').trim(),
      suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions.map(String) : [],
      todos: Array.isArray(parsed?.todos) ? parsed.todos.map(String) : [],
      risks: Array.isArray(parsed?.risks) ? parsed.risks.map(String) : [],
      actions,
    }
    const entryTime = now()
    const next = {
      topicId,
      topic,
      item: options.item ?? null,
      updatedAt: entryTime,
      messages: [
        ...(thread.messages ?? []),
        { role: 'user', text: message, time: entryTime },
        { role: 'assistant', text: reply, result, time: entryTime },
      ],
    }
    await this.writeJson(root, `.dsh-writing/discussions/${topicId}.json`, next)
    await this.writeRun(root, {
      runId,
      kind: 'discussion.reply.stream',
      createdAt: entryTime,
      model: generated.model,
      system: generated.system ?? system,
      messages,
      output: generated.text,
      usage: generated.usage,
      durationMs: generated.durationMs,
      parseError: parsed ? null : 'discussion stream was not valid JSON; reply used raw text',
    })
    return { reply, result, messages: next.messages, usage: generated.usage, runId, context }
  }

  async applyDiscussion(root, options = {}) {
    const action = String(options.action ?? '')
    const topicId = String(options.topicId ?? '')
    const topic = String(options.topic ?? '')
    const reply = String(options.reply ?? '')
    const result = options.result && typeof options.result === 'object' ? options.result : {}
    if (action === 'instruction') {
      const number = Number(options.number)
      if (!Number.isFinite(number) || number < 1) throw new Error('讨论对象没有可应用的章节号')
      const paths = this.chapterPaths(number)
      const instruction = String(options.instruction ?? result.conclusion ?? reply).trim()
      if (!instruction) throw new Error('讨论结果为空，无法应用')
      const payload = {
        instruction,
        source: topicId || 'discussion',
        topic,
        result,
        createdAt: now(),
      }
      await this.writeJson(root, `${paths.dir}/instruction.json`, payload)
      return { applied: 'instruction', number, path: `${paths.dir}/instruction.json`, instruction }
    }
    if (action === 'note') {
      const safe = topicId.replace(/[^A-Za-z0-9._-]/g, '-') || 'general'
      const path = `.dsh-writing/notes/${safe}.json`
      const existing = (await this.readJson(root, path).catch(() => null)) ?? { notes: [] }
      const note = {
        topicId,
        topic,
        reply,
        conclusion: String(result.conclusion ?? ''),
        suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
        todos: Array.isArray(result.todos) ? result.todos : [],
        risks: Array.isArray(result.risks) ? result.risks : [],
        createdAt: now(),
      }
      const next = { notes: [...(existing.notes ?? []), note].slice(-20), updatedAt: now() }
      await this.writeJson(root, path, next)
      return { applied: 'note', path, note }
    }
    if (action === 'undo') {
      return this.undoDiscussionApply(root, { applyId: options.applyId })
    }
    if (action === 'actions') {
      const actions = Array.isArray(options.actions) ? options.actions : []
      if (actions.length === 0) throw new Error('这次讨论没有可应用的修改')
      const applied = []
      const errors = []
      const affected = new Set()
      const targetOf = (item) => (item.target && typeof item.target === 'object' ? item.target : {})
      for (const item of actions) {
        const target = targetOf(item)
        if (item.type === 'chapter-instruction') {
          const number = Number(target.number ?? options.number ?? options.item?.number)
          if (Number.isFinite(number)) affected.add(`${this.chapterPaths(number).dir}/instruction.json`)
        } else if (item.type === 'outline-update') {
          affected.add('story/plot/outline.json')
        } else if (item.type === 'bible-update') {
          affected.add('story/bible/index.json')
        } else if (item.type === 'style-update') {
          affected.add('story/style/contract.json')
        } else if (item.type === 'premise-candidate-update') {
          affected.add('story/premise.json')
        }
      }
      const before = []
      for (const path of affected) {
        before.push({ path, content: await this.readText(root, path).catch(() => null) })
      }
      for (const item of actions.slice(0, 8)) {
        try {
          const target = targetOf(item)
          if (item.type === 'chapter-instruction') {
            const number = Number(target.number ?? options.number ?? options.item?.number)
            const instruction = String(item.instruction ?? '').trim()
            if (!Number.isFinite(number) || !instruction) throw new Error('章节修订要求为空')
            const paths = this.chapterPaths(number)
            await this.writeJson(root, `${paths.dir}/instruction.json`, {
              instruction,
              source: topicId || 'discussion',
              topic,
              result,
              createdAt: now(),
            })
            applied.push({ type: item.type, number, target, path: `${paths.dir}/instruction.json` })
          } else if (item.type === 'outline-update') {
            const chapter = await this.updateOutlineChapter(root, {
              chapterId: target.id ?? options.item?.id,
              number: target.number ?? options.item?.number,
              fields: item.fields ?? {},
            })
            applied.push({ type: item.type, chapterId: chapter.id, target })
          } else if (item.type === 'bible-update') {
            const entry = await this.upsertBibleEntry(root, {
              category: target.category ?? options.item?.category,
              id: target.id ?? options.item?.id,
              fields: item.fields ?? {},
            })
            applied.push({ type: item.type, entryId: entry.id, target })
          } else if (item.type === 'style-update') {
            const style = await this.updateStyleFields(root, item.fields ?? {})
            applied.push({ type: item.type, fieldsHash: style.fieldsHash, target })
          } else if (item.type === 'premise-candidate-update') {
            const candidateId = target.id ?? options.item?.id ?? String(topicId).replace(/^premise-/, '')
            const premise = await this.updatePremiseCandidate(root, { candidateId, fields: item.fields ?? {} })
            applied.push({ type: item.type, candidateId: premise.id, target })
          } else {
            throw new Error(`不支持的讨论动作：${item.type}`)
          }
        } catch (error) {
          errors.push({ type: item.type, message: errorText(error) })
        }
      }
      let applyId = null
      if (applied.length > 0) {
        applyId = `apply-${Date.now()}-${randomUUID().slice(0, 8)}`
        await this.writeJson(root, `.dsh-writing/discussion-applies/${applyId}.json`, {
          applyId,
          topicId,
          topic,
          createdAt: now(),
          actions,
          applied,
          errors,
          files: before,
        })
      }
      return { applied: 'actions', appliedCount: applied.length, appliedItems: applied, errors, applyId }
    }
    throw new Error(`未知讨论应用方式：${action}`)
  }

  async listDiscussionApplies(agent) {
    const cwd = await this.cwd(agent)
    let entries = []
    try {
      entries = await readdir(join(cwd, '.dsh-writing', 'discussion-applies'), { withFileTypes: true })
    } catch {
      return []
    }
    const list = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const record = await this.readJson(agent, `.dsh-writing/discussion-applies/${entry.name}`).catch(() => null)
      if (!record) continue
      list.push({
        applyId: record.applyId ?? entry.name.replace(/\.json$/, ''),
        topicId: record.topicId ?? '',
        topic: record.topic ?? '',
        createdAt: record.createdAt ?? null,
        appliedCount: record.appliedItems?.length ?? record.applied?.length ?? 0,
        errorsCount: record.errors?.length ?? 0,
      })
    }
    return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20)
  }

  async pruneDiscussionApplies(agent, options = {}) {
    const keep = Math.max(1, Number(options.keep ?? 50) || 50)
    const cwd = await this.cwd(agent)
    const root = join(cwd, '.dsh-writing', 'discussion-applies')
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return { removed: 0 }
    }
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort().reverse()
    let removed = 0
    for (const name of files.slice(keep)) {
      try {
        await unlink(join(root, name))
        removed += 1
      } catch {
        // ignore
      }
    }
    return { removed, kept: Math.min(files.length, keep) }
  }

  async undoDiscussionApply(root, options = {}) {
    const applyId = String(options.applyId ?? '')
    if (!applyId || !/^apply-[0-9A-Za-z-]+$/.test(applyId)) throw new Error('无效的应用记录')
    const record = await this.readJson(root, `.dsh-writing/discussion-applies/${applyId}.json`).catch(() => null)
    if (!record) throw new Error('找不到这次应用的备份')
    const restored = []
    for (const file of record.files ?? []) {
      if (file.content === null) {
        try {
          const target = await this.ctx.fs.resolve(file.path, { cwd: await this.cwd(root) })
          const hostPath = this.ctx.fs.processPath?.(target) ?? target
          await unlink(hostPath)
        } catch {
          // already absent
        }
      } else {
        await this.writeTextFile(root, file.path, file.content)
      }
      restored.push(file.path)
    }
    return { undone: applyId, restored }
  }

  async stateSnapshot(agent, options) {
    const { chapter, meta, paths } = options
    const state = (await this.readJson(agent, 'story/state/index.json').catch(() => null)) ?? {
      chapters: [],
      updatedAt: null,
    }
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
    state.chapters = [
      ...(state.chapters ?? []).filter((item) => Number(item.number) !== Number(chapter.number)),
      entry,
    ].sort((a, b) => Number(a.number) - Number(b.number))
    state.updatedAt = now()
    await this.writeJson(agent, 'story/state/index.json', state)
    await this.writeJson(agent, `story/state/${paths.pad}.json`, {
      chapterId: chapter.id,
      number: Number(chapter.number),
      title: chapter.title ?? '',
      outline: chapter,
      meta,
      summary: entry.summary,
      approvedAt: entry.approvedAt,
    })
    return entry
  }
}
