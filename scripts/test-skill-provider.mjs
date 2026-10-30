// 内置技法技能 provider + 导入技能管理：list/get、禁用过滤、同名覆盖、开关/删除/读取、安全校验。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'deepnovel-skill-home-'))
const project = await mkdtemp(join(tmpdir(), 'deepnovel-skill-project-'))
process.env.DSH_HOME = home

const { NovelWriterService } = await import('../service.js')
const {
  CRAFT_SKILL_RANK,
  createCraftSkillProvider,
  deleteImportedSkill,
  parseSkillFrontmatter,
  scanImportedSkills,
  skillRoots,
} = await import('../skills.js')
const { CRAFT_CARDS } = await import('../craft.js')

const abs = (target) => join(target.cwd, target.relativePath)
const fsCtx = {
  resolve: async (relativePath, { cwd }) => ({ cwd, relativePath }),
  stat: async (target) => {
    try {
      const info = await stat(abs(target))
      return { version: String(info.mtimeMs) }
    } catch {
      return null
    }
  },
  readText: async (target) => readFile(abs(target), 'utf8'),
  writeText: async (target, content) => {
    await mkdir(dirname(abs(target)), { recursive: true })
    await writeFile(abs(target), content, 'utf8')
    return { operation: 'update', version: '1' }
  },
}
const service = new NovelWriterService({
  fs: fsCtx,
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
})
await service.initProject(project, { title: '技能测试' })

// ---------- 1) 内置 provider：list 返回 craft-*、rank 600、metadata ----------
const provider = createCraftSkillProvider(service)
assert.equal(provider.name, 'deepnovel-craft')
// 非写作项目 cwd：不暴露内置技法（避免污染其它会话的技能目录）
const plainDir = await mkdtemp(join(tmpdir(), 'deepnovel-skill-plain-'))
assert.deepEqual(await provider.list({ cwd: plainDir }), [])
assert.deepEqual(await provider.list({}), [])
const listed = await provider.list({ cwd: project })
assert.equal(listed.length, CRAFT_CARDS.length)
assert.ok(listed.every((candidate) => candidate.name.startsWith('craft-')))
assert.ok(listed.every((candidate) => candidate.rank === CRAFT_SKILL_RANK))
assert.ok(listed.every((candidate) => candidate.metadata?.source === 'builtin'))
assert.ok(listed.some((candidate) => candidate.name === 'craft-scene' && candidate.description.includes('场景')))

// ---------- 2) get：正文带适配性判断提示 ----------
const sceneSkill = await provider.get({ name: 'craft-scene' })
assert.equal(sceneSkill.name, 'craft-scene')
assert.ok(sceneSkill.content.includes('判断'), 'get 正文应带读后判断提示')
assert.ok(sceneSkill.content.includes('【适用】'))
assert.equal(sceneSkill.source, 'builtin')
assert.equal(await provider.get({ name: 'craft-no-such' }), undefined)

// ---------- 3) 项目禁用过滤 ----------
await service.setCraftCardEnabled(project, { id: 'scene', enabled: false })
const filtered = await provider.list({ cwd: project })
assert.equal(filtered.some((candidate) => candidate.name === 'craft-scene'), false, '禁用后不应出现')
assert.equal(filtered.length, CRAFT_CARDS.length - 1)
const disabledList = await service.listSkills(project)
assert.equal(disabledList.skills.find((skill) => skill.name === 'craft-scene').enabled, false)
assert.equal(disabledList.skills.find((skill) => skill.name === 'craft-dialogue').enabled, true)
await service.setCraftCardEnabled(project, { id: 'scene', enabled: true })

