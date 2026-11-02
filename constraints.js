/**
 * 章节约束引擎：把「本轮指令 / 硬事实 / 设定 / 章纲 / 文风 / 写作要求 / 备注」按优先级裁决，
 * 消除提示词自相矛盾，并把确定性硬约束在生成提示词的开头与结尾各注入一次（不瘦身上下文）。
 *
 * 优先级（高 → 低）：
 *   explicit（本轮对话/工具参数 instruction）
 *   > facts（硬事实/术语/安全/称呼）
 *   > bible（设定）
 *   > outline（本章章纲事件）
 *   > style（文风契约）
 *   > requirements（写作要求 writingNotes）
 *   > notes（作者备注/技法参考）
 *
 * 裁决不交给模型折中：冲突按优先级取高者，并在 conflicts 里记录理由。
 * 语义预检（可选）失败时降级为仅结构化检测，不阻塞生成。
 */

export const CONSTRAINT_PRIORITY = ['explicit', 'facts', 'bible', 'outline', 'style', 'requirements', 'notes']

const LEVEL_LABELS = {
  explicit: '本轮指令',
  facts: '硬事实',
  bible: '设定',
  outline: '章纲',
  style: '文风契约',
  requirements: '写作要求',
  notes: '作者备注',
}

/** 从自然语言规则文本识别视角/时态/句长/对话比例要求。 */
export function parseRuleCues(text) {
  const source = String(text ?? '')
  const cues = {}
  if (/第一人称|用“我”叙述|以“我”的视角/.test(source)) cues.pov = 'first'
  else if (/第三人称|第三人称限知|以“他|以“她/.test(source)) cues.pov = 'third'
  if (/现在时|现在进行时/.test(source)) cues.tense = 'present'
  else if (/过去时/.test(source)) cues.tense = 'past'
  if (/多用短句|短句为主|句子要短|拆成短句/.test(source)) cues.sentenceLength = 'short'
  else if (/多用长句|长句为主|复句/.test(source)) cues.sentenceLength = 'long'
  if (/多写对话|对话为主|对话占比高|增加对话/.test(source)) cues.dialogueRatio = 'high'
  else if (/少写对话|减少对话|对话要少/.test(source)) cues.dialogueRatio = 'low'
  return cues
}

function povMatches(stylePov, wanted) {
  if (!stylePov || !wanted) return true
  if (wanted === 'first') return /first/.test(stylePov)
  return /third/.test(stylePov)
}

function normalizeConflicts(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 8).map((item) => ({
    a: String(item?.a ?? item?.sourceA ?? '').slice(0, 40),
    b: String(item?.b ?? item?.sourceB ?? '').slice(0, 40),
    winner: String(item?.winner ?? '').slice(0, 40),
    reason: String(item?.reason ?? '').slice(0, 300),
    autoResolved: item?.autoResolved !== false,
  })).filter((item) => item.a && item.b)
}

/**
 * 结构化约束裁决（同步）。
 * @param {object} input instruction/facts/glossary/bible/chapter/styleFields/writingNotes/notes/foreshadowing/semanticConflicts
 */
