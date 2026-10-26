export const STYLE_TEMPLATES = [
  {
    id: 'fast-web',
    name: '快节奏网文',
    description: '短句、直给、画面先行，少铺垫。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3000,
      sentenceLength: 'short',
      paragraphLength: 'short',
      dialogueRatio: 0.45,
      metaphorDensity: 'low',
      chapterTitleStyle: '短标题',
      notes: '句子短，场景切换快；避免长段心理描写。',
    },
    samples: ['电话响到第三声他就接了，对面只说了一句：人死了。'],
  },
  {
    id: 'literary',
    name: '文学向',
    description: '重视语言质感、环境与心理描写，节奏可以慢但不能空转。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3500,
      sentenceLength: 'long',
      paragraphLength: 'medium',
      dialogueRatio: 0.25,
      metaphorDensity: 'high',
      chapterTitleStyle: '意象式标题',
      notes: '每个场景要有可感知的感官细节；控制形容词堆叠，比喻服务于人物处境。',
    },
    samples: ['屋里有一股旧木头被晒热的气味，她坐在窗边，指腹一遍遍摩挲茶杯的缺口。'],
  },
  {
    id: 'suspense',
    name: '悬疑冷硬',
    description: '信息控制优先，冷硬白描，少解释性旁白。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3000,
      sentenceLength: 'mixed',
      paragraphLength: 'short',
      dialogueRatio: 0.3,
      metaphorDensity: 'low',
      chapterTitleStyle: '短标题',
      notes: '信息通过动作和对白释放；避免提前解释。',
    },
    samples: ['卷宗第三页少了一行字，他知道缺的不是字，是人。'],
  },
  {
    id: 'light',
    name: '轻松日常',
    description: '对白驱动、轻松吐槽，情绪明快。',
    fields: {
      pov: 'first',
      tense: 'past',
      chapterWords: 2500,
      sentenceLength: 'short',
      paragraphLength: 'short',
      dialogueRatio: 0.55,
      metaphorDensity: 'low',
      chapterTitleStyle: '轻快口语化',
      notes: '对白承担主要信息与笑点；避免沉重描写和长段设定说明。',
    },
    samples: ['她把最后一颗丸子夹进他碗里，笑着说：多吃点，吃完好干活。'],
  },
  {
    id: 'ancient',
    name: '古风/仙侠',
    description: '文白相间、意象与礼制细节服务人物，可读性优先。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3000,
      sentenceLength: 'mixed',
      paragraphLength: 'medium',
      dialogueRatio: 0.35,
      metaphorDensity: 'medium',
      chapterTitleStyle: '对仗/古意',
      notes: '避免生僻词堆砌；设定名词首次出现时要让读者从上下文理解。',
    },
    samples: ['山门外的石阶被雨洗得发青，他拾级而上，袖口沾了泥，脚印一个比一个浅。'],
  },
  {
    id: 'guqing',
    name: '古风言情',
    description: '古风背景、重对白与感官描写，情感与欲望并重，节奏张弛有度。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3200,
      sentenceLength: 'mixed',
      paragraphLength: 'medium',
      dialogueRatio: 0.4,
      metaphorDensity: 'medium',
      chapterTitleStyle: '古意短标题（名词/动作短语）',
      notes: '以触觉与视觉为先，嗅觉味觉次之；情感戏写身体反应与细节，不写解说的“心动”；用温度、气味、衣料摩擦等感官细节承托情绪。',
    },
    samples: ['她替他系披风时，指尖擦过喉结，手一抖，活结打成了死结。'],
  },
  {
    id: 'wuxia-hard',
    name: '冷硬江湖',
    description: '江湖武斗与权力倾轧：短打硬桥、招式与伤情具体、少抒情。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3200,
      sentenceLength: 'mixed',
      paragraphLength: 'short',
      dialogueRatio: 0.35,
      metaphorDensity: 'low',
      chapterTitleStyle: '动作短标题',
      notes: '打斗写招式、距离、兵器重量与身体反应（呼吸、汗、伤），不写“剑气纵横”式空泛；武斗结果服从境界与铺垫。',
    },
    samples: ['刀从肩头削下去，血先没出来，过了半息才顺着刀背淌到手腕上。'],
  },
]

