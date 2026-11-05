import Database from 'better-sqlite3'
import type {
  AiReview,
  ApprovalRequest,
  AuditEvent,
  FindingFeedback,
  Store,
  StoredPolicyChunk,
  StoredPolicyDoc,
} from './store'

// 資料表結構
// - 欄位用 snake_case（資料庫慣例），TypeScript 物件用 camelCase，中間由 toXxx() 轉換
// - findings 是陣列，存成 JSON 字串；只會整包讀寫、不會拿來查詢，所以不必另開一張表
//
// 資料庫遷移（migration）：資料表上線之後就不能隨便改了，因為裡面已經有資料
// 所以每次改結構都「新增一個步驟」，而不是修改舊的 SQL
// SQLite 的 PRAGMA user_version 記錄目前做到第幾步，啟動時只補做還沒做過的
const MIGRATION_1 = `
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

  -- 主管對 AI 意見的評價：跟審計紀錄一樣只能新增
  -- 改主意就再新增一筆，畫面上顯示最新的，舊的判斷永遠查得到
  CREATE TABLE IF NOT EXISTS finding_feedback (
    id            TEXT PRIMARY KEY,
    review_id     TEXT NOT NULL REFERENCES ai_reviews(id),
    finding_index INTEGER NOT NULL,
    verdict       TEXT NOT NULL CHECK (verdict IN ('correct', 'incorrect')),
    note          TEXT NOT NULL,
    actor_id      TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_review ON finding_feedback(review_id);
  CREATE TRIGGER IF NOT EXISTS feedback_no_update BEFORE UPDATE ON finding_feedback
  BEGIN SELECT RAISE(ABORT, 'finding_feedback is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS feedback_no_delete BEFORE DELETE ON finding_feedback
  BEGIN SELECT RAISE(ABORT, 'finding_feedback is append-only'); END;
`

// 第 2 步：申請單改成結構化表單
// 舊的 description 欄位保留不刪：SQLite 刪欄位很麻煩，而且舊資料可能還用得到
const MIGRATION_2 = `
  ALTER TABLE requests ADD COLUMN form_type TEXT NOT NULL DEFAULT 'maintenance';
  ALTER TABLE requests ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
`

// 第 3 步：主管匯入的規範文件，以及每次預審交給 AI 的條文
// 規範文件不提供修改與刪除：過去的預審引用過這些條文，刪掉就查不到 AI 當時依據的是什麼
const MIGRATION_3 = `
  CREATE TABLE IF NOT EXISTS policy_docs (
    id         TEXT PRIMARY KEY,
    form_type  TEXT NOT NULL,
    title      TEXT NOT NULL,
    file_name  TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS policy_chunks (
    id       TEXT PRIMARY KEY,
    doc_id   TEXT NOT NULL REFERENCES policy_docs(id),
    section  TEXT NOT NULL,
    text     TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON policy_chunks(doc_id);

  ALTER TABLE ai_reviews ADD COLUMN retrieved_json TEXT;
`

const MIGRATIONS = [MIGRATION_1, MIGRATION_2, MIGRATION_3]

function migrate(db: Database.Database) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    // 每一步包在交易（transaction）裡：要嘛整步成功，要嘛完全沒發生，不會改到一半
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

// 資料庫回傳的一列（row）的形狀
interface RequestRow {
  id: string
  form_type: string
  title: string
  fields_json: string
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
  retrieved_json: string | null
  created_at: string
}

interface PolicyDocRow {
  id: string
  form_type: string
  title: string
  file_name: string | null
  created_by: string
  created_at: string
}

interface PolicyChunkRow {
  id: string
  doc_id: string
  section: string
  text: string
}

interface FeedbackRow {
  id: string
  review_id: string
  finding_index: number
  verdict: string
  note: string
  actor_id: string
  created_at: string
}

const toFeedback = (r: FeedbackRow): FindingFeedback => ({
  id: r.id,
  reviewId: r.review_id,
  findingIndex: r.finding_index,
  verdict: r.verdict as FindingFeedback['verdict'],
  note: r.note,
  actorId: r.actor_id,
  createdAt: r.created_at,
})

