// AI 页「压缩上下文」入口：主路径走宿主 commands.execute('/compact')（预设 compaction 组 isolate，
// 宿主拿不到服务）；保留 compactNow 作为 fallback。覆盖返回契约、文案映射、防重复点击、run 记录。
import assert from 'node:assert/strict'

const {
  compactConversationChild,
  interpretCompactExecution,
  resetConversationCompactionGuards,
  resolveCompactionChild,
  runConversationCompact,
} = await import('../index.js')

const runCalls = []
const service = {
  writeRun: async (root, run) => {
    runCalls.push({ root, run })
  },
}
const childAgent = { id: 'child-1' }
const call = (options = {}) => compactConversationChild({
  childId: options.childId ?? 'child-1',
  childAgent: options.childAgent === undefined ? childAgent : options.childAgent,
  service: options.service ?? service,
  root: 'D:/projects/demo',
  commands: options.commands,
  agentPresets: options.agentPresets,
})

// ---------- 0) 会话未就绪 ----------
const missing = await compactConversationChild({
  childId: 'child-0', childAgent: null, service, root: 'D:/projects/demo', commands: { execute: async () => null },
})
assert.equal(missing.ok, false)
assert.match(missing.error.message, /对话会话尚未就绪/)

// ---------- 1) 主路径：commands.execute 各分支 ----------
// 1a) 该作用域没有 compact 命令（execute 返回 undefined）
const noCommand = await call({ commands: { execute: async () => undefined }, childId: 'child-a' })
assert.deepEqual(noCommand, { ok: false, error: { message: '当前预设未启用压缩' } })

// 1b) 没有可压缩历史
const noHistory = await call({
  childId: 'child-b',
  commands: { execute: async () => ({ commandId: 'cmd-1', result: { kind: 'success', text: 'No compactable history yet.' } }) },
})
assert.deepEqual(noHistory, { compacted: false, message: '没有可压缩的历史' })

// 1c) 压缩成功：解析 items/tokens
runCalls.length = 0
const compacted = await call({
  childId: 'child-c',
  commands: { execute: async () => ({ commandId: 'cmd-2', result: { kind: 'success', text: 'Compacted 12 history items (~3400 tokens).' } }) },
})
assert.deepEqual(compacted, { compacted: true, items: 12, tokens: 3400, message: '已压缩 12 条历史（约 3400 tokens）' })
assert.equal(runCalls.length, 1, '应写一条 conversation.compact run')
assert.equal(runCalls[0].run.kind, 'conversation.compact')
assert.deepEqual(JSON.parse(runCalls[0].run.output), { items: 12, tokens: 3400, compacted: true })

// 1d) 成功但文案不标准：原样返回 text
const custom = await call({
  childId: 'child-d',
  commands: { execute: async () => ({ commandId: 'cmd-3', result: { kind: 'success', text: 'Compaction complete.' } }) },
})
assert.deepEqual(custom, { compacted: true, message: 'Compaction complete.' })

// 1e) 错误文案映射（英文 → 中文）
const errorCases = [
  ['Agent is busy running.', /会话正在生成或已有压缩任务/],
  ['Another compaction is already in progress.', /会话正在生成或已有压缩任务/],
  ['Compaction cancelled.', /压缩已取消/],
  ['Conversation history changed during compaction.', /对话历史在压缩过程中变化/],
  ['Failed to generate a valid summary.', /摘要没有产生有效压缩/],
  ['Compaction did not commit cleanly.', /压缩未干净完成/],
  ['Compaction finished but the session could not be persisted.', /压缩完成但会话保存失败/],
]
for (const [text, pattern] of errorCases) {
  const result = await call({
    childId: `child-err-${text.length}`,
    commands: { execute: async () => ({ commandId: 'cmd-err', result: { kind: 'error', text } }) },
  })
  assert.equal(result.ok, false, `${text} 应返回错误`)
  assert.match(result.error.message, pattern)
}
// 未知错误文案原样返回
const unknownError = await call({
  childId: 'child-unknown',
  commands: { execute: async () => ({ commandId: 'cmd-x', result: { kind: 'error', text: 'Something odd happened.' } }) },
})
assert.deepEqual(unknownError, { ok: false, error: { message: 'Something odd happened.' } })