export function listStyleTemplates() {
  return STYLE_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    fields: template.fields,
  }))
}

export function findStyleTemplate(templateId) {
  return STYLE_TEMPLATES.find((template) => template.id === templateId)
}

export const PREMISE_SYSTEM_PROMPT = [
  '你是中文小说的策划编辑，擅长把模糊想法变成可执行的题材方案。',
  '只输出 JSON 对象，不要 Markdown 代码围栏，不要解释性文字。',
  '输出格式：{"candidates": [候选对象...]}。',
  '候选对象字段：',
  '- id: string，唯一短标识（如 premise-1）',
  '- title: string，暂定标题，具体、可读，不是卖点或宣传语',
  '- premise: string，2–4 句话的核心故事：主角是谁、原本怎么生活、什么让她不能照旧、这个故事靠什么持续驱动；不是大纲，不写章节',
  '- genre: string[]，题材标签',
  '- protagonist: string，一句话写清主角身份',
  '- length: { chapters: number, wordsPerChapter: number }，建议篇幅',
  '只输出上述字段。',
  'premise 写的是整个故事的核心，不是开头场景，也不是一句话金句；每个候选要有不同的故事驱动力，不能只替换职业或主角名字。',
  '这是多轮构思对话：用户可能基于上一轮候选继续提修改意见。优先保留用户没有要求改变的部分，只改本轮明确提到的内容；不要重复上一轮已经给出的方案。',
].join('\n')

export const PREMISE_INTENT_SYSTEM_PROMPT = [
  '你是构思对话的意图编辑。',
  '只输出 JSON 对象，不要 Markdown 代码围栏。',
  '格式：{"intent":"一段 20–80 字的用户真实意图摘要"}。',
  '从对话历史中提炼用户真正想要的东西，而不是逐字执行最后一句话；把前后要求合并成稳定意图，保留用户明确排斥的东西。',
  '不要写具体候选内容，不要向用户提问。',
].join('\n')

export function buildPremiseUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    `任务：生成 ${input.count} 个差异明显的长篇小说构思候选。`,
  ]
  if (input.genre?.length) lines.push(`题材方向：${input.genre.join('、')}`)
  if (input.audience) lines.push(`目标读者：${input.audience}`)
  if (input.intent) lines.push('【对话意图摘要（优先级高于最后一句的字面要求）】', String(input.intent))
  if (input.chosen) {
    lines.push(`当前已选构思（避免重复）：${JSON.stringify(input.chosen)}`)
  }
  if (input.reference) {
    lines.push(`【本轮基准候选（保留其未被要求修改的部分）】${JSON.stringify(input.reference)}`)
  }
  if (input.history?.length) {
    lines.push('【本轮之前的构思对话（按时间顺序，提取用户意图，不要逐字复述）】')
    for (const message of input.history.slice(-10)) {
      lines.push(`${message.role === 'assistant' ? '助手' : '用户'}：${String(message.content ?? '').slice(0, 1200)}`)
    }
  }
  if (input.instruction) lines.push(`【本轮用户要求】${input.instruction}`)
  lines.push('要求：每个 title 简洁；premise 写 2–4 句话的完整核心故事；length 给出建议章节数与单章字数；只输出 JSON。')
  return lines.join('\n')
}

