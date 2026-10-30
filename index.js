import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NovelWriterService, disposeSignatureWatches, runWithProgress } from './service.js'
import { LOCK_RULES, locksConflict, runResource } from './lock-rules.js'
import { setNovelLocks, setNovelWriter } from './runtime.js'
import { createCraftSkillProvider } from './skills.js'

export { runResource } from './lock-rules.js'

export const inject = [
  'tools',
  'commands',
  'fs',
  'workingDirectory',
  'agentPresets',
  'agents',
  'agentLoop',
  'subagents',
  'sessionQuery',
  'sandboxPolicy',
  'llm',
  'agentDefaultModel',
  'webServer',
  'skills',
]

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * 部分动作使用独立的 resource：
 * - reindex 是只读索引维护，不与正文生成等写动作冲突；
 * - import-file-project 会整体覆盖 story/，用独立 resource 串行化，并与所有进行中的写动作互斥（acquireRun 里额外检查）。
 */
function resolveActionResource(action, params) {
  if (action === 'reindex') return 'read:index'
  if (action === 'import-file-project') return 'project:import'
  return runResource(action, params)
}

export function acquireRun(activeRuns, owner, action, params) {
  sweepStaleRuns(activeRuns)
  const resource = resolveActionResource(action, params)
  if (!resource) return { resource: null, controller: new AbortController(), acquired: false }
  // 跨 owner 冲突：UI（ui:<root>）与助手（agent:<session>）共用同一项目资源，需要互相看见对方的活动锁。
  for (const [otherOwner, locks] of activeRuns) {
    if (otherOwner === owner || !locks || locks.size === 0) continue
    if (locksConflict(locks, resource)) return { resource, busy: true }
  }
  let locks = activeRuns.get(owner)
  if (locksConflict(locks, resource)) return { resource, busy: true }
  if (!locks) {
    locks = new Map()
    activeRuns.set(owner, locks)
  }
  const controller = new AbortController()
  controller.startedAt = Date.now()
  locks.set(resource, controller)
  return { resource, controller, acquired: true }
}

export function releaseRun(activeRuns, owner, handle) {
  if (!handle?.acquired) return
  const locks = activeRuns.get(owner)
  if (!locks) return
  // 超时清理后可能已有新的同名锁；旧请求收尾时不能误删新锁。
  if (locks.get(handle.resource) !== handle.controller) return
  locks.delete(handle.resource)
  if (locks.size === 0) activeRuns.delete(owner)
}

/** 当前活动锁快照（sweep 后）：project-state / project-runs 用于展示助手与 UI 的活动。 */
export function listActiveLocks(activeRuns) {
  sweepStaleRuns(activeRuns)
  const locks = []
  for (const [owner, entries] of activeRuns) {
    if (!entries) continue
    for (const [resource, controller] of entries) {
      locks.push({ owner, resource, startedAt: controller?.startedAt ?? null })
    }
  }
  return locks
}

/**
 * 模型调用可能卡死；锁不设上限会让整个项目永久 busy。
 * 超时只 abort 并移除对应锁，动作自身的 finally 仍会正常收尾。
 */
const conversationCompactions = new Map()

/**
 * 对子代理执行手动压缩（等价 /compact；command-compact 走同一个 compactNow）。
 * 返回 { compacted:false|true, items?, tokens?, message } 或 { ok:false, error:{message, code?} }。
 */
/**
 * 找出「压缩目标子代理」：
 * - 只读 conversation meta，**不新建子代理**（新建会跑首轮 → 立即压缩必 busy）；
 * - childId 存在但 agent 不在（回合结束后的 continuable 子会话）→ resume 唤醒后再压缩；
 * - resume 失败或没有 childId → 返回可操作的中文错误。
 */
export async function resolveCompactionChild({ ctx, root, readConversationMeta, modelOptions, presets }) {
  const meta = await readConversationMeta(root)
  const childId = typeof meta?.childId === 'string' ? meta.childId : null
  if (!childId) {
    return { ok: false, error: { message: '还没有对话历史，先在 AI 页发送一条消息' } }
  }
  let childAgent = ctx.agents?.get?.(childId) ?? null
  if (!childAgent) {
    // resume 必须带 setup（与 DSH session-controller 的 composeAgent 一致）：
    // 否则恢复出的 agent 没有挂载预设，commands / compaction 等预设服务都取不到。
    const presetApi = presets ?? ctx.agentPresets
    let setup
    try {
      if (presetApi && typeof presetApi.resolve === 'function' && typeof presetApi.mount === 'function') {
        const resolved = await presetApi.resolve('novel-writer')
        if (resolved?.id) {
          setup = async (agentCtx) => {
            await presetApi.mount(agentCtx, resolved.id)
          }
        }
      }
    } catch {
      setup = undefined
    }
    try {
      const handle = await ctx.agents.resume({
        resumeSessionId: childId,
        ...(modelOptions ? { agentOptions: modelOptions } : {}),
        ...(setup ? { setup } : {}),
      })
      childAgent = handle?.agent ?? null
    } catch {
      childAgent = null
    }
    if (!childAgent) {
      return { ok: false, error: { message: '无法唤醒对话会话，请先在 AI 页发送一条消息后重试' } }
    }
  }
  return { childId, childAgent }
}

/** 解析 command-compact 的 success/error 文案（英文），转成结构化结果。 */
export function interpretCompactExecution(execution) {
  if (!execution) return { ok: false, error: { message: '当前预设未启用压缩' } }
  // 兼容两种返回：{ commandId, result:{kind,text} } 或直接 { kind, text }。
  const result = execution.result && typeof execution.result === 'object'
    ? execution.result
    : (typeof execution.kind === 'string' ? execution : {})
  const text = String(result.text ?? '')
  if (result.kind === 'success') {
    if (/no compactable history/i.test(text)) return { compacted: false, message: '没有可压缩的历史' }
    const itemsMatch = text.match(/compacted\s+([\d,]+)\s+(?:history\s+items?|items?)/i)
    const tokensMatch = text.match(/\(~\s*([\d,]+)\s*tokens?\)/i)
    if (itemsMatch) {
      const items = Number(itemsMatch[1].replace(/,/g, '')) || 0
      const tokens = tokensMatch ? Number(tokensMatch[1].replace(/,/g, '')) || 0 : 0
      return { compacted: true, items, tokens, message: '已压缩 ' + items + ' 条历史（约 ' + tokens + ' tokens）' }
    }
    return { compacted: true, message: text || '已压缩历史' }
  }
  const map = [
    [/(busy|not idle|active compaction|unavailable because|another (?:compaction|command)|already (?:running|in progress))/i, '会话正在生成或已有压缩任务，请稍后再试'],
    [/cancel/i, '压缩已取消'],
    [/chang/i, '对话历史在压缩过程中变化，请重试'],
    [/summar/i, '摘要没有产生有效压缩，历史未改动（对话太短或内容过于集中）'],
    [/commit/i, '压缩未干净完成，请检查对话后重试'],
    [/(persist|save)/i, '压缩完成但会话保存失败'],
  ]
  const hit = map.find(([pattern]) => pattern.test(text))
  return { ok: false, error: { message: hit ? hit[1] : (text || '压缩失败') } }
}

function compactErrorResult(error) {
  const code = error?.code
  const messages = {
    busy: '会话正在生成或已有压缩任务，请稍后再试',
    cancelled: '压缩已取消',
    changed: '对话历史在压缩过程中变化，请重试',
    summary: '摘要没有产生有效压缩，历史未改动（对话太短或内容过于集中）',
    commit: '压缩未干净完成，请检查对话后重试',
    persistence: '压缩完成但会话保存失败',
  }
  return { ok: false, error: { message: messages[code] ?? (error?.message ?? String(error)), code: code ?? null } }
}