// 1f) execute 抛 ManualCompactionError（code）也映射
resetConversationCompactionGuards()
const thrown = await call({
  childId: 'child-thrown',
  commands: {
    execute: async () => {
      const error = new Error('raw busy')
      error.code = 'busy'
      throw error
    },
  },
})
assert.equal(thrown.ok, false)
assert.match(thrown.error.message, /会话正在生成或已有压缩任务/)
assert.equal(thrown.error.code, 'busy')

// 1g) 防重复点击：执行期间第二次请求返回「压缩进行中」
resetConversationCompactionGuards()
let release
const pending = new Promise((resolve) => { release = resolve })
const slowCommands = {
  execute: async () => {
    await pending
    return { commandId: 'cmd-slow', result: { kind: 'success', text: 'Compacted 2 history items (~10 tokens).' } }
  },
}
const first = call({ childId: 'child-slow', commands: slowCommands })
await new Promise((resolve) => setTimeout(resolve, 20))
const second = await call({ childId: 'child-slow', commands: slowCommands })
assert.equal(second.ok, false)
assert.match(second.error.message, /压缩进行中/)
release()
const firstResult = await first
assert.equal(firstResult.compacted, true)
assert.equal(firstResult.items, 2)
const afterRelease = await call({ childId: 'child-slow', commands: { execute: async () => undefined } })
assert.equal(afterRelease.ok, false, '结束后标记释放，可再次执行')

// ---------- 1h) 官方 API：agentPresets.serviceFor(childAgent, 'compaction') 优先 ----------
// 命中 preset 的 compaction → 直接结构化结果，不调用 commands
let commandExecutes = 0
const presetOk = await call({
  childId: 'child-preset-ok',
  agentPresets: {
    serviceFor: (agent, name) => (name === 'compaction' ? {
      compactNow: async () => ({ shadowedSeqs: [1, 2], shadowedTokenCount: 77, summarySeq: 3 }),
    } : undefined),
  },
  commands: {
    execute: async () => { commandExecutes += 1; return undefined },
  },
})
assert.deepEqual(presetOk, { compacted: true, items: 2, tokens: 77, message: '已压缩 2 条历史（约 77 tokens）' })
assert.equal(commandExecutes, 0, 'serviceFor 命中时不应调用 commands.execute')

// serviceFor 返回 undefined → 回退 commands
commandExecutes = 0
const presetMissingThenCommands = await call({
  childId: 'child-preset-missing',
  agentPresets: { serviceFor: () => undefined },
  commands: {
    execute: async () => {
      commandExecutes += 1
      return { commandId: 'cmd', result: { kind: 'success', text: 'No compactable history yet.' } }
    },
  },
})
assert.deepEqual(presetMissingThenCommands, { compacted: false, message: '没有可压缩的历史' })
assert.equal(commandExecutes, 1, 'serviceFor 拿不到时应回退 commands')

// serviceFor 抛错 → 回退 commands
commandExecutes = 0
const presetThrowsThenCommands = await call({
  childId: 'child-preset-throws',
  agentPresets: { serviceFor: () => { throw new Error('no such service') } },
  commands: {
    execute: async () => {
      commandExecutes += 1
      return { commandId: 'cmd', result: { kind: 'success', text: 'No compactable history yet.' } }
    },
  },
})
assert.equal(presetThrowsThenCommands.compacted, false)
assert.equal(commandExecutes, 1)

// serviceFor 返回对象但没有 compactNow → 回退 commands
commandExecutes = 0
const presetNoCompactNow = await call({
  childId: 'child-preset-no-method',
  agentPresets: { serviceFor: () => ({}) },
  commands: {
    execute: async () => {
      commandExecutes += 1
      return { commandId: 'cmd', result: { kind: 'success', text: 'Compacted 1 history items (~2 tokens).' } }
    },
  },
})
assert.equal(presetNoCompactNow.compacted, true)
assert.equal(commandExecutes, 1)