export const OUTLINE_SYSTEM_PROMPT = [
  '你是中文长篇小说的结构编辑，负责把已确认的构思拆成可执行的章纲。',
  '只输出 JSON 对象，不要 Markdown 代码围栏，不要解释性文字。',
  '输出格式：{"chapters": [章纲对象...]}。',
  '章纲对象字段：',
  '- number: number，章节序号',
  '- title: string，章节标题',
  '- synopsis: string，200–400 字的具体剧情梗概：写清谁在什么处境、做了什么、发生了什么、结果如何；不要拆成目标/冲突/转折/结果等标签；宁可写足细节，不要凑字数或留空',
  '- 长度约束：每章 synopsis 控制在 200–400 字（约 1.5–2 倍差），最多不超过 400 字；一章一段，不要分点。',
  '- wordBudget: number，可选的目标字数',
  '要求：章节序号连续；每章只写一个完整、具体的剧情事件链；与已确认的构思、文风契约、相邻章节保持一致；只输出请求范围内的章节。',
  '章纲是给正文写作的剧情提要，不是谜面，也不要强行套结构：不要用“关系变化”“有事发生”“被卷入”之类空话，也不要为了填字段把剧情拆成抽象分类。',
  '每章 synopsis 的结尾必须落在一个下一章能直接承接的具体状态：人物在哪里、刚做了什么决定或发生了什么；下一章从这个状态继续，不要跳空、不要重复交代。',
  '出场人物、身份和场景状态要前后一致；不要用模糊数量或含糊指代造成前后矛盾。',
  '用户本次额外要求优先于默认结构模板；如果与通用要求冲突，以额外要求为准。',
  '能力体系必须按既定层级推进：不得让角色无铺垫跨级；若本章涉及能力变化，在 synopsis 中写明旧层级→新层级、变化原因与影响。',
  '分卷生成时以【本卷舞台与节奏控制】为准：章节地点必须属于本卷本地地图；不得把新卷写成上一卷地图的加时赛；本地主线收束且主角压过本地战力天花板后，本卷就应结束。',
].join('\n')

