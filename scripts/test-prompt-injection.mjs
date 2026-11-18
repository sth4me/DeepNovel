// 提示词注入纯函数测试：不依赖 DSH 运行时，可直接 node 运行。
import assert from 'node:assert/strict'
import {
  applyInjectionToSystem,
  injectionTextFor,
  normalizeInjectionConfig,
} from '../service.js'

const prose = ['draft', 'revise', 'fix']

// normalizeInjectionConfig：默认值、任务过滤、位置校正、文本归一
const empty = normalizeInjectionConfig(null)
assert.deepEqual(empty, { enabled: false, position: 'suffix', tasks: prose, text: '' })

const filtered = normalizeInjectionConfig({
  enabled: true,
  position: 'prefix',
  tasks: ['draft', 'unknown', 'draft', 'audit'],
  text: '  只写正文  ',
})
assert.equal(filtered.position, 'prefix')
assert.deepEqual(filtered.tasks, ['draft', 'audit'])
assert.equal(filtered.text, '  只写正文  ')

assert.equal(normalizeInjectionConfig({ position: 'middle' }).position, 'suffix')
assert.deepEqual(normalizeInjectionConfig({ tasks: ['draft', 'outline'] }).tasks, ['draft', 'outline'])

// injectionTextFor：启用、空白、任务匹配
const draftInjection = normalizeInjectionConfig({ enabled: true, tasks: ['draft'], text: '保持尺度' })
assert.equal(injectionTextFor(draftInjection, 'draft'), '保持尺度')
assert.equal(injectionTextFor(draftInjection, 'revise'), '')
assert.equal(injectionTextFor({ ...draftInjection, text: '   ' }, 'draft'), '')
assert.equal(injectionTextFor({ ...draftInjection, enabled: false }, 'draft'), '')
assert.equal(injectionTextFor(normalizeInjectionConfig({ enabled: true, tasks: [], text: '全部任务' }), 'audit'), '全部任务')

// applyInjectionToSystem：无注入原样返回
assert.equal(applyInjectionToSystem('base', [], 'draft'), 'base')
assert.equal(applyInjectionToSystem('base', [normalizeInjectionConfig({ enabled: false, text: 'x' })], 'draft'), 'base')

// 后缀：全局在前、项目在后
const globalCfg = normalizeInjectionConfig({ enabled: true, position: 'suffix', tasks: [], text: '全局片段' })
const projectCfg = normalizeInjectionConfig({ enabled: true, position: 'suffix', tasks: ['draft'], text: '项目片段' })
assert.equal(
  applyInjectionToSystem('base', [globalCfg, projectCfg], 'draft'),
  'base\n\n全局片段\n\n项目片段',
)
assert.equal(applyInjectionToSystem('base', [globalCfg, projectCfg], 'outline'), 'base\n\n全局片段')

// 前缀 + 后缀混合
assert.equal(
  applyInjectionToSystem('base', [
    normalizeInjectionConfig({ enabled: true, position: 'prefix', text: '前' }),
    normalizeInjectionConfig({ enabled: true, position: 'suffix', text: '后' }),
  ], 'draft'),
  '前\n\nbase\n\n后',
)

// 空 system 也可注入
assert.equal(
  applyInjectionToSystem('', [normalizeInjectionConfig({ enabled: true, position: 'suffix', text: '后' })], 'draft'),
  '后',
)

console.log('prompt injection tests passed')
