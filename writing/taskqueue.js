// 任务队列：按文件作用域判断冲突。互不冲突的任务并行，冲突的排队。
import { conflicts, normalizeAccess } from './access.js'

export const DEFAULT_MAX_CONCURRENT = 3
const HISTORY_LIMIT = 50

function nowIso() {
  return new Date().toISOString()
}

export function createTaskQueue({ run, cancelRun, onFailed, maxConcurrent = DEFAULT_MAX_CONCURRENT, onChange }) {
  const scopes = new Map()

  const scope = (root) => {
    let value = scopes.get(root)
    if (!value) {
      value = { waiting: [], running: [], history: [] }
      scopes.set(root, value)
    }
    return value
  }

  const notify = (root) => {
    try { onChange?.(root, snapshot(root)) } catch {
      // 持久化失败不影响调度
    }
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
    notify(root)
    void (async () => {
      try {
        await run(task, { setSession: (sessionId) => { task.sessionId = sessionId } })
        task.state = 'done'
      } catch (error) {
        task.state = 'failed'
        task.error = String(error?.message ?? error)
        try { await onFailed?.(task) } catch {
          // 通知失败不影响调度
        }
      } finally {
        task.finishedAt = nowIso()
        const index = state.running.indexOf(task)
        if (index >= 0) state.running.splice(index, 1)
        state.history.unshift(publicTask(task))
        if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT
        notify(root)
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
    notify(root)
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
      notify(root)
      return { cancelled: true, running: false, task: publicTask(task, 'stopped') }
    }
    const running = state.running.find((task) => task.id === taskId)
    if (running) {
      running.state = 'stopped'
      running.finishedAt = nowIso()
      try { cancelRun?.(running) } catch {
        // 会话已结束时无需再取消
      }
      notify(root)
      return { cancelled: true, running: true, task: publicTask(running, 'stopped') }
    }
    const history = state.history.find((task) => task.id === taskId)
    return { cancelled: false, running: false, task: history ?? null }
  }

  /** 从持久化记录恢复历史；重启时未完成的任务标记为中断。 */
  function hydrate(root, tasks) {
    const state = scope(root)
    if (state.hydrated) return
    state.hydrated = true
    const list = Array.isArray(tasks) ? tasks : []
    for (const item of list.slice(-HISTORY_LIMIT * 2)) {
      if (!item?.id) continue
      const state_ = item.state === 'running' || item.state === 'waiting' ? 'stopped' : item.state
      state.history.push({
        ...item,
        state: state_,
        ...(state_ === 'stopped' && (item.state === 'running' || item.state === 'waiting')
          ? { error: item.error || '宿主重启，任务已中断' }
          : {}),
      })
    }
    state.history.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT
  }

  function snapshotAll() {
    const result = []
    for (const [root, state] of scopes.entries()) {
      const tasks = snapshot(root)
      const active = tasks.filter((task) => task.state === 'running' || task.state === 'waiting')
      if (active.length === 0 && state.history.length === 0) continue
      result.push({ root, active: active.length, tasks: tasks.slice(0, 20) })
    }
    return result
  }

  return { enqueue, snapshot, snapshotAll, cancel, hydrate }
}