export function buildOutlineUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    `任务：${input.regenerate ? '重新生成' : '生成'}第 ${input.fromChapter}–${input.toChapter} 章章纲。`,
  ]
  if (input.instruction) {
    lines.push(
      '',
      '【本次额外要求（优先级最高，必须落实到章节标题或剧情梗概中）】',
      input.instruction,
      '',
    )
  }
  lines.push(
    `全书预计章节数：${input.totalChapters || '未定'}`,
    `单章目标字数：${input.wordBudget}`,
    `已确认构思：${JSON.stringify(input.premise)}`,
    `文风契约：${JSON.stringify(input.styleFields)}`,
  )
  // 通用机制：把文风 notes 原文单独展示，避免被长 JSON 淹没。
  // 具体题材要求由用户写在 notes / 提示词注入 / 本次额外要求里，插件不内置。
  const notes = String(input.styleFields?.notes ?? '').trim()
  if (notes) {
    lines.push('【文风补充要求（来自文风契约 notes，必须遵守）】', notes)
  }
  if (input.writingNotes) {
    lines.push('【项目写作要求（必须遵守）】', String(input.writingNotes))
  }
  if (input.volume) {
    lines.push('【本卷舞台与节奏控制（必须遵守）】')
    lines.push(`卷名：${input.volume.title || '未命名卷'}`)
    lines.push(`本地地图：${input.volume.map || '未设置。必须先根据上一卷结尾和升级目标确定新地图，不得沿用上一卷地图；synopsis 中的地点必须使用新地图。'}`)
    lines.push(`本卷目标：${input.volume.goal || '未设置；由本章纲自行收束成一个完整的本地主线。'}`)
    lines.push(`本地战力天花板：${input.volume.powerCeiling || '未设置；按已确认的战力体系设置本卷上限。'}`)
    lines.push(`离卷条件：${input.volume.exitCriteria || '本地主线收束且主角压过本地战力天花板后，本卷结束并准备下一张地图。'}`)
    lines.push('硬规则：本卷章节只能发生在“本地地图”；不得让主角在本卷中途回到上一卷地图、旧镇子或旧势力范围。只有明确写离卷过渡的章节才能改变地点。本卷结尾必须让本地主线收束，并达到离卷条件。')
  }
  if (input.previousVolume) {
    lines.push('【上一卷收束点（只用于衔接，不得把本卷拉回旧地图）】')
    lines.push(`上一卷：${input.previousVolume.title || '上一卷'}；地图：${input.previousVolume.map || '未设置'}；目标：${input.previousVolume.goal || '—'}`)
    lines.push(`上一卷离卷条件：${input.previousVolume.exitCriteria || '—'}`)
    if (input.previousVolume.lastChapter) {
      const last = input.previousVolume.lastChapter
      lines.push(`上一卷末章：第${last.number}章 ${last.title || ''}；剧情=${last.synopsis || '—'}`)
    }
    lines.push('本卷必须从上一卷末章的离卷结果继续，换到新的本地地图；不要把新章写成上一卷地图里的加时赛。')
  }
  if (input.previousAnchor) {
    const anchor = input.previousAnchor
    lines.push('【上一章落点（下一章必须承接）】')
    lines.push(`第${anchor.number}章 ${anchor.title || ''}`)
    if (anchor.synopsis) lines.push(`计划剧情：${anchor.synopsis}`)
    if (anchor.summary) lines.push(`已写正文摘要：${anchor.summary}`)
    if (anchor.ending) lines.push(`已写正文结尾：${anchor.ending}`)
    lines.push('下一章的 synopsis 必须从这个落点自然继续：人物在同一个地方/同一段行动之后，承接上一章最后的选择、动作或后果；不要跳空、不要重复上一章已经写完的过程。')
  }
  if (input.bible) {
    lines.push('【既有设定（必须遵守）】', JSON.stringify(input.bible))
  }
  if (input.power) {
    lines.push('【能力体系与当前战力（必须遵守，不得无铺垫跨级）】', JSON.stringify(input.power))
  }
  if (input.contextChapters?.length) {
    lines.push('相邻/已有章节摘要（保持衔接）：')
    for (const chapter of input.contextChapters) {
      lines.push(
        `- 第${chapter.number}章 ${chapter.title || ''}：${chapter.synopsis || '—'}`,
      )
    }
  }
  lines.push('章纲只需要写清楚剧情梗概：谁在什么处境、做了什么、发生了什么、结果如何。synopsis 要具体、可读，不要拆成目标/冲突/转折/结果等标签，也不要为了填结构写抽象分类。')
  lines.push('写人物与场景状态时保持一致：出场人数、身份和所在位置要能互相对上，不使用含糊数量或指代。')
  lines.push('只输出 JSON；chapters 数量必须与请求范围一致，序号从起始章连续递增。')
  return lines.join('\n')
}

export const BIBLE_SYSTEM_PROMPT = [
  '你是中文长篇小说的设定编辑。只输出 JSON 对象，不要 Markdown 围栏。',
  '格式：{"characters": [{"name":"","role":"主角/对手/配角","traits":[""],"goal":"","description":""}], "locations": [{"name":"","description":""}], "rules": [{"name":"","description":""}], "factions": [{"name":"","description":""}], "items": [{"name":"","description":""}]}。',
  '要求：',
  '- 角色数量按已确认构思与附加要求确定（3–20 个），必须包含主角、对手和关键配角；若构思要求多女主或群像，则给足相应数量，并让每个重要角色有可辨识的出身与性格；',
  '- 地点至少 3 个，规则至少 2 条，势力和物品按需要给出；',
  '- 每条描述控制在 1–3 句，具体、可执行，能直接约束后续写作；',
  '- 先确定这个世界的日常运行方式、权力/资源结构和禁忌，再让角色、地点、规则互相约束；设定要能直接影响人物选择和情节，不写背景百科；',
  '- 重要角色必须有独立的欲望、底线和说话方式，不要只写“主角/对手/配角”的定位标签；',
  '- 必须同时返回五个分类的数组；即使为空也要保留数组；',
  '- 与已确认的构思、文风和章纲保持一致，不新增与章纲冲突的设定。',
].join('\n')