// ---------- 4) 导入技能：扫描 / 同名覆盖内置 / rank ----------
const skillsRoot = join(project, '.dsh', 'skills')
await mkdir(join(skillsRoot, 'craft-scene'), { recursive: true })
await writeFile(join(skillsRoot, 'craft-scene', 'SKILL.md'), [
  '---',
  'name: craft-scene',
  'description: 导入的场景技能（覆盖内置）',
  '---',
  '这是导入技能正文。',
].join('\n'), 'utf8')
await mkdir(join(skillsRoot, 'my-skill'), { recursive: true })
await writeFile(join(skillsRoot, 'my-skill', 'SKILL.md'), [
  '---',
  'name: my-skill',
  'description: 用户导入的测试技能',
  '---',
  '导入技能正文：先写动作。',
].join('\n'), 'utf8')
const roots = skillRoots(project, home)
const imported = await scanImportedSkills(roots)
assert.equal(imported.length, 2)
assert.ok(imported.every((skill) => skill.rank === 100), '项目 .dsh/skills 的 rank 应为 100')
const mergedList = await service.listSkills(project)
assert.equal(mergedList.skills.find((skill) => skill.name === 'craft-scene').source, 'imported', '同名导入应覆盖内置')
assert.equal(mergedList.skills.find((skill) => skill.name === 'craft-scene').overridesBuiltin, true, '覆盖内置的导入技能应标记 overridesBuiltin')
assert.equal(mergedList.skills.find((skill) => skill.name === 'craft-dialogue').overridesBuiltin, false)
assert.equal(mergedList.skills.find((skill) => skill.name === 'my-skill').source, 'imported')
assert.equal(mergedList.skills.find((skill) => skill.name === 'craft-scene').canDelete, true)
assert.equal(mergedList.skills.find((skill) => skill.name === 'craft-dialogue').canDelete, false)
assert.equal(mergedList.skills.filter((skill) => skill.name === 'craft-scene').length, 1, '同名只保留一条')

// ---------- 5) skill-read：内置 / 导入 ----------
const readBuiltin = await service.readSkill(project, 'craft-emotion')
assert.equal(readBuiltin.source, 'builtin')
assert.ok(readBuiltin.content.includes('【适用】'))
const readImported = await service.readSkill(project, 'my-skill')
assert.equal(readImported.source, 'imported')
assert.equal(readImported.content, '导入技能正文：先写动作。')
await assert.rejects(() => service.readSkill(project, 'no-such-skill'), /找不到技能/)

// ---------- 6) skill-toggle：内置写 craftDisabled；导入报错 ----------
assert.deepEqual(await service.toggleSkill(project, { name: 'craft-dialogue', enabled: false }), { id: 'dialogue', enabled: false })
assert.equal((await service.listSkills(project)).skills.find((skill) => skill.name === 'craft-dialogue').enabled, false)
await assert.rejects(() => service.toggleSkill(project, { name: 'my-skill', enabled: false }), /导入技能不支持开关/)
assert.deepEqual(await service.toggleSkill(project, { name: 'craft-dialogue', enabled: true }), { id: 'dialogue', enabled: true })

// ---------- 7) skill-delete：仅导入、删除目录包、不存在报错、内置不可删 ----------
const deleted = await service.deleteSkill(project, 'my-skill')
assert.equal(deleted.deleted, true)
assert.equal(await stat(join(skillsRoot, 'my-skill')).catch(() => null), null, '目录包应被删除')
await assert.rejects(() => service.deleteSkill(project, 'my-skill'), /导入技能不存在/)
await assert.rejects(() => service.deleteSkill(project, 'craft-dialogue'), /导入技能不存在/, '内置技能不可删除')

// ---------- 8) 删除安全：只扫描配置的 skills 根；不存在的技能报错 ----------
const outsideDir = await mkdtemp(join(tmpdir(), 'deepnovel-skill-outside-'))
await writeFile(join(outsideDir, 'SKILL.md'), [
  '---',
  'name: outside-skill',
  'description: 根外技能',
  '---',
  '根外正文',
].join('\n'), 'utf8')
// 根外目录默认不可见：skillRoots(project, home) 不包含 outsideDir
assert.equal((await scanImportedSkills(skillRoots(project, home))).some((skill) => skill.name === 'outside-skill'), false)
await assert.rejects(() => deleteImportedSkill({ roots: skillRoots(project, home), name: 'outside-skill' }), /导入技能不存在/)
// 作为根传入时才会被扫描（删除路径始终限制在该根内）
const outsideScan = await scanImportedSkills([{ source: 'user-dsh', rank: 400, path: outsideDir }])
assert.equal(outsideScan.length, 1)

// ---------- 9) frontmatter 解析容错 ----------
assert.equal(parseSkillFrontmatter('没有 frontmatter'), null)
assert.equal(parseSkillFrontmatter('---\nname: x\n---\nbody'), null, '缺 description 应无效')
const parsed = parseSkillFrontmatter('---\nname: demo\ndescription: 说明\n---\n正文')
assert.equal(parsed.name, 'demo')
assert.equal(parsed.description, '说明')
assert.equal(parsed.content, '正文')


