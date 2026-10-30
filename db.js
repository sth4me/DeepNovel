/**
 * SQLite 数据层地基（Phase 0）。
 * 结构化数据进 SQLite（唯一真源），正文继续保留 Markdown 文件。
 *
 * 运行时要求：Node 24+ 内置 node:sqlite（SQLite 3.50+，FTS5 + trigram 可用）。
 * 本文件只负责打开连接、建表、事务与 JSON 列工具，不承载业务读写（见 store.js）。
 */
import { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 2

const activeTransactions = new WeakSet()

/*
 * 表结构说明：
 * - 结构简单的实体用列；结构复杂/易变的（power、chapter_meta、chapter_state、chapter_summary、run）整体存 json。
 * - 为满足「store 返回形状与现有 JSON 文件一致」，少数实体补了 extra_json / 小 meta 表：
 *   project 的 models/context/autoFix/layoutVersion/presetId 等没有独立列，统一放 extra_json；
 *   premise/bible/outline 的 confirmedAt 等杂项同理；relations、stats、state 的 status/updatedAt 用小 meta 表。
 * - FTS 用 trigram 分词（中文 ≥3 字可检索，1–2 字由 store 用 LIKE 兜底）。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER,
  title TEXT,
  language TEXT,
  genre_json TEXT,
  logline TEXT,
  writing_notes TEXT,
  craft_auto INTEGER DEFAULT 1,
  prompt_json TEXT,
  automation_json TEXT,
  extra_json TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS premise (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT,
  chosen_json TEXT,
  candidates_json TEXT,
  chosen_hash TEXT,
  extra_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS style_contract (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT,
  template_id TEXT,
  fields_json TEXT,
  samples_json TEXT,
  fields_hash TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS style_templates (
  id TEXT PRIMARY KEY,
  name TEXT,
  group_name TEXT,
  description TEXT,
  tags_json TEXT,
  fields_json TEXT,
  samples_json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS bible_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT,
  extra_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bible_entries (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT,
  role TEXT,
  description TEXT,
  traits_json TEXT,
  goal TEXT,
  notes TEXT,
  sort_order INTEGER,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bible_category ON bible_entries(category, sort_order);

CREATE TABLE IF NOT EXISTS relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_name TEXT,
  to_name TEXT,
  type TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_name);

CREATE TABLE IF NOT EXISTS relation_positions (
  name TEXT PRIMARY KEY,
  x REAL,
  y REAL
);

CREATE TABLE IF NOT EXISTS relations_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS power (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY,
  title TEXT,
  map TEXT,
  goal TEXT,
  power_ceiling TEXT,
  exit_criteria TEXT,
  target_chapters INTEGER,
  sort_order INTEGER,
  extra_json TEXT
);

CREATE TABLE IF NOT EXISTS outline_chapters (
  id TEXT PRIMARY KEY,
  number INTEGER UNIQUE,
  volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
  title TEXT,
  synopsis TEXT,
  status TEXT,
  word_budget INTEGER,
  inputs_json TEXT,
  plant_json TEXT,
  payoff_json TEXT,
  created_at TEXT,
  updated_at TEXT,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_outline_number ON outline_chapters(number);
CREATE INDEX IF NOT EXISTS idx_outline_volume ON outline_chapters(volume_id, number);

CREATE TABLE IF NOT EXISTS outline_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT,
  logline TEXT,
  extra_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chapter_meta (
  number INTEGER PRIMARY KEY,
  json TEXT,
  status TEXT,
  word_count INTEGER,
  outline_hash TEXT,
  has_draft INTEGER DEFAULT 0,
  has_final INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chapter_qa (
  number INTEGER PRIMARY KEY,
  qa_json TEXT,
  style_qa_json TEXT,
  continuity_json TEXT
);

CREATE TABLE IF NOT EXISTS chapter_state (
  number INTEGER PRIMARY KEY,
  json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chapter_summary (
  number INTEGER PRIMARY KEY,
  json TEXT,
  summary TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS state_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS stats_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  number INTEGER,
  words INTEGER,
  action TEXT,
  time TEXT
);

CREATE TABLE IF NOT EXISTS stats_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  kind TEXT,
  task TEXT,
  number INTEGER,
  json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS prompt_overrides (
  key TEXT PRIMARY KEY,
  text TEXT,
  base_hash TEXT,
  base_revision INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter INTEGER,
  text TEXT,
  source TEXT,
  created_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_chapters USING fts5(number UNINDEXED, title, body, tokenize='trigram');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_outline USING fts5(number UNINDEXED, title, synopsis, tokenize='trigram');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_bible USING fts5(entry_id UNINDEXED, category, name, description, tokenize='trigram');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_summaries USING fts5(number UNINDEXED, summary, characters, events, tokenize='trigram');
`

/** 打开数据库并确保 PRAGMA 与 schema 就绪。 */
export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  ensureSchema(db)
  return db
}

