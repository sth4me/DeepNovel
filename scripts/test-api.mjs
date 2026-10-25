const base = process.env.DSH_WEB_URL || 'http://127.0.0.1:62413'
const projectRoot = process.argv[2]

if (!projectRoot) {
  throw new Error('usage: node scripts/test-api.mjs <absolute-project-root>')
}

async function get(path) {
  const response = await fetch(`${base}${path}`, { cache: 'no-store' })
  return response.json()
}

const state = await get(`/novel-writer/project-state?projectRoot=${encodeURIComponent(projectRoot)}`)
console.log('state', JSON.stringify({
  ok: state.ok,
  initialized: state.data?.initialized,
  next: state.data?.workflow?.next,
  blockers: state.data?.workflow?.blockers,
  chapters: state.data?.chapters?.length,
  models: state.data?.effectiveModels,
}))

const models = await get('/novel-writer/models')
console.log('models', JSON.stringify({
  ok: models.ok,
  providers: models.data?.providers?.map((provider) => provider.id),
  defaultSelection: models.data?.defaultSelection,
}))

const chapter = await get(
  `/novel-writer/context?projectRoot=${encodeURIComponent(projectRoot)}&number=1`,
)
console.log('context', JSON.stringify({
  ok: chapter.ok,
  tokens: chapter.data?.context?.meta?.estimatedTokens,
  counts: chapter.data?.context?.meta?.counts,
}))
