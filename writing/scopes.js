// 已知任务 → 文件作用域。用于判定并行/排队；未知任务按整项目写处理（安全优先）。
import { normalizeAccess } from './access.js'

function chapterFile(id) {
  return id ? `manuscript/${id}.md` : 'manuscript/'
}

const RULES = [
  {
    test: /写下一章正文|^写正文$|让 AI 写|续写|润色|改写/,
    scope: ({ chapterId }) => ({
      write: [chapterFile(chapterId)],
      read: ['plot/chapters/', 'continuity/', 'plot/book.md'],
    }),
  },
  {
    test: /补本卷章卡|规划第一卷|规划第一章章卡|补章卡/,
    scope: () => ({ write: ['plot/'], read: ['plot/book.md', 'world/', 'characters/', 'continuity/'] }),
  },
  {
    test: /补世界观|补设定/,
    scope: () => ({ write: ['world/'], read: ['plot/', 'characters/'] }),
  },
  {
    test: /补人物/,
    scope: () => ({ write: ['characters/'], read: ['plot/', 'world/'] }),
  },
  {
    test: /整理连续性/,
    scope: () => ({ write: ['continuity/'], read: ['manuscript/', 'plot/', 'characters/'] }),
  },
  {
    test: /提炼文风/,
    scope: () => ({ write: ['deepnovel.json'], read: ['manuscript/', 'plot/book.md'] }),
  },
  {
    test: /检查|评估|分析|盘点|对比/,
    scope: () => ({ readAll: true, write: [] }),
  },
]

export function scopeForTask({ title = '', chapterId = '' } = {}) {
  for (const rule of RULES) {
    if (rule.test.test(String(title))) return normalizeAccess(rule.scope({ chapterId }))
  }
  return normalizeAccess({ writeAll: true })
}

/** UI 显式给出作用域时优先使用，否则按任务名映射。 */
export function accessForTask({ title, chapterId, access } = {}) {
  if (access && typeof access === 'object') return normalizeAccess(access)
  return scopeForTask({ title, chapterId })
}
