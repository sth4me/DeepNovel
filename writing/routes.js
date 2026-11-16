// 最小 HTTP API：项目树、文档读写、提案/diff、连续性。供可选 UI 使用。
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Project } from './project.js'
import { deleteReference, importReferences, listReferences, readReference, searchReferences, updateReference } from './references.js'
import { withProjectLock } from './locks.js'
import { ROUTE_ROLES, normalizeRouting, resolveTaskRoute } from './routing.js'
import { configureTaskHub, taskHub } from './taskhub.js'
import { accessForTask } from './scopes.js'
import { buildTaskBrief } from './brief.js'

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function loopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function body(req) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > 4_000_000) throw new Error('请求体过大')
  }
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function projectRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('缺少 projectRoot')
  return resolve(value)
}

function validKind(kind) {
  return ['book', 'world', 'character', 'volume', 'arc', 'chapter', 'manuscript', 'summary', 'ledger'].includes(kind)
}

export function registerWritingRoutes(ctx, webServer) {
  const disposers = []
  const register = (path, handler) => {
    disposers.push(webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          if (!loopback(req)) return json(res, 403, { ok: false, error: { message: 'loopback only' } })
          const data = await handler(req)
          json(res, 200, { ok: true, data })
        } catch (error) {
          json(res, 400, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
        }
      },
    }))
  }

  register('/deepnovel/api/status', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const project = await Project.open(root)
    return { root, map: await project.projectMap() }
  })

  register('/deepnovel/api/tree', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const project = await Project.open(root)
    return { root, ...(await project.tree()) }
  })

  register('/deepnovel/api/init', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const existing = await Project.open(root).catch(() => null)
    if (existing) return { initialized: false, map: await existing.projectMap() }
    const project = await Project.init(root, payload)
    return { initialized: true, map: await project.projectMap() }
  })

  register('/deepnovel/api/search', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    return project.search(payload.query, { limit: payload.limit })
  })

  register('/deepnovel/api/references', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const project = await Project.open(root)
    return { sources: await listReferences(project) }
  })

  register('/deepnovel/api/reference', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const project = await Project.open(root)
    return readReference(project, url.searchParams.get('id') ?? '')
  })

  register('/deepnovel/api/references/import', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    return withProjectLock(root, async () => {
      const project = await Project.open(root)
      return importReferences(project, payload.sourcePath, { kind: payload.kind, tags: payload.tags })
    })
  })

  register('/deepnovel/api/references/delete', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    return withProjectLock(root, async () => {
      const project = await Project.open(root)
      return deleteReference(project, payload.id)
    })
  })

  register('/deepnovel/api/references/update', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    return withProjectLock(root, async () => {
      const project = await Project.open(root)
      return updateReference(project, payload.id, payload)
    })
  })

  register('/deepnovel/api/references/search', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    return searchReferences(project, payload.query, { limit: payload.limit })
  })

  register('/deepnovel/api/export', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    return project.exportMarkdown({ scope: payload.scope, volumeId: payload.volumeId, chapterId: payload.chapterId })
  })

  register('/deepnovel/api/revisions', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const kind = url.searchParams.get('kind') ?? ''
    if (!validKind(kind)) throw new Error(`未知文档类型：${kind}`)
    const project = await Project.open(root)
    return project.revisions(kind, url.searchParams.get('id') ?? '')
  })

  register('/deepnovel/api/revision', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const project = await Project.open(root)
    return project.readRevision(url.searchParams.get('name') ?? '')
  })

  const agentServices = () => ({
    agents: typeof ctx.get === 'function' ? ctx.get('agents') : undefined,
    subagents: typeof ctx.get === 'function' ? ctx.get('subagents') : undefined,
    llm: typeof ctx.get === 'function' ? ctx.get('llm') : undefined,
    defaultModel: typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined,
  })

  const taskMessage = (text) => ({
    id: `msg-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })

  configureTaskHub(() => agentServices())

  register('/deepnovel/api/run', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    const { agents, llm, defaultModel } = agentServices()
    const parentSessionId = typeof payload.parentSessionId === 'string' ? payload.parentSessionId : ''
    const parent = parentSessionId && agents?.get ? agents.get(parentSessionId) : undefined
    let base = parent?.model?.current?.() ?? null
    if (!base) base = defaultModel?.currentSelection?.() ?? null
    let efforts = []
    if (llm && base?.provider && base?.model) {
      try {
        const info = await llm.resolveModelInfo(base.provider, base.model)
        efforts = (info.reasoning?.efforts ?? []).map((effort) => String(effort.id))
      } catch {
        efforts = []
      }
    }
    const role = payload.role === 'prose' ? 'prose' : 'plan'
    const route = await resolveTaskRoute({
      routing: project.routing(),
      role,
      base: { provider: base?.provider ?? '', model: base?.model ?? '', efforts },
      resolveEfforts: llm
        ? async (provider, model) => {
          const info = await llm.resolveModelInfo(provider, model)
          return (info.reasoning?.efforts ?? []).map((effort) => String(effort.id))
        }
        : undefined,
    })
    const access = accessForTask({
      title: String(payload.title ?? ''),
      chapterId: String(payload.chapterId ?? ''),
      access: payload.access,
    })
    await taskHub().ensureRoot(root)
    const taskPrompt = String(payload.prompt ?? '')
    let brief = ''
    if (role === 'prose' || payload.chapterId) {
      try {
        brief = await buildTaskBrief(project, { role, chapterId: String(payload.chapterId ?? '') })
      } catch {
        brief = ''
      }
    }
    const queued = taskHub().queue.enqueue(root, {
      title: payload.title,
      role,
      prompt: brief ? `${taskPrompt}

${brief}` : taskPrompt,
      parentSessionId,
      route,
      access,
      root,
    })
    return queued
  })

  register('/deepnovel/api/tasks', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    await taskHub().ensureRoot(root)
    return { tasks: taskHub().queue.snapshot(root) }
  })

  register('/deepnovel/api/tasks/all', async () => {
    const scopes = taskHub().queue.snapshotAll()
    const running = scopes.reduce((total, item) => total + item.active, 0)
    return { scopes, running }
  })

  register('/deepnovel/api/run/stop', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const taskId = String(payload.taskId ?? '')
    if (!taskId) return { stopped: false, reason: '缺少 taskId' }
    const result = taskHub().queue.cancel(root, taskId)
    return { stopped: Boolean(result.cancelled), running: Boolean(result.running), task: result.task }
  })

  register('/deepnovel/api/run/status', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ids = String(url.searchParams.get('sessionIds') ?? '').split(',').map((item) => item.trim()).filter(Boolean)
    const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    const statuses = {}
    for (const id of ids) {
      const agent = agents?.get?.(id)
      statuses[id] = { live: Boolean(agent), status: agent?.status ?? 'unknown' }
    }
    return { statuses }
  })

  register('/deepnovel/api/routing', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const payload = req.method === 'POST' ? await body(req) : {}
    const root = projectRoot(url.searchParams.get('projectRoot') ?? payload.projectRoot)
    const project = await Project.open(root)
    if (req.method === 'POST') {
      const patch = payload.routing ?? payload
      const routing = await withProjectLock(root, () => project.setRouting(patch))
      const dialogue = payload.dialogue
        ? await withProjectLock(root, () => project.setDialogue(payload.dialogue))
        : project.dialogue()
      return { routing, dialogue, roles: ROUTE_ROLES }
    }
    return { routing: project.routing(), dialogue: project.dialogue(), roles: ROUTE_ROLES }
  })

  register('/deepnovel/api/models', async () => {
    const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
    if (!llm) return { providers: [] }
    const providers = []
    for (const provider of llm.listProviders()) {
      try {
        const models = await llm.listModels(provider.id)
        const rows = []
        for (const model of models) {
          let efforts = []
          try {
            const info = await llm.resolveModelInfo(provider.id, model.id)
            efforts = (info.reasoning?.efforts ?? []).map((effort) => String(effort.id))
          } catch {
            efforts = []
          }
          rows.push({ id: model.id, name: model.name ?? model.id, efforts })
        }
        providers.push({ id: provider.id, name: provider.name, models: rows })
      } catch {
        // 单个 provider 失败不影响其他路由
      }
    }
    return { providers }
  })

  register('/deepnovel/api/doc', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const kind = url.searchParams.get('kind') ?? ''
    if (!validKind(kind)) throw new Error(`未知文档类型：${kind}`)
    const project = await Project.open(root)
    return project.read(kind, url.searchParams.get('id') ?? '')
  })

  register('/deepnovel/api/save', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    if (!validKind(payload.kind)) throw new Error(`未知文档类型：${payload.kind}`)
    const project = await Project.open(root)
    return project.saveDoc(payload.kind, payload.id ?? '', payload.content ?? '', { expectedHash: payload.expectedHash ?? null })
  })

  register('/deepnovel/api/propose', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    if (!validKind(payload.kind)) throw new Error(`未知文档类型：${payload.kind}`)
    const project = await Project.open(root)
    return project.proposeWrite(payload.kind, payload.id ?? '', payload.content ?? '')
  })

  register('/deepnovel/api/proposals', async (req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = projectRoot(url.searchParams.get('projectRoot'))
    const project = await Project.open(root)
    return { proposals: await project.listProposals() }
  })

  register('/deepnovel/api/proposals/reject', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    return project.rejectProposal(payload.id)
  })

  register('/deepnovel/api/apply', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    return project.applyProposal(payload.proposalId, { confirm: payload.confirm === true })
  })

  register('/deepnovel/api/continuity', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    if (payload.action === 'get') return project.readLedger()
    return project.commitChapter(payload)
  })

  register('/deepnovel/api/meta', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    if (payload.style) await project.setStyle(payload.style)
    return project.setMeta(payload)
  })

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 已销毁
      }
    }
  }
}
