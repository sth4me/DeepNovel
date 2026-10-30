/*
 * 内置文风模板。
 *
 * 每个模板 = 结构化字段（可微调）+ 三档可执行规则（必须贯彻 / 绝对禁止 / 按场景调节）
 * + 2–3 段示例（只作语感锚点，不照抄情节）。
 * 字段会经 formatStyleFields() 渲染成可读文本注入生成提示词，不要写空泛形容词，
 * 每条规则都要能被判定是否违反。
 */
import {
  DESLOP_RULES_TEXT,
  renderBannedWords,
  renderHumanBaseline,
  renderSentencePatterns,
} from './writing-rules.js'
export const STYLE_TEMPLATES = [
  {
    id: 'fast-web',
    name: '快节奏网文',
    group: '网文',
    tags: ['爽文', '都市', '玄幻', '追读'],
    description: '短句直给、事件密集、对白推信息；用手机阅读的节奏写，每段都要推进。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3000,
      sentenceLength: 'short',
      paragraphLength: 'short',
      dialogueRatio: 0.45,
      metaphorDensity: 'low',
      chapterTitleStyle: '短标题（2–6 字，动词或结果）',
      voice: '冷静直白，叙述者不评价、不解释人物动机。',
      diction: '动词与具体名词优先，形容词节制；口语化但不粗俗，不用书面长定语。',
      imagery: '动作、器物、场景功能件；比喻最多一句，不铺排。',
      dialogueStyle: '短句对白，一次不超过三句；少用“说道”，用动作或直接换行代替。',
      pacing: '每 300–500 字推进一个事件；场景切换直接跳，不写过渡段。',
      sensoryFocus: '视觉与动作；听觉次之；嗅觉味觉仅在必要时用。',
      must: [
        '开场 200 字内出现具体冲突、异常或目标',
        '每段至少推进一条信息，删掉不推进的情节',
        '对白承担信息与冲突，描写只做最低限度定位',
        '章末停在具体动作、决定或反转上',
      ],
      never: [
        '用“他感到/他知道/他意识到”直陈情绪',
        '连续两段以上纯心理描写',
        '在对话里解释设定或复述前情',
        '章末总结本章意义或升华',
      ],
      adjust: [
        '打斗段落进一步压短句、拆短段',
        '信息量大的过场用一句话概括后直接跳',
        '感情戏允许放慢一档，但每段仍要有动作',
      ],
      bannedWords: ['仿佛', '犹如', '不禁', '缓缓', '一丝', '一抹', '眼中闪过', '嘴角勾起'],
      bannedPatterns: ['带着…的语气', 'XX说道', '空气中弥漫着', '不由自主地'],
      genreFit: ['都市', '玄幻', '悬疑', '爽文', '追读向'],
      avoidGenre: ['文学向', '散文体'],
      notes: '目标读者用手机读，段落尽量不超过三行；超过两句的解释性文字必须压缩或改写。',
    },
        samples: [
      '电话响到第三声他才接。对面只说了一句：人死了。他抓起外套往外走，鞋跟在地砖上敲出一串急响，到楼下才发现自己还穿着拖鞋。',
      '门是虚掩的。他侧身进去，先看桌，再看窗。桌上那杯水还温着，椅背上搭着一件外套，人却不见了。他没喊，伸手把外套掀开，底下压着一张车票。',
      '“谁先动的手？”他问。对面的人笑了笑，把烟按进烟灰缸：你自己猜。他不再问，拉开椅子坐下，把桌上的牌一张张翻过来。',
    ],
  },
  {
    id: 'literary',
    name: '文学向',
    group: '通用',
    tags: ['文学', '现实', '言情', '氛围'],
    description: '语言质感优先，感官与物象承托情绪；节奏可以慢，但每段必须有具体变化。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3500,
      sentenceLength: 'long',
      paragraphLength: 'medium',
      dialogueRatio: 0.25,
      metaphorDensity: 'high',
      chapterTitleStyle: '意象式短标题（名词或场景）',
      voice: '克制内敛，叙述者有观察力但不评判。',
      diction: '具体名词与精准动词优先；形容词节制；可用书面语，但不堆砌成语。',
      imagery: '日常器物、身体感受、自然细节；一个意象延伸开写，不连用三个以上比喻。',
      dialogueStyle: '对白少而重，潜台词多；用停顿、动作与沉默代替直白回答。',
      pacing: '允许慢，但每段要有可感知的变化（动作、光线、对话、心理位移）。',
      sensoryFocus: '触觉与嗅觉优先，视觉用于定位环境。',
      must: [
        '每个场景至少一处可感知的感官细节（温度、气味、声音、触感）',
        '情绪通过动作与身体反应呈现，不直接命名',
        '比喻服务人物处境，不为漂亮而比喻',
        '场景结束停在具体画面或动作上',
      ],
      never: [
        '形容词与成语堆叠',
        '一段里连用三个以上比喻',
        '“他感到…”式心理直陈',
        '用总结句升华段意',
      ],
      adjust: [
        '抒情段落可放慢，但要有具体物象承托',
        '对话场景可缩短，留白代替解释',
        '转场用物象或声音衔接，不用“第二天”硬切',
      ],
      bannedWords: ['仿佛', '宛如', '不禁', '心潮澎湃', '五味杂陈'],
      bannedPatterns: ['像是…一般', '心中涌起', '说不出的…'],
      genreFit: ['文学', '现实主义', '言情', '悬疑'],
      avoidGenre: ['爽文', '快节奏网文'],
      notes: '语言质感优先，但不能空转：每段必须有一个具体的人、物或动作。',
    },
        samples: [
      '屋里有一股旧木头被晒热的气味。她坐在窗边，指腹一遍遍摩挲茶杯的缺口，缺口磨得发亮，像被谁反复想起过。窗外的光挪了半寸，她的影子也跟着挪了半寸。',
      '雨停得很轻，只在瓦沿留下一线水。他伸手去接，凉意从掌心一直走到手腕，才慢慢散开。院里的泥地吸饱了水，踩下去，脚印边缘慢慢渗出一圈深色。',
      '“你走的时候，把门带上。”她说。声音不高，尾音落在半空，像一句没说完的话。他没应声，站在门口等了一会儿，最后只把门轻轻掩上。',
    ],
  },
  {
    id: 'suspense',
    name: '悬疑冷硬',
    group: '悬疑/网文',
    tags: ['悬疑', '推理', '刑侦', '冷硬'],
    description: '信息控制优先，冷硬白描；线索可回溯，谜底不提前解释。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3000,
      sentenceLength: 'mixed',
      paragraphLength: 'short',
      dialogueRatio: 0.3,
      metaphorDensity: 'low',
      chapterTitleStyle: '短标题（物证或事件）',
      voice: '冷硬克制，叙述者只报事实，不做解释与感慨。',
      diction: '白描；专业或行业词适度使用；少形容词，少副词。',
      imagery: '物证、空间、光线；比喻少且冷。',
      dialogueStyle: '信息藏在对话缝隙里，人物互相试探，话不说完。',
      pacing: '每章至少一个新疑点或新信息；章末留具体钩子。',
      sensoryFocus: '视觉与听觉（脚步、门响、金属）；气味用于异常提示。',
      must: [
        '信息通过动作、对白、物证释放，不用旁白解释',
        '章末留一个未解答的具体问题或动作',
        '人物说谎时给出可观察的行为线索',
        '关键细节在前文出现过一次，读者可回溯',
      ],
      never: [
        '提前解释谜底或人物动机',
        '用“他明白了”跳过推理过程',
        '大段环境描写冲淡节奏',
        '把巧合当作线索',
      ],
      adjust: [
        '审讯/对峙用短句交替推进',
        '追捕段落压到短段短句',
        '揭晓段落允许稍长，但每句都要给新信息',
      ],
      bannedWords: ['仿佛', '似乎', '好像', '一丝', '不易察觉'],
      bannedPatterns: ['他意识到', '直觉告诉他', '空气中弥漫着'],
      genreFit: ['悬疑', '推理', '刑侦', '冷硬'],
      avoidGenre: ['轻松日常', '甜宠'],
      notes: '读者要比人物早半步或晚半步，不能同时什么都不知道；每条线索都要能被指认。',
    },
        samples: [
      '卷宗第三页少了一行字。纸边整齐，不像撕的，倒像从来没印过。他把三页并排对着灯看，光透过去，缺的那行留下极淡的凹痕。他记下位置，又把灯关了。',
      '走廊尽头的灯忽明忽暗。他数着自己的脚步，数到第七步，身后的门响了一声。他没有回头，把手插进口袋，摸到那把钥匙还在。',
      '“那天晚上你在哪儿？”对方问。他想了三秒才回答，这三秒被记进了笔录。记录的人抬头看了他一眼，又低头写字。',
    ],
  },
  {
    id: 'light',
    name: '轻松日常',
    group: '现代',
    tags: ['日常', '轻小说', '校园', '都市'],
    description: '对白驱动、轻快吐槽；笑点来自人物性格与处境错位，不是硬塞段子。',
    fields: {
      pov: 'first',
      tense: 'past',
      chapterWords: 2500,
      sentenceLength: 'short',
      paragraphLength: 'short',
      dialogueRatio: 0.55,
      metaphorDensity: 'low',
      chapterTitleStyle: '轻快口语化（一句吐槽或短语）',
      voice: '轻快、带自我吐槽，叙述者与读者站同一战线。',
      diction: '口语、生活词；网络语适度，避免过时梗；语气词少量。',
      imagery: '生活细节、食物、家居；比喻轻巧、就地取材。',
      dialogueStyle: '对白驱动、节奏快、互相打岔；每句不超过两句。',
      pacing: '场景短，靠对话与反应推进；一个小事件即可成章。',
      sensoryFocus: '味觉、触觉、声音。',
      must: [
        '每章至少一个笑点或反差',
        '对白承担主要信息量',
        '人物吐槽有各自口径，不能人人同一语气',
        '日常事件要有具体动作链',
      ],
      never: [
        '沉重抒情或大段心理描写',
        '长篇设定说明',
        '为搞笑让人物降智',
        '结尾强行升华',
      ],
      adjust: [
        '群像场景多用短对白交替',
        '情绪转场可先写一段安静描写再起笑点',
      ],
      bannedWords: ['不禁', '忍不住', '噗嗤'],
      bannedPatterns: ['他无奈地笑了笑', '众人哄堂大笑'],
      genreFit: ['日常', '轻小说', '校园', '都市'],
      avoidGenre: ['正剧', '虐文', '恐怖'],
      notes: '轻松不等于没逻辑：笑点要能追溯到人物性格或处境。',
    },
        samples: [
      '她把最后一颗丸子夹进他碗里：多吃点，吃完好干活。他看了看碗，又看了看她：这活是搬砖还是搬你？她筷子一停，把丸子又夹了回去。',
      '闹钟响到第五遍，他终于伸手按掉，然后翻个身，把“今天一定早起”这句话又说了一遍。说完自己也笑了，笑得枕头都塌下去一块。',
      '“我决定从今天开始健身。”“你昨天也这么说。”“昨天是预热。”“那前天呢？”“前天是市场调研。”',
    ],
  },
  {
    id: 'ancient',
    name: '古风/仙侠',
    group: '古风',
    tags: ['仙侠', '武侠', '古言', '玄幻'],
    description: '文白相间、从容不炫技；设定靠上下文自然交代，可读性优先。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3000,
      sentenceLength: 'mixed',
      paragraphLength: 'medium',
      dialogueRatio: 0.35,
      metaphorDensity: 'medium',
      chapterTitleStyle: '对仗或古意短语（3–7 字）',
      voice: '文白相间、从容；叙述者不炫技、不跳出来解释。',
      diction: '半文半白，名词具体；少生僻字与自造词；四字成语节制。',
      imagery: '山水、器物、天象；意象服务人物处境，不做风景陈列。',
      dialogueStyle: '对白有分寸与礼数，称呼一致；避免现代口语。',
      pacing: '场景与心境交替，允许过渡，但每段都要有信息。',
      sensoryFocus: '视觉与触觉（风、雨、衣料、温度）。',
      must: [
        '设定名词首次出现时让读者从上下文理解',
        '称呼、礼数、身份等级前后一致',
        '打斗或施法写具体动作与代价',
        '章末落在人物处境或决定上',
      ],
      never: [
        '生僻词与四字成语堆砌',
        '现代口语（“搞定”“没问题”）',
        '“剑气纵横”“天地变色”式空泛描写',
        '用诗句代替叙事',
      ],
      adjust: [
        '对话可略文、叙述可略白，二者不能反过来',
        '打斗段落缩短句长',
        '抒情段落可用景语，但必须有人物视角',
      ],
      bannedWords: ['宛如', '仿若', '不禁', '心头一震'],
      bannedPatterns: ['剑气纵横', '天地变色', '不由得'],
      genreFit: ['仙侠', '武侠', '古言', '玄幻'],
      avoidGenre: ['现代都市', '科幻'],
      notes: '可读性优先：宁可白话一点，也不要让读者查字典。',
    },
        samples: [
      '山门外的石阶被雨洗得发青。他拾级而上，袖口沾了泥，脚印一个比一个浅，到第三十七级时停住——那里有一道新刻的剑痕。',
      '茶已经凉了。她仍端着，指尖扣着盏沿，听廊下风铃响过三遍，才把茶放下。窗纸透进来的光落在他空着的座位上，一点一点移过去。',
      '“师兄此去，几时回来？”他答：等山上的雪化。说完把剑往肩上一扛，头也不回地下山去了。',
    ],
  },
  {
    id: 'guqing',
    name: '古风言情',
    group: '古风',
    tags: ['古言', '言情', '宫斗', '情感'],
    description: '细腻贴身、情绪压在水面下；靠身体反应与留白写情，不靠形容词。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3200,
      sentenceLength: 'mixed',
      paragraphLength: 'medium',
      dialogueRatio: 0.4,
      metaphorDensity: 'medium',
      chapterTitleStyle: '古意短标题（名词或动作短语）',
      voice: '细腻贴身，情绪压在水面下，叙述者不替人物说破。',
      diction: '触觉与温度词多；称谓与身份严格一致。',
      imagery: '衣料、体温、气味、光线；以身体距离的变化承托关系。',
      dialogueStyle: '话不说透，靠停顿与动作补足；称呼变化暗示关系变化。',
      pacing: '情感节点密集、事件推进慢；每章一次关系的细微位移。',
      sensoryFocus: '触觉优先，嗅觉次之，视觉用于定位。',
      must: [
        '情绪写身体反应（手抖、呼吸、体温），不写“心动”',
        '每章至少一次关系的细微变化',
        '亲密戏靠细节与留白，不靠形容词',
        '称呼、身份、礼数前后一致',
      ],
      never: [
        '直陈“心跳加速”“小鹿乱撞”',
        '用旁白解释人物心思',
        '现代词汇（“氛围感”“拿捏”）',
        '情感推进跳级',
      ],
      adjust: [
        '暧昧段落放慢，动作分解到指尖与呼吸',
        '冲突段落缩短句长',
        '亲密场景按尺度调节描写深度',
      ],
      bannedWords: ['心动', '小鹿乱撞', '心跳加速', '不禁'],
      bannedPatterns: ['他的眼神深邃', '她脸红了', '气氛暧昧'],
      genreFit: ['古言', '言情', '宫斗'],
      avoidGenre: ['硬科幻', '冷硬悬疑'],
      notes: '情感靠“想做又没做”的张力，不靠形容词堆。',
    },
        samples: [
      '她替他系披风时，指尖擦过喉结，手一抖，活结打成了死结。他低头看她，没说话，只抬手把结解开，又重新递回她手里。',
      '炭盆里的火将熄未熄。她把他的外袍叠好，放在离自己最近的位置，又挪开半寸。门外有脚步声经过，她立刻把手收了回来。',
      '“你冷么？”他问。她摇头，把手往袖里又缩了缩。他把手炉往她那边推了推，她没接，只把手炉边的灰拨平了。',
    ],
  },
  {
    id: 'wuxia-hard',
    name: '冷硬江湖',
    group: '古风',
    tags: ['武侠', '江湖', '权谋'],
    description: '江湖武斗与利益倾轧：短打硬桥、伤情具体、少抒情，残酷落在具体损失上。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3200,
      sentenceLength: 'mixed',
      paragraphLength: 'short',
      dialogueRatio: 0.35,
      metaphorDensity: 'low',
      chapterTitleStyle: '动作短标题（4–8 字）',
      voice: '冷、干脆，叙述者不抒情、不替人物开脱。',
      diction: '兵器、招式、伤情、钱粮的具体词；不用雅化说法。',
      imagery: '血、铁、雨、夜；比喻少而硬。',
      dialogueStyle: '短、硬、带江湖切口；少解释，多试探与条件。',
      pacing: '打斗写过程与代价；非打斗段落推进利益与立场变化。',
      sensoryFocus: '触觉（痛、冷、湿）与听觉（金属、脚步）。',
      must: [
        '打斗写距离、兵器重量、身体反应与伤情',
        '胜负服从境界与铺垫，不靠爆发',
        '每章推进一次利益或立场变化',
        '江湖规矩与人情要具体到能执行',
      ],
      never: [
        '“剑气纵横”式空泛描写',
        '无铺垫的越级取胜',
        '打斗中长篇心理独白',
        '抒情收尾',
      ],
      adjust: [
        '一对多拆成几个短回合',
        '对峙段落用沉默与动作代替对白',
        '伤后写具体影响（握不住刀、走路跛）',
      ],
      bannedWords: ['剑气纵横', '天地变色', '不由分说', '电光石火'],
      bannedPatterns: ['一刀劈下', '势不可挡', '快如闪电'],
      genreFit: ['武侠', '江湖', '权谋'],
      avoidGenre: ['轻松日常', '甜宠'],
      notes: '江湖的残酷要落在具体损失上：钱、伤、人命、名声。',
    },
        samples: [
      '刀从肩头削下去，血先没出来，过了半息才顺着刀背淌到手腕上。他握刀的手松了一下，又握紧，退半步，把左肩让到墙那边。',
      '雨里三个人。他数着对方的呼吸，最左边那个呼吸短，伤在肋下。他从靴筒里摸出一枚铜钱，弹在地上，三个人同时低头。',
      '“这条街，谁的？”对方问。他把断刀往地上一插：现在是我的。对方看了看刀，又看了看他的手，没再说话。',
    ],
  },
  {
    id: 'scifi',
    name: '科幻硬核',
    group: '科幻',
    tags: ['科幻', '赛博', '末世'],
    description: '冷静精确、概念落地；质感来自技术限制与代价，不靠术语堆砌。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 3200,
      sentenceLength: 'mixed',
      paragraphLength: 'medium',
      dialogueRatio: 0.3,
      metaphorDensity: 'low',
      chapterTitleStyle: '概念或事件短标题（4–8 字）',
      voice: '冷静精确，叙述者像观察者，不惊叹技术。',
      diction: '技术名词准确；术语首次出现时用功能或代价解释，不用形容词搪塞。',
      imagery: '机械、光、数据、城市结构；意象服务于限制感。',
      dialogueStyle: '信息密度高，人物按专业口径说话；少情绪化台词。',
      pacing: '概念与事件交替；每章一个技术或社会细节落地。',
      sensoryFocus: '视觉（光、界面）与听觉（机械、警报）。',
      must: [
        '技术设定自洽，给出代价与限制',
        '每章至少一个“高科技低生活”的具体细节',
        '概念通过人物使用呈现，不写说明书',
        '社会结构影响人物选择',
      ],
      never: [
        '用“量子”“纳米”当万能解释',
        '大段设定说明',
        '披科幻皮的玄幻（力量无科技逻辑）',
        '技术解决一切冲突',
      ],
      adjust: [
        '技术说明拆到人物操作里',
        '灾难或战斗段落压短句',
        '思辨段落允许长句，但要有具体场景',
      ],
      bannedWords: ['不可思议', '难以想象', '震撼'],
      bannedPatterns: ['科技的伟大', '人类的未来', '仿佛整个宇宙'],
      genreFit: ['科幻', '赛博', '末世'],
      avoidGenre: ['古风', '仙侠'],
      notes: '科幻的质感来自限制：技术能做什么、代价是什么、谁承担。',
    },
        samples: [
      '楼顶的广告屏在雨里闪，光把水洼照成一片一片的紫。他摘下义眼擦了擦，装回去，世界的噪点少了些。街对面的清洁机还在响，扫不完的水。',
      '舱门的压力读数跳到红色。她按住手动阀，掌心能感到金属的震动，一下，两下，像心跳。广播里在重复同一句话，她已经听不清了。',
      '“这是第几代？”他问。技术员看了看手里的编号：第五代。前四代都没活过三个月。他把编号记下来，又划掉，改成第五代。',
    ],
  },
  {
    id: 'urban',
    name: '都市现实',
    group: '现代',
    tags: ['都市', '现实', '职场', '情感'],
    description: '平实带疲惫的幽默；冲突来自现实压力（钱、工作、关系），选择都有代价。',
    fields: {
      pov: 'third-limited',
      tense: 'past',
      chapterWords: 2800,
      sentenceLength: 'mixed',
      paragraphLength: 'medium',
      dialogueRatio: 0.45,
      metaphorDensity: 'low',
      chapterTitleStyle: '生活化短语（4–10 字）',
      voice: '平实，带一点疲惫的幽默；不评判人物选择。',
      diction: '当代都市词汇（通勤、房租、加班），职业细节具体。',
      imagery: '城市空间（地铁、写字楼、出租屋）、食物、屏幕。',
      dialogueStyle: '日常口语，话里有话；职场对话有层级感。',
      pacing: '以生活事件推进，冲突来自现实压力，不靠巧合。',
      sensoryFocus: '视觉（光、屏幕）与听觉（城市噪音）。',
      must: [
        '冲突来自现实压力（钱、工作、关系），不靠巧合',
        '职业与生活细节准确',
        '人物的选择要有代价',
        '对话能听出身份差异',
      ],
      never: [
        '悬浮的豪门/霸总设定（除非题材明确需要）',
        '用巧合解决困境',
        '说教式旁白',
        '把现实写成爽文',
      ],
      adjust: [
        '职场场景多用短对白与潜台词',
        '家庭场景放慢，写生活细节',
        '低谷段落允许沉默与留白',
      ],
      bannedWords: ['不禁', '仿佛', '五味杂陈'],
      bannedPatterns: ['他深吸一口气', '生活就是这样', '成年人的世界'],
      genreFit: ['都市', '现实', '职场', '情感'],
      avoidGenre: ['仙侠', '玄幻'],
      notes: '真实感来自具体：工资多少、几点下班、房租占收入几成。',
    },
        samples: [
      '地铁到站时，他被人流推着出去。手机震了一下，是房东：这个月房租涨两百。他站在站台上，把这条消息看了三遍，然后回了一个“好”。',
      '加班到十一点，写字楼只剩他们这一层亮着。她把外卖盒推给他：你先吃，我改完这版。他打开盒子，发现是两份。',
      '“这活我接。”他说。对面的主管抬头看他：你确定？他点头，手在桌下把简历捏皱了。散会后他把简历抚平，又塞回包里。',
    ],
  },
]

