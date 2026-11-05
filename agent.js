import { getNovelLocks, getNovelWriter } from './runtime.js'
import { CRAFT_AGENT_HINT } from './templates.js'

export const inject = ['tools', 'systemPrompt']

function textRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const jsonOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: textRender,
}

/** 工具报错时给助手的下一步建议（不裸抛异常，避免助手中断/卡死）。 */
function hintsForTool(name, message) {
  const text = String(message ?? '')
  if (/尚未初始化|novel_init/i.test(text)) return '先调用 novel_init 初始化项目（会创建 story/ 与 story/project.db）。'
  if (/找不到第 .* 章|章纲/.test(text)) return '先用 novel_chapter action=list 确认章号，或用 novel_outline action=status 看大纲。'
  if (/还没有草稿|还没有定稿|没有正文/.test(text)) {
    return '先用 novel_chapter action=read 看现状；没有草稿可用 action=draft 生成，已有正文可用 action=patch 小步修改。'
  }
  if (/没找到要替换的片段/.test(text)) return '先用 novel_chapter action=read 确认原文，再提供更准确的 find 片段。'
  if (/片段出现 \d+ 次/.test(text)) return '用 all=true 替换全部，或提供更长的上下文让 find 唯一。'
  if (name === 'novel_chapter') return '先 novel_chapter action=list 看章节状态；改小段正文用 action=patch，整章保存用 action=save。'
  if (name === 'novel_outline' || name === 'novel_bible' || name === 'novel_style' || name === 'novel_premise') {
    return '结构化数据在项目数据库里，用对应 novel_* 工具修改，不要用 fs 改 story/*.json 或数据库文件。'
  }
  if (name === 'novel_query') return '检查 kind/number 参数；章节状态可用 novel_chapter action=list。'
  if (name === 'novel_init') return '确认当前工作目录有写权限后再试。'
  return '工具错误是信息不是终点：先读错误原因，再换一条路径（读现状/小步修改），不要重复同一调用。'
}

/** 工具 action → host 锁 action 映射（只读动作返回 null，不占锁）。 */
function lockActionFor(toolName, args = {}) {
  if (toolName === 'novel_chapter') {
    const map = {
      draft: 'chapter-draft',
      revise: 'chapter-revise',
      save: 'chapter-save',
      patch: 'chapter-patch',
      approve: 'chapter-approve',
      delete: 'chapter-delete',
      'delete-tail': 'chapters-delete-tail',
      batch: 'chapter-batch',
      qa: 'chapter-review',
      audit: 'chapter-audit',
      'style-audit': 'chapter-audit',
      fix: 'chapter-fix',
      autofix: 'chapter-autofix',
    }
    return map[args?.action] ?? null
  }
  if (toolName === 'novel_outline') return args?.action ? `outline-${args.action}` : null
  if (toolName === 'novel_bible') {
    if (args?.action === 'relations-save') return 'relations-save'
    if (args?.action === 'power-save') return 'power-save'
    return args?.action ? `bible-${args.action}` : null
  }
  if (toolName === 'novel_style') return args?.action ? `style-${args.action}` : null
  if (toolName === 'novel_premise') return args?.action ? `premise-${args.action}` : null

  if (toolName === 'novel_repair') {
    if (args?.action === 'prescribe') return null
    return 'chapter-repair'
  }
  if (toolName === 'novel_state') {
    if (!args?.action || args.action === 'get') return null
    return 'chapter-state-update'
  }
  if (toolName === 'novel_cast') {
    if (!args?.action || args.action === 'list') return null
    return 'outline-cast'
  }
  if (toolName === 'novel_facts') {
    if (!args?.action || args.action === 'list') return null
    return `fact-${args.action}`
  }
  return null
}

const agentLockOwner = (exec) => {
  const agent = exec?.agent
  const id = typeof agent === 'string' ? agent : agent?.id
  return `agent:${id ?? 'unknown'}`
}

/** 统一包装工具执行：错误 → 结构化结果 + hint；写动作先 acquire host 锁，结束 release。 */
const registerTool = (ctx, tool) => ctx.tools.register({
  ...tool,
  async execute(args, exec) {
    let handle = null
    let locks = null
    try {
      const lockAction = lockActionFor(tool.name, args)
      locks = getNovelLocks()
      let projectRoot = null
      try {
        projectRoot = await ctx.workingDirectory?.ensure?.(exec.agent) ?? null
      } catch {
        projectRoot = null
      }
      if (lockAction && locks?.acquire) {
        handle = locks.acquire(agentLockOwner(exec), lockAction, args ?? {}, projectRoot)
        if (handle?.busy) {
          return {
            ok: false,
            tool: tool.name,
            error: `资源忙：${handle.resource} 正在执行`,
            hint: '稍后重试；不要重复调用同一动作。',
          }
        }
      }
      // 用户点「取消」时中止的是锁自带的 controller；必须与 DSH 的 exec.signal 合并，
      // 否则服务端收不到停止信号，只能等任务自然结束。
      const signals = [exec?.signal, handle?.controller?.signal].filter(Boolean)
      const signal = signals.length > 1 && typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0]
      return await tool.execute(args, signal ? { ...exec, signal } : exec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, tool: tool.name, error: message, hint: hintsForTool(tool.name, message) }
    } finally {
      if (handle && locks?.release) {
        try {
          locks.release(agentLockOwner(exec), handle)
        } catch {
          // 释放失败不影响工具结果
        }
      }
    }
  },
})