// preset compactNow 抛 ManualCompactionError → code 映射中文
const presetBusy = await call({
  childId: 'child-preset-busy',
  agentPresets: {
    serviceFor: () => ({
      compactNow: async () => {
        const error = new Error('raw busy')
        error.code = 'busy'
        throw error
      },
    }),
  },
})
assert.equal(presetBusy.ok, false)
assert.match(presetBusy.error.message, /会话正在生成或已有压缩任务/)

// 只有 serviceFor（没有 commands）也能压缩
const presetOnly = await call({
  childId: 'child-preset-only',
  agentPresets: {
    serviceFor: () => ({ compactNow: async () => null }),
  },
})
assert.deepEqual(presetOnly, { compacted: false, message: '没有可压缩的历史' })

// ---------- 2) fallback：宿主/测试环境没有 commands 服务时直接调 compactNow ----------
const childWith = (compactNow) => ({ id: 'child-fb', ctx: { get: (name) => (name === 'compaction' ? { compactNow } : undefined) } })

const fallbackNull = await call({
  childId: 'child-fb-1',
  childAgent: childWith(async () => null),
})
assert.deepEqual(fallbackNull, { compacted: false, message: '没有可压缩的历史' })

const fallbackOk = await call({
  childId: 'child-fb-2',
  childAgent: childWith(async () => ({ shadowedSeqs: [1, 2, 3], shadowedTokenCount: 1234, summarySeq: 4 })),
})
assert.deepEqual(fallbackOk, { compacted: true, items: 3, tokens: 1234, message: '已压缩 3 条历史（约 1234 tokens）' })

const fallbackError = await call({
  childId: 'child-fb-3',
  childAgent: childWith(async () => {
    const error = new Error('raw changed')
    error.code = 'changed'
    throw error
  }),
})
assert.equal(fallbackError.ok, false)
assert.match(fallbackError.error.message, /对话历史在压缩过程中变化/)

const fallbackNoService = await call({ childId: 'child-fb-4', childAgent: { ctx: {} } })
assert.deepEqual(fallbackNoService, { ok: false, error: { message: '当前预设未启用压缩' } })

// ---------- 3) 纯解析函数：未知/空结构容错 ----------
assert.deepEqual(interpretCompactExecution(undefined), { ok: false, error: { message: '当前预设未启用压缩' } })
assert.deepEqual(interpretCompactExecution({}), { ok: false, error: { message: '压缩失败' } })

// ---------- 4) run 写失败不影响结果 ----------
resetConversationCompactionGuards()
const resilient = await compactConversationChild({
  childId: 'child-broken-run',
  childAgent,
  service: { writeRun: async () => { throw new Error('store down') } },
  root: 'D:/projects/demo',
  commands: { execute: async () => ({ commandId: 'cmd-r', result: { kind: 'success', text: 'Compacted 1 history items (~5 tokens).' } }) },
})
assert.equal(resilient.compacted, true)
assert.equal(resilient.items, 1)

// ---------- 5) resolveCompactionChild：不新建子代理；agent 不在时 resume；失败给友好错误 ----------
// 5a) 没有 conversation meta：提示先发消息
const noMeta = await resolveCompactionChild({
  ctx: { agents: { get: () => undefined, resume: async () => { throw new Error('should not resume') } } },
  root: 'D:/projects/demo',
  readConversationMeta: async () => null,
  modelOptions: null,
})
assert.deepEqual(noMeta, { ok: false, error: { message: '还没有对话历史，先在 AI 页发送一条消息' } })

