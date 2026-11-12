// 宿主插件：只注册 UI 所需的 HTTP API，不注册工具/提示词。
import { registerWritingRoutes } from './routes.js'

export const name = '@sth4me/deepnovel'

export const inject = []

export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (webCtx) => {
    const dispose = registerWritingRoutes(ctx, webCtx.webServer)
    webCtx.effect(() => () => dispose())
  })
}
