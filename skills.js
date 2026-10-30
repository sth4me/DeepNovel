/**
 * 内置技法技能（craft-*）与导入技能（.dsh/skills 等目录）的统一入口。
 *
 * 设计：
 * - 内置技法 = 随插件提供的技能（craft.js 的 CRAFT_CARDS），不能删除、只能按项目开关（craftDisabled）；
 * - 导入技能 = 文件系统 skills 根里的 SKILL.md（与 DSH skill-filesystem 同一格式），可删除；
 * - 内置 provider 注册在宿主层，rank 600；导入技能 rank 100–500，同名时导入覆盖内置（按 DSH rank 规则）。
 */
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { CRAFT_CARDS } from './craft.js'

export const CRAFT_SKILL_PREFIX = 'craft-'
export const CRAFT_SKILL_RANK = 600
export const CRAFT_SKILL_PROVIDER = 'deepnovel-craft'

/** 读取后判断适配性的提示（内置技能正文前置）。 */
export const CRAFT_SKILL_ADAPT_HINT = '（读完后判断：是否适合本章的题材/文风/节奏/文风契约；不适合就不要套用。）'
export const GLOBAL_SKILL_RANK = 300

/** DeepNovel 全局技能库（插件级，跨项目）：DSH_HOME/novel-writer/library/skills。 */
export function resolveDshHome() {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

export function globalSkillRoot(dshHome = resolveDshHome()) {
  return join(dshHome, 'novel-writer', 'library', 'skills')
}

/** 写作助手可用技能根：项目两处（100/200）+ 全局（300）；不含 DSH 公共/用户级根。 */
export function allSkillRoots(projectRoot, dshHome = resolveDshHome()) {
  return [
    ...projectSkillRoots(projectRoot),
    { source: 'global', rank: GLOBAL_SKILL_RANK, path: globalSkillRoot(dshHome), scope: 'global' },
  ]
}


/** 判断 cwd 是否是已初始化的写作项目（story/project.db 或 story/project.json 存在）。 */
export async function isNovelProjectCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false
  for (const relative of ['story/project.db', 'story/project.json']) {
    try {
      await stat(join(cwd, relative))
      return true
    } catch {
      // 继续尝试下一个标记文件
    }
  }
  return false
}

export const craftSkillName = (cardId) => `${CRAFT_SKILL_PREFIX}${cardId}`

export function craftCardIdFromSkill(name) {
  const text = String(name ?? '').trim()
  return text.startsWith(CRAFT_SKILL_PREFIX) ? text.slice(CRAFT_SKILL_PREFIX.length) : null
}

/** 内置技法技能正文（provider get 与 skill-read 共用）。 */
export function craftSkillBody(card) {
  return `${CRAFT_SKILL_ADAPT_HINT}\n\n${String(card?.body ?? '')}`
}

/**
 * 写作助手技能 provider（注册在宿主层）：只提供「内置 craft-* + 项目导入技能」。
 * - 仅写作项目（story/project.db 或 project.json 存在）才返回技能；
 * - 内置 craft-* rank 600（按项目 craftDisabled 过滤）；
 * - 项目导入技能只扫 <projectRoot>/.dsh/skills（rank 100）与 <projectRoot>/.agents/skills（rank 200）；
 * - 不扫 user-dsh / user-agents / bundled / custom 根；同名导入 rank 小者胜、覆盖内置。
 */
export function createCraftSkillProvider(service, options = {}) {
  const providerName = options.providerName ?? CRAFT_SKILL_PROVIDER
  return {
    name: providerName,
    async list(lookup = {}) {
      const rawCwd = lookup?.cwd
      const cwd = typeof rawCwd === 'string'
        ? rawCwd
        : (typeof rawCwd?.path === 'string' ? rawCwd.path : typeof rawCwd?.displayPath === 'string' ? rawCwd.displayPath : null)
      // 作用域收敛：只有写作项目才暴露技能，避免非写作会话的技能目录被污染。
      if (!(await isNovelProjectCwd(cwd))) return []
      const disabled = typeof service?.readCraftDisabledByCwd === 'function'
        ? await service.readCraftDisabledByCwd(cwd).catch(() => [])
        : []
      const candidates = CRAFT_CARDS
        .filter((card) => !disabled.includes(card.id))
        .map((card) => ({
          name: craftSkillName(card.id),
          description: `${card.summary}${Array.isArray(card.tags) && card.tags.length ? `（${card.tags.join('/')}）` : ''}`,
          invocation: { modelInvocable: true, userInvocable: true },
          rank: CRAFT_SKILL_RANK,
          source: 'builtin',
          provider: providerName,
          metadata: { tags: card.tags ?? [], tasks: card.tasks ?? [], source: 'builtin', craftId: card.id },
        }))
      const imported = await scanImportedSkills(allSkillRoots(cwd))
      for (const skill of imported) {
        candidates.push({
          name: skill.name,
          description: skill.description,
          invocation: skill.invocation,
          rank: skill.rank,
          source: 'imported',
          provider: providerName,
          scope: skill.scope,
          metadata: { source: 'imported', scope: skill.scope, path: skill.filePath },
          locator: { path: skill.filePath, directory: skill.directory },
        })
      }
      return candidates
    },
    async get(candidate) {
      const locatorPath = candidate?.locator?.path
      if (locatorPath) {
        const text = await readFile(locatorPath, 'utf8').catch(() => null)
        if (!text) return undefined
        const parsed = parseSkillFrontmatter(text)
        if (!parsed) return undefined
        return {
          name: parsed.name,
          description: parsed.description,
          invocation: candidate.invocation ?? invocationFromFrontmatter(parsed.data),
          source: 'imported',
          provider: providerName,
          content: parsed.content,
          metadata: { source: 'imported', scope: candidate?.scope ?? candidate?.metadata?.scope ?? 'project', path: locatorPath },
        }
      }
      const id = craftCardIdFromSkill(candidate?.name ?? '')
      const card = CRAFT_CARDS.find((item) => item.id === id)
      if (!card) return undefined
      return {
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation ?? { modelInvocable: true, userInvocable: true },
        source: 'builtin',
        provider: providerName,
        content: craftSkillBody(card),
        metadata: { tags: card.tags ?? [], tasks: card.tasks ?? [], source: 'builtin', craftId: card.id },
      }
    },
  }
}