// ---------- 10) skill-import：目录包 / 扁平 / 覆盖备份 / 校验 ----------
const sourceRoot = await mkdtemp(join(tmpdir(), 'deepnovel-skill-import-src-'))
const packDir = join(sourceRoot, 'pack-skill')
await mkdir(join(packDir, 'references'), { recursive: true })
await writeFile(join(packDir, 'SKILL.md'), ['---', 'name: pack-skill', 'description: 目录包技能', '---', '目录包正文'].join('\n'), 'utf8')
await writeFile(join(packDir, 'references', 'ref.md'), '参考资料', 'utf8')
const packImport = await service.importSkill(project, { path: packDir })
assert.equal(packImport.imported, true)
assert.equal(packImport.name, 'pack-skill')
assert.ok((await readFile(packImport.path, 'utf8')).includes('目录包正文'))
assert.ok((await readFile(join(project, '.dsh', 'skills', 'pack-skill', 'references', 'ref.md'), 'utf8')).includes('参考资料'), '目录包应复制 references/')
assert.ok((await service.listSkills(project)).skills.some((skill) => skill.name === 'pack-skill' && skill.source === 'imported'))

const flatSource = join(sourceRoot, 'flat-skill.md')
await writeFile(flatSource, ['---', 'name: flat-skill', 'description: 扁平技能', '---', '扁平正文'].join('\n'), 'utf8')
const flatImport = await service.importSkill(project, { path: flatSource })
assert.equal(flatImport.name, 'flat-skill')
assert.ok(flatImport.path.endsWith(join('.dsh', 'skills', 'flat-skill.md')))
assert.ok((await readFile(flatImport.path, 'utf8')).includes('扁平正文'))

// 同名覆盖：先备份到 .dsh-writing/backups/skills-<stamp>/
const packDir2 = join(sourceRoot, 'pack-skill-v2')
await mkdir(packDir2, { recursive: true })
await writeFile(join(packDir2, 'SKILL.md'), ['---', 'name: pack-skill', 'description: 覆盖版', '---', '覆盖正文'].join('\n'), 'utf8')
const overrideImport = await service.importSkill(project, { path: packDir2 })
assert.ok(overrideImport.backupPath, '同名覆盖应先备份')
assert.ok((await readFile(overrideImport.path, 'utf8')).includes('覆盖正文'))
const backupEntries = await readdir(overrideImport.backupPath)
assert.ok(backupEntries.some((name) => name.includes('pack-skill')), '备份目录应包含旧技能')
assert.ok((await readFile(join(overrideImport.backupPath, 'pack-skill', 'SKILL.md'), 'utf8')).includes('目录包正文'), '备份应保留旧正文')

// 非法 frontmatter / name / 不存在路径
const badFrontmatter = join(sourceRoot, 'bad.md')
await writeFile(badFrontmatter, ['---', 'name: bad-skill', '---', 'x'].join('\n'), 'utf8')
await assert.rejects(() => service.importSkill(project, { path: badFrontmatter }), /frontmatter 无效/)
const badName = join(sourceRoot, 'bad-name.md')
await writeFile(badName, ['---', 'name: ../evil', 'description: 穿越', '---', 'x'].join('\n'), 'utf8')
await assert.rejects(() => service.importSkill(project, { path: badName }), /name 需为/)
await assert.rejects(() => service.importSkill(project, { path: join(sourceRoot, 'no-such') }), /找不到技能路径/)

