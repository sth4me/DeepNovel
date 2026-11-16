// 任务模型路由：按任务类型记录 provider/model/思考档，按项目保存。
// 空字段表示继承当前会话；不支持的档位回落，不阻断任务。

export const ROUTE_ROLES = [
  { id: 'plan', label: '规划 / 检查', hint: '开书、设定、人物、大纲、资料整理、一致性检查' },
  { id: 'prose', label: '写正文', hint: '写正文、润色、局部改写' },
]

export const ROUTE_EFFORTS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const MAX_ID_LENGTH = 200

function text(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_ID_LENGTH) : ''
}

export function normalizeRoute(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const effort = text(source.reasoningEffort)
  return {
    provider: text(source.provider),
    model: text(source.model),
    reasoningEffort: ROUTE_EFFORTS.includes(effort) ? effort : '',
  }
}

export function normalizeRouting(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const result = {}
  for (const role of ROUTE_ROLES) result[role.id] = normalizeRoute(source[role.id])
  return result
}

export function emptyRoute() {
  return { provider: '', model: '', reasoningEffort: '' }
}

export function routeIsEmpty(route) {
  const value = normalizeRoute(route)
  return !value.provider && !value.model && !value.reasoningEffort
}

/** 把支持档位按由弱到强排序，返回最接近期望的可用档位。 */
export function pickEffort(available, wanted) {
  const list = Array.isArray(available) ? available.filter((item) => typeof item === 'string' && item) : []
  if (list.length === 0) return ''
  if (!wanted) return ''
  if (list.includes(wanted)) return wanted
  const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const target = order.indexOf(wanted)
  if (target < 0) return ''
  for (let index = target; index >= 0; index -= 1) {
    if (list.includes(order[index])) return order[index]
  }
  for (let index = target + 1; index < order.length; index += 1) {
    if (list.includes(order[index])) return order[index]
  }
  return ''
}

/**
 * 计算一次任务实际使用的路由。
 * @param routing 项目的 routing 段
 * @param role 任务类型
 * @param fallback 当前会话的 provider/model 与可用档位
 * @returns 实际路由与说明；`inherited` 表示没有单独配置
 */
export function resolveRoute(routing, role, fallback = {}) {
  const configured = normalizeRoute(routing?.[role])
  const inherit = {
    provider: text(fallback.provider),
    model: text(fallback.model),
  }
  const available = Array.isArray(fallback.efforts) ? fallback.efforts : []
  if (!configured.provider && !configured.model) {
    return {
      inherited: true,
      provider: inherit.provider,
      model: inherit.model,
      reasoningEffort: pickEffort(available, configured.reasoningEffort || fallback.reasoningEffort),
      note: '跟随当前会话',
    }
  }
  const effort = pickEffort(available, configured.reasoningEffort)
  return {
    inherited: false,
    provider: configured.provider || inherit.provider,
    model: configured.model || inherit.model,
    reasoningEffort: effort,
    note: effort === configured.reasoningEffort ? '' : `思考档 ${configured.reasoningEffort || '未设置'} 不可用，已回落为 ${effort || '默认'}`,
  }
}

/**
 * 解析任务实际使用的路由。可用档位必须来自最终生效的 provider/model，
 * 否则会出现「把基座模型支持的档位传给另一个模型」的非法组合。
 */
export async function resolveTaskRoute({ routing, role, base = {}, resolveEfforts }) {
  const configured = normalizeRoute(routing?.[role])
  const provider = configured.provider || base.provider || ''
  const model = configured.model || base.model || ''
  let efforts = Array.isArray(base.efforts) ? base.efforts : []
  if (typeof resolveEfforts === 'function' && provider && model) {
    try {
      const resolved = await resolveEfforts(provider, model)
      if (Array.isArray(resolved)) efforts = resolved
    } catch {
      // 目标模型不可用时清空档位，交给执行阶段报出原始错误
      efforts = []
    }
  }
  return resolveRoute(routing, role, { provider, model, efforts })
}

export function describeRoute(route) {
  const value = normalizeRoute(route)
  if (!value.provider && !value.model) return '跟随当前会话'
  const model = `${value.provider || '默认'}/${value.model || '默认'}`
  return value.reasoningEffort ? `${model} · ${value.reasoningEffort}` : model
}