/** 项目技能根（助手只允许项目级导入技能）。 */
export function projectSkillRoots(projectRoot) {
  if (!projectRoot) return []
  return [
    { source: 'project-dsh', rank: 100, path: join(projectRoot, '.dsh', 'skills'), scope: 'project' },
    { source: 'project-agents', rank: 200, path: join(projectRoot, '.agents', 'skills'), scope: 'project' },
  ]
}

/** 技能根目录（保留兼容：含用户级根；助手 provider/管理列表只用 projectSkillRoots）。 */
export function skillRoots(projectRoot, dshHome) {
  const roots = projectSkillRoots(projectRoot)
  if (dshHome) roots.push({ source: 'user-dsh', rank: 400, path: join(dshHome, 'skills') })
  return roots
}

/** 解析 SKILL.md 的 YAML frontmatter（只取 name/description 等标量字段）。 */
export function parseSkillFrontmatter(text) {
  const source = String(text ?? '')
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!pair) continue
    let value = pair[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    data[pair[1]] = value
  }
  if (!data.name || !data.description) return null
  return {
    name: String(data.name).trim(),
    description: String(data.description).trim(),
    content: match[2].trim(),
    data,
  }
}

/**
 * 把 frontmatter 的 disable-model-invocation / user-invocable 解析成宿主需要的 invocation 策略。
 * 宿主的 skills/list 会直接读 skill.invocation.modelInvocable，缺省会在会话启动时抛
 * "Cannot read properties of undefined (reading 'modelInvocable')"。
 * 缺省语义与 dsh-skill-filesystem 一致：不带字段即两个入口都允许。
 */
export function invocationFromFrontmatter(data = {}) {
  const asBoolean = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback
    const text = String(value).trim().toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(text)) return true
    if (['false', 'no', 'off', '0'].includes(text)) return false
    return fallback
  }
  return {
    modelInvocable: !asBoolean(data['disable-model-invocation'], false),
    userInvocable: asBoolean(data['user-invocable'], true),
  }
}

