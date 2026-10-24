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
  '- logline: string，不超过 40 字的一句话故事',
  '- genre: string[]，题材标签',
  '- hook: string，核心卖点/新鲜感',
  '- protagonist: string，主角身份与欲望',
  '- conflict: string，核心冲突与阻力',
  '- antagonist: string，对手或压力来源',
  '- ending: string，结局方向（不必细化）',
  '- audience: string，目标读者',
  '- length: { chapters: number, wordsPerChapter: number }，建议篇幅',
  '- boundaries: string[]，内容边界/禁忌',
  '- risks: string[]，这个方案可能的问题（用于让用户判断）',
  '候选之间必须在世界观、冲突或主角身份上至少有两处明显差异。',
  '这是多轮构思对话：用户可能基于上一轮候选继续提修改意见。优先保留用户没有要求改变的部分，只改本轮明确提到的内容；不要重复上一轮已经给出的方案。',
].join('\n')

export function buildPremiseUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    `任务：生成 ${input.count} 个差异明显的长篇小说构思候选。`,
  ]
  if (input.genre?.length) lines.push(`题材方向：${input.genre.join('、')}`)
  if (input.audience) lines.push(`目标读者：${input.audience}`)
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
  lines.push('要求：每个 logline 不超过 40 字；length 给出建议章节数与单章字数；只输出 JSON。')
  return lines.join('\n')
}

export const OUTLINE_SYSTEM_PROMPT = [
  '你是中文长篇小说的结构编辑，负责把已确认的构思拆成可执行的章纲。',
  '只输出 JSON 对象，不要 Markdown 代码围栏，不要解释性文字。',
  '输出格式：{"chapters": [章纲对象...]}。',
  '章纲对象字段：',
  '- number: number，章节序号',
  '- title: string，章节标题',
  '- synopsis: string，200–400 字的具体剧情梗概：写清谁在什么处境、做了什么、发生了什么、结果如何；不要拆成目标/冲突/转折/结果等标签',
  '- hook: string，可选的章末钩子',
  '- cast: string[]，可选的出场人物',
  '- place: string，可选的地点',
  '- time: string，可选的故事内时间',
  '- wordBudget: number，可选的目标字数',
  '要求：章节序号连续；每章只写一个完整、具体的剧情事件链；与已确认的构思、文风契约、相邻章节保持一致；只输出请求范围内的章节。',
  '章纲是给正文写作的剧情提要，不是谜面，也不要强行套结构：不要用“关系变化”“有事发生”“被卷入”之类空话，也不要为了填字段把剧情拆成抽象分类。',
  '写人数、身份和在场关系必须精确：明确总人数、谁包含在内、谁不在场、被关在哪里；不要用“几个姑娘”“其中一人”这类模糊复数，造成前后总数不一致。',
  '涉及亲密关系或敏感情节的章节，必须写明人物关系的变化、边界和后果；没有发生就明确写“没有发生”，不要用模糊说法带过，也不要在章纲中写露骨细节。',
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
      '【本次额外要求（优先级最高，必须落实到章节标题、剧情梗概或钩子中）】',
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
    lines.push(`本地地图：${input.volume.map || '未设置。必须先根据上一卷结尾和升级目标确定新地图，不得沿用上一卷地图；第一章的 place 必须使用新地图。'}`)
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
      lines.push(`上一卷末章：第${last.number}章 ${last.title || ''}；地点=${last.place || '—'}；剧情=${last.synopsis || last.outcome || '—'}；钩子=${last.hook || '—'}`)
    }
    lines.push('本卷必须从上一卷末章的离卷结果继续，换到新的本地地图；不要把新章写成上一卷地图里的加时赛。')
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
        `- 第${chapter.number}章 ${chapter.title || ''}：${chapter.synopsis || chapter.outcome || chapter.goal || '—'}`,
      )
    }
  }
  lines.push('章纲只需要写清楚剧情梗概：谁在什么处境、做了什么、发生了什么、结果如何。synopsis 要具体、可读，不要拆成目标/冲突/转折/结果等标签，也不要为了填结构写抽象分类。')
  lines.push('写人数时明确总数和构成：分别列出“在哪里、几人、包含谁”，确保各处人数相加等于总人数；不要前面写一个总数，后面又用模糊复数另算一遍。')
  lines.push('涉及亲密关系或敏感情节时，写清人物关系的变化、边界、主动方和后果；没有发生就明确写“没有发生”；不要打哑谜，也不要写露骨细节。')
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
      lines.push(`- 第${chapter.number}章 ${chapter.title || ''}：${chapter.synopsis || chapter.outcome || chapter.goal || '—'}`)
    }
  }
  if (input.instruction) lines.push(`额外要求：${input.instruction}`)
  if (input.writingNotes) lines.push(`【项目写作要求（必须遵守）】${input.writingNotes}`)
  lines.push('只输出 JSON。')
  return lines.join('\n')
}

export const CHAPTER_SYSTEM_PROMPT = [  '你是中文长篇小说写作助手，负责按章纲写出可直接阅读的正文。',
  '要求：',
  '- 严格贴合章纲的剧情梗概与章末钩子；',
  '- 遵守文风契约中的视角、时态、句长、段落长度、对话占比、禁用词与额外要求；',
  '- 与前文结尾自然衔接，不复述前情；',
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
  lines.push('', '只输出本章正文。')
  return lines.join('\n')
}
