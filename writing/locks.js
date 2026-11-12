// 同一项目的写操作串行化，避免 UI 和 Agent 同时写同一份文档。
const tails = new Map()

export async function withProjectLock(key, run) {
  const previous = tails.get(key) ?? Promise.resolve()
  let release
  const current = new Promise((resolve) => { release = resolve })
  tails.set(key, current)
  await previous
  try {
    return await run()
  } finally {
    release()
    if (tails.get(key) === current) tails.delete(key)
  }
}
