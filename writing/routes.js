// 最小 HTTP API：项目树、文档读写、提案/diff、连续性。供可选 UI 使用。
import { resolve } from 'node:path'
import { Project } from './project.js'

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

  register('/deepnovel/api/export', async (req) => {
    if (req.method !== 'POST') throw new Error('POST only')
    const payload = await body(req)
    const root = projectRoot(payload.projectRoot)
    const project = await Project.open(root)
    return project.exportMarkdown()
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
