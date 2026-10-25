let current = undefined

export function setNovelWriter(service) {
  current = service
}

export function getNovelWriter() {
  if (!current) {
    throw new Error('novelWriter 服务尚未就绪：请确认写作插件 host 行已加载')
  }
  return current
}
