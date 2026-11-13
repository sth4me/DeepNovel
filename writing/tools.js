// 通用写作工具：项目地图、读、搜、创建对象、写提案/应用、连续性。
import { resolve } from 'node:path'
import { Project, appendText, patchText } from './project.js'
import { fileFor } from './manifest.js'
import { STAGE_GUIDES, stageGuide } from './prompts.js'
import { listReferences, readReference, searchReferences } from './references.js'
import { withProjectLock } from './locks.js'
import { ROUTE_ROLES, normalizeRouting, resolveRoute, routeIsEmpty } from './routing.js'
import { configureTaskHub, taskHub } from './taskhub.js'
import { accessForTask } from './scopes.js'
import { countText, COUNT_RULE, parseTarget, progressOf } from './textstats.js'
import { countProject } from './count.js'

function textRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const jsonOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: textRender,
}

function errorResult(tool, error) {
  return {
    ok: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    hint: '先读项目地图/相关文档；不要重复提交同一个写提案。',
  }
}

const activeRoots = new Map()
// 同一会话对同一文档连续提交相同内容的次数，用于阻止无意义的重复提案。
const unchangedProposals = new Map()

function rootKey(ctx, agent) {
  return String(agent?.id ?? ctx.sessionId ?? 'default')
}

function rememberRoot(ctx, agent, root) {
  const path = resolve(String(root))
  activeRoots.set(rootKey(ctx, agent), path)
  return path
}

async function projectRoot(ctx, agent) {
  const remembered = activeRoots.get(rootKey(ctx, agent))
  if (remembered) return remembered
  const root = await ctx.workingDirectory?.ensure?.(agent)
  if (!root) throw new Error('当前会话没有工作目录')
  return root
}

async function openProject(ctx, agent) {
  const root = await projectRoot(ctx, agent)
  return Project.open(root)
}

async function withWriteLock(ctx, agent, run) {
  const root = await projectRoot(ctx, agent)
  return withProjectLock(root, () => run(root))
}

const KINDS = ['book', 'world', 'character', 'volume', 'arc', 'chapter', 'manuscript', 'summary', 'ledger']

/** 提案正文与当前正文的净字数对比，附带章卡目标与差额。 */
async function manuscriptStats(project, chapterId, content) {
  const card = await project.store.readTextOrNull(fileFor('chapter', chapterId)) ?? ''
  const before = await project.store.readTextOrNull(fileFor('manuscript', chapterId)) ?? ''
  const beforeNet = countText(before).netChars
  const afterNet = countText(content).netChars
  const target = parseTarget(card)
  const delta = afterNet - beforeNet
  return {
    beforeNet,
    afterNet,
    delta,
    target,
    remaining: target ? Math.max(0, target.min - afterNet) : null,
    progress: target ? progressOf(afterNet, target) : null,
    ...(delta <= 0 ? { warning: '净字数没有增加：这轮扩写无效，需要真正补写内容再提交。' } : {}),
  }
}

