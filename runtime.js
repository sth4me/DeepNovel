let current = undefined
let novelLocks = null

export function setNovelWriter(service) {
  current = service
}

export function getNovelWriter() {
  if (!current) {
    throw new Error('novelWriter 服务尚未就绪：请确认写作插件 host 行已加载')
  }
  return current
}

/**
 * 宿主锁注册：agent 工具与 UI 动作共用同一份 activeRuns（acquire/release/listActive），
 * 让助手写操作不再绕过 host 锁，项目状态也能展示当前活动锁。
 */
export function setNovelLocks(api) {
  novelLocks = api && typeof api === 'object' ? api : null
}

export function getNovelLocks() {
  return novelLocks
}
