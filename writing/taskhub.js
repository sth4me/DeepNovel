// 任务枢纽：路由和工具共用同一个队列，runner 用宿主服务执行子代理。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTaskQueue } from './taskqueue.js'

let services = () => ({})
let configured = false
const queuedSessions = new Set()

export function isQueuedSession(sessionId) {
  return queuedSessions.has(String(sessionId ?? ''))
}

/** 宿主上下文变化时更新服务解析器；幂等。 */
export function configureTaskHub(resolveServices) {
  if (typeof resolveServices === 'function') services = resolveServices
  configured = true
}

function userMessage(text) {
  return {
    id: `msg-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

const TASKS_DIR = '.dsh-writing'
const TASKS_FILE = 'tasks.json'
const loadedRoots = new Set()
const saveTimers = new Map()

function tasksPath(root) {
  return join(String(root), TASKS_DIR, TASKS_FILE)
}

async function loadPersisted(root) {
  try {
    const raw = await readFile(tasksPath(root), 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data?.tasks) ? data.tasks : []
  } catch {
    return []
  }
}

function scheduleSave(root, tasks) {
  const previous = saveTimers.get(root)
  if (previous) clearTimeout(previous)
  saveTimers.set(root, setTimeout(() => {
    saveTimers.delete(root)
    void (async () => {
      try {
        await mkdir(join(String(root), TASKS_DIR), { recursive: true })
        await writeFile(tasksPath(root), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), tasks }, null, 2), 'utf8')
      } catch {
        // 项目目录不可写时静默失败，不影响队列
      }
    })()
  }, 250))
}

export async function ensureTaskRoot(root) {
  const key = String(root ?? '')
  if (!key || loadedRoots.has(key)) return
  loadedRoots.add(key)
  queue.hydrate(key, await loadPersisted(key))
}

/** 通知文本：给主会话的汇报请求，明确不要自行继续开新任务。 */
export function taskNotice(task) {
  const label = task.state === 'failed' ? '失败' : task.state === 'stopped' ? '已停止' : '完成'
  const model = task.route?.model
    ? `（${task.route.model}${task.route.reasoningEffort ? ` · ${task.route.reasoningEffort}` : ''}）`
    : ''
  const parts = [
    `【后台任务${label}】${task.title}${model}`,
    task.sessionId ? `会话：${task.sessionId}` : '',
    task.error ? `错误：${task.error}` : '',
    `请向用户简短汇报这个结果：任务、状态、用到的模型、结果概要（可打开会话查看），以及建议的下一步。不要自行开始新的任务或继续修改正文，等用户决定。`,
  ]
  return parts.filter(Boolean).join('\n')
}

async function notifyParent(task) {
  const { agents } = services() ?? {}
  const parentId = task.parentSessionId
  if (!parentId || !agents?.get) return
  const parent = agents.get(parentId)
  if (!parent) return
  const message = {
    id: `msg-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text: taskNotice(task) }],
    source: { kind: 'user' },
  }
  try {
    if (typeof parent.followup === 'function') {
      parent.followup(message)
      return
    }
    parent.inject?.(message)
  } catch {
    // 父会话已结束时忽略通知
  }
}

const queue = createTaskQueue({
  onChange(root, tasks) {
    scheduleSave(root, tasks)
  },
  async run(task, control) {
    const { agents } = services() ?? {}
    if (!agents?.create) throw new Error('当前宿主不支持后台子代理执行')
    const parent = task.parentSessionId ? agents.get?.(task.parentSessionId) : undefined
    const sessionId = `session-${randomUUID()}`
    const agentOptions = {}
    if (task.route?.provider) agentOptions.provider = task.route.provider
    if (task.route?.model) agentOptions.model = task.route.model
    if (task.route?.reasoningEffort) agentOptions.reasoningEffort = task.route.reasoningEffort
    const handle = await agents.create({
      sessionId,
      ...(parent ? { parentAgent: parent } : {}),
      meta: {
        cwd: task.root,
        ...(task.parentSessionId ? { parentSession: task.parentSessionId } : {}),
        ...(parent ? { origin: 'subagent', delegationDepth: 1 } : {}),
        agentPreset: 'novel-writer',
      },
      agentOptions,
    })
    queuedSessions.add(sessionId)
    control.setSession(sessionId)
    handle.agent.followup(userMessage(String(task.prompt ?? '')))
    await handle.agent.whenIdle()
    await notifyParent({ ...task, state: 'done', sessionId })
  },
  async onFailed(task) {
    await notifyParent({ ...task, state: 'failed' })
  },
  cancelRun(task) {
    const { agents } = services() ?? {}
    const agent = task.sessionId ? agents?.get?.(task.sessionId) : undefined
    try { agent?.cancel?.({ kind: 'user' }) } catch {
      // 会话已结束时无需再取消
    }
  },
})

export function taskHub() {
  return { queue, ensureRoot: ensureTaskRoot, configured: () => configured }
}
