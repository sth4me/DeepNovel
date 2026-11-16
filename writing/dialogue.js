// 对话内正文策略：默认对话只编排，正文生成交给路由模型的后台任务；
// 项目设置打开 proseInline 后允许对话模型直接改正文。

const GENERATION_ACTIONS = new Set(['propose', 'append', 'patch'])

export function normalizeDialogue(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return { proseInline: source.proseInline === true }
}

export function isQueuedAgent(agent, isQueuedSession) {
  if (!agent) return false
  const depth = Number(agent?.options?.subagentDepth ?? 0)
  if (Number.isFinite(depth) && depth > 0) return true
  try {
    return isQueuedSession?.(String(agent.id ?? '')) === true
  } catch {
    return false
  }
}

/**
 * 判断这次写操作是否必须改走 novel_task。
 * @returns 阻止原因，或 undefined 表示允许
 */
export function inlineProseBlock({ kind, action, agent, dialogue, isQueuedSession }) {
  if (kind !== 'manuscript') return undefined
  if (!GENERATION_ACTIONS.has(String(action))) return undefined
  if (normalizeDialogue(dialogue).proseInline) return undefined
  if (isQueuedAgent(agent, isQueuedSession)) return undefined
  return [
    '当前项目关闭了「对话内直接改正文」，正文生成要交给配置的正文模型。',
    '请用 novel_task（role=prose，带 chapterId 和写作要求）提交后台任务，生成后在这里验收；',
    '如果确实要在对话里直接改，让用户在项目设置打开「对话内直接改正文」。',
  ].join('')
}