export function resolveChapterConstraints(input = {}) {
  const layers = []
  const pushLayer = (level, content) => {
    const text = String(content ?? '').trim()
    if (!text) return
    layers.push({ level, label: LEVEL_LABELS[level] ?? level, content: text })
  }
  pushLayer('explicit', input.instruction)
  if (Array.isArray(input.facts) && input.facts.length > 0) {
    pushLayer('facts', input.facts.map((fact) => `${fact.kind}·${fact.key}：${fact.value}`).join('\n'))
  }
  if (input.bible) pushLayer('bible', JSON.stringify(input.bible))
  if (input.chapter) pushLayer('outline', JSON.stringify(input.chapter))
  if (input.styleFields) pushLayer('style', JSON.stringify(input.styleFields))
  pushLayer('requirements', input.writingNotes)
  pushLayer('notes', Array.isArray(input.notes) ? input.notes.join('\n') : input.notes)

  const conflicts = []
  const warnings = []
  const hardRules = []
  const seenRules = new Set()
  const addRule = (rule) => {
    const text = String(rule ?? '').trim()
    if (!text || seenRules.has(text)) return
    seenRules.add(text)
    hardRules.push(text)
  }

  const styleFields = input.styleFields ?? {}
  const requirementsCues = parseRuleCues(input.writingNotes)
  const explicitCues = parseRuleCues(input.instruction)

  // 1) 视角 / 时态 / 句长 / 对话比例：显式指令 > 写作要求 > 文风契约
  for (const dimension of ['pov', 'tense', 'sentenceLength', 'dialogueRatio']) {
    const explicitWanted = explicitCues[dimension]
    const requirementWanted = requirementsCues[dimension]
    const styleValue = styleFields[dimension]
    const wanted = explicitWanted ?? requirementWanted
    if (wanted) {
      if (dimension === 'pov' && !povMatches(styleValue, wanted)) {
        conflicts.push({
          a: explicitWanted ? 'explicit' : 'requirements',
          b: 'style',
          winner: explicitWanted ? 'explicit' : 'requirements',
          reason: `要求「${wanted === 'first' ? '第一人称' : '第三人称'}」，与文风契约视角 ${styleValue} 冲突，按优先级取要求方`,
          autoResolved: true,
        })
      }
      if (dimension === 'tense' && styleValue && wanted !== styleValue) {
        conflicts.push({
          a: explicitWanted ? 'explicit' : 'requirements',
          b: 'style',
          winner: explicitWanted ? 'explicit' : 'requirements',
          reason: `要求「${wanted === 'present' ? '现在时' : '过去时'}」，与文风契约时态 ${styleValue} 冲突，按优先级取要求方`,
          autoResolved: true,
        })
      }
      if (dimension === 'sentenceLength' && styleValue && wanted !== styleValue) {
        conflicts.push({
          a: explicitWanted ? 'explicit' : 'requirements',
          b: 'style',
          winner: explicitWanted ? 'explicit' : 'requirements',
          reason: `句长要求「${wanted === 'short' ? '短句' : '长句'}」与文风契约 ${styleValue} 冲突，按优先级取要求方`,
          autoResolved: true,
        })
      }
      if (dimension === 'dialogueRatio' && styleValue != null) {
        const styleHigh = Number(styleValue) >= 0.5
        const wantedHigh = wanted === 'high'
        if (styleHigh !== wantedHigh) {
          conflicts.push({
            a: explicitWanted ? 'explicit' : 'requirements',
            b: 'style',
            winner: explicitWanted ? 'explicit' : 'requirements',
            reason: `对话比例要求「${wantedHigh ? '多' : '少'}」与文风契约 ${styleValue} 冲突，按优先级取要求方`,
            autoResolved: true,
          })
        }
      }
    }
    const finalWanted = explicitWanted ?? requirementWanted
    if (dimension === 'pov') {
      const effective = finalWanted === 'first' ? 'first' : finalWanted === 'third' ? 'third' : styleFields.pov
      if (effective) addRule(`视角：${effective === 'first' ? '第一人称' : effective === 'third' ? '第三人称' : effective}`)
    } else if (dimension === 'tense') {
      const effective = finalWanted ?? styleFields.tense
      if (effective) addRule(`时态：${effective === 'present' ? '现在时' : '过去时'}`)
    } else if (dimension === 'sentenceLength') {
      const effective = finalWanted ?? styleFields.sentenceLength
      if (effective) addRule(`句长：${effective === 'short' ? '短句为主' : '长句为主'}`)
    } else if (dimension === 'dialogueRatio') {
      const effective = styleFields.dialogueRatio
      if (effective != null) addRule(`对话占比约 ${Math.round(Number(effective) * 100)}%`)
    }
  }

  // 2) 术语 / 称呼（glossary）：canonical 统一，别名命中即冲突
  const glossary = Array.isArray(input.glossary) ? input.glossary : []
  for (const entry of glossary.slice(0, 12)) {
    const canonical = String(entry?.canonical ?? entry?.key ?? '').trim()
    if (!canonical) continue
    addRule(`术语/称呼统一写作「${canonical}」`)
    const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : String(entry?.value ?? '').split(/[,，、\s]+/))
      .map((alias) => String(alias).trim())
      .filter((alias) => alias && alias !== canonical)
    const conflictText = [input.instruction, input.writingNotes, input.notes].filter(Boolean).join('\n')
    for (const alias of aliases) {
      if (conflictText.includes(alias) && !conflictText.includes(canonical)) {
        conflicts.push({
          a: 'requirements',
          b: 'facts',
          winner: 'facts',
          reason: `文本使用「${alias}」，术语规范为「${canonical}」，以硬事实为准`,
          autoResolved: true,
        })
        break
      }
    }
  }

  // 3) 硬事实 / 安全
  for (const fact of Array.isArray(input.facts) ? input.facts : []) {
    if (fact.kind === '硬事实' && fact.must !== false) addRule(`硬事实·${fact.key}：${fact.value}`)
    else if (fact.kind === '安全' && fact.must !== false) addRule(`安全要求：${fact.value}`)
    else if (fact.kind === '称呼') addRule(`称呼统一：${fact.key} → ${fact.value}`)
  }

  // 4) 章纲事件 vs 设定状态（不静默覆盖：warning 提示更新设定）
  const chapterText = JSON.stringify(input.chapter ?? {})
  const bible = input.bible ?? {}
  const characters = Array.isArray(bible.characters) ? bible.characters : []
  const deathPattern = /(死|身亡|阵亡|牺牲|殒命)/
  if (deathPattern.test(chapterText)) {
    for (const character of characters.slice(0, 20)) {
      const name = String(character?.name ?? '').trim()
      if (!name || !chapterText.includes(name)) continue
      const description = `${character.description ?? ''}${character.role ?? ''}`
      if (/(存活|在世|活着|未死)/.test(description)) {
        conflicts.push({
          a: 'outline',
          b: 'bible',
          winner: 'outline',
          reason: `章纲要求「${name}」死亡，但设定记录其为存活；生成照做，但需要同步更新设定`,
          autoResolved: false,
        })
        warnings.push(`设定需要同步：${name} 在章纲中死亡，但 bible 仍记录为存活，请更新角色设定`)
      }
    }
  }

  // 5) 伏笔状态：章纲要求回收但台账已回收
  const foreshadowing = Array.isArray(input.foreshadowing) ? input.foreshadowing : []
  if (/(回收|揭晓|兑现)/.test(chapterText)) {
    for (const item of foreshadowing.slice(0, 12)) {
      if (item?.status === 'done' || item?.resolved === true) {
        conflicts.push({
          a: 'outline',
          b: 'facts',
          winner: 'outline',
          reason: '章纲要求回收的伏笔在台账中已标记完成，请先更新伏笔状态',
          autoResolved: false,
        })
        warnings.push('伏笔状态需要同步：章纲要求回收，但台账标记为已回收')
        break
      }
    }
  }

  // 6) 本章必须变化（章纲 payoff/plant 或 synopsis 中的明确要求）
  if (input.chapter?.synopsis) addRule(`本章必须发生：${String(input.chapter.synopsis).slice(0, 120)}`)

  // 7) 语义预检结果合并（已按优先级裁决）
  for (const conflict of normalizeConflicts(input.semanticConflicts)) {
    if (CONSTRAINT_PRIORITY.indexOf(conflict.a) > CONSTRAINT_PRIORITY.indexOf(conflict.b) && CONSTRAINT_PRIORITY.includes(conflict.b)) {
      conflicts.push({ ...conflict, winner: conflict.b, reason: `${conflict.reason}（按优先级改判为 ${conflict.b}）` })
    } else {
      conflicts.push(conflict)
    }
  }

  if (hardRules.length > 12) hardRules.length = 12
  return {
    hardRules,
    conflicts,
    layers,
    warnings: [...new Set(warnings)],
  }
}

