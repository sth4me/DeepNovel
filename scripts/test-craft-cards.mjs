// 写作技法库：内置卡片质量、按需选择、用户卡片合并、提示词注入、项目开关。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-craft-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-craft-project-'))
process.env.DSH_HOME = home

const { CRAFT_CARDS } = await import('../craft.js')
const { buildChapterUserPrompt } = await import('../templates.js')
const { NovelWriterService } = await import('../service.js')

const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try { const info = await stat(abs(target)); return { version: String(info.mtimeMs) } } catch { return null }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
}
const service = new NovelWriterService({ fs: fsCtx, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } })

// 1) 内置卡片：≥8 张、id 唯一、body 300–800 字、tags/tasks 非空
assert.ok(CRAFT_CARDS.length >= 8, `内置卡片应 ≥8，实际 ${CRAFT_CARDS.length}`)
assert.equal(new Set(CRAFT_CARDS.map((card) => card.id)).size, CRAFT_CARDS.length)
for (const card of CRAFT_CARDS) {
  assert.ok(card.id && card.title && card.summary, `卡片字段缺失：${card.id}`)
  assert.ok(card.body.length >= 300, `${card.id} body 过短（${card.body.length}）`)
  assert.ok(card.body.length <= 1400, `${card.id} body 过长（${card.body.length}）`)
  // 五节齐全且顺序正确（前端按【】标题渲染）
  const sections = ['【适用】', '【通用原则】', '【按场景调节】', '【常见反例（不要这样写）】', '【自检】']
  const indexes = sections.map((title) => card.body.indexOf(title))
  for (let index = 0; index < sections.length; index += 1) {
    assert.ok(indexes[index] >= 0, `${card.id} 缺少分节 ${sections[index]}`)
    if (index > 0) assert.ok(indexes[index] > indexes[index - 1], `${card.id} 分节顺序错误：${sections[index]}`)
  }
  for (const phrase of ['必须每章', '一定要', '必须停在']) {
    assert.equal(card.body.includes(phrase), false, `${card.id} 含绝对化措辞：${phrase}`)
  }
  assert.ok(Array.isArray(card.tags) && card.tags.length > 0, `${card.id} tags 为空`)
  assert.ok(Array.isArray(card.tasks) && card.tasks.length > 0, `${card.id} tasks 为空`)
}

// 2) selectCraftCards：task 命中、max 限制、指令关键词加权
const draftPick = await service.selectCraftCards(null, { task: 'draft' })
assert.ok(draftPick.cards.length > 0, 'task=draft 应返回卡片')
assert.ok(draftPick.cards.length <= 2, '默认最多 2 张')
assert.ok(draftPick.cards.every((card) => card.body.length <= 1200))

const fightPick = await service.selectCraftCards(null, { task: 'draft', instruction: '本章写一场近距离打斗，注意兵器' })
assert.equal(fightPick.cards[0].id, 'fight', `instruction 含「打斗」时 fight 应排第一，实际 ${fightPick.cards[0]?.id}`)

const onePick = await service.selectCraftCards(null, { task: 'draft', max: 1 })
assert.equal(onePick.cards.length, 1)

const outlinePick = await service.selectCraftCards(null, { task: 'outline', max: 5 })
assert.ok(outlinePick.cards.length > 0)
assert.equal(outlinePick.cards.length, 1, 'instruction 为空且无 genre 时只返回 1 张')
assert.ok(['foreshadow', 'opening'].includes(outlinePick.cards[0].id))

// 3) 列表不含 body；未知 id 抛错
const list = await service.listCraftCards(null)
assert.ok(list.cards.length >= 8)
assert.ok(list.cards.every((card) => card.body === undefined))
assert.ok(list.cards.every((card) => card.source === 'builtin'))
await assert.rejects(() => service.readCraftCard(null, { id: 'no-such-card' }), /找不到技法卡片/)

// 4) 用户卡片：读取、source=user、同 id 覆盖内置、坏文件跳过
const craftDir = join(home, 'novel-writer', 'library', 'craft')
await mkdir(craftDir, { recursive: true })
await writeFile(join(craftDir, 'my-card.json'), JSON.stringify({
  id: 'my-card',
  title: '自定义技法卡',
  summary: '用户卡片测试',
  tags: ['测试', '自定义'],
  tasks: ['draft'],
  body: '自'.repeat(350),
}), 'utf8')
await writeFile(join(craftDir, 'broken.json'), '{ 这不是 JSON', 'utf8')
const withUser = await service.listCraftCards(null)
const userCard = withUser.cards.find((card) => card.id === 'my-card')
assert.ok(userCard, '应读到用户卡片')
assert.equal(userCard.source, 'user')
assert.equal(userCard.body, undefined, '列表不含 body')
assert.equal((await service.readCraftCard(null, { id: 'my-card' })).body.length, 350)
assert.equal(withUser.cards.some((card) => card.id === 'broken'), false, '坏文件应跳过')

// 同 id 覆盖内置
await writeFile(join(craftDir, 'scene.json'), JSON.stringify({
  id: 'scene', title: '覆盖后的场景卡', tags: ['场景'], tasks: ['draft'], body: '覆'.repeat(320),
}), 'utf8')
const overridden = await service.readCraftCard(null, { id: 'scene' })
assert.equal(overridden.source, 'user')
assert.equal(overridden.title, '覆盖后的场景卡')
const overriddenPick = await service.selectCraftCards(null, { task: 'draft', instruction: '场景推进', max: 5 })
assert.ok(overriddenPick.cards.some((card) => card.id === 'scene' && card.title === '覆盖后的场景卡'))

