// 文风检查：把「去 AI 味」从文字要求变成可数指标，供 Agent 自检。
// 默认规则针对中文小说常见 AI 腔；检测只报告，不自动改写。

const CONTRAST = /不是[^。！？\n]{1,40}[，,]\s*是/g
const CONTRAST_ALT = /(并非|与其说)[^。！？\n]{1,40}[，,]\s*(而是|不如说)/g
const SUMMARY = /(终于明白|才明白|他明白了|她明白了|从此|原来如此|某种意义上|不知为何|仿佛在说|这才意识到)/g
const SHORT_OPENER_MAX = 14

function lineAtOffsets(text) {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      if (starts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
}

function collect(regex, text, lineOf, limit = 5) {
  const samples = []
  let count = 0
  for (const match of text.matchAll(regex)) {
    count += 1
    if (samples.length < limit) {
      const start = Math.max(0, match.index - 20)
      samples.push({
        line: lineOf(match.index),
        text: text.slice(start, match.index + match[0].length + 20).replace(/\s+/g, ' ').trim(),
      })
    }
  }
  return { count, samples }
}

function paragraphsOf(text) {
  return String(text ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * @param text 正文
 * @param options.patterns 额外禁用句式（普通字符串或正则源）
 */
export function checkStyle(text, { patterns = [], shortOpenerRatio = 0.25 } = {}) {
  const source = String(text ?? '')
  const lineOf = lineAtOffsets(source)
  const paragraphs = paragraphsOf(source)

  const contrast = collect(CONTRAST, source, lineOf)
  const contrastAlt = collect(CONTRAST_ALT, source, lineOf)
  const summary = collect(SUMMARY, source, lineOf)

  const shortOpeners = []
  let shortOpenerCount = 0
  for (const paragraph of paragraphs) {
    const first = paragraph.split(/[。！？]/)[0]?.trim() ?? ''
    if (first.length > 0 && first.length <= SHORT_OPENER_MAX && paragraph.length > first.length + 12) {
      shortOpenerCount += 1
      if (shortOpeners.length < 5 && !shortOpeners.includes(first)) shortOpeners.push(first)
    }
  }
  const ratio = paragraphs.length ? Math.round((shortOpenerCount / paragraphs.length) * 1000) / 1000 : 0

  const custom = []
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.trim()) continue
    let regex
    try {
      regex = new RegExp(pattern, 'g')
    } catch {
      continue
    }
    const found = collect(regex, source, lineOf, 3)
    if (found.count > 0) custom.push({ pattern, ...found })
  }

  const issues = []
  if (contrast.count > 0) {
    issues.push({
      kind: 'contrast',
      label: '「不是…是…」对照句',
      count: contrast.count,
      limit: 0,
      samples: contrast.samples,
      fix: '改成直述：只说要什么、发生什么，不要先否一个再立一个。',
    })
  }
  if (contrastAlt.count > 0) {
    issues.push({
      kind: 'contrast-alt',
      label: '「并非…而是…」对照句',
      count: contrastAlt.count,
      limit: 0,
      samples: contrastAlt.samples,
      fix: '同上，删掉对照结构，直接写事实。',
    })
  }
  if (ratio > shortOpenerRatio) {
    issues.push({
      kind: 'short-opener',
      label: '短句开段',
      count: shortOpenerCount,
      total: paragraphs.length,
      ratio,
      limit: shortOpenerRatio,
      samples: shortOpeners,
      fix: '把多个短句开段合并进前一段，或让段落从中长句开始；短句只作句中顿点。',
    })
  }
  if (summary.count > 0) {
    issues.push({
      kind: 'summary',
      label: '总结/感悟式表达',
      count: summary.count,
      limit: 0,
      samples: summary.samples,
      fix: '删掉感悟句，结尾落在动作、物件或一句没说完的话上。',
    })
  }
  for (const item of custom) {
    issues.push({
      kind: 'custom',
      label: `项目禁用句式「${item.pattern}」`,
      count: item.count,
      limit: 0,
      samples: item.samples,
      fix: '按项目文风要求改写。',
    })
  }

  return {
    paragraphs: paragraphs.length,
    chars: source.length,
    verdict: issues.length ? 'needs-revision' : 'clean',
    issues,
    thresholds: { shortOpenerRatio, shortOpenerMaxChars: SHORT_OPENER_MAX },
  }
}