/**
 * 对子代理执行手动压缩（等价 /compact）。
 * 主路径走宿主 commands 服务：预设里 compaction 组做了 isolate，宿主 ctx 取不到该服务，
 * 但 command-compact 在隔离作用域内、由它代为执行（与官方 /compact 行为一致）。
 * 返回 { compacted:false|true, items?, tokens?, message } 或 { ok:false, error:{message, code?} }。
 */
export async function compactConversationChild({ childId, childAgent, service, root, commands, agentPresets }) {
  if (!childAgent) {
    return { ok: false, error: { message: '对话会话尚未就绪，请先在 AI 页发送一条消息' } }
  }
  if (conversationCompactions.has(childId)) {
    return { ok: false, error: { message: '压缩进行中，请稍后再试' } }
  }
  const writeCompactRun = async (items, tokens, compacted) => {
    try {
      await service?.writeRun?.(root, {
        runId: 'run-' + Date.now() + '-' + randomUUID().slice(0, 8),
        kind: 'conversation.compact',
        createdAt: new Date().toISOString(),
        model: null,
        system: null,
        messages: [],
        output: JSON.stringify({ items, tokens, compacted }),
        usage: null,
        durationMs: 0,
        inputHash: null,
      })
    } catch {
      // 诊断 run 写失败不影响压缩结果
    }
  }
  // 1) 官方 API：读取子代理预设 isolate 组内的 compaction 服务（commands 视图按 agent 作用域解析，可能拿不到）。
  let presetCompaction = null
  if (agentPresets && typeof agentPresets.serviceFor === 'function') {
    try {
      presetCompaction = agentPresets.serviceFor(childAgent, 'compaction')
    } catch {
      presetCompaction = null
    }
  }
  if (presetCompaction && typeof presetCompaction.compactNow === 'function') {
    conversationCompactions.set(childId, true)
    try {
      const result = await presetCompaction.compactNow(childAgent, new AbortController().signal)
      if (!result) {
        await writeCompactRun(0, 0, false)
        return { compacted: false, message: '没有可压缩的历史' }
      }
      const items = Array.isArray(result.shadowedSeqs) ? result.shadowedSeqs.length : 0
      const tokens = Number(result.shadowedTokenCount) || 0
      await writeCompactRun(items, tokens, true)
      return { compacted: true, items, tokens, message: '已压缩 ' + items + ' 条历史（约 ' + tokens + ' tokens）' }
    } catch (error) {
      await writeCompactRun(0, 0, false)
      return compactErrorResult(error)
    } finally {
      conversationCompactions.delete(childId)
    }
  }
  // 2) fallback：宿主 commands 服务 → 在子代理作用域执行官方 /compact 命令。
  if (commands && typeof commands.execute === 'function') {
    conversationCompactions.set(childId, true)
    try {
      let execution = null
      try {
        execution = await commands.execute(childAgent, '/compact', [], new AbortController().signal)
      } catch (error) {
        await writeCompactRun(0, 0, false)
        return compactErrorResult(error)
      }
      const interpreted = interpretCompactExecution(execution)
      await writeCompactRun(interpreted.items ?? 0, interpreted.tokens ?? 0, Boolean(interpreted.compacted))
      return interpreted
    } finally {
      conversationCompactions.delete(childId)
    }
  }
  // fallback：直接取子代理 ctx 的 compaction 服务（非 isolate 的宿主/测试环境）。
  let compaction = null
  try {
    compaction = typeof childAgent.ctx?.get === 'function' ? childAgent.ctx.get('compaction') : null
  } catch {
    compaction = null
  }
  if (!compaction || typeof compaction.compactNow !== 'function') {
    return { ok: false, error: { message: '当前预设未启用压缩' } }
  }
  conversationCompactions.set(childId, true)
  try {
    const result = await compaction.compactNow(childAgent, new AbortController().signal)
    if (!result) {
      await writeCompactRun(0, 0, false)
      return { compacted: false, message: '没有可压缩的历史' }
    }
    const items = Array.isArray(result.shadowedSeqs) ? result.shadowedSeqs.length : 0
    const tokens = Number(result.shadowedTokenCount) || 0
    await writeCompactRun(items, tokens, true)
    return { compacted: true, items, tokens, message: '已压缩 ' + items + ' 条历史（约 ' + tokens + ' tokens）' }
  } catch (error) {
    await writeCompactRun(0, 0, false)
    return compactErrorResult(error)
  } finally {
    conversationCompactions.delete(childId)
  }
}

/**
 * 完整压缩流程：解析/唤醒子代理 → 历史太短时直接给可读提示（不调用压缩，避免 summary 校验报错）
 * → 执行压缩。sessionQuery 不可用时跳过长度检查，直接尝试压缩。
 */
export async function runConversationCompact({
  ctx,
  service,
  root,
  readConversationMeta,
  modelOptions,
  presets,
  sessionQuery,
  minMessages = 6,
}) {
  const resolved = await resolveCompactionChild({ ctx, root, readConversationMeta, modelOptions, presets })
  if (resolved.ok === false) return resolved
  try {
    const snapshot = await sessionQuery.readSession(resolved.childId)
    const messages = (snapshot?.events ?? []).filter((event) => event?.type === 'user/message' || event?.type === 'assistant/message')
    if (messages.length < minMessages) {
      return { compacted: false, message: '对话还太短（' + messages.length + ' 条消息），暂不需要压缩' }
    }
  } catch {
    // sessionQuery 不可用：跳过检查，直接尝试压缩
  }
  return compactConversationChild({
    childId: resolved.childId,
    childAgent: resolved.childAgent,
    service,
    root,
    commands: ctx.commands,
    agentPresets: ctx.agentPresets,
  })
}
export function resetConversationCompactionGuards() {
  conversationCompactions.clear()
}

export function sweepStaleRuns(activeRuns, maxAgeMs = 30 * 60 * 1000, nowMs = Date.now()) {
  let removed = 0
  for (const [owner, locks] of activeRuns) {
    for (const [resource, controller] of locks) {
      if (!controller?.startedAt || nowMs - controller.startedAt <= maxAgeMs) continue
      try {
        controller.abort()
      } catch {
        // ignore abort failures
      }
      locks.delete(resource)
      removed += 1
    }
    if (locks.size === 0) activeRuns.delete(owner)
  }
  return removed
}

/** 动作日志：请求到达、成功、失败都写一行，方便排查"点了没反应"。 */
async function logAction(root, entry) {
  if (!root) return
  try {
    await mkdir(join(root, '.dsh-writing'), { recursive: true })
    await appendFile(
      join(root, '.dsh-writing', 'actions.log'),
      `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`,
      'utf8',
    )
  } catch {
    // 日志失败不影响主流程
  }
}

function summarizeParams(params) {
  const keys = ['number', 'fromChapter', 'toChapter', 'count', 'scope', 'candidateId', 'templateId']
  const out = {}
  for (const key of keys) {
    if (params?.[key] !== undefined) out[key] = params[key]
  }
  return out
}

function lossless(value) {
  return JSON.parse(JSON.stringify(value))
}

