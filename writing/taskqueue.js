// 任务队列：同一项目内可并行的并行执行，写类任务串行排队。
// 只负责调度，不关心执行细节；runner 由调用方注入，便于测试。

export const PARALLEL_LIMIT = 2
export const SERIAL_LIMIT = 1
const HISTORY_LIMIT = 50

/** 只读检查类任务可以并行；写正文、补设定、规划结构等都算写任务。 */
export function isParallelTask({ title = '', role = 'plan' } = {}) {
  if (role === 'prose') return false
  return /检查|分析|评估|盘点|清理|搜索|对比/.test(String(title))
}

function nowIso() {
  return new Date().toISOString()
}

/**
 * @param run 执行函数：收到任务，返回 Promise；resolve 表示完成，reject 表示失败
 * @param parallelLimit 并行任务上限
 * @param serialLimit 串行任务并发数
 */
export function createTaskQueue({ run, cancelRun, parallelLimit = PARALLEL_LIMIT, serialLimit = SERIAL_LIMIT }) {
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
    parallel: task.parallel,
    sessionId: task.sessionId ?? '',
    route: task.route ?? null,
    error: task.error ?? '',
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? '',
    finishedAt: task.finishedAt ?? '',
    position: task.position ?? 0,
  })

  function pump(root) {
    const state = scope(root)
    for (;;) {
      const parallelRunning = state.running.filter((task) => task.parallel).length
      const serialRunning = state.running.filter((task) => !task.parallel).length
      const index = state.waiting.findIndex((task) => (task.parallel ? parallelRunning < parallelLimit : serialRunning < serialLimit))
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
    const duplicate = [...state.running, ...state.waiting].find((task) => task.title === title && task.prompt === prompt)
    if (duplicate) {
      return { task: publicTask(duplicate, 'running'), duplicate: true, tasks: snapshot(root) }
    }
    const task = {
      id: String(spec.id ?? `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
      title,
      role: spec.role === 'prose' ? 'prose' : 'plan',
      prompt,
      parentSessionId: spec.parentSessionId ?? '',
      route: spec.route ?? null,
      state: 'waiting',
      parallel: isParallelTask({ title, role: spec.role }),
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
      try { cancelRun?.(running) } catch {}
      return { cancelled: true, running: true, task: publicTask(running, 'stopped') }
    }
    const history = state.history.find((task) => task.id === taskId)
    return { cancelled: false, running: false, task: history ?? null }
  }

  function finish(root, taskId, patch = {}) {
    const state = scope(root)
    const running = state.running.find((task) => task.id === taskId)
    if (running) Object.assign(running, patch)
    return snapshot(root)
  }

  return { enqueue, snapshot, cancel, finish }
}