/**
 * 按 PRAGMA user_version 建表/升级。
 * v2：chapter_meta 增加 has_draft / has_final（正文存在性入库，避免每次递归扫目录）。
 * 升级在一个事务内完成（ALTER TABLE + 置版本），旧库数据原样保留。
 */
export function ensureSchema(db) {
  const row = db.prepare('PRAGMA user_version').get()
  const current = Number(row?.user_version ?? 0)
  if (current >= SCHEMA_VERSION) return current
  transaction(db, () => {
    db.exec(SCHEMA_SQL)
    if (current < 2) {
      const columns = new Set(db.prepare("PRAGMA table_info('chapter_meta')").all().map((item) => item.name))
      if (!columns.has('has_draft')) db.exec('ALTER TABLE chapter_meta ADD COLUMN has_draft INTEGER DEFAULT 0')
      if (!columns.has('has_final')) db.exec('ALTER TABLE chapter_meta ADD COLUMN has_final INTEGER DEFAULT 0')
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  })
  return SCHEMA_VERSION
}

/** 判断是否 SQLite busy/locked 错误（可安全重试）。 */
export function isBusyError(error) {
  const code = error?.errcode ?? error?.code
  if (code === 5 || code === 6 || code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true
  const message = String(error?.message ?? error ?? '')
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(message)
}

function sleepSync(ms) {
  if (!(ms > 0)) return
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, ms)
}

/**
 * 有界重试：只对 SQLITE_BUSY / SQLITE_LOCKED 重试（默认 3 次，100ms 起指数退避）。
 * node:sqlite 是同步 API，等待用 Atomics.wait 阻塞；busy_timeout=5000 已先兜底，这里处理极端情况。
 */
export function withBusyRetry(fn, options = {}) {
  const attempts = Math.max(1, Number(options.attempts ?? 3))
  const delayMs = Math.max(0, Number(options.delayMs ?? 100))
  const maxDelayMs = Math.max(delayMs, Number(options.maxDelayMs ?? 1000))
  let attempt = 0
  for (;;) {
    try {
      return fn()
    } catch (error) {
      attempt += 1
      if (!isBusyError(error) || attempt >= attempts) throw error
      options.onRetry?.(attempt, error)
      sleepSync(Math.min(delayMs * 2 ** (attempt - 1), maxDelayMs))
    }
  }
}

/**
 * 同步事务：BEGIN IMMEDIATE / COMMIT / ROLLBACK。
 * 嵌套调用退化为直接执行（由最外层负责提交/回滚）。回调必须是同步函数。
 */
export function transaction(db, fn) {
  if (activeTransactions.has(db)) return fn()
  withBusyRetry(() => db.exec('BEGIN IMMEDIATE'))
  activeTransactions.add(db)
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      throw new Error('transaction 只支持同步回调')
    }
    withBusyRetry(() => db.exec('COMMIT'))
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 已经回滚或事务未建立
    }
    throw error
  } finally {
    activeTransactions.delete(db)
  }
}

/** 解析 TEXT 列里的 JSON；坏值/空值返回 fallback。 */
export function jsonGet(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/** 序列化 JSON 列；undefined → null。 */
export function jsonSet(value) {
  if (value === undefined) return null
  return JSON.stringify(value)
}
