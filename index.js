import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NovelWriterService, runWithProgress } from './service.js'
import { LOCK_RULES, locksConflict, runResource } from './lock-rules.js'
import { setNovelWriter } from './runtime.js'

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
]

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export function acquireRun(activeRuns, owner, action, params) {
  sweepStaleRuns(activeRuns)
  const resource = runResource(action, params)
  if (!resource) return { resource: null, controller: new AbortController(), acquired: false }
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

/**
 * 模型调用可能卡死；锁不设上限会让整个项目永久 busy。
 * 超时只 abort 并移除对应锁，动作自身的 finally 仍会正常收尾。
 */
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
  const pauseRequests = new Set()

  const dispatchWithProgress = async (agent, action, params, signal) => {
    const resource = runResource(action, params)
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

    const markerTarget = await ctx.fs.resolve('story/project.json', { cwd })
    result.marker = (await ctx.fs.stat(markerTarget))
      ? { path: 'story/project.json', exists: true }
      : { path: 'story/project.json', exists: false }

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
      case 'prompt-catalog-save':
        return service.saveSystemPrompt(agent, { key: options.key, content: options.content })
      case 'prompt-catalog-reset':
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
    const status = await service.projectStatus(target)
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
      outlineAudit: await service.readJson(target, 'story/plot/outline-audit.json').catch(() => null),
      premiseChat: await service.readPremiseChat(target).catch(() => null),
      relations: await service.readRelations(target).catch(() => null),
      inspirations: await service.readInspirations(target).catch(() => null),
      deconstructions: await service.readDeconstructions(target).catch(() => null),
      systemOverrides: await service.readSystemOverrides(target).catch(() => ({})),
      health: await service.buildHealthReport(target).catch((error) => ({ issues: [], error: String(error?.message ?? error) })),
    }
    if (!status.initialized) return data
    const recentRuns = []
    try {
      const runsDir = await ctx.fs.resolve('.dsh-writing/runs', { cwd: status.cwd })
      const entries = await ctx.fs.listDir(runsDir)
      const files = entries
        .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 6)
      for (const entry of files) {
        try {
          const run = JSON.parse(await ctx.fs.readText(entry.target))
          recentRuns.push({
            runId: run.runId,
            kind: run.kind,
            number: run.number ?? null,
            createdAt: run.createdAt,
            usage: run.usage ?? null,
            parseError: run.parseError ?? null,
          })
        } catch {
          // ignore unreadable run ledger entries
        }
      }
    } catch {
      // run ledger is optional
    }
    const [premise, style, outline] = await Promise.all([
      service.readJson(target, 'story/premise.json').catch(() => null),
      service.readJson(target, 'story/style/contract.json').catch(() => null),
      service.readJson(target, 'story/plot/outline.json').catch(() => null),
    ])
    const bible = await service.readBible(target).catch(() => null)
    const chapters = await service.chaptersSummary(target).catch(() => [])
    const overview = await service.storyOverview(target).catch(() => null)
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
      power: await service.readPower(target).catch(() => null),
      outline,
      chapters,
      overview,
      snapshots: await service.listProjectSnapshots(target).catch(() => []),
      discussionApplies: await service.listDiscussionApplies(target).catch(() => []),
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
      case 'prompt-catalog-save':
        return service.saveSystemPrompt(agent, { key: params.key, content: params.content })
      case 'prompt-catalog-reset':
        return service.resetSystemPrompt(agent, { key: params.key })
      case 'prompt-catalog-export':
        return service.exportSystemPrompts(agent)
      case 'prompt-catalog-import':
        return service.importSystemPrompts(agent, { data: params.data })
      case 'inspiration-save':
        return service.saveInspiration(agent, { topic: params.topic, ideas: params.ideas })
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
      case 'assistant-chat':
        return service.assistantChat(agent, {
          message: params.message,
          taskId: params.taskId,
          background: params.background === true,
        })
      case 'assistant-live':
        return service.readJson(agent, 'story/assistant/live.json').catch(() => null)
      case 'assistant-thread':
        return service.readAssistantThread(agent)
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
      case 'assistant-apply':
        return service.assistantApply(agent, { actions: params.actions })
      case 'assistant-undo':
        return service.assistantUndo(agent)
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
      case 'discussion-undo':
        return service.undoDiscussionApply(agent, { applyId: params.applyId })
      case 'discussion-applies-clear':
        return service.pruneDiscussionApplies(agent, { keep: params.keep })
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
      case 'chapter-review':
        return service.chapterReview(agent, { number: params.number }, signal)
      case 'chapter-audit':
        return service.auditChapter(agent, { number: params.number }, signal)
      case 'export-manuscript':
        return service.exportManuscript(agent, { format: params.format })
      case 'search-project':
        return service.searchProject(agent, { query: params.query })
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
          jsonResponse(res, 200, { ok: true, data: runs })
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

    const disposeDiscussion = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/discussion',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method === 'GET') {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const root = validProjectRoot(url.searchParams.get('projectRoot'))
            const topicId = url.searchParams.get('topicId')
            if (!root || !topicId) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot or topicId' } })
            jsonResponse(res, 200, { ok: true, data: lossless(await service.readDiscussion(root, topicId)) })
            return
          }
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'GET or POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          const data = lossless(await service.discuss(root, {
            topicId: body.topicId,
            topic: body.topic,
            item: body.item,
            message: body.message,
          }))
          jsonResponse(res, 200, { ok: true, data })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
        }
      },
    })

    const disposeDiscussionStream = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/discussion-stream',
      handler: async (req, res) => {
        const send = (event, data) => {
          if (res.writableEnded) return
          try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          } catch {
            // client disconnected mid-stream
          }
        }
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          res.statusCode = 200
          res.setHeader('content-type', 'text/event-stream; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.setHeader('connection', 'keep-alive')
          res.flushHeaders?.()
          const controller = new AbortController()
          res.on('close', () => controller.abort())
          const data = lossless(await service.discussStream(root, {
            topicId: body.topicId,
            topic: body.topic,
            item: body.item,
            message: body.message,
            signal: controller.signal,
          }, (text) => send('delta', { text })))
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
          try {
            res.end()
          } catch {
            // response may already be closed
          }
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

    const disposeDiscussionApply = ctx.webServer.register({
      kind: 'exact',
      path: '/novel-writer/discussion-apply',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) return jsonResponse(res, 403, { ok: false, error: { message: 'loopback only' } })
          if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: { message: 'POST only' } })
          const body = await readRequestBody(req)
          const root = validProjectRoot(body.projectRoot)
          if (!root) return jsonResponse(res, 400, { ok: false, error: { message: 'invalid projectRoot' } })
          const data = lossless(await service.applyDiscussion(root, {
            action: body.action,
            topicId: body.topicId,
            topic: body.topic,
            reply: body.reply,
            result: body.result,
            item: body.item,
            actions: body.actions,
            applyId: body.applyId,
            number: body.number,
            instruction: body.instruction,
          }))
          jsonResponse(res, 200, { ok: true, data })
        } catch (error) {
          jsonResponse(res, 500, { ok: false, error: { message: errorText(error), code: error?.code ?? null } })
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
      disposeConversationReset()
      disposeConversationSummary()
      disposeConversation()
      disposeDiscussionStream()
      disposePremiseStream()
      disposeDiscussionApply()
      disposeContextPreview()
      disposeModelInfo()
      disposeModels()
      disposeDiscussion()
      disposeProjectRevision()
      disposeProjectCancel()
      disposeProjectPause()
      disposeProjectRuns()
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

  ctx.effect(registerWebRoutes)
}