const STYLE_POV_LABELS = { 'third-limited': '第三人称限知', first: '第一人称', 'third-omniscient': '第三人称全知' }
const STYLE_TENSE_LABELS = { past: '过去时', present: '现在时' }
const STYLE_SENTENCE_LABELS = { short: '短句为主', mixed: '长短混合', long: '长句为主' }
const STYLE_PARAGRAPH_LABELS = { short: '短段为主', medium: '中等段落', long: '长段为主' }
const STYLE_DENSITY_LABELS = { low: '低', medium: '中', high: '高' }

const styleText = (value) => (typeof value === 'string' ? value.trim() : '')
const styleList = (value) => (Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [])

/**
 * 把文风契约字段渲染成可读文本，注入生成/审校提示词。
 * 结构化 JSON 对模型不友好（转义、无层次），这里按「基础 → 语言 → 对白节奏 → 三档规则 → 禁忌 → 题材」分行。
 */
export function formatStyleFields(fields, options = {}) {
  if (!fields || typeof fields !== 'object') return '（未设置文风契约）'
  const lines = []
  const pov = STYLE_POV_LABELS[fields.pov] ?? styleText(fields.pov)
  const tense = STYLE_TENSE_LABELS[fields.tense] ?? styleText(fields.tense)
  if (pov || tense) lines.push(`【视角与时态】${[pov, tense].filter(Boolean).join('，')}`)
  const basic = []
  if (Number(fields.chapterWords) > 0) basic.push(`单章约 ${Number(fields.chapterWords)} 字`)
  if (STYLE_SENTENCE_LABELS[fields.sentenceLength]) basic.push(STYLE_SENTENCE_LABELS[fields.sentenceLength])
  else if (styleText(fields.sentenceLength)) basic.push(styleText(fields.sentenceLength))
  if (STYLE_PARAGRAPH_LABELS[fields.paragraphLength]) basic.push(STYLE_PARAGRAPH_LABELS[fields.paragraphLength])
  if (Number.isFinite(Number(fields.dialogueRatio))) basic.push(`对白约占 ${Math.round(Number(fields.dialogueRatio) * 100)}%`)
  if (STYLE_DENSITY_LABELS[fields.metaphorDensity]) basic.push(`比喻密度${STYLE_DENSITY_LABELS[fields.metaphorDensity]}`)
  if (basic.length) lines.push(`【篇幅与节奏参数】${basic.join('；')}`)
  const voice = styleText(fields.voice)
  const diction = styleText(fields.diction)
  if (voice) lines.push(`【叙述声音】${voice}`)
  if (diction) lines.push(`【用词偏好】${diction}`)
  const imagery = styleText(fields.imagery)
  if (imagery) lines.push(`【意象与比喻】${imagery}`)
  const sensory = styleText(fields.sensoryFocus)
  if (sensory) lines.push(`【感官侧重】${sensory}`)
  const dialogue = styleText(fields.dialogueStyle)
  if (dialogue) lines.push(`【对白写法】${dialogue}`)
  const pacing = styleText(fields.pacing)
  if (pacing) lines.push(`【节奏与信息密度】${pacing}`)
  const must = styleList(fields.must)
  const never = styleList(fields.never)
  const adjust = styleList(fields.adjust)
  if (must.length) lines.push('【必须贯彻】', ...must.map((item) => `- ${item}`))
  if (never.length) lines.push('【绝对禁止】', ...never.map((item) => `- ${item}`))
  if (adjust.length) lines.push('【按场景调节】', ...adjust.map((item) => `- ${item}`))
  const bannedWords = styleList(fields.bannedWords)
  if (bannedWords.length) lines.push(`【禁用词】${bannedWords.join('、')}`)
  const bannedPatterns = styleList(fields.bannedPatterns)
  if (bannedPatterns.length) lines.push('【禁用句式】', ...bannedPatterns.map((item) => `- ${item}`))
  const title = styleText(fields.chapterTitleStyle)
  if (title) lines.push(`【章节标题】${title}`)
  const genreFit = styleList(fields.genreFit)
  if (genreFit.length) lines.push(`【适用题材】${genreFit.join('、')}`)
  const avoidGenre = styleList(fields.avoidGenre)
  if (avoidGenre.length) lines.push(`【不适用题材】${avoidGenre.join('、')}`)
  const notes = styleText(fields.notes)
  if (notes && options.skipNotes !== true) lines.push(`【额外要求】${notes}`)
  return lines.length ? lines.join('\n') : '（未设置文风契约）'
}