// ---------- 11) 助手技能范围：内置 + 项目导入；用户级 / bundled 不出现 ----------
const fooDir = join(project, '.dsh', 'skills', 'foo')
await mkdir(fooDir, { recursive: true })
await writeFile(join(fooDir, 'SKILL.md'), ['---', 'name: foo', 'description: 项目导入 foo', '---', 'foo 正文'].join('\n'), 'utf8')
await mkdir(join(project, '.agents', 'skills'), { recursive: true })
await writeFile(join(project, '.agents', 'skills', 'bar.md'), ['---', 'name: bar', 'description: 项目导入 bar', '---', 'bar 正文'].join('\n'), 'utf8')
const scoped = await provider.list({ cwd: project })
const scopedNames = scoped.map((candidate) => candidate.name)
assert.ok(scopedNames.includes('foo') && scopedNames.includes('bar'), '项目导入技能应出现在技能目录')
assert.equal(scoped.find((candidate) => candidate.name === 'foo').rank, 100)
assert.equal(scoped.find((candidate) => candidate.name === 'bar').rank, 200)
assert.equal(scoped.find((candidate) => candidate.name === 'craft-scene' && candidate.source === 'imported').rank, 100)
const fooSkill = await provider.get(scoped.find((candidate) => candidate.name === 'foo'))
assert.equal(fooSkill.content, 'foo 正文', '导入技能 get 应返回去 frontmatter 的正文')
assert.equal(fooSkill.source, 'imported')

// 用户级根（DSH_HOME/skills）隔离
await mkdir(join(home, 'skills', 'user-skill'), { recursive: true })
await writeFile(join(home, 'skills', 'user-skill', 'SKILL.md'), ['---', 'name: user-skill', 'description: 用户级技能', '---', '用户级正文'].join('\n'), 'utf8')
const afterUser = await provider.list({ cwd: project })
assert.equal(afterUser.some((candidate) => candidate.name === 'user-skill'), false, '用户级技能不应出现')
const management = await service.listSkills(project)
assert.equal(management.skills.some((skill) => skill.name === 'user-skill'), false, '管理列表不应含用户级技能')
assert.ok(management.skills.some((skill) => skill.name === 'foo' && skill.source === 'imported'), '管理列表应含项目导入技能')