export function apply(ctx) {
  /*
   * 全局级提示词注入：注册在 novel-writer 预设的作用域里，只影响该预设创建的会话。
   * 段文本是函数，每次系统提示词组装时实时读取 ~/.dsh/novel-writer/prompt-injection.json，
   * 所以在写作台保存后立即生效，无需重装插件或重建会话。
   * 顺序 10150：排在 Web 表层（10100）之后、部署 persona 后缀（10200）之前。
   */
  ctx.systemPrompt.section({
    name: 'deepnovel:global-prompt-injection',
    order: 10150,
    text: () => {
      try {
        return getNovelWriter().globalInjectionText()
      } catch {
        return ''
      }
    },
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:character-state',
    order: 10121,
    text: () =>
      '状态驱动写作：写下一章前先用 novel_state action=get 查上一章人物状态（处境/欲望/恐惧/知情/关系/物品/伤势/未解冲突/接续点），据此推进；章节写完后用 action=update 更新状态。状态只记录正文实际发生的事，未出场角色保持原状态；不要用状态去改正文。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:interaction-rhythm',
    order: 10090,
    text: () =>
      '交互节奏（一次一步，硬规则）：每轮只做用户明确要求的那一步，完成后停下汇报结果并给出下一步选项；不要自动进入下一阶段（构思→设定→大纲→正文→审校→修订→定稿）。只有用户明确要求“连续做完/批量”，或工具链式必须（如先读再改）时才继续。任何确认/commit（构思、文风、设定、章纲、定稿）完成后必须停，不得顺手生成下一步。工具内部的自动联动（如 draft 自动更新人物状态、audit 自动清理过期项）不要重复调用或再汇报成新动作。不确定用户是否要继续时先问，不要替用户决定。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:writing-doctrine',
    order: 10120,
    text: () =>
      '写作基础原则：本轮用户要求优先；系统注入的上下文是方法与长期约束、不是事实；技能是方法不是设定；素材是参考不是设定；发现冲突先指出再最小改动，不静默推翻。故事走向由角色性格与当前局势驱动，不写死结构。角色是世界池：本卷可具名角色 = 核心阵容（≤6）+ 具名龙套（≤3）；龙套不得承担关键转折；名单外路人一律身份指代；不新增未登记的命名角色（每卷新增 ≤2 且必须登记）；未登场角色不出现。写大纲或正文前先确认本卷阵容（novel_cast action=list/plan/update），不要临时加未登记角色。负向约束：不为凑爽点硬造冲突，不重复同一目标/场景两次以上，不偏离类型调性，不靠巧合/降智，不把结构问题当文字修，只写正式内容。新卷流程：先 novel_outline action=volume-plan 确认本卷目标 → novel_cast action=plan 确认阵容（与上一卷有差异、优先引入未使用角色池的新面孔）→ 再生成章纲；目标达成时用 novel_outline action=volume-end 标记收束，不要无限续写。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:data-maintenance',
    order: 10140,
    text: () =>
      '写作台数据维护：遇到章节挂错卷、章号重复或缺口、章节目录与大纲不一致时，先自查（novel_outline action=status、novel_chapter action=list），再直接修复：卷归属用 novel_outline action=move；删正文用 novel_chapter action=delete；删除中间章纲并让后续章号前移用 novel_chapter action=delete removeOutline=true（默认重排）。不要要求用户提供章号或指挥用户操作。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:craft-agent-hint',
    order: 10145,
    text: () => CRAFT_AGENT_HINT,
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:data-query',
    order: 10148,
    text: () =>
      '项目数据都存在项目的 SQLite 数据库里。核对/诊断用 novel_query（只读）：kind 可选 chapter/outline/bible/state/summary/stats/runs/relations/power/inspirations/deconstructions/prompt-overrides/premise-chat，支持 keyword/limit，拆书记录默认只回摘要+计数（entryId 取单条全文）；outline 默认只回卷列表，expand=chapters 才展开。读正文用 novel_chapter action=read 的 range/maxChars 分块、列章节用 action=list 的 limit/offset、patch 前先用 action=search 定位精确片段。人物关系与力量体系也可用 novel_bible action=relations/power 读写。不要直接修改数据库文件或旧 JSON 存档。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:data-layer-rules',
    order: 10149,
    text: () =>
      '项目结构化数据在 SQLite 数据库里，旧 story/*.json 只是只读存档。改大纲/设定/文风/构思/章纲分别用 novel_outline / novel_bible / novel_style / novel_premise；核对数据用 novel_query。不要用 fs 改 JSON 或数据库文件。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:interruption-recovery',
    order: 10151,
    text: () =>
      '如果模型输出被服务端中断（内容审查/超时）或工具报错：不要整章重新生成，也不要重复同一调用。改用小步推进：novel_chapter action=read 读现状 → action=patch 逐段替换正文（每次只改一小段）→ 需要时再 audit/approve。工具错误是信息不是终点，先读错误原因再换路径。若同一任务连续两次被服务端中断，明确告诉用户「当前模型的输出被服务端拦截，建议换用不审查的模型或把改动拆得更小」，不要反复重试同一段生成。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:style-profile',
    order: 10156,
    text: () =>
      '文风偏差只诊断、不自动改；风格指纹是参考，文风契约优先。偏差大时建议用 novel_chapter action=revise 带上具体指标要求（如“句长压到 15 字以内”），不要整章重写；需要指纹用 novel_style action=profile-build（只统计不改文）。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:outline-repair-guard',
    order: 10157,
    text: () =>
      '大纲审核后最多修 1–2 轮；repair 返回 applied=false（候选未应用）或 exhausted 时停止，让用户选择 apply-revision / discard-revision / 按 diff 用 update 改，不要反复调用 outline repair。大纲局部问题优先用 novel_outline action=update 改 1–3 章（标题/梗概/change/storyQuestion/promise/beats），不要动辄 generate/regenerate；只有连续 ≥3 章的结构问题、整卷崩坏或用户明确要求时才用 generate/regenerate，先说明影响范围，必要时先问用户。audit 返回问题后不要自动 repair/regenerate，先把问题按范围列给用户，并给 1–3 个可选处理（update 指定章 / 重规划某范围 / 忽略）。结构问题（角色超载/桥段重复/主角被动/承诺未推进/调性漂移）优先 update 或重规划建议，不要 repair。update 修改章节后旧问题已自动清掉（resolvedIssues），不要立刻再 audit；不打算修的问题用 novel_outline action=dismiss 按 ids/chapter 忽略，之后重审不会复活；audit 只按用户要求跑一次，不要自动连环重审。进入新卷前先调用 novel_outline action=volume-plan 给 2–3 个候选卷目标（基于上一卷末人物状态与未解冲突），让用户选定（volume-select）后再 generate；不要直接生成新卷章纲、也不要静默替用户决定目标。时间线冲突用 action=update 改 time 或 synopsis，不要写日期代号，也不要在正文/回复里展示 time；目标已达成时用 novel_outline action=volume-end 收束本章，不要继续原地续写；下一卷先 volume-plan 目标、再 cast-plan 阵容（引入新面孔）。repair 返回后先看 applied：true 表示已自动应用（列出修复的章节与问题数 X→Y）；false 表示只生成候选版本、当前大纲未被覆盖，需说明候选 versionId、问题 X→Y、新增 N 条，让用户选择 apply-revision / discard-revision / 按 diff 用 update 改，不要立刻重复 repair；问题汇报：每次 novel_outline / novel_diagnose / novel_repair / novel_chapter 返回后，如果结果含 issues/structureIssues/replan/warning，先在回复开头用 1–3 行摘要列出（章节号 · 类型 · 建议动作），再继续；需要完整清单调用 novel_issues（只提示，不自动处理结构问题）。'
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:story-audit',
    order: 10155,
    text: () =>
      '故事问题只诊断不硬改：novel_diagnose 会给出变化/读者问题/承诺/因果/刻意感判定，其中 story 问题都是软提示。需要调整时优先改章纲（change/storyQuestion/promise），不要为凑冲突或钩子硬改正文；安静章节允许通过，只要本章有成立的不可逆变化。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:repair-loop',
    order: 10154,
    text: () =>
      '写完或改完章节后的默认流程：先 novel_diagnose 检查逻辑/连续性/事实/文风；有 hard issues（逻辑、连续性 error、事实/术语）就调 novel_repair action=auto 自动修最小 diff，soft issues（文风/AI 味）只在回复里提示（AI 味可建议 deslop），不要为满分反复修。逻辑/设定冲突优先；repair 会复检，未降低 hard 问题会自动回滚。深度档用 novel_repair action=prescribe 只拿处方、不自动改。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:constraint-priority',
    order: 10153,
    text: () =>
      '约束优先级（高→低）：本轮对话/用户显式要求（explicit）> 硬事实/术语/安全 > 项目设定 > 本章章纲 > 文风契约 > 写作要求/备注。冲突时按此优先级执行并在回复里说明，不要自行折中；若冲突是「设定/章纲不一致」，生成照做但提醒用户同步更新设定。写正文前先调 novel_constraints 检查（带 number 与 instruction）；涉及新固定事实（人名/地名/称呼/时间/伤势/持有物）先用 novel_facts 保存。',
  })

  ctx.systemPrompt.section({
    name: 'deepnovel:craft-routing',
    order: 10152,
    text: () =>
      '技能目录里有内置技法（craft-*，随插件提供、只能开关）与导入技能（.dsh/skills 等目录，可删除）。需要时用 skill 工具按需加载全文，读后判断是否适合本章（题材、文风契约、节奏、当前指令）；不适合就不要套用，并在回复里简要说明。技法不是本书设定，也不是硬性规则。novel_craft 仍可用（list/read/recommend）作为兼容入口。',
  })

  registerTool(ctx, {
    name: 'novel_status',
    description: '读取当前小说项目的初始化状态与各阶段产物状态（premise、style、outline、章节数）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: jsonOutput,
    async execute(_args, exec) {
      return getNovelWriter().projectStatus(exec.agent)
    },
  })

  registerTool(ctx, {
    name: 'novel_init',
    description:
      '初始化当前工作目录为小说写作项目：创建 story/ 目录骨架与项目数据库（story/project.db）。已初始化时只返回现状，不覆盖已有数据。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '项目标题，默认取目录名' },
        language: { type: 'string', description: '语言，默认 zh' },
      },
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      return getNovelWriter().initProject(exec.agent, { title: args?.title, language: args?.language })
    },
  })

  registerTool(ctx, {
    name: 'novel_premise',
    description:
      '构思工具。action=candidates 生成 3~5 个题材候选（差异明显，含 logline/卖点/主角/冲突/结局/篇幅/风险）；action=commit 确认某个候选；action=status 读取当前构思状态。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['candidates', 'commit', 'status'] },
        count: { type: 'number', description: '候选数量，1~5，默认 3' },
        candidateId: { type: 'string', description: 'commit 时的候选 id' },
        genre: { type: 'array', items: { type: 'string' }, description: '题材方向' },
        audience: { type: 'string', description: '目标读者' },
        instruction: { type: 'string', description: '额外要求/限制' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'commit') {
        return service.commitPremise(exec.agent, { candidateId: args.candidateId })
      }
      if (args?.action === 'status') {
        return service.readJson(exec.agent, 'story/premise.json')
      }
      return service.premiseCandidates(
        exec.agent,
        {
          count: args?.count,
          genre: args?.genre,
          audience: args?.audience,
          instruction: args?.instruction,
        },
        exec.signal,
      )
    },
  })

  registerTool(ctx, {
    name: 'novel_style',
    description:
      '文风工具。action=templates 列出内置与自定义模板；action=apply 套用模板（可覆盖字段）；action=save 保存当前字段为自定义模板；action=commit 确认文风契约；action=status 读取当前契约；action=profile-build 从最近定稿统计风格指纹（句长/短句/对话/段落/密度/高频词，只统计不改文）；action=profile-get 读取已存指纹。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['templates', 'apply', 'save', 'commit', 'status', 'profile-build', 'profile-get'] },
        templateId: { type: 'string', description: 'apply 时的模板 id' },
        name: { type: 'string', description: 'save 时的模板名称' },
        fields: { type: 'object', additionalProperties: true, description: '覆盖的契约字段' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'templates') return service.styleTemplateList(exec.agent)
      if (args?.action === 'save') {
        return service.saveStyleTemplate(exec.agent, { name: args?.name, fields: args?.fields })
      }
      if (args?.action === 'commit') {
        return service.commitStyle(exec.agent, { fields: args?.fields })
      }
      if (args?.action === 'status') {
        return service.readJson(exec.agent, 'story/style/contract.json')
      }
      if (args?.action === 'profile-build') return service.buildStyleProfile(exec.agent, { count: args?.count })
      if (args?.action === 'profile-get') return { profile: await service.getStyleProfile(exec.agent) }
      return service.applyStyleTemplate(exec.agent, {
        templateId: args?.templateId,
        fields: args?.fields,
      })
    },
  })

  registerTool(ctx, {
    name: 'novel_outline',
    description:
      '章纲工具。action=update 首选：改指定 1–3 章的标题/梗概/change/storyQuestion/promise/beats，只动局部；action=volume-plan 进入新卷前先给 2–3 个候选卷目标（基于上一卷末人物状态/未解冲突推导，不写盘）；action=volume-select 选定候选或修订卷目标（写盘，记录 whyNow/修订时间）；action=volume-end 标记卷收束章（volumeEnd 全卷唯一，缺省卷末章；用于目标达成后收束，不要无限续写）；action=revisions/revision 列出/查看大纲修复版本（含 diff 与前后 audit）；action=apply-revision/discard-revision 应用或丢弃候选版本；action=generate 按已确认构思生成指定范围的章纲（成规模或用户明确要求才用）；action=regenerate 重新生成指定范围（仅当连续 ≥3 章崩坏/整卷崩/用户明确要求）；action=commit 确认章纲；action=status 读取章纲与状态；action=move 把某章章纲移到指定卷；action=audit 审核章纲；action=repair 修复一致性问题（最多 1 轮；生成候选版本，仅「问题数下降且无新增问题」时自动应用，否则保留候选供 apply-revision/discard-revision）。结构问题不要 repair：优先用 action=update 改局部，成规模才 generate/regenerate 并说明影响范围。时间线冲突用 action=update 改 time 或 synopsis，不要写日期代号，也不要在回复/正文里展示 time 字段。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['update', 'generate', 'regenerate', 'commit', 'status', 'move', 'audit', 'repair', 'dismiss', 'volume-plan', 'volume-select', 'volume-end', 'revisions', 'revision', 'apply-revision', 'discard-revision'] },
        fromChapter: { type: 'number', description: '起始章号' },
        toChapter: { type: 'number', description: '结束章号' },
        count: { type: 'number', description: '生成章数（未指定 toChapter 时使用，1~12）' },
        number: { type: 'number', description: 'move 时要移动的章号' },
        volumeId: { type: 'string', description: 'move/volume-end 时的目标卷 id（缺省为最新卷）' },
        chapterNumber: { type: 'number', description: 'volume-end 时标记哪一章为收束章（缺省为卷末章）' },
        revisionId: { type: 'string', description: 'revision/apply-revision/discard-revision 时的大纲修复版本 id（来自 repair 返回的 versionId 或 revisions 列表）' },
        instruction: { type: 'string', description: '额外结构要求，如"压缩成两章""反派提前登场"' },
        index: { type: 'number', description: 'volume-select 时选第几个候选（从 0 开始，默认 0）' },
        overrides: { type: 'object', description: 'volume-select 时修订卷目标字段：goal/exitCriteria/whyNow/map/title/targetChapters/powerCeiling' },
        candidates: { type: 'array', description: 'volume-select 时可传入 volume-plan 返回的 candidates（省略则重新规划）', items: { type: 'object' } },
        chapterId: { type: 'string', description: 'update 时的章纲 id（与 number 二选一）' },
        ids: { type: 'array', items: { type: 'string' }, description: 'dismiss 时要忽略的问题 id 列表（来自 novel_issues 的 actions.dismiss.params.ids）' },
        chapter: { type: 'number', description: 'dismiss 时按章号忽略该章全部问题' },
        all: { type: 'boolean', description: 'dismiss 时忽略全部大纲问题' },
        fields: {
          type: 'object',
          description: 'update 时要改的字段（至少一项）：title/synopsis/change/storyQuestion/promise/beats/wordBudget/time（时间锚点，只存章纲不写进 synopsis）',
          properties: {
            title: { type: 'string' },
            synopsis: { type: 'string' },
            change: { type: 'string' },
            storyQuestion: { type: 'string' },
            promise: { type: 'string' },
            beats: { type: 'array', items: { type: 'object' } },
            wordBudget: { type: 'number' },
            time: {
              type: 'object',
              description: '时间锚点：{day（相对本卷开场 0 起）, part（晨/日/暮/夜）, spanDays（0–30）, mode（linear|flashback|parallel）}；只存章纲，不写进 synopsis',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'commit') {
        return service.outlineCommit(exec.agent, {
          fromChapter: args?.fromChapter,
          toChapter: args?.toChapter,
        })
      }
      if (args?.action === 'status') {
        return service.readJson(exec.agent, 'story/plot/outline.json')
      }
                        if (args?.action === 'revisions') {
        return service.listOutlineRevisions(exec.agent, {})
      }
      if (args?.action === 'revision' || args?.action === 'apply-revision' || args?.action === 'discard-revision') {
        if (!String(args?.revisionId ?? '').trim()) {
          throw new Error(`${args.action} 需要 revisionId（来自 repair 返回的 versionId 或 revisions 列表）`)
        }
        if (args.action === 'revision') return service.getOutlineRevision(exec.agent, { id: args.revisionId })
        if (args.action === 'apply-revision') return service.applyOutlineRevision(exec.agent, { id: args.revisionId })
        return service.discardOutlineRevision(exec.agent, { id: args.revisionId })
      }
      if (args?.action === 'volume-end') {
        return service.markVolumeEnd(exec.agent, {
          volumeId: args?.volumeId,
          chapterNumber: args?.chapterNumber,
        })
      }
      if (args?.action === 'volume-plan') {
        return service.planVolume(exec.agent, {
          volumeId: args?.volumeId,
          instruction: args?.instruction,
        }, exec.signal)
      }
      if (args?.action === 'volume-select') {
        const hasOverride = args?.overrides && typeof args.overrides === 'object'
        if (args?.index === undefined && !hasOverride) {
          throw new Error('volume-select 需要 index（选候选）或 overrides（修订卷目标）')
        }
        return service.selectVolumePlan(exec.agent, {
          volumeId: args?.volumeId,
          index: args?.index,
          candidates: args?.candidates,
          overrides: hasOverride ? args.overrides : undefined,
        }, exec.signal)
      }
      if (args?.action === 'update') {
        const fields = args?.fields && typeof args.fields === 'object' ? args.fields : {}
        if (!args?.chapterId && args?.number === undefined) {
          throw new Error('update 需要 chapterId 或 number 定位章节')
        }
        if (Object.keys(fields).length === 0) {
          throw new Error('update 需要 fields（title/synopsis/change/storyQuestion/promise/beats/wordBudget 至少一项）')
        }
        return service.updateOutlineChapter(exec.agent, {
          chapterId: args?.chapterId,
          number: args?.number,
          fields,
        })
      }
      if (args?.action === 'dismiss') {
        const hasIds = Array.isArray(args?.ids) && args.ids.length > 0
        const hasChapter = Number.isFinite(Number(args?.chapter)) && Number(args.chapter) > 0
        if (!hasIds && !hasChapter && args?.all !== true) {
          throw new Error('dismiss 需要 ids、chapter 或 all=true 至少一种定位')
        }
        return service.dismissOutlineIssues(exec.agent, {
          ids: args?.ids,
          chapter: args?.chapter,
          all: args?.all === true,
        })
      }
      if (args?.action === 'audit') {
        return service.auditOutline(exec.agent, { fromChapter: args?.fromChapter, toChapter: args?.toChapter }, exec.signal)
      }
      if (args?.action === 'repair') {
        const audit = await service.readJson(exec.agent, 'story/plot/outline-audit.json').catch(() => null)
        const issues = Array.isArray(args?.issues) ? args.issues : (audit?.issues ?? [])
        const result = await service.repairOutlineIssues(exec.agent, { issues, instruction: args?.instruction }, exec.signal)
        return {
          repaired: result.repaired ?? [],
          issuesBefore: result.issuesBefore ?? null,
          issuesAfter: result.issuesAfter ?? null,
          rolledBack: Boolean(result.rolledBack),
          exhausted: result.exhausted ?? [],
          replan: result.replan ?? [],
          reason: result.reason ?? null,
          audit: result.audit ?? null,
          lastRepair: result.lastRepair ?? null,
        }
      }
      if (args?.action === 'move') {
        return service.moveOutlineChapter(exec.agent, {
          number: args?.number,
          volumeId: args?.volumeId,
        })
      }
      return service.outlineGenerate(
        exec.agent,
        {
          volumeId: args?.volumeId,
          fromChapter: args?.fromChapter,
          toChapter: args?.toChapter,
          count: args?.count,
          instruction: args?.instruction,
          regenerate: args?.action === 'regenerate',
        },
        exec.signal,
      )
    },
  })

  registerTool(ctx, {
    name: 'novel_issues',
    description: '列出当前待处理问题（大纲结构/一致性问题与重规划范围、章节字数不足、人物状态未更新、选角泄漏等）。返回统一 items（含章节号/类型/说明/建议动作）。只做提示，不自动修改任何内容；结构问题优先建议用 novel_outline action=update 改 1–3 章，成规模（连续 ≥3 章/整卷）才建议 generate/regenerate。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多返回多少条（默认 20）' },
      },
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      return service.issuesSummary(exec.agent, { limit: args?.limit })
    },
  })

  registerTool(ctx, {
    name: 'novel_cast',
    description: '按卷选角。角色是角色池（bible），不是演员表：本卷可具名角色 = 核心阵容（≤6，承担主线/关键转折）+ 具名龙套（≤3，可命名、需登记、不得承担关键转折）；名单外路人一律身份指代；每卷新增具名角色 ≤2 且必须登记。action=list 读某卷阵容与龙套；action=plan 让模型从角色池为本卷选角（可带 fromChapter/toChapter/instruction/allowExtras）；action=update 人工调整阵容与龙套（名称必须在角色池、不重复、超上限报错）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'plan', 'update'] },
        volumeId: { type: 'string', description: '目标卷 id（list/plan/update）' },
        fromChapter: { type: 'number', description: 'plan 的起始章号' },
        toChapter: { type: 'number', description: 'plan 的结束章号' },
        limit: { type: 'number', description: 'plan 的阵容上限（默认 6）' },
        allowNew: { type: 'number', description: 'plan 允许新增的命名角色数（默认 2）' },
        allowExtras: { type: 'number', description: 'plan 允许的具名龙套数（默认 3）' },
        instruction: { type: 'string', description: 'plan 的额外选角要求' },
        cast: {
          type: 'array',
          description: 'update 时的阵容：[{name, roleInVolume, fromChapter, importance}]',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              roleInVolume: { type: 'string' },
              fromChapter: { type: 'number' },
              importance: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'plan') {
        return service.planVolumeCast(exec.agent, {
          volumeId: args?.volumeId,
          fromChapter: args?.fromChapter,
          toChapter: args?.toChapter,
          limit: args?.limit,
          allowNew: args?.allowNew,
          allowExtras: args?.allowExtras,
          instruction: args?.instruction,
        }, exec.signal)
      }
      if (args?.action === 'update') {
        return service.updateVolumeCast(exec.agent, { volumeId: args?.volumeId, cast: args?.cast })
      }
      return service.listVolumeCast(exec.agent, { volumeId: args?.volumeId })
    },
  })

  registerTool(ctx, {
    name: 'novel_bible',
    description:
      '设定工具。action=list 读取角色/地点/规则/势力/物品；generate 生成设定；update 新增或修改条目；delete 删除条目；commit 确认设定（确认后才能生成章纲/正文）。commit 完成后必须停，等用户明确要求再生成章纲，不要自动推进。relations 读人物关系与站位；relations-save 保存关系与站位（会按角色名校验）；power 读境界/战力体系；power-save 保存力量体系。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'generate', 'update', 'delete', 'commit', 'relations', 'relations-save', 'power', 'power-save'] },
        category: { type: 'string', enum: ['characters', 'locations', 'rules', 'factions', 'items'] },
        id: { type: 'string', description: 'update/delete 时的条目 id' },
        fields: {
          type: 'object',
          additionalProperties: true,
          description: '条目字段：name/role/description',
        },
        instruction: { type: 'string', description: 'generate 时的额外要求' },
        relations: {
          type: 'array',
          description: 'relations-save 时的人物关系数组：[{ from, to, type, note }]',
          items: { type: 'object', additionalProperties: true },
        },
        positions: { type: 'object', additionalProperties: true, description: 'relations-save 时的角色站位表（可选）' },
        power: { type: 'object', additionalProperties: true, description: 'power-save 时的力量体系对象（shape 同 novel_query kind=power 的 tiers/characters 等）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'list') return service.readBible(exec.agent)
      if (args?.action === 'generate') {
        return service.generateBible(exec.agent, { instruction: args?.instruction }, exec.signal)
      }
      if (args?.action === 'update') {
        return service.upsertBibleEntry(exec.agent, {
          category: args?.category,
          id: args?.id,
          fields: args?.fields,
        })
      }
      if (args?.action === 'delete') {
        return service.deleteBibleEntry(exec.agent, { category: args?.category, id: args?.id })
      }
      if (args?.action === 'commit') return service.commitBible(exec.agent)
      if (args?.action === 'relations') return service.readRelations(exec.agent)
      if (args?.action === 'relations-save') {
        return service.saveRelations(exec.agent, { relations: args?.relations, positions: args?.positions })
      }
      if (args?.action === 'power') return service.readPower(exec.agent)
      if (args?.action === 'power-save') return service.savePower(exec.agent, { power: args?.power })
      throw new Error(`未知设定操作：${args?.action}`)
    },
  })

  registerTool(ctx, {
    name: 'novel_state',
    description: '人物状态（跨章连续性）：action=get 读某章结束时的人物状态（处境/欲望/恐惧/知情/关系/物品/伤势/未解冲突/接续点）；action=update 根据该章正文重新提取并写盘。写下一章前先 get 上一章状态，章节结束后 update；状态只记录正文实际发生的事，不要用它改正文。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'update'] },
        number: { type: 'number', description: '章节号' },
      },
      required: ['action', 'number'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'update') {
        return service.updateChapterState(exec.agent, { number: args?.number }, exec.signal)
      }
      return { state: await service.chapterState(exec.agent, args?.number) }
    },
  })

  registerTool(ctx, {
    name: 'novel_chapter',
    description:
      '章节工具。action=list 分页列出章节（默认 30 条，带 total/nextOffset）；read 分块读某章正文与元数据（默认 6000 字，带 truncated/nextRange）；search 在某章正文里定位片段（patch 前用）；draft 生成草稿；batch 连续生成；qa 规则质检；audit 审校；style-audit 风格审稿（返回 aiFlavor 等级与 AI 指纹 markers）；revision-learn 分析草稿→定稿差异、提炼写作偏好（只返回建议，不自动写入）；deslop 去 AI 味改写（只改怎么说、不改说什么；带修订备份，可 dryRun 预览；失败不落盘）；fix/autofix 修复；revise 按意见修订；save 手动保存整章正文；patch 只替换一小段正文（find/replace），不生成整章、不调用模型，适合模型输出受限/审查中断时小步修改，改完可再 audit/approve；approve 采纳为定稿；delete 删除某章正文产物（默认保留章纲，可重新生成；removeOutline=true 连章纲删除，renumber 默认把后续章号前移）；delete-tail 删除尾部连续章节（含章纲）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'search', 'draft', 'batch', 'qa', 'audit', 'style-audit', 'revision-learn', 'deslop', 'fix', 'autofix', 'revise', 'save', 'patch', 'approve', 'delete', 'delete-tail'] },
        rounds: { type: 'number', description: 'fix/autofix 的修复轮数，1–3，默认 1/2' },
        count: { type: 'number', description: 'batch 时连续生成的章数，1–5；delete-tail 时删除的尾部章数' },
        number: { type: 'number', description: '章节号（read/search/patch 等需要）' },
        instruction: { type: 'string', description: '草稿/修订的额外要求' },
        text: { type: 'string', description: 'save 时的完整正文' },
        limit: { type: 'number', description: 'list 时每页条数（默认 30，上限 200）；search 时命中数上限（默认 5）' },
        offset: { type: 'number', description: 'list 翻页偏移（配合 nextOffset）' },
        volumeId: { type: 'string', description: 'list 时按卷过滤' },
        status: { type: 'string', description: 'list 时按状态过滤（如 approved/drafted/manual/planned）' },
        maxChars: { type: 'number', description: 'read 时每段正文最大字符数（默认 6000）' },
        range: {
          type: 'object',
          description: 'read 时按字符区间读取：{ start, end }，优先于 maxChars',
          properties: { start: { type: 'number' }, end: { type: 'number' } },
        },
        part: { type: 'string', enum: ['draft', 'final', 'both'], description: 'read 时读哪部分，默认 both' },
        query: { type: 'string', description: 'search 要找的原文片段' },
        dryRun: { type: 'boolean', description: 'delete/delete-tail 时只预览要删除的内容，不落盘' },
        removeOutline: { type: 'boolean', description: 'delete 时连该章章纲一起删除（中间章删除用）' },
        renumber: { type: 'boolean', description: 'delete + removeOutline 时是否把后续章号前移并重命名目录，默认 true' },
        target: { type: 'string', enum: ['draft', 'final', 'both'], description: 'patch 时改哪个文件（draft|final，默认 draft）；search 时搜哪个文件（默认 both）；deslop 时改哪个（默认 final 存在则 final，否则 draft）' },
        find: { type: 'string', description: 'patch 时要替换的原文片段（需唯一，或配合 all）' },
        replace: { type: 'string', description: 'patch 时替换成的新片段' },
        all: { type: 'boolean', description: 'patch 时替换全部出现（默认 false，只允许唯一匹配）' },
        note: { type: 'string', description: 'patch 时写进 run 记录的备注' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'list') {
        return service.listChaptersPage(exec.agent, {
          limit: args?.limit,
          offset: args?.offset,
          volumeId: args?.volumeId,
          status: args?.status,
        })
      }
      if (args?.action === 'read') {
        return service.readChapterParts(exec.agent, {
          number: args?.number,
          maxChars: args?.maxChars,
          range: args?.range,
          part: args?.part,
        })
      }
      if (args?.action === 'search') {
        return service.searchChapterText(exec.agent, {
          number: args?.number,
          query: args?.query,
          limit: args?.limit,
          target: args?.target,
        })
      }
      if (args?.action === 'deslop') {
        return service.deslopChapter(exec.agent, {
          number: args?.number,
          target: args?.target === 'final' ? 'final' : args?.target === 'draft' ? 'draft' : undefined,
          instruction: args?.instruction,
          dryRun: args?.dryRun === true,
        }, exec.signal)
      }
      if (args?.action === 'draft') {
        return service.draftChapter(
          exec.agent,
          { number: args?.number, instruction: args?.instruction },
          exec.signal,
        )
      }
      if (args?.action === 'qa') return service.qaChapter(exec.agent, { number: args?.number })
      if (args?.action === 'audit') {
        return service.auditChapter(exec.agent, { number: args?.number }, exec.signal)
      }
      if (args?.action === 'batch') {
        return service.batchWrite(
          exec.agent,
          { count: args?.count, fromChapter: args?.number },
          exec.signal,
        )
      }
      if (args?.action === 'style-audit') {
        return service.styleAudit(exec.agent, { number: args?.number }, exec.signal)
      }
      if (args?.action === 'revision-learn') {
        return service.revisionLearn(exec.agent, { number: args?.number, count: args?.count }, exec.signal)
      }
      if (args?.action === 'fix') {
        return service.fixByQa(
          exec.agent,
          { number: args?.number, instruction: args?.instruction, rounds: args?.rounds },
          exec.signal,
        )
      }
      if (args?.action === 'autofix') {
        return service.autoFixChapter(
          exec.agent,
          { number: args?.number, rounds: args?.rounds, instruction: args?.instruction },
          exec.signal,
        )
      }
      if (args?.action === 'revise') {
        return service.reviseChapter(
          exec.agent,
          { number: args?.number, instruction: args?.instruction },
          exec.signal,
        )
      }
      if (args?.action === 'save') {
        return service.saveChapterText(exec.agent, { number: args?.number, text: args?.text })
      }
      if (args?.action === 'patch') {
        return service.patchChapterText(exec.agent, {
          number: args?.number,
          target: args?.target === 'final' ? 'final' : 'draft',
          find: args?.find,
          replace: args?.replace,
          all: args?.all === true,
          note: args?.note,
        })
      }
      if (args?.action === 'approve') return service.approveChapter(exec.agent, { number: args?.number })
      if (args?.action === 'delete') {
        return service.deleteChapter(exec.agent, {
          number: args?.number,
          dryRun: args?.dryRun === true,
          removeOutline: args?.removeOutline === true,
          renumber: args?.renumber !== false,
        })
      }
      if (args?.action === 'delete-tail') {
        return service.deleteTailChapters(exec.agent, {
          count: args?.count,
          dryRun: args?.dryRun === true,
        })
      }
      throw new Error(`未知章节操作：${args?.action}`)
    },
  })

  registerTool(ctx, {
    name: 'novel_facts',
    description: '项目事实/术语库（硬事实、术语、称呼、安全底线）。写正文或改设定前先查；发现新的固定设定（人名/地名/专有名词/称呼/伤势/持有物/时间）及时保存，避免跨章不一致。must=true 表示生成时必须遵守。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'save', 'delete'] },
        id: { type: 'string', description: 'delete 时的事实 id；save 带 id 则更新' },
        chapter: { type: 'number', description: '仅本章生效的事实的章号；省略为全局事实' },
        kind: { type: 'string', enum: ['术语', '硬事实', '安全', '称呼'], description: 'save 时的事实类型' },
        key: { type: 'string', description: 'save 时的事实名（术语为规范写法）' },
        value: { type: 'string', description: 'save 时的事实内容（术语为别名/写法说明）' },
        must: { type: 'boolean', description: 'save 时是否必须遵守（默认 true）' },
        note: { type: 'string', description: 'save 时的补充说明（可写禁止值/关键值）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'delete') return service.deleteFact(exec.agent, { id: args.id })
      if (args?.action === 'save') {
        const fact = await service.saveFact(exec.agent, {
          id: args.id,
          chapter: args.chapter,
          kind: args.kind,
          key: args.key,
          value: args.value,
          must: args.must,
          note: args.note,
        })
        return { fact }
      }
      const { facts } = await service.listFacts(exec.agent)
      const limit = 50
      return {
        total: facts.length,
        limit,
        truncated: facts.length > limit,
        facts: facts.slice(0, limit).map((fact) => ({
          id: fact.id,
          chapter: fact.chapter,
          kind: fact.kind,
          key: String(fact.key ?? '').slice(0, 200),
          value: String(fact.value ?? '').slice(0, 200),
          must: fact.must,
          note: fact.note ? String(fact.note).slice(0, 200) : null,
        })),
      }
    },
  })

  registerTool(ctx, {
    name: 'novel_constraints',
    description: '写/改某章前检查约束冲突（只读，不生成正文）。返回硬约束清单（≤12）、冲突（含裁决与理由）、需要同步设定的 warning。存在 autoResolved=false 的设定冲突时，应先提示用户/同步更新设定，再生成。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['check'] },
        number: { type: 'number', description: '章节号' },
        instruction: { type: 'string', description: '本轮显式要求/指令（explicit 层，优先级最高）' },
      },
      required: ['action', 'number'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      const { number, summary } = await service.constraintsForChapter(exec.agent, {
        number: args.number,
        instruction: args.instruction,
      })
      const unresolved = summary.conflicts.some((item) => item.autoResolved === false)
      return {
        number,
        hardRules: summary.hardRules,
        conflicts: summary.conflicts.slice(0, 10),
        warnings: summary.warnings,
        hint: unresolved ? '存在需要同步的设定/章纲冲突：先提示用户或更新设定/伏笔台账，再生成。' : null,
      }
    },
  })

  registerTool(ctx, {
    name: 'novel_diagnose',
    description: '诊断某章正文：检查事实/术语违规、逻辑问题（因果/时间/空间/信息差/动机/能力/设定）、连续性（error 硬、warn 软）、文风与 AI 味（软）。只读，不修改正文。返回 issues（hard 全量、soft 最多 10）与 scores。写完/改完章节后先调用。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: '章节号' },
      },
      required: ['number'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const result = await getNovelWriter().diagnoseChapter(exec.agent, { number: args?.number })
      return {
        number: result.number,
        scores: result.scores,
        stats: result.stats,
        story: result.story ?? null,
        suggestedAction: result.suggestedAction ?? null,
        issues: [
          ...result.issues.filter((issue) => issue.level === 'hard'),
          ...result.issues.filter((issue) => issue.level === 'soft').slice(0, 10),
        ],
      }
    },
  })

  registerTool(ctx, {
    name: 'novel_repair',
    description: '定向修复章节：action=auto 自动修 hard 问题（逻辑/连续性 error/事实/术语），只做最小 diff、复检、未降低则回滚，soft 只提示；action=prescribe 只返回处方不修改。不改剧情/人物关系/结局。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['auto', 'prescribe'] },
        number: { type: 'number', description: '章节号' },
        issueIds: { type: 'array', items: { type: 'string' }, description: '只修指定 issue id（可选）' },
        maxRounds: { type: 'number', description: '自动修复轮数，1–2，默认 2' },
      },
      required: ['action', 'number'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      return getNovelWriter().repairChapter(exec.agent, {
        number: args?.number,
        mode: args?.action === 'prescribe' ? 'prescribe' : 'auto',
        issueIds: args?.issueIds,
        maxRounds: args?.maxRounds,
      })
    },
  })

  registerTool(ctx, {
    name: 'novel_craft',
    description:
      '写作技法库（兼容入口，优先用 skill 工具按需加载内置/导入技能）。action=list 列出全部内置技法卡片（不含正文）；action=read 按 id 读取一张卡片全文（读完判断是否适合本章：题材/文风/节奏/契约，不适合就不要套用）；action=recommend 按 task（draft/revise/fix/outline）与 instruction 推荐 1–2 张内置卡片。技法卡片是可选参考、通用写作方法，不是本书设定，也不是硬性规则。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'recommend'] },
        id: { type: 'string', description: 'read 时的卡片 id' },
        task: { type: 'string', description: 'recommend 时的任务类型：draft/revise/fix/outline' },
        instruction: { type: 'string', description: 'recommend 时的本章要求/指令，用于匹配技法关键词' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'read') {
        const card = await service.readCraftCard(exec.agent, { id: args.id })
        return {
          ...card,
          hint: '读完后判断：是否适合本章的题材/文风/节奏/契约；不适合就不要套用，必要时说明原因。',
        }
      }
      if (args?.action === 'recommend') {
        return service.selectCraftCards(exec.agent, { task: args.task, instruction: args.instruction })
      }
      return service.listCraftCards(exec.agent)
    },
  })

  registerTool(ctx, {
    name: 'novel_query',
    description:
      '只读查询项目数据库（绝不会修改任何内容）。kind：chapter（带 number 查单章状态；不带 number 时列章节，limit 默认 30）、outline（默认只回卷列表+每卷章数，expand=chapters 才展开，默认 20 条）、bible、state、summary、stats、runs、relations（人物关系）、power（境界/战力/章节变化）、inspirations（灵感，默认 10 条）、materials（素材库：参考片段/资料/桥段/引用，keyword 匹配标题/内容/标签，limit 默认 20，content 截断 400）、deconstructions（拆书记录，默认只回摘要+字段计数；用 entryId 或 number 看单条全文）、prompt-overrides（提示词覆盖，只回预览）、premise-chat（构思对话与批次）。可用 keyword 过滤、limit 限制条数；大纲展开可配 volumeId/fromNumber/toNumber。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['chapter', 'outline', 'bible', 'state', 'summary', 'stats', 'runs', 'relations', 'power', 'inspirations', 'materials', 'deconstructions', 'prompt-overrides', 'premise-chat'] },
        number: { type: 'number', description: '章节号（chapter/state/summary）；deconstructions 时为第 N 条记录' },
        entryId: { type: 'string', description: 'deconstructions 时按 title 或 createdAt 精确取单条全文' },
        limit: { type: 'number', description: '返回条数上限（默认 30；chapter 列表 30、outline 展开 20、inspirations 10、deconstructions 5、premise-chat 20）' },
        keyword: { type: 'string', description: '关键词过滤（标题/梗概/设定描述/摘要/关系/境界/灵感/对话）' },
        expand: { type: 'string', description: 'outline 时传 chapters 才展开章节明细' },
        volumeId: { type: 'string', description: 'outline 展开时按卷过滤' },
        fromNumber: { type: 'number', description: 'outline 展开时起始章号' },
        toNumber: { type: 'number', description: 'outline 展开时结束章号' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      return getNovelWriter().queryProjectData(exec.agent, {
        kind: args?.kind,
        number: args?.number,
        entryId: args?.entryId,
        expand: args?.expand,
        volumeId: args?.volumeId,
        fromNumber: args?.fromNumber,
        toNumber: args?.toNumber,
        limit: args?.limit,
        keyword: args?.keyword,
      })
    },
  })

  registerTool(ctx, {
    name: 'novel_ping',
    description: '写作插件 spike 的作用域工具：只应在 novel-writer 预设会话中可见。',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '回声内容' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          presetScopeProbe: { type: 'string' },
        },
        required: ['reply', 'presetScopeProbe'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: String(value?.reply ?? '') }]
      },
    },
    async execute(args) {
      return {
        reply: `pong:${args?.message ?? ''}`,
        presetScopeProbe: 'novel-writer',
      }
    },
  })
}