export function buildBibleUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    '任务：为这部长篇小说建立可执行的角色与世界设定。',
    `已确认构思：${JSON.stringify(input.premise)}`,
    `文风契约：${JSON.stringify(input.styleFields ?? {})}`,
  ]
  if (input.outlineChapters?.length) {
    lines.push('已有章纲摘要：')
    for (const chapter of input.outlineChapters.slice(0, 8)) {
      lines.push(`- 第${chapter.number}章 ${chapter.title || ''}：${chapter.synopsis || '—'}`)
    }
  }
  if (input.instruction) lines.push(`额外要求：${input.instruction}`)
  if (input.writingNotes) lines.push(`【项目写作要求（必须遵守）】${input.writingNotes}`)
  lines.push('只输出 JSON。')
  return lines.join('\n')
}

export const BIBLE_CHARACTERS_SYSTEM_PROMPT = [
  '你是中文长篇小说的人物编辑，只负责角色设定。',
  '只输出 JSON 对象，不要 Markdown 围栏。',
  '格式：{"characters": [{"name":"","role":"主角/对手/配角","traits":[""],"goal":"","description":""}]}。',
  '要求：',
  '- 角色数量按已确认构思与附加要求确定（3–20 个），必须包含主角、对手和关键配角；',
  '- 每个重要角色要有独立的欲望、底线、说话方式和一个会推动情节的选择，不要只写定位标签；',
  '- 描述控制在一到三句，写清身份、与主线的关系、能直接影响剧情的行为倾向；',
  '- 不要输出地点、规则、势力、物品；与已确认构思和章纲保持一致。',
].join('\n')

export function buildBibleCharactersUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    '任务：为这部长篇小说生成角色设定。',
    `已确认构思：${JSON.stringify(input.premise)}`,
    `文风契约：${JSON.stringify(input.styleFields ?? {})}`,
  ]
  if (input.outlineChapters?.length) {
    lines.push('已有章纲摘要：')
    for (const chapter of input.outlineChapters.slice(0, 8)) {
      lines.push(`- 第${chapter.number}章 ${chapter.title || ''}：${chapter.synopsis || '—'}`)
    }
  }
  if (input.instruction) lines.push(`额外要求：${input.instruction}`)
  if (input.writingNotes) lines.push(`【项目写作要求（必须遵守）】${input.writingNotes}`)
  lines.push('只输出 characters 数组对应的 JSON。')
  return lines.join('\n')
}

export const BIBLE_WORLD_SYSTEM_PROMPT = [
  '你是中文长篇小说的世界设定编辑，只负责地点、规则、势力和物品。',
  '只输出 JSON 对象，不要 Markdown 围栏。',
  '格式：{"locations":[{"name":"","description":""}],"rules":[{"name":"","description":""}],"factions":[{"name":"","description":""}],"items":[{"name":"","description":""}]}。',
  '要求：',
  '- 先确定这个世界的日常运行方式、资源与权力结构、禁忌和代价，再写具体地名与条目；',
  '- 设定必须能直接影响人物选择和情节，不写背景百科；',
  '- 地点至少 3 个，规则至少 2 条；势力和物品按需要给出；',
  '- 每条描述一到三句；不要输出角色；与已确认构思和章纲保持一致。',
].join('\n')

export function buildBibleWorldUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    '任务：为这部长篇小说生成地点、规则、势力和物品设定。',
    `已确认构思：${JSON.stringify(input.premise)}`,
    `文风契约：${JSON.stringify(input.styleFields ?? {})}`,
  ]
  if (input.outlineChapters?.length) {
    lines.push('已有章纲摘要：')
    for (const chapter of input.outlineChapters.slice(0, 8)) {
      lines.push(`- 第${chapter.number}章 ${chapter.title || ''}：${chapter.synopsis || '—'}`)
    }
  }
  if (input.instruction) lines.push(`额外要求：${input.instruction}`)
  if (input.writingNotes) lines.push(`【项目写作要求（必须遵守）】${input.writingNotes}`)
  lines.push('只输出 locations / rules / factions / items 四个数组对应的 JSON。')
  return lines.join('\n')
}