// 5) buildChapterUserPrompt 注入段落
const baseInput = { title: 't', language: 'zh', number: 1, chapter: { title: '测试章' }, styleFields: {}, wordBudget: 3000 }
// 技法改为技能目录路由：正文提示词不再程序注入卡片/目录
const plainPrompt = buildChapterUserPrompt(baseInput)
assert.equal(plainPrompt.includes('写作技法参考'), false, '默认不注入技法段')
assert.equal(plainPrompt.includes('可选技法目录'), false, '默认不注入技法目录')
const legacyCards = buildChapterUserPrompt({ ...baseInput, craftCards: [{ id: 'fight', title: 'x', body: 'y' }] })
assert.equal(legacyCards.includes('写作技法参考'), false, 'craftCards 参数已废弃（技法走技能目录）')

// 6) setCraftAuto / readCraftAuto（临时项目）
await mkdir(join(project, 'story'), { recursive: true })
await writeFile(join(project, 'story', 'project.json'), JSON.stringify({ schemaVersion: 1, title: 't' }), 'utf8')
assert.equal(await service.readCraftAuto(project), true, '默认应开启')
assert.deepEqual(await service.setCraftAuto(project, { enabled: false }), { craftAuto: false })
assert.equal(await service.readCraftAuto(project), false)
assert.deepEqual(await service.craftCardsFor(project, { task: 'draft' }), [])
assert.deepEqual(await service.setCraftAuto(project, { enabled: true }), { craftAuto: true })
assert.equal(await service.readCraftAuto(project), true)
assert.ok((await service.craftCardsFor(project, { task: 'draft' })).length > 0)


// 7) 逐卡禁用 / 用户卡 CRUD / 挑选偏差 / 契约优先
// 7a) 逐卡禁用（project.craftDisabled）
assert.deepEqual(await service.readCraftDisabled(project), [])
assert.deepEqual(await service.setCraftCardEnabled(project, { id: 'scene', enabled: false }), { id: 'scene', enabled: false })
assert.deepEqual(await service.readCraftDisabled(project), ['scene'])
const allDisabled = await service.allCraftCards(project)
assert.equal(allDisabled.find((card) => card.id === 'scene').enabled, false)
const disabledPick = await service.selectCraftCards(project, { task: 'draft', max: 5 })
assert.equal(disabledPick.cards.some((card) => card.id === 'scene'), false, '禁用卡不应被选中')
assert.deepEqual(await service.setCraftCardEnabled(project, { id: 'scene', enabled: true }), { id: 'scene', enabled: true })
assert.ok((await service.selectCraftCards(project, { task: 'draft', max: 5 })).cards.length >= 1)

// 7b) 用户卡片 save/delete/覆盖/恢复内置/校验
const userBody = '这是一张用户自定义技法卡的正文，用于测试保存与覆盖。'.repeat(5)
await service.saveCraftCard(project, { id: 'my-temp-card', title: '临时卡', summary: '测试', tags: ['测试'], tasks: ['draft'], body: userBody })
const afterSave = await service.listCraftCards(project)
const saved = afterSave.cards.find((card) => card.id === 'my-temp-card')
assert.ok(saved, '应读到用户卡片')
assert.equal(saved.source, 'user')
assert.equal(saved.enabled, true)
assert.equal((await service.readCraftCard(project, { id: 'my-temp-card' })).body.length, userBody.length)
await service.saveCraftCard(project, { id: 'scene', title: '覆盖场景卡', summary: '覆盖', tags: ['场景'], tasks: ['draft'], body: userBody })
const overrideList = await service.listCraftCards(project)
assert.equal(overrideList.cards.find((card) => card.id === 'scene').hasOverride, true)
assert.equal((await service.readCraftCard(project, { id: 'scene' })).title, '覆盖场景卡')
await service.deleteCraftCard(project, 'scene')
const restored = await service.listCraftCards(project)
assert.equal(restored.cards.find((card) => card.id === 'scene').source, 'builtin')
assert.equal(restored.cards.find((card) => card.id === 'scene').hasOverride, false)
await service.deleteCraftCard(project, 'my-temp-card')
await assert.rejects(() => service.saveCraftCard(project, { id: 'Bad Id', tasks: ['draft'], body: userBody }), /id 需为/)
await assert.rejects(() => service.saveCraftCard(project, { id: 'ok-card', tasks: ['draft'], body: '太短' }), /100–4000/)
await assert.rejects(() => service.saveCraftCard(project, { id: 'ok-card', tasks: ['bogus'], body: userBody }), /tasks/)
await assert.rejects(() => service.deleteCraftCard(project, 'no-such-user-card'), /不存在/)

// 7c) 挑选偏差：同一 instruction 下 5 章选卡组合不完全相同
const combos = []
for (const chapterNumber of [1, 2, 3, 4, 5]) {
  const pick = await service.selectCraftCards(project, { task: 'draft', chapterNumber })
  combos.push(pick.cards.map((card) => card.id).join('+'))
}
assert.ok(new Set(combos).size >= 2, `5 章选卡组合应有差异，实际 ${combos.join(' | ')}`)

// 7d) 指令关键词命中 → 对应卡排第一
const fightByKeyword = await service.selectCraftCards(project, {
  task: 'draft',
  instruction: '本章写一场近距离打斗，注意兵器',
  chapterNumber: 3,
})
assert.equal(fightByKeyword.cards[0].id, 'fight')

// 7e) instruction 为空且无 genre → 只 1 张
assert.equal((await service.selectCraftCards(project, { task: 'draft' })).cards.length, 1)

service.disposeStores()
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
console.log('craft cards tests passed')
