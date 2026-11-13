// 任务资源作用域：按文件集合判断任务能否并行，而不是按任务名字猜。
// 写-写、写-读（任一方向）视为冲突；互不相交即可并行。

const ROOT_ALL = '*'

function normalizeList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const path = item.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

/**
 * 归一化资源作用域。
 * read/write 支持精确文件（`manuscript/ch1.md`）和目录前缀（`plot/chapters/`、`plot/chapters/*`）。
 * `*` 表示整项目。
 */
export function normalizeAccess(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const read = normalizeList(source.read)
  const write = normalizeList(source.write)
  const readAll = Boolean(source.readAll) || read.includes(ROOT_ALL)
  const writeAll = Boolean(source.writeAll) || write.includes(ROOT_ALL)
  return {
    read: read.filter((item) => item !== ROOT_ALL),
    write: write.filter((item) => item !== ROOT_ALL),
    readAll,
    writeAll,
    run: normalizeList(source.run),
  }
}

function asPrefix(path) {
  const value = String(path ?? '').replace(/\/\*$/, '').replace(/\/+$/, '')
  return value
}

/** 一个作用域项是否覆盖另一个作用域项所指的文件。 */
export function covers(scopePath, targetPath) {
  const scope = asPrefix(scopePath)
  const target = asPrefix(targetPath)
  if (!scope) return false
  if (scope === target) return true
  return target.startsWith(`${scope}/`)
}

function intersects(left, right) {
  for (const a of left) {
    for (const b of right) {
      if (a === b || covers(a, b) || covers(b, a)) return true
    }
  }
  return false
}

/** 两个任务是否会碰到同一份文件。 */
export function conflicts(a, b) {
  const left = normalizeAccess(a)
  const right = normalizeAccess(b)
  if (left.writeAll || right.writeAll) return true
  if (left.readAll && right.write.length > 0) return true
  if (right.readAll && left.write.length > 0) return true
  if (intersects(left.write, right.write)) return true
  if (intersects(left.write, right.read)) return true
  if (intersects(right.write, left.read)) return true
  return false
}

export function describeAccess(access) {
  const value = normalizeAccess(access)
  const write = value.writeAll ? ['整个项目'] : value.write
  const read = value.readAll ? ['整个项目'] : value.read
  return {
    write,
    read,
    summary: `写 ${write.length ? write.join('、') : '无'}${read.length ? `；读 ${read.join('、')}` : ''}`,
  }
}
