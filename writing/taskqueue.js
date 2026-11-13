// 任务队列：按文件作用域判断冲突。互不冲突的任务并行，冲突的排队。
import { conflicts, normalizeAccess } from './access.js'

export const DEFAULT_MAX_CONCURRENT = 3
const HISTORY_LIMIT = 50

function nowIso() {
  return new Date().toISOString()
}

export function createTaskQueue({ run, cancelRun, maxConcurrent = DEFAULT_MAX_CONCURRENT }) {
  const scopes = new Map()

  const scope = (root) => {
    let value = scopes.get(root)
    if (!value) {
      value = { waiting: [], running: [], history: [] }
      scopes.set(root, value)
    }
    return value
  }

  const publicTask = (task, state) => ({
    id: task.id,
    title: task.title,
    role: task.role,
    state: state ?? task.state,
    sessionId: task.sessionId ?? '',
    route: task.route ?? null,
    access: task.access,
    error: task.error ?? '',
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? '',
    finishedAt: task.finishedAt ?? '',
    position: task.position ?? 0,
  })

  function canRun(task, running) {
    if (running.length >= maxConcurrent) return false
    return !running.some((item) => conflicts(item.access, task.access))
  }

  function pump(root) {
    const state = scope(root)
    for (;;) {
      const index = state.waiting.findIndex((task) => canRun(task, state.running))
      if (index < 0) return
      const [task] = state.waiting.splice(index, 1)
      start(root, task)
    }
  }

  function start(root, task) {
    const state = scope(root)
    task.state = 'running'
    task.startedAt = nowIso()
    state.running.push(task)
    void (async () => {
      try {
        await run(task, { setSession: (sessionId) => { task.sessionId = sessionId } })
        task.state = 'done'
      } catch (error) {
        task.state = 'failed'
        task.error = String(error?.message ?? error)
      } finally {
        task.finishedAt = nowIso()
        const index = state.running.indexOf(task)
        if (index >= 0) state.running.splice(index, 1)
        state.history.unshift(publicTask(task))
        if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT
        pump(root)
      }
    })()
  }

  function enqueue(root, spec) {
    const state = scope(root)
    const title = String(spec.title ?? '').slice(0, 200)
    const prompt = String(spec.prompt ?? '')
    const access = normalizeAccess(spec.access)
    const duplicate = [...state.running, ...state.waiting].find((task) => task.title === title && task.prompt === prompt)
    if (duplicate) {
      return { task: publicTask(duplicate, duplicate.state), duplicate: true, tasks: snapshot(root) }
    }
    const task = {
      id: String(spec.id ?? `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
      title,
      role: spec.role === 'prose' ? 'prose' : 'plan',
      prompt,
      parentSessionId: spec.parentSessionId ?? '',
      route: spec.route ?? null,
      access,
      root: spec.root ?? root,
      state: 'waiting',
      createdAt: nowIso(),
    }
    state.waiting.push(task)
    pump(root)
    return { task: publicTask(task), duplicate: false, tasks: snapshot(root) }
  }

  function snapshot(root) {
    const state = scope(root)
    const waiting = state.waiting.map((task, index) => ({ ...publicTask(task, 'waiting'), position: index + 1 }))
    return [...state.running.map((task) => publicTask(task, 'running')), ...waiting, ...state.history]
  }

  function cancel(root, taskId) {
    const state = scope(root)
    const waitingIndex = state.waiting.findIndex((task) => task.id === taskId)
    if (waitingIndex >= 0) {
      const [task] = state.waiting.splice(waitingIndex, 1)
      task.state = 'stopped'
      task.finishedAt = nowIso()
      state.history.unshift(publicTask(task, 'stopped'))
      return { cancelled: true, running: false, task: publicTask(task, 'stopped') }
    }
    const running = state.running.find((task) => task.id === taskId)
    if (running) {
      running.state = 'stopped'
      running.finishedAt = nowIso()
      try { cancelRun?.(running) } catch {
        // 会话已结束时无需再取消
      }
      return { cancelled: true, running: true, task: publicTask(running, 'stopped') }
    }
    const history = state.history.find((task) => task.id === taskId)
    return { cancelled: false, running: false, task: history ?? null }
  }

  return { enqueue, snapshot, cancel }
}
