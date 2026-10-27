window.__ModuleLoader__.load({
  id: '@sth4me/deepnovel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useRef = React.useRef

    const GLOBAL_RUNNING = { current: {} }
    const runningListeners = new Set()
    const readGlobalRunning = () => GLOBAL_RUNNING.current
    const writeGlobalRunning = (next) => {
      GLOBAL_RUNNING.current = next
      for (const listener of runningListeners) {
        try {
          listener(next)
        } catch {
          // ignore broken listeners
        }
      }
    }

    const TAB_ID = '@sth4me/deepnovel/desk'
    const TAB_KIND = 'novel-writer-desk'

    const CSS = `
.nw-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.6}
.nw-header{padding:13px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.nw-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.nw-title{font-size:14px;font-weight:650;letter-spacing:.01em}
.nw-path{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.nw-next{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.nw-next b{color:var(--dsw-alias-brand-primary);font-weight:600}
.nw-progress{display:flex;gap:3px;margin-top:9px}
.nw-progress span{flex:1;height:3px;border-radius:2px;background:var(--dsw-alias-border-l1)}
.nw-progress span.ok{background:var(--dsw-alias-state-success-primary)}
.nw-progress span.cur{background:var(--dsw-alias-state-warn-primary)}
.nw-nav{display:flex;gap:2px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;flex:0 0 auto;scrollbar-width:none}
.nw-nav::-webkit-scrollbar{display:none}
.nw-step{display:inline-flex;align-items:center;gap:6px;padding:9px;border:none;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.nw-step:hover{color:var(--dsw-alias-label-primary)}
.nw-step.active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.nw-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}
.nw-dot.ok{background:var(--dsw-alias-state-success-primary)}
.nw-dot.cur{background:var(--dsw-alias-state-warn-primary)}
.nw-dot.bad{background:var(--dsw-alias-state-error-primary)}
.nw-main{flex:1;overflow:auto;padding:14px;min-height:0;scrollbar-width:thin}
.nw-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;margin-bottom:10px;transition:border-color .15s}
.nw-card:hover{border-color:var(--dsw-alias-border-l2)}
.nw-h2{font-size:13px;font-weight:650;margin:0 0 4px}
.nw-h3{font-size:12px;font-weight:600;margin:0 0 6px}
.nw-muted{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.7}
.nw-p{font-size:12px;line-height:1.75;margin:4px 0}
.nw-guide{display:flex;flex-direction:column;gap:4px;margin:8px 0 0;padding:0}
.nw-guide li{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.65;margin-left:14px}
.nw-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.nw-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.nw-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:27px;padding:4px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:17px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}
.nw-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}
.nw-btn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.nw-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.nw-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.nw-btn.ghost{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.nw-btn.ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.nw-btn:disabled{opacity:.4;cursor:default}
.nw-btn.icon{width:28px;min-height:27px;padding:0}
.nw-badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px;white-space:nowrap}
.nw-chip-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.nw-chip{display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:10.5px}
.nw-badge.ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.nw-badge.cur{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.nw-badge.bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.nw-field{margin-top:8px}
.nw-label{display:block;font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.nw-input,.nw-textarea,.nw-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;color:var(--dsw-alias-label-primary);padding:6px 8px;font:inherit;font-size:11px;line-height:1.5;outline:none;transition:border-color .12s}
.nw-input:focus,.nw-textarea:focus,.nw-select:focus{border-color:var(--dsw-alias-brand-primary)}
.nw-textarea{resize:vertical;min-height:56px}
.nw-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:560px){.nw-grid-2{grid-template-columns:1fr}}
.nw-empty{border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;padding:18px 14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.7}
.nw-banner{display:flex;align-items:flex-start;gap:8px;border-radius:9px;padding:9px 10px;margin-bottom:10px;font-size:11px;line-height:1.6}
.nw-banner.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent)}
.nw-toast{position:absolute;left:12px;right:12px;bottom:12px;z-index:5;padding:9px 11px;border-radius:9px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 8px 24px rgba(0,0,0,.24);font-size:11px;color:var(--dsw-alias-label-primary);animation:nw-in .18s ease-out}
@keyframes nw-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.nw-assist-wrap{position:fixed;right:18px;bottom:18px;z-index:80;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.nw-assist-fab{width:44px;height:44px;border-radius:50%;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-brand-primary);font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.28)}
.nw-assist-fab:hover{background:var(--dsw-alias-bg-layer-2)}
.nw-assist{width:min(380px,92vw);max-height:64vh;display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 16px 40px rgba(0,0,0,.32)}
.nw-assist-head{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary)}
.nw-assist-msgs{overflow:auto;display:flex;flex-direction:column;gap:6px;max-height:34vh;padding-right:2px}
.nw-assist-msg{font-size:11px;line-height:1.55;padding:7px 9px;border-radius:9px;white-space:pre-wrap;color:var(--dsw-alias-label-primary)}
.nw-assist-msg.user{background:var(--dsw-alias-bg-layer-2);align-self:flex-end;max-width:88%}
.nw-assist-msg.assistant{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);max-width:92%}
.nw-assist-plan{display:flex;flex-direction:column;gap:5px;padding:8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.nw-assist-action{font-size:11px;color:var(--dsw-alias-label-secondary)}
.nw-assist-input{display:flex;gap:6px}
.nw-assist-input .nw-input{flex:1;min-width:0}
.nw-assist .nw-error{font-size:11px;color:var(--dsw-alias-state-error-primary)}
.nw-chapter{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.nw-chapter.open{border-color:var(--dsw-alias-border-l2)}
.nw-chapter-summary{display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:pointer;user-select:none}
.nw-chapter-summary:hover{background:var(--dsw-alias-bg-layer-1)}
.nw-chapter-num{font-variant-numeric:tabular-nums;font-size:10px;color:var(--dsw-alias-label-secondary);min-width:20px}
.nw-chapter-title{flex:1;min-width:0;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-chapter-body{padding:0 11px 11px;border-top:1px solid var(--dsw-alias-border-l1)}
.nw-pre{margin:8px 0 0;padding:8px;max-height:200px;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.nw-spinner{width:11px;height:11px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;display:inline-block;animation:nw-spin .8s linear infinite}
@keyframes nw-spin{to{transform:rotate(360deg)}}
.nw-kv{display:flex;gap:6px;font-size:11px;line-height:1.7}
.nw-kv b{font-weight:600;color:var(--dsw-alias-label-secondary);min-width:34px}
`

    const CSS_DESIGN = `
.nw-root{font-size:12.5px;line-height:1.65}
.nw-header{padding:16px 16px 14px;background:linear-gradient(180deg,var(--dsw-alias-bg-layer-2) 0%,transparent 100%);position:relative}
.nw-header::after{content:"";position:absolute;left:16px;right:16px;bottom:0;height:1px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary),transparent 62%);opacity:.55}
.nw-brand{display:flex;align-items:center;gap:10px}
.nw-mark{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 32%,transparent)}
.nw-eyebrow{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);font-weight:650;line-height:1.4}
.nw-title{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:17px;font-weight:600;letter-spacing:.01em;line-height:1.35;margin-top:1px}
.nw-path{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.nw-next{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:10.5px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.nw-next b{color:var(--dsw-alias-brand-primary);font-weight:650}
.nw-stepper{display:flex;align-items:flex-start;margin-top:16px;position:relative}
.nw-stepper::before{content:"";position:absolute;left:12%;right:12%;top:11px;height:1px;background:var(--dsw-alias-border-l1)}
.nw-step{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:none;padding:0;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;position:relative;z-index:1}
.nw-step-index{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:650;letter-spacing:.02em;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);transition:all .15s}
.nw-step-label{font-size:9.5px;letter-spacing:.02em;white-space:nowrap}
.nw-step:hover .nw-step-index{border-color:var(--dsw-alias-label-secondary)}
.nw-step.active .nw-step-index{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.nw-step.active .nw-step-label{color:var(--dsw-alias-label-primary)}
.nw-step.ok .nw-step-index{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.nw-step.ok.active .nw-step-index{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.nw-main{padding:18px 16px 28px}
.nw-intro{margin:2px 2px 16px}
.nw-intro .nw-display{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:20px;font-weight:600;line-height:1.35;margin:5px 0 0;letter-spacing:.005em}
.nw-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.75;margin:7px 0 0;max-width:54ch}
.nw-card{background:var(--dsw-alias-bg-layer-2);border:none;border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 1px 0 rgba(0,0,0,.02)}
.nw-card:hover{border:none}
.nw-h2{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:16px;font-weight:600;letter-spacing:.01em;margin:0 0 6px}
.nw-h3{font-size:12px;font-weight:650;margin:0 0 8px;letter-spacing:.01em}
.nw-muted{font-size:10.5px}
.nw-p{font-size:12px;line-height:1.8}
.nw-guide li{font-size:10.5px}
.nw-btn{min-height:32px;padding:5px 12px;border-radius:9px;border:1px solid transparent;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11.5px}
.nw-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.nw-btn.primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,transparent);color:var(--dsw-alias-brand-primary);font-weight:650}
.nw-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent);border-color:var(--dsw-alias-brand-primary)}
.nw-btn.ghost{background:transparent}
.nw-btn.block{width:100%;min-height:36px;font-size:12px}
.nw-btn.icon{width:30px;background:transparent}
.nw-badge{border:none;background:var(--dsw-alias-bg-layer-1);padding:2px 8px;font-size:9.5px;letter-spacing:.02em}
.nw-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);color:var(--dsw-alias-state-success-primary)}
.nw-badge.cur{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent);color:var(--dsw-alias-state-warn-primary)}
.nw-badge.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent);color:var(--dsw-alias-state-error-primary)}
.nw-field{margin-top:12px}
.nw-label{font-size:9px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.nw-input,.nw-textarea,.nw-select{height:34px;background:var(--dsw-alias-bg-layer-1);border:1px solid transparent;border-radius:8px;padding:6px 10px;font-size:11.5px}
.nw-textarea{height:auto;min-height:70px;line-height:1.65}
.nw-input:focus,.nw-textarea:focus,.nw-select:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.nw-grid-2{gap:10px}
.nw-empty{padding:34px 18px;border:none;background:transparent}
.nw-empty-icon{width:46px;height:46px;border-radius:15px;margin:0 auto 12px;display:grid;place-items:center;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 25%,transparent)}
.nw-empty-title{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:6px}
.nw-banner{border-radius:10px;padding:10px 12px;font-size:10.5px}
.nw-toast{border-radius:11px;padding:10px 13px;font-size:11px}
.nw-meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}
.nw-meta span{font-size:9.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:6px;padding:2px 7px}
.nw-logline{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:17px;font-weight:600;line-height:1.5;margin:6px 0 4px;letter-spacing:.005em}
.nw-premise{font-size:13px;line-height:1.65;margin:6px 0 4px;color:var(--dsw-alias-label-primary);white-space:pre-wrap}
.nw-candidate{position:relative;transition:box-shadow .15s}
.nw-candidate.selected{box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.nw-template{display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid transparent;border-radius:12px;padding:13px 14px;margin-bottom:8px;transition:border-color .15s,background .15s}
.nw-template:hover{border-color:var(--dsw-alias-border-l2)}
.nw-template.current{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,var(--dsw-alias-bg-layer-2))}
.nw-template-name{font-size:12px;font-weight:650}
.nw-timeline{position:relative;padding-left:18px}
.nw-timeline::before{content:"";position:absolute;left:6px;top:8px;bottom:8px;width:1px;background:var(--dsw-alias-border-l1)}
.nw-chapter{position:relative;background:transparent;border:none;border-radius:10px;margin-bottom:2px;overflow:visible}
.nw-chapter::before{content:"";position:absolute;left:-15px;top:17px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);z-index:1}
.nw-chapter.open::before{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.nw-chapter-summary{padding:9px 10px;border-radius:9px}
.nw-chapter.open .nw-chapter-summary{background:var(--dsw-alias-bg-layer-2)}
.nw-chapter-title{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:13px;font-weight:600}
.nw-chapter-body{background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:14px;margin:4px 0 12px;border:none}
.nw-kv{font-size:10.5px;padding:3px 0}
.nw-manuscript{margin-top:12px;padding:16px 16px 8px;background:var(--dsw-alias-bg-layer-1);border-radius:11px;font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:14px;line-height:1.95;letter-spacing:.01em;color:var(--dsw-alias-label-primary)}
.nw-manuscript p{margin:0 0 .85em;text-indent:2em}
.nw-manuscript p:last-child{margin-bottom:0}
.nw-qa-item{font-size:10.5px;line-height:1.65;padding:2px 0}
.nw-qa-item.error{color:var(--dsw-alias-state-error-primary)}
.nw-qa-item.warn{color:var(--dsw-alias-state-warn-primary)}
.nw-diff{max-height:300px;overflow:auto;margin-top:10px;padding:8px;background:var(--dsw-alias-bg-layer-1);border-radius:9px;font-size:10.5px;line-height:1.6}
.nw-diff-line{padding:1px 6px;border-radius:4px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.nw-diff-line.add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.nw-diff-line.del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.nw-diff-line.same{color:var(--dsw-alias-label-secondary)}
.nw-modal-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.46);backdrop-filter:blur(2px)}
.nw-modal{width:min(880px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 20px 50px rgba(0,0,0,.4)}
.nw-diff-review{max-height:42vh}
.nw-hunks{display:flex;flex-direction:column;gap:8px;margin-top:8px;max-height:46vh;overflow:auto;padding-right:2px}
.nw-hunk{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.nw-hunk.rejected{opacity:.55}
.nw-hunk-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;font-size:11px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.nw-hunk-body{padding:5px 7px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;line-height:1.55;max-height:220px;overflow:auto}
.nw-manuscript p{cursor:text;border-radius:5px;padding:2px 5px;margin-left:-5px;margin-right:-5px}
.nw-manuscript p.selected{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.nw-nextbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.nw-nextbar .nw-eyebrow{margin:0 0 2px}
.nw-next-title{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:15px;line-height:1.3}
.nw-qa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.nw-qa-details{margin-top:8px}
.nw-qa-summary-line{cursor:pointer;font-size:11px;color:var(--dsw-alias-label-secondary);padding:4px 0;list-style:none}
.nw-qa-summary-line::-webkit-details-marker{display:none}
.nw-selbar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 11px;margin:10px 0 0;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.nw-selbar.active{border-style:solid;border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-1))}
.nw-selbar-title{font-size:11.5px;font-weight:650;line-height:1.4}
.nw-sel-float{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 12px 34px rgba(0,0,0,.28);max-width:calc(100vw - 32px)}
.nw-sel-float-info{font-size:11.5px;font-weight:600;white-space:nowrap}
.nw-task-dock{position:fixed;right:22px;bottom:22px;z-index:58;width:278px;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 34px rgba(0,0,0,.3);backdrop-filter:blur(10px)}
.nw-task-head{display:flex;align-items:center;gap:6px}
.nw-task-title{flex:1;font-size:11.5px;font-weight:700;color:var(--dsw-alias-label-primary)}
.nw-task-list{display:flex;flex-direction:column;gap:6px}
.nw-task-row{display:flex;align-items:flex-start;gap:7px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.nw-task-row:first-child{border-top:none;padding-top:2px}
.nw-task-main{min-width:0;flex:1}
.nw-task-label{font-size:11.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nw-task-actions{display:flex;flex-direction:column;gap:2px;flex:0 0 auto}
.nw-task-actions .nw-btn{min-height:22px;padding:2px 7px;font-size:10px}
.nw-task-bar{height:2px;margin-top:5px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-border-l1)}
.nw-task-bar span{display:block;width:35%;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);animation:nw-task-slide 1.4s ease-in-out infinite}
@keyframes nw-task-slide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
@media (max-width:700px){.nw-task-dock{left:10px;right:10px;bottom:10px;width:auto}.nw-sel-float{bottom:96px}}
.nw-editor{max-width:760px;margin:0 auto;width:100%}
.nw-editor-textarea{width:100%;min-height:55vh;resize:vertical;font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:14px;line-height:1.9;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;outline:none}
.nw-editor-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
@media (max-width:600px){.nw-sel-float-info{display:none}}
.nw-more summary{cursor:pointer;list-style:none;display:inline-flex}
.nw-more summary::-webkit-details-marker{display:none}
.nw-qa-block{background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:10px 12px;min-width:0}
.nw-qa-label{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);font-weight:650;margin-bottom:2px}
.nw-qa-score{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:30px;line-height:1.05;color:var(--dsw-alias-label-primary)}
.nw-qa-score span{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:2px}
.nw-qa-metrics{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin:2px 0 4px}
.nw-issue{display:flex;gap:6px;font-size:10.5px;line-height:1.55;padding:2px 0;color:var(--dsw-alias-label-secondary)}
.nw-issue-dot{width:5px;height:5px;border-radius:50%;margin-top:6px;flex:0 0 auto;background:var(--dsw-alias-state-warn-primary)}
.nw-issue-dot.error{background:var(--dsw-alias-state-error-primary)}
.nw-issue-dot.pass{background:var(--dsw-alias-state-success-primary)}
.nw-issue.clickable{cursor:pointer;border-radius:6px;padding:2px 4px;margin:0 -4px}
.nw-issue.clickable:hover{background:var(--dsw-alias-bg-layer-2)}
.nw-issue-jump{margin-left:auto;color:var(--dsw-alias-brand-primary);white-space:nowrap;font-size:10px}
.nw-manuscript p.nw-flash{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:4px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);transition:background .3s,outline-color .3s}
.nw-model-row{display:grid;grid-template-columns:120px minmax(0,1fr) 150px;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.nw-model-row:last-child{border-bottom:none}
.nw-model-head{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);padding-top:2px}
.nw-model-task{display:flex;gap:6px;align-items:center;font-size:11.5px;min-width:0}
@media (max-width:900px){.nw-model-row{grid-template-columns:1fr}}
.nw-viewtoggle{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;margin-left:auto}
.nw-viewtoggle-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:6px 10px;cursor:pointer}
.nw-viewtoggle-btn.active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.nw-chapter-card{display:block;text-align:left;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:14px;cursor:pointer;color:inherit;font:inherit;min-width:0}
.nw-chapter-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.nw-chapter-card-title{font-family:"Iowan Old Style","Palatino Linotype","Songti SC","STSong",Georgia,serif;font-size:16px;line-height:1.35;margin:4px 0 6px}
.nw-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nw-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.nw-table{width:100%;border-collapse:collapse;font-size:11.5px}
.nw-table th{text-align:left;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.nw-table td{padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;max-width:260px}
.nw-table tbody tr{cursor:pointer}
.nw-table tbody tr:hover{background:var(--dsw-alias-bg-layer-1)}
.nw-focus .nw-rail,.nw-focus .nw-inspector{display:none}
.nw-app.nw-inspector-closed .nw-inspector{display:none}
.nw-focus .nw-stage{padding:34px 46px}
.nw-focus .nw-stage-inner{max-width:900px}
.nw-hints{display:flex;flex-direction:column;gap:4px;margin:11px 0 0;padding:0;list-style:none;counter-reset:hint}
.nw-hints li{position:relative;padding-left:19px;font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.6;counter-increment:hint}
.nw-hints li::before{content:counter(hint);position:absolute;left:0;top:1px;width:13px;height:13px;border-radius:50%;display:grid;place-items:center;font-size:8px;font-weight:650;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.nw-card{box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 1px 0 rgba(0,0,0,.02)}
.nw-mark{width:34px;height:34px}
.nw-candidate .nw-actions .nw-btn.primary{width:auto;min-height:32px;padding-left:14px;padding-right:14px}
`

    const CSS_APP = `
.nw-app{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.nw-top{display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid var(--dsw-alias-border-l1);background:linear-gradient(180deg,var(--dsw-alias-bg-layer-2),transparent);flex:0 0 auto}
.nw-top .nw-title{font-size:18px}
.nw-top-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
.nw-body{display:flex;flex:1;min-height:0}
.nw-rail{width:222px;flex:0 0 auto;border-right:1px solid var(--dsw-alias-border-l1);padding:16px 12px;overflow:auto;background:var(--dsw-alias-bg-layer-2)}
.nw-rail-title{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:0 8px 10px;font-weight:650}
.nw-rail-step{display:flex;gap:10px;width:100%;padding:10px;margin-bottom:2px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer;transition:background .15s,color .15s}
.nw-rail-step:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.nw-rail-step.active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.nw-rail-num{width:22px;height:22px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font-size:9px;font-weight:650;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);margin-top:1px}
.nw-rail-step.active .nw-rail-num{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.nw-rail-step.ok .nw-rail-num{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.nw-rail-label{font-size:12px;font-weight:600;line-height:1.4}
.nw-rail-desc{font-size:9.5px;color:var(--dsw-alias-label-secondary);line-height:1.45;margin-top:2px}
.nw-rail-foot{margin-top:14px;padding:10px 8px;border-top:1px solid var(--dsw-alias-border-l1)}
.nw-stage{flex:1;min-width:0;overflow:auto;padding:24px 30px;scrollbar-width:thin}
.nw-stage-inner{max-width:1120px;margin:0 auto}
.nw-inspector{width:330px;flex:0 0 auto;border-left:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-2)}
.nw-insp-tabs{display:flex;gap:2px;padding:10px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.nw-insp-tab{padding:7px 10px;border:none;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.nw-insp-tab.active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.nw-insp-body{flex:1;overflow:auto;padding:12px;min-height:0;scrollbar-width:thin}
.nw-workbench{display:grid;grid-template-columns:290px minmax(0,1fr);gap:16px;align-items:start}
.nw-list{display:flex;flex-direction:column;gap:3px;max-height:calc(100vh - 300px);overflow:auto;padding-right:4px;scrollbar-width:thin}
.nw-list-item{display:flex;align-items:center;gap:8px;padding:8px 9px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;width:100%}
.nw-list-item:hover{background:var(--dsw-alias-bg-layer-2)}
.nw-list-item .nw-list-hover{opacity:0;flex:0 0 auto;font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);cursor:pointer;transition:opacity .12s ease}
.nw-list-item:hover .nw-list-hover,.nw-list-item.active .nw-list-hover{opacity:1}
.nw-list-item .nw-list-hover:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
.nw-sticky-jump{max-width:112px;font:inherit;font-size:11px;padding:3px 4px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.nw-list-item.active{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.nw-list-num{font-size:9px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;min-width:18px}
.nw-list-title{flex:1;min-width:0;font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-pane{min-width:0}
.nw-pane-scroll{max-height:calc(100vh - 300px);overflow:auto;padding-right:6px;scrollbar-width:thin}
.nw-chapter-sticky{position:sticky;top:0;z-index:9;display:flex;flex-direction:column;gap:8px;padding:9px 10px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 6px 18px rgba(0,0,0,.12)}
.nw-sticky-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.nw-sticky-title{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto;max-width:420px}
.nw-sticky-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13px/1.3 "Iowan Old Style","Palatino","Songti SC",Georgia,serif;color:var(--dsw-alias-label-primary)}
.nw-sticky-nav{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.nw-sticky-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap;width:100%;min-width:0}
.nw-sticky-actions .nw-btn{min-height:29px;padding:4px 10px;font-size:11px;flex:0 0 auto}
.nw-sticky-actions-note{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.nw-sticky-sep{width:1px;height:18px;background:var(--dsw-alias-border-l1);margin:0 2px;flex:0 0 auto}
.nw-workspace-switch{display:inline-flex;gap:3px;padding:3px;margin:0 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.nw-workspace-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 14px;border-radius:7px;cursor:pointer}
.nw-workspace-tab.active{background:var(--dsw-alias-brand-primary);color:#fff;font-weight:600}
.nw-chapter-sticky .nw-more{position:relative}
.nw-sticky-more{position:absolute;right:0;top:calc(100% + 6px);z-index:30;display:flex;flex-direction:column;gap:4px;min-width:150px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 30px rgba(0,0,0,.28)}
.nw-sticky-more .nw-btn{justify-content:flex-start;width:100%}
.nw-sticky-extra{border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px}
@media (max-width:900px){.nw-sticky-title{max-width:100%}.nw-sticky-head{flex-wrap:wrap}.nw-sticky-nav{margin-left:auto}.nw-sticky-actions .nw-btn{flex:0 0 auto}}
.nw-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.nw-cards .nw-card{margin-bottom:0;height:100%}
.nw-discuss{display:flex;flex-direction:column;height:100%;min-height:0}
.nw-discuss-head{padding:0 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:10px}
.nw-discuss-msgs{flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}
.nw-msg{font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;padding:9px 11px;border-radius:10px;max-width:100%}
.nw-msg.user{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);align-self:flex-end}
.nw-msg.assistant{background:var(--dsw-alias-bg-layer-1)}
.nw-msg-role{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-bottom:3px}
.nw-msg-text{white-space:pre-wrap;word-break:break-word}
.nw-result{margin-top:9px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.nw-result-conclusion{font-weight:600;font-size:11.5px;line-height:1.55;margin-bottom:6px}
.nw-result-label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-top:5px}
.nw-result-item{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);padding:1px 0}
.nw-result-actions{margin-top:8px;padding:8px;border:1px dashed var(--dsw-alias-brand-primary);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent)}
.nw-result-actions .nw-btn{margin-top:6px}
.nw-msg-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}
.nw-msg-actions .nw-btn{height:26px;padding:0 9px;font-size:10.5px}
.nw-discuss-input{display:flex;gap:6px;margin-top:10px;flex:0 0 auto}
.nw-picker{max-width:760px;margin:7vh auto 0}
.nw-picker-card{background:var(--dsw-alias-bg-layer-2);border-radius:18px;padding:26px}
.nw-picker-row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.nw-recent{display:flex;flex-direction:column;gap:4px;margin-top:10px}
.nw-recent button{text-align:left;border:none;background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nw-recent button:hover{color:var(--dsw-alias-label-primary)}
.nw-recent-row{display:flex;align-items:center;gap:6px}
.nw-recent-path{flex:1;min-width:0;text-align:left;border:none;background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nw-recent-path:hover{color:var(--dsw-alias-label-primary)}
.nw-recent-remove{width:26px;height:26px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:1;flex:0 0 auto}
.nw-recent-remove:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary)}
@media (max-width:1180px){.nw-inspector{display:none}.nw-workbench{grid-template-columns:250px minmax(0,1fr)}}
@media (max-width:860px){.nw-rail{display:none}.nw-stage{padding:18px}.nw-workbench{display:block}.nw-list{display:flex;overflow-x:auto;gap:6px;max-height:none;margin-bottom:12px;padding-bottom:4px;scrollbar-width:thin}.nw-list-item{flex:0 0 auto;min-width:170px}.nw-pane-scroll{max-height:none}}
@media (max-width:700px){.nw-path,.nw-top>.nw-muted{display:none}.nw-top{padding:10px 12px;gap:8px;flex-wrap:wrap}.nw-task-dock{max-height:46vh;overflow:auto}.nw-modal{padding:12px;border-radius:12px}.nw-sel-float{padding:6px 8px}.nw-sel-float .nw-btn{padding:4px 7px;font-size:11px}}

/* polish pass 1: density, hierarchy, responsiveness */
.nw-top{padding:12px 24px;gap:16px;backdrop-filter:blur(10px)}
.nw-title{font-size:20px;letter-spacing:-.01em}
.nw-rail{width:212px;padding:18px 10px}
.nw-rail-step{padding:11px 10px;border-radius:11px}
.nw-rail-label{font-size:12.5px}
.nw-rail-desc{font-size:9.5px;opacity:.82}
.nw-stage{padding:30px 36px 40px}
.nw-stage-inner{max-width:1060px}
.nw-inspector{width:336px}
.nw-card{padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:linear-gradient(180deg,var(--dsw-alias-bg-layer-2),color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,var(--dsw-alias-bg-layer-1)));margin-bottom:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.nw-card:hover{border-color:var(--dsw-alias-border-l2)}
.nw-h2{font-size:24px;letter-spacing:-.01em}
.nw-h3{font-size:13px}
.nw-label{font-size:10px}
.nw-field{margin-bottom:11px}
.nw-input,.nw-select,.nw-textarea{font-size:12px;min-height:34px;padding:7px 10px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,var(--dsw-alias-bg-layer-1))}
.nw-textarea{min-height:76px;line-height:1.65}
.nw-btn{height:30px;padding:0 12px;font-size:11.5px;border-radius:8px;transition:transform .12s ease,background .12s ease,border-color .12s ease,color .12s ease}
.nw-btn:hover{transform:translateY(-.5px)}
.nw-btn:active{transform:translateY(0)}
.nw-actions{gap:7px;margin-top:10px}
.nw-list-item{padding:9px 10px;border-radius:10px}
.nw-list-title{font-size:12px}
.nw-pane-scroll{max-height:calc(100vh - 270px)}
.nw-manuscript{max-width:760px;font-size:14px;line-height:1.95;color:var(--dsw-alias-label-primary)}
.nw-reading{max-width:740px;width:100%;margin:0 auto}
.nw-reading .nw-manuscript{max-width:none}
.nw-manuscript p{margin:0 0 15px}
.nw-selbar{padding:10px 13px;border-radius:12px}
.nw-qa-block{padding:12px 14px}
.nw-qa-score{font-size:34px}
.nw-issue{font-size:11px;line-height:1.6}
.nw-cards{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.nw-chapter-card{padding:16px}
.nw-nextbar{padding:13px 16px;border-radius:14px;background:linear-gradient(180deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1))}
.nw-toast{box-shadow:0 10px 30px rgba(0,0,0,.22);border-radius:12px}
.nw-mobile-steps{display:none;height:30px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;padding:0 8px}
@media (max-width:1180px){
  .nw-app:not(.nw-inspector-open) .nw-inspector{display:none}
  .nw-app.nw-inspector-open .nw-inspector{display:flex;position:absolute;right:0;top:0;bottom:0;z-index:40;box-shadow:-18px 0 44px rgba(0,0,0,.28)}
  .nw-workbench{grid-template-columns:250px minmax(0,1fr)}
}
@media (max-width:1000px){.nw-next{display:none}}
@media (max-width:900px){.nw-mobile-steps{display:inline-flex;align-items:center}}

/* theme pass: 层次、氛围与焦点 */
.nw-app{background:
  radial-gradient(1200px 520px at 16% -12%,color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent),transparent 62%),
  radial-gradient(900px 420px at 102% 0%,color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent),transparent 55%),
  var(--dsw-alias-bg-layer-1)}
.nw-top{border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-border-l1));background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 90%,var(--dsw-alias-brand-primary) 10%),var(--dsw-alias-bg-layer-1) 82%);box-shadow:0 1px 0 rgba(255,255,255,.04),0 10px 28px rgba(0,0,0,.06)}
.nw-top .nw-title{font-size:21px;letter-spacing:-.015em}
.nw-top .nw-mark{background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent),color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent));box-shadow:0 6px 18px color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.nw-btn.primary{background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 90%,#fff 10%),var(--dsw-alias-brand-primary));color:#fff;border-color:transparent;box-shadow:0 4px 14px color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,transparent)}
.nw-btn.primary:hover:not(:disabled){filter:brightness(1.07);border-color:transparent;box-shadow:0 7px 20px color-mix(in srgb,var(--dsw-alias-brand-primary) 34%,transparent)}
.nw-btn.primary:active:not(:disabled){filter:brightness(.96)}
.nw-card{transition:border-color .16s,box-shadow .16s,transform .16s}
.nw-card:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(0,0,0,.10),inset 0 1px 0 rgba(255,255,255,.03)}
.nw-candidate{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,transparent)}
.nw-candidate.selected{background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-2)),var(--dsw-alias-bg-layer-2));box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary),0 10px 26px rgba(0,0,0,.10)}
.nw-chapter-card{position:relative;overflow:hidden;transition:transform .16s,box-shadow .16s,border-color .16s}
.nw-chapter-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--dsw-alias-brand-primary),transparent 85%);opacity:.6}
.nw-chapter-card:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(0,0,0,.12)}
.nw-chapter-num{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:12px;letter-spacing:.06em;color:color-mix(in srgb,var(--dsw-alias-brand-primary) 70%,var(--dsw-alias-label-secondary))}
.nw-rail-step.active{background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1));box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.nw-rail-step.active .nw-rail-num{background:linear-gradient(145deg,var(--dsw-alias-brand-primary),color-mix(in srgb,var(--dsw-alias-brand-primary) 68%,#000));color:#fff;border-color:transparent}
.nw-progress span{height:4px;border-radius:3px;transition:background .2s}
.nw-progress span.ok{box-shadow:0 0 8px color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
.nw-wordbar{display:flex;flex-direction:column;gap:4px;min-width:138px}
.nw-wordbar-label{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.nw-wordbar-track{height:5px;border-radius:3px;background:color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent);overflow:hidden}
.nw-wordbar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary),color-mix(in srgb,var(--dsw-alias-state-success-primary) 78%,var(--dsw-alias-brand-primary)));transition:width .35s}
.nw-empty-icon{box-shadow:0 10px 30px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
.nw-manuscript{background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,var(--dsw-alias-brand-primary) 5%),var(--dsw-alias-bg-layer-1));box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 1px 3px rgba(0,0,0,.04)}
.nw-main::-webkit-scrollbar,.nw-stage::-webkit-scrollbar,.nw-list::-webkit-scrollbar,.nw-pane-scroll::-webkit-scrollbar{width:8px;height:8px}
.nw-main::-webkit-scrollbar-thumb,.nw-stage::-webkit-scrollbar-thumb,.nw-list::-webkit-scrollbar-thumb,.nw-pane-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-border-l2) 70%,transparent);border-radius:4px}
.nw-main::-webkit-scrollbar-thumb:hover,.nw-stage::-webkit-scrollbar-thumb:hover,.nw-list::-webkit-scrollbar-thumb:hover,.nw-pane-scroll::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 55%,transparent)}
.nw-main::-webkit-scrollbar-track,.nw-stage::-webkit-scrollbar-track,.nw-list::-webkit-scrollbar-track,.nw-pane-scroll::-webkit-scrollbar-track{background:transparent}
.nw-btn:focus-visible,.nw-step:focus-visible,.nw-rail-step:focus-visible,.nw-list-item:focus-visible,.nw-chapter-card:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 60%,transparent);outline-offset:2px}
.nw-task-dock{background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 88%,transparent);box-shadow:0 18px 44px rgba(0,0,0,.34)}
.nw-top-actions .nw-btn{border-radius:9px}
@media (max-width:1000px){.nw-wordbar{display:none}}

/* themes: paper / ink / wood / eink（覆盖 DSH 别名变量，整棵子树跟随） */
[data-theme="paper"]{
  --dsw-alias-bg-layer-1:#f3ead7;--dsw-alias-bg-layer-2:#fffaf0;--dsw-alias-bg-overlay:#fffdf7;
  --dsw-alias-label-primary:#3a2f24;--dsw-alias-label-secondary:#8a7860;
  --dsw-alias-border-l1:#e2d4b9;--dsw-alias-border-l2:#c9b691;
  --dsw-alias-brand-primary:#a0522d;--dsw-alias-state-success-primary:#5f7f52;
  --dsw-alias-state-warn-primary:#b07d2a;--dsw-alias-state-error-primary:#a33a2c;
  --dsw-alias-state-idle-primary:#c9b691;
}
[data-theme="ink"]{
  --dsw-alias-bg-layer-1:#14161c;--dsw-alias-bg-layer-2:#1b1e26;--dsw-alias-bg-overlay:#20242e;
  --dsw-alias-label-primary:#e8e3d8;--dsw-alias-label-secondary:#9a9384;
  --dsw-alias-border-l1:#2a2f3a;--dsw-alias-border-l2:#3a4150;
  --dsw-alias-brand-primary:#c9a15a;--dsw-alias-state-success-primary:#6f9f7a;
  --dsw-alias-state-warn-primary:#d0a04a;--dsw-alias-state-error-primary:#d06a5a;
  --dsw-alias-state-idle-primary:#3a4150;
}
[data-theme="wood"]{
  --dsw-alias-bg-layer-1:#2b1d12;--dsw-alias-bg-layer-2:#3a2718;--dsw-alias-bg-overlay:#43301f;
  --dsw-alias-label-primary:#f0e2c8;--dsw-alias-label-secondary:#b89c74;
  --dsw-alias-border-l1:#4a3320;--dsw-alias-border-l2:#6b4a2a;
  --dsw-alias-brand-primary:#d9a441;--dsw-alias-state-success-primary:#8fae6a;
  --dsw-alias-state-warn-primary:#d9a441;--dsw-alias-state-error-primary:#c96a4a;
  --dsw-alias-state-idle-primary:#5a4028;
}
.nw-app[data-theme="wood"]{
  background:
    radial-gradient(1100px 380px at 50% -8%,rgba(217,164,65,.16),transparent 62%),
    repeating-linear-gradient(91deg,rgba(0,0,0,.12) 0 2px,rgba(255,255,255,.025) 2px 6px),
    repeating-linear-gradient(179deg,rgba(0,0,0,.07) 0 3px,transparent 3px 12px),
    linear-gradient(180deg,#3b2918 0%,#2a1c11 55%,#1d120a 100%);
}
.nw-app[data-theme="wood"] .nw-top{background:linear-gradient(180deg,#4a3320,#2b1d12);border-bottom-color:#6b4a2a}
.nw-app[data-theme="wood"] .nw-rail,.nw-app[data-theme="wood"] .nw-inspector{background:linear-gradient(180deg,#33210f,#24160c)}
.nw-app[data-theme="wood"] .nw-card{background:linear-gradient(180deg,#4b3320,#3a2718);border-color:#6b4a2a;box-shadow:0 2px 0 rgba(0,0,0,.35),inset 0 1px 0 rgba(255,220,160,.08)}
.nw-app[data-theme="wood"] .nw-manuscript,.nw-app[data-theme="wood"] .nw-chapter-card,.nw-app[data-theme="wood"] .nw-stat-tile{background:linear-gradient(180deg,#4b3320,#3a2718);border-color:#6b4a2a}
[data-theme="eink"]{
  --dsw-alias-bg-layer-1:#e9e7e1;--dsw-alias-bg-layer-2:#f5f3ee;--dsw-alias-bg-overlay:#fbfaf7;
  --dsw-alias-label-primary:#2f2f2f;--dsw-alias-label-secondary:#7a776f;
  --dsw-alias-border-l1:#d3d0c8;--dsw-alias-border-l2:#b9b5ab;
  --dsw-alias-brand-primary:#4a5a6a;--dsw-alias-state-success-primary:#5f7f52;
  --dsw-alias-state-warn-primary:#a07a2a;--dsw-alias-state-error-primary:#9a4030;
  --dsw-alias-state-idle-primary:#c3c0b8;
}
.nw-theme{position:relative}
.nw-confirm-modal{width:min(400px,calc(100vw - 40px));max-height:calc(100vh - 60px);overflow:auto;padding:14px 16px 12px;border-radius:14px;display:flex;flex-direction:column;gap:10px}
.nw-confirm-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.nw-confirm-title{font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary);letter-spacing:.01em}
.nw-confirm-close{border:none;background:none;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;padding:2px 6px;border-radius:6px;cursor:pointer}
.nw-confirm-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.nw-confirm-body{font-size:12px;line-height:1.75;color:var(--dsw-alias-label-secondary);white-space:pre-line}
.nw-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
.nw-rel-graph{position:relative;margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.nw-rel-svg{width:100%;height:auto;display:block}
.nw-rel-edge{stroke:var(--dsw-alias-border-l2);stroke-width:1.4}
.nw-rel-edge.rival{stroke:var(--dsw-alias-state-error-primary);stroke-dasharray:4 3}
.nw-rel-edge.love{stroke:#c9748f;stroke-dasharray:2 3}
.nw-rel-edge-label{fill:var(--dsw-alias-label-secondary);font-size:10px;text-anchor:middle}
.nw-rel-node{cursor:pointer}
.nw-rel-node:hover .nw-rel-dot{stroke-width:2.5}
.nw-rel-node.dragging .nw-rel-dot{stroke-width:3;fill-opacity:.85}
.nw-rel-node:active{cursor:grabbing}
.nw-rel-dot{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l2);stroke-width:1.5}
.nw-rel-dot.lead{fill:var(--dsw-alias-brand-primary);stroke:var(--dsw-alias-brand-primary)}
.nw-rel-dot.heroine{fill:#c9748f;stroke:#c9748f}
.nw-rel-dot.rival{fill:var(--dsw-alias-state-error-primary);stroke:var(--dsw-alias-state-error-primary)}
.nw-rel-name{fill:var(--dsw-alias-label-primary);font-size:11px;text-anchor:middle;pointer-events:none}
.nw-graph-wrap{margin-top:8px}
.nw-graph-svg{width:100%;height:auto;display:block}
.nw-graph-link{stroke:var(--dsw-alias-border-l2);stroke-width:1.2}
.nw-graph-foreshadow{fill:none;stroke:var(--dsw-alias-state-warn-primary);stroke-dasharray:4 3;stroke-width:1.2}
.nw-graph-node{cursor:pointer}
.nw-graph-rect{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l2);stroke-width:1.2}
.nw-graph-rect.ok{stroke:var(--dsw-alias-state-success-primary)}
.nw-graph-no{fill:var(--dsw-alias-label-secondary);font-size:9px}
.nw-graph-title{fill:var(--dsw-alias-label-primary);font-size:11px;font-weight:600}
.nw-graph-goal{fill:var(--dsw-alias-label-secondary);font-size:9px}
.nw-theme-menu{min-width:176px}
.nw-theme-menu .nw-btn{justify-content:flex-start;width:100%}

/* 章节封面卡：大号章号 + 字数 + 微型进度 */
.nw-list-item{align-items:flex-start;gap:9px}
.nw-list-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.nw-list-main .nw-list-title{flex:none;display:block}
.nw-list-meta{font-size:9px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.nw-list-bar{flex:0 0 46px;height:3px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-border-l1) 75%,transparent);overflow:hidden;align-self:center}
.nw-list-bar span{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary),var(--dsw-alias-state-success-primary));transition:width .3s}
.nw-list-num{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:13px;width:26px;text-align:center;letter-spacing:.02em}

/* 写作统计 */
.nw-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:2px 0 14px}
.nw-stat-tile{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px}
.nw-stat-value{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:22px;font-weight:600;line-height:1.2;margin-top:2px}
.nw-stat-label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.nw-stat-row{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap}
.nw-chart{flex:1;min-width:220px}
.nw-chart-bars{display:flex;align-items:flex-end;gap:4px;height:92px;padding-top:6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.nw-chart-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;min-width:0}
.nw-chart-fill{width:100%;max-width:16px;min-height:2px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,var(--dsw-alias-brand-primary),color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent));transition:height .3s}
.nw-chart-label{font-size:8px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.nw-ring{width:76px;height:76px;flex:0 0 auto;color:var(--dsw-alias-brand-primary)}
@media (max-width:640px){.nw-stat-grid{grid-template-columns:1fr 1fr}.nw-chart-bars{height:70px}}
@media (max-width:640px){.nw-graph-wrap,.nw-rel-graph{overflow-x:auto}.nw-graph-svg{min-width:640px}.nw-rel-svg{min-width:560px}}
@media (max-width:640px){.nw-chapter-sticky{overflow-x:visible}.nw-sticky-actions{flex-wrap:wrap}}

/* 专注模式：纸面与翻页 */
.nw-focus .nw-top{background:transparent;border-bottom:none;box-shadow:none}
.nw-focus .nw-manuscript{font-size:15.5px;line-height:2.05;padding:28px 32px;border:1px solid var(--dsw-alias-border-l1);box-shadow:0 18px 50px rgba(0,0,0,.10)}
.nw-focus .nw-manuscript p{margin-bottom:1.05em}
@keyframes nw-page-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.nw-manuscript{animation:nw-page-in .22s ease-out}
`

    async function fetchState(sessionId) {
      const response = await fetch(`/novel-writer/state?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '加载写作项目状态失败')
      return payload.data
    }

    async function runAction(sessionId, action, params = {}) {
      const response = await fetch('/novel-writer/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, action, params }),
      })
      const payload = await response.json()
      if (!payload.ok) {
        const error = new Error(payload.error?.message ?? '操作失败')
        error.raw = payload.error?.raw ?? null
        error.code = payload.error?.code ?? null
        throw error
      }
      return payload.data
    }

    async function fetchChapter(sessionId, number) {
      const response = await fetch(
        `/novel-writer/chapter?sessionId=${encodeURIComponent(sessionId)}&number=${encodeURIComponent(number)}`,
        { cache: 'no-store' },
      )
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '读取章节失败')
      return payload.data
    }

    async function cancelRun(sessionId) {
      await fetch('/novel-writer/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    }

    const ROOT_KEY = 'dsh.novelWriter.projectRoot'
    const RECENT_KEY = 'dsh.novelWriter.recentRoots'
    const TAB_KEY = 'dsh.novelWriter.tab'
    const MOUSE_SELECTION_KEY = 'dsh.novelWriter.mouseSelection'

    function readMouseSelection() {
      try {
        return localStorage.getItem(MOUSE_SELECTION_KEY) === '1'
      } catch {
        return false
      }
    }

    function storeMouseSelection(enabled) {
      try {
        localStorage.setItem(MOUSE_SELECTION_KEY, enabled ? '1' : '0')
      } catch {
        // storage unavailable
      }
    }

    function readStoredTab() {
      try {
        return localStorage.getItem(TAB_KEY) || null
      } catch {
        return null
      }
    }

    function readStoredRoot() {
      try {
        return localStorage.getItem(ROOT_KEY) || null
      } catch {
        return null
      }
    }

    /*
     * 生成前的「方向 / 额外要求」以前只存在组件 state 里：切 tab 组件卸载就清空，
     * 刷新/重开写作台更是直接丢。这里按项目根持久化，让同一项目下次打开时
     * 仍能看到上次写的要求，避免每次都要重填。
     */
    const INPUTS_KEY = 'dsh.novelWriter.inputs'

    function readStoredInput(root, key, fallback = '') {
      if (!root) return fallback
      try {
        const all = JSON.parse(localStorage.getItem(INPUTS_KEY) || '{}')
        const value = all?.[root]?.[key]
        return typeof value === 'string' ? value : fallback
      } catch {
        return fallback
      }
    }

    function storeInput(root, key, value) {
      if (!root) return
      try {
        const all = JSON.parse(localStorage.getItem(INPUTS_KEY) || '{}')
        const bucket = { ...(all?.[root] ?? {}) }
        if (value) bucket[key] = value
        else delete bucket[key]
        all[root] = bucket
        localStorage.setItem(INPUTS_KEY, JSON.stringify(all))
      } catch {
        // storage unavailable
      }
    }

    function usePersistedInput(root, key, fallback = '') {
      const [value, setValue] = useState(() => readStoredInput(root, key, fallback))
      useEffect(() => {
        setValue(readStoredInput(root, key, fallback))
      }, [root, key])
      const update = (next) => {
        setValue(next)
        storeInput(root, key, next)
      }
      return [value, update]
    }

    /* ------------------------------ 主题 ------------------------------ */

    const THEME_KEY = 'dsh.novelWriter.theme'
    const THEMES = [
      { id: 'default', name: '跟随 DSH' },
      { id: 'paper', name: '纸墨' },
      { id: 'ink', name: '墨夜' },
      { id: 'wood', name: '木纹' },
      { id: 'eink', name: '护眼灰' },
    ]

    function readStoredTheme() {
      try {
        const value = localStorage.getItem(THEME_KEY)
        return THEMES.some((item) => item.id === value) ? value : 'default'
      } catch {
        return 'default'
      }
    }

    function useTheme() {
      const [theme, setTheme] = useState(readStoredTheme)
      const update = (next) => {
        if (!THEMES.some((item) => item.id === next)) return
        setTheme(next)
        try {
          localStorage.setItem(THEME_KEY, next)
        } catch {
          // storage unavailable
        }
      }
      return [theme, update]
    }

    function ThemeMenu({ theme, onTheme }) {
      const current = THEMES.find((item) => item.id === theme) ?? THEMES[0]
      return h('details', { className: 'nw-more nw-theme' },
        h('summary', { className: 'nw-btn ghost', title: '切换写作台主题' },
          `主题 · ${current.name}`,
        ),
        h('div', { className: 'nw-sticky-more nw-theme-menu' },
          THEMES.map((item) =>
            h('button', {
              key: item.id,
              type: 'button',
              className: `nw-btn${item.id === theme ? ' primary' : ''}`,
              onClick: () => onTheme(item.id),
            }, item.name),
          ),
        ),
      )
    }

    function readRecentRoots() {
      try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 6) : []
      } catch {
        return []
      }
    }

    function storeRecentRoots(roots) {
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(roots.filter(Boolean).slice(0, 6)))
      } catch {
        // storage unavailable
      }
    }

    function storeRoot(root) {
      try {
        localStorage.setItem(ROOT_KEY, root)
        const next = [root, ...readRecentRoots().filter((item) => item !== root)].slice(0, 6)
        storeRecentRoots(next)
      } catch {
        // storage unavailable
      }
    }

    async function fetchProjectState(projectRoot) {
      const response = await fetch(`/novel-writer/project-state?projectRoot=${encodeURIComponent(projectRoot)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '加载写作项目失败')
      return payload.data
    }

    async function runProjectAction(projectRoot, action, params = {}) {
      const response = await fetch('/novel-writer/project-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectRoot, action, params }),
      })
      const payload = await response.json()
      if (!payload.ok) {
        const error = new Error(payload.error?.message ?? '操作失败')
        error.raw = payload.error?.raw ?? null
        error.code = payload.error?.code ?? null
        throw error
      }
      return payload.data
    }

    async function fetchProjectChapter(projectRoot, number) {
      const response = await fetch(
        `/novel-writer/project-chapter?projectRoot=${encodeURIComponent(projectRoot)}&number=${encodeURIComponent(number)}`,
        { cache: 'no-store' },
      )
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '读取章节失败')
      return payload.data
    }

    async function fetchProjectRevision(projectRoot, number, name) {
      const response = await fetch(
        `/novel-writer/project-revision?projectRoot=${encodeURIComponent(projectRoot)}&number=${encodeURIComponent(number)}&name=${encodeURIComponent(name)}`,
        { cache: 'no-store' },
      )
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '读取修订版本失败')
      return payload.data
    }

    async function fetchModelCatalog() {
      const response = await fetch('/novel-writer/models', { cache: 'no-store' })
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '读取模型列表失败')
      return payload.data
    }

    async function fetchModelInfo(provider, model) {
      const response = await fetch(
        `/novel-writer/model-info?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`,
        { cache: 'no-store' },
      )
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '读取模型信息失败')
      return payload.data
    }

    async function fetchWritingContext(projectRoot, number) {
      const response = await fetch(
        `/novel-writer/context?projectRoot=${encodeURIComponent(projectRoot)}&number=${encodeURIComponent(number)}`,
        { cache: 'no-store' },
      )
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '读取上下文失败')
      return payload.data
    }

    function diffLines(left, right) {
      const a = String(left ?? '').split('\n')
      const b = String(right ?? '').split('\n')
      if (a.length * b.length > 400000) {
        return a.map((line) => ({ type: 'del', text: line })).concat(b.map((line) => ({ type: 'add', text: line })))
      }
      const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
      for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
          dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
        }
      }
      const ops = []
      let i = a.length
      let j = b.length
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
          ops.push({ type: 'same', text: a[i - 1] })
          i -= 1
          j -= 1
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          ops.push({ type: 'add', text: b[j - 1] })
          j -= 1
        } else {
          ops.push({ type: 'del', text: a[i - 1] })
          i -= 1
        }
      }
      return ops.reverse()
    }

    function applyDiffHunks(ops, rejected) {
      const lines = []
      for (const op of ops) {
        if (op.type === 'same') {
          lines.push(op.text)
          continue
        }
        const rejectedHunk = rejected.has(op.hunk)
        if (op.type === 'add' && !rejectedHunk) lines.push(op.text)
        if (op.type === 'del' && rejectedHunk) lines.push(op.text)
      }
      return lines.join('\n')
    }

    function buildDiffHunks(left, right) {
      const ops = diffLines(left, right)
      const hunks = []
      let current = null
      for (const op of ops) {
        op.hunk = null
        if (op.type === 'same') {
          current = null
          continue
        }
        if (!current) {
          current = { id: hunks.length, add: [], del: [] }
          hunks.push(current)
        }
        op.hunk = current.id
        if (op.type === 'add') current.add.push(op.text)
        else current.del.push(op.text)
      }
      return { ops, hunks }
    }

    async function fetchDiscussion(projectRoot, topicId) {
      const response = await fetch(
        `/novel-writer/discussion?projectRoot=${encodeURIComponent(projectRoot)}&topicId=${encodeURIComponent(topicId)}`,
        { cache: 'no-store' },
      )
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '读取讨论失败')
      return payload.data
    }

    async function postDiscussion(projectRoot, payloadInput) {
      const response = await fetch('/novel-writer/discussion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectRoot, ...payloadInput }),
      })
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '讨论失败')
      return payload.data
    }

    function extractReplyPartial(raw) {
      const match = /"reply"\s*:\s*"/.exec(raw)
      if (!match) return ''
      let index = match.index + match[0].length
      let out = ''
      const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }
      while (index < raw.length) {
        const char = raw[index]
        if (char === '\\') {
          const next = raw[index + 1]
          if (next === 'u') {
            const hex = raw.slice(index + 2, index + 6)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
            out += String.fromCharCode(parseInt(hex, 16))
            index += 6
            continue
          }
          if (next in escapes) {
            out += escapes[next]
            index += 2
            continue
          }
          index += 2
          continue
        }
        if (char === '"') break
        out += char
        index += 1
      }
      return out
    }

    async function postDiscussionStream(projectRoot, payloadInput, onDelta, signal) {
      const response = await fetch('/novel-writer/discussion-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ projectRoot, ...payloadInput }),
        signal,
      })
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || !type.includes('text/event-stream') || !response.body) {
        const payload = await response.json().catch(() => null)
        if (payload?.ok) return payload.data
        if (response.status === 404 || response.status === 405) {
          return postDiscussion(projectRoot, payloadInput)
        }
        throw new Error(payload?.error?.message ?? '讨论失败')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let raw = ''
      let result = null
      let streamError = null
      const consume = (block) => {
        let event = 'message'
        const dataLines = []
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length === 0) return
        let data
        try {
          data = JSON.parse(dataLines.join('\n'))
        } catch {
          return
        }
        if (event === 'delta') {
          raw += String(data.text ?? '')
          onDelta?.(raw)
        } else if (event === 'done') {
          result = data.data ?? data
        } else if (event === 'error') {
          streamError = data.error ?? { message: '讨论流中断' }
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          consume(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
        }
      }
      if (buffer.trim()) consume(buffer)
      if (streamError) throw new Error(streamError.message ?? '讨论失败')
      if (!result) throw new Error('讨论流意外结束')
      return result
    }

    async function postPremiseStream(projectRoot, payloadInput, onDelta, signal) {
      const response = await fetch('/novel-writer/premise-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ projectRoot, params: payloadInput }),
        signal,
      })
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || !type.includes('text/event-stream') || !response.body) {
        const payload = await response.json().catch(() => null)
        if (payload?.ok) return payload.data
        if (response.status === 404 || response.status === 405) {
          return runProjectAction(projectRoot, 'premise-candidates', payloadInput)
        }
        throw new Error(payload?.error?.message ?? '生成构思失败')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let raw = ''
      let result = null
      let streamError = null
      const consume = (block) => {
        let event = 'message'
        const dataLines = []
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length === 0) return
        let data
        try {
          data = JSON.parse(dataLines.join('\n'))
        } catch {
          return
        }
        if (event === 'delta') {
          raw += String(data.text ?? '')
          onDelta?.(raw)
        } else if (event === 'done') {
          result = data.data ?? data
        } else if (event === 'error') {
          streamError = data.error ?? { message: '构思流中断' }
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          consume(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
        }
      }
      if (buffer.trim()) consume(buffer)
      if (streamError) throw new Error(streamError.message ?? '生成构思失败')
      if (!result) throw new Error('构思流意外结束')
      return result
    }

    async function postDiscussionApply(projectRoot, payloadInput) {
      const response = await fetch('/novel-writer/discussion-apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectRoot, ...payloadInput }),
      })
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error?.message ?? '应用讨论结果失败')
      return payload.data
    }

    function logClient(message, detail) {
      try {
        fetch('/novel-writer/client-log', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, detail }),
        }).catch(() => {})
      } catch {
        // best-effort
      }
    }

    function isTypingTarget(target) {
      if (!target) return false
      const tag = String(target.tagName ?? '').toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
    }

    let rightController = null

    /**
     * 前端并发粒度，必须与 index.js 的 runResource 保持一致：
     * 章节按章号、大纲/设定/构思/文风各一把锁；读操作与独立文件写操作不锁。
     */
    function resourceFromRules(action, params = {}, rules = null) {
      if (!rules || typeof action !== 'string') return null
      if (rules.batchActions?.includes(action)) return 'chapter:batch'
      if (rules.projectActions?.includes(action)) return 'project'
      if (rules.projectPrefixes?.some((prefix) => action.startsWith(prefix))) return 'project'
      for (const group of rules.readGroups ?? []) {
        if (!group.actions?.includes(action)) continue
        const number = Number(params?.number ?? params?.fromChapter)
        return Number.isFinite(number) && number > 0 ? `${group.resource}:${number}` : group.resource
      }
      if (rules.exact?.[action]) return rules.exact[action]
      for (const [prefix, resource] of rules.prefixes ?? []) {
        if (!action.startsWith(prefix)) continue
        if (prefix === 'chapter-') {
          const number = Number(params?.number ?? params?.fromChapter)
          return Number.isFinite(number) && number > 0 ? `chapter:${number}` : 'chapter'
        }
        return resource
      }
      return null
    }

    function actionResource(action, params = {}, rules = null) {
      if (typeof action !== 'string') return null
      if (rules) return resourceFromRules(action, params, rules)
      if (action === 'chapter-batch') return 'chapter:batch'
      if (action === 'import-manuscript') return 'chapter:batch'
      if (action === 'chapter-approve-all' || action === 'chapter-approve-volume' || action === 'chapter-approve-stale') return 'chapter:batch'
      if (action === 'clean-orphans' || action === 'chapters-delete-tail') return 'chapter:batch'
      if (action === 'discussion-undo' || action === 'discussion-applies-clear') return 'project'
      if (action === 'style-samples-save' || action === 'style-import-template') return 'style'
      if (action === 'relations-save') return 'bible'
      if (action === 'character-card-import') return 'bible'
      // 只读检查：与写作并行（不占章节写锁），同类检查之间互斥以防重复触发。
      if (action === 'continuity-check' || action === 'continuity-audit' || action === 'continuity-mark') {
        const number = Number(params?.number)
        return Number.isFinite(number) && number > 0 ? `read:continuity:${number}` : 'read:continuity'
      }
      if (action === 'chapter-audit' || action === 'chapter-review') {
        const number = Number(params?.number)
        return Number.isFinite(number) && number > 0 ? `read:audit:${number}` : 'read:audit'
      }
      if (action === 'outline-audit') return 'read:audit:outline'
      if (action === 'chapter-move') return 'outline'
      if (action.startsWith('snapshot-')) return 'project'
      if (action.startsWith('restore-')) return 'project'
      if (action === 'summarize-missing') return 'summary:batch'
      if (action.startsWith('summarize-')) return 'summary'
      if (action.startsWith('volume-')) return 'outline'
      if (action.startsWith('chapter-')) {
        const number = Number(params?.number ?? params?.fromChapter)
        return Number.isFinite(number) && number > 0 ? `chapter:${number}` : 'chapter'
      }
      if (action.startsWith('outline-')) return 'outline'
      if (action.startsWith('bible-')) return 'bible'
      if (action.startsWith('premise-')) return 'premise'
      if (action.startsWith('style-')) return 'style'
      return null
    }

    // 与 index.js 的 locksConflict 一致：连续写章与任何单章操作互斥。
    function runningConflict(running, resource) {
      if (!resource) return false
      if (running[resource]) return true
      if (resource === 'chapter:batch') {
        return Object.keys(running).some((key) => key.startsWith('chapter:'))
      }
      if (resource.startsWith('chapter:')) return Boolean(running['chapter:batch'])
      return false
    }

    function continuityIssueKey(issue) {
      return `${issue?.code ?? ''}|${issue?.message ?? ''}|${issue?.chapter ?? ''}`
    }

    function isContinuityApplied(record, issue) {
      return Boolean(record?.applied?.[continuityIssueKey(issue)])
    }

    // 主题化确认弹窗，替代 window.confirm（后者会弹系统原生框，和面板主题不一致）。
    const confirmListeners = new Set()
    let confirmRequest = null
    function requestConfirm(options) {
      const opts = typeof options === 'string' ? { message: options } : (options ?? {})
      if (typeof document === 'undefined') return Promise.resolve(false)
      return new Promise((resolve) => {
        const {
          title = '确认',
          message = '',
          danger = false,
          confirmLabel = '确定',
          cancelLabel = '取消',
        } = opts
        const host = document.createElement('div')
        host.className = 'nw-confirm-host'
        // 弹窗挂在 body 上，不在 .nw-app 子树里：手动带上主题属性让变量生效。
        try {
          const theme = localStorage.getItem('dsh.novelWriter.theme') || ''
          if (theme && theme !== 'default') host.setAttribute('data-theme', theme)
        } catch {
          // localStorage unavailable
        }
        const backdrop = document.createElement('div')
        backdrop.className = 'nw-modal-backdrop'
        const modal = document.createElement('div')
        modal.className = 'nw-modal nw-confirm-modal'
        modal.setAttribute('role', 'dialog')
        modal.setAttribute('aria-modal', 'true')
        const head = document.createElement('div')
        head.className = 'nw-confirm-head'
        const titleNode = document.createElement('span')
        titleNode.className = 'nw-confirm-title'
        titleNode.textContent = title
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'nw-confirm-close'
        close.setAttribute('aria-label', '关闭')
        close.textContent = '×'
        head.append(titleNode, close)
        const body = document.createElement('div')
        body.className = 'nw-confirm-body'
        body.textContent = message
        const actions = document.createElement('div')
        actions.className = 'nw-confirm-actions'
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.className = 'nw-btn'
        cancel.textContent = cancelLabel
        const ok = document.createElement('button')
        ok.type = 'button'
        ok.className = `nw-btn ${danger ? 'danger' : 'primary'}`
        ok.textContent = confirmLabel
        actions.append(cancel, ok)
        modal.append(head, body, actions)
        backdrop.append(modal)
        host.append(backdrop)
        document.body.append(host)
        const onKey = (event) => {
          if (event.key === 'Escape') settle(false)
        }
        const cleanup = () => document.removeEventListener('keydown', onKey)
        const settle = (value) => {
          cleanup()
          host.remove()
          resolve(value)
        }
        document.addEventListener('keydown', onKey)
        backdrop.addEventListener('click', (event) => {
          if (event.target === backdrop) settle(false)
        })
        modal.addEventListener('click', (event) => event.stopPropagation())
        close.addEventListener('click', () => settle(false))
        cancel.addEventListener('click', () => settle(false))
        ok.addEventListener('click', () => settle(true))
      })
    }
    function settleConfirm(value) {
      if (!confirmRequest) return
      const { resolve } = confirmRequest
      confirmRequest = null
      for (const listener of confirmListeners) listener(null)
      resolve(value)
    }
    function ConfirmHost() {
      const [request, setRequest] = useState(null)
      useEffect(() => {
        const listener = (next) => setRequest(next)
        confirmListeners.add(listener)
        logClient('confirm-host-mounted', { listeners: confirmListeners.size })
        if (confirmRequest) setRequest(confirmRequest)
        return () => {
          confirmListeners.delete(listener)
          logClient('confirm-host-unmounted', { listeners: confirmListeners.size })
        }
      }, [])
      if (!request) return null
      const {
        title = '确认',
        message = '',
        danger = false,
        confirmLabel = '确定',
        cancelLabel = '取消',
      } = request.options
      return h('div', { className: 'nw-modal-backdrop', onClick: () => settleConfirm(false) },
        h('div', {
          className: 'nw-modal',
          role: 'dialog',
          'aria-modal': 'true',
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { className: 'nw-eyebrow' }, title),
          h('p', { className: 'nw-muted', style: { margin: '6px 0 14px', whiteSpace: 'pre-line' } }, message),
          h('div', { className: 'nw-row', style: { justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'nw-btn', onClick: () => settleConfirm(false) }, cancelLabel),
            h('button', { type: 'button', className: `nw-btn ${danger ? 'danger' : 'primary'}`, onClick: () => settleConfirm(true) }, confirmLabel),
          ),
        ),
      )
    }

    function BookIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { fill: 'currentColor', d: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5Zm2.5-.5a.5.5 0 0 0-.5.5V19a4.5 4.5 0 0 1 1-.11h11V4H6.5Z' }))
    }

    function QuillIcon() {
      return h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { fill: 'currentColor', d: 'M20.5 3.5c-3.2.4-6.1 1.7-8.4 3.9-2.1 2-3.5 4.6-4.1 7.4l-1.9.6.9 1.9-2.6 2.6 1.4 1.4 2.6-2.6 1.9.9.6-1.9c2.8-.6 5.4-2 7.4-4.1 2.2-2.3 3.5-5.2 3.9-8.4l.2-1.9-1.9.2ZM8.9 14.1c.6-2.2 1.8-4.2 3.4-5.8 1.8-1.8 4.1-2.9 6.6-3.3-.4 2.5-1.5 4.8-3.3 6.6-1.6 1.6-3.6 2.8-5.8 3.4l-1-1Z' }))
    }

    function StepIntro({ eyebrow, title, desc, status, hints }) {
      return h('div', { className: 'nw-intro' },
        h('div', { className: 'nw-eyebrow' }, eyebrow),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h('h1', { className: 'nw-display' }, title),
          status ? h('span', { className: `nw-badge ${statusClass(status)}` }, displayStatus(status)) : null,
        ),
        desc ? h('p', { className: 'nw-desc' }, desc) : null,
        hints?.length
          ? h('ol', { className: 'nw-hints' }, hints.map((hint, index) => h('li', { key: index }, hint)))
          : null,
      )
    }

    function EmptyState({ title, desc, action }) {
      return h('div', { className: 'nw-empty' },
        h('div', { className: 'nw-empty-icon' }, h(BookIcon)),
        h('div', { className: 'nw-empty-title' }, title),
        h('div', { className: 'nw-muted' }, desc),
        action ? h('div', { className: 'nw-actions', style: { justifyContent: 'center' } }, action) : null,
      )
    }

    let layoutService = null
    let uiWorkspaceService = null
    let clientScope = null

    function resolveUiWorkspace() {
      if (!uiWorkspaceService && clientScope?.get) {
        try {
          uiWorkspaceService = clientScope.get('uiWorkspace') ?? null
        } catch {
          // service may not be mounted yet
        }
      }
      return uiWorkspaceService
    }

    function RunDetailModal({ detail, onClose, setToast }) {
      if (!detail) return null
      return h('div', { className: 'nw-modal-backdrop', onClick: onClose },
        h('div', { className: 'nw-modal', onClick: (event) => event.stopPropagation() },
          h('div', { className: 'nw-row' },
            h('div', null,
              h('div', { className: 'nw-eyebrow' }, detail.kind ? kindLabel(detail.kind) : '运行记录'),
              h('div', { className: 'nw-muted' }, `${detail.runId} · ${detail.createdAt ?? ''}`),
            ),
            h('button', { type: 'button', className: 'nw-btn', onClick: onClose }, '关闭'),
          ),
          h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
            `model=${detail.model?.model ?? '—'} · tokens=${detail.usage?.totalTokens ?? 0} · ${detail.durationMs ?? 0}ms${detail.finish?.kind ? ` · finish=${detail.finish.kind}` : ''}`),
          detail.parseError
            ? h('div', { className: 'nw-banner warn', style: { marginTop: '6px' } }, `JSON 解析失败：${detail.parseError}`)
            : null,
          detail.system
            ? h('div', null,
                h('div', { className: 'nw-result-label', style: { marginTop: '8px' } }, 'system'),
                h('pre', { className: 'nw-pre', style: { maxHeight: '180px' } }, detail.system),
                h('div', { className: 'nw-actions' },
                  h('button', {
                    type: 'button',
                    className: 'nw-btn ghost',
                    onClick: async () => {
                      try {
                        await navigator.clipboard.writeText(detail.system)
                        setToast('system 已复制')
                      } catch {
                        setToast('复制失败')
                      }
                    },
                  }, '复制 system'),
                ),
              )
            : null,
          (detail.messages ?? []).length
            ? h('div', null,
                h('div', { className: 'nw-result-label', style: { marginTop: '8px' } }, '输入'),
                detail.messages.map((message, index) => {
                  const text = (message.content ?? []).map((part) => part?.text ?? '').join('\n')
                  return h('pre', { key: index, className: 'nw-pre', style: { maxHeight: '160px' } }, `${message.role}:\n${text}`)
                }),
              )
            : null,
          detail.output
            ? h('div', null,
                h('div', { className: 'nw-result-label', style: { marginTop: '8px' } }, '输出'),
                h('pre', { className: 'nw-pre', style: { maxHeight: '240px' } }, detail.output),
              )
            : null,
          h('div', { className: 'nw-actions', style: { justifyContent: 'flex-end' } },
            detail.output
              ? h('button', {
                  type: 'button',
                  className: 'nw-btn',
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(detail.output)
                      setToast('已复制输出')
                    } catch {
                      setToast('复制失败')
                    }
                  },
                }, '复制输出')
              : null,
          ),
        ),
      )
    }

    function AssistantPanel({ root, onApplied }) {
      const [open, setOpen] = useState(false)
      const [messages, setMessages] = useState([])
      const [input, setInput] = useState('')
      const [plan, setPlan] = useState(null)
      const [applied, setApplied] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const post = async (action, params) => {
        const response = await fetch('/novel-writer/project-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectRoot: root, action, params }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`)
        return data.data
      }
      const send = async () => {
        const text = input.trim()
        if (!text || busy || !root) return
        setBusy(true)
        setError(null)
        setMessages((list) => [...list, { role: 'user', content: text }])
        setInput('')
        try {
          const data = await post('assistant-chat', { message: text })
          setMessages((list) => [...list, { role: 'assistant', content: data.reply }])
          setPlan(data.plan ?? null)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }
      const apply = async () => {
        if (!plan || !plan.actions?.length || busy) return
        setBusy(true)
        setError(null)
        try {
          const data = await post('assistant-apply', { actions: plan.actions })
          const done = (data.done ?? []).map((item) => (item.number ? `第${item.number}章` : item.type)).join('、')
          setMessages((list) => [...list, { role: 'assistant', content: `已执行：${done}` }])
          setApplied(data.done ?? [])
          setPlan(null)
          onApplied?.()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }
      return h('div', { className: 'nw-assist-wrap' },
        open
          ? h('div', { className: 'nw-assist' },
              h('div', { className: 'nw-assist-head' },
                h('span', null, '小说助手'),
                h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => setOpen(false) }, '收起'),
              ),
              h('div', { className: 'nw-assist-msgs' },
                messages.length === 0
                  ? h('div', { className: 'nw-muted' }, '可以讨论、提意见、让它改章；讨论不会动文件，改章会先给计划再执行。')
                  : null,
                messages.map((item, index) => h('div', { key: index, className: `nw-assist-msg ${item.role}` }, item.content)),
              ),
              plan
                ? h('div', { className: 'nw-assist-plan' },
                    h('div', { className: 'nw-eyebrow' }, '变更计划'),
                    h('div', { className: 'nw-muted' }, plan.summary || '按以下动作调整'),
                    (plan.actions ?? []).map((action, index) => h('div', { key: index, className: 'nw-assist-action' },
                      action.type === 'outline-update'
                        ? `第${action.number}章：${String(action.before?.title ?? '（空）')} → ${String(action.after?.title ?? action.fields?.title ?? '（改）')}${action.fields?.synopsis ? '；梗概重写' : ''}`
                        : action.type === 'chapter-edit'
                          ? `第${action.number}章正文：按指令改写`
                          : action.type === 'setting-update'
                            ? `设定：${Object.keys(action.fields ?? {}).join('、')}`
                            : action.type === 'generate'
                              ? `生成：${action.kind ?? '大纲'} ${action.count ?? ''} 章`
                              : action.type,
                    )),
                    h('div', { className: 'nw-row' },
                      h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: apply }, busy ? '执行中…' : '执行'),
                      h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => setPlan(null) }, '取消'),
                    ),
                  )
                : null,
              applied && applied.length > 0
                ? h('div', { className: 'nw-row' },
                    h('span', { className: 'nw-muted' }, `已改 ${applied.length} 处`),
                    h('button', {
                      type: 'button',
                      className: 'nw-btn ghost',
                      disabled: busy,
                      onClick: async () => {
                        setBusy(true)
                        setError(null)
                        try {
                          await post('assistant-undo', {})
                          setMessages((list) => [...list, { role: 'assistant', content: '已撤销上一批修改' }])
                          setApplied(null)
                          onApplied?.()
                        } catch (err) {
                          setError(err.message)
                        } finally {
                          setBusy(false)
                        }
                      },
                    }, '撤销'),
                  )
                : null,
              error ? h('div', { className: 'nw-error' }, error) : null,
              h('div', { className: 'nw-assist-input' },
                h('input', {
                  className: 'nw-input',
                  value: input,
                  placeholder: '例如：第9章太水，压一压，保留阿棠那场',
                  onChange: (event) => setInput(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') send()
                  },
                }),
                h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !input.trim(), onClick: send }, busy ? '…' : '发送'),
              ),
            )
          : null,
        h('button', { type: 'button', className: 'nw-assist-fab', title: '小说助手', onClick: () => setOpen((value) => !value) }, 'AI'),
      )
    }

    function DeskApp() {
      const [root, setRoot] = useState(readStoredRoot)
      const [state, setState] = useState(null)
      const [loading, setLoading] = useState(false)
      const [theme, setTheme] = useTheme()
      const [running, setRunning] = useState(() => readGlobalRunning())
      const runningRef = useRef(readGlobalRunning())
      useEffect(() => {
        const listener = (next) => setRunning(next)
        runningListeners.add(listener)
        setRunning(readGlobalRunning())
        return () => {
          runningListeners.delete(listener)
        }
      }, [])
      const [elapsed, setElapsed] = useState(0)
      const [clock, setClock] = useState(Date.now())
      const [taskOpen, setTaskOpen] = useState(true)
      const [runStages, setRunStages] = useState({})
      const [recentTasks, setRecentTasks] = useState([])
      const [queued, setQueued] = useState([])
      const queuedRef = useRef([])
      const [error, setError] = useState(null)
      const [toast, setToast] = useState(null)
      const [runDetail, setRunDetail] = useState(null)
      const [runFilter, setRunFilter] = useState('all')
      const [tab, setTabState] = useState(() => readStoredTab() ?? 'project')
      const [focusChapter, setFocusChapter] = useState(null)
      const setTab = (id) => {
        setTabState(id)
        try {
          localStorage.setItem(TAB_KEY, id)
        } catch {
          // storage unavailable
        }
      }
      // 只锁当前页：切到大纲页时，章节页正在生成的草稿不会挡住大纲按钮。
      const busy = Object.keys(running).some((key) => running[key]?.tab === tab)
      const anyBusy = Object.keys(running).length > 0
      const [inspTab, setInspTab] = useState('flow')
      const [discussion, setDiscussion] = useState(null)
      const discussionAbortRef = useRef(null)
      const [lastAction, setLastAction] = useState(null)
      const [focus, setFocus] = useState(false)
      const [direction, setDirection] = usePersistedInput(root, 'premiseDirection')
      const [inspectorOpen, setInspectorOpen] = useState(() =>
        typeof window === 'undefined' ? true : window.innerWidth > 1180,
      )
      const [catalog, setCatalog] = useState(null)
      const stageRef = useRef(null)

      useEffect(() => {
        stageRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
      }, [tab])

      useEffect(() => {
        let alive = true
        fetchModelCatalog()
          .then((data) => { if (alive) setCatalog(data) })
          .catch(() => {})
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (!focus) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setFocus(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [focus])

      const load = async (target = root) => {
        if (!target) return null
        const data = await fetchProjectState(target)
        setState(data)
        return data
      }

      useEffect(() => {
        if (!root) {
          setState(null)
          return undefined
        }
        let alive = true
        setLoading(true)
        setError(null)
        setDiscussion(null)
        fetchProjectState(root)
          .then((data) => {
            if (!alive) return
            setState(data)
            const stored = readStoredTab()
            setTab(
              stored && ['project', 'premise', 'style', 'bible', 'outline', 'chapters'].includes(stored)
                ? stored
                : defaultTab(data),
            )
          })
          .catch((err) => {
            if (alive) setError({ message: String(err?.message ?? err), raw: null })
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
        return () => {
          alive = false
        }
      }, [root])

      useEffect(() => {
        if (!busy) {
          setElapsed(0)
          return undefined
        }
        const started = Date.now()
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
        return () => clearInterval(timer)
      }, [busy])

      useEffect(() => {
        if (!anyBusy) return undefined
        const timer = setInterval(() => setClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [anyBusy])

      useEffect(() => {
        if (!anyBusy || !root) {
          setRunStages({})
          return undefined
        }
        let alive = true
        const poll = async () => {
          try {
            const response = await fetch(
              `/novel-writer/project-runs?projectRoot=${encodeURIComponent(root)}`,
              { cache: 'no-store' },
            )
            const payload = await response.json()
            if (!alive || !payload.ok) return
            const next = {}
            for (const item of payload.data ?? []) {
              if (item?.resource) next[item.resource] = item
            }
            setRunStages(next)
          } catch {
            // progress is best-effort
          }
        }
        poll()
        const timer = setInterval(poll, 1000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [anyBusy, root])

      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 3200)
        return () => clearTimeout(timer)
      }, [toast])

      const enqueueTask = (action, params, options, resource) => {
        const exists = queuedRef.current.some(
          (item) => item.action === action && item.resource === resource && JSON.stringify(item.params) === JSON.stringify(params),
        )
        if (exists) {
          setToast('该动作已在排队')
          return
        }
        const entry = {
          id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          action,
          params,
          options,
          resource,
          at: Date.now(),
        }
        queuedRef.current = [...queuedRef.current, entry]
        setQueued(queuedRef.current)
        setToast('已加入队列，当前任务完成后执行')
      }

      const cancelQueued = (id) => {
        queuedRef.current = queuedRef.current.filter((item) => item.id !== id)
        setQueued(queuedRef.current)
      }

      const drainQueue = () => {
        const index = queuedRef.current.findIndex((item) => !runningConflict(runningRef.current, item.resource))
        if (index < 0) return
        const [next] = queuedRef.current.splice(index, 1)
        queuedRef.current = [...queuedRef.current]
        setQueued(queuedRef.current)
        setTimeout(() => {
          run(next.action, next.params, next.options)
        }, 80)
      }

      const run = async (action, params = {}, options = {}) => {
        if (!root) return
        const resource = actionResource(action, params, state?.lockRules)
        if (resource && runningConflict(runningRef.current, resource)) {
          enqueueTask(action, params, options, resource)
          return
        }
        if (resource) {
          runningRef.current = {
            ...runningRef.current,
            [resource]: { action, tab: options.background ? 'background' : tab, startedAt: Date.now(), resource, params },
          }
          writeGlobalRunning(runningRef.current)
        }
        setError(null)
        setLastAction({ action, params, options })
        try {
          const result = await runProjectAction(root, action, params)
          setRecentTasks((prev) => [{ key: `${Date.now()}-${action}`, action, params, ok: true, at: Date.now() }, ...prev].slice(0, 6))
          await load()
          if (result?.paused) setToast('批量任务已暂停（当前章已完成）')
          if (options.next) setTab(options.next)
          if (options.toast) setToast(options.toast)
          if (!options.silent && !options.toast && result?.runId) setToast(`完成 · ${result.runId}`)
          return result
        } catch (err) {
          setRecentTasks((prev) => [{ key: `${Date.now()}-${action}`, action, params, ok: false, at: Date.now() }, ...prev].slice(0, 6))
          setError({ message: String(err?.message ?? err), raw: err?.raw ?? null, code: err?.code ?? null })
          try {
            await load()
          } catch {
            // keep original error
          }
          if (options.throwOnError) throw err
        } finally {
          if (resource) {
            const next = { ...runningRef.current }
            delete next[resource]
            runningRef.current = next
            writeGlobalRunning(next)
            setTimeout(drainQueue, 60)
          }
        }
      }

      const cancel = async () => {
        if (!root) return
        await fetch('/novel-writer/project-cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectRoot: root }),
        }).catch(() => {})
        runningRef.current = {}
        writeGlobalRunning({})
        queuedRef.current = []
        setQueued([])
        setToast('已请求取消')
        setTimeout(() => load().catch(() => {}), 400)
      }

      const cancelTask = async (resource) => {
        if (!root || !resource) return false
        try {
          const response = await fetch('/novel-writer/project-cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot: root, resource }),
          })
          const payload = await response.json()
          if (!payload.ok) throw new Error(payload.error?.message ?? '取消任务失败')
          const next = { ...runningRef.current }
          delete next[resource]
          runningRef.current = next
          writeGlobalRunning(next)
          setToast('已取消该任务')
          return true
        } catch (error) {
          setToast(String(error?.message ?? error))
          return false
        }
      }

      const retryTask = async (task) => {
        if (!task?.resource) return
        const ok = await cancelTask(task.resource)
        if (!ok) return
        setTimeout(() => {
          run(task.action, task.params, { toast: '已重新开始任务' })
        }, 700)
      }

      const pauseTask = async (resource) => {
        if (!root || !resource) return
        try {
          const response = await fetch('/novel-writer/project-pause', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot: root, resource }),
          })
          const payload = await response.json()
          if (!payload.ok) throw new Error(payload.error?.message ?? '暂停失败')
          setToast('已请求暂停：当前章写完后停止')
        } catch (error) {
          setToast(String(error?.message ?? error))
        }
      }

      const pickProject = async () => {
        const service = resolveUiWorkspace()
        const fallback = () => {
          const manual = typeof window.prompt === 'function'
            ? window.prompt('目录选择器不可用，请输入项目绝对路径：', '')
            : null
          if (manual && manual.trim()) {
            storeRoot(manual.trim())
            setRoot(manual.trim())
            return true
          }
          return false
        }
        if (!service?.pickDirectory) {
          if (!fallback()) setToast('目录选择器不可用；可以手输路径，或刷新页面后重试')
          return
        }
        try {
          const picked = await service.pickDirectory()
          if (picked) {
            storeRoot(picked)
            setRoot(picked)
          }
        } catch (error) {
          if (!fallback()) setToast(`打开目录选择器失败：${String(error?.message ?? error)}`)
        }
      }

      const discussionAutoConfirmKey = (topicId) => `dsh.novelWriter.discussionAutoConfirm.${encodeURIComponent(root ?? '')}.${topicId}`
      const readDiscussionAutoConfirm = (topicId) => {
        try { return localStorage.getItem(discussionAutoConfirmKey(topicId)) === '1' } catch { return false }
      }
      const storeDiscussionAutoConfirm = (topicId, value) => {
        try { localStorage.setItem(discussionAutoConfirmKey(topicId), value ? '1' : '0') } catch { /* ignore */ }
      }
      const openDiscussion = async (topicId, topic, item) => {
        setInspTab('discuss')
        setDiscussion({ topicId, topic, item, messages: [], loading: true, error: null, context: '', autoConfirm: readDiscussionAutoConfirm(topicId) })
        try {
          const thread = await fetchDiscussion(root, topicId)
          setDiscussion({ topicId, topic, item, messages: thread.messages ?? [], loading: false, error: null, context: '', autoConfirm: readDiscussionAutoConfirm(topicId) })
        } catch (err) {
          setDiscussion((prev) => (prev ? { ...prev, loading: false, error: String(err?.message ?? err) } : prev))
        }
      }

      const sendDiscussion = async (text) => {
        if (!root || !discussion || !text.trim()) return
        if (discussionAbortRef.current) discussionAbortRef.current.abort()
        const controller = new AbortController()
        discussionAbortRef.current = controller
        setDiscussion((prev) => ({ ...prev, loading: true, stopped: false, error: null, streamText: '', context: '' }))
        try {
          const result = await postDiscussionStream(root, {
            topicId: discussion.topicId,
            topic: discussion.topic,
            item: discussion.item,
            message: text,
          }, (raw) => {
            const partial = extractReplyPartial(raw)
            if (!partial) return
            setDiscussion((prev) => (prev ? { ...prev, streamText: partial } : prev))
          }, controller.signal)
          setDiscussion((prev) => ({
            ...prev,
            messages: result.messages ?? [],
            loading: false,
            stopped: false,
            streamText: '',
            context: result.context ?? '',
          }))
        } catch (err) {
          const aborted = controller.signal.aborted || err?.name === 'AbortError'
          setDiscussion((prev) => ({
            ...prev,
            loading: false,
            stopped: aborted,
            error: aborted ? '已停止生成' : String(err?.message ?? err),
          }))
        } finally {
          if (discussionAbortRef.current === controller) discussionAbortRef.current = null
        }
      }

      const stopDiscussion = () => {
        discussionAbortRef.current?.abort()
        discussionAbortRef.current = null
      }

      const applyDiscussionResult = async (action, currentDiscussion, message, selectedIndexes = null, autoConfirm = false) => {
        try {
          const allActions = Array.isArray(message.result?.actions) ? message.result.actions : []
          const selectedActions = Array.isArray(selectedIndexes)
            ? allActions.filter((_, index) => selectedIndexes.includes(index))
            : allActions
          const number =
            currentDiscussion.item?.number ??
            Number(String(currentDiscussion.topicId).match(/chapter-(\d+)/)?.[1]) ??
            null
          const suggestions = Array.isArray(message.result?.suggestions)
            ? message.result.suggestions.map((item) => String(item)).filter(Boolean)
            : []
          const actionInstructions = selectedActions
            .filter((item) => item?.type === 'chapter-instruction')
            .map((item) => String(item.instruction ?? '').trim())
            .filter(Boolean)
          const detailText = suggestions.length
            ? `${message.result?.conclusion ? `结论：${message.result.conclusion}\n\n` : ''}具体改法：\n${suggestions.map((item) => `- ${item}`).join('\n')}`
            : (message.result?.conclusion || cleanDiscussionText(message.text))
          const revisionInstruction = actionInstructions.length
            ? actionInstructions.join('\n')
            : detailText
          const data = await postDiscussionApply(root, {
            action,
            topicId: currentDiscussion.topicId,
            topic: currentDiscussion.topic,
            reply: message.text,
            result: message.result ?? {},
            item: currentDiscussion.item,
            actions: selectedActions,
            number,
            instruction: action === 'instruction' ? revisionInstruction : detailText,
          })
          if (action === 'actions') {
            await load()
            const items = Array.isArray(data.appliedItems) ? data.appliedItems : []
            const landed = items
              .map((item) => {
                if (item.type === 'chapter-instruction') return `第 ${item.number} 章修订要求`
                if (item.type === 'outline-update') return `章纲「${item.chapterId ?? ''}」`
                if (item.type === 'bible-update') return `设定「${item.entryId ?? ''}」`
                if (item.type === 'style-update') return '文风字段'
                if (item.type === 'premise-candidate-update') return '构思候选'
                return item.type
              })
              .join('、')
            if (data.applyId) {
              setDiscussion((prev) => (prev ? {
                ...prev,
                lastApply: { id: data.applyId, landed, items, errors: data.errors ?? [] },
              } : prev))
            }
            setToast(`已应用 ${data.appliedCount ?? 0} 项：${landed || '见讨论记录'}${data.errors?.length ? `（${data.errors.length} 项失败）` : ''}`)
            const chapterActions = selectedActions.filter((item) => item.type === 'chapter-instruction')
            if (autoConfirm) {
              storeDiscussionAutoConfirm(currentDiscussion.topicId, true)
              setDiscussion((prev) => (prev ? { ...prev, autoConfirm: true } : prev))
            }
            const revisions = new Map()
            for (const actionItem of chapterActions) {
              const targetNumber = Number(actionItem.target?.number ?? number)
              const instruction = String(actionItem.instruction ?? '').trim()
              if (!Number.isFinite(targetNumber) || !instruction) continue
              revisions.set(targetNumber, revisions.has(targetNumber) ? `${revisions.get(targetNumber)}\n${instruction}` : instruction)
            }
            for (const [targetNumber, instruction] of revisions) {
              const chapterInfo = (state?.chapters ?? []).find((item) => Number(item.number) === Number(targetNumber))
              if (chapterInfo?.hasDraft || chapterInfo?.hasFinal) {
                await run('chapter-revise', { number: targetNumber, instruction }, { toast: `第 ${targetNumber} 章已按讨论结果重写` })
              }
            }
            try {
              window.dispatchEvent(new CustomEvent('nw-chapters-refresh'))
            } catch {
              // non-browser
            }
            return
          }
          if (action === 'instruction') {
            try {
              window.dispatchEvent(new CustomEvent('nw-instruction-updated', {
                detail: { number: data.number ?? number, instruction: data.instruction ?? detailText },
              }))
            } catch {
              // non-browser
            }
            setToast('已写入本章修订要求（含具体改法）')
            return
          }
          setToast(`已保存备注：${data.path}`)
        } catch (err) {
          setDiscussion((prev) => (prev ? { ...prev, error: String(err?.message ?? err) } : prev))
        }
      }

      const cleanDiscussionText = (text) => {
        const raw = String(text ?? '').trim()
        if (!raw.startsWith('{')) return raw
        const match = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        if (match) {
          try {
            return JSON.parse(`"${match[1]}"`)
          } catch {
            return match[1]
          }
        }
        return raw
      }

      const copyDiscussionText = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setToast('已复制')
        } catch {
          setToast('复制失败，请手动选择文本')
        }
      }

      const undoDiscussionApply = async () => {
        const applyId = discussion?.lastApply?.id
        if (!applyId) return
        try {
          await postDiscussionApply(root, { action: 'undo', applyId })
          await load()
          setDiscussion((prev) => (prev ? { ...prev, lastApply: null } : prev))
          setToast('已撤销讨论应用')
        } catch (error) {
          setDiscussion((prev) => (prev ? { ...prev, error: String(error?.message ?? error) } : prev))
        }
      }

      if (!root) {
        return h(ProjectPicker, { onPick: pickProject, onManual: (path) => { storeRoot(path); setRoot(path) } })
      }

      const workflow = state?.workflow ?? { next: 'init', blockers: [] }
      const stepStatusValue = (id) => stepStatus(state, id)
      const steps = [
        ['project', '项目', '项目与流程'],
        ['premise', '构思', '定故事核心'],
        ['style', '文风', '定文字质感'],
        ['bible', '设定', '角色与世界规则'],
        ['chapters', '章节', '章纲与正文'],
      ]

      const top = h('div', { className: 'nw-top' },
        h('div', { className: 'nw-mark' }, h(QuillIcon)),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', { className: 'nw-eyebrow' }, 'DeepNovel'),
          h('div', { className: 'nw-title' }, state?.project?.title ?? '写作台'),
          h('div', { className: 'nw-path' }, root),
        ),
        h('div', { className: 'nw-next', style: { margin: 0 } },
          h('span', null, '下一步：'),
          h('b', null, NEXT_LABELS[workflow.next] ?? workflow.next),
        ),
        h('select', {
          className: 'nw-mobile-steps',
          value: tab === 'outline' ? 'chapters' : tab,
          onChange: (event) => setTab(event.target.value),
          'aria-label': '切换步骤',
        },
          steps.map(([id, label]) => h('option', { key: id, value: id }, label)),
        ),
        state?.stats
          ? (() => {
              const words = Number(state.stats.words) || 0
              const target = Number(state.stats.target) || 0
              const pct = target > 0 ? Math.min(100, Math.round((words / target) * 100)) : 0
              return h('div', { className: 'nw-wordbar', title: target > 0 ? `全书进度 ${pct}%` : '全书字数' },
                h('div', { className: 'nw-wordbar-label' },
                  h('span', null, `${words} 字`),
                  target > 0
                    ? h('span', null, `${pct}%`)
                    : h('span', null, `定稿 ${state.stats.approved ?? 0} 章`),
                ),
                h('div', { className: 'nw-wordbar-track' },
                  h('div', { className: 'nw-wordbar-fill', style: { width: target > 0 ? `${pct}%` : '0%' } }),
                ),
              )
            })()
          : null,
        h('div', { className: 'nw-top-actions' },
          h(ThemeMenu, { theme, onTheme: setTheme }),
          h('button', { type: 'button', className: 'nw-btn ghost', title: '显示/隐藏右侧面板', onClick: () => setInspectorOpen((value) => !value) }, inspectorOpen ? '收起面板' : '面板'),
          h('button', { type: 'button', className: 'nw-btn ghost', title: '专注模式（Esc 退出）', onClick: () => setFocus((value) => !value) }, focus ? '退出专注' : '专注'),
          busy
            ? h('button', { type: 'button', className: 'nw-btn danger', onClick: cancel }, h('span', { className: 'nw-spinner' }), `${elapsed}s`)
            : h('button', { type: 'button', className: 'nw-btn ghost icon', title: '刷新', onClick: () => load().catch(() => {}) }, '↻'),
          anyBusy || queued.length
            ? h('button', { type: 'button', className: 'nw-btn ghost', title: '查看并行任务', onClick: () => setTaskOpen((value) => !value) }, `任务 ${Object.keys(running).length + queued.length}`)
            : null,
          h('button', { type: 'button', className: 'nw-btn', onClick: () => setRoot(null) }, '切换项目'),
        ),
      )

      const rail = h('div', { className: 'nw-rail' },
        h('div', { className: 'nw-rail-title' }, '创作流程'),
        steps.map(([id, label, desc], index) => {
          const status = stepStatusValue(id)
          const active = id === 'chapters' ? (tab === 'chapters' || tab === 'outline') : tab === id
          return h('button', {
            key: id,
            type: 'button',
            className: `nw-rail-step${active ? ' active' : ''}${status === 'confirmed' ? ' ok' : ''}`,
            onClick: () => setTab(id),
          },
            h('span', { className: 'nw-rail-num' }, status === 'confirmed' ? '✓' : String(index + 1).padStart(2, '0')),
            h('span', { style: { minWidth: 0 } },
              h('div', { className: 'nw-rail-label' }, label),
              h('div', { className: 'nw-rail-desc' }, desc),
            ),
          )
        }),
        h('div', { className: 'nw-rail-foot' },
          h('div', { className: 'nw-muted', style: { wordBreak: 'break-all', marginBottom: '8px' } }, root),
          h('button', { type: 'button', className: 'nw-btn', style: { width: '100%' }, onClick: () => setRoot(null) }, '切换项目'),
        ),
      )

      const content = loading
        ? h('div', { className: 'nw-empty' }, '加载中…')
        : !state
          ? h('div', { className: 'nw-empty' }, '暂无状态')
          : !state.initialized
            ? h(InitView, { state, run, busy })
            : tab === 'project'
              ? h(ProjectView, { state, run, busy, catalog, goTo: setTab, setToast })
              : tab === 'premise'
                ? h(PremiseView, { state, run, busy, direction, setDirection, goTo: setTab, openDiscussion, setToast })
                : tab === 'style'
                  ? h(StyleView, { state, run, busy, openDiscussion, setToast })
                  : tab === 'bible'
                    ? h(BibleView, {
                        state, run, busy, openDiscussion, setToast,
                        onOpenOutline: (number) => { setFocusChapter(number); setTab('outline') },
                      })
                    : tab === 'outline' || tab === 'chapters'
                      ? h(ChapterWorkspace, {
                          state, root, run, busy, openDiscussion, setToast,
                          focusChapter,
                          mode: tab,
                          setTab,
                          openChapter: (number) => { setFocusChapter(number); setTab('chapters') },
                          openOutline: (number) => { setFocusChapter(number); setTab('outline') },
                          onSelectChapter: setFocusChapter,
                        })
                      : null

      const nextTab =
        workflow.next === 'draft' || workflow.next === 'outline'
          ? 'chapters'
          : workflow.next === 'init'
            ? 'project'
            : workflow.next
      const nextBar = state?.initialized
        ? h('div', { className: 'nw-nextbar' },
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'nw-eyebrow' }, '下一步'),
              h('div', { className: 'nw-next-title' }, NEXT_LABELS[workflow.next] ?? workflow.next),
              (workflow.blockers ?? []).length
                ? h('div', { className: 'nw-muted' }, workflow.blockers.join(' · '))
                : null,
            ),
            h('button', {
              type: 'button',
              className: 'nw-btn primary',
              disabled: tab === nextTab,
              onClick: () => setTab(nextTab),
            }, tab === nextTab ? '已在本步' : `前往「${STEP_LABELS[nextTab] ?? nextTab}」`),
          )
        : null

      const flowInspector = h('div', null,
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '下一步'),
          h('div', { className: 'nw-p', style: { fontWeight: 600 } }, NEXT_LABELS[workflow.next] ?? workflow.next),
          (workflow.blockers ?? []).length
            ? h('div', { className: 'nw-muted', style: { marginTop: '4px', color: 'var(--dsw-alias-state-warn-primary)' } }, workflow.blockers.join(' · '))
            : h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '流程已就绪。'),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '阶段'),
          steps.slice(1).map(([id, label]) =>
            h('div', { key: id, className: 'nw-row', style: { padding: '4px 0' } },
              h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                h('span', { className: `nw-dot ${statusClass(stepStatusValue(id))}` }),
                h('span', { className: 'nw-muted' }, label),
              ),
              h('span', { className: 'nw-muted' }, displayStatus(stepStatusValue(id)) || '—'),
            ),
          ),
        ),
        error
          ? h('div', { className: 'nw-card' },
              h('div', { className: 'nw-row' },
                h('h3', { className: 'nw-h3', style: { color: 'var(--dsw-alias-state-error-primary)' } }, '操作失败'),
                lastAction ? h('button', { type: 'button', className: 'nw-btn', onClick: () => run(lastAction.action, lastAction.params, lastAction.options) }, '重试') : null,
              ),
              h('div', { className: 'nw-muted' }, error.message),
              error.code ? h('div', { className: 'nw-muted' }, `code: ${error.code}`) : null,
              error.raw ? h('details', null,
                h('summary', { className: 'nw-muted', style: { cursor: 'pointer', marginTop: '4px' } }, '查看原始输出'),
                h('pre', { className: 'nw-pre' }, error.raw),
              ) : null,
            )
          : null,
        recentTasks.length
          ? h('div', { className: 'nw-card' },
              h('div', { className: 'nw-row' }, h('h3', { className: 'nw-h3' }, '最近任务')),
              recentTasks.map((task) =>
                h('div', { key: task.key, className: 'nw-row', style: { padding: '4px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
                  h('div', { style: { minWidth: 0 } },
                    h('div', { style: { fontSize: '11px' } }, taskLabel(task.action, task.params)),
                    h('div', { className: 'nw-muted' }, `${new Date(task.at).toLocaleTimeString()} · ${task.ok ? '完成' : '失败'}`),
                  ),
                  h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: () => run(task.action, task.params, { toast: '已重试' }) }, '重试'),
                ),
              ),
            )
          : null,
        h('div', { className: 'nw-card' },
          h('details', null,
            h('summary', { className: 'nw-muted', style: { cursor: 'pointer' } }, `最近运行（${state?.recentRuns?.length ?? 0}）`),
            (() => {
              const runs = (state?.recentRuns ?? []).filter(
                (item) => runFilter === 'all' || String(item.kind ?? '').includes(runFilter),
              )
              return h('div', null,
                h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
                  h('select', {
                    className: 'nw-select',
                    value: runFilter,
                    onChange: (event) => setRunFilter(event.target.value),
                  }, [
                    ['all', '全部'],
                    ['outline', '大纲'],
                    ['chapter', '章节'],
                    ['style', '文风'],
                    ['bible', '设定'],
                    ['premise', '构思'],
                    ['discussion', '讨论'],
                    ['deconstruct', '拆书'],
                  ].map(([id, label]) => h('option', { key: id, value: id }, label))),
                  h('span', { className: 'nw-muted', style: { alignSelf: 'center' } }, `${runs.length} 条`),
                  h('button', {
                    type: 'button',
                    className: 'nw-btn ghost',
                    disabled: busy,
                    onClick: async () => {
                      const preview = await run('runs-clear', { keep: 20, dryRun: true }, { silent: true })
                      if (!preview) return
                      if (!preview.remove) {
                        setToast('没有需要清理的记录')
                        return
                      }
                      if (!(await requestConfirm({
                        title: '清理运行记录',
                        message: `将删除 ${preview.remove} 条旧记录（共 ${preview.total} 条，保留最近 20 条），删除后无法恢复。`,
                        danger: true,
                      }))) return
                      run('runs-clear', { keep: 20 }, { toast: '运行记录已清理' })
                    },
                  }, '清理旧记录'),
                ),
                runs.length === 0
                  ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '没有匹配的记录。')
                  : runs.map((item) =>
                      h('div', { key: item.runId, style: { padding: '4px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
                        h('div', { className: 'nw-row' },
                          h('div', { style: { fontSize: '11px', flex: 1 }, title: item.kind ?? '' }, `${item.kind ? kindLabel(item.kind) : item.runId}${item.number ? ` · 第 ${item.number} 章` : ''}`),
                          h('button', {
                            type: 'button',
                            className: 'nw-btn ghost',
                            onClick: async () => {
                              const detail = await run('run-detail', { runId: item.runId }, { silent: true })
                              if (detail) setRunDetail(detail)
                            },
                          }, '查看'),
                        ),
                        h('div', { className: 'nw-muted' }, `${item.usage?.totalTokens ?? 0} tokens${item.parseError ? ' · JSON 修复失败' : ''}${item.createdAt ? ` · ${String(item.createdAt).slice(5, 16).replace('T', ' ')}` : ''}`),
                      ),
                    ),
              )
            })(),
          ),
        ),
        runDetail ? h(RunDetailModal, { detail: runDetail, onClose: () => setRunDetail(null), setToast }) : null,
      )

      const inspector = h('div', { className: 'nw-inspector' },
        h('div', { className: 'nw-insp-tabs' },
          h('button', { type: 'button', className: `nw-insp-tab${inspTab === 'flow' ? ' active' : ''}`, onClick: () => setInspTab('flow') }, '流程'),
          h('button', { type: 'button', className: `nw-insp-tab${inspTab === 'discuss' ? ' active' : ''}`, onClick: () => setInspTab('discuss') }, '讨论'),
        ),
        h('div', { className: 'nw-insp-body' },
          inspTab === 'discuss'
            ? h(DiscussionPanel, {
                discussion,
                onSend: sendDiscussion,
                onApplyInstruction: (message) => applyDiscussionResult('instruction', discussion, message),
                onSaveNote: (message) => applyDiscussionResult('note', discussion, message),
                onApplyActions: (message, selectedIndexes, autoConfirm) => applyDiscussionResult('actions', discussion, message, selectedIndexes, autoConfirm),
                onToggleAutoConfirm: () => {
                  const next = !discussion?.autoConfirm
                  if (discussion?.topicId) storeDiscussionAutoConfirm(discussion.topicId, next)
                  setDiscussion((prev) => (prev ? { ...prev, autoConfirm: next } : prev))
                },
                onUndoApply: undoDiscussionApply,
                onCopy: copyDiscussionText,
                onStop: stopDiscussion,
                onClose: () => setInspTab('flow'),
              })
            : flowInspector,
        ),
      )

      const taskEntries = Object.entries(running)
      const queuedEntries = queued
      const taskDock = taskEntries.length || queuedEntries.length
        ? h('div', { className: `nw-task-dock${taskOpen ? ' open' : ' collapsed'}` },
            h('div', { className: 'nw-task-head' },
              h('div', { className: 'nw-task-title' }, `运行中 ${taskEntries.length}${queuedEntries.length ? ` · 排队 ${queuedEntries.length}` : ''}`),
              h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => setTaskOpen((value) => !value) }, taskOpen ? '收起' : '展开'),
              h('button', { type: 'button', className: 'nw-btn danger', onClick: cancel }, '全部取消'),
            ),
            taskOpen
              ? h('div', { className: 'nw-task-list' },
                  taskEntries.map(([resource, task]) =>
                    h('div', { key: resource, className: 'nw-task-row' },
                      h('span', { className: 'nw-spinner' }),
                      h('div', { className: 'nw-task-main' },
                        h('div', { className: 'nw-task-label' }, taskLabel(task.action, task.params)),
                        h('div', { className: 'nw-muted' }, `${task.tab === 'background' ? '后台 · ' : ''}${STAGE_LABELS[runStages[resource]?.stage] ?? runStages[resource]?.stage ?? STEP_LABELS[task.tab] ?? '处理中'} · ${Math.max(0, Math.floor((clock - (task.startedAt ?? clock)) / 1000))}s`),
                        h('div', { className: 'nw-task-bar' }, h('span')),
                      ),
                      h('div', { className: 'nw-task-actions' },
                        resource === 'chapter:batch' ? h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => pauseTask(resource) }, '暂停') : null,
                        h('button', { type: 'button', className: 'nw-btn ghost', disabled: !task.action, onClick: () => retryTask(task) }, '重试'),
                        h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => cancelTask(resource) }, '取消'),
                      ),
                    ),
                  ),
                  queuedEntries.map((task) =>
                    h('div', { key: task.id, className: 'nw-task-row' },
                      h('span', { className: 'nw-badge cur' }, '排队'),
                      h('div', { className: 'nw-task-main' },
                        h('div', { className: 'nw-task-label' }, taskLabel(task.action, task.params)),
                        h('div', { className: 'nw-muted' }, '等待当前同资源任务完成'),
                      ),
                      h('div', { className: 'nw-task-actions' },
                        h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => cancelQueued(task.id) }, '移除'),
                      ),
                    ),
                  ),
                  h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '同资源任务自动排队；不同章节/阶段可并行。'),
                )
              : null,
          )
        : null

      return h('div', { className: `nw-app${focus ? ' nw-focus' : ''}${inspectorOpen ? ' nw-inspector-open' : ' nw-inspector-closed'}`, 'data-theme': theme },
        top,
        h('div', { className: 'nw-body' },
          rail,
          h('div', { className: 'nw-stage', ref: stageRef }, h('div', { className: 'nw-stage-inner' }, content, nextBar)),
          inspector,
        ),
        taskDock,
        h(AssistantPanel, { root, onApplied: () => load() }),
        toast ? h('div', { className: 'nw-toast' }, toast) : null,
      )
    }

    function ProjectPicker({ onPick, onManual }) {
      const [path, setPath] = useState('')
      const [recent, setRecent] = useState(readRecentRoots)
      const removeRecent = (target) => {
        const next = recent.filter((item) => item !== target)
        setRecent(next)
        storeRecentRoots(next)
      }
      const clearRecent = () => {
        setRecent([])
        storeRecentRoots([])
      }
      return h('div', { className: 'nw-app' },
        h(ConfirmHost),
        h('div', { className: 'nw-top' },
          h('div', { className: 'nw-mark' }, h(QuillIcon)),
          h('div', null,
            h('div', { className: 'nw-eyebrow' }, 'DeepNovel'),
            h('div', { className: 'nw-title' }, '写作台'),
          ),
        ),
        h('div', { className: 'nw-stage' },
          h('div', { className: 'nw-picker' },
            h('div', { className: 'nw-picker-card' },
              h('div', { className: 'nw-eyebrow' }, '打开项目'),
              h('h1', { className: 'nw-display', style: { fontSize: '26px', marginTop: '6px' } }, '从一个目录开始写作'),
              h('p', { className: 'nw-desc' }, '写作台独立于会话：选择一个空目录或已有故事项目目录，初始化或打开已有 story/ 项目即可开始。'),
              h('div', { className: 'nw-picker-row' },
                h('button', { type: 'button', className: 'nw-btn primary', onClick: onPick }, '选择项目目录'),
              ),
              h('div', { className: 'nw-field' },
                h('label', { className: 'nw-label' }, '或直接输入绝对路径'),
                h('div', { style: { display: 'flex', gap: '8px' } },
                  h('input', {
                    className: 'nw-input',
                    value: path,
                    placeholder: '例如：D:\\Novels\\my-book',
                    onChange: (event) => setPath(event.target.value),
                  }),
                  h('button', { type: 'button', className: 'nw-btn', disabled: !path.trim(), onClick: () => onManual(path.trim()) }, '打开'),
                ),
                h('div', { className: 'nw-muted', style: { marginTop: '5px' } }, '请选择小说项目目录，不要使用插件仓库目录。'),
              ),
              recent.length
                ? h('div', { className: 'nw-recent' },
                    h('div', { className: 'nw-row' },
                      h('div', { className: 'nw-label', style: { margin: 0 } }, '最近项目'),
                      h('button', { type: 'button', className: 'nw-btn ghost', onClick: clearRecent }, '清空'),
                    ),
                    recent.map((item) =>
                      h('div', { key: item, className: 'nw-recent-row' },
                        h('button', { type: 'button', className: 'nw-recent-path', onClick: () => onManual(item), title: item }, item),
                        h('button', { type: 'button', className: 'nw-recent-remove', title: '从最近项目移除', onClick: () => removeRecent(item) }, '×'),
                      ),
                    ),
                  )
                : null,
            ),
          ),
        ),
      )
    }

    function DiscussionPanel({ discussion, onSend, onApplyInstruction, onSaveNote, onApplyActions, onUndoApply, onCopy, onClose, onStop, onToggleAutoConfirm }) {
      const [text, setText] = useState('')
      const [pendingMessage, setPendingMessage] = useState(null)
      const [pendingSelected, setPendingSelected] = useState([])
      const [autoConfirmNext, setAutoConfirmNext] = useState(false)
      useEffect(() => { setText(''); setPendingMessage(null); setPendingSelected([]); setAutoConfirmNext(false) }, [discussion?.topicId])
      if (!discussion) {
        return h('div', { className: 'nw-empty' },
          h('div', { className: 'nw-empty-icon' }, h(QuillIcon)),
          h('div', { className: 'nw-empty-title' }, '按需讨论'),
          h('div', { className: 'nw-muted' }, '在任意构思、文风、章纲或章节旁点「讨论」，这里会开一个只针对该对象的讨论线程。'),
        )
      }
      const canApplyInstruction = /^chapter-\d+/.test(String(discussion.topicId))
      const lastUser = [...(discussion.messages ?? [])].reverse().find((message) => message.role === 'user')?.text ?? ''
      const renderList = (label, items) => {
        if (!Array.isArray(items) || items.length === 0) return null
        return h('div', { className: 'nw-result-group' },
          h('div', { className: 'nw-result-label' }, label),
          items.slice(0, 6).map((item, index) => h('div', { key: index, className: 'nw-result-item' }, `· ${item}`)),
        )
      }
      const targetLabel = (action) => {
        const target = action.target
        if (!target) return ''
        if (target.kind === 'chapter') return `第 ${target.number ?? '?'} 章`
        if (target.kind === 'outline') return `第 ${target.number ?? target.id ?? '?'} 章章纲`
        if (target.kind === 'bible') return `设定 ${target.category ?? ''}${target.id ? ` · ${target.id}` : ''}`
        if (target.kind === 'style') return '文风'
        if (target.kind === 'premise') return `构思 ${target.id ?? ''}`
        return ''
      }
      const actionSummary = (action) => {
        const prefix = targetLabel(action) ? `[${targetLabel(action)}] ` : ''
        if (action.type === 'chapter-instruction') return `${prefix}重写正文：${String(action.instruction ?? '').slice(0, 100)}`
        if (action.type === 'outline-update') return `${prefix}修改章纲：${Object.entries(action.fields ?? {}).map(([key, value]) => `${key}=${String(value).slice(0, 40)}`).join('；')}`
        if (action.type === 'bible-update') return `${prefix}修改设定：${Object.entries(action.fields ?? {}).map(([key, value]) => `${key}=${String(value).slice(0, 40)}`).join('；')}`
        if (action.type === 'style-update') return `${prefix}修改文风：${Object.entries(action.fields ?? {}).map(([key, value]) => `${key}=${String(value).slice(0, 40)}`).join('；')}`
        if (action.type === 'premise-candidate-update') return `${prefix}修改构思：${Object.entries(action.fields ?? {}).map(([key, value]) => `${key}=${String(value).slice(0, 40)}`).join('；')}`
        return action.type
      }
      const formatFieldValue = (value) => {
        if (value === undefined || value === null || value === '') return '（空）'
        if (Array.isArray(value)) return value.join('、')
        return String(value).slice(0, 160)
      }
      const currentFieldValue = (action, key) => {
        const item = discussion?.item ?? {}
        if (action.type === 'style-update') return item.fields?.[key]
        return item[key]
      }
      return h('div', { className: 'nw-discuss' },
        h('div', { className: 'nw-discuss-head' },
          h('div', { className: 'nw-eyebrow' }, '讨论'),
          h('div', { className: 'nw-h3' }, discussion.topic),
          h('div', { className: 'nw-muted' }, '讨论只针对这个对象。确认应用后：章节会写入修订要求并重写正文，章纲/设定/文风/构思会直接更新字段；「仅存备注」只存档，不改文件。'),
          discussion.autoConfirm
            ? h('div', { className: 'nw-banner warn', style: { marginTop: '6px' } },
                h('span', { style: { flex: 1 } }, '本线程已开启自动确认：后续讨论产生的修改会直接执行。'),
                h('button', { type: 'button', className: 'nw-btn', onClick: () => onToggleAutoConfirm?.() }, '关闭自动确认'),
              )
            : null,
          discussion.context
            ? h('details', { className: 'nw-qa-details', style: { marginTop: '5px' } },
                h('summary', { className: 'nw-qa-summary-line' }, '查看本次注入的上下文'),
                h('pre', { className: 'nw-pre', style: { maxHeight: '220px' } }, discussion.context),
              )
            : null,
          discussion.lastApply
            ? h('div', { className: 'nw-banner warn', style: { marginTop: '6px' } },
                h('div', null, `已应用${discussion.lastApply.landed ? `：${discussion.lastApply.landed}` : '这次讨论修改'}。`),
                discussion.lastApply.errors?.length
                  ? h('div', { className: 'nw-muted' }, `${discussion.lastApply.errors.length} 项失败`)
                  : null,
                h('button', { type: 'button', className: 'nw-btn', style: { marginTop: '4px' }, onClick: onUndoApply }, '撤销应用'),
              )
            : null,
        ),
        h('div', { className: 'nw-discuss-msgs' },
          discussion.loading && (discussion.messages ?? []).length === 0 && !discussion.streamText
            ? h('div', { className: 'nw-muted' }, '正在读取对象上下文…')
            : (discussion.messages ?? []).map((message, index) => {
                const result = message.result ?? {}
                const hasResult =
                  result.question ||
                  (result.options ?? []).length ||
                  result.conclusion ||
                  (result.suggestions ?? []).length ||
                  (result.todos ?? []).length ||
                  (result.risks ?? []).length
                return h('div', { key: index, className: `nw-msg ${message.role === 'assistant' ? 'assistant' : 'user'}` },
                  h('div', { className: 'nw-msg-role' }, message.role === 'assistant' ? '助手' : '你'),
                  h('div', { className: 'nw-msg-text' }, message.text),
                  message.role === 'assistant' && (result.question || (result.options ?? []).length)
                    ? h('div', { className: 'nw-result-actions' },
                        result.question ? h('div', { className: 'nw-result-conclusion' }, result.question) : null,
                        (result.options ?? []).length
                          ? h('div', { className: 'nw-actions' },
                              (result.options ?? []).map((option, optionIndex) =>
                                h('button', {
                                  key: optionIndex,
                                  type: 'button',
                                  className: 'nw-btn',
                                  disabled: discussion.loading,
                                  onClick: () => onSend?.(option),
                                }, option),
                              ),
                            )
                          : null,
                        result.allowCustom !== false
                          ? h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '也可以直接在下方输入你自己的答案。')
                          : null,
                      )
                    : null,
                  hasResult
                    ? h('div', { className: 'nw-result' },
                        result.conclusion ? h('div', { className: 'nw-result-conclusion' }, result.conclusion) : null,
                        renderList('建议', result.suggestions),
                        renderList('待办', result.todos),
                        renderList('风险', result.risks),
                      )
                    : null,
                  (result.actions ?? []).length
                    ? h('div', { className: 'nw-result-actions' },
                        h('div', { className: 'nw-result-label' }, '可直接应用'),
                        result.actions.map((action, actionIndex) =>
                          h('div', { key: actionIndex, className: 'nw-result-item' }, `· ${actionSummary(action)}`),
                        ),
                        h('button', {
                          type: 'button',
                          className: 'nw-btn primary',
                          onClick: () => {
                            const all = result.actions.map((_, actionIndex) => actionIndex)
                            if (discussion.autoConfirm) {
                              onApplyActions?.(message, all, true)
                              return
                            }
                            setPendingSelected(all)
                            setAutoConfirmNext(false)
                            setPendingMessage(message)
                          },
                        }, `应用这些修改（${result.actions.length}）`),
                      )
                    : null,
                  message.role === 'assistant'
                    ? h('div', { className: 'nw-msg-actions' },
                        h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => onCopy?.(message.text) }, '复制'),
                        canApplyInstruction
                          ? h('button', { type: 'button', className: 'nw-btn', onClick: () => onApplyInstruction?.(message) }, '用作修订要求')
                          : null,
                        hasResult
                          ? h('button', { type: 'button', className: 'nw-btn', onClick: () => onSaveNote?.(message) }, '仅存备注')
                          : null,
                      )
                    : null,
                )
              }),
          (discussion.loading || discussion.stopped) && discussion.streamText
            ? h('div', { className: 'nw-msg assistant' },
                h('div', { className: 'nw-msg-role' }, discussion.loading ? '助手 · 生成中' : '助手 · 已停止'),
                h('div', { className: 'nw-msg-text' }, discussion.streamText),
                discussion.loading
                  ? h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, h('span', { className: 'nw-spinner' }), ' 正在结合章纲与设定…')
                  : null,
              )
            : null,
          discussion.error ? h('div', { className: 'nw-banner warn' }, discussion.error) : null,
          !discussion.loading && lastUser && (discussion.stopped || discussion.error)
            ? h('div', { className: 'nw-actions', style: { justifyContent: 'flex-end' } },
                h('button', { type: 'button', className: 'nw-btn', onClick: () => onSend(lastUser) }, '重试上一条'),
              )
            : null,
        ),
        h('div', { className: 'nw-discuss-input' },
          h('input', {
            className: 'nw-input',
            value: text,
            placeholder: '说说你想讨论/修改什么…',
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && text.trim() && !discussion.loading) {
                event.preventDefault()
                onSend(text)
                setText('')
              }
            },
          }),
          discussion.loading
            ? h('button', { type: 'button', className: 'nw-btn danger', onClick: onStop }, '停止')
            : h('button', { type: 'button', className: 'nw-btn primary', disabled: !text.trim(), onClick: () => { onSend(text); setText('') } }, '发送'),
        ),
        pendingMessage
          ? h('div', { className: 'nw-modal-backdrop' },
              h('div', { className: 'nw-modal', style: { maxWidth: '560px' } },
                h('h3', { className: 'nw-h3' }, '应用讨论修改'),
                h('p', { className: 'nw-muted' }, canApplyInstruction
                  ? '确认后会先写入修改字段；如果包含章节修订建议，会直接按建议重写本章正文。没有草稿时只写入修订要求。'
                  : '确认后直接写入对应字段，刷新后会看到修改结果。'),
                (pendingMessage.result?.actions ?? []).map((action, index) =>
                  h('div', { key: index, style: { marginTop: '8px' } },
                    h('label', { className: 'nw-row', style: { gap: '8px', alignItems: 'flex-start', cursor: 'pointer' } },
                      h('input', {
                        type: 'checkbox',
                        checked: pendingSelected.includes(index),
                        onChange: (event) => setPendingSelected((prev) => (
                          event.target.checked ? [...new Set([...prev, index])] : prev.filter((item) => item !== index)
                        )),
                      }),
                      h('div', null,
                        h('div', { className: 'nw-label' }, actionSummary(action)),
                        action.type === 'chapter-instruction'
                          ? h('div', { className: 'nw-p' }, action.instruction)
                          : Object.entries(action.fields ?? {}).map(([key, value]) =>
                              h('div', { key, className: 'nw-kv' },
                                h('span', { className: 'nw-muted' }, key),
                                h('span', null, `${formatFieldValue(currentFieldValue(action, key))} → ${formatFieldValue(value)}`),
                              ),
                            ),
                      ),
                    ),
                  ),
                ),
                h('label', { className: 'nw-row', style: { gap: '8px', marginTop: '10px', cursor: 'pointer' } },
                  h('input', { type: 'checkbox', checked: autoConfirmNext, onChange: (event) => setAutoConfirmNext(event.target.checked) }),
                  h('span', { className: 'nw-muted' }, '本线程不再询问，后续同类修改直接执行'),
                ),
                h('div', { className: 'nw-actions', style: { justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'nw-btn', onClick: () => setPendingMessage(null) }, '取消'),
                  h('button', {
                    type: 'button',
                    className: 'nw-btn primary',
                    disabled: pendingSelected.length === 0,
                    onClick: () => {
                      onApplyActions?.(pendingMessage, pendingSelected, autoConfirmNext)
                      setPendingMessage(null)
                    },
                  }, canApplyInstruction ? '确认并重写正文' : '确认执行'),
                ),
              ),
            )
          : null,
      )
    }

    function PowerPanel({ state, power, run, busy }) {
      const [system, setSystem] = useState(power?.system ?? { name: '武道境界', summary: '', tiers: [] })
      const [characters, setCharacters] = useState(power?.characters ?? [])
      const [changes, setChanges] = useState(power?.chapterChanges ?? {})
      const [chapterNo, setChapterNo] = useState(state?.chapters?.[0]?.number ?? 1)
      useEffect(() => {
        setSystem(power?.system ?? { name: '武道境界', summary: '', tiers: [] })
        setCharacters(power?.characters ?? [])
        setChanges(power?.chapterChanges ?? {})
      }, [power?.updatedAt])
      const tiers = system.tiers ?? []
      const updateTier = (index, key, value) => {
        const next = tiers.map((tier, itemIndex) => itemIndex === index ? { ...tier, [key]: value } : tier)
        setSystem((prev) => ({ ...prev, tiers: next }))
      }
      const addTier = () => setSystem((prev) => ({
        ...prev,
        tiers: [...(prev.tiers ?? []), { id: `tier-${Date.now()}`, name: '新层级', order: (prev.tiers ?? []).length, description: '' }],
      }))
      const removeTier = (index) => setSystem((prev) => ({ ...prev, tiers: (prev.tiers ?? []).filter((_, itemIndex) => itemIndex !== index) }))
      const updateCharacter = (index, key, value) => {
        const next = characters.map((character, itemIndex) => itemIndex === index ? { ...character, [key]: value } : character)
        setCharacters(next)
      }
      const addCharacter = () => setCharacters((prev) => [...prev, {
        id: `P#${String(prev.length + 1).padStart(2, '0')}`,
        name: '新角色',
        tierId: tiers[0]?.id ?? '',
        tierName: tiers[0]?.name ?? '',
        stage: '',
        abilities: [],
        notes: '',
      }])
      const removeCharacter = (index) => setCharacters((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
      const selectedChanges = changes[String(chapterNo)] ?? []
      const save = () => run('power-save', {
        power: {
          system,
          characters: characters.map((character) => {
            const tierName = tiers.find((tier) => tier.id === character.tierId)?.name ?? character.tierName ?? ''
            return {
              ...character,
              tierName,
              current: `${tierName}${character.stage ?? ''}`.trim(),
            }
          }),
          chapterChanges: changes,
        },
      }, { toast: '能力体系已保存' })
      return h('div', { className: 'nw-card' },
        h('div', { className: 'nw-row' },
          h('div', null,
            h('div', { className: 'nw-eyebrow' }, '能力体系'),
            h('h3', { className: 'nw-h3' }, system.name || '武道境界'),
          ),
          h('span', { className: `nw-badge ${power?.status === 'confirmed' ? 'ok' : ''}` }, power?.status === 'confirmed' ? '已确认' : '待确认'),
        ),
        h('p', { className: 'nw-muted' }, '这一页是战斗力的基准：层级定义、角色当前层级，以及每一章发生的能力变化。写正文和审校都会读取它；不要让角色无铺垫跨级。'),
        h('div', { className: 'nw-grid-2' },
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '体系名称'),
            h('input', { className: 'nw-input', value: system.name ?? '', disabled: busy, onChange: (event) => setSystem((prev) => ({ ...prev, name: event.target.value })) }),
          ),
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '一句话规则'),
            h('input', { className: 'nw-input', value: system.summary ?? '', disabled: busy, placeholder: '例如：一流才可真气外放', onChange: (event) => setSystem((prev) => ({ ...prev, summary: event.target.value })) }),
          ),
        ),
        h('div', { className: 'nw-eyebrow', style: { marginTop: '8px' } }, '层级'),
        h('div', { className: 'nw-cards' },
          tiers.map((tier, index) => h('div', { key: tier.id ?? index, className: 'nw-card', style: { background: 'var(--dsw-alias-bg-layer-1)' } },
            h('div', { className: 'nw-row' },
              h('span', { className: 'nw-muted' }, `第 ${index + 1} 层`),
              h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: () => removeTier(index) }, '删除'),
            ),
            h('div', { className: 'nw-grid-2' },
              h('input', { className: 'nw-input', value: tier.name ?? '', disabled: busy, placeholder: '层级名', onChange: (event) => updateTier(index, 'name', event.target.value) }),
              h('input', { className: 'nw-input', value: tier.description ?? '', disabled: busy, placeholder: '能做什么 / 不能做什么', onChange: (event) => updateTier(index, 'description', event.target.value) }),
            ),
          )),
        ),
        h('div', { className: 'nw-actions' }, h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: addTier }, '+ 层级')),
        h('div', { className: 'nw-eyebrow', style: { marginTop: '10px' } }, '角色当前能力'),
        h('div', { className: 'nw-cards' },
          characters.map((character, index) => h('div', { key: character.id ?? index, className: 'nw-card', style: { background: 'var(--dsw-alias-bg-layer-1)' } },
            h('div', { className: 'nw-row' },
              h('input', { className: 'nw-input', style: { flex: '1 1 140px' }, value: character.name ?? '', disabled: busy, placeholder: '角色名', onChange: (event) => updateCharacter(index, 'name', event.target.value) }),
              h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: () => removeCharacter(index) }, '删除'),
            ),
            h('div', { className: 'nw-grid-2' },
              h('select', { className: 'nw-input', value: character.tierId ?? '', disabled: busy, onChange: (event) => updateCharacter(index, 'tierId', event.target.value) },
                tiers.map((tier) => h('option', { key: tier.id, value: tier.id }, tier.name)),
              ),
              h('input', { className: 'nw-input', value: character.stage ?? '', disabled: busy, placeholder: '细分：初成 / 中段 / 巅峰', onChange: (event) => updateCharacter(index, 'stage', event.target.value) }),
            ),
            h('input', { className: 'nw-input', value: (character.abilities ?? []).join('、'), disabled: busy, placeholder: '已有能力（用、分隔）', onChange: (event) => updateCharacter(index, 'abilities', event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)) }),
            h('textarea', { className: 'nw-textarea', value: character.notes ?? '', disabled: busy, placeholder: '限制、成长方向', onChange: (event) => updateCharacter(index, 'notes', event.target.value) }),
          )),
        ),
        h('div', { className: 'nw-actions' }, h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: addCharacter }, '+ 角色')),
        h('div', { className: 'nw-eyebrow', style: { marginTop: '12px' } }, '按章能力变化'),
        h('div', { className: 'nw-row' },
          h('select', { className: 'nw-input', style: { maxWidth: '240px' }, value: chapterNo, disabled: busy, onChange: (event) => setChapterNo(Number(event.target.value)) },
            (state?.chapters ?? []).map((chapter) => h('option', { key: chapter.number, value: chapter.number }, `第 ${chapter.number} 章 ${chapter.title || ''}`)),
          ),
          h('span', { className: 'nw-muted' }, '每行一条：角色：旧层级→新层级；原因/影响'),
        ),
        h('textarea', {
          className: 'nw-textarea',
          style: { minHeight: '110px' },
          value: selectedChanges.join('\n'),
          disabled: busy,
          placeholder: '例：陆迟：二流初成→二流巅峰；拳理贯通，非跨级',
          onChange: (event) => setChanges((prev) => ({ ...prev, [String(chapterNo)]: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })),
        }),
        h('div', { className: 'nw-actions' },
          h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: save }, '保存能力体系'),
        ),
      )
    }

    function BibleView({ state, run, busy, openDiscussion, onOpenOutline, setToast }) {
      const bible = state.bible ?? {
        status: 'missing',
        characters: [],
        locations: [],
        rules: [],
        factions: [],
        items: [],
      }
      const categories = [
        ['characters', '角色'],
        ['relations', '关系'],
        ['foreshadow', '伏笔'],
        ['locations', '地点'],
        ['rules', '规则'],
        ['factions', '势力'],
        ['items', '物品'],
        ['power', '能力'],
      ]
      const power = state.power ?? null
      const [category, setCategory] = useState('characters')
      const [instruction, setInstruction] = usePersistedInput(state?.cwd, 'bibleInstruction')
      const [importOpen, setImportOpen] = useState(false)
      const [importText, setImportText] = useState('')
      const [importOverwrite, setImportOverwrite] = useState(false)
      const entries = bible[category] ?? []
      const foreshadowCount = (state.outline?.volumes ?? []).reduce(
        (sum, volume) => sum + (volume.chapters ?? []).reduce(
          (inner, chapter) => inner + (chapter.foreshadow?.plant?.length ?? 0) + (chapter.foreshadow?.payoff?.length ?? 0),
          0,
        ),
        0,
      )
      return h('div', null,
        h(StepIntro, {
          eyebrow: '04 / 设定',
          title: '角色与世界的规则',
          status: bible.status,
          desc: '把角色、地点和世界规则写成可执行的条目；确认后，草稿与修订会带着相关设定生成。',
          hints: ['生成一版设定，或手动添加', '按角色/地点/规则检查并修改', '确认设定，进入大纲'],
        }),
        h('div', { className: 'nw-card' },
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: () => run('bible-generate', { scope: 'all', instruction: instruction || undefined }, { toast: '设定已生成' }) }, busy ? '生成中…' : '生成全部设定'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => run('bible-generate', { scope: 'characters', instruction: instruction || undefined }, { toast: '角色已生成' }) }, '只生成角色'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => run('bible-generate', { scope: 'world', instruction: instruction || undefined }, { toast: '世界设定已生成' }) }, '只生成世界'),
            h('input', { className: 'nw-input', style: { flex: '1 1 240px', minWidth: '200px' }, value: instruction, placeholder: '生成要求（可留空）', disabled: busy, onChange: (event) => setInstruction(event.target.value) }),
            state.project?.writingNotes
              ? h('button', {
                  type: 'button',
                  className: 'nw-btn ghost',
                  onClick: () => setInstruction((prev) => (prev.trim() ? `${prev}\n${state.project.writingNotes}` : state.project.writingNotes)),
                }, '插入项目要求')
              : null,
            instruction.trim()
              ? h('button', {
                  type: 'button',
                  className: 'nw-btn ghost',
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(instruction)
                      setToast?.('生成要求已复制')
                    } catch {
                      setToast?.('复制失败')
                    }
                  },
                }, '复制要求')
              : null,
            h('button', { type: 'button', className: 'nw-btn', disabled: busy || bible.characters.length === 0, onClick: () => run('bible-commit', {}, { next: 'outline', toast: '设定已确认，下一步：大纲' }) }, '确认设定'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => setImportOpen(true) }, '导入角色卡'),
            bible.status === 'confirmed' ? h('span', { className: 'nw-badge ok' }, '已确认') : null,
          ),
          h('div', { className: 'nw-muted', style: { marginTop: '8px' } },
            `角色 ${bible.characters.length} · 地点 ${bible.locations.length} · 规则 ${bible.rules.length} · 势力 ${bible.factions.length} · 物品 ${bible.items.length} · 能力 ${power?.characters?.length ?? 0}`,
          ),
        ),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 12px' } },
          categories.map(([id, label]) =>
            h('button', {
              key: id,
              type: 'button',
              className: `nw-btn${category === id ? ' primary' : ''}`,
              onClick: () => setCategory(id),
            }, `${label}（${id === 'power' ? (power?.characters?.length ?? 0) : id === 'relations' ? (state.relations?.relations?.length ?? 0) : id === 'foreshadow' ? foreshadowCount : (bible[id] ?? []).length}）`),
          ),
          h('button', {
            type: 'button',
            className: 'nw-btn',
            disabled: busy || category === 'power' || category === 'relations',
            onClick: () => run('bible-update', { category, fields: { name: '新条目', description: '' } }, { toast: '已添加条目' }),
          }, '+ 新增条目'),
        ),
        category === 'relations'
          ? h(BibleRelationsGraph, { state, run, busy, setToast })
          : category === 'foreshadow'
            ? h(ForeshadowTimeline, { state, onOpenOutline })
            : category === 'power'
              ? h(PowerPanel, { state, power, run, busy })
              : entries.length === 0
                ? h(EmptyState, { title: '这一类还没有条目', desc: '可以点「生成设定」，或手动新增一条。' })
                : h('div', { className: 'nw-cards' },
                    entries.map((entry) =>
                      h(BibleEntryCard, {
                        key: entry.id,
                        entry,
                        category,
                        run,
                        busy,
                        openDiscussion,
                        setToast,
                      }),
                    ),
                  ),
        importOpen
          ? h('div', { className: 'nw-modal-backdrop', onClick: () => setImportOpen(false) },
              h('div', { className: 'nw-modal', onClick: (event) => event.stopPropagation() },
                h('div', { className: 'nw-eyebrow' }, '导入角色卡'),
                h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '粘贴从其他项目「导出卡片」得到的 JSON；同名角色需要勾选覆盖。'),
                h('textarea', {
                  className: 'nw-textarea',
                  style: { minHeight: '160px', marginTop: '8px' },
                  value: importText,
                  placeholder: '{"name":"...","role":"女主","description":"...","relations":[]}',
                  onChange: (event) => setImportText(event.target.value),
                }),
                h('label', { className: 'nw-muted', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } },
                  h('input', { type: 'checkbox', checked: importOverwrite, onChange: (event) => setImportOverwrite(event.target.checked) }),
                  '覆盖同名角色',
                ),
                h('div', { className: 'nw-actions', style: { justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'nw-btn', onClick: () => setImportOpen(false) }, '取消'),
                  h('button', {
                    type: 'button',
                    className: 'nw-btn primary',
                    disabled: busy || !importText.trim(),
                    onClick: async () => {
                      let card = null
                      try {
                        card = JSON.parse(importText)
                      } catch {
                        setToast('JSON 解析失败，请检查格式')
                        return
                      }
                      const result = await run('character-card-import', { card, overwrite: importOverwrite }, { toast: '角色卡已导入' })
                      if (result) {
                        setImportOpen(false)
                        setImportText('')
                      }
                    },
                  }, '导入'),
                ),
              ),
            )
          : null,
      )
    }

    const RELATION_TYPES = ['师徒', '同门', '兄妹', '父女', '母子', '主仆', '夫妻', '情人', '敌对', '盟友', '债主', '上下级', '旧识']

    const REL_EXPORT_CSS = '.nw-rel-dot{stroke:#999;stroke-width:1.5}.nw-rel-dot.lead{fill:#b8860b;stroke:#b8860b}.nw-rel-dot.heroine{fill:#c9748f;stroke:#c9748f}.nw-rel-dot.rival{fill:#c0392b;stroke:#c0392b}.nw-rel-edge{stroke:#bbb;stroke-width:1.4}.nw-rel-edge.rival{stroke:#c0392b;stroke-dasharray:4 3}.nw-rel-edge.love{stroke:#c9748f;stroke-dasharray:2 3}.nw-rel-edge-label{fill:#777;font-size:10px;text-anchor:middle}.nw-rel-name{fill:#333;font-size:11px;text-anchor:middle;pointer-events:none}'
    const GRAPH_EXPORT_CSS = '.nw-graph-link{stroke:#bbb;stroke-width:1.2}.nw-graph-foreshadow{fill:none;stroke:#b8860b;stroke-dasharray:4 3;stroke-width:1.2}.nw-graph-rect{fill:#f5f1e8;stroke:#bbb;stroke-width:1.2}.nw-graph-rect.ok{stroke:#5f7f52}.nw-graph-no{fill:#777;font-size:9px}.nw-graph-title{fill:#333;font-size:11px;font-weight:600}.nw-graph-goal{fill:#888;font-size:9px}'

    function exportSvgMarkup(svg, css) {
      if (!svg) return ''
      const clone = svg.cloneNode(true)
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      style.textContent = css
      clone.insertBefore(style, clone.firstChild)
      return clone.outerHTML
    }

    function BibleRelationsGraph({ state, run, busy, setToast }) {
      const bible = state.bible ?? { characters: [] }
      const relations = state.relations?.relations ?? []
      const characters = (bible.characters ?? []).filter((item) => item.name)
      const [selectedName, setSelectedName] = useState(characters[0]?.name ?? null)
      const [form, setForm] = useState({
        from: characters[0]?.name ?? '',
        to: characters[1]?.name ?? '',
        type: '旧识',
        note: '',
      })
      const volumes = state.outline?.volumes ?? []
      const chapterNumbers = (name) => {
        const hits = []
        for (const volume of volumes) {
          for (const chapter of volume.chapters ?? []) {
            if ((chapter.cast ?? []).includes(name)) hits.push(chapter.number)
          }
        }
        return hits
      }
      const roleClass = (role) => (role === '主角' ? 'lead' : role === '女主' ? 'heroine' : role === '对手' ? 'rival' : 'side')
      const width = 760
      const height = 520
      const cx = width / 2
      const cy = height / 2
      const lead = characters.find((character) => character.role === '主角') ?? characters[0]
      const others = characters.filter((character) => character.name !== lead?.name)
      const positions = new Map()
      if (lead) positions.set(lead.name, { x: cx, y: cy })
      others.forEach((character, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, others.length) - Math.PI / 2
        const radius = 190
        positions.set(character.name, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius })
      })
      const selected = characters.find((character) => character.name === selectedName) ?? null
      const selectedRelations = relations.filter((relation) => relation.from === selectedName || relation.to === selectedName)
      const [localPositions, setLocalPositions] = useState(() => ({ ...(state.relations?.positions ?? {}) }))
      const [draggingName, setDraggingName] = useState(null)
      const positionsRef = useRef(localPositions)
      const dragRef = useRef(null)
      const svgRef = useRef(null)
      useEffect(() => {
        setLocalPositions({ ...(state.relations?.positions ?? {}) })
      }, [state.relations?.updatedAt])
      useEffect(() => {
        positionsRef.current = localPositions
      }, [localPositions])
      const nodePos = (name) => localPositions[name] ?? positions.get(name)
      const save = (next) => run('relations-save', { relations: next, positions: localPositions }, { toast: '关系已保存' })
      const onPointerDown = (event, name) => {
        const svg = svgRef.current
        const origin = nodePos(name)
        if (!svg || !origin) return
        event.stopPropagation()
        setDraggingName(name)
        dragRef.current = {
          name,
          startX: event.clientX,
          startY: event.clientY,
          origX: origin.x,
          origY: origin.y,
          rect: svg.getBoundingClientRect(),
        }
        try {
          svg.setPointerCapture(event.pointerId)
        } catch {
          // pointer capture may fail in some environments
        }
      }
      const onPointerMove = (event) => {
        const drag = dragRef.current
        if (!drag) return
        const scaleX = width / drag.rect.width
        const scaleY = height / drag.rect.height
        const x = Math.max(24, Math.min(width - 24, drag.origX + (event.clientX - drag.startX) * scaleX))
        const y = Math.max(24, Math.min(height - 24, drag.origY + (event.clientY - drag.startY) * scaleY))
        setLocalPositions((prev) => ({ ...prev, [drag.name]: { x, y } }))
      }
      const onPointerUp = () => {
        if (!dragRef.current) return
        dragRef.current = null
        setDraggingName(null)
        run('relations-save', { relations, positions: positionsRef.current }, { toast: '布局已保存' })
      }
      const resetLayout = () => {
        setLocalPositions({})
        positionsRef.current = {}
        run('relations-save', { relations, positions: {} }, { toast: '已恢复自动布局' })
      }
      const downloadSvg = () => {
        const svg = svgRef.current
        if (!svg) return
        try {
          const blob = new Blob([exportSvgMarkup(svg, REL_EXPORT_CSS)], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = '人物关系.svg'
          anchor.click()
          URL.revokeObjectURL(url)
          setToast?.('已导出 SVG')
        } catch {
          setToast?.('导出失败')
        }
      }
      const [watermark, setWatermark] = useState(() => {
        try {
          return localStorage.getItem('dsh.novelWriter.watermark') !== 'off'
        } catch {
          return true
        }
      })
      const toggleWatermark = () => {
        const next = !watermark
        setWatermark(next)
        try {
          localStorage.setItem('dsh.novelWriter.watermark', next ? 'on' : 'off')
        } catch {
          // ignore storage failures
        }
      }
      const downloadPng = async (transparent = false) => {
        const svg = svgRef.current
        if (!svg) return
        try {
          const markup = exportSvgMarkup(svg, REL_EXPORT_CSS)
          const svgBlob = new Blob([markup], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(svgBlob)
          const image = new Image()
          await new Promise((resolve, reject) => {
            image.onload = resolve
            image.onerror = reject
            image.src = url
          })
          const scale = 2
          const canvas = document.createElement('canvas')
          canvas.width = width * scale
          canvas.height = height * scale
          const context = canvas.getContext('2d')
          if (!transparent) {
            context.fillStyle = '#ffffff'
            context.fillRect(0, 0, canvas.width, canvas.height)
          }
          context.drawImage(image, 0, 0, width, height, 0, 0, canvas.width, canvas.height)
          if (watermark) {
            context.fillStyle = '#666666'
            context.font = `${14 * scale}px sans-serif`
            context.textAlign = 'right'
            context.fillText(
              `${state?.project?.title ?? ''} · ${new Date().toLocaleDateString('sv-SE')}`,
              canvas.width - 12 * scale,
              canvas.height - 10 * scale,
            )
          }
          URL.revokeObjectURL(url)
          canvas.toBlob((png) => {
            if (!png) return
            const link = document.createElement('a')
            link.href = URL.createObjectURL(png)
            link.download = '人物关系.png'
            link.click()
          }, 'image/png')
          setToast?.('已导出 PNG')
        } catch {
          setToast?.('导出失败（浏览器不支持图片导出）')
        }
      }
      const addRelation = () => {
        if (!form.from || !form.to || !form.type || form.from === form.to) return
        save([...relations, { ...form }])
      }
      const removeRelation = (target) =>
        save(relations.filter((relation) => !(relation.from === target.from && relation.to === target.to && relation.type === target.type)))
      return h('div', null,
        h('div', { className: 'nw-card' },
          h('div', { className: 'nw-row' },
            h('h3', { className: 'nw-h3' }, '人物关系'),
            h('span', { className: 'nw-muted' }, `${characters.length} 人 · ${relations.length} 条关系`),
            h('button', { type: 'button', className: 'nw-btn ghost', style: { marginLeft: 'auto' }, disabled: busy, onClick: resetLayout }, '重置布局'),
            h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: downloadSvg }, '导出 SVG'),
            h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: downloadPng }, '导出 PNG'),
            h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: () => downloadPng(true) }, '导出 PNG（透明）'),
            h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: toggleWatermark }, watermark ? '水印：开' : '水印：关'),
          ),
          h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '拖动节点调整布局，点节点查看角色卡；布局会保存。'),
          h('div', { className: 'nw-rel-graph' },
            h('svg', {
              ref: svgRef,
              viewBox: `0 0 ${width} ${height}`,
              className: 'nw-rel-svg',
              onPointerMove,
              onPointerUp,
              onPointerLeave: onPointerUp,
            },
              relations.map((relation, index) => {
                const a = nodePos(relation.from)
                const b = nodePos(relation.to)
                if (!a || !b) return null
                return h('g', { key: `edge-${index}` },
                  h('line', {
                    x1: a.x,
                    y1: a.y,
                    x2: b.x,
                    y2: b.y,
                    className: `nw-rel-edge ${relation.type === '敌对' ? 'rival' : relation.type === '情人' ? 'love' : ''}`,
                  }),
                  h('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 4, className: 'nw-rel-edge-label' }, relation.type),
                )
              }),
              characters.map((character) => {
                const p = nodePos(character.name)
                if (!p) return null
                return h('g', {
                  key: `node-${character.name}`,
                  className: `nw-rel-node${draggingName === character.name ? ' dragging' : ''}`,
                  onPointerDown: (event) => onPointerDown(event, character.name),
                  onClick: () => setSelectedName(character.name),
                },
                  h('title', null, `${character.name}${character.role ? `（${character.role}）` : ''}`),
                  h('circle', {
                    cx: p.x,
                    cy: p.y,
                    r: selectedName === character.name ? 22 : 18,
                    className: `nw-rel-dot ${roleClass(character.role)}`,
                  }),
                  h('text', { x: p.x, y: p.y + 34, className: 'nw-rel-name' }, character.name),
                )
              }),
            ),
          ),
        ),
        h('div', { className: 'nw-card', style: { marginTop: '10px' } },
          h('div', { className: 'nw-row' },
            h('h3', { className: 'nw-h3' }, selected ? `角色：${selected.name}` : '角色'),
            selected ? h('span', { className: 'nw-badge' }, selected.role ?? '') : null,
          ),
          selected
            ? h('div', null,
                h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, selected.description ?? ''),
                h('div', { className: 'nw-muted', style: { marginTop: '4px' } },
                  `出场章节：${chapterNumbers(selected.name).join('、') || '暂无'}`),
                h('div', { className: 'nw-result-label', style: { marginTop: '8px' } }, '关系'),
                selectedRelations.length
                  ? selectedRelations.map((relation, index) =>
                      h('div', { key: `rel-${index}`, className: 'nw-result-item' },
                        `· ${relation.from} → ${relation.to}（${relation.type}）${relation.note ? `：${relation.note}` : ''}`,
                        h('button', {
                          type: 'button',
                          className: 'nw-btn ghost',
                          style: { marginLeft: '6px' },
                          disabled: busy,
                          onClick: () => removeRelation(relation),
                        }, '删除'),
                      ),
                    )
                  : h('div', { className: 'nw-muted' }, '还没有关系。'),
              )
            : h('div', { className: 'nw-muted' }, '先在「角色」里添加人物。'),
          h('div', { className: 'nw-actions', style: { marginTop: '8px' } },
            h('select', {
              className: 'nw-input',
              value: form.from,
              onChange: (event) => setForm({ ...form, from: event.target.value }),
            }, characters.map((character) => h('option', { key: character.name, value: character.name }, character.name))),
            h('span', { className: 'nw-muted' }, '—'),
            h('select', {
              className: 'nw-input',
              value: form.type,
              onChange: (event) => setForm({ ...form, type: event.target.value }),
            }, RELATION_TYPES.map((type) => h('option', { key: type, value: type }, type))),
            h('span', { className: 'nw-muted' }, '→'),
            h('select', {
              className: 'nw-input',
              value: form.to,
              onChange: (event) => setForm({ ...form, to: event.target.value }),
            }, characters.map((character) => h('option', { key: character.name, value: character.name }, character.name))),
            h('input', {
              className: 'nw-input',
              style: { flex: '1 1 160px' },
              placeholder: '备注（可留空）',
              value: form.note,
              onChange: (event) => setForm({ ...form, note: event.target.value }),
            }),
            h('button', {
              type: 'button',
              className: 'nw-btn primary',
              disabled: busy || !form.from || !form.to || form.from === form.to,
              onClick: addRelation,
            }, '添加关系'),
          ),
          h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
            '关系保存在 story/bible/relations.json；点击节点查看角色卡与出场章节。'),
        ),
      )
    }

    function ForeshadowTimeline({ state, onOpenOutline }) {
      const chapters = (state.outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
      const entries = []
      for (const chapter of chapters) {
        for (const text of chapter.foreshadow?.plant ?? []) {
          entries.push({ kind: 'plant', chapter: Number(chapter.number), text: String(text) })
        }
        for (const text of chapter.foreshadow?.payoff ?? []) {
          entries.push({ kind: 'payoff', chapter: Number(chapter.number), text: String(text) })
        }
      }
      const plants = entries.filter((entry) => entry.kind === 'plant').sort((a, b) => a.chapter - b.chapter)
      const payoffs = entries.filter((entry) => entry.kind === 'payoff').sort((a, b) => a.chapter - b.chapter)
      const paid = new Map()
      for (const payoff of payoffs) {
        for (const plant of plants) {
          if (plant.chapter >= payoff.chapter) continue
          const key = `${plant.chapter}|${plant.text}`
          if (paid.has(key)) continue
          const probe = plant.text.slice(0, Math.min(10, plant.text.length))
          if (probe && payoff.text.includes(probe)) paid.set(key, payoff.chapter)
        }
      }
      const pending = plants.filter((plant) => !paid.has(`${plant.chapter}|${plant.text}`))
      return h('div', null,
        h('div', { className: 'nw-card' },
          h('div', { className: 'nw-row' },
            h('h3', { className: 'nw-h3' }, '伏笔时间线'),
            h('span', { className: `nw-badge ${pending.length ? 'cur' : 'ok'}` }, pending.length ? `未回收 ${pending.length}` : '全部回收'),
          ),
          h('div', { className: 'nw-muted', style: { marginTop: '4px' } },
            `共 ${plants.length} 条伏笔 · ${payoffs.length} 条回收；按章号排列，点章号跳到大纲。`),
          plants.length === 0
            ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '章纲里还没有伏笔。')
            : h('div', { style: { marginTop: '6px' } },
                plants.map((plant, index) => {
                  const paidAt = paid.get(`${plant.chapter}|${plant.text}`)
                  return h('div', { key: `plant-${index}`, className: 'nw-issue' },
                    h('span', { className: `nw-issue-dot ${paidAt ? 'pass' : 'warn'}` }),
                    h('button', { type: 'button', className: 'nw-issue-jump', onClick: () => onOpenOutline?.(plant.chapter) }, `第 ${plant.chapter} 章`),
                    h('span', { style: { flex: 1 } }, plant.text),
                    h('span', { className: 'nw-muted' }, paidAt ? `第 ${paidAt} 章回收` : '未回收'),
                  )
                }),
              ),
        ),
        payoffs.length
          ? h('div', { className: 'nw-card', style: { marginTop: '10px' } },
              h('h3', { className: 'nw-h3' }, '回收记录'),
              payoffs.map((payoff, index) =>
                h('div', { key: `payoff-${index}`, className: 'nw-issue' },
                  h('span', { className: 'nw-issue-dot pass' }),
                  h('button', { type: 'button', className: 'nw-issue-jump', onClick: () => onOpenOutline?.(payoff.chapter) }, `第 ${payoff.chapter} 章`),
                  h('span', { style: { flex: 1 } }, payoff.text),
                ),
              ),
            )
          : null,
      )
    }

    function BibleEntryCard({ entry, category, run, busy, openDiscussion, setToast }) {
      const [fields, setFields] = useState({
        name: entry.name ?? '',
        role: entry.role ?? '',
        description: entry.description ?? '',
        traits: Array.isArray(entry.traits) ? entry.traits.join('、') : '',
        goal: entry.goal ?? '',
      })
      useEffect(() => {
        setFields({
          name: entry.name ?? '',
          role: entry.role ?? '',
          description: entry.description ?? '',
          traits: Array.isArray(entry.traits) ? entry.traits.join('、') : '',
          goal: entry.goal ?? '',
        })
      }, [entry.id, entry.name, entry.role, entry.description, entry.traits?.join('、'), entry.goal])
      const dirty =
        fields.name !== (entry.name ?? '') ||
        fields.role !== (entry.role ?? '') ||
        fields.description !== (entry.description ?? '') ||
        fields.traits !== (Array.isArray(entry.traits) ? entry.traits.join('、') : '') ||
        fields.goal !== (entry.goal ?? '')
      const update = (key, value) => setFields((prev) => ({ ...prev, [key]: value }))
      const save = () => {
        const traits = fields.traits.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
        run('bible-update', {
          category,
          id: entry.id,
          fields: {
            name: fields.name,
            role: fields.role,
            description: fields.description,
            ...(category === 'characters' ? { traits, goal: fields.goal } : {}),
          },
        }, { toast: '设定已保存' })
      }
      return h('div', { className: 'nw-card' },
        h('div', { className: 'nw-row' },
          h('div', { className: 'nw-eyebrow' }, entry.id ?? '新条目'),
          h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => openDiscussion?.(`bible-${entry.id}`, `${fields.name || entry.id} 设定讨论`, { category, ...entry }) }, '讨论'),
        ),
        h('div', { className: 'nw-field' },
          h('label', { className: 'nw-label' }, '名称'),
          h('input', { className: 'nw-input', value: fields.name, disabled: busy, onChange: (event) => update('name', event.target.value) }),
        ),
        category === 'characters'
          ? h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '定位 / 身份'),
              h('input', { className: 'nw-input', value: fields.role, disabled: busy, placeholder: '主角 / 对手 / 配角', onChange: (event) => update('role', event.target.value) }),
            )
          : null,
        category === 'characters'
          ? h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '性格标签（顿号分隔）'),
              h('input', { className: 'nw-input', value: fields.traits, disabled: busy, placeholder: '懒散、嘴甜、心软手狠', onChange: (event) => update('traits', event.target.value) }),
            )
          : null,
        category === 'characters'
          ? h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '目标'),
              h('input', { className: 'nw-input', value: fields.goal, disabled: busy, placeholder: '他想要什么', onChange: (event) => update('goal', event.target.value) }),
            )
          : null,
        h('div', { className: 'nw-field' },
          h('label', { className: 'nw-label' }, '描述 / 约束'),
          h('textarea', { className: 'nw-textarea', value: fields.description, disabled: busy, onChange: (event) => update('description', event.target.value) }),
        ),
        h('div', { className: 'nw-actions' },
          h('button', {
            type: 'button',
            className: 'nw-btn primary',
            disabled: busy || !dirty,
            onClick: save,
          }, '保存'),
          category === 'characters'
            ? h('button', {
                type: 'button',
                className: 'nw-btn',
                disabled: busy,
                onClick: async () => {
                  const result = await run('character-card-export', { name: fields.name || entry.name }, { silent: true })
                  if (!result?.json) return
                  try {
                    await navigator.clipboard.writeText(result.json)
                    setToast?.('角色卡已复制到剪贴板')
                  } catch {
                    setToast?.('复制失败，请手动选择文本')
                  }
                },
              }, '导出卡片')
            : null,
          h('button', {
            type: 'button',
            className: 'nw-btn danger',
            disabled: busy,
            onClick: async () => {
              if (!(await requestConfirm({ title: '删除设定', message: `删除「${entry.name || entry.id}」？`, danger: true }))) return
              run('bible-delete', { category, id: entry.id }, { toast: '条目已删除' })
            },
          }, '删除'),
        ),
      )
    }

    function ChapterGraph({ chapters, onChoose, setToast }) {
      const columns = 6
      const cellW = 120
      const cellH = 84
      const pad = 16
      const rows = Math.ceil(chapters.length / columns)
      const width = pad * 2 + columns * cellW
      const height = pad * 2 + rows * cellH
      const nodeW = 104
      const nodeH = 56
      const svgRef = useRef(null)
      const downloadSvg = () => {
        const svg = svgRef.current
        if (!svg) return
        try {
          const blob = new Blob([exportSvgMarkup(svg, GRAPH_EXPORT_CSS)], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = '章节图谱.svg'
          anchor.click()
          URL.revokeObjectURL(url)
          setToast?.('已导出 SVG')
        } catch {
          setToast?.('导出失败')
        }
      }
      const [watermark, setWatermark] = useState(() => {
        try {
          return localStorage.getItem('dsh.novelWriter.watermark') !== 'off'
        } catch {
          return true
        }
      })
      const toggleWatermark = () => {
        const next = !watermark
        setWatermark(next)
        try {
          localStorage.setItem('dsh.novelWriter.watermark', next ? 'on' : 'off')
        } catch {
          // ignore storage failures
        }
      }
      const downloadPng = async (transparent = false) => {
        const svg = svgRef.current
        if (!svg) return
        try {
          const markup = exportSvgMarkup(svg, GRAPH_EXPORT_CSS)
          const svgBlob = new Blob([markup], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(svgBlob)
          const image = new Image()
          await new Promise((resolve, reject) => {
            image.onload = resolve
            image.onerror = reject
            image.src = url
          })
          const scale = 2
          const canvas = document.createElement('canvas')
          canvas.width = width * scale
          canvas.height = height * scale
          const context = canvas.getContext('2d')
          if (!transparent) {
            context.fillStyle = '#ffffff'
            context.fillRect(0, 0, canvas.width, canvas.height)
          }
          context.drawImage(image, 0, 0, width, height, 0, 0, canvas.width, canvas.height)
          if (watermark) {
            context.fillStyle = '#666666'
            context.font = `${14 * scale}px sans-serif`
            context.textAlign = 'right'
            context.fillText(
              `${state?.project?.title ?? ''} · ${new Date().toLocaleDateString('sv-SE')}`,
              canvas.width - 12 * scale,
              canvas.height - 10 * scale,
            )
          }
          URL.revokeObjectURL(url)
          canvas.toBlob((png) => {
            if (!png) return
            const link = document.createElement('a')
            link.href = URL.createObjectURL(png)
            link.download = '章节图谱.png'
            link.click()
          }, 'image/png')
          setToast?.('已导出 PNG')
        } catch {
          setToast?.('导出失败（浏览器不支持图片导出）')
        }
      }
      const pos = (index) => ({
        x: pad + (index % columns) * cellW,
        y: pad + Math.floor(index / columns) * cellH,
      })
      const plantIndex = new Map()
      chapters.forEach((chapter, index) => {
        for (const text of chapter.foreshadow?.plant ?? []) plantIndex.set(`${chapter.number}|${text}`, index)
      })
      const foreshadowEdges = []
      chapters.forEach((chapter, index) => {
        for (const text of chapter.foreshadow?.payoff ?? []) {
          for (const [key, plantIdx] of plantIndex) {
            const [plantNumber, plantText] = key.split('|')
            if (Number(plantNumber) >= Number(chapter.number)) continue
            const probe = plantText.slice(0, Math.min(10, plantText.length))
            if (!probe || !text.includes(probe)) continue
            foreshadowEdges.push({ from: plantIdx, to: index })
            break
          }
        }
      })
      return h('div', { className: 'nw-graph-wrap' },
        h('div', { className: 'nw-actions', style: { marginBottom: '6px' } },
          h('button', { type: 'button', className: 'nw-btn ghost', onClick: downloadSvg }, '导出 SVG'),
          h('button', { type: 'button', className: 'nw-btn ghost', onClick: downloadPng }, '导出 PNG'),
          h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => downloadPng(true) }, '导出 PNG（透明）'),
          h('button', { type: 'button', className: 'nw-btn ghost', onClick: toggleWatermark }, watermark ? '水印：开' : '水印：关'),
        ),
        h('svg', { ref: svgRef, viewBox: `0 0 ${width} ${height}`, className: 'nw-graph-svg' },
          chapters.slice(1).map((chapter, index) => {
            const a = pos(index)
            const b = pos(index + 1)
            return h('line', {
              key: `link-${index}`,
              x1: a.x + nodeW,
              y1: a.y + nodeH / 2,
              x2: b.x,
              y2: b.y + nodeH / 2,
              className: 'nw-graph-link',
            })
          }),
          foreshadowEdges.map((edge, index) => {
            const a = pos(edge.from)
            const b = pos(edge.to)
            const x1 = a.x + nodeW / 2
            const y1 = a.y
            const x2 = b.x + nodeW / 2
            const y2 = b.y
            const midY = Math.min(y1, y2) - 24
            return h('path', {
              key: `fs-${index}`,
              d: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${midY} ${x2} ${y2}`,
              className: 'nw-graph-foreshadow',
            })
          }),
          chapters.map((chapter, index) => {
            const p = pos(index)
            return h('g', { key: chapter.id, className: 'nw-graph-node', onClick: () => onChoose?.(chapter.number) },
              h('title', null, `${chapter.number} ${chapter.title ?? ''}`),
              h('rect', {
                x: p.x,
                y: p.y,
                width: nodeW,
                height: nodeH,
                rx: 10,
                className: chapter.status === 'confirmed' ? 'nw-graph-rect ok' : 'nw-graph-rect',
              }),
              h('text', { x: p.x + 8, y: p.y + 18, className: 'nw-graph-no' }, `第 ${chapter.number} 章`),
              h('text', { x: p.x + 8, y: p.y + 36, className: 'nw-graph-title' }, (chapter.title || '未命名').slice(0, 10)),
              h('text', { x: p.x + 8, y: p.y + 50, className: 'nw-graph-goal' }, (chapter.synopsis || chapter.goal || '').slice(0, 12)),
            )
          }),
        ),
        h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
          '实线=相邻章衔接；虚线=伏笔回收（plant→payoff）；点节点跳到编辑。'),
      )
    }

    function ChapterWorkspace({ state, root, run, busy, openDiscussion, setToast, focusChapter, mode, setTab, openChapter, openOutline, onSelectChapter }) {
      const isOutline = mode === 'outline'
      return h('div', null,
        h('div', { className: 'nw-workspace-switch' },
          h('button', {
            type: 'button',
            className: `nw-workspace-tab${isOutline ? ' active' : ''}`,
            onClick: () => setTab('outline'),
          }, '章纲'),
          h('button', {
            type: 'button',
            className: `nw-workspace-tab${isOutline ? '' : ' active'}`,
            onClick: () => setTab('chapters'),
          }, '正文'),
        ),
        isOutline
          ? h(OutlineWorkbench, {
              state, run, busy, openDiscussion, setToast, focusChapter,
              onSelectChapter,
              onOpenChapter: (number) => openChapter?.(number),
            })
          : h(ChaptersWorkbench, {
              state, root, run, busy, openDiscussion, setToast, focusChapter,
              onSelectChapter,
              onOpenOutline: (number) => openOutline?.(number),
            }),
      )
    }

    function OutlineWorkbench({ state, run, busy, openDiscussion, setToast, focusChapter, onOpenChapter, onSelectChapter }) {
      const volumes = state.outline?.volumes ?? []
      const allChapters = flattenOutline(state.outline)
      const storedVolume = (() => {
        try {
          const map = JSON.parse(localStorage.getItem('dsh.novelWriter.outlineVolumes') || '{}')
          return map[state?.cwd] ?? null
        } catch {
          return null
        }
      })()
      const focusVolume = Number.isFinite(focusChapter)
        ? volumes.find((volume) => (volume.chapters ?? []).some((chapter) => Number(chapter.number) === Number(focusChapter)))
        : null
      const [volumeId, setVolumeId] = useState(
        focusVolume?.id ??
          (volumes.some((volume) => volume.id === storedVolume)
            ? storedVolume
            : volumes[volumes.length - 1]?.id ?? null),
      )
      const [volumeDraft, setVolumeDraft] = useState(null)
      const [deleteCount, setDeleteCount] = useState(1)
      const chapters = volumeId ? allChapters.filter((item) => item.volumeId === volumeId) : allChapters
      const activeVolume = volumes.find((volume) => volume.id === volumeId) ?? null
      const ready = state.stage?.premise === 'confirmed' && state.stage?.style === 'confirmed' && state.stage?.bible === 'confirmed'
      const readyBlockers = [
        state.stage?.premise !== 'confirmed' ? '构思未确认' : '',
        state.stage?.style !== 'confirmed' ? '文风未确认' : '',
        state.stage?.bible !== 'confirmed' ? '设定未确认' : '',
      ].filter(Boolean)
      const [selected, setSelected] = useState(
        Number.isFinite(focusChapter) && chapters.some((item) => Number(item.number) === Number(focusChapter))
          ? focusChapter
          : chapters[0]?.number ?? null,
      )
      const listRef = useRef(null)
      const workbenchRef = useRef(null)
      useEffect(() => {
        const list = listRef.current
        if (!list) return
        const active = list.querySelector('.nw-list-item.active')
        if (!active) return
        const target = active.offsetTop - (list.clientHeight - active.clientHeight) / 2
        list.scrollTop = Math.max(0, target)
      }, [selected])
      const [instruction, setInstruction] = usePersistedInput(state?.cwd, 'outlineInstruction')
      const [view, setView] = useState('cards')
      const [regenOpen, setRegenOpen] = useState(false)
      const [regenFrom, setRegenFrom] = useState(1)
      const [regenTo, setRegenTo] = useState(1)
      const afterGenerate = async (result) => {
        if (!result) return
        if (result.volumeId) setVolumeId(result.volumeId)
        if (result.nextVolumeId) {
          setVolumeId(result.nextVolumeId)
          setToast('本卷阶段收束，已自动开启下一卷')
        } else if (result.volumeEnded) {
          setToast('本卷阶段收束（自动分卷已关闭，可手动新建下一卷）')
        }
        if (result.partial) {
          setToast(`已生成第 ${result.fromChapter}–${result.toChapter} 章，缺 ${result.missing?.length ?? 0} 章（可再点生成补齐）`)
        } else {
          setToast(`已生成第 ${result.fromChapter}–${result.toChapter} 章`)
        }
        const auto = state.project?.automation ?? {}
        if (auto.autoAudit === false) return
        try {
          setToast?.('章纲已生成，后台审查中…')
          await run('outline-audit', { fromChapter: result.fromChapter, toChapter: result.toChapter }, { silent: true, background: true, throwOnError: true })
          if (auto.autoRepairOutline !== false) {
            setToast?.('章纲审查完成，后台修复中…')
            await run('outline-repair', {}, { silent: true, background: true, throwOnError: true })
            await run('outline-audit', { fromChapter: result.fromChapter, toChapter: result.toChapter }, { silent: true, background: true, throwOnError: true })
            setToast?.('章纲审查与修复完成')
          } else {
            setToast?.('章纲审查完成')
          }
        } catch (error) {
          setToast?.(`后台章纲审查/修复失败：${error.message}`)
        }
      }
      const chooseChapter = (number) => {
        setSelected(number)
        setView('edit')
        onSelectChapter?.(number)
      }
      useEffect(() => {
        if (!Number.isFinite(focusChapter)) return
        setSelected(focusChapter)
        setView('edit')
        const frame = requestAnimationFrame(() => {
          workbenchRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        })
        return () => cancelAnimationFrame(frame)
      }, [focusChapter])
      useEffect(() => {
        if (!state?.cwd || !volumeId) return
        try {
          const map = JSON.parse(localStorage.getItem('dsh.novelWriter.outlineVolumes') || '{}')
          map[state.cwd] = volumeId
          localStorage.setItem('dsh.novelWriter.outlineVolumes', JSON.stringify(map))
        } catch {
          // storage unavailable
        }
      }, [state?.cwd, volumeId])
      useEffect(() => {
        if (Number.isFinite(focusChapter)) {
          const target = volumes.find((volume) =>
            (volume.chapters ?? []).some((chapter) => Number(chapter.number) === Number(focusChapter)),
          )
          if (target) setVolumeId(target.id)
        }
      }, [focusChapter, volumes.map((volume) => `${volume.id}:${(volume.chapters ?? []).length}`).join(',')])
      useEffect(() => {
        if (Number.isFinite(selected)) onSelectChapter?.(selected)
      }, [selected])
      useEffect(() => {
        if (volumeId && !volumes.some((volume) => volume.id === volumeId)) {
          setVolumeId(
            volumes.some((volume) => volume.id === storedVolume)
              ? storedVolume
              : volumes[volumes.length - 1]?.id ?? null,
          )
        }
      }, [volumes.map((volume) => volume.id).join(',')])
      useEffect(() => {
        if (selected == null && chapters.length > 0) setSelected(chapters[0].number)
        if (selected != null && chapters.length > 0 && !chapters.some((item) => Number(item.number) === Number(selected))) {
          setSelected(chapters[0].number)
        }
      }, [volumeId, chapters.length, chapters.map((item) => item.number).join(',')])
      const createVolume = () => {
        if (busy) return
        setVolumeDraft({ mode: 'create', title: `第 ${volumes.length + 1} 卷`, map: '', goal: '', powerCeiling: '', exitCriteria: '' })
      }
      const editVolumePlan = () => {
        if (!activeVolume || busy) return
        setVolumeDraft({
          mode: 'edit',
          id: activeVolume.id,
          title: activeVolume.title ?? '',
          map: activeVolume.map ?? '',
          goal: activeVolume.goal ?? '',
          powerCeiling: activeVolume.powerCeiling ?? '',
          exitCriteria: activeVolume.exitCriteria ?? '',
        })
      }
      const submitVolume = async () => {
        const title = String(volumeDraft?.title ?? '').trim()
        if (!title || busy) return
        const fields = {
          title,
          map: volumeDraft.map ?? '',
          goal: volumeDraft.goal ?? '',
          powerCeiling: volumeDraft.powerCeiling ?? '',
          exitCriteria: volumeDraft.exitCriteria ?? '',
        }
        if (volumeDraft.mode === 'edit') {
          await run('volume-update', { volumeId: volumeDraft.id, ...fields }, { toast: '卷计划已保存' })
          setVolumeDraft(null)
          return
        }
        const result = await run('volume-create', fields, { toast: '已新建卷' })
        setVolumeDraft(null)
        if (result?.id) setVolumeId(result.id)
      }
      const deleteVolume = async () => {
        if (!activeVolume) return
        if ((activeVolume.chapters ?? []).length > 0) {
          window.alert('卷内还有章节，先把章节移到其他卷再删除。')
          return
        }
        if (!(await requestConfirm({ title: '删除卷', message: `删除卷「${activeVolume.title}」？`, danger: true }))) return
        await run('volume-delete', { volumeId: activeVolume.id }, { toast: '卷已删除' })
        setVolumeId(volumes.find((volume) => volume.id !== activeVolume.id)?.id ?? null)
      }
      const moveChapter = async (number, targetId) => {
        await run('chapter-move', { number, volumeId: targetId }, { toast: '章节已移动' })
      }
      const chapter = chapters.find((item) => Number(item.number) === Number(selected))
      const [fields, setFields] = useState(chapter ?? {})
      useEffect(() => { setFields(chapter ?? {}) }, [chapter?.id, chapter?.editedAt, chapter?.status, chapter?.title])
      const update = (key, value) => setFields((prev) => ({ ...prev, [key]: value }))
      const dirty = chapter
        ? ['title', 'synopsis', 'wordBudget']
            .some((key) => String(fields[key] ?? '') !== String(chapter[key] ?? ''))
        : false
      const cardsView = h('div', { className: 'nw-cards' },
        chapters.map((item) =>
          h('div', {
            key: item.id,
            className: 'nw-chapter-card',
            style: { cursor: 'pointer' },
            onClick: () => chooseChapter(item.number),
          },
            h('div', { className: 'nw-row' },
              h('span', { className: 'nw-eyebrow' }, `${item.volumeTitle ? `${item.volumeTitle} · ` : ''}第 ${item.number} 章`),
              h('span', { className: `nw-badge ${statusClass(item.status)}` }, item.status === 'confirmed' ? '已确认' : '待确认'),
            ),
            h('div', { className: 'nw-chapter-card-title' }, item.title || '未命名'),
            h('div', { className: 'nw-muted nw-clamp' }, item.synopsis || item.goal || '还没有剧情梗概'),
            h('div', { className: 'nw-row' },
              h('span', { className: 'nw-muted' }, `${item.wordBudget ?? 0} 字`),
              onOpenChapter
                ? h('button', {
                    type: 'button',
                    className: 'nw-btn ghost',
                    style: { marginLeft: 'auto' },
                    onClick: (event) => { event.stopPropagation(); onOpenChapter(item.number) },
                  }, '写正文')
                : null,
            ),
          ),
        ),
      )
      const tableView = h('div', { className: 'nw-table-wrap' },
        h('table', { className: 'nw-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '#'), h('th', null, '标题'), h('th', null, '剧情梗概'), h('th', null, '状态'), h('th', null, '字数'), h('th', null, '操作'),
            ),
          ),
          h('tbody', null,
            chapters.map((item) =>
              h('tr', { key: item.id, onClick: () => chooseChapter(item.number) },
                h('td', null, String(item.number).padStart(2, '0')),
                h('td', null, item.title || '未命名'),
                h('td', { className: 'nw-clamp' }, item.synopsis || item.goal || '—'),
                h('td', null, h('span', { className: `nw-badge ${statusClass(item.status)}` }, item.status === 'confirmed' ? '已确认' : '待确认')),
                h('td', null, `${item.wordBudget ?? 0}`),
                h('td', null,
                  onOpenChapter
                    ? h('button', {
                        type: 'button',
                        className: 'nw-btn ghost',
                        onClick: (event) => { event.stopPropagation(); onOpenChapter(item.number) },
                      }, '写正文')
                    : null,
                ),
              ),
            ),
          ),
        ),
      )
      return h('div', null,
        h(StepIntro, {
          eyebrow: '04 / 大纲',
          title: '把故事拆成可执行的章节',
          status: state.outline?.status,
          desc: '左边选章，右边直接改；生成与重生成只影响选中的范围，确认后进入章节写作。',
          hints: ['生成后 3–6 章', '左侧选章，右侧编辑', '逐章确认或全部确认'],
        }),
        h('div', { className: 'nw-card' },
          h('div', { className: 'nw-row', style: { flexWrap: 'wrap' } },
            h('div', { className: 'nw-eyebrow' }, '分卷'),
            h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginLeft: '4px' } },
              h('button', { type: 'button', className: `nw-btn ghost${volumeId == null ? ' primary' : ''}`, onClick: () => setVolumeId(null) }, '全部'),
              volumes.map((volume) =>
                h('button', { key: volume.id, type: 'button', className: `nw-btn ghost${volumeId === volume.id ? ' primary' : ''}`, onClick: () => setVolumeId(volume.id) },
                  `${volume.title || '未命名卷'} · ${(volume.chapters ?? []).length}`,
                ),
              ),
            ),
          ),
          h('div', { className: 'nw-actions', style: { marginTop: '8px' } },
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: createVolume }, '+ 新建卷'),
            activeVolume ? h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: editVolumePlan }, '卷设置') : null,
            activeVolume ? h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => run('volume-plan', { volumeId: activeVolume.id }, { toast: '已生成卷舞台设定' }) }, '生成卷设定') : null,
            activeVolume ? h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: deleteVolume }, '删除卷') : null,
            activeVolume && chapters.length
              ? h('button', {
                  type: 'button',
                  className: 'nw-btn',
                  disabled: busy,
                  onClick: async () => {
                    if (!(await requestConfirm({
                      title: '确认本卷章纲',
                      message: `确认「${activeVolume.title || '当前卷'}」全部 ${chapters.length} 章章纲？`,
                      confirmLabel: '确认',
                    }))) return
                    const numbers = chapters.map((item) => Number(item.number)).sort((a, b) => a - b)
                    run('outline-commit', {
                      fromChapter: numbers[0],
                      toChapter: numbers[numbers.length - 1],
                    }, { toast: '本卷章纲已确认' })
                  },
                }, '确认本卷')
              : null,
            h('input', {
              className: 'nw-input',
              style: { width: '64px' },
              type: 'number',
              min: '1',
              value: deleteCount,
              disabled: busy,
              title: '要删除的尾部章节数',
              onChange: (event) => setDeleteCount(Number(event.target.value) || 1),
            }),
            h('button', {
              type: 'button',
              className: 'nw-btn danger',
              disabled: busy,
              onClick: async () => {
                const preview = await run('chapters-delete-tail', { count: deleteCount, dryRun: true }, { silent: true })
                if (!preview) return
                if (!(await requestConfirm({
                  title: '删除尾部章节',
                  message: `将删除第 ${preview.from}–${preview.to} 章的大纲，并同时删除这些章的正文、定稿、修订、摘要与状态快照，无法恢复。`,
                  danger: true,
                  confirmLabel: '删除',
                }))) return
                run('chapters-delete-tail', { count: deleteCount }, { toast: `已删除第 ${preview.from}–${preview.to} 章` })
              },
            }, '删除尾部章节'),
          ),
          activeVolume
            ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
                `地图：${activeVolume.map || '未设置'} · 战力天花板：${activeVolume.powerCeiling || '未设置'} · 离卷：${activeVolume.exitCriteria || '未设置'}`,
              )
            : null,
          volumeDraft
            ? h('div', { className: 'nw-banner', style: { marginTop: '8px', display: 'grid', gap: '8px' } },
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
                  h('span', { className: 'nw-label', style: { margin: 0, minWidth: '52px' } }, volumeDraft.mode === 'edit' ? '卷设置' : '新卷名称'),
                  h('input', {
                    className: 'nw-input',
                    style: { flex: '1 1 220px', minWidth: '180px' },
                    value: volumeDraft.title,
                    autoFocus: true,
                    disabled: busy,
                    placeholder: '卷名',
                    onChange: (event) => setVolumeDraft((prev) => prev ? { ...prev, title: event.target.value } : prev),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') submitVolume()
                      if (event.key === 'Escape') setVolumeDraft(null)
                    },
                  }),
                  h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !String(volumeDraft.title ?? '').trim(), onClick: submitVolume }, volumeDraft.mode === 'edit' ? '保存卷计划' : '创建卷'),
                  h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => setVolumeDraft(null) }, '取消'),
                ),
                h('div', { className: 'nw-grid-2' },
                  h('div', { className: 'nw-field' },
                    h('label', { className: 'nw-label' }, '本地地图'),
                    h('input', { className: 'nw-input', value: volumeDraft.map ?? '', disabled: busy, placeholder: '如：临川府；新卷不得沿用上一卷地图', onChange: (event) => setVolumeDraft((prev) => prev ? { ...prev, map: event.target.value } : prev) }),
                  ),
                  h('div', { className: 'nw-field' },
                    h('label', { className: 'nw-label' }, '本地战力天花板'),
                    h('input', { className: 'nw-input', value: volumeDraft.powerCeiling ?? '', disabled: busy, placeholder: '如：一流；决定主角何时能离开本地', onChange: (event) => setVolumeDraft((prev) => prev ? { ...prev, powerCeiling: event.target.value } : prev) }),
                  ),
                ),
                h('div', { className: 'nw-field' },
                  h('label', { className: 'nw-label' }, '本卷目标'),
                  h('input', { className: 'nw-input', value: volumeDraft.goal ?? '', disabled: busy, placeholder: '本卷要完成的主线', onChange: (event) => setVolumeDraft((prev) => prev ? { ...prev, goal: event.target.value } : prev) }),
                ),
                h('div', { className: 'nw-field' },
                  h('label', { className: 'nw-label' }, '离卷条件'),
                  h('input', { className: 'nw-input', value: volumeDraft.exitCriteria ?? '', disabled: busy, placeholder: '本地主线收束 + 主角压过本地天花板后离开', onChange: (event) => setVolumeDraft((prev) => prev ? { ...prev, exitCriteria: event.target.value } : prev) }),
                ),
              )
            : null,
        ),
        h('div', { className: 'nw-card' },
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !ready, onClick: async () => { const result = await run('outline-generate', { count: 3, volumeId: volumeId ?? volumes[0]?.id, instruction: instruction || undefined, deferAudit: true }); afterGenerate(result) } }, busy ? '生成中…' : '生成后 3 章'),
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy || !ready,
              title: '分两批各生成 3 章，降低单次输出过长导致的失败率',
              onClick: async () => {
                const first = await run('outline-generate', { count: 3, volumeId: volumeId ?? volumes[0]?.id, instruction: instruction || undefined, deferAudit: true })
                if (!first) return
                afterGenerate(first)
                const second = await run('outline-generate', { count: 3, fromChapter: first.toChapter + 1, volumeId: volumeId ?? volumes[0]?.id, instruction: instruction || undefined, deferAudit: true })
                if (second) afterGenerate(second)
              },
            }, '生成后 6 章（分两批）'),
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy || chapters.length === 0,
              title: '根据已有正文反推每章 synopsis，不新增正文没有的事件',
              onClick: async () => {
                if (!(await requestConfirm({
                  title: '从正文反推章纲',
                  message: '将读取已有正文，反推每章剧情梗概，并覆盖对应章纲的 synopsis。继续？',
                  confirmLabel: '反推',
                }))) return
                await run('outline-reverse', {}, { toast: '已从正文反推章纲' })
              },
            }, '从正文反推章纲'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy || !ready || chapters.length === 0, onClick: () => run('outline-commit', {}, { toast: '已确认全部章纲' }) }, '确认全部'),
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy || !ready || chapters.length === 0,
              title: '按范围重生成章纲（会覆盖现有章纲并重置为待确认）',
              onClick: () => {
                setRegenOpen((value) => !value)
                setRegenFrom(1)
                setRegenTo(chapters.reduce((max, item) => Math.max(max, Number(item.number) || 0), 1))
              },
            }, regenOpen ? '收起批量重生成' : '批量重生成'),
            h('input', { className: 'nw-input', style: { flex: '1 1 260px', minWidth: '220px' }, value: instruction, placeholder: '生成/重生成要求（会写进章纲）', onChange: (event) => setInstruction(event.target.value), disabled: busy }),
            state.project?.writingNotes
              ? h('button', {
                  type: 'button',
                  className: 'nw-btn ghost',
                  onClick: () => setInstruction((prev) => (prev.trim() ? `${prev}\n${state.project.writingNotes}` : state.project.writingNotes)),
                }, '插入项目要求')
              : null,
            instruction.trim()
              ? h('button', {
                  type: 'button',
                  className: 'nw-btn ghost',
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(instruction)
                      setToast?.('生成要求已复制')
                    } catch {
                      setToast?.('复制失败')
                    }
                  },
                }, '复制要求')
              : null,
            h('div', { className: 'nw-viewtoggle' },
              [['cards', '卡片'], ['table', '表格'], ['graph', '图谱'], ['edit', '编辑']].map(([id, label]) =>
                h('button', { key: id, type: 'button', className: `nw-viewtoggle-btn${view === id ? ' active' : ''}`, onClick: () => setView(id) }, label),
              ),
            ),
          ),
          regenOpen
            ? h('div', { className: 'nw-banner', style: { marginTop: '10px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px' } },
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' } },
                  h('div', { className: 'nw-field', style: { margin: 0, minWidth: '96px' } },
                    h('label', { className: 'nw-label' }, '起始章'),
                    h('input', { className: 'nw-input', type: 'number', min: 1, value: regenFrom, disabled: busy, onChange: (event) => setRegenFrom(Math.max(1, Number(event.target.value) || 1)) }),
                  ),
                  h('div', { className: 'nw-field', style: { margin: 0, minWidth: '96px' } },
                    h('label', { className: 'nw-label' }, '结束章'),
                    h('input', { className: 'nw-input', type: 'number', min: 1, value: regenTo, disabled: busy, onChange: (event) => setRegenTo(Math.max(1, Number(event.target.value) || 1)) }),
                  ),
                  h('button', {
                    type: 'button',
                    className: 'nw-btn primary',
                    disabled: busy || !ready,
                    onClick: async () => {
                      const from = Math.min(regenFrom, regenTo)
                      const to = Math.max(regenFrom, regenTo)
                      if (!(await requestConfirm({ title: '重生成章纲', message: `重生成第 ${from}–${to} 章章纲？现有内容会被覆盖并重置为待确认；顶部「生成/重生成要求」会作为本次指令。`, confirmLabel: '重生成' }))) return
                      setRegenOpen(false)
                      // 分批生成，避免一次输出过长导致 JSON 被截断；每批 3 章。
                      const batchSize = 3
                      for (let start = from; start <= to; start += batchSize) {
                        const end = Math.min(to, start + batchSize - 1)
                        setToast(`正在重生成第 ${start}–${end} 章…`)
                        const result = await run('outline-generate', {
                          fromChapter: start,
                          toChapter: end,
                          instruction: instruction || undefined,
                          regenerate: true,
                          volumeId: volumeId ?? volumes[0]?.id,
                          deferAudit: true,
                        }, { silent: true })
                        if (!result) return
                        if (end === to) afterGenerate(result)
                      }
                      setToast(`已重生成第 ${from}–${to} 章`)
                    },
                  }, '开始重生成'),
                  h('button', { type: 'button', className: 'nw-btn', onClick: () => setRegenOpen(false) }, '取消'),
                ),
                h('div', { className: 'nw-muted' }, `范围：第 ${Math.min(regenFrom, regenTo)}–${Math.max(regenFrom, regenTo)} 章；只重写章纲，不动已写正文。`),
              )
            : null,
          ready ? null : h('div', { className: 'nw-banner warn', style: { marginTop: '10px' } }, `先完成${readyBlockers.join('、')}，章纲按钮才会启用。`),
        ),
        chapters.length === 0
          ? h(EmptyState, { title: '还没有章纲', desc: '先确认构思、文风和设定，然后生成后 3 章。' })
          : view === 'cards'
            ? cardsView
            : view === 'table'
              ? tableView
              : view === 'graph'
                ? h(ChapterGraph, { chapters, onChoose: chooseChapter, setToast })
                : h('div', { className: 'nw-workbench', ref: workbenchRef },
              h('div', { className: 'nw-list', ref: listRef },
                chapters.map((item) =>
                  h('button', {
                    key: item.id,
                    type: 'button',
                    className: `nw-list-item${Number(selected) === Number(item.number) ? ' active' : ''}`,
                    onClick: () => setSelected(item.number),
                  },
                    h('span', { className: 'nw-list-num' }, String(item.number).padStart(2, '0')),
                    h('span', { className: 'nw-list-title' }, `${item.volumeTitle && volumeId == null ? `${item.volumeTitle} · ` : ''}${item.title || '未命名'}`),
                    h('span', { className: `nw-badge ${statusClass(item.status)}` }, item.status === 'confirmed' ? '已确认' : '待确认'),
                    onOpenChapter
                      ? h('span', {
                          className: 'nw-list-hover',
                          role: 'button',
                          title: '跳到本章正文',
                          onClick: (event) => {
                            event.stopPropagation()
                            onOpenChapter(item.number)
                          },
                        }, '文')
                      : null,
                  ),
                ),
              ),
              chapter
                ? h('div', { className: 'nw-pane nw-pane-scroll' },
                    h('div', { className: 'nw-card' },
                      h('div', { className: 'nw-row' },
                        h('div', null,
                          h('div', { className: 'nw-eyebrow' }, `第 ${chapter.number} 章`),
                          h('h2', { className: 'nw-h2' }, chapter.title || '未命名'),
                        ),
                        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
                          volumes.length > 1
                            ? h('select', {
                                className: 'nw-input',
                                style: { width: 'auto', minWidth: '120px' },
                                value: chapter.volumeId ?? volumeId ?? volumes[0]?.id,
                                disabled: busy,
                                onChange: (event) => moveChapter(chapter.number, event.target.value),
                              }, volumes.map((volume) => h('option', { key: volume.id, value: volume.id }, volume.title)))
                            : null,
                          h('button', { type: 'button', className: 'nw-btn', onClick: () => openDiscussion(`outline-${chapter.id}`, `第 ${chapter.number} 章纲要讨论`, chapter) }, '讨论'),
                          onOpenChapter ? h('button', { type: 'button', className: 'nw-btn', title: '跳到本章正文', onClick: () => onOpenChapter(chapter.number) }, '打开正文') : null,
                          h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !ready, onClick: () => run('outline-commit', { fromChapter: chapter.number, toChapter: chapter.number }, { toast: `第 ${chapter.number} 章已确认` }) }, '确认本章'),
                        ),
                      ),
                      h('div', { className: 'nw-grid-2' },
                        h('div', { className: 'nw-field' },
                          h('label', { className: 'nw-label' }, '标题'),
                          h('input', { className: 'nw-input', value: fields.title ?? '', onChange: (e) => update('title', e.target.value), disabled: busy }),
                        ),
                        h('div', { className: 'nw-field' },
                          h('label', { className: 'nw-label' }, '目标字数'),
                          h('input', { className: 'nw-input', type: 'number', value: fields.wordBudget ?? 0, onChange: (e) => update('wordBudget', Number(e.target.value) || 0), disabled: busy }),
                        ),
                      ),
                      h('div', { className: 'nw-field' },
                        h('label', { className: 'nw-label' }, '剧情梗概'),
                        h('textarea', {
                          className: 'nw-textarea',
                          style: { minHeight: '220px' },
                          value: fields.synopsis ?? '',
                          placeholder: '写清这段剧情里谁在什么处境、做了什么、发生了什么、结果如何。不需要拆成目标/冲突/转折/结果。',
                          onChange: (e) => update('synopsis', e.target.value),
                          disabled: busy,
                        }),
                      ),
                      h('div', { className: 'nw-actions' },
                        h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !dirty, onClick: () => run('outline-update', { chapterId: chapter.id, fields }, { toast: `第 ${chapter.number} 章已保存（待确认）` }) }, '保存修改'),
                        h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: async () => { const result = await run('outline-generate', { fromChapter: chapter.number, toChapter: chapter.number, instruction: instruction || undefined, deferAudit: true }); afterGenerate(result) } }, '重生成本章'),
                        (() => {
                          const lastChapter = allChapters.reduce(
                            (max, item) => (Number(item.number) > Number(max?.number ?? 0) ? item : max),
                            null,
                          )
                          return lastChapter && Number(lastChapter.number) === Number(chapter.number)
                            ? h('button', {
                                type: 'button',
                                className: 'nw-btn danger',
                                disabled: busy,
                                onClick: async () => {
                                  const preview = await run('chapters-delete-tail', { count: 1, dryRun: true }, { silent: true })
                                  if (!preview) return
                                  if (!(await requestConfirm({
                                    title: '删除本章',
                                    message: `将删除第 ${preview.from} 章（最后一章）的大纲，并同时删除它的正文、定稿、修订、摘要与状态快照，无法恢复。`,
                                    danger: true,
                                    confirmLabel: '删除',
                                  }))) return
                                  run('chapters-delete-tail', { count: 1 }, { toast: `已删除第 ${preview.from} 章` })
                                },
                              }, '删除本章（最后一章）')
                            : null
                        })(),
                      ),
                    ),
                  )
                : h('div', { className: 'nw-empty' }, '选择左侧一章。'),
            ),
      )
    }

    function ChaptersWorkbench({ state, root, run, busy, openDiscussion, setToast, focusChapter, onOpenOutline, onSelectChapter }) {
      const allChapters = state.chapters ?? []
      const volumes = state.volumes ?? []
      const [volumeFilter, setVolumeFilter] = useState('all')
      const [runDetail, setRunDetail] = useState(null)
      const chapters = volumeFilter === 'all'
        ? allChapters
        : allChapters.filter((item) => item.volumeId === volumeFilter)
      const storedChapter = (() => {
        try {
          return Number(localStorage.getItem('dsh.novelWriter.chapter')) || null
        } catch {
          return null
        }
      })()
      const [selected, setSelected] = useState(() => {
        if (Number.isFinite(focusChapter) && chapters.some((item) => Number(item.number) === Number(focusChapter))) {
          return focusChapter
        }
        return chapters.some((item) => Number(item.number) === storedChapter)
          ? storedChapter
          : chapters[0]?.number ?? null
      })
      const listRef = useRef(null)
      const workbenchRef = useRef(null)
      useEffect(() => {
        const list = listRef.current
        if (!list) return
        const active = list.querySelector('.nw-list-item.active')
        if (!active) return
        const target = active.offsetTop - (list.clientHeight - active.clientHeight) / 2
        list.scrollTop = Math.max(0, target)
      }, [selected, volumeFilter])
      useEffect(() => {
        if (chapters.length > 0 && !chapters.some((item) => Number(item.number) === Number(selected))) {
          setSelected(chapters[0].number)
        }
      }, [volumeFilter, chapters.length, chapters.map((item) => item.number).join(',')])
      useEffect(() => {
        if (selected == null) return
        try {
          localStorage.setItem('dsh.novelWriter.chapter', String(selected))
        } catch {
          // storage unavailable
        }
      }, [selected])
      const selectedRef = useRef(selected)
      useEffect(() => {
        selectedRef.current = selected
      }, [selected])
      useEffect(() => {
        if (!Number.isFinite(focusChapter)) return
        setSelected(focusChapter)
        const frame = requestAnimationFrame(() => {
          workbenchRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        })
        return () => cancelAnimationFrame(frame)
      }, [focusChapter])
      useEffect(() => {
        if (Number.isFinite(selected)) onSelectChapter?.(selected)
      }, [selected])
      useEffect(() => {
        const onInstruction = (event) => {
          const payload = event.detail ?? {}
          if (Number(payload.number) === Number(selected) && payload.instruction) {
            setInstruction(payload.instruction)
            setToast('已把讨论建议写入本章修订要求')
          }
        }
        const onRefresh = () => {
          if (selected == null) return
          fetchProjectChapter(root, selected).then((next) => setDetail(next)).catch(() => {})
        }
        window.addEventListener('nw-instruction-updated', onInstruction)
        window.addEventListener('nw-chapters-refresh', onRefresh)
        return () => {
          window.removeEventListener('nw-instruction-updated', onInstruction)
          window.removeEventListener('nw-chapters-refresh', onRefresh)
        }
      }, [selected, root])
      const [detail, setDetail] = useState(null)
      const [detailLoading, setDetailLoading] = useState(false)
      const [detailError, setDetailError] = useState(null)
      const [instruction, setInstruction] = usePersistedInput(state?.cwd, `chapterInstruction:${selected ?? 0}`)
      const [fromParagraph, setFromParagraph] = usePersistedInput(state?.cwd, 'chapterFromParagraph')
      const [toParagraph, setToParagraph] = usePersistedInput(state?.cwd, 'chapterToParagraph')
      const [revisionDetail, setRevisionDetail] = useState(null)
      const [revisionLoading, setRevisionLoading] = useState(false)
      const [selStart, setSelStart] = useState(null)
      const [selEnd, setSelEnd] = useState(null)
      const [contextPreview, setContextPreview] = useState(null)
      const [contextLoading, setContextLoading] = useState(false)
      const [editing, setEditing] = useState(false)
      const [polishMode, setPolishMode] = useState('润色')
      const [draftText, setDraftText] = useState('')
      const [rewritePreview, setRewritePreview] = useState(null)
      const [rejectedHunks, setRejectedHunks] = useState(() => new Set())
      const [previewLoading, setPreviewLoading] = useState(false)
      const [lastRewrite, setLastRewrite] = useState(null)
      const [continuity, setContinuity] = useState(null)
      const [continuitySelected, setContinuitySelected] = useState([])
      const [mouseSelection, setMouseSelection] = useState(readMouseSelection)
      const paneRef = useRef(null)
      const scrollPositions = useRef({})

      useEffect(() => {
        setRevisionDetail(null)
        setFromParagraph('')
        setToParagraph('')
        setSelStart(null)
        setSelEnd(null)
        setContextPreview(null)
        setEditing(false)
        setRewritePreview(null)
        setRejectedHunks(new Set())
        setLastRewrite(null)
      }, [selected])

      useEffect(() => {
        if (chapters.length === 0) return
        if (selected == null || !chapters.some((item) => Number(item.number) === Number(selected))) {
          setSelected(chapters[0].number)
        }
      }, [chapters.length, chapters.map((item) => item.number).join(',')])

      useEffect(() => {
        if (selected == null) return undefined
        let alive = true
        setDetailLoading(true)
        setDetailError(null)
        fetchProjectChapter(root, selected)
          .then((data) => { if (alive) setDetail(data) })
          .catch((error) => { if (alive) { setDetailError(String(error?.message ?? error)); setDetail(null) } })
          .finally(() => { if (alive) setDetailLoading(false) })
        return () => { alive = false }
      }, [root, selected])

      useEffect(() => {
        const pane = paneRef.current
        if (!pane) return undefined
        const key = `${root}:${selected}`
        const top = scrollPositions.current[key] ?? 0
        const frame = requestAnimationFrame(() => {
          pane.scrollTop = top
        })
        return () => cancelAnimationFrame(frame)
      }, [selected, detail?.number])

      useEffect(() => {
        const stored = detail?.continuity ?? null
        if (!stored) {
          setContinuity(null)
          setContinuitySelected([])
          return
        }
        setContinuity({ ...stored })
        setContinuitySelected(
          (stored.issues ?? [])
            .map((issue, index) => (issue.level !== 'note' && !isContinuityApplied(stored, issue) ? index : -1))
            .filter((index) => index >= 0),
        )
      }, [detail?.continuity?.checkedAt, selected])

      useEffect(() => {
        const pending = detail?.pendingInstruction
        if (!pending?.instruction) return
        setInstruction((prev) => (prev.trim() ? prev : pending.instruction))
      }, [detail?.pendingInstruction?.createdAt, selected])

      const act = async (action, params) => {
        const result = await run(action, params)
        if (selected != null) {
          try {
            setDetail(await fetchProjectChapter(root, selected))
          } catch {
            // state error is shown by the parent
          }
        }
        return result
      }

      const current = chapters.find((item) => Number(item.number) === Number(selected))
      const qa = detail?.qa
      const powerChanges = state.power?.chapterChanges?.[String(selected)] ?? []
      const styleQa = detail?.styleQa
      const text = detail?.draft ?? detail?.final
      const hasDraft = Boolean(detail?.draft)
      const hasFinal = Boolean(detail?.final)
      const needsReview = detail?.meta?.status === 'needs-review'
      const remainingIssues = detail?.meta?.remainingIssues ?? []
      const automation = state.project?.automation ?? {}
      const autoFixOn = Boolean(automation.autoFix ?? state.project?.autoFix)
      const fixRounds = automation.fixRounds ?? 2
      const batchCount = Math.max(1, Math.min(10, Number(automation.batchCount ?? 3) || 3))
      const stylePassScore = automation.stylePassScore ?? 60
      const draftModelConfig = state.project?.models?.draft
      const modelDefaults = state.modelDefaults ?? {}
      const effectiveDraft = state.effectiveModels?.draft
      const proseModelLabel = effectiveDraft
        ? `${effectiveDraft.provider} / ${effectiveDraft.model}`
        : draftModelConfig?.provider
          ? `${draftModelConfig.provider} / ${draftModelConfig.model}`
          : modelDefaults.provider
            ? `${modelDefaults.provider} / ${modelDefaults.model}`
            : 'DSH 当前默认'
      const proseEffort = effectiveDraft?.reasoningEffort ?? draftModelConfig?.reasoningEffort ?? modelDefaults.reasoningEffort ?? ''
      const proseHighEffort = ['medium', 'high', 'max', 'xhigh'].includes(String(proseEffort))
      const nextChapter = chapters.find((item) => Number(item.number) === Number(selected) + 1)
      const previousChapter = chapters.find((item) => Number(item.number) === Number(selected) - 1)
      const paragraphs = text ? text.split(/\n+/).filter((paragraph) => paragraph.trim()) : []
      const batchStart = chapters.find((item) => !item.hasDraft)?.number
      const batchChapter = chapters.find((item) => Number(item.number) === Number(batchStart))
      const batchReady = batchChapter?.outlineStatus === 'confirmed'

      const selectParagraph = (index) => {
        if (!mouseSelection) return
        if (selStart == null) {
          setSelStart(index)
          setSelEnd(index)
          setFromParagraph(String(index + 1))
          setToParagraph(String(index + 1))
        } else if (selEnd === selStart) {
          const start = Math.min(selStart, index)
          const end = Math.max(selStart, index)
          setSelStart(start)
          setSelEnd(end)
          setFromParagraph(String(start + 1))
          setToParagraph(String(end + 1))
        } else {
          setSelStart(index)
          setSelEnd(index)
          setFromParagraph(String(index + 1))
          setToParagraph(String(index + 1))
        }
      }

      const clearSelection = () => {
        setSelStart(null)
        setSelEnd(null)
        setFromParagraph('')
        setToParagraph('')
      }

      const toggleMouseSelection = () => {
        const next = !mouseSelection
        setMouseSelection(next)
        storeMouseSelection(next)
        if (!next) clearSelection()
      }

      const jumpToParagraph = (paragraph) => {
        const index = Number(paragraph)
        if (!Number.isFinite(index)) return
        const target = paneRef.current?.querySelector(`[data-para="${index}"]`)
        if (!target) return
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        target.classList.add('nw-flash')
        setTimeout(() => target.classList.remove('nw-flash'), 1600)
      }

      const rangeStart = selStart == null ? null : Math.min(selStart, selEnd ?? selStart)
      const rangeEnd = selStart == null ? null : Math.max(selStart, selEnd ?? selStart)

      const rewriteSelection = async () => {
        if (rangeStart == null) return
        setPreviewLoading(true)
        try {
          const result = await run('chapter-rewrite-preview', {
            number: selected,
            instruction: instruction.trim() || '只重写选中的段落，保持情节、事实、人物关系与前后衔接不变。',
            fromParagraph: rangeStart + 1,
            toParagraph: rangeEnd + 1,
          }, { silent: true })
          if (result?.nextText) {
            setRewritePreview(result)
            setRejectedHunks(new Set())
          }
        } finally {
          setPreviewLoading(false)
        }
      }

      const applyRewritePreview = async () => {
        if (!rewritePreview) return
        const { ops, hunks } = buildDiffHunks(rewritePreview.current ?? '', rewritePreview.nextText ?? '')
        if (hunks.length === 0) {
          window.alert('没有检测到文本变化，不需要应用。')
          return
        }
        const proposedText = applyDiffHunks(ops, rejectedHunks)
        if (proposedText === (rewritePreview.current ?? '')) {
          window.alert('所有修改都被取消了，没有可应用的内容。')
          return
        }
        const result = await run('chapter-revise', {
          number: selected,
          instruction: instruction.trim() || '只重写选中的段落，保持情节、事实、人物关系与前后衔接不变。',
          fromParagraph: rangeStart + 1,
          toParagraph: rangeEnd + 1,
          proposedText,
        }, { silent: true })
        if (result?.revisionPath) {
          setLastRewrite({
            number: selected,
            name: String(result.revisionPath).split('/').pop(),
            range: rewritePreview.range,
          })
          setRewritePreview(null)
          clearSelection()
        }
      }

      const undoRewrite = async () => {
        if (!lastRewrite) return
        await run('chapter-restore', { number: lastRewrite.number, name: lastRewrite.name }, { toast: '已恢复重写前版本' })
        setLastRewrite(null)
      }

      const startEditing = () => {
        setDraftText(detail?.draft ?? detail?.final ?? '')
        setEditing(true)
      }

      const openChapterDiscussion = () => openDiscussion(
        `chapter-${selected}`,
        `第 ${selected} 章讨论`,
        {
          number: selected,
          title: detail?.chapter?.title,
          excerpt: (text ?? '').slice(0, 3000),
        },
      )

      const renderIssue = (issue, index) => {
        const paragraph = issue?.paragraph != null && Number.isFinite(Number(issue.paragraph)) ? Number(issue.paragraph) : null
        return h('div', {
          key: index,
          className: `nw-issue${paragraph != null ? ' clickable' : ''}`,
          title: paragraph != null ? '点击定位到对应段落' : undefined,
          onClick: paragraph != null ? () => jumpToParagraph(paragraph) : undefined,
        },
          h('span', { className: `nw-issue-dot ${issue.level}` }),
          h('span', { style: { flex: 1 } }, issue.message),
          paragraph != null ? h('span', { className: 'nw-issue-jump' }, `第 ${paragraph + 1} 段`) : null,
        )
      }

      useEffect(() => {
        const onKeyDown = (event) => {
          if (isTypingTarget(event.target)) return
          if (rewritePreview || previewLoading) return
          if (event.altKey && event.key === 'ArrowLeft' && previousChapter) {
            event.preventDefault()
            setSelected(previousChapter.number)
            return
          }
          if (event.altKey && event.key === 'ArrowRight' && nextChapter) {
            event.preventDefault()
            setSelected(nextChapter.number)
            return
          }
          if (event.ctrlKey || event.metaKey || event.altKey) return
          const key = String(event.key).toLowerCase()
          if (key === 'e' && hasDraft && !busy && !editing) {
            event.preventDefault()
            startEditing()
          } else if (key === 'a' && !busy) {
            event.preventDefault()
            runAudit()
          } else if (key === 'd') {
            event.preventDefault()
            openChapterDiscussion()
          } else if (key === 'escape' && rangeStart != null) {
            event.preventDefault()
            clearSelection()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [selected, previousChapter?.number, nextChapter?.number, hasDraft, busy, editing, rangeStart, rewritePreview, previewLoading])

      const saveManual = async () => {
        if (!draftText.trim()) return
        const result = await act('chapter-save-text', { number: selected, text: draftText })
        if (result) setEditing(false)
      }

      const batchWrite = async () => {
        if (!batchStart) return
        const result = await run('chapter-batch', { count: batchCount, fromChapter: batchStart }, { silent: true })
        if (!result?.results) return
        const ok = result.results.filter((item) => item.ok)
        const skipped = result.results.filter((item) => item.skipped)
        if (ok.length > 0) {
          setSelected(ok[0].number)
          setToast(`已生成 ${ok.map((item) => `第 ${item.number} 章`).join('、')}，请逐章审阅`)
        } else if (skipped.length > 0) {
          setToast('所选章节已有草稿，未重复生成')
        } else if (result.results.some((item) => item.cancelled)) {
          setToast('已取消')
        } else {
          setToast('没有生成新章节，请检查章纲是否已确认')
        }
      }

      const autoFixQa = async () => {
        const requestNumber = selected
        const result = await run('chapter-autofix', { number: requestNumber }, { silent: true })
        if (result) {
          const score = result.bestStyleScore ?? result.styleQa?.score ?? null
          const remaining = result.remainingIssues?.length ?? 0
          if (result.passed) {
            setToast(`修复通过${score != null ? `（风格分 ${score}）` : ''}`)
          } else if (result.keptBest) {
            setToast(`已保留最佳版本${score != null ? `（风格分 ${score}）` : ''}；仍有 ${remaining} 条提示，可手动处理`)
          } else {
            setToast(`修复完成，仍有 ${remaining} 条提示；可查看剩余问题或手动修改`)
          }
        }
        if (Number(selectedRef.current) !== Number(requestNumber)) return
        try {
          setDetail(await fetchProjectChapter(root, requestNumber))
        } catch {
          // parent error state covers failures
        }
      }

      const polishChapter = async (mode) => {
        if (!hasDraft) return
        const currentWords = Number(detail?.wordCount ?? 0) || 0
        const instructions = {
          润色: '只润色文字：保持情节、人物、事件顺序与对白内容不变，改善句式、词汇、节奏与画面感；不新增情节、不改事实。',
          扩写: `扩写到约 ${Math.max(1200, Math.round(currentWords * 1.3))} 字：保留现有情节与对白，补充场景、动作、感官细节；不新增事件。`,
          缩写: `压缩到约 ${Math.max(800, Math.round(currentWords * 0.7))} 字：保留关键情节与对白，删减重复、过场与冗余描写。`,
        }
        const result = await act('chapter-revise', { number: selected, instruction: instructions[mode] })
        if (result) setToast(`已${mode}（${result.wordCount ?? '—'} 字）`)
      }

      const runAudit = async () => {
        await act('chapter-audit', { number: selected })
      }

      const runCombinedReview = async () => {
        const requestNumber = selected
        const result = await run('chapter-review', { number: requestNumber }, { silent: true })
        if (!result || Number(selectedRef.current) !== Number(requestNumber)) return
        try {
          setDetail(await fetchProjectChapter(root, requestNumber))
        } catch {
          // parent error state covers failures
        }
        if (result.continuity) {
          setContinuity({ ...result.continuity, ai: true })
          setContinuitySelected(
            (result.continuity.issues ?? [])
              .map((issue, index) => (issue.level !== 'note' && !isContinuityApplied(result.continuity, issue) ? index : -1))
              .filter((index) => index >= 0),
          )
        }
      }

      const runContinuity = async (ai = false) => {
        const requestNumber = selected
        const result = await run(ai ? 'continuity-audit' : 'continuity-check', { number: requestNumber }, { silent: true })
        if (!result || Number(selectedRef.current) !== Number(requestNumber)) return
        setContinuity({ ...result, ai })
        setContinuitySelected(
          (result.issues ?? [])
            .map((issue, index) => (issue.level !== 'note' && !isContinuityApplied(result, issue) ? index : -1))
            .filter((index) => index >= 0),
        )
      }

      const generateSummary = async () => {
        const requestNumber = selected
        const result = await run('summarize-chapter', { number: requestNumber }, { silent: true })
        if (!result || Number(selectedRef.current) !== Number(requestNumber)) return
        setDetail((prev) => (prev ? { ...prev, summary: result } : prev))
      }

      const continuityAllIssues = continuity?.issues ?? []
      const continuitySelectable = continuityAllIssues
        .map((issue, index) => ({ issue, index }))
        .filter((item) => item.issue.level !== 'note')
      const continuitySelectedIssues = continuitySelectable
        .filter((item) => continuitySelected.includes(item.index))
        .map((item) => item.issue)

      const toggleContinuityIssue = (index) => {
        setContinuitySelected((prev) => (
          prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]
        ))
      }

      const selectAllContinuity = () => setContinuitySelected(continuitySelectable.map((item) => item.index))
      const clearContinuitySelection = () => setContinuitySelected([])

      const fillContinuityInstruction = () => {
        if (continuitySelectedIssues.length === 0) {
          setToast('请先勾选要修订的问题')
          return
        }
        const lines = continuitySelectedIssues.map(
          (issue, index) => `${index + 1}. ${issue.message}${issue.advice ? `（建议：${issue.advice}）` : ''}`,
        )
        setInstruction((prev) => (prev.trim() ? `${prev}\n${lines.join('\n')}` : lines.join('\n')))
        setToast('已把选中项填入「本章/修订要求」输入框')
      }

      const reviseByContinuity = async () => {
        const issues = continuitySelectedIssues
        if (issues.length === 0) {
          setToast('请先勾选要修订的问题')
          return
        }
        if (!(await requestConfirm({ title: '按连续性意见修订', message: `将只按勾选的 ${issues.length} 条连续性问题修订本章，并生成新的修订版本（可回滚）。继续？`, confirmLabel: '修订' }))) return
        const instruction = [
          '请按以下连续性问题修订本章，保持文风、人设与已有情节事实：',
          ...issues.map((issue, index) => `${index + 1}. ${issue.message}${issue.advice ? `（建议：${issue.advice}）` : ''}`),
        ].join('\n')
        const keys = issues.map(continuityIssueKey)
        const result = await act('chapter-revise', { number: selected, instruction })
        if (!result) return
        const revision = result.revisionPath ?? result.path ?? null
        await run('continuity-mark', { number: selected, issues: keys, revision }, { silent: true }).catch(() => {})
        const applied = { ...(continuity?.applied ?? {}) }
        for (const key of keys) applied[key] = { at: new Date().toISOString(), revision }
        setContinuity((prev) => (prev ? { ...prev, applied } : prev))
        setContinuitySelected([])
        setToast(`已按 ${issues.length} 条意见修订；这些条目已标记为“已执行”`)
      }

      const loadContext = async () => {
        const requestNumber = selected
        setContextLoading(true)
        try {
          const preview = await fetchWritingContext(root, requestNumber)
          if (Number(selectedRef.current) === Number(requestNumber)) setContextPreview(preview)
        } catch (error) {
          setDetailError(String(error?.message ?? error))
        } finally {
          setContextLoading(false)
        }
      }

      const loadRevision = async (name) => {
        const requestNumber = selected
        setRevisionLoading(true)
        try {
          const revision = await fetchProjectRevision(root, requestNumber, name)
          if (Number(selectedRef.current) === Number(requestNumber)) setRevisionDetail(revision)
        } catch (error) {
          setDetailError(String(error?.message ?? error))
        } finally {
          setRevisionLoading(false)
        }
      }

      const writeNext = async () => {
        if (!nextChapter) return
        await run('chapter-draft', { number: nextChapter.number })
        setSelected(nextChapter.number)
      }

      const allOutlineChapters = (state.outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
      const foreshadowPlants = allOutlineChapters.flatMap((chapter) =>
        (chapter.foreshadow?.plant ?? []).map((text) => ({ chapter: Number(chapter.number), text: String(text) })),
      )
      const foreshadowPending = foreshadowPlants.filter((plant) =>
        !allOutlineChapters.some((chapter) =>
          Number(chapter.number) > plant.chapter &&
          (chapter.foreshadow?.payoff ?? []).some((text) => String(text).includes(plant.text.slice(0, Math.min(10, plant.text.length)))),
        ),
      )
      const chapterRuns = (state.recentRuns ?? [])
        .filter((run) => Number(run.number) === Number(selected))
        .slice(0, 3)

      return h('div', null,
        h(StepIntro, {
          eyebrow: '05 / 章节',
          title: '逐章写作与审阅',
          status: (state.stage?.chapters ?? 0) > 0 ? 'confirmed' : 'candidate',
          desc: '左边选章，右边阅读与操作；讨论只针对当前章，不会把正文塞进会话历史。',
          hints: ['生成草稿并自动跑规则质检', '按意见修订，旧稿进历史', '采纳为定稿并写状态快照'],
        }),
        chapters.length === 0
          ? h(EmptyState, { title: '还没有可写的章节', desc: '先在大纲里生成并确认章纲。' })
          : h('div', { className: 'nw-workbench', ref: workbenchRef },
              h('div', { className: 'nw-list', ref: listRef },
                volumes.length > 1
                  ? h('div', { style: { marginBottom: '8px' } },
                      h('select', {
                        className: 'nw-input',
                        style: { marginBottom: '4px' },
                        value: volumeFilter,
                        onChange: (event) => setVolumeFilter(event.target.value),
                        'aria-label': '按卷筛选',
                      },
                        h('option', { value: 'all' }, `全部卷 · ${allChapters.length} 章`),
                        volumes.map((volume) => h('option', { key: volume.id, value: volume.id }, `${volume.title} · ${Number(volume.chapterCount ?? volume.chapters) || 0} 章`)),
                      ),
                      volumeFilter !== 'all'
                        ? h('button', {
                            type: 'button',
                            className: 'nw-btn',
                            disabled: busy,
                            onClick: async () => {
                              const pending = chapters.filter((item) => item.hasDraft && !item.hasFinal)
                              if (pending.length === 0) return
                              if (!(await requestConfirm({
                                title: '定稿本卷',
                                message: `将本卷 ${pending.length} 章草稿采纳为定稿（会生成摘要）？`,
                                confirmLabel: '定稿',
                              }))) return
                              run('chapter-approve-volume', { volumeId: volumeFilter }, { toast: '本卷草稿已定稿' })
                            },
                          }, `定稿本卷草稿（${chapters.filter((item) => item.hasDraft && !item.hasFinal).length}）`)
                        : null,
                      volumeFilter !== 'all' && chapters.some((item) => !item.hasDraft)
                        ? h('button', {
                            type: 'button',
                            className: 'nw-btn',
                            style: { marginTop: '4px' },
                            disabled: busy,
                            onClick: async () => {
                              const pending = chapters.filter((item) => !item.hasDraft)
                              if (pending.length === 0) return
                              const outlineVolume = (state.outline?.volumes ?? []).find((volume) => volume.id === volumeFilter)
                              const pendingNumbers = new Set(pending.map((item) => Number(item.number)))
                              const blocked = (outlineVolume?.chapters ?? []).filter(
                                (chapter) => pendingNumbers.has(Number(chapter.number)) && chapter.status !== 'confirmed',
                              )
                              if (blocked.length) {
                                setToast(`第 ${blocked.slice(0, 5).map((chapter) => chapter.number).join('、')} 章章纲未确认，请先在大纲确认`)
                                return
                              }
                              const count = Math.min(pending.length, 10)
                              if (!(await requestConfirm({
                                title: '写本卷剩余章',
                                message: `从第 ${pending[0].number} 章开始，本轮最多生成 ${count} 章？需要这些章纲已确认。`,
                                confirmLabel: '开始写',
                              }))) return
                              run('chapter-batch', {
                                fromChapter: pending[0].number,
                                chapterCount: count,
                              }, { toast: '本卷续写已开始' })
                            },
                          }, `写本卷剩余（${chapters.filter((item) => !item.hasDraft).length}）`)
                        : null,
                    )
                  : null,
                chapters.map((item) => {
                  const targetWords = Number(state.style?.fields?.chapterWords ?? item.wordBudget ?? 0) || 0
                  const words = Number(item.wordCount) || 0
                  const pct = targetWords > 0 ? Math.min(100, Math.round((words / targetWords) * 100)) : 0
                  const statusLabel = item.status === 'needs-review' ? '待人工' : item.status === 'manual' ? '手动编辑' : item.hasFinal ? '定稿' : item.hasDraft ? '草稿' : '待写'
                  return h('button', {
                    key: item.number,
                    type: 'button',
                    className: `nw-list-item${Number(selected) === Number(item.number) ? ' active' : ''}`,
                    onClick: () => setSelected(item.number),
                  },
                    h('span', { className: 'nw-list-num' }, String(item.number).padStart(2, '0')),
                    h('span', { className: 'nw-list-main' },
                      h('span', { className: 'nw-list-title' }, `${volumeFilter === 'all' && item.volumeTitle ? `${item.volumeTitle} · ` : ''}${item.title}`),
                      h('span', { className: 'nw-list-meta' },
                        `${words > 0 ? `${words} 字` : '未写'} · ${statusLabel}`
                        + `${item.qaStatus === 'fail' ? ' · 规则未过' : ''}`
                        + `${item.styleScore != null ? ` · 风格 ${item.styleScore}` : ''}`),
                    ),
                    h('span', { className: 'nw-list-bar', title: targetWords > 0 ? `目标 ${targetWords} 字 · ${pct}%` : '' },
                      h('span', { style: { width: `${pct}%` } }),
                    ),
                    h('span', {
                      className: 'nw-list-hover',
                      role: 'button',
                      title: '在大纲中查看本章',
                      onClick: (event) => {
                        event.stopPropagation()
                        onOpenOutline?.(item.number)
                      },
                    }, '纲'),
                  )
                }),
              ),
              h('div', {
                key: `pane-${selected}`,
                className: 'nw-pane nw-pane-scroll',
                ref: paneRef,
                onScroll: (event) => {
                  scrollPositions.current[`${root}:${selected}`] = event.currentTarget.scrollTop
                },
              },
                h('div', { className: 'nw-chapter-sticky' },
                  h('div', { className: 'nw-sticky-head' },
                    h('div', { className: 'nw-sticky-title' },
                      h('span', { className: 'nw-eyebrow', style: { display: 'block' } }, `第 ${selected ?? '—'} 章`),
                      h('span', { className: 'nw-sticky-name' }, detail?.chapter?.title ?? current?.title ?? ''),
                      detail?.meta?.finalStale && hasFinal
                        ? h('span', { className: 'nw-badge bad', style: { marginTop: '3px' } }, '定稿待更新')
                        : null,
                    ),
                    h('select', {
                      className: 'nw-sticky-jump',
                      value: String(selected ?? ''),
                      title: '跳转章节',
                      onChange: (event) => setSelected(Number(event.target.value)),
                    }, allChapters.map((item) => h('option', { key: item.number, value: item.number }, `第 ${item.number} 章`))),
                    h('div', { className: 'nw-sticky-nav' },
                      previousChapter ? h('button', { type: 'button', className: 'nw-btn ghost icon', title: '上一章（Alt+←）', onClick: () => setSelected(previousChapter.number) }, '‹') : null,
                      nextChapter ? h('button', { type: 'button', className: 'nw-btn ghost icon', title: '下一章（Alt+→）', onClick: () => setSelected(nextChapter.number) }, '›') : null,
                    ),
                  ),
                  h('div', { className: 'nw-sticky-actions' },
                    hasDraft ? h('button', { type: 'button', className: 'nw-btn', disabled: busy || editing, title: '编辑正文（E）', onClick: startEditing }, editing ? '编辑中' : '编辑') : null,
                    h('button', { type: 'button', className: 'nw-btn ghost', title: '查看/编辑本章章纲', onClick: () => onOpenOutline?.(selected) }, '章纲'),
                    h('button', { type: 'button', className: 'nw-btn', title: '讨论（D）', onClick: openChapterDiscussion }, '讨论'),
                    hasDraft ? h('button', { type: 'button', className: 'nw-btn', disabled: busy || !instruction.trim(), title: '按下方修订要求修订本章', onClick: () => act('chapter-revise', { number: selected, instruction }) }, '按意见修订') : null,
                    hasDraft ? h('button', { type: 'button', className: 'nw-btn', disabled: busy, title: '一次跑规则质检、风格检测与 AI 连续性检查', onClick: runCombinedReview }, '审校') : null,
                    hasDraft ? h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: autoFixQa }, `修复 ${fixRounds} 轮`) : null,
                    hasDraft ? h('button', {
                      type: 'button',
                      className: 'nw-btn primary',
                      disabled: busy || qa?.status === 'fail',
                      title: qa?.status === 'fail'
                        ? `规则质检未通过：${(qa.issues ?? []).filter((issue) => issue.level === 'error').map((issue) => issue.message).join('；') || '见质检详情'}`
                        : '采纳为定稿',
                      onClick: () => act('chapter-approve', { number: selected }),
                    }, hasFinal ? '重新定稿' : '定稿') : null,
                    !hasDraft ? h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || detailLoading || detail?.chapter?.status !== 'confirmed', title: detail?.chapter?.status !== 'confirmed' ? '本章章纲尚未确认' : '生成本章草稿', onClick: () => act('chapter-draft', { number: selected, instruction: instruction || undefined }) }, busy ? '生成中…' : '生成草稿') : null,
                    ),
                  h('div', { className: 'nw-sticky-actions nw-sticky-extra' },
                        h('button', { type: 'button', className: 'nw-btn', disabled: contextLoading, onClick: loadContext }, contextLoading ? '读取…' : '上下文'),
                        hasDraft ? h('button', { type: 'button', className: 'nw-btn', disabled: busy || detail?.chapter?.status !== 'confirmed', title: detail?.chapter?.status !== 'confirmed' ? '本章章纲尚未确认' : '按当前章纲重新生成草稿', onClick: () => act('chapter-draft', { number: selected, instruction: instruction || undefined }) }, '重新生成草稿') : null,
                        hasDraft ? h('select', { className: 'nw-input', style: { width: '82px' }, value: polishMode, disabled: busy, onChange: (event) => setPolishMode(event.target.value) },
                          ['润色', '扩写', '缩写'].map((mode) => h('option', { key: mode, value: mode }, mode)),
                        ) : null,
                        hasDraft ? h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => polishChapter(polishMode) }, '润色') : null,
                        hasFinal && nextChapter ? h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: writeNext }, `生成下一章（第 ${nextChapter.number} 章）`) : null,
                        batchStart ? h('button', { type: 'button', className: 'nw-btn', disabled: busy || !batchReady, title: batchReady ? `从第 ${batchStart} 章连续生成 ${batchCount} 章` : `第 ${batchStart} 章章纲尚未确认，请先在大纲页确认`, onClick: batchWrite }, `连续写 ${batchCount} 章`) : null,
                        lastRewrite ? h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: undoRewrite }, '撤销重写') : null,
                        h('button', {
                          type: 'button',
                          className: `nw-btn ghost${mouseSelection ? '' : ' active'}`,
                          onClick: toggleMouseSelection,
                        }, mouseSelection ? '选段：开' : '选段：关'),
                        h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => paneRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, '回到顶部'),
                        hasFinal
                          ? h('button', {
                              type: 'button',
                              className: 'nw-btn ghost',
                              onClick: async () => {
                                const text = detail?.final ?? ''
                                if (!text) return
                                try {
                                  await navigator.clipboard.writeText(text)
                                  setToast('定稿已复制')
                                } catch {
                                  setToast('复制失败')
                                }
                              },
                            }, '复制定稿')
                          : null,
                        detail?.draft
                          ? h('button', {
                              type: 'button',
                              className: 'nw-btn ghost',
                              onClick: async () => {
                                const text = detail?.draft ?? ''
                                if (!text) return
                                try {
                                  await navigator.clipboard.writeText(text)
                                  setToast('草稿已复制')
                                } catch {
                                  setToast('复制失败')
                                }
                              },
                            }, '复制草稿')
                          : null,
                        (() => {
                          const lastNumber = allChapters.reduce((max, item) => Math.max(max, Number(item.number) || 0), 0)
                          return Number(selected) === lastNumber && lastNumber > 0
                            ? h('button', {
                                type: 'button',
                                className: 'nw-btn danger',
                                disabled: busy,
                                onClick: async () => {
                                  const preview = await run('chapters-delete-tail', { count: 1, dryRun: true }, { silent: true })
                                  if (!preview) return
                                  if (!(await requestConfirm({
                                    title: '删除本章',
                                    message: `将删除第 ${preview.from} 章（最后一章）的大纲，并同时删除它的正文、定稿、修订、摘要与状态快照，无法恢复。`,
                                    danger: true,
                                    confirmLabel: '删除',
                                  }))) return
                                  run('chapters-delete-tail', { count: 1 }, { toast: `已删除第 ${preview.from} 章` })
                                },
                              }, '删除本章（最后一章）')
                            : null
                        })(),
                  ),
                ),
                detail && detail.chapter?.status !== 'confirmed'
                  ? h('div', { className: 'nw-banner warn', style: { marginBottom: '10px' } },
                      h('span', { style: { flex: 1 } }, '本章章纲尚未确认，生成或重新生成草稿前需要先确认章纲。'),
                      h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: () => act('outline-commit', { fromChapter: selected, toChapter: selected }, { toast: '已确认本章章纲' }) }, '确认本章章纲'),
                    )
                  : null,
                detail?.outlineChanged
                  ? h('div', { className: 'nw-banner warn', style: { marginBottom: '10px' } },
                      h('span', { style: { flex: 1 } }, `本章章纲已更新，当前正文基于旧章纲${detail?.meta?.finalStale ? '；定稿也是旧版，重新生成后请重新定稿' : ''}。`),
                      h('button', { type: 'button', className: 'nw-btn', disabled: busy || detail?.chapter?.status !== 'confirmed', onClick: () => act('chapter-draft', { number: selected, instruction: instruction || undefined }) }, '按新章纲重新生成'),
                    )
                  : null,
                rewritePreview
                  ? h('div', { className: 'nw-modal-backdrop' },
                      h('div', { className: 'nw-modal' },
                        h('div', { className: 'nw-row' },
                          h('div', null,
                            h('div', { className: 'nw-eyebrow' }, '重写预览'),
                            h('h3', { className: 'nw-h3', style: { margin: 0 } }, `第 ${selected} 章${rewritePreview.range ? ` · 第 ${rewritePreview.range.fromParagraph}–${rewritePreview.range.toParagraph} 段` : ' · 整章'}`),
                          ),
                          h('span', { className: 'nw-muted' }, `${rewritePreview.wordCount ?? 0} 字`),
                        ),
                        h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '这是应用前的差异预览；可以逐块接受或拒绝，取消不会改动正文。'),
                        (() => {
                          const { hunks } = buildDiffHunks(rewritePreview.current ?? '', rewritePreview.nextText ?? '')
                          if (hunks.length === 0) return h('div', { className: 'nw-muted', style: { marginTop: '8px' } }, '没有检测到文本变化。')
                          return h('div', { className: 'nw-hunks' },
                            hunks.slice(0, 30).map((hunk) => {
                              const rejected = rejectedHunks.has(hunk.id)
                              return h('div', { key: hunk.id, className: `nw-hunk${rejected ? ' rejected' : ''}` },
                                h('div', { className: 'nw-hunk-head' },
                                  h('label', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
                                    h('input', {
                                      type: 'checkbox',
                                      checked: !rejected,
                                      onChange: () => {
                                        setRejectedHunks((prev) => {
                                          const next = new Set(prev)
                                          if (next.has(hunk.id)) next.delete(hunk.id)
                                          else next.add(hunk.id)
                                          return next
                                        })
                                      },
                                    }),
                                    `修改 ${hunk.id + 1}`,
                                  ),
                                  h('span', { className: 'nw-muted' }, `${hunk.del.length} 行删除 · ${hunk.add.length} 行新增`),
                                ),
                                h('div', { className: 'nw-hunk-body' },
                                  hunk.del.slice(0, 24).map((line, index) => h('div', { key: `d${index}`, className: 'nw-diff-line del' }, `- ${line}`)),
                                  hunk.add.slice(0, 24).map((line, index) => h('div', { key: `a${index}`, className: 'nw-diff-line add' }, `+ ${line}`)),
                                  hunk.del.length + hunk.add.length > 48 ? h('div', { className: 'nw-muted' }, '…') : null,
                                ),
                              )
                            }),
                            hunks.length > 30 ? h('div', { className: 'nw-muted' }, `还有 ${hunks.length - 30} 个修改块未显示，应用时仍按选择处理。`) : null,
                          )
                        })(),
                        h('div', { className: 'nw-actions', style: { justifyContent: 'flex-end' } },
                          h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => setRewritePreview(null) }, '取消'),
                          h('button', {
                            type: 'button',
                            className: 'nw-btn primary',
                            disabled: busy || rejectedHunks.size >= (buildDiffHunks(rewritePreview.current ?? '', rewritePreview.nextText ?? '').hunks.length),
                            onClick: applyRewritePreview,
                          }, `应用选中修改（${Math.max(0, buildDiffHunks(rewritePreview.current ?? '', rewritePreview.nextText ?? '').hunks.length - rejectedHunks.size)}）`),
                        ),
                      ),
                    )
                  : null,
                h('div', { className: 'nw-card' },
                  h('div', { className: 'nw-row' },
                    h('div', null,
                      h('div', { className: 'nw-eyebrow' }, `第 ${selected ?? '—'} 章`),
                      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                        h('h2', { className: 'nw-h2', style: { margin: 0 } }, detail?.chapter?.title ?? current?.title ?? ''),
                        qa ? h('span', { className: `nw-badge ${qa.status === 'pass' ? 'ok' : 'cur'}` }, `质检 ${displayStatus(qa.status)}`) : null,
                        styleQa ? h('span', { className: `nw-badge ${styleQa.status === 'pass' ? 'ok' : styleQa.status === 'warn' ? 'cur' : 'bad'}` }, `AI ${styleQa.score ?? '—'}`) : null,
                        detail?.meta?.status === 'manual' ? h('span', { className: 'nw-badge cur' }, '手动编辑') : null,
                        needsReview ? h('span', { className: 'nw-badge bad' }, '待人工') : null,
                        hasFinal ? h('span', { className: 'nw-badge ok' }, '已定稿') : null,
                      ),
                    ),
                  ),
                  h('div', { className: 'nw-field' },
                    h('label', { className: 'nw-label' }, '本章/修订要求（可留空）'),
                    h('textarea', { className: 'nw-textarea', value: instruction, disabled: busy, placeholder: '例如：开头更冷硬；压缩心理描写；加强章末钩子', onChange: (event) => setInstruction(event.target.value) }),
                    detail?.pendingInstruction
                      ? h('div', { className: 'nw-muted', style: { marginTop: '3px' } }, '已从讨论载入修订建议，可直接点「按意见修订」。')
                      : null,
                    instruction.trim()
                      ? h('div', { className: 'nw-actions', style: { marginTop: '4px' } },
                          h('button', {
                            type: 'button',
                            className: 'nw-btn ghost',
                            onClick: async () => {
                              try {
                                await navigator.clipboard.writeText(instruction)
                                setToast('修订要求已复制')
                              } catch {
                                setToast('复制失败')
                              }
                            },
                          }, '复制修订要求'),
                        )
                      : null,
                    h('div', { className: 'nw-muted', style: { marginTop: '4px', color: proseHighEffort ? 'var(--dsw-alias-state-warn-primary)' : undefined } },
                      `正文模型：${proseModelLabel} · 思考：${effortLabel(proseEffort) || '自动（低）'}${proseHighEffort ? ' · 建议改为关闭/低' : ''}`,
                    ),
                  ),
                  contextPreview
                    ? h('div', { className: 'nw-card', style: { marginTop: '10px', background: 'var(--dsw-alias-bg-layer-1)' } },
                        h('div', { className: 'nw-row' },
                          h('h3', { className: 'nw-h3' }, '本章上下文'),
                          h('span', { className: 'nw-muted' }, `约 ${contextPreview.context.meta?.estimatedTokens ?? 0} tokens · ${contextPreview.context.meta?.chars ?? 0} 字符`),
                          h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => setContextPreview(null) }, '关闭'),
                        ),
                        h('div', { className: 'nw-muted' },
                          `角色 ${contextPreview.context.meta?.counts?.characters ?? 0} · 规则 ${contextPreview.context.meta?.counts?.rules ?? 0} · 最近 ${contextPreview.context.meta?.counts?.recent ?? 0} 章 · 摘要 ${contextPreview.context.meta?.counts?.summaryHistory ?? 0} 条 · 相关摘要 ${contextPreview.context.meta?.counts?.relevantSummaries ?? 0} 条 · 上章结尾 ${contextPreview.context.meta?.counts?.previousTailChars ?? 0} 字 · 未回收伏笔 ${contextPreview.context.meta?.counts?.foreshadowing ?? 0} 条`,
                        ),
                        contextPreview.context.meta?.truncated
                          ? h('div', { className: 'nw-banner warn', style: { marginTop: '6px' } }, '上下文超出字符预算，已按优先级裁剪低价值条目。')
                          : null,
                        h('details', { className: 'nw-qa-details' },
                          h('summary', { className: 'nw-qa-summary-line' }, '展开完整上下文'),
                          h('pre', { className: 'nw-pre', style: { maxHeight: '260px' } }, JSON.stringify(contextPreview.context, null, 2)),
                        ),
                      )
                    : null,
                  needsReview
                    ? h('div', { className: 'nw-banner warn', style: { marginTop: '10px' } },
                        `${detail?.meta?.keptBest ? '已保留质检分数最高的版本；' : ''}自动修复后仍有 ${remainingIssues.length} 条问题，建议再点「多轮修复」继续，或手动改选中的段落。`,
                      )
                    : null,
                  lastRewrite
                    ? h('div', { className: 'nw-banner warn', style: { marginTop: '10px' } },
                        `已应用重写预览${lastRewrite.range ? `（第 ${lastRewrite.range.fromParagraph}–${lastRewrite.range.toParagraph} 段）` : ''}。`,
                        h('button', { type: 'button', className: 'nw-btn', style: { marginLeft: '8px' }, disabled: busy, onClick: undoRewrite }, '撤销本次重写'),
                      )
                    : null,
                  h('div', { className: 'nw-card nw-qa-card', style: { marginTop: '12px', marginBottom: 0, background: 'var(--dsw-alias-bg-layer-1)' } },
                    h('div', { className: 'nw-row', style: { alignItems: 'flex-start' } },
                      h('div', null,
                        h('div', { className: 'nw-eyebrow' }, '质检'),
                        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
                          h('span', { className: `nw-badge ${qa ? (qa.status === 'pass' ? 'ok' : qa.status === 'warn' ? 'cur' : 'bad') : ''}` }, qa ? `质检 ${displayStatus(qa.status)}` : '质检未检测'),
                          h('span', { className: `nw-badge ${styleQa ? (styleQa.status === 'pass' ? 'ok' : styleQa.status === 'warn' ? 'cur' : 'bad') : ''}` }, styleQa ? `AI ${styleQa.score ?? '—'}` : 'AI 未检测'),
                          needsReview ? h('span', { className: 'nw-badge bad' }, '待人工') : null,
                          h('span', { className: 'nw-muted' }, `${qa?.metrics?.chars ?? (text ? text.replace(/\s+/g, '').length : 0)} 字`),
                        ),
                      ),
                    ),
                    h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
                      `自动执行：${autoFixOn ? '开' : '关'} · 多轮修复 ${fixRounds} 轮 · 通过线 ${stylePassScore} 分（在项目设置里调整）`,
                    ),
                    h('details', { className: 'nw-qa-details' },
                      h('summary', { className: 'nw-qa-summary-line' },
                        `查看质检详情 · ${(qa?.issues?.length ?? 0) + (styleQa?.issues?.length ?? 0)} 条问题`,
                      ),
                      h('div', { className: 'nw-qa-grid' },
                      h('div', { className: 'nw-qa-block' },
                        h('div', { className: 'nw-qa-label' }, '规则质检'),
                        qa
                          ? h('div', { className: 'nw-qa-metrics' }, `${qa.metrics?.chars ?? 0} 字 · ${qa.metrics?.paragraphs ?? 0} 段 · 目标 ${qa.metrics?.targetWords ?? 0}`)
                          : h('div', { className: 'nw-muted' }, '还没有检测。'),
                        (qa?.issues ?? []).slice(0, 8).map((issue, index) => renderIssue(issue, index)),
                      ),
                      h('div', { className: 'nw-qa-block' },
                        h('div', { className: 'nw-qa-label' }, 'AI 风格'),
                        styleQa
                          ? h('div', { className: 'nw-qa-score' }, String(styleQa.score ?? '—'), h('span', null, '/100'))
                          : h('div', { className: 'nw-muted' }, '还没有检测。'),
                        styleQa?.summary ? h('div', { className: 'nw-muted', style: { marginTop: '2px' } }, styleQa.summary) : null,
                        styleQa?.llmError
                          ? h('div', { className: 'nw-muted', style: { marginTop: '2px', color: 'var(--dsw-alias-state-warn-primary)' } }, `LLM 审稿失败：${styleQa.llmError}`)
                          : null,
                        (styleQa?.issues ?? []).slice(0, 8).map((issue, index) => renderIssue(issue, index)),
                      ),
                    ),
                  ),
                ),
                  h('div', { className: 'nw-card', style: { marginTop: '12px', marginBottom: 0 } },
                    h('div', { className: 'nw-row' },
                      h('h3', { className: 'nw-h3' }, '能力变化'),
                      h('span', { className: 'nw-muted' }, `${powerChanges.length} 条`),
                    ),
                    powerChanges.length
                      ? h('div', { style: { marginTop: '4px' } },
                          powerChanges.map((change, index) => h('div', { key: index, className: 'nw-issue' }, h('span', null, change))),
                        )
                      : h('div', { className: 'nw-muted' }, '本章未登记能力变化。可在「设定 → 能力 → 按章能力变化」里补。'),
                  ),
                  ((detail?.chapter?.foreshadow?.payoff ?? []).length > 0 || foreshadowPending.length > 0)
                    ? h('div', { className: 'nw-card', style: { marginTop: '12px', marginBottom: 0 } },
                        h('div', { className: 'nw-row' },
                          h('h3', { className: 'nw-h3' }, '伏笔提醒'),
                          h('span', { className: 'nw-muted' }, `未回收 ${foreshadowPending.length} 条`),
                        ),
                        (detail?.chapter?.foreshadow?.payoff ?? []).length
                          ? h('div', { className: 'nw-issue' },
                              h('span', { className: 'nw-issue-dot pass' }),
                              h('span', { style: { flex: 1 } }, `本章应回收：${(detail.chapter.foreshadow.payoff ?? []).join('；')}`),
                            )
                          : null,
                        foreshadowPending.length
                          ? h('div', { style: { marginTop: '4px' } },
                              foreshadowPending.slice(-8).map((item, index) =>
                                h('div', { key: index, className: 'nw-issue' },
                                  h('span', { className: 'nw-issue-dot warn' }),
                                  h('button', { type: 'button', className: 'nw-issue-jump', onClick: () => onOpenOutline?.(item.chapter) }, `第 ${item.chapter} 章`),
                                  h('span', { style: { flex: 1 } }, item.text),
                                ),
                              ),
                            )
                          : null,
                      )
                    : null,
                  h('div', { className: 'nw-card', style: { marginTop: '12px', marginBottom: 0 } },
                    h('div', { className: 'nw-row' },
                      h('h3', { className: 'nw-h3' }, '连续性与摘要'),
                      continuity
                        ? h('span', { className: `nw-badge ${continuity.status === 'pass' ? 'ok' : continuity.status === 'warn' ? 'cur' : 'bad'}` },
                            continuity.ai ? `AI 检查 ${continuity.status === 'pass' ? '通过' : '有问题'}` : `本地检查 ${continuity.status === 'pass' ? '通过' : '注意'}`,
                          )
                        : null,
                    ),
                    h('p', { className: 'nw-muted' },
                      detail?.summary?.summary ?? detail?.meta?.summary ?? '还没有本章摘要；定稿时会自动生成，也可以现在补。',
                    ),
                    h('div', { className: 'nw-actions' },
                      h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: generateSummary }, detail?.summary?.summary ? '重新生成摘要' : '生成摘要'),
                      h('span', { className: 'nw-muted', style: { alignSelf: 'center' } }, '规则、风格与连续性统一走顶部「审校」'),
                    ),
                    continuitySelectable.length > 0
                      ? h('div', null,
                          h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
                            h('span', { className: 'nw-muted', style: { alignSelf: 'center' } }, `已勾选 ${continuitySelectedIssues.length} / ${continuitySelectable.length} 条`),
                            h('button', { type: 'button', className: 'nw-btn ghost', onClick: selectAllContinuity }, '全选'),
                            h('button', { type: 'button', className: 'nw-btn ghost', onClick: clearContinuitySelection }, '清空'),
                            h('button', {
                              type: 'button',
                              className: 'nw-btn primary',
                              disabled: busy || !hasDraft || continuitySelectedIssues.length === 0,
                              title: '只按勾选的条目修订，生成可回滚的新版本',
                              onClick: reviseByContinuity,
                            }, `按勾选的 ${continuitySelectedIssues.length} 条修订`),
                            h('button', {
                              type: 'button',
                              className: 'nw-btn',
                              disabled: busy || continuitySelectedIssues.length === 0,
                              title: '把勾选条目追加到「本章/修订要求」输入框，可先编辑再修订',
                              onClick: fillContinuityInstruction,
                            }, '填入修订要求'),
                          ),
                          h('details', { className: 'nw-qa-details' },
                            h('summary', { className: 'nw-qa-summary-line' }, '查看将发送的修订要求（未勾选的不含）'),
                            continuitySelectedIssues.length
                              ? h('pre', { className: 'nw-pre' }, continuitySelectedIssues.map((issue, index) => `${index + 1}. ${issue.message}${issue.advice ? `（建议：${issue.advice}）` : ''}`).join('\n'))
                              : h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '还没有勾选问题。'),
                          ),
                        )
                      : null,
                    continuity
                      ? h('div', { style: { marginTop: '8px' } },
                          continuity.issues?.length
                            ? continuity.issues.slice(0, 12).map((issue, index) =>
                                h('div', { key: index, className: 'nw-issue' },
                                  issue.level !== 'note'
                                    ? h('input', {
                                        type: 'checkbox',
                                        checked: continuitySelected.includes(index),
                                        title: '勾选后才会纳入本次修订',
                                        onChange: () => toggleContinuityIssue(index),
                                      })
                                    : h('span', { style: { width: '13px' } }),
                                  h('span', { className: `nw-issue-dot ${issue.level === 'error' ? 'error' : issue.level === 'note' ? 'pass' : 'warn'}` }),
                                  h('span', { style: { flex: 1 } },
                                    issue.message,
                                    issue.advice ? h('span', { className: 'nw-muted' }, ` · 建议：${issue.advice}`) : null,
                                  ),
                                  isContinuityApplied(continuity, issue)
                                    ? h('span', { className: 'nw-badge ok', title: '已按此条修订过' }, '已执行')
                                    : null,
                                  issue.chapter ? h('button', {
                                    type: 'button',
                                    className: 'nw-issue-jump',
                                    onClick: () => setSelected(issue.chapter),
                                  }, `第 ${issue.chapter} 章`) : null,
                                ),
                              )
                            : h('div', { className: 'nw-muted' }, '没有发现明显的连续性问题。'),
                        )
                      : null,
                  ),

                  chapterRuns.length
                    ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
                        '本章最近运行：',
                        chapterRuns.map((run) =>
                          h('button', {
                            key: run.runId,
                            type: 'button',
                            className: 'nw-btn ghost',
                            style: { marginLeft: '4px' },
                            onClick: async () => {
                              const detail = await run('run-detail', { runId: run.runId }, { silent: true })
                              if (detail) setRunDetail(detail)
                            },
                          }, `${kindLabel(run.kind)}${run.createdAt ? ` ${String(run.createdAt).slice(11, 16)}` : ''}`),
                        ),
                      )
                    : null,
                  runDetail ? h(RunDetailModal, { detail: runDetail, onClose: () => setRunDetail(null), setToast }) : null,
                  (detail?.revisions ?? []).length
                    ? h('div', { className: 'nw-card', style: { marginTop: '12px', marginBottom: 0, background: 'var(--dsw-alias-bg-layer-1)' } },
                        h('div', { className: 'nw-row' },
                          h('h3', { className: 'nw-h3' }, '修订历史'),
                          h('span', { className: 'nw-muted' }, `${detail.revisions.length} 个版本`),
                        ),
                        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
                          detail.revisions.slice(0, 10).map((name) =>
                            h('button', {
                              key: name,
                              type: 'button',
                              className: `nw-btn${revisionDetail?.name === name ? ' primary' : ''}`,
                              disabled: revisionLoading,
                              onClick: () => loadRevision(name),
                            }, name.replace(/\.md$/, '').replace(/^[a-z]+-/, '')),
                          ),
                        ),
                        revisionLoading ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '读取版本…') : null,
                        h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
                          h('button', {
                            type: 'button',
                            className: 'nw-btn ghost',
                            disabled: busy,
                            onClick: async () => {
                              const preview = await run('chapter-clear-revisions', { number: selected, keep: 5, dryRun: true }, { silent: true })
                              if (!preview) return
                              if (!preview.remove) {
                                setToast('没有需要清理的旧版本')
                                return
                              }
                              if (!(await requestConfirm({
                                title: '清理旧版本',
                                message: `将删除 ${preview.remove} 个旧版本（共 ${preview.total} 个，保留最近 5 个），删除后无法恢复。`,
                                danger: true,
                                confirmLabel: '清理',
                              }))) return
                              run('chapter-clear-revisions', { number: selected, keep: 5 }, { toast: '已清理旧版本' })
                            },
                          }, '清理旧版本（保留 5）'),
                        ),
                        revisionDetail
                          ? h('div', null,
                              h('div', { className: 'nw-row', style: { marginTop: '8px' } },
                                h('span', { className: 'nw-muted' }, `对比：${revisionDetail.name}`),
                                h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => act('chapter-restore', { number: selected, name: revisionDetail.name }) }, '恢复这个版本'),
                              ),
                              h('div', { className: 'nw-diff' },
                                diffLines(revisionDetail.text, revisionDetail.current).map((op, index) =>
                                  h('div', { key: index, className: `nw-diff-line ${op.type}` }, `${op.type === 'add' ? '+ ' : op.type === 'del' ? '- ' : '  '}${op.text}`),
                                ),
                              ),
                            )
                          : null,
                      )
                    : null,
                  detailLoading
                    ? h('div', { className: 'nw-empty' }, '读取章节…')
                    : detailError
                      ? h('div', { className: 'nw-banner warn', style: { marginTop: '12px' } }, detailError)
                      : editing
                        ? h('div', { className: 'nw-editor' },
                            h('div', { className: 'nw-row', style: { marginTop: '6px' } },
                              h('h3', { className: 'nw-h3' }, '手动编辑正文'),
                              h('span', { className: 'nw-muted' }, `${draftText.replace(/\s+/g, '').length} 字`),
                            ),
                            h('div', { className: 'nw-actions' },
                              h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !draftText.trim(), onClick: saveManual }, '保存正文'),
                              h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => setEditing(false) }, '取消'),
                              h('span', { className: 'nw-muted', style: { alignSelf: 'center' } }, 'Ctrl/Cmd+S 保存；会归档旧稿并清空旧质检'),
                            ),
                            h('textarea', {
                              className: 'nw-editor-textarea',
                              value: draftText,
                              onChange: (event) => setDraftText(event.target.value),
                              onKeyDown: (event) => {
                                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                                  event.preventDefault()
                                  saveManual()
                                }
                              },
                            }),
                          )
                        : text
                          ? h('div', { className: 'nw-reading' },
                            h('div', { className: 'nw-row', style: { marginTop: '6px' } },
                              h('h3', { className: 'nw-h3' }, hasFinal ? '定稿 / 当前草稿' : '当前草稿'),
                              detail?.revisions?.length ? h('span', { className: 'nw-muted' }, `修订历史 ${detail.revisions.length}`) : null,
                            ),
                            h('div', { className: `nw-selbar${rangeStart != null ? ' active' : ''}` },
                              h('div', { style: { minWidth: 0 } },
                                h('div', { className: 'nw-selbar-title' }, rangeStart != null ? `已选第 ${rangeStart + 1}–${rangeEnd + 1} 段` : '局部重写'),
                                h('div', { className: 'nw-muted' }, rangeStart != null ? '只重写选中范围，其余段落保留' : mouseSelection ? '点第一段，再点另一段选择范围' : '鼠标选段已关闭；可用精确段号，或点右上「选段：关」开启'),
                              ),
                              h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                                rangeStart != null ? h('span', { className: 'nw-muted' }, '用下方浮动条重写') : null,
                                h('button', { type: 'button', className: 'nw-btn ghost', onClick: toggleMouseSelection }, mouseSelection ? '鼠标选段：开' : '鼠标选段：关'),
                                h('details', { className: 'nw-more' },
                                  h('summary', { className: 'nw-btn ghost' }, '精确段号'),
                                  h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } },
                                    h('input', { className: 'nw-input', type: 'number', min: '1', placeholder: '起', value: fromParagraph, style: { width: '74px' }, onChange: (event) => setFromParagraph(event.target.value) }),
                                    h('span', { className: 'nw-muted' }, '至'),
                                    h('input', { className: 'nw-input', type: 'number', min: '1', placeholder: '止', value: toParagraph, style: { width: '74px' }, onChange: (event) => setToParagraph(event.target.value) }),
                                    h('button', {
                                      type: 'button',
                                      className: 'nw-btn',
                                      disabled: busy || !Number(fromParagraph) || !Number(toParagraph),
                                      onClick: () => {
                                        const start = Math.max(0, Math.min(Number(fromParagraph), Number(toParagraph)) - 1)
                                        const end = Math.max(0, Math.max(Number(fromParagraph), Number(toParagraph)) - 1)
                                        setSelStart(start)
                                        setSelEnd(end)
                                        setFromParagraph(String(start + 1))
                                        setToParagraph(String(end + 1))
                                      },
                                    }, '选定'),
                                  ),
                                ),
                              ),
                            ),
                            h('div', { className: 'nw-manuscript' },
                              paragraphs.map((paragraph, index) =>
                                h('p', {
                                  key: index,
                                  'data-para': index,
                                  className: selStart != null && selEnd != null && index >= selStart && index <= selEnd ? 'selected' : selStart != null && selEnd == null && index === selStart ? 'selected' : '',
                                  onClick: () => selectParagraph(index),
                                }, paragraph),
                              ),
                            ),
                            rangeStart != null
                              ? h('div', { className: 'nw-sel-float' },
                                  h('span', { className: 'nw-sel-float-info' }, `已选第 ${rangeStart + 1}–${rangeEnd + 1} 段`),
                                  h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || previewLoading, onClick: rewriteSelection }, previewLoading ? '生成预览…' : '预览重写'),
                                  h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: clearSelection }, '取消'),
                                )
                              : null,
                          )
                        : h('div', { className: 'nw-empty', style: { marginTop: '12px' } }, '还没有正文。点上面的「生成本章草稿」。'),
                ),
              ),
            ),
      )
    }

    function WritingButton(props) {
      const sessionId = props?.sessionId
      const [visible, setVisible] = useState(false)
      useEffect(() => {
        let alive = true
        if (!sessionId) { setVisible(false); return undefined }
        fetchState(sessionId)
          .then((state) => { if (alive) setVisible(Boolean(state.initialized || state.preset === 'novel-writer')) })
          .catch(() => { if (alive) setVisible(false) })
        return () => { alive = false }
      }, [sessionId])
      if (!sessionId || !visible) return null
      return h('button', {
        type: 'button',
        className: 'nw-btn',
        title: '在右侧打开写作台',
        onClick: () => { if (rightController) rightController.openTab(TAB_KIND) },
      }, h(BookIcon), '写作台')
    }

    const STEP_LABELS = { project: '项目', premise: '构思', style: '文风', bible: '设定', outline: '大纲', chapters: '章节' }
    const TEMPLATE_GROUPS = {
      'fast-web': 3,
      literary: 2,
      suspense: 3,
      daily: 4,
      ancient: 1,
      guqing: 1,
      'wuxia-hard': 1,
    }
    const TEMPLATE_GROUP_LABELS = { 1: '古风', 2: '通用', 3: '悬疑/网文', 4: '现代', 5: '自定义' }
    const templateGroupOrder = (template) =>
      String(template.id ?? '').startsWith('user-') ? 5 : (TEMPLATE_GROUPS[template.id] ?? 2)

    const KIND_LABELS = {
      'premise.candidates': '构思候选',
      'inspiration.generate': '灵感',
      'deconstruct.analyze': '拆书',
      'bible.generate': '生成设定',
      'bible.generate.missing': '补全设定',
      'chapter.style-audit': '风格审稿',
      'chapter.qa-fix': '质检修复',
      'chapter.draft': '生成草稿',
      'chapter.manual': '手动编辑',
      'chapter.summary': '章节摘要',
      'chapter.continuity': '连续性检查',
      'outline.audit': '大纲审查',
      'outline.repair': '大纲修复',
      'discussion.reply': '讨论',
      'discussion.reply.stream': '讨论（流式）',
      'model.empty': '空响应',
    }
    const kindLabel = (kind) => KIND_LABELS[kind] ?? kind ?? '—'

    const TASK_ACTION_LABELS = {
      'chapter-draft': '生成草稿',
      'chapter-revise': '按意见修订',
      'chapter-rewrite-preview': '生成重写预览',
      'chapter-fix': '单轮修复',
      'chapter-autofix': '多轮修复',
      'chapter-audit': '规则质检',
      'chapter-review': '统一审校',
      'chapter-style-audit': '风格审稿',
      'chapter-approve': '定稿',
      'summarize-chapter': '生成摘要',
      'summarize-missing': '补全摘要',
      'continuity-check': '连续性检查',
      'continuity-audit': 'AI 连续性检查',
      'volume-create': '新建卷',
      'volume-update': '更新卷',
      'volume-delete': '删除卷',
      'chapter-move': '移动章节',
      'snapshot-create': '创建项目快照',
      'restore-snapshot': '恢复项目快照',
      'discussion-undo': '撤销讨论应用',
      'discussion-applies-clear': '清理讨论应用历史',
      'chapter-batch': '连续写章',
      'chapter-restore': '恢复版本',
      'chapter-save-text': '保存正文',
      'outline-generate': '生成章纲',
      'outline-regenerate': '重生成章纲',
      'outline-commit': '确认章纲',
      'outline-audit': '大纲审查',
      'outline-repair': '大纲修复',
      'premise-chat-save': '保存构思对话',
      'premise-restore-batch': '恢复候选批次',
      'bible-generate': '生成设定',
      'bible-commit': '确认设定',
      'premise-candidates': '生成构思',
      'premise-commit': '确认构思',
      'style-apply': '套用文风',
      'style-commit': '确认文风',
      'discussion': '讨论',
      'export-manuscript': '导出',
      'import-manuscript': '导入',
    }

    function taskLabel(action, params = {}) {
      const number = Number(params?.number ?? params?.fromChapter)
      const label = TASK_ACTION_LABELS[action] ?? action
      return Number.isFinite(number) && number > 0 ? `第 ${number} 章 · ${label}` : label
    }

    function flattenOutline(outline) {
      return (outline?.volumes ?? []).flatMap((volume) =>
        (volume.chapters ?? []).map((chapter) => ({
          ...chapter,
          volumeId: chapter.volumeId ?? volume.id,
          volumeTitle: volume.title,
        })),
      )
    }

    const STAGE_LABELS = {
      queued: '排队',
      start: '启动',
      context: '组装上下文',
      generating: '生成',
      writing: '生成正文',
      preview: '生成预览',
      saving: '写入',
      qa: '规则质检',
      auditing: '风格审稿',
      summary: '生成摘要',
      fixing: '修复',
      done: '完成',
    }
    const NEXT_LABELS = { init: '初始化项目', premise: '确认构思', style: '确认文风', bible: '确认设定', outline: '生成并确认章纲', draft: '生成章节草稿（下一步）' }
    const MODEL_TASKS = [
      { id: 'premise', label: '构思' },
      { id: 'bible', label: '设定' },
      { id: 'outline', label: '章纲' },
      { id: 'draft', label: '正文草稿', prose: true },
      { id: 'revise', label: '正文修订', prose: true },
      { id: 'fix', label: '质检修复', prose: true },
      { id: 'audit', label: '风格审稿' },
      { id: 'discussion', label: '讨论' },
      { id: 'summary', label: '章节摘要' },
      { id: 'continuity', label: '连续性检查' },
    ]

    const STATUS_LABELS = {
      confirmed: '已确认',
      candidate: '待确认',
      missing: '未设置',
      approved: '已定稿',
      revised: '已修订',
      'needs-review': '待人工',
      manual: '手动编辑',
      drafted: '草稿',
      draft: '草稿',
      planned: '待写',
      pass: '通过',
      warn: '注意',
      fail: '未通过',
      running: '进行中',
      pending: '待处理',
    }

    function displayStatus(status) {
      if (status === undefined || status === null || status === '') return ''
      return STATUS_LABELS[String(status)] ?? String(status)
    }

    const EFFORT_LABELS = { off: '关闭', low: '低', medium: '中', high: '高', max: '最高', xhigh: '极高' }

    function effortLabel(effort) {
      if (effort === undefined || effort === null || effort === '') return ''
      return EFFORT_LABELS[String(effort)] ?? String(effort)
    }

    function statusClass(status) {
      if (status === 'confirmed') return 'ok'
      if (status === 'candidate') return 'cur'
      if (status === 'stale') return 'bad'
      return ''
    }

    function stepStatus(state, id) {
      if (!state) return ''
      if (id === 'project') return state.initialized ? 'confirmed' : 'candidate'
      if (!state.initialized) return ''
      if (id === 'premise') return state.stage?.premise ?? ''
      if (id === 'style') return state.stage?.style ?? ''
      if (id === 'bible') return state.stage?.bible ?? ''
      if (id === 'outline') return state.stage?.outline === 'confirmed' ? 'confirmed' : 'candidate'
      if (id === 'chapters') return (state.stage?.chapters ?? 0) > 0 ? 'confirmed' : ''
      return ''
    }

    function defaultTab(state) {
      if (!state?.initialized) return 'project'
      const next = state.workflow?.next
      if (next === 'premise') return 'premise'
      if (next === 'style') return 'style'
      if (next === 'bible') return 'bible'
      if (next === 'outline') return 'outline'
      if (next === 'draft') return 'chapters'
      return 'project'
    }

    function InitView({ state, run, busy }) {
      return h('div', null,
        h(StepIntro, {
          eyebrow: 'Start',
          title: '建立你的写作项目',
          desc: '把当前目录变成一个可长期维护的小说项目：构思、文风、章纲和后续草稿都会有自己的位置。',
        }),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '初始化将创建'),
          h('p', { className: 'nw-p' }, '初始化会创建 story/ 目录与项目标识，之后每一步都会成为可回到的固定流程。'),
          h('div', { className: 'nw-muted', style: { wordBreak: 'break-all' } }, state.cwd),
          h('ul', { className: 'nw-guide' },
            h('li', null, '将创建：项目标识、构思、文风契约、章纲、设定索引、状态快照'),
            h('li', null, '已存在的文件不会被覆盖；可以重复执行'),
            h('li', null, '初始化后，写作台会记住这个工作区'),
          ),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary block', disabled: busy, onClick: () => run('init', {}, { toast: '写作项目已初始化' }) },
              busy ? '初始化中…' : '初始化写作项目'),
          ),
        ),
      )
    }

    const PROMPT_PROSE_TASKS = ['draft', 'revise', 'fix']

    function normalizePromptDraft(config) {
      const source = config && typeof config === 'object' ? config : {}
      return {
        enabled: Boolean(source.enabled),
        position: source.position === 'prefix' ? 'prefix' : 'suffix',
        tasks: Array.isArray(source.tasks) ? source.tasks : [...PROMPT_PROSE_TASKS],
        text: typeof source.text === 'string' ? source.text : '',
      }
    }

    function SystemPromptsEditor({ state, run, busy, setToast }) {
      const catalog = state.promptCatalog?.prompts ?? []
      const [values, setValues] = useState({})
      const [importOpen, setImportOpen] = useState(false)
      const [importText, setImportText] = useState('')
      useEffect(() => {
        const next = {}
        for (const entry of catalog) next[entry.key] = entry.content ?? ''
        setValues(next)
      }, [catalog.map((entry) => `${entry.key}:${entry.hash}`).join(',')])
      const exportPrompts = async () => {
        const data = await run('prompt-catalog-export', {}, { silent: true })
        if (!data) return
        try {
          await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
          setToast?.('提示词包已复制到剪贴板')
        } catch {
          setToast?.('复制失败，可从运行日志查看导出内容')
        }
      }
      const importPrompts = async () => {
        let data = null
        try {
          data = JSON.parse(importText)
        } catch {
          setToast?.('导入失败：不是有效 JSON')
          return
        }
        const result = await run('prompt-catalog-import', { data }, { toast: '提示词包已导入' })
        if (result) {
          setImportOpen(false)
          setImportText('')
        }
      }
      return h('div', { className: 'nw-card' },
        h('div', { className: 'nw-row' },
          h('h3', { className: 'nw-h3' }, '提示词模板'),
          h('div', { className: 'nw-actions', style: { margin: 0 } },
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: exportPrompts }, '导出提示词包'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => setImportOpen(true) }, '导入提示词包'),
          ),
        ),
        h('p', { className: 'nw-muted' }, '每个模板显示默认/已覆盖状态；可单独保存或恢复默认。留空恢复内置默认。'),
        catalog.length === 0
          ? h('p', { className: 'nw-muted' }, '当前没有可用的提示词目录，刷新项目状态后再试。')
          : catalog.map((entry) =>
              h('details', { key: entry.key, className: 'nw-card', style: { marginTop: '8px' }, open: entry.customized },
                h('summary', { className: 'nw-qa-summary-line' },
                  `${entry.label} · ${entry.category}`,
                  entry.customized ? h('span', { className: 'nw-badge ok', style: { marginLeft: '6px' } }, '已覆盖') : null,
                ),
                h('p', { className: 'nw-muted', style: { marginTop: '6px' } }, entry.description ?? ''),
                h('textarea', {
                  className: 'nw-textarea',
                  style: { minHeight: '110px', marginTop: '6px' },
                  value: values[entry.key] ?? '',
                  disabled: busy,
                  placeholder: '留空使用内置默认',
                  onChange: (event) => setValues((prev) => ({ ...prev, [entry.key]: event.target.value })),
                }),
                h('div', { className: 'nw-actions' },
                  h('button', {
                    type: 'button',
                    className: 'nw-btn primary',
                    disabled: busy,
                    onClick: () => run('prompt-catalog-save', { key: entry.key, content: values[entry.key] ?? '' }, { toast: `${entry.label}已保存` }),
                  }, '保存这条'),
                  h('button', {
                    type: 'button',
                    className: 'nw-btn',
                    disabled: busy || !entry.customized,
                    onClick: () => run('prompt-catalog-reset', { key: entry.key }, { toast: `${entry.label}已恢复默认` }),
                  }, '恢复默认'),
                ),
                entry.customized
                  ? h('details', { style: { marginTop: '6px' } },
                      h('summary', { className: 'nw-qa-summary-line' }, '查看内置默认'),
                      h('pre', { className: 'nw-pre', style: { maxHeight: '180px', overflow: 'auto' } }, entry.default),
                    )
                  : null,
              ),
            ),
        importOpen
          ? h('div', { className: 'nw-modal-backdrop', onClick: () => setImportOpen(false) },
              h('div', { className: 'nw-modal', onClick: (event) => event.stopPropagation() },
                h('div', { className: 'nw-eyebrow' }, '导入提示词包'),
                h('p', { className: 'nw-muted' }, '粘贴导出的 JSON；只导入已知模板 key，未知 key 会忽略。'),
                h('textarea', {
                  className: 'nw-textarea',
                  style: { minHeight: '220px', marginTop: '8px' },
                  value: importText,
                  onChange: (event) => setImportText(event.target.value),
                }),
                h('div', { className: 'nw-actions', style: { justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'nw-btn', onClick: () => setImportOpen(false) }, '取消'),
                  h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !importText.trim(), onClick: importPrompts }, '导入'),
                ),
              ),
            )
          : null,
      )
    }

    function StructureStats({ state }) {
      const chapters = state.chapters ?? []
      const volumes = state.outline?.volumes ?? []
      const castCount = new Map()
      const plants = []
      const payoffs = []
      for (const volume of volumes) {
        for (const chapter of volume.chapters ?? []) {
          for (const name of chapter.cast ?? []) castCount.set(name, (castCount.get(name) ?? 0) + 1)
          for (const text of chapter.foreshadow?.plant ?? []) plants.push({ chapter: Number(chapter.number), text: String(text) })
          for (const text of chapter.foreshadow?.payoff ?? []) payoffs.push({ chapter: Number(chapter.number), text: String(text) })
        }
      }
      const topCast = [...castCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      const paid = plants.filter((plant) =>
        payoffs.some((payoff) => payoff.chapter > plant.chapter && payoff.text.includes(plant.text.slice(0, Math.min(10, plant.text.length)))),
      )
      const rate = plants.length ? Math.round((paid.length / plants.length) * 100) : 0
      const volumeStats = volumes.map((volume) => {
        const numbers = new Set((volume.chapters ?? []).map((chapter) => Number(chapter.number)))
        const words = chapters
          .filter((chapter) => numbers.has(Number(chapter.number)))
          .reduce((sum, chapter) => sum + (Number(chapter.wordCount) || 0), 0)
        return { title: volume.title, count: numbers.size, words }
      })
      return h('div', { className: 'nw-card' },
        h('h3', { className: 'nw-h3' }, '结构统计'),
        h('div', { className: 'nw-muted', style: { marginTop: '4px' } },
          `伏笔回收率 ${rate}%（${paid.length}/${plants.length}）`),
        h('div', { className: 'nw-muted', style: { marginTop: '4px' } },
          volumeStats.length
            ? volumeStats.map((item) => `${item.title || '未命名卷'}：${item.count} 章 / ${item.words} 字`).join('；')
            : '还没有卷'),
        h('div', { style: { marginTop: '6px' } },
          h('div', { className: 'nw-result-label' }, '出场 Top'),
          topCast.length
            ? topCast.map(([name, count]) => h('div', { key: name, className: 'nw-result-item' }, `· ${name}：${count} 章`))
            : h('div', { className: 'nw-muted' }, '还没有章纲。'),
        ),
      )
    }

    function HealthCheck({ state, goTo, run, busy }) {
      const bible = state.bible ?? {}
      const chapters = (state.outline?.volumes ?? []).flatMap((volume) => volume.chapters ?? [])
      const chapterStats = state.chapters ?? []
      const relations = state.relations?.relations ?? []
      const names = new Set((bible.characters ?? []).map((character) => character.name))
      const issues = []
      const unconfirmed = chapters.filter((chapter) => chapter.status !== 'confirmed')
      if (unconfirmed.length) {
        issues.push({
          level: 'warn',
          message: `${unconfirmed.length} 章章纲未确认（第 ${unconfirmed.slice(0, 8).map((chapter) => chapter.number).join('、')} 章）`,
          tab: 'outline',
        })
      }
      const missingFields = chapters.filter((chapter) =>
        ['goal', 'conflict', 'turn', 'outcome', 'hook'].some((key) => !String(chapter[key] ?? '').trim()),
      )
      if (missingFields.length) {
        issues.push({ level: 'warn', message: `${missingFields.length} 章章纲缺必填字段（goal/conflict/turn/outcome/hook）`, tab: 'outline' })
      }
      const drafted = chapterStats.filter((item) => item.hasDraft && !item.hasFinal)
      const staleFinals = chapterStats.filter((item) => item.hasFinal && item.finalStale)
      if (staleFinals.length) {
        issues.push({
          level: 'note',
          message: `${staleFinals.length} 章定稿落后于草稿（定稿待更新）`,
          tab: 'chapters',
        })
      }
      if (drafted.length) {
        issues.push({ level: 'note', message: `${drafted.length} 章有草稿未定稿`, tab: 'chapters' })
      }
      const badRelations = relations.filter((relation) => !names.has(relation.from) || !names.has(relation.to))
      if (badRelations.length) {
        issues.push({ level: 'warn', message: `${badRelations.length} 条关系引用了不存在的角色`, tab: 'bible' })
      }
      const overWords = chapterStats.filter((item) => {
        const chapter = chapters.find((entry) => Number(entry.number) === Number(item.number))
        const target = Number(chapter?.wordBudget ?? 0)
        return target > 0 && Number(item.wordCount) > target * 1.45
      })
      if (overWords.length) {
        issues.push({ level: 'note', message: `${overWords.length} 章字数超目标 45%`, tab: 'chapters' })
      }
      const noSummary = chapterStats.filter((item) => item.hasDraft && !String(item.summary ?? '').trim())
      if (noSummary.length) {
        issues.push({ level: 'note', message: `${noSummary.length} 章有草稿但没有摘要`, tab: 'chapters' })
      }
      const latest = chapters.reduce((max, chapter) => Math.max(max, Number(chapter.number) || 0), 0)
      const plants = []
      const payoffs = []
      for (const chapter of chapters) {
        for (const text of chapter.foreshadow?.plant ?? []) plants.push({ chapter: Number(chapter.number), text: String(text) })
        for (const text of chapter.foreshadow?.payoff ?? []) payoffs.push({ chapter: Number(chapter.number), text: String(text) })
      }
      const staleForeshadow = plants.filter((plant) =>
        !payoffs.some((payoff) => payoff.chapter > plant.chapter && payoff.text.includes(plant.text.slice(0, Math.min(10, plant.text.length)))) &&
        latest - plant.chapter > 8,
      )
      if (staleForeshadow.length) {
        issues.push({
          level: 'warn',
          message: `${staleForeshadow.length} 条伏笔超过 8 章未回收（第 ${[...new Set(staleForeshadow.map((plant) => plant.chapter))].slice(0, 8).join('、')} 章埋设）`,
          tab: 'bible',
        })
      }
      issues.sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1))
      const displayIssues = Array.isArray(state.health?.issues) ? state.health.issues : issues
      const healthError = state.health?.error ?? null
      const orphansIssue = displayIssues.find((issue) => issue.key === 'orphans') ?? null
      return h('div', { className: 'nw-card' },
        h('div', { className: 'nw-row' },
          h('h3', { className: 'nw-h3' }, '数据健康'),
          h('span', { className: `nw-badge ${displayIssues.some((issue) => issue.level === 'warn') ? 'cur' : 'ok'}` },
            displayIssues.length ? `${displayIssues.length} 项` : '正常'),
        ),
        healthError
          ? h('div', { className: 'nw-banner warn', style: { marginTop: '6px' } }, `健康检查失败：${healthError}`)
          : null,
        displayIssues.length
          ? h('div', { style: { marginTop: '6px' } },
              displayIssues.map((issue, index) =>
                h('div', { key: index, className: 'nw-issue' },
                  h('span', { className: `nw-issue-dot ${issue.level === 'warn' ? 'warn' : 'pass'}` }),
                  h('span', { style: { flex: 1 } }, issue.message),
                  h('button', { type: 'button', className: 'nw-issue-jump', onClick: () => goTo?.(issue.tab) }, '去处理'),
                ),
              ),
            )
          : h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '没有发现明显问题。'),
        noSummary.length
          ? h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
              h('button', {
                type: 'button',
                className: 'nw-btn',
                disabled: busy,
                onClick: () => run('summarize-missing', {}, { toast: '已补全缺失摘要' }),
              }, `补全缺失摘要（${noSummary.length}）`),
            )
          : null,
        drafted.length
          ? h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
              h('button', {
                type: 'button',
                className: 'nw-btn',
                disabled: busy,
                onClick: async () => {
                  if (!(await requestConfirm({
                    title: '批量定稿',
                    message: `将 ${drafted.length} 章草稿采纳为定稿（会逐章生成摘要，可能较慢）？`,
                    confirmLabel: '开始定稿',
                  }))) return
                  run('chapter-approve-all', {}, { toast: '已批量定稿' })
                },
              }, `批量定稿（${drafted.length}）`),
            )
          : null,
        badRelations.length
          ? h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
              h('button', {
                type: 'button',
                className: 'nw-btn danger',
                disabled: busy,
                onClick: async () => {
                  if (!(await requestConfirm({
                    title: '清理坏关系',
                    message: `删除 ${badRelations.length} 条引用不存在角色的关系？`,
                    danger: true,
                  }))) return
                  const clean = relations.filter((relation) => names.has(relation.from) && names.has(relation.to))
                  run('relations-save', {
                    relations: clean,
                    positions: state.relations?.positions ?? {},
                  }, { toast: '已清理坏关系' })
                },
              }, `清理坏关系（${badRelations.length}）`),
            )
          : null,
        staleFinals.length
          ? h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
              h('button', {
                type: 'button',
                className: 'nw-btn',
                disabled: busy,
                onClick: async () => {
                  if (!(await requestConfirm({
                    title: '刷新过期定稿',
                    message: `第 ${staleFinals.slice(0, 8).map((item) => item.number).join('、')} 章定稿落后于草稿，重新采纳为定稿？`,
                    confirmLabel: '刷新',
                  }))) return
                  run('chapter-approve-stale', {}, { toast: '已刷新过期定稿' })
                },
              }, `刷新过期定稿（${staleFinals.length}）`),
            )
          : null,
        orphansIssue
          ? h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
              h('button', {
                type: 'button',
                className: 'nw-btn danger',
                disabled: busy,
                onClick: async () => {
                  if (!(await requestConfirm({
                    title: '清理孤立文件',
                    message: `删除 ${orphansIssue.count} 个孤立章节目录/状态文件？`,
                    danger: true,
                  }))) return
                  run('clean-orphans', {}, { toast: '孤立文件已清理' })
                },
              }, `清理孤立文件（${orphansIssue.count}）`),
            )
          : null,
        state.health?.generatedAt
          ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, `检查于 ${String(state.health.generatedAt).slice(11, 16)}`)
          : null,
        unconfirmed.length
          ? h('div', { className: 'nw-actions', style: { marginTop: '6px' } },
              h('button', {
                type: 'button',
                className: 'nw-btn',
                disabled: busy,
                onClick: async () => {
                  if (!(await requestConfirm({
                    title: '确认章纲',
                    message: `确认全部 ${unconfirmed.length} 章待确认章纲？`,
                    confirmLabel: '确认',
                  }))) return
                  run('outline-commit', {}, { toast: '章纲已确认' })
                },
              }, `确认全部章纲（${unconfirmed.length}）`),
            )
          : null,
      )
    }

    function ProjectView({ state, run, busy, catalog, goTo, setToast }) {
      const [title, setTitle] = useState(state.project?.title ?? '')
      const [writingNotes, setWritingNotes] = useState(state.project?.writingNotes ?? '')
      const [writingTasks, setWritingTasks] = useState(state.project?.writingNotesTasks ?? [])
      const [automation, setAutomation] = useState(state.project?.automation ?? {})
      const [models, setModels] = useState(state.project?.models ?? {})
      const [contextConfig, setContextConfig] = useState(state.project?.context ?? {})
      const [exportPath, setExportPath] = useState(null)
      const [searchQuery, setSearchQuery] = useState('')
      const [searchResults, setSearchResults] = useState(null)
      const [searching, setSearching] = useState(false)
      const [showUninit, setShowUninit] = useState(false)
      const [uninitBusy, setUninitBusy] = useState(false)
      const [manualCopied, setManualCopied] = useState(false)
      const [promptScope, setPromptScope] = useState('project')
      const [promptDraft, setPromptDraft] = useState(() => normalizePromptDraft(state?.promptInjection?.project))
      useEffect(() => {
        setTitle(state.project?.title ?? '')
        setAutomation(state.project?.automation ?? {})
        setModels(state.project?.models ?? {})
        setContextConfig(state.project?.context ?? {})
      }, [state.project?.updatedAt])
      useEffect(() => {
        setPromptDraft(normalizePromptDraft(state?.promptInjection?.[promptScope]))
      }, [state?.promptInjection, promptScope])
      const switchPromptScope = (scope) => {
        setPromptScope(scope)
        setPromptDraft(normalizePromptDraft(state?.promptInjection?.[scope]))
      }
      const updatePrompt = (patch) => setPromptDraft((prev) => ({ ...prev, ...patch }))
      const savePrompt = async () => {
        const result = await run(
          'prompt-save',
          { scope: promptScope, config: promptDraft },
          { toast: promptScope === 'global' ? '全局提示词注入已保存' : '项目提示词注入已保存' },
        )
        if (result) setPromptDraft(normalizePromptDraft(result))
      }
      const updateAutomation = (key, value) => setAutomation((prev) => ({ ...prev, [key]: value }))
      const updateContext = (key, value) => setContextConfig((prev) => ({ ...prev, [key]: value }))
      const modelDefaults = catalog?.defaultSelection ?? state.modelDefaults ?? {}
      const defaultModelLabel = modelDefaults.provider ? `${modelDefaults.provider} / ${modelDefaults.model}` : 'DSH 当前默认'
      const modelOptions = catalog
        ? catalog.providers.flatMap((provider) =>
            (catalog.models?.[provider.id] ?? []).map((model) => ({
              key: `${provider.id}::${model.id}`,
              label: `${provider.name} / ${model.name || model.id}`,
              provider: provider.id,
              model: model.id,
              reasoning: model.reasoning ?? null,
            })),
          )
        : []
      const findModel = (provider, model) =>
        catalog?.models?.[provider]?.find((item) => item.id === model) ?? null
      const taskModel = (taskId) => {
        const config = models[taskId]
        const provider = config?.provider || modelDefaults.provider
        const model = config?.model || modelDefaults.model
        return {
          config,
          provider,
          model,
          info: findModel(provider, model),
          inherited: !config?.provider || !config?.model,
        }
      }
      const updateModel = (taskId, key) => {
        setModels((prev) => {
          const next = { ...prev }
          if (!key) {
            delete next[taskId]
            return next
          }
          const [provider, model] = key.split('::')
          next[taskId] = { provider, model }
          return next
        })
      }
      const updateReasoning = (taskId, effort) => {
        setModels((prev) => {
          if (!prev[taskId]?.provider) return prev
          return { ...prev, [taskId]: { ...prev[taskId], reasoningEffort: effort } }
        })
      }
      const draftTask = taskModel('draft')
      const effectiveDraft = state.effectiveModels?.draft
      const draftEffort = effectiveDraft?.reasoningEffort ?? draftTask.config?.reasoningEffort ?? modelDefaults.reasoningEffort ?? ''
      const highProse = ['medium', 'high', 'max', 'xhigh'].includes(String(draftEffort))
      const runSearch = async () => {
        if (!searchQuery.trim()) return
        setSearching(true)
        try {
          const result = await run('search-project', { query: searchQuery }, { silent: true })
          setSearchResults(result ?? { query: searchQuery, results: [] })
        } finally {
          setSearching(false)
        }
      }
      const openSearchResult = (result) => {
        if (!goTo) return
        if (result.source === 'chapter' && result.number) {
          try {
            localStorage.setItem('dsh.novelWriter.chapter', String(result.number))
          } catch {
            // storage unavailable
          }
          goTo('chapters')
          return
        }
        if (result.source === 'outline') {
          goTo('outline')
          return
        }
        if (result.source === 'bible') {
          goTo('bible')
        }
      }
      const manualUninitText = [
        '手动解除初始化：',
        '1. 先备份整个项目，至少把 story/ 与 .dsh-writing/ 复制到项目目录之外。',
        '2. 关闭写作台里正在运行的任务。',
        '3. 删除项目内的 story/ 和 .dsh-writing/；只删这两个，不要删项目目录、exports/ 或其它文件。',
        '4. 重新进入写作台，会显示未初始化。',
      ].join('\n')
      const autoUninitialize = async () => {
        if (!(await requestConfirm({ title: '解除初始化', message: '自动解除会把 story/ 和 .dsh-writing/ 移到项目内的 .deepnovel-backup/<时间>/，不会直接删除；但写作台会回到未初始化。继续？', danger: true, confirmLabel: '继续' }))) return
        if (!(await requestConfirm({ title: '再次确认', message: '确定解除当前项目的初始化？重要项目请先自行备份。', danger: true, confirmLabel: '确定解除' }))) return
        setUninitBusy(true)
        try {
          const result = await run('uninitialize-project', {}, { silent: true })
          if (result?.backupPath) {
            window.alert(`已解除初始化。\n原数据移动到了项目内：${result.backupPath}\n如需彻底删除，请手动删除该备份目录。`)
          }
        } finally {
          setUninitBusy(false)
        }
      }
      const copyUninitManual = async () => {
        try {
          await navigator.clipboard.writeText(manualUninitText)
          setManualCopied(true)
          setTimeout(() => setManualCopied(false), 2000)
        } catch {
          // clipboard unavailable; user can select text manually
        }
      }
      const restoreSnapshot = async (name) => {
        if (!(await requestConfirm({ title: '恢复快照', message: `恢复快照「${name}」会先用当前 story/.dsh-writing 创建 pre-restore 备份，再覆盖当前数据。继续？`, danger: true, confirmLabel: '恢复' }))) return
        if (!(await requestConfirm({ title: '再次确认', message: '恢复后请刷新页面检查内容。', confirmLabel: '确定恢复' }))) return
        await run('restore-snapshot', { name }, { toast: '快照已恢复' })
      }
      const undoAppliedDiscussion = async (applyId) => {
        await run('discussion-undo', { applyId }, { toast: '已撤销这次讨论应用' })
      }
      const stage = state.stage ?? {}
      const rows = [
        ['构思', stage.premise, 'premise'],
        ['文风', stage.style, 'style'],
        ['设定', stage.bible, 'bible'],
        ['章纲', `${stage.outlineChapters ?? 0} 章 · ${stage.confirmedOutlineChapters ?? 0} 已确认`, 'outline'],
        ['草稿', `${stage.chapters ?? 0} 章`, 'chapters'],
      ]
      return h('div', null,
        h(StepIntro, { eyebrow: '01 / 项目', title: '项目与流程', desc: '所有创作步骤都围绕这个项目展开。你可以随时回到这里查看进度或修改标题。', hints: ['确认项目标题', '按顺序完成构思 → 文风 → 大纲 → 章节'] }),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '项目设置'),
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '项目标题'),
            h('input', { className: 'nw-input', value: title, disabled: busy, onChange: (event) => setTitle(event.target.value) }),
          ),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !title.trim(), onClick: () => run('project-update', { fields: { title } }, { toast: '项目标题已保存' }) }, '保存标题'),
          ),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '自动化与目标'),
          h('p', { className: 'nw-muted' }, '自动检测/修复会影响生成耗时与模型消耗；通过线用于判定 AI 风格是否合格。'),
          h('div', { className: 'nw-grid-2' },
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: Boolean(automation.autoAudit), disabled: busy, onChange: (e) => updateAutomation('autoAudit', e.target.checked) }),
              h('span', { className: 'nw-label', style: { margin: 0 } }, '生成后自动跑 AI 风格检测'),
            ),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: Boolean(automation.autoFix), disabled: busy, onChange: (e) => updateAutomation('autoFix', e.target.checked) }),
              h('span', { className: 'nw-label', style: { margin: 0 } }, '生成后自动修复（含检测）'),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '多轮修复轮数'),
              h('input', { className: 'nw-input', type: 'number', min: '1', max: '3', value: automation.fixRounds ?? 2, disabled: busy, onChange: (e) => updateAutomation('fixRounds', Number(e.target.value) || 1) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, 'AI 风格通过线（0–100）'),
              h('input', { className: 'nw-input', type: 'number', min: '0', max: '100', value: automation.stylePassScore ?? 60, disabled: busy, onChange: (e) => updateAutomation('stylePassScore', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '连续写章默认数量'),
              h('input', { className: 'nw-input', type: 'number', min: '1', max: '10', value: automation.batchCount ?? 3, disabled: busy, onChange: (e) => updateAutomation('batchCount', Number(e.target.value) || 1) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '每卷参考章数（不强制分卷）'),
              h('input', { className: 'nw-input', type: 'number', min: '3', max: '30', value: automation.volumeChapters ?? 10, disabled: busy, onChange: (e) => updateAutomation('volumeChapters', Number(e.target.value) || 10) }),
            ),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: automation.autoNextVolume !== false, disabled: busy, onChange: (e) => updateAutomation('autoNextVolume', e.target.checked) }),
              h('span', { className: 'nw-label', style: { margin: 0 } }, '本卷满后自动开启下一卷'),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '全书目标字数（0=不设）'),
              h('input', { className: 'nw-input', type: 'number', min: '0', value: automation.targetWords ?? 0, disabled: busy, onChange: (e) => updateAutomation('targetWords', Number(e.target.value) || 0) }),
            ),
          ),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: () => run('project-update', { fields: { automation } }, { toast: '自动化设置已保存' }) }, '保存自动化设置'),
          ),
        ),
        h(SystemPromptsEditor, { state, run, busy, setToast }),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '写作要求（共享）'),
          h('p', { className: 'nw-muted' }, '写在这里的要求可以在设定/大纲/章节的生成要求里用「插入项目要求」引用。'),
          h('div', { className: 'nw-field' },
            h('textarea', {
              className: 'nw-textarea',
              style: { minHeight: '90px' },
              value: writingNotes,
              placeholder: '例：女性角色要立体；避免套路化爽点；控制节奏',
              onChange: (event) => setWritingNotes(event.target.value),
            }),
          ),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: () => run('project-update', { fields: { writingNotes, writingNotesTasks: writingTasks } }, { toast: '写作要求已保存' }) }, '保存写作要求'),
          ),
          h('div', { className: 'nw-actions', style: { marginTop: '4px' } },
            [['bible', '设定'], ['outline', '大纲'], ['draft', '草稿'], ['revise', '修订']].map(([stage, label]) =>
              h('label', { key: stage, style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' } },
                h('input', {
                  type: 'checkbox',
                  checked: writingTasks.includes(stage),
                  onChange: (event) => setWritingTasks((prev) => (event.target.checked ? [...prev, stage] : prev.filter((item) => item !== stage))),
                }),
                label,
              ),
            ),
          ),
          h('div', { className: 'nw-muted', style: { marginTop: '4px' } },
            '不勾选 = 全部阶段生效；勾选后只在这些阶段生效。'),
          h('div', { className: 'nw-actions', style: { marginTop: '4px' } },
            h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => setWritingTasks([]) }, '全部阶段'),
            h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => setWritingTasks(['draft', 'revise']) }, '仅正文'),
            h('button', { type: 'button', className: 'nw-btn ghost', onClick: () => setWritingTasks(['outline', 'draft', 'revise']) }, '大纲+正文'),
          ),
          h('div', { className: 'nw-muted', style: { marginTop: '4px' } },
            '已生效于：设定生成、大纲生成、章节草稿、章节修订（保存后下一次生成生效）'),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '模型分配'),
          h('p', { className: 'nw-muted' }, '默认继承 DSH 当前模型；也可以给不同任务单独指定模型与思考等级。正文类任务建议关闭思考或使用低等级。'),
          catalog
            ? h('div', null,
                h('div', { className: 'nw-model-row nw-model-head' },
                  h('span', null, '任务'),
                  h('span', null, '模型'),
                  h('span', null, '思考等级'),
                ),
                MODEL_TASKS.map((task) => {
                  const selection = taskModel(task.id)
                  const value = selection.config?.provider ? `${selection.config.provider}::${selection.config.model}` : ''
                  const efforts = selection.info?.reasoning?.efforts ?? []
                  const effective = state.effectiveModels?.[task.id]
                  const autoLabel = task.prose
                    ? `自动（${effortLabel(effective?.reasoningEffort) || '关闭'}）`
                    : task.id === 'audit'
                      ? `自动（${effortLabel(effective?.reasoningEffort) || '低'}）`
                      : selection.inherited
                        ? `继承默认（${effortLabel(effective?.reasoningEffort) || '模型默认'}）`
                        : '模型默认'
                  return h('div', { key: task.id, className: 'nw-model-row' },
                    h('div', { className: 'nw-model-task' },
                      task.label,
                      task.prose ? h('span', { className: 'nw-badge cur' }, '正文') : null,
                    ),
                    h('select', {
                      className: 'nw-select',
                      value,
                      disabled: busy,
                      onChange: (event) => updateModel(task.id, event.target.value),
                    },
                      h('option', { value: '' }, `继承默认（${defaultModelLabel}）`),
                      modelOptions.map((option) =>
                        h('option', { key: option.key, value: option.key }, option.label),
                      ),
                    ),
                    h('select', {
                      className: 'nw-select',
                      value: selection.config?.reasoningEffort ?? '',
                      disabled: busy || selection.inherited || efforts.length === 0,
                      onChange: (event) => updateReasoning(task.id, event.target.value),
                    },
                      h('option', { value: '' }, autoLabel),
                      efforts.map((effort) =>
                        h('option', { key: effort.id, value: effort.id }, effortLabel(effort.id) || effort.name || effort.id),
                      ),
                    ),
                  )
                }),
                h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
                  `正文当前：${draftTask.provider || '—'} / ${draftTask.model || '—'} · 思考 ${effortLabel(draftEffort) || '自动（低）'}`,
                ),
                highProse
                  ? h('div', { className: 'nw-banner warn', style: { marginTop: '8px' } },
                      '正文思考等级偏高，建议改为关闭 / 低：正文生成不需要深度推理，关掉可以明显降低延迟和成本。',
                    )
                  : null,
                h('div', { className: 'nw-actions' },
                  h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: () => run('project-update', { fields: { models } }, { toast: '模型分配已保存' }) }, '保存模型分配'),
                ),
              )
            : h('div', { className: 'nw-muted' }, '正在读取 DSH 模型列表…'),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '上下文预算'),
          h('p', { className: 'nw-muted' }, '写作上下文按“故事设定 + 连续性 + 伏笔 + 时间线”裁剪，不把整段聊天历史塞进 prompt。数值越大越完整，token 也越多。'),
          h('div', { className: 'nw-grid-2' },
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '最近状态章数'),
              h('input', { className: 'nw-input', type: 'number', min: '0', max: '3', value: contextConfig.recentStateChapters ?? 1, disabled: busy, onChange: (e) => updateContext('recentStateChapters', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '上一章结尾字符数'),
              h('input', { className: 'nw-input', type: 'number', min: '0', max: '4000', value: contextConfig.maxTailChars ?? 1200, disabled: busy, onChange: (e) => updateContext('maxTailChars', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '角色上限'),
              h('input', { className: 'nw-input', type: 'number', min: '0', max: '20', value: contextConfig.maxBibleCharacters ?? 6, disabled: busy, onChange: (e) => updateContext('maxBibleCharacters', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '规则上限'),
              h('input', { className: 'nw-input', type: 'number', min: '0', max: '20', value: contextConfig.maxRules ?? 6, disabled: busy, onChange: (e) => updateContext('maxRules', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '未回收伏笔上限'),
              h('input', { className: 'nw-input', type: 'number', min: '0', max: '30', value: contextConfig.maxForeshadow ?? 8, disabled: busy, onChange: (e) => updateContext('maxForeshadow', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '时间线章数'),
              h('input', { className: 'nw-input', type: 'number', min: '0', max: '20', value: contextConfig.maxTimeline ?? 5, disabled: busy, onChange: (e) => updateContext('maxTimeline', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '上下文总字符上限'),
              h('input', { className: 'nw-input', type: 'number', min: '4000', max: '60000', step: '1000', value: contextConfig.maxContextChars ?? 16000, disabled: busy, onChange: (e) => updateContext('maxContextChars', Number(e.target.value) || 16000) }),
            ),
          ),
          h('p', { className: 'nw-muted', style: { marginTop: '6px' } },
            '「上一章结尾字符数」控制续写时提供给模型的上一章原文量：0=不给；1200=只给结尾；3000 以上接近整章。它用于让下一章接住动作和情绪，避免重复上一章。',
          ),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '6px' } },
            h('input', { type: 'checkbox', checked: contextConfig.includeForeshadowing !== false, disabled: busy, onChange: (e) => updateContext('includeForeshadowing', e.target.checked) }),
            h('span', { className: 'nw-muted' }, '把未回收伏笔放进上下文'),
          ),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: () => run('project-update', { fields: { context: contextConfig } }, { toast: '上下文预算已保存' }) }, '保存上下文预算'),
          ),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '提示词注入'),
          h('p', { className: 'nw-muted' }, '需要每次生成都遵守的固定要求写在这里（长期规则）；页面上的「方向 / 额外要求」只作用于对应步骤，但会按项目记住上次内容。项目级只影响本项目的生成调用；全局级影响所有项目，并追加到 DeepNovel 预设会话的系统提示词。'),
          h('div', { className: 'nw-grid-2' },
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '作用域'),
              h('select', {
                className: 'nw-select',
                value: promptScope,
                disabled: busy,
                onChange: (event) => switchPromptScope(event.target.value),
              },
                h('option', { value: 'project' }, '项目级（仅本项目）'),
                h('option', { value: 'global' }, '全局级（所有项目 + 预设会话）'),
              ),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '注入位置'),
              h('select', {
                className: 'nw-select',
                value: promptDraft.position,
                disabled: busy,
                onChange: (event) => updatePrompt({ position: event.target.value }),
              },
                h('option', { value: 'suffix' }, '追加到系统提示词末尾'),
                h('option', { value: 'prefix' }, '放在系统提示词开头'),
              ),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '应用任务'),
              h('select', {
                className: 'nw-select',
                value: promptDraft.tasks.length > 0 ? 'prose' : 'all',
                disabled: busy,
                onChange: (event) =>
                  updatePrompt({ tasks: event.target.value === 'all' ? [] : [...PROMPT_PROSE_TASKS] }),
              },
                h('option', { value: 'prose' }, '仅正文 / 修订 / 修复'),
                h('option', { value: 'all' }, '全部任务（含构思、设定、大纲、审稿）'),
              ),
            ),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', alignSelf: 'end', paddingBottom: '10px' } },
              h('input', { type: 'checkbox', checked: Boolean(promptDraft.enabled), disabled: busy, onChange: (event) => updatePrompt({ enabled: event.target.checked }) }),
              h('span', { className: 'nw-label', style: { margin: 0 } }, '启用注入'),
            ),
          ),
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '注入文本'),
            h('textarea', {
              className: 'nw-textarea',
              style: { minHeight: '160px' },
              value: promptDraft.text,
              disabled: busy,
              placeholder: '写下要追加的提示词，例如对叙事尺度、审查口径、输出格式或禁止项的补充要求。',
              onChange: (event) => updatePrompt({ text: event.target.value }),
            }),
          ),
          promptDraft.tasks.length === 0
            ? h('div', { className: 'nw-banner warn', style: { marginBottom: '8px' } },
                '已选择全部任务：构思、设定、大纲等 JSON 任务也会注入，注入文本请避免与 JSON 输出要求冲突。',
              )
            : null,
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: savePrompt }, '保存注入设置'),
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy || (!promptDraft.text && !promptDraft.enabled),
              onClick: async () => {
                const next = { ...promptDraft, text: '', enabled: false }
                setPromptDraft(next)
                const result = await run(
                  'prompt-save',
                  { scope: promptScope, config: next },
                  { toast: '已清空注入文本' },
                )
                if (result) setPromptDraft(normalizePromptDraft(result))
              },
            }, '清空并禁用'),
            h('span', { className: 'nw-muted', style: { wordBreak: 'break-all' } },
              promptScope === 'project'
                ? '保存到 story/prompt.json'
                : `保存到 ${state.promptInjection?.globalPathDisplay ?? '~/.dsh/novel-writer/prompt-injection.json'}`,
            ),
          ),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '搜索'),
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('input', {
              className: 'nw-input',
              value: searchQuery,
              disabled: busy,
              placeholder: '搜章节、设定、章纲、讨论…',
              onChange: (event) => setSearchQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') runSearch()
              },
            }),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy || searching || !searchQuery.trim(), onClick: runSearch }, searching ? '搜索中…' : '搜索'),
          ),
          searchResults
            ? searchResults.results.length
              ? h('div', { className: 'nw-list', style: { marginTop: '10px' } },
                  searchResults.results.map((result, index) =>
                    h('button', {
                      key: `${result.source}-${index}`,
                      type: 'button',
                      className: 'nw-list-item',
                      onClick: () => openSearchResult(result),
                    },
                      h('span', { className: 'nw-badge' }, result.source),
                      h('span', { style: { minWidth: 0, flex: 1 } },
                        h('div', { className: 'nw-list-title' }, result.title),
                        h('div', { className: 'nw-muted', style: { whiteSpace: 'normal', lineHeight: 1.4 } }, result.snippet),
                      ),
                    ),
                  ),
                )
              : h('div', { className: 'nw-muted', style: { marginTop: '8px' } }, `没有找到「${searchResults.query}」`)
            : null,
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '写作统计'),
          (() => {
            const events = state.writing?.events ?? []
            const byDate = new Map()
            for (const event of events) {
              const date = event?.date
              if (!date) continue
              byDate.set(date, (byDate.get(date) ?? 0) + (Number(event.words) || 0))
            }
            const days = []
            for (let offset = 13; offset >= 0; offset -= 1) {
              const date = new Date()
              date.setDate(date.getDate() - offset)
              const key = date.toLocaleDateString('sv-SE')
              days.push({ key, label: `${date.getMonth() + 1}/${date.getDate()}`, words: byDate.get(key) ?? 0 })
            }
            const maxWords = Math.max(1, ...days.map((day) => day.words))
            const chapters = state.chapters ?? []
            const approved = chapters.filter((item) => item.hasFinal).length
            const ratio = chapters.length > 0 ? approved / chapters.length : 0
            const ring = 2 * Math.PI * 15.5
            return h('div', null,
              h('div', { className: 'nw-stat-grid' },
                h('div', { className: 'nw-stat-tile' },
                  h('div', { className: 'nw-stat-label' }, '今日字数'),
                  h('div', { className: 'nw-stat-value' }, String(state.writing?.todayWords ?? 0)),
                ),
                h('div', { className: 'nw-stat-tile' },
                  h('div', { className: 'nw-stat-label' }, '连续天数'),
                  h('div', { className: 'nw-stat-value' }, `${state.writing?.streakDays ?? 0} 天`),
                ),
                h('div', { className: 'nw-stat-tile' },
                  h('div', { className: 'nw-stat-label' }, '定稿 / 总章'),
                  h('div', { className: 'nw-stat-value' }, `${approved} / ${chapters.length}`),
                ),
              ),
              h('div', { className: 'nw-stat-row' },
                h('svg', { className: 'nw-ring', viewBox: '0 0 36 36', role: 'img', 'aria-label': `定稿完成度 ${Math.round(ratio * 100)}%` },
                  h('circle', { cx: 18, cy: 18, r: 15.5, fill: 'none', stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 4 }),
                  h('circle', { cx: 18, cy: 18, r: 15.5, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 4, strokeLinecap: 'round', strokeDasharray: `${ratio * ring} ${ring}`, transform: 'rotate(-90 18 18)' }),
                  h('text', { x: 18, y: 21, textAnchor: 'middle', fontSize: 9, fill: 'currentColor' }, `${Math.round(ratio * 100)}%`),
                ),
                h('div', { className: 'nw-chart' },
                  h('div', { className: 'nw-chart-bars' },
                    days.map((day) =>
                      h('div', { key: day.key, className: 'nw-chart-col', title: `${day.label}：${day.words} 字` },
                        h('div', { className: 'nw-chart-fill', style: { height: `${day.words > 0 ? Math.max(4, Math.round((day.words / maxWords) * 100)) : 2}%` } }),
                        h('span', { className: 'nw-chart-label' }, day.label),
                      ),
                    ),
                  ),
                  h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '近 14 天每日字数（含生成与手改）'),
                ),
              ),
            )
          })(),
        ),
        h(StructureStats, { state }),
        h(HealthCheck, { state, goTo, run, busy }),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '进度与导出'),
          h('div', { className: 'nw-muted' },
            `${state.stats?.words ?? 0} 字${state.stats?.target ? ` / 目标 ${state.stats.target}` : ''} · ${state.stats?.approved ?? 0} 章定稿 · 今日 ${state.writing?.todayWords ?? 0} 字 · 连续 ${state.writing?.streakDays ?? 0} 天`,
          ),
          h('div', { className: 'nw-actions' },
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy,
              onClick: async () => {
                const result = await run('export-manuscript', { format: 'md' }, { silent: true })
                if (result?.path) setExportPath(result.path)
              },
            }, '导出 Markdown'),
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy,
              onClick: async () => {
                const result = await run('export-manuscript', { format: 'html' }, { silent: true })
                if (result?.path) setExportPath(result.path)
              },
            }, '导出 HTML（可打印 PDF）'),
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy,
              onClick: async () => {
                const result = await run('export-manuscript', { format: 'epub' }, { silent: true })
                if (result?.path) setExportPath(result.path)
              },
            }, '导出 EPUB'),
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy,
              onClick: async () => {
                const result = await run('export-manuscript', { format: 'docx' }, { silent: true })
                if (result?.path) setExportPath(result.path)
              },
            }, '导出 DOCX'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => run('summarize-missing', {}, { toast: '缺失摘要已补全' }) }, '补全缺失摘要'),
            exportPath ? h('span', { className: 'nw-muted', style: { wordBreak: 'break-all' } }, `已导出：${exportPath}`) : null,
          ),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '导入已有书稿'),
          h('p', { className: 'nw-muted' }, '选择一个包含 .md / .txt 章节文件的目录，批量导入为已定稿章节。当前项目已有章节时不会执行。'),
          h('div', { className: 'nw-actions' },
            h('button', {
              type: 'button',
              className: 'nw-btn',
              disabled: busy,
              onClick: async () => {
                const service = resolveUiWorkspace()
                let dir = null
                if (service?.pickDirectory) {
                  try {
                    dir = await service.pickDirectory()
                  } catch {
                    dir = null
                  }
                }
                if (!dir && typeof window.prompt === 'function') {
                  dir = window.prompt('目录选择器不可用，请输入包含 .md/.txt 的绝对路径：', '')
                }
                if (!dir) return
                if (!(await requestConfirm({ title: '导入手稿', message: `从「${dir}」导入所有 .md/.txt？`, confirmLabel: '导入' }))) return
                run('import-manuscript', { sourcePath: dir }, { toast: '导入完成' })
              },
            }, '选择目录并导入'),
          ),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '当前阶段'),
          rows.map(([label, value, id]) =>
            h('div', { key: id, className: 'nw-row', style: { padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                h('span', { className: `nw-dot ${statusClass(stepStatus(state, id))}` }),
                h('span', null, label),
              ),
              h('span', { className: 'nw-muted' }, displayStatus(value) || '—'),
            ),
          ),
        ),
        state.overview
          ? h('div', { className: 'nw-card' },
              h('h3', { className: 'nw-h3' }, '故事状态'),
              h('div', { className: 'nw-muted' },
                `时间线 ${state.overview.timeline?.length ?? 0} 章 · 未回收伏笔 ${state.overview.openForeshadowing?.length ?? 0} 条 · 已定稿 ${state.overview.stateChapters?.length ?? 0} 章`,
              ),
              h('div', { className: 'nw-field' },
                h('div', { className: 'nw-label' }, '时间线'),
                (state.overview.timeline ?? []).slice(-8).map((item) =>
                  h('div', { key: item.number, className: 'nw-kv' },
                    h('b', null, String(item.number)),
                    h('span', null, `${item.time || '—'} · ${item.place || '—'} · ${item.title || '未命名'}`),
                  ),
                ),
              ),
              h('div', { className: 'nw-field' },
                h('div', { className: 'nw-label' }, '未回收伏笔'),
                (state.overview.openForeshadowing ?? []).length
                  ? state.overview.openForeshadowing.slice(0, 10).map((item) =>
                      h('div', { key: item.id, className: 'nw-muted' }, `第 ${item.plantedAt} 章 · ${item.text}`),
                    )
                  : h('div', { className: 'nw-muted' }, '没有未回收伏笔。'),
              ),
            )
          : null,
        state.characterIndex?.length
          ? h('div', { className: 'nw-card' },
              h('div', { className: 'nw-row' },
                h('h3', { className: 'nw-h3' }, '角色索引'),
                h('span', { className: 'nw-muted' }, `${state.characterIndex.length} 个角色`),
              ),
              h('div', { className: 'nw-chip-list' },
                state.characterIndex.slice(0, 16).map((item) =>
                  h('div', { key: item.name, className: 'nw-chip', title: `出场：${item.chapters.join('、') || '未出场'}` },
                    h('span', null, item.name),
                    item.lastChapter ? h('span', { className: 'nw-muted' }, `第 ${item.lastChapter} 章`) : null,
                    item.inBible ? null : h('span', { className: 'nw-badge bad' }, '未入设定'),
                  ),
                ),
              ),
            )
          : null,
        h('div', { className: 'nw-card' },
          h('div', { className: 'nw-row' },
            h('h3', { className: 'nw-h3' }, '项目快照'),
            h('span', { className: 'nw-muted' }, `${state.snapshots?.length ?? 0} 个`),
          ),
          h('p', { className: 'nw-muted' }, '快照把 story/ 与 .dsh-writing/ 复制到项目内 .deepnovel-snapshots/；恢复前会自动备份当前数据。'),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy, onClick: () => run('snapshot-create', {}, { toast: '快照已创建' }) }, '创建快照'),
          ),
          (state.snapshots ?? []).length
            ? h('div', { style: { marginTop: '8px' } },
                state.snapshots.slice(0, 6).map((snapshot) =>
                  h('div', { key: snapshot.name, className: 'nw-kv' },
                    h('span', { className: 'nw-muted' }, snapshot.name),
                    h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: () => restoreSnapshot(snapshot.name) }, '恢复'),
                  ),
                ),
              )
            : h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '还没有快照。'),
        ),
        h('div', { className: 'nw-card' },
          h('div', { className: 'nw-row' },
            h('h3', { className: 'nw-h3' }, '讨论应用历史'),
            h('span', { className: 'nw-muted' }, `${state.discussionApplies?.length ?? 0} 次`),
          ),
          (state.discussionApplies ?? []).length
            ? h('div', { style: { marginTop: '6px' } },
                state.discussionApplies.slice(0, 8).map((item) =>
                  h('div', { key: item.applyId, className: 'nw-kv' },
                    h('div', { style: { minWidth: 0 } },
                      h('div', { style: { fontSize: '11px' } }, item.topic || item.topicId),
                      h('div', { className: 'nw-muted' }, `${item.createdAt ? new Date(item.createdAt).toLocaleString() : ''} · ${item.appliedCount} 项`),
                    ),
                    h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: () => undoAppliedDiscussion(item.applyId) }, '撤销'),
                  ),
                ),
              )
            : h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '还没有讨论应用记录。'),
          (state.discussionApplies ?? []).length
            ? h('div', { className: 'nw-actions' },
                h('button', { type: 'button', className: 'nw-btn ghost', disabled: busy, onClick: () => run('discussion-applies-clear', { keep: 20 }, { toast: '旧记录已清理' }) }, '只保留最近 20 条'),
              )
            : null,
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '数据维护'),
          h('p', { className: 'nw-muted' }, '检查章纲中已不存在的旧章节目录与状态文件；删除前会先确认。'),
          h('div', { className: 'nw-actions' },
            h('button', {
              type: 'button',
              className: 'nw-btn danger',
              disabled: busy,
              onClick: async () => {
                const orphans = await run('find-orphans', {}, { silent: true })
                if (!orphans) return
                const total = (orphans.chapterDirs ?? []).length + (orphans.stateFiles ?? []).length
                if (total === 0) {
                  setToast?.('没有发现孤立文件')
                  return
                }
                if (!(await requestConfirm({
                  title: '清理孤立文件',
                  message: `发现 ${(orphans.chapterDirs ?? []).length} 个孤立章节目录、${(orphans.stateFiles ?? []).length} 个孤立状态文件，删除？`,
                  danger: true,
                }))) return
                run('clean-orphans', {}, { toast: '孤立文件已清理' })
              },
            }, '检查并清理孤立文件'),
          ),
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '危险操作：解除初始化'),
          h('p', { className: 'nw-muted' }, '解除后写作台会把这个目录当作未初始化项目；story/ 与 .dsh-writing/ 会被移入项目内的备份目录，不会直接删除。'),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn danger', disabled: busy || uninitBusy, onClick: autoUninitialize }, uninitBusy ? '解除中…' : '自动解除（二次确认）'),
            h('button', { type: 'button', className: 'nw-btn', onClick: () => setShowUninit((value) => !value) }, showUninit ? '收起手动方案' : '查看手动方案'),
          ),
          showUninit
            ? h('div', { className: 'nw-banner warn', style: { marginTop: '10px' } },
                h('div', { className: 'nw-label', style: { marginBottom: '4px' } }, '手动解除：先备份，再删除'),
                h('div', { className: 'nw-muted', style: { whiteSpace: 'pre-wrap', lineHeight: 1.7 } }, manualUninitText),
                h('div', { className: 'nw-actions' },
                  h('button', { type: 'button', className: 'nw-btn', onClick: copyUninitManual }, manualCopied ? '已复制' : '复制手动步骤'),
                ),
              )
            : null,
        ),
        h('div', { className: 'nw-card' },
          h('h3', { className: 'nw-h3' }, '固定流程'),
          h('ol', { className: 'nw-guide', style: { paddingLeft: '18px' } },
            h('li', null, '构思：生成候选，确认一个方向'),
            h('li', null, '文风：套用模板，微调并确认契约'),
            h('li', null, '设定：角色、地点、规则、势力、物品'),
            h('li', null, '大纲：生成章纲，逐章编辑并确认'),
            h('li', null, '章节：草稿、规则/风格质检、修订、定稿、连续写作'),
          ),
          h('p', { className: 'nw-muted' }, '讨论与改创意回到会话；写作台负责流程与审阅。'),
        ),
      )
    }

    function DeconstructPanel({ state, run, busy, setDirection, setToast }) {
      const [title, setTitle] = useState('')
      const [text, setText] = useState('')
      const [analysis, setAnalysis] = useState(null)
      const [working, setWorking] = useState(false)
      const analyze = async () => {
        if (!text.trim()) return
        setWorking(true)
        try {
          const result = await run('deconstruct-text', { title: title || undefined, text }, { silent: true })
          if (result?.analysis) setAnalysis(result.analysis)
        } finally {
          setWorking(false)
        }
      }
      const useAsDirection = () => {
        if (!analysis) return
        setDirection([analysis.summary, (analysis.hooks ?? []).slice(0, 3).join('；')].filter(Boolean).join('\n'))
        setToast('已把拆书结论填入方向框')
      }
      return h('div', { className: 'nw-card', style: { marginTop: '10px' } },
        h('div', { className: 'nw-row' },
          h('h3', { className: 'nw-h3' }, '拆书'),
          h('span', { className: 'nw-muted' }, '分析已有小说，提炼可复用结构'),
        ),
        h('input', {
          className: 'nw-input',
          style: { marginTop: '6px' },
          placeholder: '标题（可留空）',
          value: title,
          disabled: working,
          onChange: (event) => setTitle(event.target.value),
        }),
        h('textarea', {
          className: 'nw-textarea',
          style: { minHeight: '140px', marginTop: '6px' },
          placeholder: '粘贴要拆解的小说文本（取前 12000 字）',
          value: text,
          disabled: working,
          onChange: (event) => setText(event.target.value),
        }),
        h('div', { className: 'nw-actions' },
          h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || working || !text.trim(), onClick: analyze }, working ? '拆解中…' : '拆解文本'),
        ),
        analysis
          ? h('div', { style: { marginTop: '8px' } },
              h('div', { className: 'nw-result-label' }, '梗概'),
              h('div', { className: 'nw-muted' }, analysis.summary || '—'),
              (analysis.hooks ?? []).length
                ? h('div', { style: { marginTop: '6px' } },
                    h('div', { className: 'nw-result-label' }, '可复用桥段'),
                    (analysis.hooks ?? []).slice(0, 6).map((hook, index) => h('div', { key: index, className: 'nw-result-item' }, `· ${hook}`)),
                  )
                : null,
              h('div', { className: 'nw-actions' },
                h('button', { type: 'button', className: 'nw-btn', onClick: useAsDirection }, '用作构思方向'),
              ),
              (state.deconstructions?.items ?? []).length
                ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } },
                    `历史拆书：${(state.deconstructions.items ?? []).slice(0, 3).map((item) => item.title).join('、')}`)
                : null,
            )
          : null,
      )
    }

    function PremiseChat({ state, run, busy, setToast, chosen, candidates = [] }) {
      const storedChat = state?.premiseChat ?? { messages: [], batches: [] }
      const [mode, setMode] = useState('candidates')
      const [baseId, setBaseId] = useState(() => chosen?.id ?? candidates[0]?.id ?? null)
      const [input, setInput] = useState('')
      const [messages, setMessages] = useState(() => storedChat.messages ?? [])
      const [batches, setBatches] = useState(() => storedChat.batches ?? [])
      const [activeBatchId, setActiveBatchId] = useState(() => storedChat.activeBatchId ?? null)
      const [sparks, setSparks] = useState(() => {
        const latest = [...(storedChat.batches ?? [])].reverse().find((batch) => batch.mode === 'sparks')
        return latest?.ideas ?? []
      })
      const [working, setWorking] = useState(false)
      const [streamText, setStreamText] = useState('')
      const [brief, setBrief] = useState(() => storedChat.brief ?? '')
      const chatEndRef = useRef(null)
      useEffect(() => {
        if (!messages.length) return
        chatEndRef.current?.scrollIntoView({ block: 'nearest' })
      }, [messages.length])
      useEffect(() => {
        if (!candidates.length) return
        if (!candidates.some((candidate) => candidate.id === baseId)) {
          setBaseId(chosen?.id ?? candidates[0].id)
        }
      }, [candidates.map((candidate) => candidate.id).join(','), chosen?.id])
      const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const persistChat = async (nextMessages, nextBatches, nextActive, nextBrief = brief) => {
        try {
          await run('premise-chat-save', {
            messages: nextMessages,
            batches: nextBatches,
            brief: nextBrief,
            activeBatchId: nextActive,
          }, { silent: true })
        } catch {
          setToast?.('构思对话保存失败：候选已生成，但刷新后可能丢失聊天记录')
        }
      }
      const restoreBatch = async (batchId) => {
        setWorking(true)
        try {
          await run('premise-restore-batch', { batchId }, { silent: true })
          setActiveBatchId(batchId)
          setToast?.('已恢复该批候选')
        } catch (error) {
          setToast?.(error.message)
        } finally {
          setWorking(false)
        }
      }
      const send = async () => {
        const text = input.trim()
        if (!text || busy || working) return
        const userMessage = { id: newId('msg'), role: 'user', content: text, createdAt: new Date().toISOString() }
        const history = [...messages, userMessage]
        setMessages(history)
        setInput('')
        setStreamText('')
        setWorking(true)
        try {
          let assistantContent = ''
          let batch = null
          if (mode === 'discuss') {
            const base = candidates.find((candidate) => candidate.id === baseId) ?? chosen ?? candidates[0]
            if (!base) throw new Error('还没有候选可讨论；先生成一批候选')
            const result = await postDiscussion(state.cwd, {
              topicId: `premise-${base.id}`,
              topic: `构思候选讨论：${base.title || base.premise || base.id}`,
              item: base,
              message: text,
            })
            assistantContent = String(result?.reply ?? '').trim() || '（讨论没有返回文字）'
            batch = {
              id: newId('batch'),
              createdAt: new Date().toISOString(),
              mode: 'discuss',
              instruction: text,
              candidates: [],
              ideas: [],
            }
            const assistantMessage = {
              id: newId('msg'),
              role: 'assistant',
              content: assistantContent,
              createdAt: new Date().toISOString(),
              batchId: batch.id,
              actions: Array.isArray(result?.actions) ? result.actions : [],
            }
            const nextMessages = [...history, assistantMessage].slice(-200)
            const nextBatches = [...batches, batch].slice(-30)
            setMessages(nextMessages)
            setBatches(nextBatches)
            setActiveBatchId(batch.id)
            await persistChat(nextMessages, nextBatches, batch.id)
            return
          }
          if (mode === 'sparks') {
            const result = await run('inspiration-generate', { topic: text, count: 3, history: messages }, { silent: true })
            const ideas = result?.ideas ?? []
            setSparks(ideas)
            assistantContent = ideas.length
              ? ideas.map((idea, index) => `${index + 1}. ${idea.title || '桥段'}：${idea.hook || idea.scene || ''}`).join('\n')
              : '没有生成新的桥段。'
            batch = {
              id: newId('batch'),
              createdAt: new Date().toISOString(),
              mode: 'sparks',
              instruction: text,
              candidates: [],
              ideas,
            }
          } else {
            let nextBrief = brief
            try {
              const intentResult = await run('premise-intent', {
                history: messages,
                instruction: text,
              }, { silent: true })
              nextBrief = String(intentResult?.intent ?? brief ?? '').trim()
            } catch {
              // 意图摘要失败不阻塞抽卡，退回上一次摘要或空摘要
            }
            if (nextBrief) setBrief(nextBrief)
            const result = await postPremiseStream(state.cwd, {
              count: 3,
              instruction: text,
              history: messages,
              reference: chosen ?? undefined,
              intent: nextBrief || undefined,
            }, (raw) => setStreamText(raw))
            const candidates = result?.candidates ?? []
            assistantContent = candidates.length
              ? candidates.map((candidate, index) => `${index + 1}. ${candidate.title || candidate.premise || ''}`).join('\n')
              : '没有生成新的候选。'
            batch = {
              id: newId('batch'),
              createdAt: new Date().toISOString(),
              mode: 'candidates',
              instruction: text,
              candidates,
              ideas: [],
            }
            if (candidates.length) {
              setBaseId(candidates[0].id)
            }
            const nextMessages = [...history, {
              id: newId('msg'),
              role: 'assistant',
              content: assistantContent,
              createdAt: new Date().toISOString(),
              batchId: batch.id,
            }].slice(-200)
            const nextBatches = [...batches, batch].slice(-30)
            setMessages(nextMessages)
            setBatches(nextBatches)
            setActiveBatchId(batch.id)
            await persistChat(nextMessages, nextBatches, batch.id, nextBrief)
            return
          }
          const assistantMessage = {
            id: newId('msg'),
            role: 'assistant',
            content: assistantContent,
            createdAt: new Date().toISOString(),
            batchId: batch.id,
          }
          const nextMessages = [...history, assistantMessage].slice(-200)
          const nextBatches = [...batches, batch].slice(-30)
          setMessages(nextMessages)
          setBatches(nextBatches)
          setActiveBatchId(batch.id)
          await persistChat(nextMessages, nextBatches, batch.id)
        } catch (error) {
          const failureMessage = {
            id: newId('msg'),
            role: 'assistant',
            content: `生成失败：${error.message}`,
            createdAt: new Date().toISOString(),
          }
          const nextMessages = [...history, failureMessage]
          setMessages(nextMessages)
          await persistChat(nextMessages, batches, activeBatchId)
          setToast?.(error.message)
        } finally {
          setWorking(false)
        }
      }
      const applyDiscussionMessage = async (message) => {
        const base = candidates.find((candidate) => candidate.id === baseId) ?? chosen ?? candidates[0]
        if (!base || !message.actions?.length) return
        setWorking(true)
        try {
          await postDiscussionApply(state.cwd, {
            action: 'apply',
            topicId: `premise-${base.id}`,
            topic: `构思候选讨论：${base.title || base.premise || base.id}`,
            reply: message.content,
            result: { actions: message.actions },
            item: base,
            actions: message.actions,
          })
          await run('premise-chat-save', {
            messages,
            batches,
            activeBatchId,
          }, { silent: true })
          setToast?.('已应用讨论修改')
        } catch (error) {
          setToast?.(error.message)
        } finally {
          setWorking(false)
        }
      }
      const promoteIdea = (idea) => {
        setMode('candidates')
        setInput([idea.hook, idea.scene, idea.note].filter(Boolean).join('；'))
      }
      const candidateBatches = batches
        .map((batch, index) => ({ batch, index }))
        .filter(({ batch }) => batch.mode === 'candidates' && batch.candidates.length)
        .slice(-6)
      return h('div', { className: 'nw-card' },
        h('div', { className: 'nw-row' },
          h('h3', { className: 'nw-h3' }, '构思对话'),
          h('div', { className: 'nw-actions', style: { margin: 0 } },
            h('button', { type: 'button', className: `nw-btn${mode === 'discuss' ? ' primary' : ''}`, disabled: working || !candidates.length, onClick: () => setMode('discuss') }, '讨论当前候选'),
            h('button', { type: 'button', className: `nw-btn${mode === 'candidates' ? ' primary' : ''}`, disabled: working, onClick: () => setMode('candidates') }, '生成候选'),
            h('button', { type: 'button', className: `nw-btn${mode === 'sparks' ? ' primary' : ''}`, disabled: working, onClick: () => setMode('sparks') }, '桥段灵感'),
          ),
        ),
        mode === 'discuss' && candidates.length
          ? h('div', { className: 'nw-actions', style: { marginTop: '4px' } },
              h('span', { className: 'nw-muted' }, '讨论对象'),
              h('select', {
                className: 'nw-input',
                style: { flex: '1 1 260px' },
                value: baseId ?? '',
                disabled: working,
                onChange: (event) => setBaseId(event.target.value),
              }, candidates.map((candidate, index) =>
                h('option', { key: candidate.id, value: candidate.id }, `${index + 1}. ${candidate.title || candidate.premise || candidate.id}`),
              )),
            )
          : null,
        h('p', { className: 'nw-muted' }, mode === 'discuss'
          ? '这里是讨论，不会自动改候选：AI 先给判断和改法；只有点「应用修改到候选」才落盘。要换整套，再切「生成候选」。'
          : mode === 'candidates'
            ? '每轮生成一套新的完整候选；生成后可以切回「讨论当前候选」逐条修改。'
            : '先要几个具体桥段，不直接定完整构思；满意后可以转成候选继续聊。'),
        brief
          ? h('div', { className: 'nw-banner', style: { marginTop: '6px' } },
              h('span', { className: 'nw-muted' }, `我理解的意图：${brief}`),
            )
          : null,
        messages.length
          ? h('div', { style: { marginTop: '6px', maxHeight: '260px', overflow: 'auto' } },
              messages.map((message, index) =>
                h('div', { key: index, className: 'nw-card', style: { marginBottom: '6px', background: 'var(--dsw-alias-bg-layer-1)' } },
                  h('div', { className: 'nw-eyebrow' }, message.role === 'assistant' ? 'AI' : '你'),
                  h('div', { className: 'nw-muted', style: { whiteSpace: 'pre-wrap' } }, message.content),
                  message.role === 'assistant' && message.actions?.length
                    ? h('div', { className: 'nw-actions' },
                        h('button', { type: 'button', className: 'nw-btn', disabled: working, onClick: () => applyDiscussionMessage(message) }, '应用修改到候选'),
                      )
                    : null,
                ),
              ),
              h('div', { ref: chatEndRef }),
            )
          : null,
        streamText
          ? h('details', { className: 'nw-qa-details', style: { marginTop: '6px' }, open: working },
              h('summary', { className: 'nw-qa-summary-line' }, `AI 实时输出 · ${streamText.length} 字符`),
              h('pre', { className: 'nw-pre', style: { maxHeight: '180px', overflow: 'auto' } }, streamText.slice(-4000)),
            )
          : null,
        candidateBatches.length
          ? h('div', { style: { marginTop: '6px' } },
              h('div', { className: 'nw-muted', style: { marginBottom: '4px' } }, '历史候选批次（可恢复）'),
              h('div', { className: 'nw-actions', style: { marginTop: 0 } },
                candidateBatches.map(({ batch, index }) =>
                  h('button', {
                    key: batch.id,
                    type: 'button',
                    className: `nw-btn${activeBatchId === batch.id ? ' primary' : ''}`,
                    disabled: working || busy,
                    title: batch.instruction || '恢复这批候选',
                    onClick: () => restoreBatch(batch.id),
                  }, `第 ${index + 1} 批`),
                ),
              ),
            )
          : null,
        mode === 'sparks' && sparks.length
          ? h('div', { style: { marginTop: '8px' } },
              sparks.map((idea, index) =>
                h('div', { key: index, className: 'nw-card', style: { marginBottom: '6px', background: 'var(--dsw-alias-bg-layer-1)' } },
                  h('div', { className: 'nw-row' }, h('span', { className: 'nw-eyebrow' }, idea.title || `桥段 ${index + 1}`)),
                  idea.hook ? h('div', { className: 'nw-logline' }, idea.hook) : null,
                  idea.scene ? h('div', { className: 'nw-muted', style: { marginTop: '3px' } }, idea.scene) : null,
                  h('div', { className: 'nw-actions' },
                    h('button', { type: 'button', className: 'nw-btn', disabled: working, onClick: () => promoteIdea(idea) }, '转成候选'),
                  ),
                ),
              ),
            )
          : null,
        h('div', { className: 'nw-actions', style: { marginTop: '8px' } },
          h('input', {
            className: 'nw-input',
            style: { flex: '1 1 320px' },
            placeholder: mode === 'candidates' ? '例如：再来三个更市井的；第二个更冷硬；不要复仇线' : '例如：女角出场、一场冲突、一个反转',
            value: input,
            disabled: working || busy,
            onChange: (event) => setInput(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') send() },
          }),
          h('button', { type: 'button', className: 'nw-btn primary', disabled: working || busy || !input.trim(), onClick: send }, working ? '生成中…' : '发送'),
        ),
        chosen ? h('div', { className: 'nw-muted', style: { marginTop: '6px' } }, '已确认一个构思；如要重新发散，可以直接继续对话，再确认新的候选。') : null,
      )
    }

    function PremiseView({ state, run, busy, direction, setDirection, goTo, openDiscussion, setToast }) {
      const premise = state.premise ?? { candidates: [], chosen: null }
      const candidates = premise.candidates ?? []
      const chosen = premise.chosen
      const [compare, setCompare] = useState(false)
      return h('div', null,
        h(StepIntro, {
          eyebrow: '02 / 构思',
          title: '先把故事的核心定下来',
          status: premise.status,
          desc: '像聊天一样说要什么；AI 每轮给几个候选，继续提意见直到你确认一个。',
          hints: ['说方向或直接开始聊', '继续提修改意见', '确认一个候选，进入文风'],
        }),
        h(PremiseChat, { state, run, busy, setToast, chosen, candidates }),
        h(DeconstructPanel, { state, run, busy, setDirection, setToast }),
        chosen ? h(ChosenPremiseEditor, { state, chosen, run, busy, goTo, openDiscussion }) : null,
        candidates.length
          ? h('div', null,
              h('div', { className: 'nw-row', style: { marginTop: '4px' } },
                h('h3', { className: 'nw-h3', style: { margin: 0 } }, `候选（${candidates.length}）`),
                h('button', { type: 'button', className: 'nw-btn', onClick: () => setCompare((value) => !value) }, compare ? '卡片视图' : '对比视图'),
              ),
              compare
                ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '8px', marginTop: '8px' } },
                    candidates.map((candidate, index) =>
                      h('div', { key: candidate.id, className: `nw-card nw-candidate${chosen?.id === candidate.id ? ' selected' : ''}`, style: { margin: 0 } },
                        h('div', { className: 'nw-row' },
                          h('span', { className: 'nw-eyebrow' }, candidate.title || `候选 ${index + 1}`),
                          chosen?.id === candidate.id ? h('span', { className: 'nw-badge ok' }, '已选') : null,
                        ),
                        h('div', { className: 'nw-premise' }, candidate.premise || '（无构思内容）'),
                        h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, `主角：${candidate.protagonist || '—'}`),
                        h('div', { className: 'nw-muted' }, `篇幅：${candidate.length?.chapters ?? '—'} 章 / ${candidate.length?.wordsPerChapter ?? '—'} 字每章`),
                        h('div', { className: 'nw-actions' },
                          h('button', { type: 'button', className: 'nw-btn primary block', disabled: busy, onClick: () => run('premise-commit', { candidateId: candidate.id }, { next: 'style', toast: '构思已确认，下一步：文风' }) },
                            busy ? '处理中…' : '确认这个'),
                          h('button', { type: 'button', className: 'nw-btn', onClick: () => openDiscussion?.(`premise-${candidate.id}`, `候选 ${index + 1} 讨论`, candidate) }, '讨论'),
                        ),
                      ),
                    ),
                  )
                : candidates.map((candidate, index) =>
                    h('div', { key: candidate.id, className: `nw-card nw-candidate${chosen?.id === candidate.id ? ' selected' : ''}` },
                      h('div', { className: 'nw-row' },
                        h('span', { className: 'nw-eyebrow' }, candidate.title || `候选 ${index + 1}`),
                        chosen?.id === candidate.id ? h('span', { className: 'nw-badge ok' }, '当前已选') : null,
                      ),
                      h('div', { className: 'nw-premise' }, candidate.premise || '（无构思内容）'),
                      h('div', { className: 'nw-meta' },
                        (candidate.genre ?? []).slice(0, 4).map((tag) => h('span', { key: tag }, tag)),
                        h('span', null, `${candidate.length?.chapters ?? '—'} 章`),
                        h('span', null, `${candidate.length?.wordsPerChapter ?? '—'} 字/章`),
                      ),
                      h('div', { className: 'nw-muted' }, `主角：${candidate.protagonist ?? '—'}`),
                      h('div', { className: 'nw-actions' },
                        h('button', { type: 'button', className: 'nw-btn primary block', disabled: busy, onClick: () => run('premise-commit', { candidateId: candidate.id }, { next: 'style', toast: '构思已确认，下一步：文风' }) },
                          busy ? '处理中…' : '确认选用这个构思'),
                        h('button', { type: 'button', className: 'nw-btn', onClick: () => openDiscussion?.(`premise-${candidate.id}`, `候选 ${index + 1} 讨论`, candidate) }, '讨论'),
                      ),
                    ),
                  ),
            )
          : h(EmptyState, {
              title: '还没有候选',
              desc: '填一个方向，然后生成 3 个候选；也可以直接留空，让模型先给几个方向。',
            }),
      )
    }

    function ChosenPremiseEditor({ state, chosen, run, busy, goTo, openDiscussion }) {
      const [fields, setFields] = useState(chosen)
      useEffect(() => { setFields(chosen) }, [chosen?.id, state.premise?.updatedAt])
      const update = (key, value) => setFields((prev) => ({ ...prev, [key]: value }))
      const updateLength = (key, value) => setFields((prev) => ({ ...prev, length: { ...(prev.length ?? {}), [key]: Number(value) || 0 } }))
      const dirty = JSON.stringify(fields) !== JSON.stringify(chosen)
      return h('div', { className: 'nw-card' },
        h('div', { className: 'nw-row' },
          h('h3', { className: 'nw-h3' }, '已确认构思（可编辑）'),
          h('span', { className: 'nw-badge ok' }, '已确认'),
        ),
        h('div', { className: 'nw-field' },
          h('label', { className: 'nw-label' }, '标题'),
          h('input', { className: 'nw-input', value: fields.title ?? '', disabled: busy, onChange: (e) => update('title', e.target.value) }),
        ),
        h('div', { className: 'nw-field' },
          h('label', { className: 'nw-label' }, '故事核心'),
          h('textarea', { className: 'nw-textarea', style: { minHeight: '140px' }, value: fields.premise ?? '', disabled: busy, onChange: (e) => update('premise', e.target.value) }),
        ),
        h('div', { className: 'nw-field' },
          h('label', { className: 'nw-label' }, '主角'),
          h('textarea', { className: 'nw-textarea', value: fields.protagonist ?? '', disabled: busy, onChange: (e) => update('protagonist', e.target.value) }),
        ),
        h('div', { className: 'nw-grid-2' },
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '预计章节数'),
            h('input', { className: 'nw-input', type: 'number', value: fields.length?.chapters ?? 0, disabled: busy, onChange: (e) => updateLength('chapters', e.target.value) }),
          ),
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '单章字数'),
            h('input', { className: 'nw-input', type: 'number', value: fields.length?.wordsPerChapter ?? 0, disabled: busy, onChange: (e) => updateLength('wordsPerChapter', e.target.value) }),
          ),
        ),
        h('div', { className: 'nw-actions' },
          h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || !dirty, onClick: () => run('premise-update', { fields }, { toast: '构思已更新' }) }, '保存构思修改'),
          dirty ? h('span', { className: 'nw-muted', style: { alignSelf: 'center' } }, '有未保存修改') : null,
          h('button', { type: 'button', className: 'nw-btn', onClick: () => openDiscussion?.(`premise-${chosen.id}`, '构思讨论', chosen) }, '讨论这个构思'),
          h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => goTo('style') }, '继续：设置文风'),
        ),
      )
    }

    function StyleView({ state, run, busy, goTo, openDiscussion, setToast }) {
      const contract = state.style ?? {}
      const templates = state.styleTemplates ?? []
      const orderedTemplates = [...templates].sort((a, b) => templateGroupOrder(a) - templateGroupOrder(b))
      const [fields, setFields] = useState(contract.fields ?? {})
      const [templateName, setTemplateName] = useState('')
      const [importOpen, setImportOpen] = useState(false)
      const [importText, setImportText] = useState('')
      const [sampleText, setSampleText] = useState(Array.isArray(contract.samples) ? contract.samples.join('\n\n') : '')
      useEffect(() => { setFields(contract.fields ?? {}) }, [contract.updatedAt])
      useEffect(() => {
        setSampleText(Array.isArray(contract.samples) ? contract.samples.join('\n\n') : '')
      }, [contract.updatedAt])
      const update = (key, value) => setFields((prev) => ({ ...prev, [key]: value }))
      const banned = Array.isArray(fields.bannedWords) ? fields.bannedWords.join('，') : fields.bannedWords ?? ''
      const dirty = JSON.stringify(fields) !== JSON.stringify(contract.fields ?? {})
      return h('div', null,
        h(StepIntro, {
          eyebrow: '03 / 文风',
          title: '让文字有确定的质感',
          status: contract.status,
          desc: '模板只是起点。把视角、节奏、句长和禁忌调到你想要的样子，再确认成这个项目的契约。',
          hints: ['套用一个模板作为起点', '微调节奏、语言与禁忌', '保存并确认文风'],
        }),
        h('div', { className: 'nw-card' },
          h('div', { className: 'nw-row' },
            h('h3', { className: 'nw-h3' }, '文风契约'),
            h('span', { className: `nw-badge ${statusClass(contract.status)}` }, displayStatus(contract.status) || '未设置'),
          ),
          h('p', { className: 'nw-muted' }, '套用模板作为起点，再按需要微调；保存后才是本项目的文风契约。'),
          h('div', { className: 'nw-grid-2' },
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '叙事视角'),
              h('select', { className: 'nw-select', value: fields.pov ?? 'third-limited', disabled: busy, onChange: (e) => update('pov', e.target.value) },
                h('option', { value: 'third-limited' }, '第三人称限知'),
                h('option', { value: 'first' }, '第一人称'),
                h('option', { value: 'third-omniscient' }, '第三人称全知'),
              ),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '时态'),
              h('select', { className: 'nw-select', value: fields.tense ?? 'past', disabled: busy, onChange: (e) => update('tense', e.target.value) },
                h('option', { value: 'past' }, '过去时'),
                h('option', { value: 'present' }, '现在时'),
              ),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '单章目标字数'),
              h('input', { className: 'nw-input', type: 'number', value: fields.chapterWords ?? 3000, disabled: busy, onChange: (e) => update('chapterWords', Number(e.target.value) || 0) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '对话占比（0–1）'),
              h('input', { className: 'nw-input', type: 'number', step: '0.05', min: '0', max: '1', value: fields.dialogueRatio ?? 0.35, disabled: busy, onChange: (e) => update('dialogueRatio', Number(e.target.value)) }),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '句长'),
              h('select', { className: 'nw-select', value: fields.sentenceLength ?? 'mixed', disabled: busy, onChange: (e) => update('sentenceLength', e.target.value) },
                h('option', { value: 'short' }, '短句为主'),
                h('option', { value: 'mixed' }, '长短混合'),
                h('option', { value: 'long' }, '长句为主'),
              ),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '段落长度'),
              h('select', { className: 'nw-select', value: fields.paragraphLength ?? 'medium', disabled: busy, onChange: (e) => update('paragraphLength', e.target.value) },
                h('option', { value: 'short' }, '短段'),
                h('option', { value: 'medium' }, '中等'),
                h('option', { value: 'long' }, '长段'),
              ),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '比喻密度'),
              h('select', { className: 'nw-select', value: fields.metaphorDensity ?? 'low', disabled: busy, onChange: (e) => update('metaphorDensity', e.target.value) },
                h('option', { value: 'low' }, '低'),
                h('option', { value: 'medium' }, '中'),
                h('option', { value: 'high' }, '高'),
              ),
            ),
            h('div', { className: 'nw-field' },
              h('label', { className: 'nw-label' }, '章节标题风格'),
              h('input', { className: 'nw-input', value: fields.chapterTitleStyle ?? '', disabled: busy, onChange: (e) => update('chapterTitleStyle', e.target.value) }),
            ),
          ),
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '禁用词（用逗号分隔）'),
            h('input', { className: 'nw-input', value: banned, disabled: busy, onChange: (e) => update('bannedWords', e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean)) }),
          ),
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '额外风格要求'),
            h('textarea', { className: 'nw-textarea', value: fields.notes ?? '', disabled: busy, onChange: (e) => update('notes', e.target.value) }),
          ),
          h('div', { className: 'nw-field' },
            h('label', { className: 'nw-label' }, '文风示例段落（用空行分隔，最多 3 段；生成时作为语感锚点）'),
            h('textarea', {
              className: 'nw-textarea',
              style: { minHeight: '120px' },
              value: sampleText,
              disabled: busy,
              placeholder: '粘贴 1–3 段你想要的语感示例（人物互动/战斗/日常都可以）',
              onChange: (e) => setSampleText(e.target.value),
            }),
            h('div', { className: 'nw-actions' },
              h('button', {
                type: 'button',
                className: 'nw-btn',
                disabled: busy,
                onClick: () => run('style-samples-save', {
                  samples: sampleText.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean),
                }, { toast: '示例段落已保存' }),
              }, '保存示例段落'),
            ),
          ),
          h('div', { className: 'nw-actions' },
            h('button', { type: 'button', className: 'nw-btn primary', disabled: busy || contract.status === 'missing', onClick: () => run('style-commit', { fields }, { next: 'outline', toast: '文风已确认，下一步：大纲' }) }, '保存并确认文风'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy || !contract.templateId, onClick: () => run('style-apply', { templateId: contract.templateId }, { toast: '已恢复模板值' }) }, '恢复模板值'),
            h('button', { type: 'button', className: 'nw-btn', onClick: () => openDiscussion?.('style', '文风契约讨论', { templateId: contract.templateId, fields }) }, '讨论文风'),
            h('input', { className: 'nw-input', style: { width: '150px' }, value: templateName, placeholder: '模板名称', disabled: busy, onChange: (e) => setTemplateName(e.target.value) }),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy || !templateName.trim(), onClick: async () => {
              await run('style-save-template', {
                name: templateName,
                fields,
                samples: sampleText.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean),
              }, { toast: '已保存为自定义模板' })
              setTemplateName('')
            } }, '保存为模板'),
            h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => setImportOpen(true) }, '导入模板'),
            dirty ? h('span', { className: 'nw-muted', style: { alignSelf: 'center' } }, '有未保存修改') : null,
          ),
        ),
        h('h3', { className: 'nw-eyebrow', style: { margin: '6px 2px 10px' } }, '模板（古风优先）'),
        orderedTemplates.map((template) =>
          h('div', { key: template.id, className: `nw-template${contract.templateId === template.id ? ' current' : ''}` },
            h('div', { className: 'nw-row' },
              h('div', { className: 'nw-template-name' }, template.name ?? template.id),
              h('span', { className: 'nw-badge' }, TEMPLATE_GROUP_LABELS[templateGroupOrder(template)] ?? '通用'),
              template.builtin === false ? h('span', { className: 'nw-badge' }, '自定义') : null,
              contract.templateId === template.id ? h('span', { className: 'nw-badge cur' }, '当前') : null,
            ),
            h('div', { className: 'nw-muted' }, template.description ?? ''),
            h('div', { className: 'nw-muted' }, `单章 ${template.fields?.chapterWords ?? '—'} 字 · 对话占比 ${template.fields?.dialogueRatio ?? '—'} · ${template.fields?.sentenceLength ?? ''}`),
            h('div', { className: 'nw-actions' },
              h('button', { type: 'button', className: 'nw-btn', disabled: busy, onClick: () => run('style-apply', { templateId: template.id }, { toast: `已套用「${template.name ?? template.id}」` }) }, '套用此模板'),
              h('button', {
                type: 'button',
                className: 'nw-btn ghost',
                disabled: busy,
                onClick: async () => {
                  const result = await run('style-export-template', { id: template.id }, { silent: true })
                  if (!result?.json) return
                  try {
                    await navigator.clipboard.writeText(result.json)
                    setToast?.('模板已复制到剪贴板')
                  } catch {
                    setToast?.('复制失败，请手动选择文本')
                  }
                },
              }, '导出'),
              template.builtin === false
                ? h('button', {
                    type: 'button',
                    className: 'nw-btn danger',
                    disabled: busy,
                    onClick: async () => {
                      if (!(await requestConfirm({ title: '删除模板', message: `删除模板「${template.name ?? template.id}」？`, danger: true }))) return
                      run('style-delete-template', { id: template.id }, { toast: '模板已删除' })
                    },
                  }, '删除')
                : null,
            ),
          ),
        ),
        importOpen
          ? h('div', { className: 'nw-modal-backdrop', onClick: () => setImportOpen(false) },
              h('div', { className: 'nw-modal', onClick: (event) => event.stopPropagation() },
                h('div', { className: 'nw-eyebrow' }, '导入文风模板'),
                h('div', { className: 'nw-muted', style: { marginTop: '4px' } }, '粘贴从其他项目「导出」得到的模板 JSON。'),
                h('textarea', {
                  className: 'nw-textarea',
                  style: { minHeight: '160px', marginTop: '8px' },
                  value: importText,
                  placeholder: '{"name":"...","fields":{...},"samples":[]}',
                  onChange: (event) => setImportText(event.target.value),
                }),
                h('div', { className: 'nw-actions', style: { justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'nw-btn', onClick: () => setImportOpen(false) }, '取消'),
                  h('button', {
                    type: 'button',
                    className: 'nw-btn primary',
                    disabled: busy || !importText.trim(),
                    onClick: async () => {
                      let template = null
                      try {
                        template = JSON.parse(importText)
                      } catch {
                        setToast?.('JSON 解析失败，请检查格式')
                        return
                      }
                      const result = await run('style-import-template', { template }, { toast: '模板已导入' })
                      if (result) {
                        setImportOpen(false)
                        setImportText('')
                      }
                    },
                  }, '导入'),
                ),
              ),
            )
          : null,
      )
    }

    function WritingIcon(props) {
      const size = Number(props?.size ?? 16)
      return h('span', {
        style: {
          display: 'grid',
          placeItems: 'center',
          width: size,
          height: size,
          color: props?.active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        },
      }, h(QuillIcon))
    }

    const MAIN_ID = 'novel-writer-desk'

    function registerDesk(scope) {
      clientScope = scope
      layoutService = scope.get('layout') ?? layoutService
      resolveUiWorkspace()
      if (!uiWorkspaceService) {
        let tries = 0
        const ensure = () => {
          resolveUiWorkspace()
          if (!uiWorkspaceService && tries < 20) {
            tries += 1
            setTimeout(ensure, 300)
          }
        }
        setTimeout(ensure, 300)
      }
      logClient('registerDesk', { slots: Boolean(scope.get('slots')), layout: Boolean(layoutService), uiWorkspace: Boolean(uiWorkspaceService) })
      scope.effect(() => {
        const style = document.createElement('style')
        style.textContent = CSS + CSS_DESIGN + CSS_APP
        document.head.appendChild(style)
        // 点击空白处或按 Esc 关闭「更多」等 details 菜单。
        const closeMenus = () => {
          document.querySelectorAll('details.nw-more[open]').forEach((node) => node.removeAttribute('open'))
        }
        const onDocumentClick = (event) => {
          const target = event.target
          if (target instanceof Element && target.closest('.nw-more')) return
          closeMenus()
        }
        const onDocumentKey = (event) => {
          if (event.key === 'Escape') closeMenus()
        }
        document.addEventListener('click', onDocumentClick, true)
        document.addEventListener('keydown', onDocumentKey)
        let disposed = false
        let timer = null
        let disposers = []
        /*
         * 重启后客户端插件可能比侧栏插件更早加载：slots 服务在，但 sidebar.panellist
         * 还没被父条目声明，register 会抛 "slot ... is not declared"。
         * 以前直接放弃注册，表现就是「重启后写作台按钮消失，禁用再启用才回来」。
         * 改成有限重试，直到 slot 声明完成或超时（40 × 150ms ≈ 6s）。
         */
        const attempt = (tryIndex) => {
          if (disposed) return
          const slots = scope.get('slots')
          if (!slots) {
            if (tryIndex < 40) timer = setTimeout(() => attempt(tryIndex + 1), 150)
            else style.remove()
            return
          }
          let disposeEntry = null
          try {
            disposeEntry = slots.register(
              { name: 'sidebar.panellist', id: MAIN_ID, order: 8, label: '写作台' },
              WritingIcon,
            )
            disposers = [
              disposeEntry,
              slots.register({ name: 'main', key: MAIN_ID }, DeskApp),
            ]
            logClient('registered', { panel: MAIN_ID, attempt: tryIndex })
          } catch (error) {
            if (disposeEntry) {
              try {
                disposeEntry()
              } catch {
                // 第一条已注册成功、第二条失败时回滚
              }
            }
            const message = error instanceof Error ? error.message : String(error)
            if (tryIndex < 40) {
              timer = setTimeout(() => attempt(tryIndex + 1), 150)
              return
            }
            logClient('register-error', { message, stack: error instanceof Error ? error.stack : null })
            style.remove()
          }
        }
        attempt(0)
        return () => {
          disposed = true
          if (timer) clearTimeout(timer)
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              // 已销毁的注册忽略
            }
          }
          disposers = []
          style.remove()
          document.removeEventListener('click', onDocumentClick, true)
          document.removeEventListener('keydown', onDocumentKey)
        }
      })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          registerDesk(ctx)
        } catch (error) {
          logClient('apply-error', { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null })
        }
      },
    }
  },
})

// hmr probe 3 2026-10-19T23:35:00+08:00

// hmr probe 4 2026-10-19T23:50:00+08:00