/** 渲染硬约束块：start（开头完整）与 end（结尾紧凑复述）内容一致，不新增规则。 */
export function renderConstraints(constraints, options = {}) {
  const hardRules = Array.isArray(constraints?.hardRules) ? constraints.hardRules.slice(0, 12) : []
  if (hardRules.length === 0) return ''
  const phase = options.phase === 'end' ? 'end' : 'start'
  if (phase === 'end') {
    return [
      '【硬约束复述（结尾自检，内容与开头一致；冲突时以开头硬约束为准）】',
      ...hardRules.map((rule, index) => `${index + 1}. ${rule}`),
    ].join('\n')
  }
  return [
    '【硬约束（按优先级裁决，必须满足；与后文任何说明冲突时以此为准）】',
    ...hardRules.map((rule, index) => `${index + 1}. ${rule}`),
  ].join('\n')
}

/**
 * 事实校验（规则检查，不自动改）：术语 canonical、称呼一致、must 事实关键值出现/禁止值不出现。
 * @returns {{ok:boolean, violations:[{factId,kind,key,rule,index}]}}
 */
export function validateAgainstFacts(text, facts = []) {
  const source = String(text ?? '')
  const violations = []
  for (const fact of Array.isArray(facts) ? facts : []) {
    const kind = String(fact?.kind ?? '')
    const key = String(fact?.key ?? '').trim()
    if (kind === '术语') {
      const aliases = String(fact.value ?? '').split(/[,，、\s]+/).map((alias) => alias.trim()).filter(Boolean)
      for (const alias of aliases) {
        const index = source.indexOf(alias)
        if (index >= 0 && !source.includes(key)) {
          violations.push({ factId: fact.id ?? null, kind, key, rule: `术语「${key}」不应写作「${alias}」`, index })
        }
      }
    } else if (kind === '称呼') {
      const expected = String(fact.value ?? '').trim()
      if (expected && source.includes(key) && !source.includes(expected)) {
        violations.push({ factId: fact.id ?? null, kind, key, rule: `称呼「${key}」应写作「${expected}」`, index: source.indexOf(key) })
      }
    } else if (kind === '硬事实' && fact.must !== false) {
      const keywords = String(fact.note ?? '').split(/[,，、\s]+/).map((word) => word.trim()).filter(Boolean)
      for (const word of keywords) {
        if (word && !source.includes(word)) {
          violations.push({ factId: fact.id ?? null, kind, key, rule: `硬事实「${key}」缺少关键值「${word}」`, index: -1 })
        }
      }
    }
  }
  return { ok: violations.length === 0, violations }
}