export function listStyleTemplates() {
  return STYLE_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    group: template.group ?? '通用',
    tags: Array.isArray(template.tags) ? template.tags : [],
    description: template.description,
    fields: template.fields,
    samples: Array.isArray(template.samples) ? template.samples : [],
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
  '分卷生成时以【本卷阶段控制】为准：本卷章节只能发生在“本卷舞台”（按题材：武侠/修真用地图，言情用场所与关系阶段，悬疑用案发地与调查范围）；本卷阶段目标达成、舞台迁移、主要对手更替或大事件收束，任一满足即可结束本卷并留钩子；战力天花板只是武侠/修真题材的可选参考，不要求每卷升级；每卷 8–12 章是参考，不是硬性章数。',
  '分卷标记：只有当本章是“阶段收束章”（阶段目标达成、大事件收束、主要对手更替或舞台迁移）时，才在该章对象里加 "volumeEnd": true；其余章不加。不要为了凑章数强行标记收束；也不要在 12 章后仍不收束却继续原地打转。',
  'synopsis 写法：synopsis 是给正文用的结构说明，不是正文；用平实、明确的叙述写清时间/地点、本章谁要做什么、起因与冲突如何推进、结果、结尾状态、下一章钩子；不要用半文半白的文风，不要写对话台词，不要写场面细节的完整过程；场景要点只标类型、对象、方式、篇幅要求，细节留给正文发挥。',
  '文风契约与 notes 只约束正文，不约束 synopsis 的写法（不要因为文风契约把 synopsis 写成半文半白）。',
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
    `文风契约：\n${formatStyleFields(input.styleFields, { skipNotes: true })}`,
  )
  // 通用机制：把文风 notes 原文单独展示，避免被长 JSON 淹没。
  // 具体题材要求由用户写在 notes / 提示词注入 / 本次额外要求里，插件不内置。
  // notes 只约束正文；synopsis 按结构写，不模仿语体（见 system 的 synopsis 写法）。
  const notes = String(input.styleFields?.notes ?? '').trim()
  if (notes) {
    lines.push('【文风补充要求（仅约束正文，synopsis 不模仿其语体）】', notes)
  }
  if (input.writingNotes) {
    lines.push('【项目写作要求（必须遵守）】', String(input.writingNotes))
  }
  if (input.volume) {
    lines.push('【本卷阶段控制（必须遵守）】')
    lines.push(`卷名：${input.volume.title || '未命名卷'}`)
    lines.push(`本卷舞台（地图/场所/关系阶段，按题材设定）：${input.volume.map || '未设置；武侠/修真用地图，言情用场所与关系阶段，悬疑用案发地与调查范围。本卷 synopsis 的地点/场所必须属于本卷舞台，不得中途回到上一卷舞台。'}`)
    lines.push(`本卷阶段目标：${input.volume.goal || '未设置；由本章纲自行收束成一个完整的阶段事件。'}`)
    if (input.volume.powerCeiling) {
      lines.push(`本地战力参考（仅武侠/修真题材适用）：${input.volume.powerCeiling}`)
    }
    lines.push(`离卷条件：${input.volume.exitCriteria || '阶段目标达成、舞台迁移、主要对手更替或大事件收束，任一满足即可结束本卷；不要求战力提升，也不要求每卷换地图。'}`)
    lines.push(`本卷章数：约 ${input.volume.targetChapters || 10} 章（参考值，不是硬性章数；阶段收束优先）`)
    lines.push('硬规则：本卷章节只能发生在“本卷舞台”；中途不得回到上一卷舞台；只有明确写离卷过渡的章节才能迁移舞台。')
  }
  if (input.previousVolume) {
    lines.push('【上一卷收束点（只用于衔接，不得把本卷拉回旧舞台）】')
    lines.push(`上一卷：${input.previousVolume.title || '上一卷'}；舞台：${input.previousVolume.map || '未设置'}；阶段目标：${input.previousVolume.goal || '—'}`)
    lines.push(`上一卷离卷条件：${input.previousVolume.exitCriteria || '—'}`)
    if (input.previousVolume.lastChapter) {
      const last = input.previousVolume.lastChapter
      lines.push(`上一卷末章：第${last.number}章 ${last.title || ''}；剧情=${last.synopsis || '—'}`)
    }
    lines.push('本卷必须从上一卷末章的离卷结果继续：可以换舞台，也可以在同一舞台进入新的关系/案件阶段；不要把新章写成上一卷事件的重复加时赛。')
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
  lines.push('章纲只需要写清楚剧情梗概：谁在什么处境、做了什么、发生了什么、结果如何。synopsis 要具体、可读，不要拆成目标/冲突/转折/结果等标签，也不要为了填结构写抽象分类。每章 synopsis 控制在 200–400 字（最多不超过 400 字），一章一段，不要分点。')
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
    `文风契约：\n${formatStyleFields(input.styleFields ?? {})}`,
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
    `文风契约：\n${formatStyleFields(input.styleFields ?? {})}`,
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
    `文风契约：\n${formatStyleFields(input.styleFields ?? {})}`,
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
  '- 遵守文风契约中的视角、时态、句长、段落、对白、感官侧重、禁用词、三档规则（必须贯彻/绝对禁止/按场景调节）与额外要求；',
  '- 与前文结尾自然衔接，不复述前情；续写时从上一章结尾的场景或动作往后写，禁止重复已经发生的事件、对话和环境描写；',
  '- 只输出正文，不要章节标题、说明、Markdown 代码围栏或分点提纲；',
  '- 不要出现“本章”“下一章”“读者”等元叙述。',
].join('\n')