export const REVERSE_OUTLINE_SYSTEM_PROMPT = [
  '你是中文小说的反向大纲编辑。',
  '只输出 JSON 对象，不要 Markdown 围栏，不要解释。',
  '格式：{"chapters":[{"number":1,"synopsis":"200–400 字"}]}。',
  '任务：只根据给出的正文，为每一章写剧情梗概，不新增正文里没有的事件、人物或设定。',
  'synopsis 要写清这一章谁在什么处境、做了什么、发生了什么、结果如何；不要拆成目标/冲突/转折/结果等标签，不要写评价或写作建议。',
  '章节序号必须与输入一致；不要改标题；只输出请求范围内的章节。',
].join('\n')

export function buildReverseOutlineUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    `任务：根据正文反推第 ${input.fromChapter}–${input.toChapter} 章的 synopsis。`,
    '【章节正文】',
  ]
  for (const chapter of input.chapters ?? []) {
    lines.push(`## 第${chapter.number}章 ${chapter.title || ''}`)
    lines.push(String(chapter.text ?? '').slice(0, 9000))
  }
  lines.push('只输出 JSON；chapters 数量必须与请求范围一致。')
  return lines.join('\n')
}

export const CHAPTER_SYSTEM_PROMPT = [  '你是中文长篇小说写作助手，负责按章纲写出可直接阅读的正文。',
  '要求：',
  '- 严格贴合章纲的剧情梗概；',
  '- 从具体动作、对话或场景进入，不复述章纲和前情；',
  '- 结尾停在一个人物、动作或决定的具体状态上，让下一章可以直接承接；不要用总结式收束。',
  '- 遵守文风契约中的视角、时态、句长、段落长度、对话占比、禁用词与额外要求；',
  '- 与前文结尾自然衔接，不复述前情；续写时从上一章结尾的场景或动作往后写，禁止重复已经发生的事件、对话和环境描写；',
  '- 只输出正文，不要章节标题、说明、Markdown 代码围栏或分点提纲；',
  '- 不要出现“本章”“下一章”“读者”等元叙述。',
].join('\n')

export function buildChapterUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    `任务：写第 ${input.number} 章《${input.chapter.title || '未命名'}》的正文，目标约 ${input.wordBudget} 字。`,
    '',
    '【章纲】',
    JSON.stringify(input.chapter, null, 2),
    '',
    '【文风契约】',
    JSON.stringify(input.styleFields, null, 2),
  ]
  if (Array.isArray(input.samples) && input.samples.length > 0) {
    lines.push('', '【文风示例（模仿其语感与节奏，不要照抄情节）】', input.samples.slice(0, 3).join('\n\n'))
  }
  if (input.writingNotes) {
    lines.push('', '【项目写作要求（必须遵守）】', String(input.writingNotes))
  }
  if (input.storyContext) {
    const context = input.storyContext
    if (context.premise) {
      lines.push('', '【故事背景（不可违背）】', JSON.stringify(context.premise, null, 2))
    }
    if (context.bible) {
      lines.push('', '【相关设定（必须遵守）】', JSON.stringify(context.bible, null, 2))
    }
    if (context.continuity) {
      lines.push('', '【连续性（最近章节与上一章状态）】', JSON.stringify(context.continuity, null, 2))
    }
    if (context.relations?.length) {
      lines.push('', '【人物关系（本章出场人物相关，必须一致）】', JSON.stringify(context.relations, null, 2))
    }
    if (context.foreshadowing?.length) {
      lines.push('', '【未回收伏笔（本章可择机推进，不必强行全部回收）】', JSON.stringify(context.foreshadowing, null, 2))
      lines.push('如果某条伏笔带有 overdue=true，本章优先安排一次明确推进或回收；不要只把它当背景提一句。')
    }
    if (context.foreshadowingDue?.length) {
      lines.push('', '【本章章纲要求回收的伏笔（必须落实到正文）】', JSON.stringify(context.foreshadowingDue, null, 2))
      lines.push('这些伏笔必须通过具体事件、物件、对话或人物反应回收，让读者能对应到埋设处；不能只在总结句里带过。')
    }
    if (context.timeline?.length) {
      lines.push('', '【时间线】', JSON.stringify(context.timeline, null, 2))
    }
    if (context.notes?.length) {
      lines.push('', '【作者备注（来自讨论结论，优先遵守）】', JSON.stringify(context.notes, null, 2))
    }
  } else {
    if (input.facts?.bible) {
      lines.push('', '【设定上下文（必须遵守）】', JSON.stringify(input.facts.bible, null, 2))
    }
    if (input.facts?.previousState) {
      lines.push('', '【上一章状态快照（用于衔接）】', JSON.stringify(input.facts.previousState, null, 2))
    }
    if (input.previousTail) {
      lines.push('', '【上一章结尾（仅用于衔接，不要复述）】', input.previousTail)
    }
  }
  if (input.instruction) {
    lines.push('', '【本章额外要求】', input.instruction)
  }
  if (input.previousTail || input.storyContext?.continuity?.previousTail) {
    lines.push('', '【续写规则】从上一章结尾的场景或动作往后写；禁止重复上一章已经发生的事件、对话和环境描写，也不要写“接上回”之类的过渡套话。')
  }
  lines.push('', '只输出本章正文。')
  return lines.join('\n')
}

