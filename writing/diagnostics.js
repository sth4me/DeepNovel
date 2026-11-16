// 进程内最近错误：激活结果没有 diagnostic 时，用它补足真实原因。
const entries = []

export function recordAgentError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message) return
  entries.push({ at: Date.now(), message })
  if (entries.length > 50) entries.shift()
}

export function recentAgentError(windowMs = 15000) {
  const now = Date.now()
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (now - entries[index].at <= windowMs) return entries[index].message
  }
  return ''
}
