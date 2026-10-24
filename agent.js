import { getNovelWriter } from './runtime.js'

export const inject = ['tools', 'systemPrompt']

function textRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const jsonOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: textRender,
}

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

  ctx.tools.register({
    name: 'novel_status',
    description: '读取当前小说项目的初始化状态与各阶段产物状态（premise、style、outline、章节数）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: jsonOutput,
    async execute(_args, exec) {
      return getNovelWriter().projectStatus(exec.agent)
    },
  })

  ctx.tools.register({
    name: 'novel_init',
    description:
      '初始化当前工作目录为小说写作项目：创建 story/ 目录骨架与 project.json 标识。已初始化时只返回现状，不覆盖已有文件。',
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

  ctx.tools.register({
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

  ctx.tools.register({
    name: 'novel_style',
    description:
      '文风工具。action=templates 列出内置与自定义模板；action=apply 套用模板（可覆盖字段）；action=save 保存当前字段为自定义模板；action=commit 确认文风契约；action=status 读取当前契约。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['templates', 'apply', 'save', 'commit', 'status'] },
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
      return service.applyStyleTemplate(exec.agent, {
        templateId: args?.templateId,
        fields: args?.fields,
      })
    },
  })

  ctx.tools.register({
    name: 'novel_outline',
    description:
      '章纲工具。action=generate 按已确认构思生成指定范围的章纲；action=regenerate 重新生成指定范围（可带指令）；action=commit 确认章纲；action=status 读取章纲与状态。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['generate', 'regenerate', 'commit', 'status'] },
        fromChapter: { type: 'number', description: '起始章号' },
        toChapter: { type: 'number', description: '结束章号' },
        count: { type: 'number', description: '生成章数（未指定 toChapter 时使用，1~12）' },
        instruction: { type: 'string', description: '额外结构要求，如"压缩成两章""反派提前登场"' },
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
      return service.outlineGenerate(
        exec.agent,
        {
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

  ctx.tools.register({
    name: 'novel_bible',
    description:
      '设定工具。action=list 读取角色/地点/规则/势力/物品；generate 生成设定；update 新增或修改条目；delete 删除条目；commit 确认设定（确认后才能生成章纲/正文）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'generate', 'update', 'delete', 'commit'] },
        category: { type: 'string', enum: ['characters', 'locations', 'rules', 'factions', 'items'] },
        id: { type: 'string', description: 'update/delete 时的条目 id' },
        fields: {
          type: 'object',
          additionalProperties: true,
          description: '条目字段：name/role/description',
        },
        instruction: { type: 'string', description: 'generate 时的额外要求' },
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
      throw new Error(`未知设定操作：${args?.action}`)
    },
  })

  ctx.tools.register({
    name: 'novel_chapter',
    description:
      '章节工具。action=list 列出章节与状态；read 读取某章正文与 QA；draft 生成草稿；qa 运行规则质检；revise 按意见修订；save 手动保存整章正文；approve 采纳为定稿。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'draft', 'batch', 'qa', 'audit', 'style-audit', 'fix', 'autofix', 'revise', 'save', 'approve'] },
        rounds: { type: 'number', description: 'fix/autofix 的修复轮数，1–3，默认 1/2' },
        count: { type: 'number', description: 'batch 时连续生成的章数，1–5' },
        number: { type: 'number', description: '章节号' },
        instruction: { type: 'string', description: '草稿/修订的额外要求' },
        text: { type: 'string', description: 'save 时的完整正文' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonOutput,
    async execute(args, exec) {
      const service = getNovelWriter()
      if (args?.action === 'list') return service.chaptersSummary(exec.agent)
      if (args?.action === 'read') return service.chapterDetail(exec.agent, args?.number)
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
      if (args?.action === 'approve') return service.approveChapter(exec.agent, { number: args?.number })
      throw new Error(`未知章节操作：${args?.action}`)
    },
  })

  ctx.tools.register({
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