export const PROMPT_CATALOG = [
  {
    key: 'premise',
    label: '构思候选',
    category: '构思',
    description: '生成差异明显的长篇构思卡：标题、核心故事、题材、主角、篇幅。',
    default: PREMISE_SYSTEM_PROMPT,
  },
  {
    key: 'premiseIntent',
    label: '构思意图摘要',
    category: '构思',
    description: '从多轮构思对话提炼稳定的用户意图，再交给候选生成。',
    default: PREMISE_INTENT_SYSTEM_PROMPT,
  },
  {
    key: 'bible',
    label: '角色与设定',
    category: '设定',
    description: '生成角色、地点、规则、势力和物品五类设定。',
    default: BIBLE_SYSTEM_PROMPT,
  },
  {
    key: 'bibleCharacters',
    label: '角色生成',
    category: '设定',
    description: '只生成角色，保留已有地点、规则、势力和物品。',
    default: BIBLE_CHARACTERS_SYSTEM_PROMPT,
  },
  {
    key: 'bibleWorld',
    label: '世界生成',
    category: '设定',
    description: '只生成地点、规则、势力和物品，保留已有角色。',
    default: BIBLE_WORLD_SYSTEM_PROMPT,
  },
  {
    key: 'outline',
    label: '章纲生成',
    category: '大纲',
    description: '按构思、文风、分卷信息和上一章落点生成章纲。',
    default: OUTLINE_SYSTEM_PROMPT,
  },
  {
    key: 'reverseOutline',
    label: '正文反推章纲',
    category: '大纲',
    description: '从已有正文反推每章 synopsis，不新增正文没有的事件。',
    default: REVERSE_OUTLINE_SYSTEM_PROMPT,
  },
  {
    key: 'draft',
    label: '正文草稿',
    category: '正文',
    description: '按章纲、文风、设定和连续性写本章正文。',
    default: CHAPTER_SYSTEM_PROMPT,
  },
  {
    key: 'revise',
    label: '按意见修订',
    category: '正文',
    description: '按用户修订要求改写本章，保留章纲事实与文风。',
    default: CHAPTER_SYSTEM_PROMPT,
  },
  {
    key: 'fix',
    label: '自动修复',
    category: '正文',
    description: '修复规则质检与审校指出的问题，不改变剧情走向。',
    default: CHAPTER_SYSTEM_PROMPT,
  },
]
