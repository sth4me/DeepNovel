/**
 * 同步 JSON 文档仓库：原子写、进程内缓存、深拷贝返回。
 * 旧版上层是同步调用，这里必须是同步实现，避免读写竞争。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class DocStore {
  constructor(rootDir) {
    this.rootDir = rootDir
    this.cache = new Map()
    // 事务期间的待写文档：提交时统一落盘，失败时整体丢弃。
    this.pending = null
  }

  path(relative) {
    return join(this.rootDir, relative)
  }

  read(relative, fallback = null) {
    if (this.pending?.has(relative)) return clone(this.pending.get(relative))
    if (this.cache.has(relative)) return clone(this.cache.get(relative))
    const target = this.path(relative)
    if (!existsSync(target)) {
      this.cache.set(relative, fallback)
      return clone(fallback)
    }
    try {
      const value = JSON.parse(readFileSync(target, 'utf8'))
      this.cache.set(relative, value)
      return clone(value)
    } catch {
      this.cache.set(relative, fallback)
      return clone(fallback)
    }
  }

  write(relative, value) {
    if (this.pending) {
      this.pending.set(relative, value)
      return clone(value)
    }
    this.cache.set(relative, value)
    const target = this.path(relative)
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temp, target)
    return clone(value)
  }

  remove(relative) {
    if (this.pending) {
      this.pending.set(relative, null)
      return true
    }
    this.cache.set(relative, null)
    const target = this.path(relative)
    if (!existsSync(target)) return false
    rmSync(target, { force: true })
    return true
  }

  update(relative, fallback, mutate) {
    const current = this.read(relative, fallback)
    return this.write(relative, mutate(current))
  }

  /**
   * 事务：期间的写入先记录在内存，成功后一次落盘，失败则整体丢弃。
   * 单进程内是同步调用，不存在交错写入；跨进程仍需上层串行化。
   */
  transaction(fn) {
    if (this.pending) return fn()
    this.pending = new Map()
    try {
      const result = fn()
      const writes = this.pending
      this.pending = null
      for (const [relative, value] of writes) {
        if (value === null) this.remove(relative)
        else this.write(relative, value)
      }
      return result
    } catch (error) {
      this.pending = null
      throw error
    }
  }
}