/**
 * 把技法卡片格式化为提示词段（最多 2 张，正文原样带入）。
 * 返回空串表示没有卡片，调用方据此决定是否追加。
 */
export function formatCraftCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return ''
  const lines = ['【写作技法参考（按需，不必全部套用）】']
  for (const card of cards.slice(0, 2)) {
    if (!card || typeof card !== 'object') continue
    lines.push('', `### ${card.title ?? card.id ?? '技法'}`, String(card.body ?? ''))
  }
  return lines.join('\n')
}

export const CRAFT_AGENT_HINT = [
  '写正文、修订或修复前，如果涉及具体场景类型（打斗、对白、情绪、伏笔、转场、开篇、节奏），可先调 novel_craft action=recommend（带 task/instruction）取 1–2 张推荐卡片，或 action=read id=... 读取完整技法。',
  '技法卡片是通用写作方法，不是本书设定，不必全部套用；与章纲、文风契约冲突时以章纲和文风契约为准。',
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
    formatStyleFields(input.styleFields),
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
      lines.push('', '【作者备注（历史记录，优先遵守）】', JSON.stringify(context.notes, null, 2))
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

export const INSPIRATION_SYSTEM_PROMPT = [
  '你是中文小说的灵感助手。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"ideas":[{"title":"点子名","hook":"一句话钩子","scene":"具体场景/桥段（2–3 句）","note":"可用在哪个阶段/注意什么"}]}。',
  '要求：点子具体、可执行，避免空泛；与已确认构思和文风不冲突；不要写正文。',
  '这是多轮灵感对话：用户可能基于上一轮点子继续提修改意见，优先保留没有被要求改变的部分。',
].join('\n')

export const DECONSTRUCT_SYSTEM_PROMPT = [
  '你是中文小说的拆书编辑。只输出 JSON，不要 Markdown 围栏。',
  '格式：{"summary":"故事梗概（200字内）","style":{"genre":[],"tone":"","notes":""},"characters":[{"name":"","role":"","description":""}],"hooks":["可复用桥段/钩子"]}。',
  '只根据给定文本提炼，不要编造文本中没有的设定；人物以文本为准。',
].join('\n')

export const DECONSTRUCT_STRUCTURE_SYSTEM_PROMPT = [
  '你是中文小说的结构拆解编辑，负责把文本切成有意义的段落/章节单元。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"summary":"故事梗概（200字内）","units":[{"index":1,"span":"该单元在文本中的起始标记（首句或关键短语）","summary":"60–120字，只写该单元里发生的事","function":"开场|铺垫|冲突|转折|高潮|收束|钩子"}]}。',
  '单元按文本顺序编号，一个单元对应一次完整的场景或事件，不要按字数平均切分；function 从中选最贴近的一个。',
  'summary 只写文本中实际发生的事，不推测后文，不编造文本没有的人物或设定，不评价文笔。',
].join('\n')

export const DECONSTRUCT_CHARACTERS_SYSTEM_PROMPT = [
  '你是中文小说的人物与设定拆解编辑。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"characters":[{"name":"","role":"","description":"","traits":[],"goal":""}],"settings":{"locations":[],"rules":[],"factions":[],"items":[]},"relations":[{"from":"","to":"","type":"","note":""}]}。',
  '人物名、地名、组织名一律以文本为准，文本没有提到的不要补；traits 用文本里可验证的行为或描述归纳 2–6 个。',
  '只输出文本中出现的设定；relations 只写文本能证明的关系，note 说明依据。不评价文笔。',
].join('\n')

export const DECONSTRUCT_TECHNIQUE_SYSTEM_PROMPT = [
  '你是中文小说的技法拆解编辑，负责提炼可复用的写法与钩子，不做文风评价。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"hooks":["可复用桥段/钩子"],"techniques":[{"name":"技法名","how":"可执行做法","example":"文本中的简短例子（≤60字，不整段复制）"}],"pacing":"节奏观察（100字内）"}。',
  'techniques 给 3–6 条，每条 how 写成别的作者能照着做的步骤，不要空泛形容；example 摘文本里一句或一个动作，不要整段复制。',
  '只依据给定文本，不编造文本没有的内容，不评价文笔好坏。',
].join('\n')

export const STYLE_AUDIT_SYSTEM_PROMPT = [
  '你是中文小说的风格审稿人，专门识别“AI 味”。只输出 JSON，不要 Markdown 围栏。',
  '格式：{"score": 0-100, "summary": "一句话总评", "aiFlavor": {"level": "轻|中|重", "score": 0-100, "markers": [{"type": "禁用词|句式|结构|节奏", "quote": "原文片段", "word": "命中词"}]}, "issues": [{"category": "AI味|套话|解释过度|情绪告知|句式模板|对话不自然|总结式叙述|空洞比喻|节奏问题|文风契约", "severity": "low|medium|high", "quote": "原文片段", "advice": "具体怎么改"}]}。',
  'score 与 aiFlavor.score 都是 0-100，越高越像人写；aiFlavor.level：80 以上「轻」、60–79「中」、60 以下「重」。',
  '按下面的 AI 指纹清单逐项检查，命中就写进 markers（并作为 AI味 issue 报出）：',
  `1) 一级禁用词：${renderBannedWords()}。`,
  `2) AI 句式：${renderSentencePatterns()}。`,
  '3) 结构指纹：章末总结/升华/伏笔预告收束；每段 4–6 句且长度均匀；几乎每句对话都带“说道”；抽象情绪直述；解释过度；面面俱到无留白。',
  `4) 真人基准对照：${renderHumanBaseline()}。`,
  '5) 若给了文风契约，先按契约检查：违反【绝对禁止】或【必须贯彻】的必须报（category 用「文风契约」并引用原文片段）；命中禁用词/禁用句式的一律报 high。',
  '只报确实影响阅读的问题；同一类问题合并成一条，不要逐段罗列；同一段落最多报一条；没有就返回空数组。',
  'severity 标准：high=明显 AI 味/套话/解释过度/节奏崩坏，必须改；medium=建议改；low=可选润色。',
  '如果整体达到可读标准，issues 返回空数组；score 按整体质量给分，不要因为存在 low 级问题就压低。',
].join('\n')

export const CHAPTER_REVIEW_SYSTEM_PROMPT = [
  '你是中文长篇小说的统一审校编辑，同时检查文风问题（含 AI 味）和连续性冲突。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"score":0-100,"summary":"一句话总评","aiFlavor":{"level":"轻|中|重","score":0-100,"markers":[{"type":"禁用词|句式|结构|节奏","quote":"原文片段","word":"命中词"}]},"styleIssues":[{"category":"AI味|套话|解释过度|情绪告知|句式模板|对话不自然|总结式叙述|空洞比喻|节奏问题","severity":"low|medium|high","quote":"原文片段","advice":"具体怎么改"}],"continuityIssues":[{"level":"warn|error","message":"具体冲突","chapter":前文章节号,"advice":"怎么改"}]}。',
  `AI 味检测：一级禁用词（${renderBannedWords()}）；AI 句式（${renderSentencePatterns()}）；结构指纹（章末总结/升华/伏笔预告收束、段落长度均匀、抽象情绪直述、解释过度）。`,
  '真人基准对照：段落 1–3 句为主；对话 60% 以上无标签；情绪用动作展示；生活化比喻；省略留白；章尾用动作/对话收束。',
  '文风问题只报确实影响阅读的；同类合并，同一段最多一条；没有就返回空数组。',
  '连续性判断：只报告能从前文摘要、章纲和设定中证明的矛盾——时间线、人物位置/状态、因果链、伏笔、设定、能力层级；没有就返回空数组。',
  '不要因为题材或关系尺度本身判问题；不要评价题材偏好。',
].join('\n')

export const DESLOP_SYSTEM_PROMPT = [
  '你是中文网文的“去 AI 味”改写编辑。只输出 JSON，不要 Markdown 围栏。',
  '格式：{"text": "改写后全文", "changes": [{"from": "原文片段", "to": "改写后片段", "reason": "禁用词|句式|结构|节奏|情绪告知|对话标签|书面腔|章末升华"}]}。',
  DESLOP_RULES_TEXT,
  'changes 只列实际改动（最多 30 条），from/to 各取原文/改文中最短可定位片段。',
].join('\n')

export const REVISION_LEARN_SYSTEM_PROMPT = [
  '你是中文小说编辑，负责分析作者从草稿到定稿的修改，提炼可复用的写作偏好。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"summary":"一句话总评","preferences":[{"dimension":"删减|补充|句式|节奏|对白|情绪|用词|结构","observation":"作者稳定偏好","evidence":"修改证据（简短）","rule":"可执行规则"}],"stats":{"chapters":N,"addedChars":N,"removedChars":N}}。',
  '规则：',
  '- 只依据给定的差异证据，不编造；不确定就不写。',
  '- 偏好要稳定：同一类修改出现至少 2 次才写，单次偶然修改忽略。',
  '- rule 写成可执行条目（例：「删掉解释性心理描写，保留动作」），不要空泛形容。',
  '- 最多 8 条；证据不足时 preferences 返回空数组。',
  '- summary 用一句话概括作者的改稿倾向。',
].join('\n')

export const SUMMARY_SYSTEM_PROMPT = [
  '你是小说编辑，负责维护长篇连续性摘要。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"summary":"150-250字客观摘要","characters":["出场人物"],"events":["关键事件"],"openThreads":["未解决线索"]}。',
  '只写正文中实际发生的内容，不评价文笔，不剧透后文，不编造未出现的信息。',
].join('\n')

export const CONTINUITY_SYSTEM_PROMPT = [
  '你是长篇小说连续性编辑。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"issues":[{"level":"warn|error","message":"具体冲突","chapter":3,"advice":"怎么改"}]}。',
  '只报告能从前文摘要、设定和当前章纲中证明的冲突；没有冲突返回空数组。不要评价文笔。',
].join('\n')

export const OUTLINE_AUDIT_SYSTEM_PROMPT = [
  '你是长篇小说的结构编辑，负责检查章纲之间的逻辑一致性。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"issues":[{"level":"warn|error","number":章节号,"message":"具体冲突","advice":"怎么改"}]}。',
  '检查项：章纲是否空泛（synopsis 只有概括，缺具体人物、动作、结果）；时间线（先后、季节、地点移动是否可能）；人物位置与状态（上一章 synopsis 与下一章出场/状态是否矛盾，出场角色、身份和所在位置是否前后一致）；因果链（上一章 synopsis 是否支撑下一章剧情，章节之间是否自相矛盾）；伏笔（plant/payoff 是否对应、是否跨章回收）；设定（是否与既有角色/规则/地点冲突）；能力体系（境界是否无铺垫跨级、能力变化是否有来源与影响）；重复桥段（连续多章同一套路）。',
  '只报告能从前文摘要、章纲与设定中证明的冲突；不要评价文笔；没有冲突返回空数组。',
].join('\n')

export const OUTLINE_REPAIR_SYSTEM_PROMPT = [
  '你是长篇小说的结构编辑。根据列出的逻辑冲突，修订受影响的章纲。',
  '只输出 JSON，不要 Markdown 围栏。',
  '格式：{"chapters":[{"number":N,"title":"","synopsis":""}]}。',
  'synopsis 只写具体剧情梗概，不要拆成目标/冲突/转折/结果等标签。',
  '只输出列出的受影响章；只做消除冲突所需的最小改动；保留原有情节、人物与已埋伏笔；时间线与因果链必须前后衔接；不得无铺垫提升角色境界；不要评价文笔。',
].join('\n')

export const VOLUME_PLAN_SYSTEM_PROMPT = [
  '你是中文长篇小说的分卷编辑，负责为本卷确定舞台与卷级目标。',
  '只输出 JSON 对象，不要 Markdown 围栏，不要解释。',
  '格式：{"title":"卷名","map":"本卷主要活动范围与地点","goal":"本卷主线要完成什么","powerCeiling":"本卷本地战力天花板","exitCriteria":"什么条件满足后离开本卷","targetChapters":12}。',
  'map 要写 3–6 个具体地点/势力范围，必须与上一卷地图有明确区分，不能只写“上一卷继续”；如果本卷已有章纲，地点必须从章纲里已有的场景归纳，不要凭空改掉。',
  'goal 要写人物在本卷的具体目标与阻力，不是主题口号；exitCriteria 要可判断。',
  'targetChapters 只作参考，不按章数硬切。',
].join('\n')

export function buildVolumePlanUserPrompt(input) {
  const lines = [
    `项目：${input.title}（语言：${input.language}）`,
    `目标卷：${input.volume.title || input.volume.id}`,
    `已确认构思：${JSON.stringify(input.premise)}`,
    `文风契约：\n${formatStyleFields(input.styleFields ?? {})}`,
  ]
  if (input.previousVolume) {
    lines.push('上一卷：')
    lines.push(JSON.stringify({
      title: input.previousVolume.title,
      map: input.previousVolume.map,
      goal: input.previousVolume.goal,
      exitCriteria: input.previousVolume.exitCriteria,
      lastChapter: input.previousVolume.lastChapter,
    }, null, 2))
  }
  if (input.instruction) lines.push(`额外要求：${input.instruction}`)
  if (input.chapters?.length) {
    lines.push('本卷已有章纲：')
    for (const chapter of input.chapters.slice(-12)) {
      lines.push(`- 第${chapter.number}章 ${chapter.title || ''}：${String(chapter.synopsis || '').slice(0, 800)}`)
    }
  } else {
    lines.push('本卷还没有章纲，请根据上一卷离卷结果和升级目标先规划舞台。')
  }
  lines.push('只输出 JSON。')
  return lines.join('\n')
}

/*
 * 提示词目录。每条都带 revision（内置提示词版本号）：默认提示词内容每次改版时递增
 * 该条的 revision，用户覆盖记录 baseRevision/baseHash，用来判断「默认已更新」。
 * 统一默认 1；后续只改某一条时，在其条目里显式写 revision 即可覆盖该默认值。
 */
export const PROMPT_CATALOG = [
  {
    key: 'premise',
    group: 'premise',
    tags: ['构思', '候选'],
    label: '构思候选',
    category: '构思',
    description: '生成差异明显的长篇构思卡：标题、核心故事、题材、主角、篇幅。',
    default: PREMISE_SYSTEM_PROMPT,
  },
  {
    key: 'premiseIntent',
    group: 'premise',
    tags: ['构思', '意图'],
    label: '构思意图摘要',
    category: '构思',
    description: '从多轮构思对话提炼稳定的用户意图，再交给候选生成。',
    default: PREMISE_INTENT_SYSTEM_PROMPT,
  },
  {
    key: 'bible',
    group: 'bible',
    tags: ['设定', '角色'],
    label: '角色与设定',
    category: '设定',
    description: '生成角色、地点、规则、势力和物品五类设定。',
    default: BIBLE_SYSTEM_PROMPT,
  },
  {
    key: 'bibleCharacters',
    group: 'bible',
    tags: ['设定', '角色'],
    label: '角色生成',
    category: '设定',
    description: '只生成角色，保留已有地点、规则、势力和物品。',
    default: BIBLE_CHARACTERS_SYSTEM_PROMPT,
  },
  {
    key: 'bibleWorld',
    group: 'bible',
    tags: ['设定', '世界'],
    label: '世界生成',
    category: '设定',
    description: '只生成地点、规则、势力和物品，保留已有角色。',
    default: BIBLE_WORLD_SYSTEM_PROMPT,
  },
  {
    key: 'outline',
    group: 'outline',
    tags: ['大纲', '章纲'],
    label: '章纲生成',
    category: '大纲',
    description: '按构思、文风、分卷信息和上一章落点生成章纲。',
    default: OUTLINE_SYSTEM_PROMPT,
  },
  {
    key: 'reverseOutline',
    group: 'outline',
    tags: ['大纲', '反推'],
    label: '正文反推章纲',
    category: '大纲',
    description: '从已有正文反推每章 synopsis，不新增正文没有的事件。',
    default: REVERSE_OUTLINE_SYSTEM_PROMPT,
  },
  {
    key: 'volumePlan',
    group: 'outline',
    tags: ['大纲', '分卷'],
    label: '分卷舞台计划',
    category: '大纲',
    description: '从上一卷离卷结果和本卷已有章纲归纳地图、卷目标、战力天花板与离卷条件。',
    default: VOLUME_PLAN_SYSTEM_PROMPT,
  },
  {
    key: 'draft',
    group: 'chapter',
    tags: ['正文', '草稿'],
    label: '正文草稿',
    category: '正文',
    description: '按章纲、文风、设定和连续性写本章正文。',
    default: CHAPTER_SYSTEM_PROMPT,
  },
  {
    key: 'revise',
    group: 'chapter',
    tags: ['正文', '修订'],
    label: '按意见修订',
    category: '正文',
    description: '按用户修订要求改写本章，保留章纲事实与文风。',
    default: CHAPTER_SYSTEM_PROMPT,
  },
  {
    key: 'fix',
    group: 'chapter',
    tags: ['正文', '修复'],
    label: '自动修复',
    category: '正文',
    description: '修复规则质检与审校指出的问题，不改变剧情走向。',
    default: CHAPTER_SYSTEM_PROMPT,
  },
  {
    key: 'inspiration',
    group: 'other',
    tags: ['灵感', '桥段'],
    label: '灵感桥段',
    category: '构思',
    description: '生成具体的场景、桥段和可用点子，不写正文。',
    default: INSPIRATION_SYSTEM_PROMPT,
  },
  {
    key: 'deconstruct',
    group: 'other',
    tags: ['拆书'],
    label: '拆书分析',
    category: '拆书',
    description: '从已有文本提炼梗概、文风、人物和可复用桥段，不编造。',
    default: DECONSTRUCT_SYSTEM_PROMPT,
  },
  {
    key: 'deconstructStructure',
    group: 'other',
    tags: ['拆书', '结构'],
    label: '拆书·结构',
    category: '拆书',
    revision: 1,
    description: '把文本切成有意义的单元，标注功能与单元摘要。',
    default: DECONSTRUCT_STRUCTURE_SYSTEM_PROMPT,
  },
  {
    key: 'deconstructCharacters',
    group: 'other',
    tags: ['拆书', '人物'],
    label: '拆书·人物设定',
    category: '拆书',
    revision: 1,
    description: '只依据文本拆出人物、设定与人物关系。',
    default: DECONSTRUCT_CHARACTERS_SYSTEM_PROMPT,
  },
  {
    key: 'deconstructTechnique',
    group: 'other',
    tags: ['拆书', '技法'],
    label: '拆书·技法',
    category: '拆书',
    revision: 1,
    description: '提炼可复用钩子、写作技法与节奏观察。',
    default: DECONSTRUCT_TECHNIQUE_SYSTEM_PROMPT,
  },
  {
    key: 'styleAudit',
    group: 'review',
    tags: ['审校', '文风'],
    label: '文风检测',
    category: '审校',
    revision: 2,
    description: '识别 AI 指纹（禁用词/AI 句式/结构/节奏）并给出 aiFlavor 等级。',
    default: STYLE_AUDIT_SYSTEM_PROMPT,
  },
  {
    key: 'review',
    group: 'review',
    tags: ['审校', '文风', '连续性'],
    label: '统一审校',
    category: '审校',
    revision: 2,
    description: '同时检查文风（含 AI 味）和连续性冲突，只报影响阅读的问题。',
    default: CHAPTER_REVIEW_SYSTEM_PROMPT,
  },
  {
    key: 'deslop',
    group: 'craft',
    tags: ['去AI味', '改写'],
    label: '去 AI 味改写',
    category: '审校',
    revision: 1,
    description: '只改“怎么说”不改“说什么”，删套话、去解释、回人味，输出改写全文与改动清单。',
    default: DESLOP_SYSTEM_PROMPT,
  },
  {
    key: 'revisionLearn',
    group: 'craft',
    tags: ['修订', '偏好', '学习'],
    label: '修订学习',
    category: '审校',
    revision: 1,
    description: '从草稿→定稿差异提炼稳定的写作偏好与可执行规则，只返回建议、不自动写入。',
    default: REVISION_LEARN_SYSTEM_PROMPT,
  },
  {
    key: 'summary',
    group: 'data',
    tags: ['摘要', '记忆'],
    label: '章节摘要',
    category: '记忆',
    description: '生成客观连续性摘要、出场人物、关键事件和未解决线索。',
    default: SUMMARY_SYSTEM_PROMPT,
  },
  {
    key: 'continuity',
    group: 'review',
    tags: ['审校', '连续性'],
    label: '连续性检查',
    category: '审校',
    description: '只根据前文摘要、设定和当前章纲报告可证明的矛盾。',
    default: CONTINUITY_SYSTEM_PROMPT,
  },
  {
    key: 'outlineAudit',
    group: 'outline',
    tags: ['大纲', '审查'],
    label: '章纲审查',
    category: '大纲',
    description: '检查章纲的逻辑、时间线、因果、设定和重复桥段。',
    default: OUTLINE_AUDIT_SYSTEM_PROMPT,
  },
  {
    key: 'outlineRepair',
    group: 'outline',
    tags: ['大纲', '修复'],
    label: '章纲修复',
    category: '大纲',
    description: '按审查问题最小改动 chapters 的 synopsis。',
    default: OUTLINE_REPAIR_SYSTEM_PROMPT,
  },
].map((entry) => ({ revision: 1, ...entry }))
