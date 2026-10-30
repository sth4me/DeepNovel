/**
 * 并发资源规则：Host 与 Client 共用同一份声明式规则。
 * Client 通过 project-state 拿到 LOCK_RULES 后使用同一套判断；
 * Host 始终是最终仲裁者。
 */
export const LOCK_RULES = {
  batchActions: [
    'chapter-batch',
    'import-manuscript',
    'chapter-approve-all',
    'chapter-approve-volume',
    'chapter-approve-stale',
    'clean-orphans',
    'chapters-delete-tail',
  ],
  projectActions: [],
  projectPrefixes: ['snapshot-', 'restore-'],
  exact: {
    'relations-save': 'bible',
    'character-card-import': 'bible',
    'library-character-import': 'bible',
    'style-samples-save': 'style',
    'style-import-template': 'style',
    'chapter-move': 'outline',
    'outline-audit': 'read:audit:outline',
    'summarize-missing': 'summary:batch',
    'export-file-project': 'project:export',
  },
  readGroups: [
    {
      actions: ['continuity-check', 'continuity-audit', 'continuity-mark'],
      resource: 'read:continuity',
    },
    {
      actions: ['chapter-audit', 'chapter-review'],
      resource: 'read:audit',
    },
  ],
  prefixes: [
    ['summarize-', 'summary'],
    ['volume-', 'outline'],
    ['chapter-', 'chapter'],
    ['outline-', 'outline'],
    ['bible-', 'bible'],
    ['power-', 'bible'],
    ['premise-', 'premise'],
    ['style-', 'style'],
  ],
}

const chapterNumber = (params = {}) => {
  const number = Number(params?.number ?? params?.fromChapter)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** 全项目级资源：与任何资源互斥（导入/导出/快照/恢复期间禁止其它写）。 */
export const GLOBAL_RESOURCES = new Set(['project', 'project:import', 'project:export'])

export function runResource(action, params = {}) {
  if (typeof action !== 'string') return null
  if (LOCK_RULES.batchActions.includes(action)) return 'chapter:batch'
  // delete + removeOutline 会删章纲并重排后续章号（全项目改动），按批量操作处理。
  if (action === 'chapter-delete' && params?.removeOutline === true) return 'chapter:batch'
  if (LOCK_RULES.projectActions.includes(action)) return 'project'
  if (LOCK_RULES.projectPrefixes.some((prefix) => action.startsWith(prefix))) return 'project'
  for (const group of LOCK_RULES.readGroups) {
    if (!group.actions.includes(action)) continue
    const number = chapterNumber(params)
    return number ? `${group.resource}:${number}` : group.resource
  }
  if (LOCK_RULES.exact[action]) return LOCK_RULES.exact[action]
  for (const [prefix, resource] of LOCK_RULES.prefixes) {
    if (!action.startsWith(prefix)) continue
    if (prefix === 'chapter-') {
      const number = chapterNumber(params)
      return number ? `chapter:${number}` : 'chapter'
    }
    return resource
  }
  return null
}

export function locksConflict(locks, resource) {
  if (!locks) return false
  if (locks.has(resource)) return true
  // 全项目资源（导入/导出/快照/恢复）与任何资源互斥。
  if (GLOBAL_RESOURCES.has(resource)) return locks.size > 0
  for (const key of locks.keys()) {
    if (GLOBAL_RESOURCES.has(key)) return true
  }
  if (resource === 'chapter:batch') {
    for (const key of locks.keys()) {
      if (key.startsWith('chapter:')) return true
    }
    return false
  }
  if (resource.startsWith('chapter:')) return locks.has('chapter:batch')
  return false
}