const toRequest = (r: RequestRow): ApprovalRequest => ({
  id: r.id,
  formType: r.form_type,
  title: r.title,
  fields: JSON.parse(r.fields_json),
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
  ...(r.retrieved_json ? { retrievedPolicyIds: JSON.parse(r.retrieved_json) } : {}),
  createdAt: r.created_at,
})

// path 傳 ':memory:' 會建立一個只存在記憶體的資料庫，測試時很好用
export function createSqliteStore(path: string): Store {
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL') // 讀寫可以同時進行，效能較好
  db.exec('PRAGMA foreign_keys = ON') // 讓 REFERENCES 真的生效
  migrate(db)

  // prepare 一次、重複使用：SQL 只解析一次，而且用 ? 帶參數可以防止 SQL injection
  const stmt = {
    getRequest: db.prepare('SELECT * FROM requests WHERE id = ?'),
    listRequests: db.prepare('SELECT * FROM requests ORDER BY rowid'),
    // upsert：沒有就新增，有就更新
    saveRequest: db.prepare(`
      INSERT INTO requests (id, form_type, title, description, fields_json, applicant_id, status, version, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        fields_json = excluded.fields_json,
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
      INSERT INTO ai_reviews (id, request_id, request_version, status, risk_level, summary, findings_json, error, reviewer, retrieved_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listReviews: db.prepare('SELECT * FROM ai_reviews WHERE request_id = ? ORDER BY rowid'),
    appendFeedback: db.prepare(`
      INSERT INTO finding_feedback (id, review_id, finding_index, verdict, note, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listFeedback: db.prepare('SELECT * FROM finding_feedback WHERE review_id = ? ORDER BY rowid'),
    appendPolicyDoc: db.prepare(`
      INSERT INTO policy_docs (id, form_type, title, file_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `),
    appendPolicyChunk: db.prepare(`
      INSERT INTO policy_chunks (id, doc_id, section, text, position) VALUES (?, ?, ?, ?, ?)
    `),
    listPolicyDocs: db.prepare('SELECT * FROM policy_docs ORDER BY rowid'),
    listPolicyChunks: db.prepare(`
      SELECT c.* FROM policy_chunks c JOIN policy_docs d ON d.id = c.doc_id ORDER BY d.rowid, c.position
    `),
  }

  // db.transaction 包起來的函式：裡面任何一行出錯，前面寫進去的也會一起取消
  const appendPolicyDoc = db.transaction((doc: StoredPolicyDoc, chunks: StoredPolicyChunk[]) => {
    stmt.appendPolicyDoc.run(doc.id, doc.formType, doc.title, doc.fileName, doc.createdBy, doc.createdAt)
    chunks.forEach((c, i) => stmt.appendPolicyChunk.run(c.id, c.docId, c.section, c.text, i))
  })

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
        r.formType,
        r.title,
        JSON.stringify(r.fields),
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
        r.retrievedPolicyIds ? JSON.stringify(r.retrievedPolicyIds) : null,
        r.createdAt,
      )
    },
    listReviews(requestId) {
      return (stmt.listReviews.all(requestId) as ReviewRow[]).map(toReview)
    },
    appendFeedback(f) {
      stmt.appendFeedback.run(
        f.id,
        f.reviewId,
        f.findingIndex,
        f.verdict,
        f.note,
        f.actorId,
        f.createdAt,
      )
    },
    listFeedback(reviewId) {
      return (stmt.listFeedback.all(reviewId) as FeedbackRow[]).map(toFeedback)
    },
    appendPolicyDoc,
    listPolicyDocs() {
      return (stmt.listPolicyDocs.all() as PolicyDocRow[]).map((r) => ({
        id: r.id,
        formType: r.form_type,
        title: r.title,
        fileName: r.file_name,
        createdBy: r.created_by,
        createdAt: r.created_at,
      }))
    },
    listPolicyChunks() {
      return (stmt.listPolicyChunks.all() as PolicyChunkRow[]).map((r) => ({
        id: r.id,
        docId: r.doc_id,
        section: r.section,
        text: r.text,
      }))
    },
  }
}
