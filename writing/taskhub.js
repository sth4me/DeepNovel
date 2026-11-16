// 任务枢纽：路由和工具共用同一个队列，runner 用宿主服务执行子代理。
import { randomUUID } from 'node:crypto'
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

const queue = createTaskQueue({
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
  return { queue, configured: () => configured }
}
