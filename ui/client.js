window.__ModuleLoader__.load({
  id: '@sth4me/deepnovel-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback } = React

    const MAIN_ID = 'novel-writer-desk'
    const ROOT_KEY = 'deepnovel.v2.projectRoot'
    const RECENT_KEY = 'deepnovel.v2.recentProjects'
    let clientScope = null

    const DESIGN_CSS = `
.dn-app{--dn-brand-soft:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);--dn-brand-line:color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,transparent);--dn-rail-surface:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-2)),var(--dsw-alias-bg-layer-2) 48%);--dn-stage-surface:radial-gradient(1000px 480px at 20% -8%,color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent),transparent 58%);height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dn-stage-surface),var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:14px}
.dn-top{flex:0 0 auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:13px 22px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-border-l1));background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 90%,var(--dsw-alias-brand-primary) 10%),var(--dsw-alias-bg-layer-1) 82%);box-shadow:0 8px 24px rgba(0,0,0,.05);position:relative;z-index:20}
.dn-body{flex:1;min-height:0;display:flex}
.dn-rail{width:clamp(264px,17vw,320px);flex:0 0 auto;min-height:0;display:flex;flex-direction:column;padding:16px 12px;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dn-rail-surface);overflow:auto}
.dn-stage{flex:1;min-width:0;overflow:auto;padding:30px 44px 46px;scrollbar-width:thin;background:var(--dn-stage-surface)}
.dn-stage-inner{width:100%;max-width:1560px;margin:0 auto;min-height:100%;display:flex;flex-direction:column;gap:10px}
.dn-inspector{width:clamp(280px,17vw,340px);flex:0 0 auto;min-height:0;overflow:auto;padding:18px 16px;border-left:1px solid var(--dsw-alias-border-l1);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-layer-2)),var(--dsw-alias-bg-layer-2) 52%)}
.dn-nav{display:grid;gap:2px;padding:2px 0}
.dn-nav-label{font-size:10px;font-weight:700;letter-spacing:.14em;opacity:.45;padding:4px 10px 8px}
.dn-nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;text-align:left;cursor:pointer;transition:background .14s,color .14s,border-color .14s}
.dn-nav-item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 75%,transparent);color:var(--dsw-alias-label-primary)}
.dn-nav-item.active{background:linear-gradient(90deg,var(--dn-brand-soft),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 86%,transparent));border-color:var(--dn-brand-line);color:var(--dsw-alias-label-primary);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary);font-weight:650}
.dn-nav-icon{width:26px;height:26px;flex:0 0 auto;display:grid;place-items:center;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 68%,transparent);color:var(--dsw-alias-label-secondary);border:1px solid transparent}
.dn-nav-item.active .dn-nav-icon{background:var(--dn-brand-soft);color:var(--dsw-alias-brand-primary);border-color:var(--dn-brand-line)}
.dn-nav-count{min-width:23px;height:19px;padding:0 6px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 80%,transparent);border:1px solid var(--dsw-alias-border-l1);font-size:10.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dn-nav-item.active .dn-nav-count{background:var(--dn-brand-soft);border-color:var(--dn-brand-line);color:var(--dsw-alias-brand-primary)}
.dn-tree-head{display:flex;align-items:center;padding:10px 12px 5px;font-size:10px;font-weight:700;letter-spacing:.14em;opacity:.45}
.dn-tree-filter{margin:2px 4px 6px;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 75%,transparent);color:inherit;font:inherit;font-size:12px;outline:none}
.dn-tree-filter:focus{border-color:var(--dsw-alias-brand-primary)}
.dn-tree-group{border:0;background:transparent;color:var(--dsw-alias-label-secondary);width:100%;display:flex;align-items:center;gap:7px;padding:8px;border-radius:7px;font:inherit;font-size:12px;font-weight:650;text-align:left;cursor:pointer}
.dn-tree-group:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dn-tree-row{display:flex;align-items:center;gap:7px;width:100%;padding:7px 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;text-align:left;cursor:pointer;line-height:1.45}
.dn-tree-row:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dn-tree-row.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);color:var(--dsw-alias-label-primary);font-weight:600}
.dn-btn{height:31px;padding:0 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;white-space:nowrap;transition:transform .12s,background .12s,border-color .12s,box-shadow .12s}
.dn-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);transform:translateY(-.5px)}
.dn-btn:active:not(:disabled){transform:translateY(0)}
.dn-btn:disabled{opacity:.42;cursor:not-allowed}
.dn-btn-primary{background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,#fff 12%),var(--dsw-alias-brand-primary));color:#fff;border-color:transparent;box-shadow:0 4px 14px color-mix(in srgb,var(--dsw-alias-brand-primary) 25%,transparent)}
.dn-btn-primary:hover:not(:disabled){filter:brightness(1.05);border-color:transparent;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,#fff 12%),var(--dsw-alias-brand-primary))}
.dn-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px 18px;background:linear-gradient(180deg,var(--dsw-alias-bg-layer-2),color-mix(in srgb,var(--dsw-alias-bg-layer-2) 90%,var(--dsw-alias-bg-layer-1)));box-shadow:0 1px 2px rgba(0,0,0,.04);display:grid;gap:10px}
.dn-muted{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7}
.dn-section-title{font-size:23px;font-weight:700;letter-spacing:-.01em;margin:0;display:flex;align-items:center;gap:10px}
.dn-section-title::before{content:"";width:3px;height:18px;border-radius:3px;background:var(--dsw-alias-brand-primary);box-shadow:0 0 10px color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}
.dn-page-head{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-border-l1))}
.dn-tree-count{font-size:10.5px;min-width:20px;height:18px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-weight:400}
.dn-flow-card{background:linear-gradient(110deg,var(--dn-brand-soft),color-mix(in srgb,var(--dsw-alias-bg-layer-2) 92%,transparent) 58%);border-color:var(--dn-brand-line);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.dn-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:10.5px;opacity:.85}
.dn-editor-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:4px 2px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dn-editor-title{display:grid;gap:1px}
.dn-mode{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;display:inline-flex}
.dn-mode button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:6px 10px;cursor:pointer}
.dn-mode button.active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
@media (max-width:1350px){.dn-inspector{display:none}.dn-stage{padding:24px 28px 36px}}
@media (max-width:980px){.dn-rail{width:190px}.dn-stage{padding:20px 16px 28px}}
`

    function normalizeWorkspacePath(value) {
      return String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    function findWorkspaceForPath(items, root) {
      const target = normalizeWorkspacePath(root)
      return (Array.isArray(items) ? items : []).find((workspace) =>
        normalizeWorkspacePath(workspace?.path ?? workspace?.rootPath ?? workspace?.cwd) === target,
      ) ?? null
    }

    function buildTaskPrompt(title, root, body) {
      return [
        `【写作台任务】${title}`,
        '',
        `项目目录：${root}`,
        '请先调用 novel_project，action=open，projectRoot 使用上面的项目目录；然后再执行任务。',
        '',
        `任务：${body}`,
        '',
        '写盘必须使用 novel_write 生成提案，等我确认后再应用。不要创建隐藏助手或子代理。',
      ].join('\n')
    }

    function withTimeout(promise, ms, message) {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
      ])
    }

    async function sendTaskToSessionWith(sessions, sessionId, prompt) {
      if (!sessions?.retain) throw new Error('会话服务不可用')
      const reference = sessions.retain(sessionId, { source: 'controllerOperation' })
      try {
        const binding = reference.binding ?? await withTimeout(reference.ready, 15000, '等待会话就绪超时')
        const session = binding?.session
        if (!session?.prompt) throw new Error('会话不接受任务')
        const result = await withTimeout(session.prompt([{ type: 'text', text: prompt }], 'queue'), 15000, '发送任务超时')
        if (result && result.ok === false) throw new Error(result.error?.message ?? '任务发送失败')
      } finally {
        try { reference.release?.() } catch {}
      }
    }

    async function dispatchTaskWith({ service, workspaces, sessions, workspaceItems, root, prompt, agentPreset = 'novel-writer', existingSessionId = '' }) {
      if (existingSessionId) {
        try {
          await sendTaskToSessionWith(sessions, existingSessionId, prompt)
          try { service.openSession?.(existingSessionId) } catch {}
          return existingSessionId
        } catch {
          // 原会话已失效或不可写：重建一个项目会话。
        }
      }
      if (!service?.connectWorkspace) throw new Error('当前环境不能创建写作会话')
      const target = findWorkspaceForPath(workspaceItems, root)
      let workspaceId = target?.workspaceId ?? target?.id
      if (!workspaceId) {
        if (!workspaces?.create) throw new Error('当前环境不能创建工作区')
        const created = await withTimeout(workspaces.create({ path: root }), 15000, '创建工作区超时')
        workspaceId = created?.workspaceId ?? created?.id
      }
      if (!workspaceId) throw new Error('无法确定项目工作区')
      const sessionId = await withTimeout(service.connectWorkspace(workspaceId, { agentPreset }), 15000, '创建写作会话超时')
      await sendTaskToSessionWith(sessions, sessionId, prompt)
      try { service.openSession?.(sessionId) } catch {}
      return sessionId
    }

    function uiWorkspace() {
      try {
        return clientScope?.get?.('uiWorkspace') ?? null
      } catch {
        return null
      }
    }

    async function pickDirectory() {
      const service = uiWorkspace()
      if (!service?.pickDirectory) return { supported: false, path: null }
      try {
        return { supported: true, path: await service.pickDirectory() }
      } catch {
        return { supported: true, path: null }
      }
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      })
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '请求失败')
      return payload.data
    }

    function loadRecent() {
      try {
        const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
        return Array.isArray(list) ? list.filter((item) => typeof item === 'string').slice(0, 8) : []
      } catch {
        return []
      }
    }

    function rememberRecent(path) {
      const next = [path, ...loadRecent().filter((item) => item !== path)].slice(0, 8)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    }

    function basename(path) {
      return String(path ?? '').split(/[\\/]/).filter(Boolean).pop() || '未命名'
    }

    function kindLabel(kind) {
      return {
        book: '全书主线', world: '设定', character: '人物', volume: '卷', arc: '剧情点',
        chapter: '章卡', manuscript: '正文', summary: '章节摘要', ledger: '连续性账本',
      }[kind] ?? kind
    }

    function stageLabel(stage) {
      return {
        opening: '开书方向',
        foundation: '地基（设定/人物）',
        outline: '结构（卷/章卡）',
        writing: '写作（正文）',
        continuity: '连续性',
        done: '本卷完成',
      }[stage] ?? stage
    }

    function inlineNodes(text, keyPrefix) {
      const nodes = []
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(String(text ?? ''))) !== null) {
        if (match.index > last) nodes.push(String(text).slice(last, match.index))
        const token = match[0]
        if (token.startsWith('**')) nodes.push(h('strong', { key: `${keyPrefix}-b${index++}`, style: { fontWeight: 600 } }, token.slice(2, -2)))
        else if (token.startsWith('`')) nodes.push(h('code', { key: `${keyPrefix}-c${index++}`, style: { padding: '1px 4px', borderRadius: 4, background: 'var(--dsw-alias-bg-layer-2)', fontSize: '0.92em' } }, token.slice(1, -1)))
        else nodes.push(h('em', { key: `${keyPrefix}-i${index++}` }, token.slice(1, -1)))
        last = match.index + token.length
      }
      if (last < String(text ?? '').length) nodes.push(String(text ?? '').slice(last))
      return nodes
    }

    function MarkdownPreview({ text, style }) {
      const source = String(text ?? '')
      if (!source.trim()) return h('div', { style: style.muted }, '（空文档）')
      const blocks = []
      let headingIndex = 0
      let paragraph = []
      let list = null
      let code = null
      const flush = () => {
        if (paragraph.length) {
          blocks.push(h('p', { key: `p${blocks.length}`, style: { margin: '0 0 10px' } }, inlineNodes(paragraph.join('\n'), `p${blocks.length}`)))
          paragraph = []
        }
        if (list) {
          blocks.push(h('ul', { key: `u${blocks.length}`, style: { margin: '0 0 10px', paddingLeft: 20 } }, ...list))
          list = null
        }
      }
      source.split(/\r?\n/).forEach((line, index) => {
        if (line.trim().startsWith('```')) {
          if (code === null) { flush(); code = [] }
          else { blocks.push(h('pre', { key: `pre${blocks.length}`, style: { overflow: 'auto', padding: 10, borderRadius: 7, background: 'var(--dsw-alias-bg-layer-2)', fontSize: 12 } }, code.join('\n'))); code = null }
          return
        }
        if (code !== null) { code.push(line); return }
        const heading = line.match(/^(#{1,4})\s+(.*)$/)
        if (heading) {
          flush()
          const level = heading[1].length
          const headingId = `dn-heading-${headingIndex++}`
          blocks.push(h(`h${Math.min(level, 4)}`, { key: `h${blocks.length}`, id: headingId, style: { margin: '18px 0 8px', fontSize: level === 1 ? 24 : level === 2 ? 19 : 16, fontWeight: 600, lineHeight: 1.45, scrollMarginTop: 12 } }, heading[2]))
          return
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)$/)
        if (bullet) {
          if (paragraph.length) flush()
          if (!list) list = []
          list.push(h('li', { key: `li${index}`, style: { margin: '2px 0' } }, inlineNodes(bullet[1], `li${index}`)))
          return
        }
        const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
        if (numbered) {
          if (paragraph.length) flush()
          if (!list) list = []
          list.push(h('li', { key: `li${index}`, style: { margin: '2px 0' } }, inlineNodes(numbered[1], `li${index}`)))
          return
        }
        if (!line.trim()) { flush(); return }
        if (line.startsWith('> ')) {
          flush()
          blocks.push(h('blockquote', { key: `q${blocks.length}`, style: { margin: '0 0 10px', paddingLeft: 10, borderLeft: '3px solid var(--dsw-alias-border-l1)', opacity: 0.8 } }, line.slice(2)))
          return
        }
        paragraph.push(line)
      })
      flush()
      if (code !== null) blocks.push(h('pre', { key: `pre${blocks.length}`, style: { overflow: 'auto', padding: 10, borderRadius: 7, background: 'var(--dsw-alias-bg-layer-2)', fontSize: 12 } }, code.join('\n')))
      return h('div', { style: { lineHeight: 1.85, fontSize: 14, maxWidth: 980, margin: '0 auto' } }, ...blocks)
    }

    function docFromPath(path) {
      if (path === 'plot/book.md') return { kind: 'book', id: 'book' }
      if (path === 'continuity/ledger.json') return { kind: 'ledger', id: 'ledger' }
      let match = path.match(/^world\/([^/]+)\.md$/)
      if (match) return { kind: 'world', id: match[1] }
      match = path.match(/^characters\/([^/]+)\.md$/)
      if (match) return { kind: 'character', id: match[1] }
      match = path.match(/^plot\/volumes\/([^/]+)\.md$/)
      if (match) return { kind: 'volume', id: match[1] }
      match = path.match(/^plot\/arcs\/([^/]+)\.md$/)
      if (match) return { kind: 'arc', id: match[1] }
      match = path.match(/^plot\/chapters\/([^/]+)\.md$/)
      if (match) return { kind: 'chapter', id: match[1] }
      match = path.match(/^manuscript\/([^/]+)\.md$/)
      if (match) return { kind: 'manuscript', id: match[1] }
      match = path.match(/^continuity\/summaries\/([^/]+)\.md$/)
      if (match) return { kind: 'summary', id: match[1] }
      return null
    }

    function WritingIcon(props) {
      const size = Number(props?.size ?? 16)
      return h('span', {
        style: {
          display: 'grid', placeItems: 'center', width: size, height: size,
          color: props?.active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        },
      }, h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
        h('path', { d: 'M5 4h10l4 4v12H5z' }),
        h('path', { d: 'M9 10h6M9 13h6M9 16h4' }),
      ))
    }

    function buildTree(map) {
      if (!map) return []
      const groups = [{ key: 'book', kind: 'book', id: 'book', label: '全书主线', hint: '故事脊柱' }]
      groups.push({
        key: 'world', kind: 'group', label: '设定', addKind: 'world',
        hint: `${map.world?.length ?? 0} 条`,
        children: (map.world ?? []).map((item) => ({ key: item.id, kind: 'world', id: item.id, label: item.title, hint: item.category })),
      })
      groups.push({
        key: 'characters', kind: 'group', label: '人物', addKind: 'character',
        hint: `${map.characters?.length ?? 0} 人`,
        children: (map.characters ?? []).map((item) => ({ key: item.id, kind: 'character', id: item.id, label: item.name, hint: item.role })),
      })
      groups.push({
        key: 'volumes', kind: 'group', label: '分卷', addKind: 'volume',
        hint: `${map.plot?.volumes?.length ?? 0} 卷`,
        children: (map.plot?.volumes ?? []).map((volume) => ({
          key: volume.id,
          kind: 'volume',
          id: volume.id,
          label: volume.title,
          actions: [
            { kind: 'arc', label: '＋剧情点' },
            { kind: 'chapter', label: '＋章' },
          ],
          children: [
            ...(volume.arcs ?? []).map((arc) => ({ key: arc.id, kind: 'arc', id: arc.id, label: `剧情点：${arc.title}` })),
            ...(volume.chapters ?? []).map((chapter) => ({
              key: chapter.id,
              kind: 'chapter',
              id: chapter.id,
              label: `${chapter.order}. ${chapter.title}`,
              hint: chapter.hasManuscript ? '有正文' : '待写',
              children: [
                { key: `${chapter.id}-card`, kind: 'chapter', id: chapter.id, label: '章卡' },
                { key: `${chapter.id}-ms`, kind: 'manuscript', id: chapter.id, label: chapter.hasManuscript ? '正文 ✓' : '正文（空）' },
                { key: `${chapter.id}-sum`, kind: 'summary', id: chapter.id, label: '摘要' },
              ],
            })),
          ],
        })),
      })
      groups.push({ key: 'ledger', kind: 'ledger', id: 'ledger', label: '连续性账本', hint: '事实/知情/伏笔/交接' })
      return groups
    }

    function Modal({ title, subtitle, children, onClose, width = 440 }) {
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.5)',
          display: 'grid', placeItems: 'center', padding: 20,
        },
        onClick: onClose,
      }, h('div', {
        style: {
          width, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 12, padding: 18, boxShadow: '0 24px 70px rgba(0,0,0,.35)', display: 'grid', gap: 14,
        },
        onClick: (event) => event.stopPropagation(),
      },
        h('div', null,
          h('div', { style: { fontWeight: 700, fontSize: 15 } }, title),
          subtitle ? h('div', { style: { fontSize: 12, opacity: 0.65, marginTop: 4, lineHeight: 1.6 } }, subtitle) : null,
        ),
        children,
      ))
    }

    function Field({ label, hint, children }) {
      return h('label', { style: { display: 'grid', gap: 5, fontSize: 12 } },
        h('span', { style: { opacity: 0.82 } }, label),
        children,
        hint ? h('span', { style: { opacity: 0.55, lineHeight: 1.5 } }, hint) : null,
      )
    }

    function Btn({ kind = 'default', className = '', children, ...props }) {
      return h('button', {
        type: 'button',
        ...props,
        className: `dn-btn${kind === 'primary' ? ' dn-btn-primary' : ''}${className ? ` ${className}` : ''}`,
      }, children)
    }

    function useStyles() {
      return useMemo(() => ({
        app: { height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: 13, minHeight: 0 },
        header: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)', minHeight: 56, boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-1)' },
        body: { display: 'grid', minHeight: 0 },
        sidebar: { borderRight: '1px solid var(--dsw-alias-border-l1)', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-layer-1)' },
        center: { display: 'flex', flexDirection: 'column', minHeight: 0, padding: '16px 22px 10px', gap: 10, background: 'var(--dsw-alias-bg-layer-2)' },
        right: { borderLeft: '1px solid var(--dsw-alias-border-l1)', minHeight: 0, padding: '16px 16px', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-1)' },
        textarea: { flex: 1, minHeight: 0, resize: 'none', width: '100%', maxWidth: 1040, margin: '0 auto', boxSizing: 'border-box', padding: 22, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', font: 'inherit', fontSize: 14, lineHeight: 1.9 },
        previewPane: { borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1)', padding: '28px 32px', overflow: 'auto', minHeight: 0, maxWidth: 1320, width: '100%', margin: '0 auto', boxSizing: 'border-box' },
        input: { padding: '7px 9px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', width: '100%', boxSizing: 'border-box' },
        card: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 14, padding: '16px 18px', background: 'linear-gradient(180deg, var(--dsw-alias-bg-layer-2), color-mix(in srgb, var(--dsw-alias-bg-layer-2) 90%, var(--dsw-alias-bg-layer-1)))', display: 'grid', gap: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
        muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12.5, lineHeight: 1.7 },
        treeRow: { width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: 'inherit', padding: '5px 6px', borderRadius: 5, cursor: 'pointer', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        groupTitle: { textAlign: 'left', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: 0.85, padding: '3px 4px' },
        addButton: { padding: '2px 6px', borderRadius: 5, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' },
        badge: { display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', fontSize: 10.5, opacity: 0.85 },
      }), [])
    }

    function ErrorBox({ message }) {
      if (!message) return null
      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)',
          borderRadius: 7, padding: '7px 10px', fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5,
        },
      }, message)
    }

    function Welcome({ draft, setDraft, recent, busy, error, activity, onChoose, onInit, onOpen, style }) {
      return h('div', { style: { padding: 28, display: 'grid', gap: 18, maxWidth: 760, alignContent: 'start' } },
        h('div', { style: { display: 'grid', gap: 5 } },
          h('h2', { style: { margin: 0, fontSize: 20 } }, '打开写作项目'),
          h('p', { style: { ...style.muted, margin: 0 } }, '项目目录里保存设定、人物、卷、章卡、正文和连续性账本。先选一个目录。'),
        ),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h(Btn, { kind: 'primary', disabled: busy, onClick: onChoose }, '选择项目目录'),
          h(Btn, { disabled: busy, onClick: onInit }, '新建项目'),
        ),
        activity ? h('div', { style: style.muted }, activity) : null,
        recent.length ? h('div', { style: style.card },
          h('div', { style: { fontWeight: 600, fontSize: 12 } }, '最近打开'),
          ...recent.map((path) => h('button', {
            key: path, type: 'button',
            style: { ...style.treeRow, padding: '6px 7px' },
            onClick: () => onOpen(path),
          }, path)),
        ) : null,
        h('div', { style: style.card },
          h('div', { style: { fontWeight: 600, fontSize: 12 } }, '手动路径'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', {
              style: style.input, value: draft, placeholder: '例如 ~/Novels/我的书',
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') onOpen(draft) },
            }),
            h(Btn, { onClick: () => onOpen(draft) }, '打开'),
          ),
        ),
        h(ErrorBox, { message: error }),
      )
    }

    function Tree({ nodes, active, onOpen, onAdd, style }) {
      const [open, setOpen] = useState(() => new Set(['world', 'characters', 'volumes']))
      const toggle = (key) => setOpen((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      const renderNode = (node, depth = 0) => {
        if (node.kind === 'group') {
          const isOpen = open.has(node.key)
          return h('div', { key: node.key, style: { marginTop: 8 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' } },
              h('button', { type: 'button', style: { ...style.groupTitle, flex: 1 }, onClick: () => toggle(node.key) },
                `${isOpen ? '▾' : '▸'} ${node.label}`,
                h('span', { style: { fontWeight: 400, opacity: 0.55, marginLeft: 6 } }, node.hint ?? ''),
              ),
              node.addKind ? h('button', {
                type: 'button', style: style.addButton, title: `新建${kindLabel(node.addKind)}`,
                onClick: () => onAdd(node.addKind),
              }, `＋${kindLabel(node.addKind)}`) : null,
            ),
            isOpen ? (node.children ?? []).map((child) => renderNode(child, depth + 1)) : null,
          )
        }
        const isActive = active?.kind === node.kind && String(active?.id ?? '') === String(node.id)
        const hasChildren = Array.isArray(node.children) && node.children.length > 0
        return h('div', { key: node.key },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 2 } },
            h('button', {
              type: 'button',
              onClick: () => { if (hasChildren) toggle(node.key); onOpen(node) },
              style: {
                ...style.treeRow,
                paddingLeft: 6 + depth * 12,
                background: isActive ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
                color: isActive ? 'var(--dsw-alias-brand-primary)' : 'inherit',
                fontWeight: isActive ? 600 : 400,
                flex: 1,
              },
            }, `${hasChildren ? (open.has(node.key) ? '▾ ' : '▸ ') : ''}${node.label}`),
            node.hint ? h('span', { style: { fontSize: 10, opacity: 0.55, whiteSpace: 'nowrap' } }, node.hint) : null,
            ...(node.actions ?? []).map((action) => h('button', {
              key: action.kind,
              type: 'button',
              style: style.addButton,
              onClick: () => onAdd(action.kind, node.id),
            }, action.label)),
          ),
          open.has(node.key) ? (node.children ?? []).map((child) => renderNode(child, depth + 1)) : null,
        )
      }
      return h('div', { style: { overflow: 'auto', minHeight: 0, flex: 1, paddingBottom: 16 } },
        ...nodes.map((node) => renderNode(node)),
      )
    }

    function Workflow({ map, onGo, style }) {
      if (!map) return null
      const volumes = map.plot?.volumes ?? []
      const chapters = volumes.flatMap((volume) => volume.chapters ?? [])
      const manuscripts = chapters.filter((chapter) => chapter.hasManuscript).length
      const summaries = chapters.filter((chapter) => chapter.hasSummary).length
      const steps = [
        { key: 'world', label: '设定', count: map.world?.length ?? 0, done: (map.world?.length ?? 0) > 0 },
        { key: 'character', label: '人物', count: map.characters?.length ?? 0, done: (map.characters?.length ?? 0) > 0 },
        { key: 'volume', label: '分卷', count: volumes.length, done: volumes.length > 0 },
        { key: 'chapter', label: '章卡', count: chapters.length, done: chapters.length > 0 },
        { key: 'manuscript', label: '正文', count: manuscripts, total: chapters.length, done: chapters.length > 0 && manuscripts >= chapters.length },
        { key: 'continuity', label: '连续性', count: summaries, total: chapters.length, done: chapters.length > 0 && summaries >= chapters.length },
      ]
      return h('div', { style: { display: 'grid', gap: 2, padding: '4px 3px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
        h('div', { style: { fontSize: 11, opacity: 0.55, padding: '0 4px 4px' } }, '写作流程'),
        ...steps.map((step) => h('button', {
          key: step.key, type: 'button',
          onClick: () => onGo(step.key),
          style: {
            display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
            border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
            padding: '3px 4px', borderRadius: 5, fontSize: 12,
          },
        },
          h('span', { style: { width: 14, color: step.done ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' } }, step.done ? '✓' : '○'),
          h('span', { style: { flex: 1 } }, step.label),
          h('span', { style: { fontSize: 11, opacity: 0.6 } }, step.total !== undefined ? `${step.count}/${step.total}` : String(step.count)),
        )),
      )
    }

    function ProposalPanel({ proposal, onApply, onDiscard, busy, style }) {
      return h('div', { style: { display: 'grid', gap: 8, minHeight: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('strong', { style: { fontSize: 13 } }, '修改提案'),
          proposal ? h('span', { style: style.badge }, `${proposal.diff?.changes?.length ?? 0} 处差异`) : null,
          h('span', { style: { flex: 1 } }),
          proposal ? h(Btn, { kind: 'primary', disabled: busy, onClick: onApply }, '确认应用') : null,
          proposal ? h(Btn, { disabled: busy, onClick: onDiscard }, '放弃') : null,
        ),
        proposal
          ? h('div', { style: { display: 'grid', gap: 6, overflow: 'auto', minHeight: 0 } },
            h('div', { style: { ...style.muted, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, proposal.path),
            ...(proposal.diff?.changes ?? []).map((change) => h('div', {
              key: change.line,
              style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: 6, fontSize: 11, whiteSpace: 'pre-wrap', lineHeight: 1.5 },
            },
              h('div', { style: { opacity: 0.5, fontSize: 10, marginBottom: 2 } }, `第 ${change.line} 行`),
              change.before !== null ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, `- ${change.before}`) : null,
              change.after !== null ? h('div', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, `+ ${change.after}`) : null,
            )),
            proposal.diff?.truncated ? h('div', { style: style.muted }, '差异过多，只显示前 400 行。') : null,
          )
          : h('div', { style: { ...style.muted, border: '1px dashed var(--dsw-alias-border-l1)', borderRadius: 8, padding: 14, lineHeight: 1.8 } },
            '在左侧选择文档并编辑，然后点「生成修改提案」。这里会显示逐行差异，确认后才会写入文件。',
          ),
      )
    }

    function nextAction(map) {
      if (!map) return null
      const flow = map.workflow
      if (flow?.stage === 'opening') return { label: '让 AI 确定故事方向', kind: 'ai', taskTitle: '开始开书', taskBody: '项目还没有故事方向。先和用户讨论或给方向，把确认后的故事脊柱写进 plot/book.md；方向不定案前不要创建设定、人物、卷或章卡。', why: flow.next?.reason || '先定故事脊柱。' }
      if (flow?.stage === 'foundation') {
        const kind = flow.next?.kind === 'character' ? 'character' : 'world'
        return { label: flow.next?.label ?? '让 AI 补地基', kind: 'ai', taskTitle: kind === 'world' ? '补世界观' : '补人物', taskBody: kind === 'world' ? '读取已确认的故事方向，提出 1–3 条会影响人物选择的世界规则/势力/地点提案。' : '读取故事方向和已有设定，提出主角与关键人物的最小提案。', why: flow.next?.reason || '先补世界与人物。' }
      }
      if (flow?.stage === 'outline') return { label: '让 AI 规划第一卷和章卡', kind: 'ai', taskTitle: '规划第一卷', taskBody: '读取故事方向、设定和人物，先提出第一卷目标、舞台、阻力与前三章章卡；确认后原子创建。', why: flow.next?.reason || '先有卷和章卡。' }
      if (flow?.stage === 'writing') return { label: '让 AI 写下一章正文', kind: 'ai', taskTitle: '写下一章正文', taskBody: '读取缺失正文的章卡、出场人物、上一章交接和连续性；写本章正文提案。', why: flow.next?.reason || '章卡已就位。' }
      if (flow?.stage === 'continuity') return { label: '让 AI 补摘要与交接', kind: 'ai', taskTitle: '补摘要与交接', taskBody: '读取最近正文，补写章节摘要和下一章交接，写提案供确认。', why: flow.next?.reason || '正文完成后补连续性。' }
      if (flow?.stage === 'done') return { label: '查看连续性 / 规划下一卷', kind: 'ledger', why: '本卷主要产物已齐。' }
      const volumes = map.plot?.volumes ?? []
      const chapters = volumes.flatMap((volume) => volume.chapters ?? [])
      if ((map.world?.length ?? 0) === 0) return { label: '让 AI 补第一条设定', kind: 'ai', taskTitle: '补设定', taskBody: '读取项目构思和写作要求，判断当前最缺的 3–5 条会影响人物选择的世界规则/势力/地点；先给方案，确认后原子创建。', why: '先写会影响人物选择的世界规则、势力或地点。' }
      if ((map.characters?.length ?? 0) === 0) return { label: '让 AI 建立第一个人物', kind: 'ai', taskTitle: '补人物', taskBody: '根据故事脊柱和已有设定，补主角与关键关系人物；先给最小方案，确认后原子创建。', why: '先写主角的处境、欲望、恐惧和缺陷。' }
      if (volumes.length === 0) return { label: '让 AI 规划第一卷', kind: 'ai', taskTitle: '规划第一卷', taskBody: '根据构思和设定，提出第一卷目标、舞台、主要阻力和前 3 章章卡；先给方案，确认后原子创建。', why: '卷是舞台和阶段目标；有了卷才能建章。' }
      if (chapters.length === 0) return { label: '让 AI 规划第一章章卡', kind: 'ai', taskTitle: '补章卡', taskBody: '在当前卷下提出前 3 章章卡，每章写具体任务和状态变化；先给方案，确认后原子创建。', why: '章卡写本章任务，正文随后展开。' }
      const missing = chapters.find((chapter) => !chapter.hasManuscript)
      if (missing) return { label: `让 AI 写第 ${missing.order} 章正文`, kind: 'ai', taskTitle: '写下一章正文', taskBody: `读取第 ${missing.order} 章的章卡、出场人物、上一章交接和连续性；写本章正文提案，不要新增章卡之外的重大设定。`, why: '章卡已就位，先把这一章写成正文。' }
      if (chapters.some((chapter) => !chapter.hasSummary)) return { label: '让 AI 补章节摘要与交接', kind: 'ai', taskTitle: '补摘要与交接', taskBody: '读取最近已写正文，补写缺失的章节摘要和下一章交接，写提案供确认。', why: '把本章摘要、人物状态和下一章交接写进连续性账本。' }
      return { label: '查看连续性账本', kind: 'ledger', why: '当前章都已完成，检查连续性或继续规划下一卷。' }
    }

    function EmptyState({ map, onAction, style }) {
      const next = nextAction(map)
      return h('div', { style: { display: 'grid', gap: 12, padding: 14, alignContent: 'start' } },
        h('div', { style: { display: 'grid', gap: 4 } },
          h('h2', { style: { margin: 0, fontSize: 17 } }, '从左侧选择文档，或按下一步开始'),
          h('div', { style: style.muted }, '写作台不会自动生成整本。你可以在编辑区写，也可以回到对话让 Agent 按工具流程写。'),
        ),
        next ? h('div', { style: { ...style.card, borderColor: 'var(--dsw-alias-brand-primary)' } },
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 } }, '下一步'),
          h('div', { style: { fontWeight: 700, fontSize: 14 } }, next.label),
          h('div', { style: style.muted }, next.why),
          h('div', null, h(Btn, { kind: 'primary', onClick: () => onAction(next) }, next.label)),
        ) : null,
        h('div', { style: style.card },
          h('div', { style: { fontWeight: 600, fontSize: 12 } }, '也可以直接在对话里说'),
          h('div', { style: style.muted }, '例如：「先建三条江湖规矩和主角，然后建第一卷和前三章章卡。」Agent 会先读项目，再逐项创建和写提案。'),
        ),
      )
    }


    const PAGES = [
      { id: 'project', label: '项目', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },
      { id: 'premise', label: '构思', icon: 'M12 3a6 6 0 0 0-4 10v3h8v-3a6 6 0 0 0-4-10zM9 20h6' },
      { id: 'style', label: '文风', icon: 'M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0' },
      { id: 'bible', label: '设定', icon: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3zM5 4v16' },
      { id: 'outline', label: '大纲', icon: 'M5 5h14M5 12h14M5 19h9' },
      { id: 'chapters', label: '章节', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5' },
    ]

    function PageIcon({ path, active }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { opacity: active ? 1 : 0.65, flex: '0 0 auto' },
      }, h('path', { d: path }))
    }

    function bookReadiness(map) {
      if (map?.readiness && typeof map.readiness.ready === 'boolean') return map.readiness
      const missing = []
      if (!String(map?.genre ?? '').trim()) missing.push('题材')
      if (!String(map?.notes ?? '').trim()) missing.push('写作要求/核心方向')
      return { ready: missing.length === 0, missing }
    }

    function pageCounts(map) {
      const volumes = map?.plot?.volumes ?? []
      const chapters = volumes.flatMap((volume) => volume.chapters ?? [])
      return {
        world: map?.world?.length ?? 0,
        characters: map?.characters?.length ?? 0,
        volumes: volumes.length,
        chapters: chapters.length,
        manuscripts: chapters.filter((chapter) => chapter.hasManuscript).length,
        summaries: chapters.filter((chapter) => chapter.hasSummary).length,
      }
    }

    function Rail({ map, page, onPage, style }) {
      const counts = pageCounts(map)
      const hints = {
        project: `${counts.world + counts.characters}`,
        premise: '',
        style: `${Object.keys(map?.style ?? {}).length}`,
        bible: `${counts.world + counts.characters}`,
        outline: `${counts.volumes}`,
        chapters: `${counts.manuscripts}/${counts.chapters}`,
      }
      return h('div', { className: 'dn-nav' },
        h('div', { className: 'dn-nav-label' }, '工作台'),
        ...PAGES.map((item) => {
          const active = page === item.id
          return h('button', {
            key: item.id,
            type: 'button',
            onClick: () => onPage(item.id),
            className: `dn-nav-item${active ? ' active' : ''}`,
          },
            h('span', { className: 'dn-nav-icon' }, h(PageIcon, { path: item.icon, active })),
            h('span', { style: { flex: 1 } }, item.label),
            hints[item.id] ? h('span', { className: 'dn-nav-count' }, hints[item.id]) : null,
          )
        }),
      )
    }

    function DocTree({ map, doc, onOpen, style }) {
      const [filter, setFilter] = useState('')
      const [collapsed, setCollapsed] = useState({})
      const [openVolumes, setOpenVolumes] = useState({})
      if (!map) return null
      const query = filter.trim().toLowerCase()
      const matches = (value) => !query || String(value ?? '').toLowerCase().includes(query)
      const active = (kind, id) => doc?.kind === kind && doc?.id === id
      const volumes = map.plot?.volumes ?? []
      const activeGroup = ({ world: 'world', character: 'characters', volume: 'volumes', arc: 'volumes', chapter: 'volumes', manuscript: 'volumes', summary: 'volumes' })[doc?.kind] ?? ''
      const activeVolumeId = (() => {
        if (!doc) return ''
        if (doc.kind === 'volume') return doc.id
        if (!['arc', 'chapter', 'manuscript', 'summary'].includes(doc.kind)) return ''
        return volumes.find((volume) => (volume.chapters ?? []).some((chapter) => chapter.id === doc.id) || (volume.arcs ?? []).some((arc) => arc.id === doc.id))?.id ?? ''
      })()
      const groupOpen = (key) => query ? true : (collapsed[key] === undefined ? key === activeGroup : collapsed[key])
      const toggleGroup = (key) => setCollapsed((current) => ({ ...current, [key]: !groupOpen(key) }))
      const volumeOpen = (id) => query ? true : (openVolumes[id] ?? id === activeVolumeId)
      const row = (kind, id, label, hint, depth = 0) => h('button', {
        key: `${kind}:${id}`,
        type: 'button',
        title: hint || label,
        onClick: () => onOpen({ kind, id }),
        className: `dn-tree-row${active(kind, id) ? ' active' : ''}`,
        style: { paddingLeft: 8 + depth * 12 },
      },
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
        hint ? h('span', { style: { fontSize: 10, opacity: 0.5, whiteSpace: 'nowrap' } }, hint) : null,
      )
      const group = (key, label, count, children) => {
        if (query && children.length === 0) return null
        const open = groupOpen(key)
        return h('div', { key, style: { display: 'grid', gap: 1 } },
          h('button', { type: 'button', onClick: () => toggleGroup(key), className: 'dn-tree-group' },
            h('span', { style: { width: 10 } }, open ? '▾' : '▸'),
            h('span', { style: { flex: 1 } }, label),
            h('span', { className: 'dn-tree-count' }, String(count)),
          ),
          open ? h('div', { style: { display: 'grid', gap: 1 } }, ...children) : null,
        )
      }
      const worldItems = (map.world ?? []).filter((item) => matches(item.title) || matches(item.category))
      const characterItems = (map.characters ?? []).filter((item) => matches(item.name) || matches(item.role))
      const volumeItems = volumes.filter((volume) => matches(volume.title) || (volume.chapters ?? []).some((chapter) => matches(chapter.title)))
      return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } },
        h('input', {
          className: 'dn-tree-filter',
          value: filter,
          placeholder: '筛选文档…',
          onChange: (event) => setFilter(event.target.value),
        }),
        h('div', { style: { overflow: 'auto', minHeight: 0, padding: '2px 2px 12px' } },
          matches('全书主线') || !query ? row('book', 'book', '全书主线', '故事脊柱') : null,
          group('world', '设定', map.world?.length ?? 0, worldItems.map((item) => row('world', item.id, item.title, item.category ?? '', 1))),
          group('characters', '人物', map.characters?.length ?? 0, characterItems.map((item) => row('character', item.id, item.name, item.role ?? '', 1))),
          group('volumes', '分卷', volumes.length, volumeItems.flatMap((volume) => {
            const volumeMatches = matches(volume.title)
            const chapterItems = (volume.chapters ?? []).filter((chapter) => volumeMatches || matches(chapter.title))
            const arcItems = (volume.arcs ?? []).filter((arc) => volumeMatches || matches(arc.title))
            const open = volumeOpen(volume.id)
            return [
              h('div', { key: `volume-head:${volume.id}`, style: { display: 'flex', alignItems: 'center' } },
                h('button', {
                  type: 'button',
                  title: open ? '收起本卷' : '展开本卷',
                  onClick: () => setOpenVolumes((current) => ({ ...current, [volume.id]: !open })),
                  className: 'dn-tree-row',
                  style: { flex: '0 0 24px', paddingLeft: 8, paddingRight: 0, opacity: 0.55 },
                }, open ? '▾' : '▸'),
                h('button', {
                  type: 'button',
                  onClick: () => onOpen({ kind: 'volume', id: volume.id }),
                  className: `dn-tree-row${active('volume', volume.id) ? ' active' : ''}`,
                  style: { flex: 1, paddingLeft: 2 },
                },
                  h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, volume.title),
                  h('span', { style: { fontSize: 10, opacity: 0.5 } }, `${(volume.chapters ?? []).length} 章`),
                ),
              ),
              open ? h('div', { style: { display: 'grid', gap: 1, paddingLeft: 14 } },
                ...arcItems.map((arc) => row('arc', arc.id, arc.title, '剧情点', 1)),
                ...chapterItems.map((chapter) => row('chapter', chapter.id, `${chapter.order}. ${chapter.title}`, chapter.hasManuscript ? '✓' : '○', 1)),
              ) : null,
            ]
          })),
          h('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '8px 4px' } }),
          matches('连续性账本') || !query ? row('ledger', 'ledger', '连续性账本') : null,
        ),
      )
    }

    function Sidebar({ map, page, doc, onPage, onOpen, style }) {
      return h('div', { className: 'dn-rail' },
        h(Rail, { map, page, onPage, style }),
        h('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '4px 8px 0' } }),
        h('div', { className: 'dn-tree-head' }, '项目文档'),
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '0 6px 12px' } },
          h(DocTree, { map, doc, onOpen, style }),
        ),
      )
    }

    const FLOW_STEPS = [
      { key: 'opening', label: '方向' },
      { key: 'foundation', label: '地基' },
      { key: 'outline', label: '结构' },
      { key: 'writing', label: '写作' },
      { key: 'continuity', label: '连续性' },
    ]

    function StepRail({ flow }) {
      const active = FLOW_STEPS.findIndex((step) => step.key === flow.stage)
      const current = active < 0 ? FLOW_STEPS.length - 1 : active
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
        ...FLOW_STEPS.map((step, index) => {
          const done = index < current || flow.stage === 'done'
          const activeStep = index === current && flow.stage !== 'done'
          return h('div', { key: step.key, style: { display: 'flex', alignItems: 'center', gap: 4 } },
            h('span', {
              style: {
                width: 19, height: 19, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
                background: done ? 'var(--dsw-alias-state-success-primary)' : activeStep ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
                color: done || activeStep ? '#fff' : 'var(--dsw-alias-label-secondary)',
              },
            }, done ? '✓' : String(index + 1)),
            h('span', { style: { fontSize: 11, fontWeight: activeStep ? 700 : 500, opacity: activeStep ? 1 : 0.6 } }, step.label),
            index < FLOW_STEPS.length - 1 ? h('span', { style: { width: 14, height: 1, background: 'var(--dsw-alias-border-l1)' } }) : null,
          )
        }),
      )
    }

    function FlowGuide({ map, onAction, style }) {
      const flow = map?.workflow
      if (!flow) return null
      return h('div', { className: 'dn-card dn-flow-card', style: { marginBottom: 2, gap: 9 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h(StepRail, { flow }),
          h('span', { style: { flex: 1 } }),
          h(Btn, { kind: 'primary', title: flow.next?.reason ?? '', onClick: onAction }, flow.next?.label ?? '查看连续性'),
        ),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          flow.goal ? h('span', { style: { fontSize: 11, fontWeight: 600, opacity: 0.75 } }, flow.goal) : null,
          ...(flow.checklist ?? []).map((item) => h('span', {
            key: item.key,
            style: { ...style.badge, fontSize: 10, color: item.done ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' },
          }, `${item.done ? '✓' : '○'} ${item.label}`)),
        ),
      )
    }

    const STYLE_LABELS = {
      pov: '视角', tense: '时态', voice: '叙述声音', diction: '用词', pacing: '节奏',
      dialogueStyle: '对白', sensoryFocus: '感官重点', must: '必须', never: '禁止', adjust: '调整', notes: '备注',
    }

    function PageView({ map, page, style, onOpen, onTask, onSettings, onEditBook, onPlanBook, onNavigate = () => {} }) {
      const counts = pageCounts(map)
      const flow = map?.workflow ?? null
      const allowed = (key) => flow?.allowed?.[key] !== false
      const gateReason = (key) => allowed(key) ? '' : (flow?.next?.reason ?? '当前阶段还不能做这件事。')
      const volumes = map?.plot?.volumes ?? []
      const chapters = volumes.flatMap((volume) => volume.chapters ?? [])
      const taskButton = (label, title, body, options = {}) => h(Btn, {
        disabled: options.gate ? !allowed(options.gate) : false,
        title: options.gate ? gateReason(options.gate) : undefined,
        onClick: () => onTask(title, body, options),
      }, label)
      const titleRow = (title, extra) => h('div', { className: 'dn-page-head' },
        h('h2', { className: 'dn-section-title' }, title),
        h('span', { style: { flex: 1 } }),
        extra ?? null,
      )

      if (page === 'project') {
        const cards = [
          ['设定', counts.world], ['人物', counts.characters], ['分卷', counts.volumes],
          ['章卡', counts.chapters], ['正文', counts.manuscripts], ['摘要', counts.summaries],
        ]
        return h('div', { style: { display: 'grid', gap: 12, padding: 14, overflow: 'auto', alignContent: 'start' } },
          titleRow('项目'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gap: 8 } },
            ...cards.map(([label, count]) => h('div', { key: label, style: { ...style.card, alignItems: 'center', textAlign: 'center' } },
              h('div', { style: { fontSize: 18, fontWeight: 700 } }, String(count)),
              h('div', { style: { fontSize: 11, opacity: 0.6 } }, label),
            )),
          ),
          flow?.direction
            ? h('div', { style: { ...style.card, display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: { ...style.badge, color: 'var(--dsw-alias-state-success-primary)' } }, '方向 ✓'),
              h('span', { style: { flex: 1, fontWeight: 600 } }, '故事方向已定'),
              h(Btn, { onClick: () => onNavigate('premise') }, '去构思页'),
            )
            : h('div', { style: style.card },
              h('div', { style: { fontWeight: 700 } }, '还没有故事方向'),
              h('div', { style: { marginTop: 8 } }, h(Btn, { kind: 'primary', onClick: onPlanBook }, '开始开书')),
            ),
          h('div', { style: { ...style.card, display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { flex: 1, fontWeight: 600 } }, '项目设置'),
            h(Btn, { onClick: onSettings }, '打开'),
          ),
        )
      }

      if (page === 'premise') {
        return h('div', { style: { display: 'grid', gap: 12, padding: 14, overflow: 'auto', alignContent: 'start' } },
          titleRow('构思', h('span', { style: style.muted }, 'plot/book.md')),
          h('div', { style: style.card },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('div', { style: { fontWeight: 700, flex: 1 } }, '全书主线'),
              h(Btn, { onClick: onEditBook }, '编辑'),
            ),
            h('div', {
              style: { whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 12, maxHeight: 240, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 7, padding: 9, marginTop: 8 },
            }, flow?.directionExcerpt || '还没有故事方向。'),
            flow?.direction
              ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
                taskButton('继续讨论', '讨论故事脊柱', '基于当前 plot/book.md 继续讨论主角欲望、持续压力、变化方式；不要直接写正文。'),
                taskButton('整理成文档', '整理故事脊柱', '把当前讨论和已确认内容整理成 plot/book.md 的提案；不要引入未确认的新设定。'),
              )
              : h('div', { style: { marginTop: 8 } },
                h(Btn, { kind: 'primary', onClick: onPlanBook }, '让 AI 定故事方向'),
              ),
          ),
        )
      }

      if (page === 'style') {
        const keys = Object.keys(STYLE_LABELS)
        const filled = keys.filter((key) => map?.style?.[key] !== undefined && map.style[key] !== '')
        return h('div', { style: { display: 'grid', gap: 12, padding: 14, overflow: 'auto', alignContent: 'start' } },
          titleRow('文风'),
          h('div', { style: style.card },
            filled.length
              ? h('div', null,
                ...filled.map((key) => h('div', { key, style: { display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, fontSize: 12, borderTop: '1px solid var(--dsw-alias-border-l1)', padding: '5px 0' } },
                  h('span', { style: { opacity: 0.55 } }, STYLE_LABELS[key] ?? key),
                  h('span', { style: { whiteSpace: 'pre-wrap' } }, Array.isArray(map.style[key]) ? map.style[key].join('；') : String(map.style[key])),
                )),
              )
              : h('div', null,
                h('div', { style: { fontWeight: 700 } }, '还没有文风契约'),
                h('div', { style: { marginTop: 8 } },
                  taskButton('让 AI 提炼文风', '提炼文风', '根据项目写作要求、已有正文或用户提供的样本，提炼可执行的文风字段；先给方案，确认后再改 manifest.style。', { gate: 'style' }),
                ),
              ),
            filled.length ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
              taskButton('让 AI 提炼', '提炼文风', '根据项目写作要求、已有正文或用户提供的样本，提炼可执行的文风字段；先给方案，确认后再改 manifest.style。', { gate: 'style' }),
              taskButton('检查一致性', '检查文风一致性', '读取最近正文，找出与文风契约冲突的表达习惯，给具体修改建议；不要自动改正文。', { gate: 'style' }),
            ) : null,
          ),
        )
      }

      if (page === 'bible') {
        const list = (items, kind) => items.length
          ? items.map((item) => h('button', {
            key: item.id, type: 'button',
            style: { ...style.treeRow, display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' },
            onClick: () => onOpen({ kind, id: item.id }),
          },
            h('span', { style: { flex: 1 } }, kind === 'world' ? item.title : item.name),
            h('span', { style: style.muted }, String(kind === 'world' ? item.category ?? '' : item.role ?? '')),
          ))
          : h('div', { style: style.muted }, kind === 'world' ? '还没有世界规则。' : '还没有人物。')
        return h('div', { style: { display: 'grid', gap: 12, padding: 14, overflow: 'auto', alignContent: 'start' } },
          titleRow('设定'),
          h('div', { style: style.card },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('div', { style: { fontWeight: 700, flex: 1 } }, `世界观 ${counts.world}`),
              taskButton('让 AI 补', '补世界观', '读取已确认的构思和写作要求，判断当前最缺的 3–5 条会影响人物选择的世界规则/势力/地点，逐条写提案。', { gate: 'world' }),
            ),
            list(map.world ?? [], 'world'),
          ),
          h('div', { style: style.card },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('div', { style: { fontWeight: 700, flex: 1 } }, `人物 ${counts.characters}`),
              taskButton('让 AI 补', '补人物', '根据故事脊柱和已有设定，补主角与关键关系人物；每个人物写处境、欲望、恐惧、缺陷和关系。', { gate: 'character' }),
            ),
            list(map.characters ?? [], 'character'),
          ),
        )
      }

      if (page === 'outline') {
        const planVolume = taskButton('让 AI 规划第一卷', '规划第一卷', '根据已确认构思和设定，先提出第一卷目标、舞台、主要阻力和前 3 章章卡；每章写具体任务。', { gate: 'volume' })
        return h('div', { style: { display: 'grid', gap: 12, padding: 14, overflow: 'auto', alignContent: 'start' } },
          titleRow('大纲', volumes.length ? taskButton('检查重复', '检查结构重复', '读取现有卷/章卡，检查是否连续重复同一活动、同一决策轴或同一类冲突，指出范围并给调整建议。', { gate: 'volume' }) : null),
          volumes.length === 0
            ? h('div', { style: style.card }, h('div', { style: { fontWeight: 700 } }, '还没有分卷'), h('div', { style: { marginTop: 8 } }, planVolume))
            : volumes.map((volume) => h('div', { key: volume.id, style: style.card },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('button', { type: 'button', style: { ...style.treeRow, flex: 1, fontWeight: 700 }, onClick: () => onOpen({ kind: 'volume', id: volume.id }) }, volume.title),
                h(Btn, { disabled: !allowed('chapter'), title: gateReason('chapter'), onClick: () => onTask('补本卷章卡', `读取《${volume.title}》的目标和现有章卡，补 2–3 章章卡提案；先给方案，确认后原子创建。`) }, '补章卡'),
              ),
              (volume.arcs ?? []).length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
                ...volume.arcs.map((arc) => h('button', { key: arc.id, type: 'button', style: { ...style.addButton, padding: '4px 8px' }, onClick: () => onOpen({ kind: 'arc', id: arc.id }) }, arc.title)),
              ) : null,
              (volume.chapters ?? []).length ? h('div', { style: { display: 'grid', gap: 4, marginTop: 6 } },
                ...volume.chapters.map((chapter) => h('div', { key: chapter.id, style: { display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 4 } },
                  h('button', { type: 'button', style: { ...style.treeRow, flex: 1 }, onClick: () => onOpen({ kind: 'chapter', id: chapter.id }) }, `${chapter.order}. ${chapter.title}`),
                  h('span', { style: { fontSize: 10, opacity: 0.6 } }, chapter.hasManuscript ? '正文 ✓' : '正文 ○'),
                  h('button', {
                    type: 'button', style: style.addButton,
                    disabled: !chapter.hasManuscript && !allowed('manuscript'),
                    title: !chapter.hasManuscript ? gateReason('manuscript') : '',
                    onClick: () => chapter.hasManuscript ? onOpen({ kind: 'manuscript', id: chapter.id }) : onTask('写下一章正文', `读取第 ${chapter.order} 章的章卡、出场人物、上一章交接和连续性；写本章正文提案。`),
                  }, chapter.hasManuscript ? '看正文' : '让 AI 写'),
                )),
              ) : h('div', { style: style.muted }, '还没有章卡。'),
            )),
        )
      }

      const missingManuscript = chapters.find((chapter) => !chapter.hasManuscript)
      const missingSummary = chapters.find((chapter) => !chapter.hasSummary)
      const nextChapter = missingManuscript ?? missingSummary ?? chapters[0]
      const nextLabel = !nextChapter
        ? '让 AI 规划第一卷和章卡'
        : missingManuscript
          ? `让 AI 写第 ${nextChapter.order} 章正文`
          : missingSummary
            ? `让 AI 补第 ${nextChapter.order} 章摘要`
            : `打开第 ${nextChapter.order} 章摘要`
      const canNext = nextChapter
        ? missingManuscript ? allowed('manuscript') : missingSummary ? allowed('continuity') : true
        : allowed('chapter')
      const nextAction = () => {
        if (!nextChapter) return onTask('规划第一章章卡', '当前没有章卡；先读构思与设定，提出第一卷和前三章章卡方案，确认后原子创建。')
        if (missingManuscript) return onTask('写下一章正文', `读取第 ${nextChapter.order} 章的章卡、出场人物、上一章交接和连续性；写本章正文提案。`)
        if (missingSummary) return onTask('补章节摘要', `读取第 ${nextChapter.order} 章正文，补摘要和下一章交接，写提案供确认。`)
        return onOpen({ kind: 'summary', id: nextChapter.id })
      }
      return h('div', { style: { display: 'grid', gap: 12, padding: 14, overflow: 'auto', alignContent: 'start' } },
        titleRow('章节', chapters.length ? taskButton('检查连续性', '检查连续性', '读取最近章节、摘要和连续性账本，检查事实、知情和交接是否一致；只报告，不自动改正文。', { gate: 'continuity' }) : null),
        h('div', { style: style.card },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontWeight: 700, flex: 1 } }, nextChapter ? `下一章 · ${nextChapter.order}. ${nextChapter.title}` : '还没有章节'),
            nextChapter ? h('span', { style: style.badge }, missingManuscript ? '待正文' : missingSummary ? '待摘要' : '已完成') : null,
            h(Btn, { kind: 'primary', disabled: !canNext, title: canNext ? '' : gateReason(missingManuscript ? 'manuscript' : 'chapter'), onClick: nextAction }, nextLabel),
          ),
        ),
        chapters.length === 0
          ? null
          : h('div', { style: style.card },
            ...chapters.map((chapter) => h('div', { key: chapter.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
              h('button', { type: 'button', style: { ...style.treeRow, flex: 1 }, onClick: () => onOpen({ kind: 'chapter', id: chapter.id }) }, `${chapter.order}. ${chapter.title}`),
              h('span', { style: { ...style.badge, opacity: chapter.hasManuscript ? 0.9 : 0.5 } }, chapter.hasManuscript ? '正文 ✓' : '正文 ○'),
              h('span', { style: { ...style.badge, opacity: chapter.hasSummary ? 0.9 : 0.5 } }, chapter.hasSummary ? '摘要 ✓' : '摘要 ○'),
              chapter.hasManuscript ? h('button', { type: 'button', style: style.addButton, onClick: () => onOpen({ kind: 'manuscript', id: chapter.id }) }, '正文') : null,
            )),
          ),
      )
    }

    function LedgerView({ text, style, onTask, allowed }) {
      const [raw, setRaw] = useState(false)
      let data = null
      try { data = JSON.parse(text || '{}') } catch { data = null }
      const sections = [
        ['facts', '已确认事实'],
        ['knowledge', '知情状态'],
        ['foreshadow', '伏笔'],
        ['timeline', '时间线'],
        ['handoffs', '章节交接'],
      ]
      const valueText = (value) => typeof value === 'string' ? value : JSON.stringify(value)
      const filled = sections.reduce((total, [key]) => total + (Array.isArray(data?.[key]) ? data[key].length : 0), 0)
      return h('div', { style: { display: 'grid', gap: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { ...style.badge, color: filled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' } }, filled ? `${filled} 条记录` : '空账本'),
          data?.updatedAt ? h('span', { style: style.muted }, `更新于 ${data.updatedAt}`) : null,
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: style.addButton, onClick: () => setRaw((value) => !value) }, raw ? '结构化视图' : '原始 JSON'),
        ),
        !data ? h('div', { style: style.card }, h('div', { style: { fontWeight: 700 } }, '账本格式无法读取'), h('div', { style: style.muted }, '请让 AI 修复连续性账本，或查看原始 JSON。'))
          : filled === 0
            ? h('div', { style: style.card },
              h('div', { style: { fontWeight: 700 } }, '还没有连续性记录'),
              h('div', { style: style.muted }, '它会记录已确认事实、人物知情、伏笔、时间线和章节交接，供 AI 写后续章节时读取。'),
              allowed('continuity') ? h('div', null, h(Btn, { kind: 'primary', onClick: () => onTask('整理连续性', '读取最近正文，补写事实、知情、伏笔、时间线和章节交接，写提案供确认。') }, '让 AI 整理连续性')) : null,
            )
            : raw
              ? h('pre', { style: { margin: 0, padding: 18, borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1)', overflow: 'auto', fontSize: 12, lineHeight: 1.6 } }, text)
              : h('div', { style: { display: 'grid', gap: 10 } },
                ...sections.map(([key, title]) => {
                  const items = Array.isArray(data?.[key]) ? data[key] : []
                  return h('div', { key, className: 'dn-card' },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                      h('strong', { style: { fontSize: 13, flex: 1 } }, title),
                      h('span', { className: 'dn-tree-count' }, String(items.length)),
                    ),
                    items.length
                      ? h('div', { style: { display: 'grid', gap: 4 } }, ...items.map((item, index) => h('div', { key: index, style: { fontSize: 12, lineHeight: 1.65, padding: '4px 0', borderTop: index ? '1px solid var(--dsw-alias-border-l1)' : 'none' } }, valueText(item))))
                      : h('div', { style: style.muted }, '暂无'),
                  )
                }),
              ),
      )
    }

    function DocumentContext({ doc, text, style, onJump }) {
      if (!doc) return null
      const headings = String(text ?? '').split(/\r?\n/)
        .map((line, index) => {
          const match = line.match(/^(#{1,4})\s+(.*)$/)
          return match ? { level: match[1].length, title: match[2], index } : null
        })
        .filter(Boolean)
      const headingIndexes = headings.map((item, index) => ({ ...item, index }))
      const chars = String(text ?? '').replace(/\s/g, '').length
      return h('div', { style: { display: 'grid', gap: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('strong', { style: { fontSize: 13 } }, '文档信息'),
          h('span', { style: { ...style.badge, fontSize: 10 } }, kindLabel(doc.kind)),
        ),
        h('div', { style: { display: 'grid', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          h('div', null, `路径：${doc.path ?? `${doc.kind}/${doc.id}.md`}`),
          h('div', null, `${chars} 字 · ${String(text ?? '').split(/\r?\n/).length} 行`),
        ),
        h('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '2px 0' } }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('strong', { style: { fontSize: 13 } }, '本文目录'),
          h('span', { style: { fontSize: 10, opacity: 0.5 } }, String(headings.length)),
        ),
        headings.length
          ? h('div', { style: { display: 'grid', gap: 1 } },
            ...headingIndexes.map((heading) => h('button', {
              key: heading.index,
              type: 'button',
              onClick: () => onJump(heading.index),
              style: {
                ...style.treeRow,
                paddingLeft: 4 + (heading.level - 1) * 12,
                whiteSpace: 'normal', lineHeight: 1.5, fontSize: 11,
              },
            }, heading.title)),
          )
          : h('div', { style: { fontSize: 11, opacity: 0.5 } }, '本文没有标题'),
      )
    }

    class DeskErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        try { console.error('DeepNovel UI error', error, info) } catch {}
      }

      render() {
        if (this.state.error) {
          return h('div', { style: { padding: 20, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-state-error-primary)' } },
            '写作台渲染失败：',
            '\n\n',
            String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error),
          )
        }
        return this.props.children
      }
    }

    function DeskRoot(props) {
      return h(DeskErrorBoundary, null, h('style', null, DESIGN_CSS), h(App, props))
    }

    function App(props) {
      const style = useStyles()
      const workspaceItems = props && typeof props.useWorkspaces === 'function'
        ? props.useWorkspaces((state) => Array.isArray(state?.items) ? state.items : [])
        : null
      const [root, setRoot] = useState(() => localStorage.getItem(ROOT_KEY) ?? '')
      const [pathDraft, setPathDraft] = useState(root)
      const [recent, setRecent] = useState(loadRecent)
      const [tree, setTree] = useState(null)
      const [doc, setDoc] = useState(null)
      const [text, setText] = useState('')
      const [proposal, setProposal] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [activity, setActivity] = useState('')
      const [dialog, setDialog] = useState(null)
      const [form, setForm] = useState({})
      const [page, setPage] = useState('project')
      const [searchQuery, setSearchQuery] = useState('')
      const [searchResults, setSearchResults] = useState([])
      const [searchBusy, setSearchBusy] = useState(false)
      const [aiTask, setAiTask] = useState(null)
      const [lastSessionId, setLastSessionId] = useState('')
      const [command, setCommand] = useState('')
      const [editorMode, setEditorMode] = useState('edit')
      const [saveState, setSaveState] = useState('saved')
      const dirty = Boolean(doc && text !== (doc.content ?? ''))
      const map = tree?.map ?? null
      const allowed = (key) => map?.workflow?.allowed?.[key] !== false

      useEffect(() => {
        if (!activity) return undefined
        const timer = setTimeout(() => setActivity(''), 5000)
        return () => clearTimeout(timer)
      }, [activity])

      useEffect(() => {
        setLastSessionId(root ? localStorage.getItem(`deepnovel.v2.session.${root}`) ?? '' : '')
        setAiTask(null)
      }, [root])

      const dispatchTask = async (prompt) => {
        const service = clientScope?.get?.('uiWorkspace') ?? null
        if (!service) throw new Error('当前环境不能创建写作会话')
        return dispatchTaskWith({
          service,
          workspaces: clientScope?.get?.('workspaces') ?? null,
          sessions: clientScope?.get?.('sessions') ?? null,
          workspaceItems,
          root,
          prompt,
          existingSessionId: lastSessionId,
        })
      }

      const loadTree = useCallback(async (target) => {
        const data = await api(`/deepnovel/api/tree?projectRoot=${encodeURIComponent(target)}`)
        setTree(data)
        return data
      }, [])

      useEffect(() => {
        if (!root) return undefined
        const refresh = () => { loadTree(root).catch(() => {}) }
        const timer = setInterval(refresh, 5000)
        const onFocus = () => refresh()
        const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [root, loadTree])

      const saveDoc = async (baseDoc = doc, value = text) => {
        if (!baseDoc) return
        setSaveState('saving')
        try {
          const result = await api('/deepnovel/api/save', {
            method: 'POST',
            body: JSON.stringify({
              projectRoot: root,
              kind: baseDoc.kind,
              id: baseDoc.kind === 'book' || baseDoc.kind === 'ledger' ? baseDoc.id : baseDoc.id,
              content: value,
              expectedHash: baseDoc.hash ?? null,
            }),
          })
          setDoc((current) => current && current.kind === baseDoc.kind && current.id === baseDoc.id
            ? { ...current, content: value, hash: result.hash }
            : current)
          setSaveState('saved')
        } catch (e) {
          setSaveState('error')
          setError(String(e?.message ?? e))
        }
      }

      useEffect(() => {
        if (!doc || !dirty) return undefined
        const timer = setTimeout(() => { void saveDoc(doc, text) }, 800)
        return () => clearTimeout(timer)
      }, [doc, text, dirty, root])

      const openProject = useCallback(async (target) => {
        const path = String(target ?? '').trim()
        if (!path) { setError('请输入项目目录'); return false }
        setBusy(true)
        setError('')
        try {
          await loadTree(path)
          localStorage.setItem(ROOT_KEY, path)
          setRoot(path)
          setPathDraft(path)
          setRecent(rememberRecent(path))
          setDialog(null)
          setDoc(null)
          setText('')
          setProposal(null)
          setPage('project')
          setActivity('已打开项目')
          return true
        } catch (e) {
          setError(String(e?.message ?? e))
          return false
        } finally {
          setBusy(false)
        }
      }, [loadTree])

      useEffect(() => {
        if (root) loadTree(root).catch((e) => setError(String(e?.message ?? e)))
      }, [])

      const chooseProject = async () => {
        setError('')
        const picked = await pickDirectory()
        if (!picked.supported) {
          setActivity('当前环境没有目录选择器，请用手动路径')
          return
        }
        if (!picked.path) { setActivity('已取消选择'); return }
        const opened = await openProject(picked.path)
        if (!opened) {
          setForm({ path: picked.path, title: basename(picked.path) })
          setDialog('init')
        }
      }

      const chooseNewProject = async () => {
        setError('')
        const picked = await pickDirectory()
        if (!picked.supported) {
          setActivity('当前环境没有目录选择器，请用手动路径')
          return
        }
        if (!picked.path) { setActivity('已取消选择'); return }
        setForm({ path: picked.path, title: basename(picked.path) })
        setDialog('init')
      }

      const submitInit = async () => {
        const path = String(form.path ?? '').trim()
        const title = String(form.title ?? '').trim() || basename(path)
        if (!path) { setError('请选择项目目录'); return }
        setBusy(true)
        setError('')
        try {
          await api('/deepnovel/api/init', { method: 'POST', body: JSON.stringify({ projectRoot: path, title, language: 'zh' }) })
          await openProject(path)
          setActivity('项目已创建')
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const openNode = async (node, { force = false } = {}) => {
        if (!root) return
        if (!force && dirty && !window.confirm('当前修改还没有保存，确定离开？')) return
        setError('')
        setProposal(null)
        try {
          const data = await api(`/deepnovel/api/doc?projectRoot=${encodeURIComponent(root)}&kind=${encodeURIComponent(node.kind)}&id=${encodeURIComponent(node.id ?? '')}`)
          setDoc(data)
          setText(data.content ?? '')
          setEditorMode('preview')
          setSaveState('saved')
          setActivity(`已打开 ${kindLabel(data.kind)}`)
        } catch (e) {
          setError(String(e?.message ?? e))
        }
      }

      const propose = async () => {
        if (!doc || !dirty) return
        setBusy(true)
        setError('')
        try {
          const result = await api('/deepnovel/api/propose', {
            method: 'POST',
            body: JSON.stringify({ projectRoot: root, kind: doc.kind, id: doc.kind === 'book' ? 'book' : doc.id, content: text }),
          })
          setProposal(result)
          setActivity('提案已生成，确认后写入')
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const applyProposal = async () => {
        if (!proposal) return
        setBusy(true)
        try {
          const result = await api('/deepnovel/api/apply', {
            method: 'POST',
            body: JSON.stringify({ projectRoot: root, proposalId: proposal.id, confirm: true }),
          })
          if (result.applied === false) {
            setError(`未应用：${result.reason ?? '内容已变化'}，请重新读取后再提案。`)
          } else {
            setActivity('已应用')
            setProposal(null)
            await loadTree(root)
            await openNode({ kind: doc.kind, id: doc.id }, { force: true })
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const saveMeta = async () => {
        setBusy(true)
        setError('')
        try {
          await api('/deepnovel/api/meta', {
            method: 'POST',
            body: JSON.stringify({ projectRoot: root, title: form.title, genre: form.genre, language: form.language, notes: form.notes }),
          })
          await loadTree(root)
          setDialog(null)
          setActivity('项目设置已保存')
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const downloadExport = async () => {
        setBusy(true)
        setError('')
        try {
          const data = await api('/deepnovel/api/export', {
            method: 'POST',
            body: JSON.stringify({ projectRoot: root }),
          })
          const blob = new Blob([data.content], { type: 'text/markdown;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = data.filename || 'novel.md'
          anchor.click()
          URL.revokeObjectURL(url)
          setActivity('Markdown 已导出')
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const runSearch = async () => {
        const query = String(searchQuery ?? '').trim()
        if (!query) return
        setSearchBusy(true)
        setError('')
        try {
          const data = await api('/deepnovel/api/search', {
            method: 'POST',
            body: JSON.stringify({ projectRoot: root, query, limit: 30 }),
          })
          setSearchResults(data.results ?? [])
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setSearchBusy(false)
        }
      }

      const openTask = (title, body, options = {}) => {
        const service = uiWorkspace()
        if (!service?.startSession && !service?.connectWorkspace) {
          setError('当前环境不能从写作台打开 DSH 对话；请在主对话里选择 DeepNovel 写作预设后直接说任务。')
          return
        }
        const prompt = buildTaskPrompt(title, root, body)
        setError('')
        setActivity('正在创建写作会话并发送任务…')
        setAiTask({ state: 'sending', title })
        dispatchTask(prompt).then((sessionId) => {
          setLastSessionId(sessionId)
          try { localStorage.setItem(`deepnovel.v2.session.${root}`, sessionId) } catch {}
          setAiTask({ state: 'sent', title, sessionId })
          setActivity('任务已发送到正常写作对话')
        }).catch((error) => {
          const message = String(error?.message ?? error)
          setAiTask({ state: 'failed', title, error: message })
          setActivity('任务未能自动发送')
          setError(`无法自动发送任务：${message}。已保留任务文本；请打开写作对话后手动发送。`)
          try { navigator.clipboard?.writeText(prompt) } catch {}
          try {
            service.startSession?.(undefined, {
              agentPreset: 'novel-writer',
              prompt,
              clearPreviousDraft: true,
              whenDraftExists: 'replace',
            })
          } catch {}
        })
      }

      const runCommand = () => {
        const text = String(command ?? '').trim()
        if (!text) return
        openTask('自定义任务', text)
        setCommand('')
      }

      const runWorkflow = () => {
        const flow = tree?.map?.workflow
        const next = flow?.next
        if (!next) return
        if (next.kind === 'done') return openNode({ kind: 'ledger', id: 'ledger' })
        const bodies = {
          direction: '项目还没有故事方向。先和用户讨论或给方向，把确认后的故事脊柱写进 plot/book.md；方向未定案前不要创建设定、人物、卷或章卡。',
          world: '读取已确认的故事方向，判断当前最缺的 1–3 条会影响人物选择的世界规则/势力/地点，先给提案。',
          character: '根据故事方向和已有设定，设计主角与关键关系人物；写清处境、欲望、恐惧、缺陷和关系。',
          outline: '读取故事方向、设定和人物，先给第一卷目标、舞台、阻力与 2–3 张章卡方案；确认后原子创建。',
          manuscript: '读取缺失正文的章卡、出场人物、上一章交接和连续性；写本章正文提案。',
          continuity: '读取最近正文，补写章节摘要和下一章交接，写提案供确认。',
        }
        openTask(next.label, bodies[next.kind] ?? next.reason ?? '按当前阶段继续推进。')
      }

      const planBook = () => {
        openTask('开始开书', '这是开书任务，不是直接写作任务。先读取项目已有信息；如果题材、写作要求、主角方向等信息不足，先用 1–3 个问题或 2–3 个方向让用户选择，不要直接创建对象。方向确认后，先给 3–5 条最小开书方案（设定、人物、第一卷、前三章），等用户确认后再用 novel_create 创建原子提案。不要一次生成整本。')
      }

      const copyPath = async () => {
        try {
          await navigator.clipboard.writeText(root)
          setActivity('项目路径已复制')
        } catch {
          setActivity(root)
        }
      }

      const header = h('div', { className: 'dn-top' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, flex: '0 0 auto' } },
          h('span', { style: { width: 27, height: 27, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--dsw-alias-brand-primary)', color: '#fff', fontSize: 12, fontWeight: 800 } }, 'D'),
          h('strong', { style: { whiteSpace: 'nowrap', fontSize: 15, letterSpacing: 0.2 } }, 'DeepNovel'),
        ),
        tree?.map ? h('button', {
          type: 'button', title: '点击复制项目路径', onClick: copyPath,
          style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', minWidth: 0, flex: 1, padding: '0 4px' },
        },
          h('div', { style: { fontWeight: 650, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tree.map.title),
          h('div', { style: { fontSize: 10, opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, root),
        ) : h('span', { style: { flex: 1 } }),
        tree?.map ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('input', {
            style: { ...style.input, width: 320, padding: '7px 11px', fontSize: 12, borderRadius: 8 },
            value: command,
            placeholder: '告诉 AI 下一步要做什么…',
            onChange: (e) => setCommand(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') runCommand() },
          }),
          h(Btn, { kind: 'primary', disabled: busy || !command.trim(), onClick: runCommand }, '发送'),
        ) : null,
        tree?.map ? h('span', { style: { ...style.badge, color: 'var(--dsw-alias-brand-primary)', borderColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent)' } }, `阶段 · ${stageLabel(tree.map.workflow?.stage ?? tree.map.stage)}`) : null,
        aiTask ? h('span', { style: style.badge }, `${aiTask.state === 'sending' ? 'AI 发送中' : aiTask.state === 'sent' ? 'AI 已发送' : 'AI 发送失败'}`) : null,
        (lastSessionId || aiTask?.sessionId) ? h(Btn, { onClick: () => {
          const sessionId = aiTask?.sessionId || lastSessionId
          try { uiWorkspace()?.openSession?.(sessionId) } catch (e) { setError(String(e?.message ?? e)) }
        } }, '写作对话') : null,
        tree?.map ? h(Btn, { title: '项目操作', onClick: () => setDialog('menu') }, '⋯') : null,
      )

      if (!root || !tree) {
        return h('div', { className: 'dn-app' },
          header,
          h(Welcome, {
            draft: pathDraft, setDraft: setPathDraft, recent, busy, error, activity, style,
            onChoose: chooseProject, onInit: chooseNewProject,
            onOpen: (path) => openProject(path),
          }),
          dialog === 'init' ? h(Modal, {
            title: '新建项目', subtitle: '目录会创建 deepnovel.json、plot、world、characters、manuscript 等结构。', onClose: () => setDialog(null),
          },
            h(Field, { label: '项目目录' },
              h('div', { style: { display: 'flex', gap: 6 } },
                h('input', { style: style.input, value: form.path ?? '', onChange: (e) => setForm((c) => ({ ...c, path: e.target.value })) }),
                h(Btn, { onClick: async () => {
                  const picked = await pickDirectory()
                  if (picked.path) setForm((c) => ({ ...c, path: picked.path, title: c.title || basename(picked.path) }))
                } }, '选择'),
              ),
            ),
            h(Field, { label: '书名' }, h('input', { style: style.input, value: form.title ?? '', onChange: (e) => setForm((c) => ({ ...c, title: e.target.value })) })),
            h(ErrorBox, { message: error }),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
              h(Btn, { onClick: () => setDialog(null) }, '取消'),
              h(Btn, { kind: 'primary', disabled: busy, onClick: submitInit }, '创建项目'),
            ),
          ) : null,
        )
      }

      const flatChapters = (map?.plot?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
      const chapterIndex = doc && ['chapter', 'manuscript', 'summary'].includes(doc.kind)
        ? flatChapters.findIndex((chapter) => chapter.id === doc.id)
        : -1
      const lines = text ? text.split(/\r?\n/).length : 0

      return h('div', { className: 'dn-app' },
        header,
        h('div', { className: 'dn-body' },
          h(Sidebar, { map, page, doc, onPage: (nextPage) => { if (dirty && !window.confirm('当前修改还没有保存，确定离开？')) return; setPage(nextPage); setDoc(null); setProposal(null) }, onOpen: openNode, style }),
          h('div', { className: 'dn-stage' },
            h('div', { className: 'dn-stage-inner' },
            !doc ? h(FlowGuide, { map, onAction: runWorkflow, style }) : null,
            doc ? h('div', { className: 'dn-editor-head' },
              chapterIndex >= 0 ? h(Btn, {
                disabled: chapterIndex <= 0,
                onClick: () => {
                  const previous = flatChapters[chapterIndex - 1]
                  if (previous) openNode({ kind: doc.kind, id: previous.id }, { force: true })
                },
              }, '上一章') : null,
              chapterIndex >= 0 ? h(Btn, {
                disabled: chapterIndex >= flatChapters.length - 1,
                onClick: () => {
                  const next = flatChapters[chapterIndex + 1]
                  if (next) openNode({ kind: doc.kind, id: next.id }, { force: true })
                },
              }, '下一章') : null,
              h('div', { style: { display: 'grid', gap: 1 } },
                h('div', { style: { fontSize: 10, opacity: 0.45, letterSpacing: 0.5 } }, kindLabel(doc.kind)),
                h('strong', { style: { fontSize: 19 } }, doc.title),
              ),
              h('span', { style: { ...style.badge, color: saveState === 'error' || saveState === 'conflict' ? 'var(--dsw-alias-state-error-primary)' : dirty ? 'var(--dsw-alias-state-warning-primary)' : undefined } }, saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : dirty ? '未保存' : '已保存'),
              h('span', { style: { flex: 1 } }),
              doc.kind !== 'ledger' ? h('div', { className: 'dn-mode' },
                ...['edit', 'split', 'preview'].map((mode) => h('button', {
                  key: mode, type: 'button',
                  onClick: () => setEditorMode(mode),
                  className: editorMode === mode ? 'active' : '',
                }, mode === 'edit' ? '编辑' : mode === 'split' ? '分栏' : '预览')),
              ) : null,
              h(Btn, { onClick: () => openNode({ kind: doc.kind, id: doc.id }, { force: true }) }, '重新读取'),
              doc.kind !== 'ledger' ? h(Btn, { kind: 'primary', disabled: !dirty || saveState === 'saving', onClick: () => saveDoc(doc, text), title: 'Ctrl/⌘ + S' }, saveState === 'saving' ? '保存中…' : '保存') : null,
            ) : null,
            doc
              ? doc.kind === 'ledger'
                ? h(LedgerView, { text, style, allowed, onTask: openTask })
                : h('div', { style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: editorMode === 'split' ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', gridTemplateRows: 'minmax(0,1fr)', gap: 8 } },
                editorMode !== 'preview' ? h('textarea', {
                  style: style.textarea,
                  value: text,
                  placeholder: '用 Markdown 编辑。Ctrl/⌘ + Enter 生成修改提案。',
                  onChange: (event) => { setText(event.target.value); setProposal(null) },
                  onKeyDown: (event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault()
                      if (dirty) void saveDoc(doc, text)
                    }
                  },
                }) : null,
                editorMode !== 'edit' ? h('div', { style: { ...style.previewPane, display: 'block' } },
                  h(MarkdownPreview, { text, style }),
                ) : null,
              )
              : h(PageView, { map, page, style, onOpen: openNode, onTask: openTask, onPlanBook: planBook, onNavigate: setPage,
              onSettings: () => {
                setForm({ title: map.title, genre: map.genre, language: map.language, notes: map.notes ?? '' })
                setDialog('settings')
              }, onEditBook: () => openNode({ kind: 'book', id: 'book' }) }),
            h(ErrorBox, { message: error }),
            h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
              h('span', { style: style.muted }, doc ? `${text.replace(/\s/g, '').length} 字 · ${lines} 行` : '未选择文档'),
              h('span', { style: { flex: 1 } }),
              activity ? h('span', { style: style.muted }, activity) : null,
              busy ? h('span', { style: style.muted }, '处理中…') : null,
            ),
            ),
          ),
          (proposal || doc) ? h('div', { className: 'dn-inspector' },
            proposal
              ? h(ProposalPanel, { proposal, onApply: applyProposal, onDiscard: () => setProposal(null), busy, style })
              : h(DocumentContext, { doc, text, style, onJump: (index) => { setEditorMode('preview'); setTimeout(() => document.getElementById(`dn-heading-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) } }),
          ) : null,
        ),
        dialog === 'menu' ? h(Modal, {
          title: '项目操作', subtitle: tree.map.title, onClose: () => setDialog(null), width: 360,
        },
          h('div', { style: { display: 'grid', gap: 6 } },
            h(Btn, { onClick: () => { setDialog(null); setSearchQuery(''); setSearchResults([]); setDialog('search') } }, '搜索项目'),
            h(Btn, { disabled: busy, onClick: () => { setDialog(null); downloadExport() } }, '导出 Markdown'),
            h(Btn, { onClick: () => { setDialog(null); setForm({ title: tree.map.title, genre: tree.map.genre, language: tree.map.language, notes: tree.map.notes ?? '' }); setDialog('settings') } }, '项目设置'),
            h(Btn, { disabled: busy, onClick: async () => { setDialog(null); await loadTree(root); if (doc) await openNode({ kind: doc.kind, id: doc.id }, { force: true }) } }, '刷新项目'),
            h('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '2px 0' } }),
            h(Btn, { onClick: () => { if (dirty && !window.confirm('当前修改未提交，确定换项目？')) return; setRoot(''); setTree(null); setDoc(null); setText(''); setProposal(null); setDialog(null); setActivity('') } }, '换项目'),
          ),
        ) : null,
        dialog === 'search' ? h(Modal, {
          title: '搜索项目', subtitle: '搜索正文、章卡、设定、人物和连续性文档。', onClose: () => setDialog(null), width: 560,
        },
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', {
              style: style.input, autoFocus: true, value: searchQuery,
              placeholder: '输入要查找的原文',
              onChange: (e) => setSearchQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') runSearch() },
            }),
            h(Btn, { kind: 'primary', disabled: searchBusy, onClick: runSearch }, searchBusy ? '搜索中…' : '搜索'),
          ),
          ...(searchResults.length ? searchResults.map((result, index) => {
            const target = docFromPath(result.path)
            return h('button', {
              key: `${result.path}-${result.at}-${index}`,
              type: 'button',
              style: { textAlign: 'left', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 7, background: 'transparent', color: 'inherit', padding: 8, cursor: target ? 'pointer' : 'default' },
              onClick: () => {
                if (!target) return
                setDialog(null)
                openNode(target)
              },
            },
              h('div', { style: { fontSize: 11, fontFamily: 'monospace', opacity: 0.6 } }, `${result.path}:${result.line}`),
              h('div', { style: { fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 4 } }, result.context),
            )
          }) : h('div', { style: style.muted }, searchQuery ? '没有结果。' : '输入关键词开始搜索。')),
        ) : null,
        dialog === 'settings' ? h(Modal, {
          title: '项目设置', subtitle: '文风由 Agent 通过 novel_style 维护；这里改项目元数据和写作要求。', onClose: () => setDialog(null), width: 540,
        },
          h(Field, { label: '书名' }, h('input', { style: style.input, value: form.title ?? '', onChange: (e) => setForm((c) => ({ ...c, title: e.target.value })) })),
          h(Field, { label: '题材' }, h('input', { style: style.input, value: form.genre ?? '', onChange: (e) => setForm((c) => ({ ...c, genre: e.target.value })) })),
          h(Field, { label: '写作要求 / 禁忌' },
            h('textarea', {
              style: { ...style.input, minHeight: 150, resize: 'vertical', lineHeight: 1.6 },
              value: form.notes ?? '',
              onChange: (e) => setForm((c) => ({ ...c, notes: e.target.value })),
            }),
          ),
          h(ErrorBox, { message: error }),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h(Btn, { onClick: () => setDialog(null) }, '取消'),
            h(Btn, { kind: 'primary', disabled: busy, onClick: saveMeta }, '保存'),
          ),
        ) : null,
      )
    }

    return {
      __test: { App, DocTree, DocumentContext, FlowGuide, LedgerView, MarkdownPreview, Sidebar, StepRail, PageView, Welcome, nextAction, normalizeWorkspacePath, findWorkspaceForPath, buildTaskPrompt, withTimeout, sendTaskToSessionWith, dispatchTaskWith },
      inject: ['slots'],
      apply(ctx) {
        clientScope = ctx
        let tries = 0
        const attempt = () => {
          const slots = ctx.get('slots')
          if (slots) {
            try {
              ctx.effect(() => {
                const disposeIcon = slots.register({ name: 'sidebar.panellist', id: MAIN_ID, order: 8, label: '写作台' }, WritingIcon)
                const disposeMain = slots.register({ name: 'main', key: MAIN_ID }, DeskRoot)
                return () => { disposeIcon(); disposeMain() }
              })
              return
            } catch {
              // 父槽位还没声明
            }
          }
          if (tries > 40) return
          tries += 1
          setTimeout(attempt, 150)
        }
        attempt()
      },
    }
  },
})
