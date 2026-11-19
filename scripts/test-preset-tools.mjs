// novel-writer 预设不应暴露通用文件/命令工具：项目资源增删改查走 novel_* 插件工具。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const text = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const presetStart = text.indexOf('id: novel-writer')
assert.ok(presetStart >= 0, '应存在 novel-writer 预设')
const preset = text.slice(presetStart)

for (const banned of ['dsh-tool-fs/', 'dsh-tool-fs-search', 'dsh-tool-pwsh', 'dsh-tool-bash', 'dsh-tool-jobs']) {
  assert.ok(!preset.includes(banned), `预设不应包含通用工具：${banned}`)
}
assert.ok(preset.includes('@sth4me/deepnovel/agent'), '预设应包含写作 agent（novel_* 工具）')
assert.ok(preset.includes('dsh-tool-web'), '预设保留联网检索（研究资料）')
assert.ok(preset.includes('dsh-tool-skill'), '预设保留技能按需读取')
assert.ok(preset.includes('dsh-tool-ask-user'), '预设保留提问工具')

console.log('preset tool scope tests passed')
