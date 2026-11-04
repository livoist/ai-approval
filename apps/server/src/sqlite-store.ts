import Database from 'better-sqlite3'
import type { AiReview, ApprovalRequest, AuditEvent, Store } from './store'

// 資料表結構
// - 欄位用 snake_case（資料庫慣例），TypeScript 物件用 camelCase，中間由 toXxx() 轉換
// - findings 是陣列，存成 JSON 字串；只會整包讀寫、不會拿來查詢，所以不必另開一張表
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS requests (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL,
    applicant_id TEXT NOT NULL,
    status       TEXT NOT NULL,
    version      INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id          TEXT PRIMARY KEY,
    request_id  TEXT NOT NULL REFERENCES requests(id),
    actor_id    TEXT NOT NULL,
    actor_role  TEXT NOT NULL,
    event       TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    at          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_events(request_id);

  -- 審計紀錄不可竄改：在資料庫層直接禁止 UPDATE 與 DELETE
  -- 就算程式碼寫錯、或有人直接連進資料庫下指令，也改不了歷史
  CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

  CREATE TABLE IF NOT EXISTS ai_reviews (
    id              TEXT PRIMARY KEY,
    request_id      TEXT NOT NULL REFERENCES requests(id),
    request_version INTEGER NOT NULL,
    status          TEXT NOT NULL,
    risk_level      TEXT,
    summary         TEXT,
    findings_json   TEXT,
    error           TEXT,
    reviewer        TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_request ON ai_reviews(request_id);
`

// 資料庫回傳的一列（row）的形狀
interface RequestRow {
  id: string
  title: string
  description: string
  applicant_id: string
  status: string
  version: number
  created_at: string
  updated_at: string
}
interface AuditRow {
  id: string
  request_id: string
  actor_id: string
  actor_role: string
  event: string
  from_status: string | null
  to_status: string
  at: string
}
interface ReviewRow {
  id: string
  request_id: string
  request_version: number
  status: string
  risk_level: string | null
  summary: string | null
  findings_json: string | null
  error: string | null
  reviewer: string
  created_at: string
}

const toRequest = (r: RequestRow): ApprovalRequest => ({
  id: r.id,
  title: r.title,
  description: r.description,
  applicantId: r.applicant_id,
  status: r.status as ApprovalRequest['status'],
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toAudit = (r: AuditRow): AuditEvent => ({
  id: r.id,
  requestId: r.request_id,
  actor: { id: r.actor_id, role: r.actor_role as AuditEvent['actor']['role'] },
  event: r.event as AuditEvent['event'],
  from: r.from_status as AuditEvent['from'],
  to: r.to_status as AuditEvent['to'],
  at: r.at,
})

// SQL 的 NULL 讀出來是 null，但我們的型別用「欄位不存在」表示沒有值，所以轉成 undefined
const toReview = (r: ReviewRow): AiReview => ({
  id: r.id,
  requestId: r.request_id,
  requestVersion: r.request_version,
  status: r.status as AiReview['status'],
  riskLevel: (r.risk_level ?? undefined) as AiReview['riskLevel'],
  summary: r.summary ?? undefined,
  findings: r.findings_json ? JSON.parse(r.findings_json) : undefined,
  error: r.error ?? undefined,
  reviewer: r.reviewer,
  createdAt: r.created_at,
})

// path 傳 ':memory:' 會建立一個只存在記憶體的資料庫，測試時很好用
export function createSqliteStore(path: string): Store {
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL') // 讀寫可以同時進行，效能較好
  db.exec('PRAGMA foreign_keys = ON') // 讓 REFERENCES 真的生效
  db.exec(SCHEMA)

  // prepare 一次、重複使用：SQL 只解析一次，而且用 ? 帶參數可以防止 SQL injection
  const stmt = {
    getRequest: db.prepare('SELECT * FROM requests WHERE id = ?'),
    listRequests: db.prepare('SELECT * FROM requests ORDER BY rowid'),
    // upsert：沒有就新增，有就更新
    saveRequest: db.prepare(`
      INSERT INTO requests (id, title, description, applicant_id, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        version = excluded.version,
        updated_at = excluded.updated_at
    `),
    appendAudit: db.prepare(`
      INSERT INTO audit_events (id, request_id, actor_id, actor_role, event, from_status, to_status, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAudit: db.prepare('SELECT * FROM audit_events WHERE request_id = ? ORDER BY rowid'),
    appendReview: db.prepare(`
      INSERT INTO ai_reviews (id, request_id, request_version, status, risk_level, summary, findings_json, error, reviewer, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listReviews: db.prepare('SELECT * FROM ai_reviews WHERE request_id = ? ORDER BY rowid'),
  }

  return {
    getRequest(id) {
      const row = stmt.getRequest.get(id) as RequestRow | undefined
      return row ? toRequest(row) : undefined
    },
    listRequests() {
      return (stmt.listRequests.all() as RequestRow[]).map(toRequest)
    },
    saveRequest(r) {
      stmt.saveRequest.run(
        r.id,
        r.title,
        r.description,
        r.applicantId,
        r.status,
        r.version,
        r.createdAt,
        r.updatedAt,
      )
    },
    appendAudit(e) {
      stmt.appendAudit.run(e.id, e.requestId, e.actor.id, e.actor.role, e.event, e.from, e.to, e.at)
    },
    listAudit(requestId) {
      return (stmt.listAudit.all(requestId) as AuditRow[]).map(toAudit)
    },
    appendReview(r) {
      stmt.appendReview.run(
        r.id,
        r.requestId,
        r.requestVersion,
        r.status,
        r.riskLevel ?? null,
        r.summary ?? null,
        r.findings ? JSON.stringify(r.findings) : null,
        r.error ?? null,
        r.reviewer,
        r.createdAt,
      )
    },
    listReviews(requestId) {
      return (stmt.listReviews.all(requestId) as ReviewRow[]).map(toReview)
    },
  }
}
