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
  projectActions: ['discussion-undo', 'discussion-applies-clear'],
  projectPrefixes: ['snapshot-', 'restore-'],
  exact: {
    'relations-save': 'bible',
    'character-card-import': 'bible',
    'style-samples-save': 'style',
    'style-import-template': 'style',
    'chapter-move': 'outline',
    'outline-audit': 'read:audit:outline',
    'summarize-missing': 'summary:batch',
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

export function runResource(action, params = {}) {
  if (typeof action !== 'string') return null
  if (LOCK_RULES.batchActions.includes(action)) return 'chapter:batch'
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
  if (resource === 'chapter:batch') {
    for (const key of locks.keys()) {
      if (key.startsWith('chapter:')) return true
    }
    return false
  }
  if (resource.startsWith('chapter:')) return locks.has('chapter:batch')
  return false
}
