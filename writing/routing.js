// 任务模型路由：按任务类型记录 provider/model/思考档，按项目保存。
// 空字段表示继承当前会话；不支持的档位回落，不阻断任务。

export const ROUTE_ROLES = [
  { id: 'premise', label: '构思', hint: '开书方向、故事脊柱', group: '构思' },
  { id: 'bible', label: '设定与人物', hint: '世界观、人物、关系', group: '构思' },
  { id: 'outline', label: '章纲 / 大纲', hint: '分卷、章卡、结构', group: '结构', defaultEffort: 'low' },
  { id: 'draft', label: '正文草稿', hint: '写本章正文', group: '正文', defaultEffort: 'off' },
  { id: 'revise', label: '正文修订', hint: '按意见整章修订', group: '正文', defaultEffort: 'off-low' },
  { id: 'fix', label: '质检修复', hint: '按问题清单修补', group: '正文', defaultEffort: 'off-low' },
  { id: 'audit', label: '风格审稿', hint: 'AI 腔、文风一致性', group: '检查', defaultEffort: 'low' },
  { id: 'summary', label: '章节摘要', hint: '摘要与交接', group: '连续性' },
  { id: 'continuity', label: '连续性检查', hint: '事实、知情、时间线', group: '连续性' },
]

export const ROUTE_EFFORTS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const LEGACY_ROLES = {
  plan: ['premise', 'bible', 'outline', 'audit', 'summary', 'continuity'],
  prose: ['draft', 'revise', 'fix'],
}

const ROLE_DEFAULTS = Object.fromEntries(
  ROUTE_ROLES.map((role) => [role.id, role.defaultEffort ?? 'inherit']),
)

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

/** 旧版只有 plan/prose 两档；读取时展开到细分任务，但仍保留显式配置优先。 */
export function expandLegacyRoutes(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const routing = normalizeRouting(source)
  for (const [legacy, targets] of Object.entries(LEGACY_ROLES)) {
    const route = normalizeRoute(source[legacy])
    if (!route.provider && !route.model && !route.reasoningEffort) continue
    for (const target of targets) {
      if (routing[target].provider || routing[target].model || routing[target].reasoningEffort) continue
      routing[target] = { ...route }
    }
  }
  return routing
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

/** 任务类型的默认思考档：正文类强制降低，避免长思考占满输出。 */
export function roleDefaultEffort(role, available, inheritedEffort = '') {
  const policy = ROLE_DEFAULTS[role] ?? 'inherit'
  if (policy === 'inherit') return pickEffort(available, inheritedEffort)
  if (policy === 'low') return pickEffort(available, 'low')
  if (policy === 'off') return pickEffort(available, 'off')
  if (policy === 'off-low') {
    return pickEffort(available, available.includes('off') ? 'off' : 'low')
  }
  return pickEffort(available, inheritedEffort)
}

/**
 * 计算一次任务实际使用的路由。
 * @param routing 项目的 routing 段
 * @param role 任务类型
 * @param fallback 当前会话的 provider/model、可用档位与当前档位
 */
export function resolveRoute(routing, role, fallback = {}) {
  const configured = normalizeRoute(routing?.[role])
  const inherit = {
    provider: text(fallback.provider),
    model: text(fallback.model),
  }
  const available = Array.isArray(fallback.efforts) ? fallback.efforts : []
  const inheritedEffort = text(fallback.reasoningEffort)
  if (!configured.provider && !configured.model) {
    return {
      inherited: true,
      provider: inherit.provider,
      model: inherit.model,
      reasoningEffort: configured.reasoningEffort
        ? pickEffort(available, configured.reasoningEffort)
        : roleDefaultEffort(role, available, inheritedEffort),
      note: '跟随当前会话',
    }
  }
  const effort = configured.reasoningEffort
    ? pickEffort(available, configured.reasoningEffort)
    : roleDefaultEffort(role, available, inheritedEffort)
  const wanted = configured.reasoningEffort || '任务默认'
  return {
    inherited: false,
    provider: configured.provider || inherit.provider,
    model: configured.model || inherit.model,
    reasoningEffort: effort,
    note: effort === configured.reasoningEffort ? '' : `思考档 ${wanted} 不可用，已回落为 ${effort || '默认'}`,
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
  return resolveRoute(routing, role, {
    provider,
    model,
    efforts,
    reasoningEffort: base.reasoningEffort ?? '',
  })
}

export function describeRoute(route) {
  const value = normalizeRoute(route)
  if (!value.provider && !value.model) return '跟随当前会话'
  const model = `${value.provider || '默认'}/${value.model || '默认'}`
  return value.reasoningEffort ? `${model} · ${value.reasoningEffort}` : model
}