function jsonResponse(res, status, body) {
  try {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(body))
  } catch {
    // response may already be closed by an aborted client request
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function apply(ctx) {
  const service = new NovelWriterService(ctx)
  setNovelWriter(service)

  const activeRuns = new Map()
  // 把 host 锁注册给 runtime：助手工具执行写动作时先 acquire，UI 与助手共用同一份锁。
  setNovelLocks({
    acquire: (owner, action, params) => acquireRun(activeRuns, owner, action, params),
    release: (owner, handle) => releaseRun(activeRuns, owner, handle),
    listActive: () => listActiveLocks(activeRuns),
  })
  const runProgress = new Map()
  /*
   * 写作台内部对话：每个小说项目一个 origin=subagent 的隐藏父会话（不进侧栏），
   * 其下挂一个 continuable 子代理会话，由官方 conversation UI 内嵌展示。
   * 父会话必须在线，子代理的 composer 才能发送；DSH 重启后按需 resume。
   */
  const conversationHandles = new Map()
  const CONVERSATION_META_PATH = '.dsh-writing/conversation.json'

  const conversationParentId = (projectRoot) =>
    `deepnovel-host-${createHash('sha1').update(projectRoot).digest('hex').slice(0, 16)}`

  const currentModelOptions = () => {
    const selection = ctx.agentDefaultModel.currentSelection()
    if (!selection?.provider || !selection?.model) return undefined
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    }
  }

  const ensureConversationParent = async (projectRoot) => {
    const parentId = conversationParentId(projectRoot)
    if (ctx.agents.get(parentId)) return parentId
    const agentOptions = currentModelOptions()
    try {
      const handle = await ctx.agents.resume({
        resumeSessionId: parentId,
        ...(agentOptions ? { agentOptions } : {}),
      })
      conversationHandles.set(projectRoot, handle)
      return parentId
    } catch {
      const handle = await ctx.agents.create({
        sessionId: parentId,
        ...(agentOptions ? { agentOptions } : {}),
        meta: { cwd: projectRoot, origin: 'subagent' },
      })
      conversationHandles.set(projectRoot, handle)
      return parentId
    }
  }

  const readConversationMeta = async (projectRoot) => {
    try {
      return await service.readJson(projectRoot, CONVERSATION_META_PATH)
    } catch {
      return null
    }
  }

  const writeConversationMeta = (projectRoot, value) =>
    service.writeJson(projectRoot, CONVERSATION_META_PATH, value)

  const createConversationChild = async (projectRoot, parentId, carryover = '') => {
    const parent = ctx.agents.get(parentId)
    if (!parent) throw new Error('conversation parent unavailable')
    const text = typeof carryover === 'string' ? carryover.trim() : ''
    const promptText = text
      ? [
          '继续上次的写作对话，先看这段上一段对话的摘要：',
          text.slice(0, 4000),
          '',
          '回复保持一句话即可。',
        ].join('\n')
      : '开始新的写作对话。回复保持一句话即可。'
    const activation = await ctx.subagents.startActivation({
      provider: 'spawn',
      label: '写作台对话',
      delivery: 'caller',
      signal: new AbortController().signal,
      request: {
        parent,
        cwd: projectRoot,
        agentPreset: 'novel-writer',
        prompt: [{ type: 'text', text: promptText }],
        agentOptions: currentModelOptions(),
        maxDepth: 1,
      },
    })
    return activation.childId
  }

  const ensureConversation = async (projectRoot) => {
    const parentId = await ensureConversationParent(projectRoot)
    const meta = await readConversationMeta(projectRoot)
    let childId = typeof meta?.childId === 'string' ? meta.childId : null
    const childAlive = childId
      ? await ctx.sessionQuery.readSession(childId).then(() => true).catch(() => false)
      : false
    let created = false
    if (!childId || !childAlive || meta?.parentId !== parentId) {
      childId = await createConversationChild(projectRoot, parentId, meta?.carryover ?? '')
      created = true
      await writeConversationMeta(projectRoot, {
        parentId,
        childId,
        carryover: typeof meta?.carryover === 'string' ? meta.carryover : '',
        createdAt: new Date().toISOString(),
      })
    }
    return { parentId, childId, mode: 'continuable', created, model: currentModelOptions() ?? null }
  }

  const conversationTranscript = async (childId) => {
    const snapshot = await ctx.sessionQuery.readSession(childId)
    const lines = []
    for (const event of snapshot.events ?? []) {
      if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue
      const content = event.data?.message?.content ?? []
      const text = content
        .filter((block) => block?.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim()
      if (!text) continue
      lines.push(`${event.type === 'user/message' ? '用户' : '助手'}：${text}`)
    }
    return lines
  }

  const summarizeConversation = async (projectRoot) => {
    const meta = await readConversationMeta(projectRoot)
    const childId = typeof meta?.childId === 'string' ? meta.childId : null
    if (!childId) throw new Error('当前项目还没有对话可以摘要')
    const lines = await conversationTranscript(childId)
    if (lines.length === 0) throw new Error('当前对话还没有可摘要的内容')
    const joined = lines.join('\n\n')
    const clipped = joined.length > 12000 ? joined.slice(-12000) : joined
    const result = await service.callModel(projectRoot, {
      task: 'default',
      system: [
        '你是小说写作助手的对话摘要器。把给定对话压缩成一段后续可用的中文摘要。',
        '保留：用户对创作的明确要求与偏好、已经确定的设定/章纲/正文改动、当前进行到哪一步、未完成的待办与风险。',
        '不要编造对话里没有的内容；不要写寒暄；不要用 Markdown 标题。',
        '输出 300~600 字的一段话。',
      ].join('\n'),
      messages: [{ role: 'user', content: [{ type: 'text', text: `对话记录：\n\n${clipped}` }] }],
      maxTokens: 1600,
      temperature: 0.3,
    })
    const summary = String(result.text ?? '').trim()
    return { summary, messageCount: lines.length }
  }

  const resetConversation = async (projectRoot, carryover) => {
    const meta = await readConversationMeta(projectRoot)
    const oldChildId = typeof meta?.childId === 'string' ? meta.childId : null
    if (oldChildId) {
      const child = ctx.agents.get(oldChildId)
      if (child) {
        try {
          child.cancel({ kind: 'user' })
        } catch {
          // ignore cancellation failures
        }
      }
    }
    const parentId = await ensureConversationParent(projectRoot)
    const text = typeof carryover === 'string' ? carryover.trim() : ''
    const childId = await createConversationChild(projectRoot, parentId, text)
    await writeConversationMeta(projectRoot, {
      parentId,
      childId,
      carryover: text,
      createdAt: new Date().toISOString(),
    })
    return {
      parentId,
      childId,
      mode: 'continuable',
      carryover: Boolean(text),
      created: true,
      model: currentModelOptions() ?? null,
    }
  }

  /*
   * AI 页「压缩上下文」入口：对隐藏父会话下的子代理调用 command-compact 同款手动压缩。
   * 压缩要求子代理 idle（由 compactNow 自身校验），不占项目资源锁；同一 childId 防重复点击。
   */
  const compactConversation = async (projectRoot) => {
    const root = validProjectRoot(projectRoot)
    if (!root) return { ok: false, error: { message: 'invalid projectRoot' } }
    return runConversationCompact({
      ctx,
      service,
      root,
      readConversationMeta,
      modelOptions: currentModelOptions(),
      presets: ctx.agentPresets,
      sessionQuery: ctx.sessionQuery,
    })
  }
  const pauseRequests = new Set()

  const dispatchWithProgress = async (agent, action, params, signal) => {
    const resource = resolveActionResource(action, params)
    const owner = typeof agent === 'string' ? agent : agent?.id
    const key = resource && owner ? `${owner}\u0000${resource}` : null
    const onStage = (event) => {
      if (!key) return
      runProgress.set(key, {
        resource,
        action,
        stage: event.stage,
        detail: event.detail,
        updatedAt: event.at ?? Date.now(),
      })
    }
    onStage({ stage: 'queued' })
    try {
      return await runWithProgress({
        onStage,
        shouldPause: () => Boolean(key && pauseRequests.has(key)),
      }, () => dispatchAction(agent, action, params, signal))
    } finally {
      if (key) {
        runProgress.delete(key)
        pauseRequests.delete(key)
      }
    }
  }
  const validProjectRoot = (value) =>
    typeof value === 'string' && /^([A-Za-z]:[\\/]|\/)/.test(value.trim()) ? value.trim() : null

  const probeStatus = async (agent) => {
    const cwd = await ctx.workingDirectory.ensure(agent)
    const result = {
      cwd,
      marker: null,
      defaultModel: null,
      presets: [],
      composition: [],
      liveAgents: [],
    }

    try {
      result.defaultModel = ctx.agentDefaultModel.currentSelection()
    } catch (error) {
      result.defaultModel = { error: errorText(error) }
    }

    const initialized = await service.isInitialized(agent)
    result.marker = { path: 'story/project.db', mode: 'sqlite', exists: initialized }

    result.presets = (await ctx.agentPresets.list()).map((preset) => ({
      id: preset.id,
      name: preset.name ?? null,
      broken: preset.broken ?? null,
    }))

    result.composition = (await ctx.agentPresets.compositionInventory()).map((item) => ({
      id: item.id,
      name: item.name ?? null,
      broken: item.broken ?? null,
      rows: item.rows.map((row) => ({
        entryId: row.entryId,
        moduleName: row.moduleName,
        enabled: row.enabled,
        fiberState: row.fiberState,
      })),
    }))

    for (const live of ctx.agents.list()) {
      let preset = null
      try {
        preset = ctx.agentPresets.composedPreset(live.ctx) ?? null
      } catch (error) {
        preset = `error: ${errorText(error)}`
      }
      let tools = []
      try {
        tools = ctx.tools.schemas(live).map((schema) => schema.name)
      } catch (error) {
        tools = [`error: ${errorText(error)}`]
      }
      result.liveAgents.push({ id: live.id, preset, tools })
    }

    return result
  }

  const createAndInspect = async (agent, withPreset, selectAfterCreate) => {
    const cwd = await ctx.workingDirectory.ensure(agent)
    const meta = withPreset ? { cwd, agentPreset: 'novel-writer' } : { cwd }
    const handle = await ctx.agents.create({ sessionId: randomUUID(), meta })
    const out = { sessionId: handle.agent.id, requestedPreset: withPreset ? 'novel-writer' : null }
    try {
      out.presetAfterCreate = ctx.agentPresets.composedPreset(handle.agent.ctx) ?? null
      out.toolsAfterCreate = ctx.tools.schemas(handle.agent).map((schema) => schema.name)
      if (selectAfterCreate) {
        try {
          out.selected = await ctx.agentPresets.select(handle.agent, 'novel-writer')
        } catch (error) {
          out.selectError = errorText(error)
        }
        out.presetAfterSelect = ctx.agentPresets.composedPreset(handle.agent.ctx) ?? null
        out.toolsAfterSelect = ctx.tools.schemas(handle.agent).map((schema) => schema.name)
      }
    } finally {
      await handle.dispose()
    }
    return out
  }

  const run = async (action, agent, options = {}) => {
    switch (action) {
      case 'status':
        return probeStatus(agent)
      case 'init':
        return service.initProject(agent, { title: options.title })
      case 'project-status':
        return service.projectStatus(agent)
      case 'premise-candidates':
        return service.premiseCandidates(agent, options)
      case 'premise-commit':
        return service.commitPremise(agent, { candidateId: options.candidateId })
      case 'premise-status':
        return service.readJson(agent, 'story/premise.json')
      case 'style-templates':
        return service.styleTemplateList(agent)
      case 'style-apply':
        return service.applyStyleTemplate(agent, { templateId: options.templateId, fields: options.fields })
      case 'style-commit':
        return service.commitStyle(agent, { fields: options.fields })
      case 'style-status':
        return service.readJson(agent, 'story/style/contract.json')
      case 'outline-generate':
        return service.outlineGenerate(agent, {
          count: options.count,
          fromChapter: options.fromChapter,
          toChapter: options.toChapter,
          instruction: options.instruction,
        })
      case 'outline-regenerate':
        return service.outlineGenerate(agent, {
          fromChapter: options.fromChapter,
          toChapter: options.toChapter,
          instruction: options.instruction,
          regenerate: true,
        })
      case 'outline-commit':
        return service.outlineCommit(agent, {
          fromChapter: options.fromChapter,
          toChapter: options.toChapter,
        })
      case 'outline-status':
        return service.readJson(agent, 'story/plot/outline.json')
      case 'outline-reverse':
        return service.reverseOutline(agent, {
          fromChapter: params.fromChapter,
          toChapter: params.toChapter,
        }, signal)
      case 'prompt-status':
        return service.promptInjectionStatus(agent)
      case 'prompt-catalog':
        return service.promptCatalog(agent)
      case 'prompt-preview':
        return service.previewPromptTemplate(agent, { key: options.key })
      case 'prompt-catalog-save':
        return service.saveSystemPrompt(agent, { key: options.key, content: options.content })
      case 'prompt-catalog-reset':
        return service.resetSystemPrompt(agent, { key: options.key })
      case 'system-prompt-reset':
        return service.resetSystemPrompt(agent, { key: options.key })
      case 'prompt-catalog-export':
        return service.exportSystemPrompts(agent)
      case 'prompt-catalog-import':
        return service.importSystemPrompts(agent, { data: options.data })
      case 'prompt-save': {
        const config = options.config && typeof options.config === 'object' ? options.config : options
        if (options.scope === 'global') return service.saveGlobalInjection(config)
        return service.saveProjectInjection(agent, config)
      }
      case 'create-preset-agent':
        return createAndInspect(agent, true, false)
      case 'select-test':
        return createAndInspect(agent, false, true)
      case 'write-test': {
        const cwd = await ctx.workingDirectory.ensure(agent)
        const target = await ctx.fs.resolve('novel-writer-spike-write-test.json', { cwd })
        const content = JSON.stringify({ time: new Date().toISOString(), source: 'novel-writer-spike' }, null, 2)
        const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
        await ctx.fs.writeText(target, content, undefined, undefined, policy)
        return { cwd, path: 'novel-writer-spike-write-test.json', bytes: content.length, policy }
      }
      default:
        throw new Error(`unknown action: ${action}`)
    }
  }

  ctx.tools.register({
    name: 'novel_probe',
    description:
      '写作插件验证探针。status=环境/预设/工具作用域；init=初始化 story；project-status=项目状态；premise-* / style-* 验证构思与文风；prompt-status/prompt-save 查看与保存提示词注入（项目级/全局级）；create-preset-agent/select-test/write-test 验证预设与文件写入。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'init',
            'project-status',
            'premise-candidates',
            'premise-intent',
            'premise-commit',
            'premise-status',
            'premise-chat-load',
            'premise-chat-save',
            'premise-restore-batch',
            'style-templates',
            'style-apply',
            'style-commit',
            'style-status',
            'outline-generate',
            'outline-regenerate',
            'outline-commit',
            'outline-status',
            'prompt-status',
            'prompt-save',
            'prompt-catalog',
            'prompt-catalog-save',
            'prompt-catalog-reset',
            'system-prompt-reset',
            'prompt-catalog-export',
            'prompt-catalog-import',
            'create-preset-agent',
            'select-test',
            'write-test',
          ],
        },
        count: { type: 'number' },
        candidateId: { type: 'string' },
        templateId: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'global'] },
        config: { type: 'object', additionalProperties: true },
        fromChapter: { type: 'number' },
        toChapter: { type: 'number' },
        genre: { type: 'array', items: { type: 'string' } },
        audience: { type: 'string' },
        instruction: { type: 'string' },
        fields: { type: 'object', additionalProperties: true },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args, exec) {
      return lossless(await run(args?.action ?? 'status', exec.agent, args ?? {}))
    },
  })

  ctx.commands.register({
    name: 'novel-probe',
    description: '写作插件验证探针（与 novel_probe 工具共用逻辑）',
    handler: async (invocation) => {
      try {
        return { kind: 'success', text: JSON.stringify(lossless(await run('status', invocation.agent)), null, 2) }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  })

  ctx.commands.register({
    name: 'novel-init',
    description: '初始化当前目录为小说写作项目（创建 story/ 目录与 project.json 标识）',
    handler: async (invocation) => {
      try {
        const value = lossless(await service.initProject(invocation.agent))
        return { kind: 'success', text: JSON.stringify(value, null, 2) }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  })

  /* --------------------------- 写作台 UI 的 Host 数据通道 --------------------------- */

  const stateFor = async (target) => {
    // 一次性批量读取（DB 聚合 + 一次目录扫描），后续所有视图复用，避免逐章 IO。
    let snapshot = null
    try {
      snapshot = await service.readProjectSnapshotData(target)
    } catch {
      snapshot = null
    }
    const status = await service.projectStatus(target, snapshot)
    let preset = null
    let sessionId = null
    let projectRoot = null
    if (typeof target === 'string') {
      projectRoot = target
    } else {
      sessionId = target.id
      try {
        preset = ctx.agentPresets.composedPreset(target.ctx) ?? null
      } catch {
        preset = null
      }
    }
    const data = {
      ...status,
      lockRules: LOCK_RULES,
      preset,
      sessionId,
      projectRoot,
      styleTemplates: (await service.styleTemplateList(target)).templates,
      promptCatalog: await service.promptCatalog(target).catch(() => null),
      promptInjection: await service.promptInjectionStatus(target).catch(() => null),
      characterLibrary: await service.listLibraryCharacters().catch(() => ({ characters: [] })),
      craftCards: (await service.listCraftCards(target).catch(() => ({ cards: [] }))).cards,
      craftAuto: await service.readCraftAuto(target).catch(() => true),
      outlineAudit: await service.readJson(target, 'story/plot/outline-audit.json').catch(() => null),
      premiseChat: await service.readPremiseChat(target).catch(() => null),
      relations: await service.readRelations(target).catch(() => null),
      inspirations: await service.readInspirations(target).catch(() => null),
      deconstructions: await service.readDeconstructions(target).catch(() => null),
      systemOverrides: await service.readSystemOverrides(target).catch(() => ({})),
      health: await service.buildHealthReport(target, snapshot).catch((error) => ({ issues: [], error: String(error?.message ?? error) })),
      dataLayer: await service.dataStatus(target).catch(() => null),
      activeLocks: status.initialized ? listActiveLocks(activeRuns) : [],
    }
    if (!status.initialized) return data
    const recentRuns = await service.recentRuns(target, 6).catch(() => [])
    const premise = snapshot ? snapshot.premise : await service.readJson(target, 'story/premise.json').catch(() => null)
    const style = snapshot ? snapshot.style : await service.readJson(target, 'story/style/contract.json').catch(() => null)
    const outline = snapshot ? snapshot.outline : await service.readJson(target, 'story/plot/outline.json').catch(() => null)
    const bible = snapshot ? snapshot.bible : await service.readBible(target).catch(() => null)
    const chapters = await service.chaptersSummary(target, snapshot).catch(() => [])
    const overview = await service.storyOverview(target, snapshot).catch(() => null)
    const stats = {
      words: chapters.reduce((sum, chapter) => sum + (Number(chapter.wordCount) || 0), 0),
      target: service.automationConfig(data.project).targetWords,
      chapters: chapters.length,
      approved: chapters.filter((chapter) => chapter.hasFinal).length,
    }
    return {
      ...data,
      premise,
      style,
      bible,
      power: snapshot ? snapshot.power : await service.readPower(target).catch(() => null),
      outline,
      chapters,
      overview,
      snapshots: await service.listProjectSnapshots(target).catch(() => []),
      stats,
      writing: await service.writingStats(target).catch(() => null),
      modelDefaults: ctx.agentDefaultModel.currentSelection(),
      effectiveModels: await service.effectiveModels(target).catch(() => null),
      recentRuns,
    }
  }

  const dispatchAction = async (agent, action, params, signal) => {
    switch (action) {
      case 'init':
        return service.initProject(agent, { title: params.title, language: params.language })
      case 'uninitialize-project':
        return service.uninitializeProject(agent)
      case 'project-update':
        return service.updateProject(agent, params.fields ?? params)
      case 'premise-candidates':
        return service.premiseCandidates(
          agent,
          {
            count: params.count,
            genre: params.genre,
            audience: params.audience,
            instruction: params.instruction,
            reference: params.reference,
            intent: params.intent,
            history: params.history,
          },
          signal,
        )
      case 'premise-intent':
        return service.premiseIntent(agent, { history: params.history, instruction: params.instruction }, signal)
      case 'premise-chat-load':
        return service.readPremiseChat(agent)
      case 'premise-chat-save':
        return service.savePremiseChat(agent, {
          messages: params.messages,
          batches: params.batches,
          brief: params.brief,
          activeBatchId: params.activeBatchId,
        })
      case 'premise-restore-batch':
        return service.restorePremiseBatch(agent, { batchId: params.batchId })
      case 'premise-commit':
        return service.commitPremise(agent, { candidateId: params.candidateId })
      case 'premise-update':
        return service.updatePremise(agent, params.fields ?? params)
      case 'style-apply':
        return service.applyStyleTemplate(agent, {
          templateId: params.templateId,
          fields: params.fields,
        })
      case 'style-commit':
        return service.commitStyle(agent, { fields: params.fields })
      case 'style-save-template':
        return service.saveStyleTemplate(agent, { name: params.name, fields: params.fields, samples: params.samples })
      case 'style-delete-template':
        return service.deleteStyleTemplate(agent, { id: params.id })
      case 'style-export-template':
        return service.exportStyleTemplate(agent, { id: params.id })
      case 'style-import-template':
        return service.importStyleTemplate(agent, { template: params.template })
      case 'style-samples-save':
        return service.saveStyleSamples(agent, params.samples)
      case 'system-overrides-save':
        return service.saveSystemOverrides(agent, params.overrides)
      case 'prompt-catalog':
        return service.promptCatalog(agent)
      case 'prompt-preview':
        return service.previewPromptTemplate(agent, { key: params.key })
      case 'prompt-catalog-save':
        return service.saveSystemPrompt(agent, { key: params.key, content: params.content })
      case 'prompt-catalog-reset':
        return service.resetSystemPrompt(agent, { key: params.key })
      case 'prompt-catalog-export':
        return service.exportSystemPrompts(agent)
      case 'prompt-catalog-import':
        return service.importSystemPrompts(agent, { data: params.data })
      case 'system-prompt-reset':
        return service.resetSystemPrompt(agent, { key: params.key })
      case 'library-characters':
        return service.listLibraryCharacters()
      case 'library-character-save':
        return service.saveLibraryCharacter(agent, { name: params.name })
      case 'library-character-import':
        return service.importLibraryCharacter(agent, { id: params.id })
      case 'library-character-delete':
        return service.deleteLibraryCharacter({ id: params.id })
      case 'craft-cards':
        return service.listCraftCards(agent)
      case 'craft-card-read':
        return service.readCraftCard(agent, { id: params.id })
      case 'craft-card-save':
        return service.saveCraftCard(agent, {
          id: params.id,
          title: params.title,
          summary: params.summary,
          tags: params.tags,
          tasks: params.tasks,
          body: params.body,
        })
      case 'craft-card-delete':
        return service.deleteCraftCard(agent, params.id)
      case 'craft-card-toggle':
        return service.setCraftCardEnabled(agent, { id: params.id, enabled: params.enabled !== false })
      case 'craft-auto-toggle':
        return service.setCraftAuto(agent, { enabled: params.enabled === true })
      case 'skills-list':
        return service.listSkills(agent)
      case 'skill-toggle':
        return service.toggleSkill(agent, { name: params.name, enabled: params.enabled !== false })
      case 'skill-delete':
        return service.deleteSkill(agent, { name: params.name, scope: params.scope })
      case 'skill-read':
        return service.readSkill(agent, params.name, params.scope)
      case 'skill-import':
        return service.importSkill(agent, { path: params.path, scope: params.scope })
      case 'reindex':
        return service.reindexProject(agent)
      case 'data-status':
        return service.dataStatus(agent)
      case 'export-file-project':
        return service.exportFileProject(agent)
      case 'inspiration-save':
        return service.saveInspiration(agent, { topic: params.topic, ideas: params.ideas })
      case 'materials-list':
        return service.materialsList(agent)
      case 'material-save':
        return service.materialSave(agent, {
          id: params.id,
          title: params.title,
          kind: params.kind,
          content: params.content,
          tags: params.tags,
          source: params.source,
        })
      case 'material-delete':
        return service.materialDelete(agent, { id: params.id })
      case 'run-detail':
        return service.readRun(agent, { runId: params.runId })
      case 'deconstruct-text':
        return service.deconstructText(agent, { text: params.text, title: params.title }, signal)
      case 'outline-generate':
        return service.outlineGenerate(
          agent,
          {
            count: params.count,
            fromChapter: params.fromChapter,
            toChapter: params.toChapter,
            instruction: params.instruction,
            volumeId: params.volumeId,
            regenerate: params.regenerate,
          },
          signal,
        )
      case 'bible-generate':
        return service.generateBible(agent, { instruction: params.instruction, scope: params.scope }, signal)
      case 'bible-update':
        return service.upsertBibleEntry(agent, {
          category: params.category,
          id: params.id,
          fields: params.fields,
        })
      case 'bible-delete':
        return service.deleteBibleEntry(agent, { category: params.category, id: params.id })
      case 'bible-commit':
        return service.commitBible(agent)
      case 'relations-save':
        return service.saveRelations(agent, { relations: params.relations, positions: params.positions })
      case 'character-card-export':
        return service.exportCharacterCard(agent, { name: params.name })
      case 'character-card-import':
        return service.importCharacterCard(agent, { card: params.card, overwrite: params.overwrite })
      case 'inspiration-generate':
        return service.generateInspiration(agent, { topic: params.topic, count: params.count, history: params.history }, signal)
      case 'power-save':
        return service.savePower(agent, { power: params.power })
      case 'outline-commit':
        return service.outlineCommit(agent, {
          fromChapter: params.fromChapter,
          toChapter: params.toChapter,
        })
      case 'outline-audit':
        return service.auditOutline(
          agent,
          { fromChapter: params.fromChapter, toChapter: params.toChapter },
          signal,
        )
      case 'outline-repair': {
        let issues = Array.isArray(params.issues) ? params.issues : null
        if (!issues) {
          const audit = await service.readJson(agent, 'story/plot/outline-audit.json').catch(() => null)
          issues = audit?.issues ?? []
        }
        return service.repairOutlineIssues(agent, { issues }, signal)
      }
      case 'outline-sync-chapters':
        return service.syncOutlineChapters(
          agent,
          { numbers: params.numbers, instruction: params.instruction },
          signal,
        )
      case 'outline-update':
        return service.updateOutlineChapter(agent, {
          chapterId: params.chapterId,
          number: params.number,
          fields: params.fields,
        })
      case 'create-preset-agent': {
        const steps = {}
        let live = null
        try {
          // dispatchAction 的 agent 是项目根路径字符串，不能直接传给需要 Agent 对象的服务。
          const cwd = typeof agent === 'string' ? agent : await ctx.workingDirectory.ensure(agent)
          steps.cwd = cwd
          live = await ctx.agentLoop.create(randomUUID(), {}, { cwd })
          steps.created = live.id
        } catch (error) {
          return { failedAt: 'create', error: errorText(error), steps }
        }
        try {
          steps.selected = await ctx.agentPresets.select(live, 'novel-writer')
        } catch (error) {
          steps.selectError = errorText(error)
        }
        try {
          steps.tools = ctx.tools.schemas(live).map((schema) => schema.name)
        } catch (error) {
          steps.toolsError = errorText(error)
        }
        try {
          steps.preset = ctx.agentPresets.composedPreset(live.ctx) ?? null
        } catch (error) {
          steps.presetError = errorText(error)
        }
        try {
          const inventory = await ctx.agentPresets.compositionInventory()
          const entry = (inventory ?? []).find((item) => item.id === 'novel-writer')
          steps.rows = entry
            ? entry.rows.map((row) => ({ entryId: row.entryId, moduleName: row.moduleName, enabled: row.enabled, fiberState: row.fiberState }))
            : null
        } catch (error) {
          steps.inventoryError = errorText(error)
        }
        return steps
      }
      case 'chapter-delete':
        return service.deleteChapter(agent, {
          number: params.number,
          dryRun: params.dryRun === true,
          removeOutline: params.removeOutline === true,
          renumber: params.renumber !== false,
        })
      case 'chapters-delete-tail':
        return service.deleteTailChapters(agent, { count: params.count, dryRun: params.dryRun })
      case 'volume-create':
        return service.createOutlineVolume(agent, {
          title: params.title,
          goal: params.goal,
          map: params.map,
          powerCeiling: params.powerCeiling,
          exitCriteria: params.exitCriteria,
        })
      case 'volume-update':
        return service.updateOutlineVolume(agent, {
          volumeId: params.volumeId,
          title: params.title,
          goal: params.goal,
          map: params.map,
          powerCeiling: params.powerCeiling,
          exitCriteria: params.exitCriteria,
        })
      case 'volume-plan':
        return service.planVolume(agent, { volumeId: params.volumeId, instruction: params.instruction }, signal)
      case 'volume-delete':
        return service.deleteOutlineVolume(agent, { volumeId: params.volumeId })
      case 'chapter-move':
        return service.moveOutlineChapter(agent, { number: params.number, volumeId: params.volumeId })
      case 'summarize-chapter':
        return service.summarizeChapter(agent, { number: params.number }, signal)
      case 'summarize-missing':
        return service.summarizeMissing(agent, { number: params.number }, signal)
      case 'continuity-check':
        return service.continuityReport(agent, { number: params.number })
      case 'continuity-audit':
        return service.continuityAudit(agent, { number: params.number }, signal)
      case 'continuity-mark':
        return service.markContinuityIssues(agent, {
          number: params.number,
          issues: params.issues,
          revision: params.revision,
        })
      case 'snapshot-create':
        return service.createProjectSnapshot(agent)
      case 'restore-snapshot':
        return service.restoreProjectSnapshot(agent, { name: params.name })
      case 'chapter-draft':
        return service.draftChapter(
          agent,
          { number: params.number, instruction: params.instruction },
          signal,
        )
      case 'chapter-qa':
        return service.qaChapter(agent, { number: params.number })
      case 'chapter-style-audit':
        return service.styleAudit(agent, { number: params.number }, signal)
      case 'chapter-deslop':
        return service.deslopChapter(agent, {
          number: params.number,
          target: params.target,
          instruction: params.instruction,
          dryRun: params.dryRun,
        }, signal)
      case 'chapter-review':
        return service.chapterReview(agent, { number: params.number }, signal)
      case 'chapter-audit':
        return service.auditChapter(agent, { number: params.number }, signal)
      case 'export-manuscript':
        return service.exportManuscript(agent, { format: params.format })
      case 'search-project':
        return service.searchProject(agent, { query: params.query })
      case 'import-file-project':
        return service.importFileProject(agent, { path: params.path })
      case 'conversation-compact':
        return compactConversation(String(agent))
      case 'chapter-fix':
        return service.fixByQa(
          agent,
          {
            number: params.number,
            instruction: params.instruction,
            rounds: params.rounds,
            verify: params.verify,
          },
          signal,
        )
      case 'chapter-autofix':
        return service.autoFixChapter(
          agent,
          { number: params.number, rounds: params.rounds, instruction: params.instruction },
          signal,
        )
      case 'chapter-revise':
        return service.reviseChapter(
          agent,
          {
            number: params.number,
            instruction: params.instruction,
            fromParagraph: params.fromParagraph,
            toParagraph: params.toParagraph,
            proposedText: params.proposedText,
          },
          signal,
        )
      case 'chapter-rewrite-preview':
        return service.previewRevision(
          agent,
          {
            number: params.number,
            instruction: params.instruction,
            fromParagraph: params.fromParagraph,
            toParagraph: params.toParagraph,
          },
          signal,
        )
      case 'chapter-restore':
        return service.restoreRevision(agent, { number: params.number, name: params.name })
      case 'chapter-save-text':
        return service.saveChapterText(agent, { number: params.number, text: params.text })
      case 'chapter-clear-revisions':
        return service.clearRevisions(agent, { number: params.number, keep: params.keep })
      case 'find-orphans':
        return service.findOrphans(agent)
      case 'clean-orphans':
        return service.cleanOrphans(agent)
      case 'runs-clear':
        return service.clearRuns(agent, { keep: params.keep })
      case 'chapter-approve':
        return service.approveChapter(agent, { number: params.number })
      case 'chapter-approve-all':
        return service.approveAllDrafts(agent, {}, signal)
      case 'chapter-approve-volume':
        return service.approveVolumeDrafts(agent, { volumeId: params.volumeId }, signal)
      case 'chapter-approve-stale':
        return service.approveStaleFinals(agent, {}, signal)
      case 'chapter-batch':
        return service.batchWrite(
          agent,
          {
            count: params.count,
            fromChapter: params.fromChapter,
            overwrite: params.overwrite,
          },
          signal,
        )
      case 'import-manuscript':
        return service.importManuscript(agent, { sourcePath: params.sourcePath })
      case 'prompt-save': {
        const config = params.config && typeof params.config === 'object' ? params.config : params
        if (params.scope === 'global') return service.saveGlobalInjection(config)
        return service.saveProjectInjection(agent, config)
      }
      default:
        throw new Error(`unknown action: ${action}`)
    }
  }

  const registerWebRoutes = () => {
    const disposeState = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/state',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('sessionId')
          const agent = sessionId ? ctx.agents.get(sessionId) : undefined
          if (!agent) {
            return jsonResponse(res, 404, { ok: false, error: { message: 'session not found', code: 'NO_LIVE_SESSION' } })
          }
          const data = lossless(await stateFor(agent))
          jsonResponse(res, 200, { ok: true, data })
        } catch (error) {
          jsonResponse(res, 500, {
            ok: false,
            error: { message: errorText(error), code: error?.code ?? null },
          })
        }
      },
    })

    const disposeChapter = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/chapter',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('sessionId')
          const number = Number(url.searchParams.get('number'))
          const agent = sessionId ? ctx.agents.get(sessionId) : undefined
          if (!agent) {
            return jsonResponse(res, 404, { ok: false, error: { message: 'session not found', code: 'NO_LIVE_SESSION' } })
          }
          if (!Number.isFinite(number)) {
            return jsonResponse(res, 400, { ok: false, error: { message: 'invalid chapter number' } })
          }
          const data = lossless(await service.chapterDetail(agent, number))
          jsonResponse(res, 200, { ok: true, data })
        } catch (error) {
          jsonResponse(res, 500, {
            ok: false,
            error: { message: errorText(error), code: error?.code ?? null, raw: error?.raw ?? null },
          })
        }
      },
    })

    const disposeProjectState = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-state',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const root = validProjectRoot(url.searchParams.get('projectRoot'))
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          jsonResponse(res, 200, { ok: true, data: lossless(await stateFor(root)) })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null, raw: error?.raw ?? null } })
        }
      },
    })

    const disposeProjectSignature = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-signature',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const root = validProjectRoot(url.searchParams.get('projectRoot'))
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          jsonResponse(res, 200, { ok: true, data: lossless(await service.projectSignature(root)) })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
        }
      },
    })

    const disposeProjectRuns = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-runs',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const root = validProjectRoot(url.searchParams.get('projectRoot'))
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          const prefix = `${root}\u0000`
          const runs = [...runProgress.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([, value]) => value)
          // 同时返回当前活动锁（owner/resource/startedAt），UI 可展示「助手正在写第 N 章」等。
          jsonResponse(res, 200, { ok: true, data: { runs, locks: listActiveLocks(activeRuns) } })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error) } })
        }
      },
    })

    const disposeProjectChapter = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-chapter',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const root = validProjectRoot(url.searchParams.get('projectRoot'))
          const number = Number(url.searchParams.get('number'))
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          if (!Number.isFinite(number)) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid chapter number' } })
          jsonResponse(res, 200, { ok: true, data: lossless(await service.chapterDetail(root, number)) })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null, raw: error?.raw ?? null } })
        }
      },
    })

    const disposeProjectAction = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-action',
      handler: async (req, res) => {
        let logRoot = null
        let actionName = null
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          logRoot = root
          actionName = body.action
          const params = body.params && typeof body.params === 'object' ? body.params : {}
          const run = acquireRun(activeRuns, root, body.action, params)
          await logAction(root, {
            action: body.action,
            resource: run.resource,
            busy: Boolean(run.busy),
            params: summarizeParams(params),
          })
          if (run.busy) {
            return jsonResponse(res, 409, {
              ok: false,
              error: { message: `该动作正在进行（${run.resource}），请等待完成或先取消`, code: 'NOVEL_WRITER_BUSY', resource: run.resource },
            })
          }
          try {
            const data = lossless(await dispatchWithProgress(root, body.action, params, run.controller.signal))
            if (run.controller.signal.aborted) {
              return jsonResponse(res, 499, { ok: false, error: { message: '已取消', code: 'NOVEL_WRITER_CANCELLED' } })
            }
            await logAction(root, { action: body.action, ok: true })
            jsonResponse(res, 200, { ok: true, data })
          } finally {
            releaseRun(activeRuns, root, run)
          }
        } catch (error) {
          await logAction(logRoot, { action: actionName, error: errorText(error), code: error?.code ?? null })
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null, raw: error?.raw ?? null, runId: error?.runId ?? null } })
        }
      },
    })

    const disposeProjectCancel = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-cancel',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          const locks = root ? activeRuns.get(root) : undefined
          const resource = typeof body.resource === 'string' ? body.resource : null
          let count = 0
          if (locks) {
            for (const [key, controller] of locks) {
              if (resource && key !== resource) continue
              controller.abort()
              count += 1
            }
          }
          jsonResponse(res, 200, { ok: true, data: { cancelled: count > 0, count } })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error) } })
        }
      },
    })

    const disposeProjectPause = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-pause',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          const resource = typeof body.resource === 'string' ? body.resource : 'chapter:batch'
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          pauseRequests.add(`${root}\u0000${resource}`)
          jsonResponse(res, 200, { ok: true, data: { paused: true, resource } })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error) } })
        }
      },
    })

    const disposePremiseStream = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/premise-stream',
      handler: async (req, res) => {
        const send = (event, data) => {
          if (res.writableEnded) return
          try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          } catch {
            // client disconnected mid-stream
          }
        }
        let run = null
        let root = null
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          run = acquireRun(activeRuns, root, 'premise-candidates', {})
          if (run.busy) {
            return jsonResponse(res, 409, {
              ok: false,
              error: { message: '构思候选正在生成，请稍候', code: 'NOVEL_WRITER_BUSY', resource: run.resource },
            })
          }
          res.statusCode = 200
          res.setHeader('content-type', 'text/event-stream; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.setHeader('connection', 'keep-alive')
          res.flushHeaders?.()
          res.on('close', () => run.controller.abort())
          const params = body.params && typeof body.params === 'object' ? body.params : {}
          const data = lossless(await service.premiseCandidates(root, {
            count: params.count,
            instruction: params.instruction,
            reference: params.reference,
            intent: params.intent,
            history: params.history,
            onDelta: (text) => send('delta', { text }),
          }, run.controller.signal))
          send('done', { ok: true, data })
        } catch (error) {
          if (!res.headersSent) {
            return jsonResponse(res, 500, {
              ok: false,
              error: { message: errorText(error), code: error?.code ?? null },
            })
          }
          send('error', { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
        } finally {
          if (run?.acquired) releaseRun(activeRuns, root, run)
          try {
            res.end()
          } catch {
            // response may already be closed
          }
        }
      },
    })

    const disposeModels = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/models',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          jsonResponse(res, 200, { ok: true, data: lossless(await service.modelCatalog()) })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
        }
      },
    })

    const disposeModelInfo = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/model-info',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const provider = url.searchParams.get('provider') ?? ''
          const model = url.searchParams.get('model') ?? ''
          if (!provider || !model) {
            return jsonResponse(res, 400, { ok: false, error: { message: 'provider and model required' } })
          }
          jsonResponse(res, 200, { ok: true, data: lossless(await service.modelInfo(provider, model)) })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
        }
      },
    })

    const disposeContextPreview = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/context',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const root = validProjectRoot(url.searchParams.get('projectRoot'))
          const number = Number(url.searchParams.get('number'))
          if (!root || !Number.isFinite(number)) {
            return jsonResponse(res, 400, { ok: false, error: { message: 'invalid context request' } })
          }
          jsonResponse(res, 200, { ok: true, data: lossless(await service.contextPreview(root, { number })) })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
        }
      },
    })

    const disposeProjectRevision = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/project-revision',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: { message: 'GET only' } })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const root = validProjectRoot(url.searchParams.get('projectRoot'))
          const number = Number(url.searchParams.get('number'))
          const name = url.searchParams.get('name') ?? ''
          if (!root || !Number.isFinite(number) || !name) {
            return jsonResponse(res, 400, { ok: false, error: { message: 'invalid revision request' } })
          }
          jsonResponse(res, 200, { ok: true, data: lossless(await service.readRevisionDetail(root, number, name)) })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
        }
      },
    })

    const disposeAction = ctx.webServer.register({      kind: 'exact',
      path: '/novel-writer/action',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const agent = typeof body.sessionId === 'string' ? ctx.agents.get(body.sessionId) : undefined
          if (!agent) {
            return jsonResponse(res, 404, { ok: false, error: { message: 'session not found', code: 'NO_LIVE_SESSION' } })
          }
          const params = body.params && typeof body.params === 'object' ? body.params : {}
          const run = acquireRun(activeRuns, agent.id, body.action, params)
          if (run.busy) {
            return jsonResponse(res, 409, {
              ok: false,
              error: { message: `该动作正在进行（${run.resource}），请等待完成或先取消`, code: 'NOVEL_WRITER_BUSY', resource: run.resource },
            })
          }
          try {
            const data = lossless(await dispatchWithProgress(agent, body.action, params, run.controller.signal))
            if (run.controller.signal.aborted) {
              return jsonResponse(res, 499, {
                ok: false,
                error: { message: '已取消', code: 'NOVEL_WRITER_CANCELLED' },
              })
            }
            jsonResponse(res, 200, { ok: true, data })
          } finally {
            releaseRun(activeRuns, agent.id, run)
          }
        } catch (error) {
          jsonResponse(res, 500, {
            ok: false,
            error: {
              message: errorText(error),
              code: error?.code ?? null,
              raw: error?.raw ?? null,
              runId: error?.runId ?? null,
            },
          })
        }
      },
    })

    const disposeCancel = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/cancel',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const locks = typeof body.sessionId === 'string' ? activeRuns.get(body.sessionId) : undefined
          const resource = typeof body.resource === 'string' ? body.resource : null
          let count = 0
          if (locks) {
            for (const [key, controller] of locks) {
              if (resource && key !== resource) continue
              controller.abort()
              count += 1
            }
          }
          jsonResponse(res, 200, { ok: true, data: { cancelled: count > 0, count } })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error) } })
        }
      },
    })

    /*
     * 写作台内部对话入口：确保项目父会话在线，并返回/创建 continuable 子代理会话地址。
     * client 拿到地址后用 sessions.retain + 官方 conversation.content 内嵌展示。
     */
    const disposeConversation = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/conversation',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          const data = await ensureConversation(root)
          jsonResponse(res, 200, { ok: true, data })
        } catch (error) {
          jsonResponse(res, 500, {
            ok: false,
            error: { message: errorText(error), code: error?.code ?? null },
          })
        }
      },
    })

    const disposeConversationSummary = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/conversation/summary',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          const data = await summarizeConversation(root)
          jsonResponse(res, 200, { ok: true, data })
        } catch (error) {
          jsonResponse(res, 500, {
            ok: false,
            error: { message: errorText(error), code: error?.code ?? null },
          })
        }
      },
    })

    const disposeConversationReset = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/conversation/reset',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          const data = await resetConversation(root, typeof body.carryover === 'string' ? body.carryover : '')
          jsonResponse(res, 200, { ok: true, data })
        } catch (error) {
          jsonResponse(res, 500, {
            ok: false,
            error: { message: errorText(error), code: error?.code ?? null },
          })
        }
      },
    })

    const disposeClientLog = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/client-log',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false })
          const body = await readRequestBody(req)
          const line = `${JSON.stringify({ time: new Date().toISOString(), body })}\n`
          try {
            await appendFile(join(tmpdir(), 'novel-writer-client.log'), line, 'utf8')
          } catch {
            // best-effort diagnostics
          }
          jsonResponse(res, 200, { ok: true })
        } catch {
          jsonResponse(res, 200, { ok: false })
        }
      },
    })

    return () => {
      disposeSignatureWatches()
      // 关闭全部 SQLite 连接（LRU 缓存），避免插件卸载后 DB 句柄泄漏。
      service.disposeStores()
      disposeConversationReset()
      disposeConversationSummary()
      disposeConversation()
      disposePremiseStream()
      disposeContextPreview()
      disposeModelInfo()
      disposeModels()
      disposeProjectRevision()
      disposeProjectCancel()
      disposeProjectPause()
      disposeProjectRuns()
      disposeProjectSignature()
      disposeProjectAction()
      disposeProjectChapter()
      disposeProjectState()
      disposeClientLog()
      disposeCancel()
      disposeAction()
      disposeChapter()
      disposeState()
    }
  }

  // 内置技法技能 provider：注册在宿主层（rank 600），导入技能（rank 100–500）同名覆盖内置。
  const skillsService = ctx.get?.('skills')
  if (skillsService && typeof skillsService.registerProvider === 'function') {
    const disposeCraftSkillProvider = skillsService.registerProvider(() => createCraftSkillProvider(service))
    if (typeof ctx.effect === 'function') ctx.effect(() => disposeCraftSkillProvider)
  }

  ctx.effect(registerWebRoutes)
}

