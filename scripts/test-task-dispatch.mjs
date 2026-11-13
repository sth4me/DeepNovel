// 可测的任务派发：项目 Workspace、正常会话、自动发送。
import assert from 'node:assert/strict'

let plugin = null
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  Component: class Component { constructor(props) { this.props = props } },
}
globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      plugin = factory((name) => {
        if (name === 'react') return fakeReact
        throw new Error(`unexpected require: ${name}`)
      })
    },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: {},
}
globalThis.localStorage = globalThis.window.localStorage

await import('../ui/client.js')
assert.ok(plugin?.__test, 'client plugin should expose test helpers')
const { App, DiffView, DocTree, DocumentContext, FlowGuide, LedgerView, MarkdownPreview, ReferencePage, Sidebar, PageView, buildTaskPrompt, findWorkspaceForPath, normalizeWorkspacePath, sendTaskToSessionWith, dispatchTaskWith } = plugin.__test

const emptyMap = { title: '渲染测试', genre: '', notes: '', readiness: { ready: false, missing: ['题材', '写作要求/核心方向'] }, style: {}, world: [], characters: [], plot: { book: { title: '全书主线' }, volumes: [] }, continuity: { ledger: 'continuity/ledger.json' } }
assert.ok(App({}), 'App should render without crashing')
const guide = FlowGuide({ map: { workflow: { stage: 'foundation', goal: '建立最小地基', checklist: [{ key: 'world', label: '世界规则', done: false }, { key: 'character', label: '主要人物', done: true }], next: { label: '让 AI 提 1–3 条世界规则', reason: '先有规则' } } }, onAction: () => {}, style: { muted: {}, badge: {} } })
assert.ok(guide, 'FlowGuide should render stages and checklist')
assert.ok(MarkdownPreview({ text: '# 标题\n\n**粗体**和`代码`\n\n- 一条', style: { muted: {} } }), 'Markdown preview should render')
const treeMap = { world: [{ id: 'w1', title: '示例规则', category: 'rules' }], characters: [{ id: 'c1', name: '角色甲', role: '主角' }], plot: { volumes: [{ id: 'v1', title: '第一卷', arcs: [], chapters: [{ id: 'ch1', order: 1, title: '开端', hasManuscript: false }] }] } }
assert.ok(DocTree({ map: treeMap, doc: { kind: 'world', id: 'w1' }, onOpen: () => {}, style: { treeRow: {} } }), 'DocTree should render navigation')
assert.ok(Sidebar({ map: treeMap, page: 'bible', doc: null, onPage: () => {}, onOpen: () => {}, style: { sidebar: {}, treeRow: {}, groupTitle: {}, addButton: {}, badge: {} } }), 'Sidebar should render')
assert.ok(DocumentContext({ doc: { kind: 'world', id: 'w1', title: '示例' }, text: '# 标题\n\n正文', style: { badge: {}, treeRow: {} }, onJump: () => {} }), 'DocumentContext should render TOC')
assert.ok(LedgerView({ text: JSON.stringify({ facts: ['事实'], knowledge: [], foreshadow: [], timeline: [], handoffs: [] }), style: { badge: {}, muted: {}, card: {}, addButton: {} }, onTask: () => {}, allowed: () => true }), 'LedgerView should render structured ledger')
assert.ok(ReferencePage({ references: [], kind: 'all', setKind: () => {}, query: '', setQuery: () => {}, busy: false, onImport: () => {}, onOpen: () => {}, onRemove: () => {}, style: { input: {}, badge: {}, card: {}, muted: {}, addButton: {} } }), 'ReferencePage should render')
assert.ok(DiffView({ diff: { linesAdded: 1, linesRemoved: 1, changes: [{ line: 1, before: '旧', after: '新' }] }, style: { muted: {} } }), 'DiffView should render')
for (const page of ['project', 'premise', 'style', 'bible', 'outline', 'chapters']) {
  const output = PageView({ map: emptyMap, page, style: {}, onOpen: () => {}, onTask: () => {}, onSettings: () => {}, onEditBook: () => {}, onPlanBook: () => {} })
  assert.ok(output, `PageView ${page} should render`)
}

const prompt = buildTaskPrompt('开始开书', 'C:/example/book', '先给方向')
assert.ok(prompt.includes('项目目录：C:/example/book'))
assert.ok(prompt.includes('novel_project'))
assert.ok(prompt.includes('开始开书'))

assert.equal(normalizeWorkspacePath('C:\\Example\\Book\\'), 'c:/example/book')
assert.equal(findWorkspaceForPath([{ workspaceId: 'ws-1', path: 'C:\\example\\book' }], 'C:/example/book')?.workspaceId, 'ws-1')
assert.equal(findWorkspaceForPath([{ workspaceId: 'ws-2', path: 'C:/example/other' }], 'C:/example/book'), null)

const sent = []
const sessions = {
  retain(sessionId, options) {
    assert.equal(sessionId, 'session-1')
    assert.equal(options.source, 'controllerOperation')
    return {
      binding: {
        session: {
          async prompt(content, mode) {
            sent.push({ content, mode })
            return { ok: true }
          },
        },
      },
      release() {},
    }
  },
}
await sendTaskToSessionWith(sessions, 'session-1', '任务正文')
assert.equal(sent.length, 1)
assert.equal(sent[0].mode, 'queue')
assert.equal(sent[0].content[0].text, '任务正文')

const workspaceCalls = []
const sessionCalls = []
const service = {
  async connectWorkspace(workspaceId, options) {
    sessionCalls.push({ workspaceId, options })
    return 'session-1'
  },
  openSession() {},
}
const workspaces = {
  async create(input) {
    workspaceCalls.push(input)
    return { workspaceId: 'ws-created' }
  },
}
const reused = await dispatchTaskWith({
  service,
  workspaces,
  sessions,
  workspaceItems: [{ workspaceId: 'ws-1', path: 'C:/example/book' }],
  root: 'C:/example/book',
  prompt: '复用任务',
  existingSessionId: 'session-1',
})
assert.equal(reused, 'session-1')
assert.equal(sent.length, 2)
assert.equal(sent[1].content[0].text, '复用任务')

const existing = await dispatchTaskWith({
  service,
  workspaces,
  sessions,
  workspaceItems: [{ workspaceId: 'ws-1', path: 'C:/example/book' }],
  root: 'C:/example/book',
  prompt: '已有工作区任务',
})
assert.equal(existing, 'session-1')
assert.equal(workspaceCalls.length, 0)
assert.equal(sessionCalls[0].workspaceId, 'ws-1')
assert.equal(sessionCalls[0].options.agentPreset, 'novel-writer')

await dispatchTaskWith({
  service,
  workspaces,
  sessions,
  workspaceItems: [],
  root: 'C:/example/new',
  prompt: '新工作区任务',
})
assert.equal(workspaceCalls.length, 1)
assert.equal(workspaceCalls[0].path, 'C:/example/new')
assert.equal(sessionCalls[1].workspaceId, 'ws-created')

console.log('task dispatch tests passed')