/** 扫描导入技能（目录包 <name>/SKILL.md 或扁平 <name>.md）；同名取 rank 最小。 */
export async function scanImportedSkills(roots = []) {
  const byName = new Map()
  for (const root of roots) {
    let entries = []
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      let filePath = null
      let directory = null
      if (entry.isDirectory()) {
        filePath = join(root.path, entry.name, 'SKILL.md')
        directory = join(root.path, entry.name)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        filePath = join(root.path, entry.name)
        directory = root.path
      } else {
        continue
      }
      const text = await readFile(filePath, 'utf8').catch(() => null)
      if (!text) continue
      const parsed = parseSkillFrontmatter(text)
      if (!parsed) continue
      const skill = {
        name: parsed.name,
        description: parsed.description,
        invocation: invocationFromFrontmatter(parsed.data),
        content: parsed.content,
        source: 'imported',
        scope: root.scope ?? 'project',
        rootSource: root.source,
        rank: root.rank,
        root: root.path,
        filePath,
        directory,
      }
      const existing = byName.get(skill.name)
      if (!existing || skill.rank < existing.rank) byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}

/** 删除导入技能：只删技能根目录内的 SKILL.md 或目录包；越界路径拒绝。 */
export async function deleteImportedSkill({ roots = [], name, scope }) {
  const skillName = String(name ?? '').trim()
  if (!skillName) throw new Error('请指定要删除的技能 name')
  const wantedScope = scope === 'global' || scope === 'project' ? scope : null
  const scopedRoots = wantedScope ? roots.filter((root) => (root.scope ?? 'project') === wantedScope) : roots
  const skills = await scanImportedSkills(scopedRoots)
  const target = skills.find((skill) => skill.name === skillName)
  if (!target) throw new Error(`导入技能不存在：${skillName}`)
  const rootPaths = roots.map((root) => resolve(root.path))
  const inside = (candidate) => rootPaths.some((root) => candidate === root || candidate.startsWith(root + sep))
  const filePath = resolve(target.filePath)
  if (!inside(filePath)) throw new Error('拒绝删除：技能路径不在技能根目录内')
  if (target.filePath.endsWith(`${sep}SKILL.md`)) {
    const directory = resolve(target.directory)
    if (!inside(directory) || directory === filePath) throw new Error('拒绝删除：技能目录不在技能根目录内')
    await rm(directory, { recursive: true, force: true })
  } else {
    await unlink(filePath)
  }
  return { name: skillName, deleted: true, path: target.filePath }
}

/**
 * 导入技能到项目：<projectRoot>/.dsh/skills/。
 * - 目录包：复制 SKILL.md 与 references/ 到 .dsh/skills/<name>/；
 * - 扁平文件：复制为 .dsh/skills/<name>.md；
 * - 同名已存在：先备份到 .dsh-writing/backups/skills-<stamp>/ 再覆盖；
 * - 路径安全：目标固定在项目技能目录内，name 只允许 [a-z0-9-]{1,64}。
 */
export async function importSkill({ projectRoot, sourcePath, scope = 'project', dshHome = resolveDshHome() }) {
  const targetScope = scope === 'global' ? 'global' : 'project'
  const root = resolve(String(projectRoot ?? ''))
  if (targetScope === 'project' && !projectRoot) throw new Error('请指定项目目录')
  const rawSource = String(sourcePath ?? '').trim()
  if (!rawSource) throw new Error('请指定要导入的技能路径（SKILL.md 所在目录或 .md 文件）')
  const source = resolve(rawSource)
  const info = await stat(source).catch(() => null)
  if (!info) throw new Error(`找不到技能路径：${rawSource}`)
  let sourceFile = null
  let sourceDirectory = null
  if (info.isDirectory()) {
    sourceFile = join(source, 'SKILL.md')
    sourceDirectory = source
  } else if (info.isFile() && source.endsWith('.md')) {
    sourceFile = source
  } else {
    throw new Error('技能路径必须是目录（含 SKILL.md）或 .md 文件')
  }
  const text = await readFile(sourceFile, 'utf8').catch(() => null)
  if (!text) throw new Error('读取技能失败：目录里缺少 SKILL.md')
  const parsed = parseSkillFrontmatter(text)
  if (!parsed) throw new Error('技能 frontmatter 无效：需要 name 与 description')
  const name = String(parsed.name).trim()
  if (!/^[a-z0-9-]{1,64}$/.test(name)) {
    throw new Error('技能 name 需为 1–64 位小写字母、数字或连字符')
  }
  const skillsDir = targetScope === 'global' ? globalSkillRoot(dshHome) : join(root, '.dsh', 'skills')
  const skillsDirResolved = resolve(skillsDir)
  const targetDirectory = join(skillsDir, name)
  const targetFlat = join(skillsDir, `${name}.md`)
  const targetDirResolved = resolve(targetDirectory)
  if (!(targetDirResolved === skillsDirResolved || targetDirResolved.startsWith(skillsDirResolved + sep))) {
    throw new Error('拒绝导入：目标路径不在项目技能目录内')
  }
  const existing = []
  if (await stat(targetDirectory).catch(() => null)) existing.push(targetDirectory)
  if (await stat(targetFlat).catch(() => null)) existing.push(targetFlat)
  let backupPath = null
  if (existing.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backupPath = targetScope === 'global'
      ? join(dshHome, 'novel-writer', 'library', 'backups', `skills-${stamp}`)
      : join(root, '.dsh-writing', 'backups', `skills-${stamp}`)
    await mkdir(backupPath, { recursive: true })
    for (const item of existing) {
      const backupTarget = join(backupPath, basename(item))
      await cp(item, backupTarget, { recursive: true })
      await rm(item, { recursive: true, force: true })
    }
  }
  if (sourceDirectory) {
    await mkdir(targetDirectory, { recursive: true })
    await copyFile(sourceFile, join(targetDirectory, 'SKILL.md'))
    const references = join(sourceDirectory, 'references')
    if (await stat(references).catch(() => null)) {
      await cp(references, join(targetDirectory, 'references'), { recursive: true })
    }
  } else {
    await mkdir(skillsDir, { recursive: true })
    await copyFile(sourceFile, targetFlat)
  }
  const targetPath = sourceDirectory ? join(targetDirectory, 'SKILL.md') : targetFlat
  return { imported: true, name, scope: targetScope, path: targetPath, ...(backupPath ? { backupPath } : {}) }
}
