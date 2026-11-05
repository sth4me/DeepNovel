// 助手职责边界：只提供上下文/约束/用户明确要求，不替生成模型设计剧情方案。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const agent = await readFile(new URL('../agent.js', import.meta.url), 'utf8')

assert.ok(agent.includes("name: 'deepnovel:generation-boundary'"), '应注册生成职责边界系统提示')
assert.ok(agent.includes('不要替生成模型设计剧情方案'), '边界提示应禁止助手设计剧情方案')
assert.ok(agent.includes('instruction 只写「必须遵守 / 禁止 / 用户明确指定的事实」'), 'instruction 应只承载约束')
assert.ok(agent.includes("description: 'generate 时的约束：只写必须遵守/禁止/用户明确指定的事实，不写具体剧情方案或桥段'"), '大纲 instruction 参数应说明只写约束')
assert.ok(!agent.includes('额外结构要求，如"压缩成两章"'), '移除诱导助手设计剧情的参数示例')
assert.ok(agent.includes('action=update 只用于用户明确指定的局部修改'), 'update 应限定为用户明确修改')

const chapterDesc = agent.slice(agent.indexOf("name: 'novel_chapter'"), agent.indexOf("name: 'novel_chapter'") + 1200)
assert.ok(chapterDesc.includes('正文内容由生成模型依据上下文决定'), '章节工具描述应说明内容由生成模型决定')
assert.ok(!agent.includes('action=update 首选'), '大纲工具不再把 update 作为替模型改剧情的首选')

console.log('assistant generation boundary tests passed')
