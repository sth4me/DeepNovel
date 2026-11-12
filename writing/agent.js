// 新写作 Agent：通用文档工具 + 主创提示词；不注册 UI 路由。
import { LEAD_SYSTEM_PROMPT } from './prompts.js'
import { registerWritingTools } from './tools.js'

export const name = '@sth4me/deepnovel/agent'

export const inject = ['tools', 'workingDirectory']

function optionalService(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) ?? null : null
  } catch {
    return null
  }
}

export function apply(ctx) {
  registerWritingTools(ctx)
  const systemPrompt = optionalService(ctx, 'systemPrompt')
  if (systemPrompt?.section) {
    systemPrompt.section({
      name: 'deepnovel:lead-author',
      order: 10000,
      text: () => LEAD_SYSTEM_PROMPT,
    })
  }
}