// 5b) agent 不在（回合已结束）→ resume 唤醒（带 setup 挂载预设）后返回 agent
const resumedAgent = { id: 'child-resumed' }
const resumeCalls = []
const mountCalls = []
const resumed = await resolveCompactionChild({
  ctx: {
    agents: {
      get: () => undefined,
      resume: async (options) => {
        resumeCalls.push(options)
        if (options.setup) await options.setup({ mock: 'agent-ctx' })
        return { agent: resumedAgent }
      },
    },
    agentPresets: {
      resolve: async (presetId) => ({ id: `resolved-${presetId}` }),
      mount: async (agentCtx, presetId) => { mountCalls.push({ agentCtx, presetId }) },
    },
  },
  root: 'D:/projects/demo',
  readConversationMeta: async () => ({ childId: 'child-resumed', parentId: 'parent-1' }),
  modelOptions: { provider: 'p', model: 'm' },
})
assert.equal(resumed.childId, 'child-resumed')
assert.equal(resumed.childAgent, resumedAgent)
assert.equal(resumeCalls.length, 1)
assert.equal(resumeCalls[0].resumeSessionId, 'child-resumed')
assert.deepEqual(resumeCalls[0].agentOptions, { provider: 'p', model: 'm' })
assert.equal(typeof resumeCalls[0].setup, 'function', 'resume 应带 setup 挂载预设')
assert.equal(mountCalls.length, 1, 'setup 应调用 presets.mount')
assert.equal(mountCalls[0].presetId, 'resolved-novel-writer')
assert.deepEqual(mountCalls[0].agentCtx, { mock: 'agent-ctx' })

// 5b2) 没有 agentPresets → resume 不带 setup（也不报错）
const resumeNoPresets = []
const noPresets = await resolveCompactionChild({
  ctx: {
    agents: {
      get: () => undefined,
      resume: async (options) => { resumeNoPresets.push(options); return { agent: resumedAgent } },
    },
  },
  root: 'D:/projects/demo',
  readConversationMeta: async () => ({ childId: 'child-no-presets' }),
  modelOptions: null,
})
assert.equal(noPresets.childAgent, resumedAgent)
assert.equal(resumeNoPresets[0].setup, undefined, '无 agentPresets 时不应传 setup')

// 5b3) presets.resolve 抛错 → resume 不带 setup
const resumeResolveThrows = []
const resolveThrows = await resolveCompactionChild({
  ctx: {
    agents: {
      get: () => undefined,
      resume: async (options) => { resumeResolveThrows.push(options); return { agent: resumedAgent } },
    },
    agentPresets: {
      resolve: async () => { throw new Error('preset missing') },
      mount: async () => {},
    },
  },
  root: 'D:/projects/demo',
  readConversationMeta: async () => ({ childId: 'child-resolve-throws' }),
  modelOptions: null,
})
assert.equal(resolveThrows.childAgent, resumedAgent)
assert.equal(resumeResolveThrows[0].setup, undefined)

// 5c) agent 在（回合进行中）→ 不 resume
let resumedDuring = 0
const liveAgent = { id: 'child-live' }
const live = await resolveCompactionChild({
  ctx: {
    agents: {
      get: () => liveAgent,
      resume: async () => { resumedDuring += 1; return { agent: liveAgent } },
    },
  },
  root: 'D:/projects/demo',
  readConversationMeta: async () => ({ childId: 'child-live' }),
  modelOptions: null,
})
assert.equal(live.childAgent, liveAgent)
assert.equal(resumedDuring, 0, 'agent 存活时不应 resume')

// 5d) resume 失败 / 拿不到 agent → 友好错误
const resumeThrows = await resolveCompactionChild({
  ctx: { agents: { get: () => undefined, resume: async () => { throw new Error('boom') } } },
  root: 'D:/projects/demo',
  readConversationMeta: async () => ({ childId: 'child-dead' }),
  modelOptions: null,
})
assert.deepEqual(resumeThrows, { ok: false, error: { message: '无法唤醒对话会话，请先在 AI 页发送一条消息后重试' } })
const resumeNoAgent = await resolveCompactionChild({
  ctx: { agents: { get: () => undefined, resume: async () => ({}) } },
  root: 'D:/projects/demo',
  readConversationMeta: async () => ({ childId: 'child-dead' }),
  modelOptions: null,
})
assert.deepEqual(resumeNoAgent, { ok: false, error: { message: '无法唤醒对话会话，请先在 AI 页发送一条消息后重试' } })

