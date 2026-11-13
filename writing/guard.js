// 阻止写作 Agent 用原生写文件/命令行绕过写提案直接改项目文档。
// 只拦截「项目文档路径上的写操作」；读取和非项目文件不受影响。

const FILE_WRITE_TOOLS = new Set([
  'write', 'edit', 'apply_patch', 'str_replace', 'create_file', 'multi_edit', 'notebook_edit',
])

const SHELL_TOOLS = new Set(['bash', 'pwsh', 'powershell', 'shell', 'run_code', 'terminal_send'])

const DOC_PATH = /(^|[^A-Za-z0-9_.-])(manuscript|plot|world|characters|continuity|revisions|references|deepnovel\.json)([^A-Za-z0-9_.-]|$)/i

const SHELL_WRITE = /(>>|>|\bSet-Content\b|\bOut-File\b|\bAdd-Content\b|\bsed\s+-i|\btee\b|\bRemove-Item\b|\bdel\s|\bmv\s|\bcp\s|\bmove\b|\bNew-Item\b|\btruncate\b|writeFile|writeFileSync|open\s*\(|fs\.write|shutil\.|os\.remove|os\.rename)/i

const REASON = [
  '项目文档不允许用原生写文件/命令行直接修改。',
  '请改用 novel_write：扩写用 action=append（只提交新增段落），局部修改用 action=patch（find/replace），整章重写才用 action=propose。',
  '提案会让用户在写作台确认后再写盘；直接改文件会绕过审批并破坏修订与提案记录。',
].join('')

function stringsIn(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item) => stringsIn(item, depth + 1))
  if (typeof value === 'object') return Object.values(value).flatMap((item) => stringsIn(item, depth + 1))
  return []
}

/** 一次工具调用是否在写项目文档；返回阻止原因或 undefined。 */
export function directWriteGuard(execution) {
  const name = String(execution?.name ?? '')
  const args = execution?.arguments ?? {}
  if (FILE_WRITE_TOOLS.has(name)) {
    const hit = stringsIn(args).find((text) => DOC_PATH.test(text))
    if (hit) return REASON
    return undefined
  }
  if (SHELL_TOOLS.has(name)) {
    const command = String(args?.command ?? args?.cmd ?? args?.script ?? args?.input ?? '')
    if (!command || !DOC_PATH.test(command)) return undefined
    const readOnly = /^\s*(Get-Content|cat|type|head|tail|wc|grep|rg|Select-String|findstr|ls|dir)\b/i.test(command)
    if (readOnly && !SHELL_WRITE.test(command)) return undefined
    return REASON
  }
  return undefined
}

export function installDirectWriteGuard(ctx) {
  const tools = ctx?.tools ?? (typeof ctx?.get === 'function' ? ctx.get('tools') : null)
  if (!tools?.guard) return undefined
  return tools.guard((execution) => directWriteGuard(execution))
}
