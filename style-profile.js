/**
 * 风格指纹（轻量，纯规则，不调 LLM）。
 *
 * 指标（6 个）：平均句长、短句比例、对话占比、段落平均句数、修饰/比喻密度（估算）、高频词 Top10。
 * 用途：生成时注入数字摘要作参考；生成后由诊断报告偏离（只提示，不自动改写、不覆盖文风契约）。
 */

const SENTENCE_SPLIT = /[。！？!?…]+/
const MODIFIER_WORDS = ['的', '地', '得', '仿佛', '好像', '如同', '像是', '似的', '犹如']
const STOP_WORDS = new Set([
  '我们', '他们', '她们', '你们', '什么', '没有', '一个', '这个', '那个', '自己', '时候',
  '知道', '起来', '出来', '不是', '就是', '因为', '所以', '如果', '可以', '还是', '已经',
  '只是', '但是', '然后', '现在', '这里', '那里', '这样', '那样', '一样', '一下', '一点',
  '不会', '不能', '不要', '觉得', '看着', '说道', '心里', '身上', '手里', '面前', '身后',
])

function countHan(text) {
  return (String(text ?? '').match(/[\u4e00-\u9fa5]/g) ?? []).length
}

function splitSentences(text) {
  return String(text ?? '')
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function splitParagraphs(text) {
  return String(text ?? '')
    .split(/\n{2,}|\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 对话字占比：引号内文字汉字数 / 全文汉字数。 */
function dialogueRatio(text) {
  const total = countHan(text)
  if (total === 0) return 0
  let dialogue = 0
  const regex = /[“"]([^”"]*)[”"]/g
  let match
  while ((match = regex.exec(String(text ?? ''))) !== null) {
    dialogue += countHan(match[1])
  }
  return dialogue / total
}

/** 高频词：2–4 字中文词，滑窗计数，排除停用词。 */
function topWords(text, limit = 10) {
  const counts = new Map()
  for (const match of String(text ?? '').matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const run = match[0]
    for (let start = 0; start < run.length; start += 1) {
      for (let length = 2; length <= 4 && start + length <= run.length; length += 1) {
        const word = run.slice(start, start + length)
        if (STOP_WORDS.has(word)) continue
        counts.set(word, (counts.get(word) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }))
}

/** 计算一组章节文本的风格指纹；无有效文本返回 null。 */
export function computeStyleProfile(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).map((text) => String(text ?? '')).filter((text) => text.trim())
  if (list.length === 0) return null
  const joined = list.join('\n\n')
  const sentences = []
  let paragraphCount = 0
  let sentenceTotal = 0
  for (const text of list) {
    for (const paragraph of splitParagraphs(text)) {
      const paragraphSentences = splitSentences(paragraph)
      if (paragraphSentences.length === 0) continue
      paragraphCount += 1
      sentenceTotal += paragraphSentences.length
      sentences.push(...paragraphSentences)
    }
  }
  const characters = countHan(joined)
  if (sentences.length === 0 || characters === 0) return null
  const sentenceLengths = sentences.map((sentence) => countHan(sentence))
  const avgSentenceLen = sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length
  const shortSentences = sentenceLengths.filter((length) => length <= 10).length
  const modifierSentences = sentences.filter((sentence) => MODIFIER_WORDS.some((word) => sentence.includes(word))).length
  const words = topWords(joined)
  return {
    chapterCount: list.length,
    characters,
    metrics: {
      avgSentenceLen: round(avgSentenceLen, 1),
      shortSentenceRatio: round(shortSentences / sentences.length),
      dialogueRatio: round(dialogueRatio(joined)),
      paraSentenceAvg: round(paragraphCount > 0 ? sentenceTotal / paragraphCount : 0, 1),
      modifierDensity: round(modifierSentences / sentences.length),
      topWords: words,
    },
  }
}

const METRIC_LABELS = {
  avgSentenceLen: '平均句长',
  shortSentenceRatio: '短句比例',
  dialogueRatio: '对话占比',
  paraSentenceAvg: '段落平均句数',
  modifierDensity: '修饰/比喻密度',
}

/** 当前文本与指纹的偏离：ratio 偏差 >35% medium、>60% high；对话占比用绝对差 >0.15/0.25。 */
export function compareStyleProfile(profile, text) {
  const current = computeStyleProfile(text)
  const expected = profile?.metrics
  if (!current || !expected) return { deviations: [], score: 100 }
  const deviations = []
  for (const metric of ['avgSentenceLen', 'shortSentenceRatio', 'paraSentenceAvg', 'modifierDensity']) {
    const expectedValue = Number(expected[metric] ?? 0)
    const currentValue = Number(current.metrics[metric] ?? 0)
    const ratio = expectedValue > 0 ? Math.abs(currentValue - expectedValue) / expectedValue : 0
    const level = ratio > 0.6 ? 'high' : ratio > 0.35 ? 'medium' : 'low'
    deviations.push({ metric, label: METRIC_LABELS[metric], current: currentValue, expected: expectedValue, ratio: round(ratio), level })
  }
  const dialogueDiff = Math.abs(Number(current.metrics.dialogueRatio ?? 0) - Number(expected.dialogueRatio ?? 0))
  deviations.push({
    metric: 'dialogueRatio',
    label: METRIC_LABELS.dialogueRatio,
    current: current.metrics.dialogueRatio,
    expected: Number(expected.dialogueRatio ?? 0),
    ratio: round(dialogueDiff),
    level: dialogueDiff > 0.25 ? 'high' : dialogueDiff > 0.15 ? 'medium' : 'low',
  })
  const penalty = deviations.reduce((sum, item) => sum + (item.level === 'high' ? 25 : item.level === 'medium' ? 10 : 0), 0)
  return { deviations, score: Math.max(0, 100 - penalty) }
}

/** 紧凑数字摘要（提示词注入用）。 */
export function renderStyleProfile(profile) {
  const metrics = profile?.metrics
  if (!metrics) return ''
  const percent = (value) => `${Math.round(Number(value ?? 0) * 100)}%`
  const words = (metrics.topWords ?? []).slice(0, 10).map((item) => item.word).join('、')
  const parts = [
    `平均句长 ${metrics.avgSentenceLen} 字`,
    `短句 ${percent(metrics.shortSentenceRatio)}`,
    `对话 ${percent(metrics.dialogueRatio)}`,
    `段落 ${metrics.paraSentenceAvg} 句`,
    `修饰密度 ${percent(metrics.modifierDensity)}（估算）`,
  ]
  if (words) parts.push(`高频词：${words}`)
  return parts.join('；')
}
