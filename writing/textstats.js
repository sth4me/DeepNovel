// 统一字数口径：正文净字数 = 中文字符 + 英文/数字词，去掉 Markdown 标记与代码。
// UI、资料库、统计工具共用同一规则，避免三套算法互相打架。

export const COUNT_RULE = '净字数 = 中文字符数 + 英文/数字词数；不计 Markdown 标记、代码块、链接地址和空白。'

export function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]/g, '')
}

export function visibleTextLength(text) {
  const plain = stripMarkdown(text)
  const cjk = (plain.match(/[\u3400-\u9fff]/g) ?? []).length
  const words = (plain.match(/[A-Za-z0-9]+/g) ?? []).length
  return cjk + words
}

function countAll(text, pattern) {
  const matches = String(text ?? '').match(pattern)
  return matches ? matches.length : 0
}

/** 单段文本的完整统计。 */
export function countText(text) {
  const raw = String(text ?? '')
  const plain = stripMarkdown(raw)
  const lines = raw.length === 0 ? 0 : raw.split(/\r?\n/).length
  const paragraphs = raw.split(/\r?\n\s*\r?\n/).filter((item) => item.trim()).length
  const cjkChars = countAll(plain, /[\u3400-\u9fff]/g)
  const latinWords = countAll(plain, /[A-Za-z0-9]+/g)
  return {
    netChars: cjkChars + latinWords,
    cjkChars,
    latinWords,
    chars: raw.length,
    charsNoWhitespace: raw.replace(/\s/g, '').length,
    lines,
    paragraphs,
    quotes: {
      straight: countAll(raw, /"/g),
      curly: countAll(raw, /[\u201c\u201d]/g),
      corner: countAll(raw, /[\u300c\u300d]/g),
    },
    rule: COUNT_RULE,
  }
}

/** 从章卡里解析字数目标，例如 **3,500–4,200 字**。 */
export function parseTarget(text) {
  const match = String(text ?? '').match(/([\d,]{3,7})\s*[–\-~至到]\s*([\d,]{3,7})\s*字/)
  if (!match) return null
  const min = Number(match[1].replace(/,/g, ''))
  const max = Number(match[2].replace(/,/g, ''))
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null
  return { min, max }
}

export function progressOf(netChars, target) {
  if (!target) return null
  const ratio = target.max > 0 ? netChars / target.max : 0
  return {
    ratio: Math.round(ratio * 1000) / 1000,
    percent: Math.round(ratio * 100),
    reached: netChars >= target.min,
    over: netChars > target.max,
  }
}