export function registerWritingTools(ctx) {
  configureTaskHub(() => ({ agents: typeof ctx.get === 'function' ? ctx.get('agents') : undefined }))
  const register = (tool) => ctx.tools.register({
    ...tool,
    output: jsonOutput,
    async execute(args, exec) {
      try {
        return await tool.execute(args ?? {}, exec)
      } catch (error) {
        return errorResult(tool.name, error)
      }
    },
  })

  register({
    name: 'novel_project',
    description: '项目入口：action=open/status 打开项目并返回地图；action=init 初始化项目；action=set 修改标题/题材/语言。项目根可显式指定，之后本会话的工具都作用于该项目。文档是唯一事实来源；不生成内容。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'status', 'init', 'set'] },
        projectRoot: { type: 'string', description: '项目绝对路径；open/init 时传给写作台项目目录' },
        title: { type: 'string' },
        genre: { type: 'string' },
        language: { type: 'string', enum: ['zh', 'en'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      if (args.action === 'open' || (args.action === 'init' && args.projectRoot)) {
        const explicit = resolve(String(args.projectRoot ?? ''))
        if (!explicit) throw new Error('需要 projectRoot')
        const project = await Project.open(explicit).catch(() => null)
        if (project) {
          rememberRoot(ctx, exec.agent, explicit)
          return { opened: true, root: explicit, map: await project.projectMap() }
        }
        if (args.action !== 'init') throw new Error(`不是 DeepNovel 项目：${explicit}`)
        return withWriteLock(ctx, exec.agent, async () => {
          const project = await Project.init(explicit, { title: args.title, genre: args.genre, language: args.language })
          rememberRoot(ctx, exec.agent, explicit)
          return { initialized: true, root: explicit, map: await project.projectMap() }
        })
      }
      const root = await projectRoot(ctx, exec.agent)
      if (args.action === 'init') {
        return withWriteLock(ctx, exec.agent, async () => {
          const existing = await Project.open(root).catch(() => null)
          if (existing) return { initialized: false, alreadyInitialized: true, map: await existing.projectMap() }
          const project = await Project.init(root, { title: args.title, genre: args.genre, language: args.language })
          return { initialized: true, root, map: await project.projectMap() }
        })
      }
      const project = await openProject(ctx, exec.agent)
      if (args.action === 'set') {
        return withWriteLock(ctx, exec.agent, async () => {
          const current = await Project.open(root)
          return current.setMeta({ title: args.title, genre: args.genre, language: args.language })
        })
      }
      return { root, map: await project.projectMap() }
    },
  })

  register({
    name: 'novel_read',
    description: '读取项目中的一份文档：kind=book/world/character/volume/arc/chapter/manuscript/summary/ledger。返回正文和路径；只读，不生成。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['book', 'world', 'character', 'volume', 'arc', 'chapter', 'manuscript', 'summary', 'ledger'] },
        id: { type: 'string', description: '对象 id；book/ledger 可省略' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const project = await openProject(ctx, exec.agent)
      return project.read(args.kind, args.id ?? '')
    },
  })

  register({
    name: 'novel_search',
    description: '在项目文档中搜索原文；返回命中文件、对象类型和前后片段。用于写前定位，不要一次把全书读入。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的原文片段' },
        limit: { type: 'number', description: '最多命中数，默认 12，上限 30' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const project = await openProject(ctx, exec.agent)
      const query = String(args.query ?? '').trim()
      if (!query) throw new Error('query 不能为空')
      const limit = Math.max(1, Math.min(30, Number(args.limit) || 12))
      const files = (await project.store.tree()).filter((path) => /\.(md|json)$/i.test(path) && !path.startsWith('revisions/'))
      const results = []
      for (const path of files) {
        if (results.length >= limit) break
        const text = await project.store.readTextOrNull(path)
        if (!text) continue
        let index = text.indexOf(query)
        while (index >= 0 && results.length < limit) {
          results.push({
            path,
            at: index,
            context: text.slice(Math.max(0, index - 100), Math.min(text.length, index + query.length + 140)),
          })
          index = text.indexOf(query, index + query.length)
        }
      }
      return { query, total: results.length, results }
    },
  })

  register({
    name: 'novel_reference',
    description: '资料库：action=list 列出原作/前作/研究资料；action=search 在资料中检索；action=read 读取一份资料。资料是只读参考，不等于本书正典；写同人或考据时先查资料并标注来源，不要把原文大段抄进正文。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'search', 'read'] },
        query: { type: 'string', description: 'action=search 的检索词' },
        id: { type: 'string', description: 'action=read 的资料 id' },
        limit: { type: 'number', description: '检索上限，默认 12，最多 30' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const project = await openProject(ctx, exec.agent)
      if (args.action === 'list') {
        const sources = await listReferences(project)
        return {
          total: sources.length,
          sources: sources.map(({ id, title, kind, chars, tags, importedAt }) => ({ id, title, kind, chars, tags, importedAt })),
        }
      }
      if (args.action === 'search') {
        const query = String(args.query ?? '').trim()
        if (!query) throw new Error('query 不能为空')
        return searchReferences(project, query, { limit: Math.max(1, Math.min(30, Number(args.limit) || 12)) })
      }
      if (args.action === 'read') return readReference(project, String(args.id ?? ''))
      throw new Error('未知 action')
    },
  })

  register({
    name: 'novel_create',
    description: '创建对象提案：world/character/volume/arc/chapter。必须同时给出正文；返回原子创建提案（元数据+正文），用户确认后用 novel_write action=apply 应用。不要先建空对象。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['world', 'character', 'volume', 'arc', 'chapter'] },
        title: { type: 'string' },
        name: { type: 'string', description: 'character 的名称' },
        role: { type: 'string', description: 'character 的身份/功能；AI 推断，不要问用户' },
        category: { type: 'string', description: 'world 分类；AI 推断，不要问用户' },
        volumeId: { type: 'string', description: 'arc/chapter 所属卷' },
        arcId: { type: 'string', description: 'chapter 可选所属剧情点' },
        content: { type: 'string', description: '对象正文；创建提案不能为空' },
      },
      required: ['kind', 'content'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      return withWriteLock(ctx, exec.agent, async () => {
        const project = await openProject(ctx, exec.agent)
        const workflow = await project.workflow()
        const allowed = workflow.allowed[args.kind === 'arc' ? 'volume' : args.kind]
        if (!allowed) {
          const reasons = {
            world: '故事方向还没有定案：先把讨论结果写进 plot/book.md。',
            character: '故事方向还没有定案：先写 plot/book.md。',
            volume: '需要先定方向，并至少有一条设定和一个主要人物。',
            chapter: '需要先有方向和至少一卷。',
          }
          throw new Error(`${workflow.next.label}：${reasons[args.kind] ?? '当前阶段不允许创建该对象。'}`)
        }
        return project.proposeCreate({
          kind: args.kind,
          title: args.title,
          name: args.name,
          role: args.role,
          category: args.category,
          volumeId: args.volumeId,
          arcId: args.arcId,
          content: args.content,
        })
      })
    },
  })

  register({
    name: 'novel_write',
    description: '写文档/应用提案。action=list 列出待处理提案（含 id）；action=propose 用完整新正文生成提案；action=append 只提交追加的段落；action=patch 用 find/replace 改局部；三者都不写盘，内容无变化会直接报错。action=apply 需 proposalId + confirm:true，应用前校验正文未变；返回 applied:false + reason=no-change 表示没有写入任何字，需要真正修改正文再提交。novel_create 的原子创建提案也用 action=apply 应用。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'propose', 'append', 'patch', 'apply'] },
        kind: { type: 'string', enum: ['book', 'world', 'character', 'volume', 'arc', 'chapter', 'manuscript', 'summary'] },
        id: { type: 'string', description: '目标对象 id；book 可省略' },
        content: { type: 'string', description: 'propose 的完整新正文；append 时只写要追加的段落' },
        find: { type: 'string', description: 'patch 时要被替换的原文片段，必须唯一命中' },
        replace: { type: 'string', description: 'patch 替换后的文本' },
        separator: { type: 'string', description: 'append 时与原文之间的分隔符，默认两个换行' },
        proposalId: { type: 'string', description: 'apply 时由 propose 返回' },
        confirm: { type: 'boolean', description: 'apply 必须为 true' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      if (args.action === 'list') {
        const project = await openProject(ctx, exec.agent)
        const proposals = await project.listProposals()
        return { proposals, total: proposals.length }
      }
      if (args.action === 'append' || args.action === 'patch') {
        if (!args.kind || !args.id) throw new Error(`${args.action} 需要 kind 和 id`)
        const project = await openProject(ctx, exec.agent)
        const current = await project.read(args.kind, args.id)
        const finalText = args.action === 'append'
          ? appendText(current.content, args.content ?? '', args.separator ?? '\n\n')
          : patchText(current.content, args.find ?? '', args.replace ?? '')
        const result = args.action === 'append'
          ? await project.proposeAppend(args.kind, args.id, args.content ?? '', args.separator ?? '\n\n')
          : await project.proposePatch(args.kind, args.id, args.find ?? '', args.replace ?? '')
        const stats = args.kind === 'manuscript'
          ? await manuscriptStats(project, args.id, finalText)
          : null
        const key = `${exec.agent?.id ?? 'unknown'}:${args.kind}:${args.id ?? ''}`
        unchangedProposals.delete(key)
        return stats ? { ...result, stats } : result
      }
      if (args.action === 'propose') {
        if (!args.kind) throw new Error('propose 需要 kind')
        const project = await openProject(ctx, exec.agent)
        const result = await project.proposeWrite(args.kind, args.id ?? '', args.content ?? '')
        const stats = args.kind === 'manuscript' && args.id
          ? await manuscriptStats(project, args.id, args.content ?? '')
          : null
        const key = `${exec.agent?.id ?? 'unknown'}:${args.kind}:${args.id ?? ''}`
        if (result.unchanged) {
          const previous = unchangedProposals.get(key)
          const count = previous && previous.hash === result.afterHash ? previous.count + 1 : 1
          unchangedProposals.set(key, { hash: result.afterHash, count })
          const progress = stats && stats.target
            ? `当前净字数 ${stats.beforeNet}，章卡目标 ${stats.target.min}–${stats.target.max}，还差 ${stats.remaining} 字。`
            : `当前 ${result.beforeChars ?? 0} 字符。`
          const hint = count >= 2
            ? `已连续 ${count} 次提交与当前正文完全相同的文本，没有任何字被修改。停止重复提交并重新规划；${progress}`
            : `提案内容与当前正文完全相同，没有生成提案，也没有任何字被修改。${progress}先读当前正文，按场景补写新段落再提交。`
          throw new Error(hint)
        }
        unchangedProposals.delete(key)
        return stats ? { ...result, stats } : result
      }
      if (args.action === 'apply') {
        return withWriteLock(ctx, exec.agent, async () => {
          const project = await openProject(ctx, exec.agent)
          const result = await project.applyProposal(args.proposalId, { confirm: args.confirm === true })
          if (result.applied === false && result.reason === 'no-change') {
            return { ...result, ok: false }
          }
          return result
        })
      }
      throw new Error(`未知写入操作：${args.action}`)
    },
  })


  register({
    name: 'novel_style',
    description: '读取或设置文风契约。action=get 返回当前文风；action=set 合并写入字段。文风是写作要求，不是剧情内容。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'] },
        style: { type: 'object', additionalProperties: true, description: 'set 时要合并的文风字段' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const project = await openProject(ctx, exec.agent)
      if (args.action === 'get') return { style: project.manifest.style }
      if (args.action === 'set') {
        return withWriteLock(ctx, exec.agent, async () => {
          const current = await openProject(ctx, exec.agent)
          return { style: await current.setStyle(args.style ?? {}) }
        })
      }
      throw new Error(`未知文风操作：${args.action}`)
    },
  })

  register({
    name: 'novel_route',
    description: '任务模型路由：按任务类型记录执行时使用的 provider/model/思考档。action=get 读取；action=set 合并写入某个任务类型。留空表示跟随当前会话。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'] },
        role: { type: 'string', enum: ROUTE_ROLES.map((item) => item.id) },
        provider: { type: 'string' },
        model: { type: 'string' },
        reasoningEffort: { type: 'string' },
        clear: { type: 'boolean', description: 'set 时清空该任务类型的路由，恢复跟随当前会话' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const project = await openProject(ctx, exec.agent)
      if (args.action === 'get') return { routing: project.routing(), roles: ROUTE_ROLES }
      if (args.action !== 'set') throw new Error(`未知路由操作：${args.action}`)
      if (!ROUTE_ROLES.some((item) => item.id === args.role)) throw new Error(`未知任务类型：${args.role}`)
      return withWriteLock(ctx, exec.agent, async () => {
        const current = await openProject(ctx, exec.agent)
        const routes = current.routing()
        const next = args.clear
          ? { ...routes, [args.role]: { provider: '', model: '', reasoningEffort: '' } }
          : {
            ...routes,
            [args.role]: {
              provider: args.provider ?? routes[args.role].provider,
              model: args.model ?? routes[args.role].model,
              reasoningEffort: args.reasoningEffort ?? routes[args.role].reasoningEffort,
            },
          }
        const routing = await current.setRouting(next)
        return { routing, applied: Object.fromEntries(ROUTE_ROLES.map((item) => [item.id, !routeIsEmpty(routing[item.id])])) }
      })
    },
  })

  register({
    name: 'novel_count',
    description: `统计字数。scope=chapter/volume/project 统计正文（也可用 kind=chapter/summary 看章卡或摘要），scope=text 统计给定文本。口径：${COUNT_RULE} 另附字符总数、去空白字符数、行数、段落数和引号数，便于和外部脚本核对。`,
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['chapter', 'volume', 'project', 'text'] },
        kind: { type: 'string', enum: ['manuscript', 'chapter', 'summary'] },
        chapterId: { type: 'string' },
        volumeId: { type: 'string' },
        text: { type: 'string', description: 'scope=text 时统计这段文本，不再读项目文件' },
      },
      required: ['scope'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      if (args.scope === 'text') return countText(args.text ?? '')
      const project = await openProject(ctx, exec.agent)
      return countProject(project, {
        scope: args.scope,
        kind: args.kind ?? 'manuscript',
        chapterId: args.chapterId ?? '',
        volumeId: args.volumeId ?? '',
      })
    },
  })

  register({
    name: 'novel_task',
    description: '把写作任务交给后台队列：子代理执行，按文件作用域排队，不冲突的并行、冲突的排队。action=list 查看队列；action=run 提交任务；action=cancel 停止任务。对话里让我改正文、补设定时用它，避免和正在跑的任务抢同一个文件。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'run', 'cancel'] },
        taskId: { type: 'string' },
        title: { type: 'string', description: '任务标题，用于展示和去重' },
        prompt: { type: 'string', description: '交给子代理的完整任务说明' },
        role: { type: 'string', enum: ['plan', 'prose'] },
        chapterId: { type: 'string', description: '写正文时目标章节 id' },
        write: { type: 'array', items: { type: 'string' }, description: '该任务会写的文件或目录前缀；不填按标题推断，未知任务按整项目写处理' },
        read: { type: 'array', items: { type: 'string' }, description: '该任务会读的文件或目录前缀' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const root = await projectRoot(ctx, exec.agent)
      const hub = taskHub().queue
      if (args.action === 'list') return { tasks: hub.snapshot(root) }
      if (args.action === 'cancel') {
        if (!args.taskId) throw new Error('cancel 需要 taskId')
        return hub.cancel(root, String(args.taskId))
      }
      if (args.action !== 'run') throw new Error(`未知任务操作：${args.action}`)
      if (!args.prompt || !String(args.prompt).trim()) throw new Error('run 需要任务说明')
      const project = await Project.open(root)
      const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
      const base = exec.agent?.model?.current?.() ?? null
      let efforts = []
      if (llm && base?.provider && base?.model) {
        try {
          const info = await llm.resolveModelInfo(base.provider, base.model)
          efforts = (info.reasoning?.efforts ?? []).map((effort) => String(effort.id))
        } catch {
          efforts = []
        }
      }
      const role = args.role === 'prose' ? 'prose' : 'plan'
      const route = resolveRoute(project.routing(), role, {
        provider: base?.provider ?? '',
        model: base?.model ?? '',
        efforts,
      })
      const access = accessForTask({
        title: args.title ?? '',
        chapterId: args.chapterId ?? '',
        access: Array.isArray(args.write) || Array.isArray(args.read) || args.writeAll
          ? { write: args.write ?? [], read: args.read ?? [], writeAll: args.writeAll === true }
          : undefined,
      })
      return hub.enqueue(root, {
        title: args.title ?? String(args.prompt).slice(0, 40),
        role,
        prompt: String(args.prompt),
        parentSessionId: String(exec.agent?.id ?? ''),
        route,
        access,
        root,
      })
    },
  })

  register({
    name: 'novel_stage',
    description: '查看当前阶段、阶段提示和下一步建议。阶段由项目实际文档推导，不是硬流程；讨论和跨阶段读取不受限制。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, exec) {
      const project = await openProject(ctx, exec.agent)
      const map = await project.projectMap()
      return {
        stage: map.stage,
        guide: stageGuide(map.stage),
        next: nextSuggestion(map.stage),
        map,
      }
    },
  })

  register({
    name: 'novel_continuity',
    description: '连续性账本：action=get 读取；action=commit 提交本章摘要、交接、事实、知识、伏笔、时间线。只记录正文确实发生的内容，不生成剧情。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'commit'] },
        chapterId: { type: 'string' },
        summary: { type: 'string' },
        handoff: { type: 'string' },
        facts: { type: 'array', items: { type: 'object', additionalProperties: true } },
        knowledge: { type: 'array', items: { type: 'object', additionalProperties: true } },
        foreshadow: { type: 'array', items: { type: 'object', additionalProperties: true } },
        timeline: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const project = await openProject(ctx, exec.agent)
      if (args.action === 'get') return project.readLedger()
      return withWriteLock(ctx, exec.agent, async () => project.commitChapter(args))
    },
  })

  return {
    tools: ['novel_project', 'novel_read', 'novel_search', 'novel_create', 'novel_write', 'novel_style', 'novel_stage', 'novel_continuity', 'novel_route', 'novel_task', 'novel_count'],
    stages: Object.keys(STAGE_GUIDES),
  }
}

function nextSuggestion(stage) {
  switch (stage) {
    case 'setup': return '和用户确认方向；先建最小世界观/人物/卷。'
    case 'world': return '补会影响人物选择的规则、势力、地点。'
    case 'character': return '补主要人物的欲望、恐惧、缺陷、关系。'
    case 'plot': return '建卷、剧情点、章卡；再写正文。'
    case 'manuscript': return '按章卡写下一章正文；写完提交连续性。'
    case 'continuity': return '补章节摘要/交接；准备下一章或检查连续性。'
    default: return '讨论修改、润色或导出。'
  }
}