// bundled（DSH_BUNDLED_SKILL_DIR）隔离
const bundledDir = await mkdtemp(join(tmpdir(), 'deepnovel-bundled-skills-'))
await mkdir(join(bundledDir, 'bundled-skill'), { recursive: true })
await writeFile(join(bundledDir, 'bundled-skill', 'SKILL.md'), ['---', 'name: bundled-skill', 'description: 公共技能', '---', 'x'].join('\n'), 'utf8')
const previousBundled = process.env.DSH_BUNDLED_SKILL_DIR
process.env.DSH_BUNDLED_SKILL_DIR = bundledDir
const afterBundled = await provider.list({ cwd: project })
assert.equal(afterBundled.some((candidate) => candidate.name === 'bundled-skill'), false, 'bundled 技能不应出现')
if (previousBundled === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
else process.env.DSH_BUNDLED_SKILL_DIR = previousBundled
await rm(bundledDir, { recursive: true, force: true })

// ---------- 12) 全局技能库（DSH_HOME/novel-writer/library/skills，rank 300） ----------
const globalSkillsDir = join(home, 'novel-writer', 'library', 'skills')
await mkdir(join(globalSkillsDir, 'global-skill'), { recursive: true })
await writeFile(join(globalSkillsDir, 'global-skill', 'SKILL.md'), ['---', 'name: global-skill', 'description: 全局技能', '---', '全局正文'].join('\n'), 'utf8')
const withGlobal = await provider.list({ cwd: project })
const globalCandidate = withGlobal.find((candidate) => candidate.name === 'global-skill')
assert.ok(globalCandidate, '全局技能应出现')
assert.equal(globalCandidate.rank, 300)
assert.equal(globalCandidate.source, 'imported')
assert.equal(globalCandidate.scope, 'global')
const globalBody = await provider.get(globalCandidate)
assert.equal(globalBody.content, '全局正文')
assert.equal(globalBody.source, 'imported')

// 同名冲突：项目(100) > 全局(300) > 内置(600)
await mkdir(join(project, '.dsh', 'skills', 'dup'), { recursive: true })
await writeFile(join(project, '.dsh', 'skills', 'dup', 'SKILL.md'), ['---', 'name: dup', 'description: 项目 dup', '---', '项目 dup 正文'].join('\n'), 'utf8')
await mkdir(join(globalSkillsDir, 'dup'), { recursive: true })
await writeFile(join(globalSkillsDir, 'dup', 'SKILL.md'), ['---', 'name: dup', 'description: 全局 dup', '---', '全局 dup 正文'].join('\n'), 'utf8')
const dupList = await provider.list({ cwd: project })
const dupWinner = dupList.find((candidate) => candidate.name === 'dup')
assert.equal(dupWinner.rank, 100, '项目导入应胜全局')
assert.equal(dupWinner.scope, 'project')
assert.equal((await service.listSkills(project)).skills.find((skill) => skill.name === 'dup').scope, 'project')
// 全局 vs 内置：全局 craft-dialogue 覆盖内置
await mkdir(join(globalSkillsDir, 'craft-dialogue'), { recursive: true })
await writeFile(join(globalSkillsDir, 'craft-dialogue', 'SKILL.md'), ['---', 'name: craft-dialogue', 'description: 全局对白覆盖', '---', '全局对白正文'].join('\n'), 'utf8')
const globalOverride = (await service.listSkills(project)).skills.find((skill) => skill.name === 'craft-dialogue')
assert.equal(globalOverride.scope, 'global')
assert.equal(globalOverride.overridesBuiltin, true)
assert.equal(globalOverride.source, 'imported')

// skill-import scope=global + 同名备份
const globalSrc = join(sourceRoot, 'global-import')
await mkdir(globalSrc, { recursive: true })
await writeFile(join(globalSrc, 'SKILL.md'), ['---', 'name: global-import', 'description: 全局导入', '---', '全局导入正文'].join('\n'), 'utf8')
const globalImport = await service.importSkill(project, { path: globalSrc, scope: 'global' })
assert.equal(globalImport.scope, 'global')
assert.ok(globalImport.path.startsWith(globalSkillsDir), '全局导入应写入全局技能库')
assert.ok((await readFile(globalImport.path, 'utf8')).includes('全局导入正文'))
const globalSrc2 = join(sourceRoot, 'global-import-v2')
await mkdir(globalSrc2, { recursive: true })
await writeFile(join(globalSrc2, 'SKILL.md'), ['---', 'name: global-import', 'description: 全局导入 v2', '---', '全局导入 v2 正文'].join('\n'), 'utf8')
const globalOverrideImport = await service.importSkill(project, { path: globalSrc2, scope: 'global' })
assert.ok(globalOverrideImport.backupPath?.startsWith(join(home, 'novel-writer', 'library', 'backups')), '全局覆盖应备份到全局库 backups')
assert.equal(flatImport.scope, 'project', '缺省 scope 应为 project')
const evilGlobal = join(sourceRoot, 'evil-global.md')
await writeFile(evilGlobal, ['---', 'name: ../evil-global', 'description: 穿越', '---', 'x'].join('\n'), 'utf8')
await assert.rejects(() => service.importSkill(project, { path: evilGlobal, scope: 'global' }), /name 需为/)

// skill-delete：全局 / 项目 / 内置 / scope 不匹配
const deletedGlobal = await service.deleteSkill(project, { name: 'global-import', scope: 'global' })
assert.equal(deletedGlobal.deleted, true)
assert.equal(await stat(join(globalSkillsDir, 'global-import')).catch(() => null), null)
const deletedProject = await service.deleteSkill(project, { name: 'dup', scope: 'project' })
assert.equal(deletedProject.deleted, true)
await assert.rejects(() => service.deleteSkill(project, { name: 'craft-dialogue', scope: 'project' }), /导入技能不存在/)
await assert.rejects(() => service.deleteSkill(project, { name: 'global-skill', scope: 'project' }), /导入技能不存在/)

// skill-read 全局 + skills-list 的 scope/path
const globalRead = await service.readSkill(project, 'global-skill', 'global')
assert.equal(globalRead.scope, 'global')
assert.equal(globalRead.content, '全局正文')
const scopedList = (await service.listSkills(project)).skills
assert.equal(scopedList.find((skill) => skill.name === 'craft-fight').scope, 'builtin')
assert.equal(scopedList.find((skill) => skill.name === 'foo').scope, 'project')
assert.ok(scopedList.find((skill) => skill.name === 'foo').path.includes('.dsh'))
assert.equal(scopedList.find((skill) => skill.name === 'global-skill').scope, 'global')
service.disposeStores()
await new Promise((resolve) => setTimeout(resolve, 80))
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
await rm(outsideDir, { recursive: true, force: true })
await rm(plainDir, { recursive: true, force: true })
await rm(sourceRoot, { recursive: true, force: true })
console.log('skill provider tests passed')