// 5e) 首轮进行中的官方文案（not idle / active compaction）映射为中文
const busyIdle = interpretCompactExecution({
  commandId: 'cmd-busy',
  result: {
    kind: 'error',
    text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
  },
})
assert.equal(busyIdle.ok, false)
assert.match(busyIdle.error.message, /会话正在生成或已有压缩任务/)

// ---------- 6) runConversationCompact：历史太短前置检查（不调用压缩） ----------
const makeCtx = (options = {}) => {
  const compactCalls = { count: 0 }
  const agent = { id: 'child-hist' }
  const ctx = {
    agents: {
      get: () => (options.agentAlive === false ? undefined : agent),
      resume: async () => ({ agent }),
    },
    agentPresets: {
      serviceFor: () => ({
        compactNow: async () => {
          compactCalls.count += 1
          return options.compactResult === undefined
            ? { shadowedSeqs: [1, 2, 3], shadowedTokenCount: 42, summarySeq: 4 }
            : options.compactResult
        },
      }),
      resolve: async () => ({ id: 'novel-writer' }),
      mount: async () => {},
    },
    commands: { execute: async () => { compactCalls.count += 1; return undefined } },
    sessionQuery: options.sessionQuery,
  }
  return { ctx, compactCalls }
}
const baseArgs = (ctx) => ({
  ctx,
  service,
  root: 'D:/projects/demo',
  readConversationMeta: async () => ({ childId: 'child-hist' }),
  modelOptions: null,
  presets: ctx.agentPresets,
  sessionQuery: ctx.sessionQuery,
})

// 6a) 2 条消息 → 提示太短且不调用压缩
{
  const { ctx, compactCalls } = makeCtx({
    sessionQuery: {
      readSession: async () => ({ events: [{ type: 'user/message' }, { type: 'assistant/message' }] }),
    },
  })
  const result = await runConversationCompact(baseArgs(ctx))
  assert.deepEqual(result, { compacted: false, message: '对话还太短（2 条消息），暂不需要压缩' })
  assert.equal(compactCalls.count, 0, '短对话不应调用压缩')
}

// 6b) 8 条消息 → 正常压缩
{
  const events = Array.from({ length: 8 }, (_, index) => ({
    type: index % 2 === 0 ? 'user/message' : 'assistant/message',
  }))
  const { ctx, compactCalls } = makeCtx({ sessionQuery: { readSession: async () => ({ events }) } })
  const result = await runConversationCompact(baseArgs(ctx))
  assert.equal(result.compacted, true)
  assert.equal(result.items, 3)
  assert.equal(result.tokens, 42)
  assert.equal(compactCalls.count, 1)
}

// 6c) readSession 抛错 → 跳过检查继续压缩
{
  const { ctx, compactCalls } = makeCtx({
    sessionQuery: { readSession: async () => { throw new Error('no session') } },
  })
  const result = await runConversationCompact(baseArgs(ctx))
  assert.equal(result.compacted, true)
  assert.equal(compactCalls.count, 1)
}

// 6d) 空快照（0 条消息）→ 提示太短
{
  const { ctx } = makeCtx({ sessionQuery: { readSession: async () => ({ events: [] }) } })
  const result = await runConversationCompact(baseArgs(ctx))
  assert.equal(result.compacted, false)
  assert.match(result.message, /对话还太短（0 条消息）/)
}

// 6e) 没有 conversation meta → 直接错误，不读 session
{
  let readCalls = 0
  const { ctx } = makeCtx({ sessionQuery: { readSession: async () => { readCalls += 1; return { events: [] } } } })
  const result = await runConversationCompact({ ...baseArgs(ctx), readConversationMeta: async () => null })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /还没有对话历史/)
  assert.equal(readCalls, 0)
}

console.log('conversation compact tests passed')
