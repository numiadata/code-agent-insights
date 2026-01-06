import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type {
  Session,
  Event,
  ToolCall,
  ErrorRecord,
  Learning,
  SkillInvocation,
  SubAgentInvocation,
  ToolSequence,
  SessionModes,
} from '../types';

interface SessionQueryOptions {
  projectPath?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

interface EventSearchOptions {
  sessionId?: string;
  limit?: number;
}

interface LearningQueryOptions {
  projectPath?: string;
  type?: string;
  limit?: number;
}

interface Stats {
  totalSessions: number;
  totalTokens: number;
  totalErrors: number;
  totalLearnings: number;
  sessionsBySource: Array<{ source: string; count: number }>;
  sessionsByOutcome: Array<{ outcome: string; count: number }>;
}

interface SkillStats {
  skillName: string;
  usageCount: number;
  successRate: number;
}

interface SubAgentStats {
  outcome: string;
  count: number;
  avgTokens: number;
}

interface ToolPatternStats {
  tools: string;
  count: number;
  successRate: number;
}

interface ModeEffectiveness {
  mode: string;
  withMode: { success: number; total: number };
  withoutMode: { success: number; total: number };
}

export class InsightsDatabase {
  private db: Database.Database;
  private dataDir: string;

  constructor(dbPath?: string) {
    // Default data directory: ~/.code-agent-insights/
    this.dataDir = dbPath
      ? path.dirname(dbPath)
      : path.join(process.env.HOME || '', '.code-agent-insights');

    // Create directory if not exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const finalDbPath = dbPath || path.join(this.dataDir, 'insights.db');

    // Open database with WAL mode pragma
    this.db = new Database(finalDbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Run migrations
    this.runMigrations();
  }

  /**
   * Sanitize a query string for FTS5 search.
   * - Removes FTS operators that could cause syntax errors
   * - Handles special characters
   * - Returns null for empty or invalid queries
   */
  private sanitizeFTSQuery(query: string): string | null {
    if (!query || query.trim().length === 0) {
      return null;  // Signal to skip FTS search
    }

    let sanitized = query.trim();

    // Remove or escape FTS5 special characters
    // FTS5 operators: AND, OR, NOT, NEAR, *, ^, "

    // Replace special characters with spaces
    sanitized = sanitized
      .replace(/[.*+?^${}()|[\]\\]/g, ' ')  // Regex special chars
      .replace(/["']/g, ' ')                  // Quotes
      .replace(/[-:]/g, ' ')                  // Common operators
      .replace(/\s+/g, ' ')                   // Collapse whitespace
      .trim();

    // If query is now empty or too short, return null
    if (sanitized.length < 2) {
      return null;
    }

    // Split into words and join with implicit AND (space in FTS5)
    const words = sanitized.split(' ').filter(w => w.length >= 2);

    if (words.length === 0) {
      return null;
    }

    // Use * suffix for prefix matching (more forgiving)
    return words.map(w => `${w}*`).join(' ');
  }

  private runMigrations(): void {
    // Check current schema version
    let currentVersion = 0;
    try {
      const result = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
      currentVersion = result?.version || 0;
    } catch {
      // schema_version table doesn't exist yet
    }

    // Migration 1 - Core tables
    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          project_path TEXT NOT NULL,
          project_name TEXT,
          git_branch TEXT,
          git_user TEXT,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          status TEXT DEFAULT 'completed',
          token_count INTEGER DEFAULT 0,
          turn_count INTEGER DEFAULT 0,
          tool_call_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          files_modified INTEGER DEFAULT 0,
          raw_path TEXT UNIQUE,
          summary TEXT,
          outcome TEXT DEFAULT 'unknown',
          skill_invocation_count INTEGER DEFAULT 0,
          sub_agent_count INTEGER DEFAULT 0,
          used_plan_mode INTEGER DEFAULT 0,
          used_thinking INTEGER DEFAULT 0,
          primary_tools TEXT DEFAULT '[]',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
        CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          sequence_number REAL NOT NULL,
          content TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

        CREATE TABLE IF NOT EXISTS tool_calls (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          event_id TEXT,
          tool_name TEXT NOT NULL,
          parameters TEXT,
          result TEXT,
          success INTEGER DEFAULT 1,
          duration_ms INTEGER,
          timestamp TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id),
          FOREIGN KEY (event_id) REFERENCES events(id)
        );

        CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

        CREATE TABLE IF NOT EXISTS errors (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          event_id TEXT,
          error_type TEXT,
          error_message TEXT,
          stack_trace TEXT,
          file_path TEXT,
          line_number INTEGER,
          resolved INTEGER DEFAULT 0,
          resolution_event_id TEXT,
          timestamp TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_errors_session ON errors(session_id);
        CREATE INDEX IF NOT EXISTS idx_errors_type ON errors(error_type);

        CREATE TABLE IF NOT EXISTS learnings (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          project_path TEXT,
          content TEXT NOT NULL,
          type TEXT NOT NULL,
          scope TEXT DEFAULT 'project',
          confidence REAL DEFAULT 1.0,
          tags TEXT DEFAULT '[]',
          related_files TEXT DEFAULT '[]',
          related_errors TEXT DEFAULT '[]',
          source TEXT DEFAULT 'extracted',
          applied_count INTEGER DEFAULT 0,
          last_applied_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_path);
        CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings(type);

        -- FTS tables
        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
          content,
          session_id UNINDEXED,
          event_id UNINDEXED
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
          content,
          tags,
          learning_id UNINDEXED
        );
      `);
    }

    // Migration 2 - Feature tracking tables
    if (currentVersion < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS skill_invocations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          skill_path TEXT NOT NULL,
          skill_name TEXT NOT NULL,
          skill_category TEXT NOT NULL,
          invoked_at TEXT NOT NULL,
          sequence_number INTEGER,
          context_before TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_skill_invocations_session ON skill_invocations(session_id);
        CREATE INDEX IF NOT EXISTS idx_skill_invocations_name ON skill_invocations(skill_name);

        CREATE TABLE IF NOT EXISTS sub_agent_invocations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          parent_event_id TEXT,
          task_description TEXT,
          tools_allowed TEXT DEFAULT '[]',
          started_at TEXT NOT NULL,
          ended_at TEXT,
          token_count INTEGER DEFAULT 0,
          turn_count INTEGER DEFAULT 0,
          outcome TEXT DEFAULT 'unknown',
          result_summary TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_sub_agent_session ON sub_agent_invocations(session_id);
        CREATE INDEX IF NOT EXISTS idx_sub_agent_outcome ON sub_agent_invocations(outcome);

        CREATE TABLE IF NOT EXISTS tool_sequences (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          tools TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          success INTEGER DEFAULT 1,
          task_type TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_tool_sequences_session ON tool_sequences(session_id);

        CREATE TABLE IF NOT EXISTS session_modes (
          session_id TEXT PRIMARY KEY,
          used_plan_mode INTEGER DEFAULT 0,
          plan_mode_count INTEGER DEFAULT 0,
          used_thinking INTEGER DEFAULT 0,
          thinking_block_count INTEGER DEFAULT 0,
          used_compact INTEGER DEFAULT 0,
          used_sub_agents INTEGER DEFAULT 0,
          sub_agent_count INTEGER DEFAULT 0,
          skills_used TEXT DEFAULT '[]',
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY
        );

        INSERT OR IGNORE INTO schema_version (version) VALUES (2);
      `);
    }

    // Migration 3 - Add used_sub_agents to sessions table
    if (currentVersion < 3) {
      this.db.exec(`
        ALTER TABLE sessions ADD COLUMN used_sub_agents INTEGER DEFAULT 0;

        UPDATE schema_version SET version = 3;
      `);
    }

    // Migration 4 - Add reviewed fields to learnings table
    if (currentVersion < 4) {
      this.db.exec(`
        ALTER TABLE learnings ADD COLUMN reviewed INTEGER DEFAULT 0;
        ALTER TABLE learnings ADD COLUMN reviewed_at TEXT;

        UPDATE schema_version SET version = 4;
      `);
    }
  }

  // ============================================================================
  // Session methods
  // ============================================================================

  insertSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, source, project_path, project_name, git_branch, git_user,
        started_at, ended_at, status, token_count, turn_count,
        tool_call_count, error_count, files_modified, raw_path,
        summary, outcome, skill_invocation_count, sub_agent_count,
        used_plan_mode, used_thinking, used_sub_agents, primary_tools
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      session.id,
      session.source,
      session.projectPath,
      session.projectName,
      session.gitBranch || null,
      session.gitUser || null,
      session.startedAt.toISOString(),
      session.endedAt?.toISOString() || null,
      session.status,
      session.tokenCount,
      session.turnCount,
      session.toolCallCount,
      session.errorCount,
      session.filesModified,
      session.rawPath,
      session.summary || null,
      session.outcome,
      session.skillInvocationCount,
      session.subAgentCount,
      session.usedPlanMode ? 1 : 0,
      session.usedThinking ? 1 : 0,
      session.usedSubAgents ? 1 : 0,
      JSON.stringify(session.primaryTools)
    );
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id);
    return row ? this.rowToSession(row) : null;
  }

  sessionExists(rawPath: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM sessions WHERE raw_path = ?');
    return !!stmt.get(rawPath);
  }

  getSessions(options: SessionQueryOptions = {}): Session[] {
    let query = 'SELECT * FROM sessions WHERE 1=1';
    const params: any[] = [];

    if (options.projectPath) {
      query += ' AND project_path = ?';
      params.push(options.projectPath);
    }

    if (options.source) {
      query += ' AND source = ?';
      params.push(options.source);
    }

    query += ' ORDER BY started_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map(row => this.rowToSession(row));
  }

  updateSessionSummary(id: string, summary: string, outcome: string): void {
    const stmt = this.db.prepare('UPDATE sessions SET summary = ?, outcome = ? WHERE id = ?');
    stmt.run(summary, outcome, id);
  }

  /**
   * Delete a session and all its related data.
   * Note: Learnings are preserved to maintain extracted knowledge.
   */
  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM errors WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM skill_invocations WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sub_agent_invocations WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM tool_sequences WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM session_modes WHERE session_id = ?').run(sessionId);
    // Don't delete learnings - keep extracted knowledge
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  /**
   * Delete a session by its raw file path.
   * Useful for reindexing sessions with improved parser.
   */
  deleteSessionByPath(rawPath: string): void {
    const session = this.db.prepare('SELECT id FROM sessions WHERE raw_path = ?').get(rawPath) as any;
    if (session) {
      this.deleteSession(session.id);
    }
  }

  // ============================================================================
  // Event methods
  // ============================================================================

  insertEvents(events: Event[]): void {
    const insertStmt = this.db.prepare(`
      INSERT INTO events (id, session_id, type, timestamp, sequence_number, content, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFtsStmt = this.db.prepare(`
      INSERT INTO events_fts (event_id, session_id, content)
      VALUES (?, ?, ?)
    `);

    const transaction = this.db.transaction((events: Event[]) => {
      for (const event of events) {
        insertStmt.run(
          event.id,
          event.sessionId,
          event.type,
          event.timestamp.toISOString(),
          event.sequenceNumber,
          event.content || null,
          event.metadata ? JSON.stringify(event.metadata) : null
        );

        // Insert into FTS if content exists
        if (event.content) {
          insertFtsStmt.run(event.id, event.sessionId, event.content);
        }
      }
    });

    transaction(events);
  }

  getEvents(sessionId: string): Event[] {
    const stmt = this.db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY sequence_number');
    const rows = stmt.all(sessionId);
    return rows.map(row => this.rowToEvent(row));
  }

  // ============================================================================
  // Tool call methods
  // ============================================================================

  insertToolCalls(toolCalls: ToolCall[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO tool_calls (id, session_id, event_id, tool_name, parameters, result, success, duration_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((toolCalls: ToolCall[]) => {
      for (const toolCall of toolCalls) {
        stmt.run(
          toolCall.id,
          toolCall.sessionId,
          toolCall.eventId,
          toolCall.toolName,
          JSON.stringify(toolCall.parameters),
          toolCall.result || null,
          toolCall.success ? 1 : 0,
          toolCall.durationMs || null,
          toolCall.timestamp.toISOString()
        );
      }
    });

    transaction(toolCalls);
  }

  getToolCalls(sessionId: string): ToolCall[] {
    const stmt = this.db.prepare('SELECT * FROM tool_calls WHERE session_id = ? ORDER BY timestamp');
    const rows = stmt.all(sessionId);
    return rows.map(row => this.rowToToolCall(row));
  }

  // ============================================================================
  // Error methods
  // ============================================================================

  insertErrors(errors: ErrorRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO errors (id, session_id, event_id, error_type, error_message, stack_trace, file_path, line_number, resolved, resolution_event_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((errors: ErrorRecord[]) => {
      for (const error of errors) {
        stmt.run(
          error.id,
          error.sessionId,
          error.eventId,
          error.errorType,
          error.errorMessage,
          error.stackTrace || null,
          error.filePath || null,
          error.lineNumber || null,
          error.resolved ? 1 : 0,
          error.resolutionEventId || null,
          error.timestamp.toISOString()
        );
      }
    });

    transaction(errors);
  }

  getErrors(sessionId: string): ErrorRecord[] {
    const stmt = this.db.prepare('SELECT * FROM errors WHERE session_id = ? ORDER BY timestamp');
    const rows = stmt.all(sessionId);
    return rows.map(row => this.rowToErrorRecord(row));
  }

  searchErrors(query: string, options: { errorType?: string; limit?: number } = {}): ErrorRecord[] {
    const limit = options.limit || 10;

    // Errors don't use FTS, just use LIKE with basic sanitization
    const safeQuery = query.replace(/[%_]/g, '\\$&');  // Escape LIKE wildcards

    let sql = `
      SELECT e.*, s.project_name, s.started_at as session_date
      FROM errors e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.error_message LIKE ?
    `;
    const params: any[] = [`%${safeQuery}%`];

    if (options.errorType) {
      sql += ' AND e.error_type LIKE ?';
      params.push(`%${options.errorType}%`);
    }

    sql += ' ORDER BY e.timestamp DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params).map(row => this.rowToErrorRecord(row));
  }

  getSessionsForFile(
    filePath: string,
    limit: number = 5
  ): Array<{ session: Session; operations: string[] }> {
    const fileName = path.basename(filePath);

    // Search for both dedicated file events AND tool_call events with matching paths
    const sql = `
      SELECT
        s.*,
        GROUP_CONCAT(DISTINCT
          CASE
            WHEN e.type = 'file_read' THEN 'Read'
            WHEN e.type = 'file_write' THEN 'Write'
            WHEN e.type = 'file_create' THEN 'Create'
            WHEN e.type = 'tool_call' AND e.content IN ('view', 'Read', 'read_file', 'Glob', 'Grep') THEN 'Read'
            WHEN e.type = 'tool_call' AND e.content IN ('str_replace', 'Edit', 'edit_file') THEN 'Write'
            WHEN e.type = 'tool_call' AND e.content IN ('create_file', 'Write') THEN 'Create'
            ELSE e.type
          END
        ) as operations
      FROM sessions s
      JOIN events e ON e.session_id = s.id
      WHERE (
        -- Match dedicated file events
        (e.type IN ('file_read', 'file_write', 'file_create') AND (e.content LIKE ? OR e.content LIKE ?))
        OR
        -- Match tool_call events where metadata contains the file path
        (e.type = 'tool_call' AND e.metadata LIKE ? AND e.metadata LIKE ?)
      )
      GROUP BY s.id
      ORDER BY s.started_at DESC
      LIMIT ?
    `;

    const fullPathPattern = `%${filePath}%`;
    const fileNamePattern = `%${fileName}%`;

    try {
      const rows = this.db.prepare(sql).all(
        fullPathPattern,
        fileNamePattern,
        fullPathPattern,
        fileNamePattern,
        limit
      ) as any[];

      return rows.map((row) => ({
        session: this.rowToSession(row),
        operations: (row.operations || 'unknown').split(',').filter(Boolean),
      }));
    } catch (error) {
      console.error('getSessionsForFile error:', error);
      return [];
    }
  }

  getSessionsForFileSimple(
    filePath: string,
    limit: number = 5
  ): Array<{ session: Session; operations: string[] }> {
    const fileName = path.basename(filePath);

    // Simple search: find any event mentioning the file
    const sql = `
      SELECT DISTINCT s.*, 'unknown' as operations
      FROM sessions s
      JOIN events e ON e.session_id = s.id
      WHERE e.content LIKE ? OR e.content LIKE ? OR e.metadata LIKE ? OR e.metadata LIKE ?
      ORDER BY s.started_at DESC
      LIMIT ?
    `;

    try {
      const rows = this.db.prepare(sql).all(
        `%${filePath}%`,
        `%${fileName}%`,
        `%${filePath}%`,
        `%${fileName}%`,
        limit
      ) as any[];

      return rows.map((row) => ({
        session: this.rowToSession(row),
        operations: ['referenced'],
      }));
    } catch (error) {
      console.error('getSessionsForFileSimple error:', error);
      return [];
    }
  }

  // ============================================================================
  // Learning methods
  // ============================================================================

  insertLearning(learning: Learning): void {
    const insertStmt = this.db.prepare(`
      INSERT INTO learnings (id, session_id, project_path, content, type, scope, confidence, tags, related_files, related_errors, source, applied_count, last_applied_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFtsStmt = this.db.prepare(`
      INSERT INTO learnings_fts (learning_id, content, tags)
      VALUES (?, ?, ?)
    `);

    insertStmt.run(
      learning.id,
      learning.sessionId || null,
      learning.projectPath || null,
      learning.content,
      learning.type,
      learning.scope,
      learning.confidence,
      JSON.stringify(learning.tags),
      JSON.stringify(learning.relatedFiles),
      JSON.stringify(learning.relatedErrors),
      learning.source,
      learning.appliedCount,
      learning.lastAppliedAt?.toISOString() || null,
      learning.createdAt.toISOString()
    );

    // Insert into FTS
    insertFtsStmt.run(learning.id, learning.content, learning.tags.join(' '));
  }

  getLearnings(options: LearningQueryOptions = {}): Learning[] {
    let query = 'SELECT * FROM learnings WHERE 1=1';
    const params: any[] = [];

    if (options.projectPath) {
      query += ' AND project_path = ?';
      params.push(options.projectPath);
    }

    if (options.type) {
      query += ' AND type = ?';
      params.push(options.type);
    }

    query += ' ORDER BY created_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map(row => this.rowToLearning(row));
  }

  incrementLearningApplied(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE learnings
      SET applied_count = applied_count + 1, last_applied_at = ?
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  // ============================================================================
  // Feature tracking methods
  // ============================================================================

  insertSkillInvocations(invocations: SkillInvocation[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO skill_invocations (id, session_id, skill_path, skill_name, skill_category, invoked_at, sequence_number, context_before)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((invocations: SkillInvocation[]) => {
      for (const inv of invocations) {
        stmt.run(
          inv.id,
          inv.sessionId,
          inv.skillPath,
          inv.skillName,
          inv.skillCategory,
          inv.invokedAt.toISOString(),
          inv.sequenceNumber,
          inv.contextBefore || null
        );
      }
    });

    transaction(invocations);
  }

  insertSubAgentInvocations(invocations: SubAgentInvocation[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO sub_agent_invocations (id, session_id, parent_event_id, task_description, tools_allowed, started_at, ended_at, token_count, turn_count, outcome, result_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((invocations: SubAgentInvocation[]) => {
      for (const inv of invocations) {
        stmt.run(
          inv.id,
          inv.sessionId,
          inv.parentEventId,
          inv.taskDescription,
          JSON.stringify(inv.toolsAllowed),
          inv.startedAt.toISOString(),
          inv.endedAt?.toISOString() || null,
          inv.tokenCount,
          inv.turnCount,
          inv.outcome,
          inv.resultSummary || null
        );
      }
    });

    transaction(invocations);
  }

  insertToolSequences(sequences: ToolSequence[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO tool_sequences (id, session_id, tools, started_at, ended_at, success, task_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((sequences: ToolSequence[]) => {
      for (const seq of sequences) {
        stmt.run(
          seq.id,
          seq.sessionId,
          JSON.stringify(seq.tools),
          seq.startedAt.toISOString(),
          seq.endedAt.toISOString(),
          seq.success ? 1 : 0,
          seq.taskType || null
        );
      }
    });

    transaction(sequences);
  }

  insertSessionModes(modes: SessionModes): void {
    const stmt = this.db.prepare(`
      INSERT INTO session_modes (session_id, used_plan_mode, plan_mode_count, used_thinking, thinking_block_count, used_compact, used_sub_agents, sub_agent_count, skills_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      modes.sessionId,
      modes.usedPlanMode ? 1 : 0,
      modes.planModeCount,
      modes.usedThinking ? 1 : 0,
      modes.thinkingBlockCount,
      modes.usedCompact ? 1 : 0,
      modes.usedSubAgents ? 1 : 0,
      modes.subAgentCount,
      JSON.stringify(modes.skillsUsed)
    );
  }

  // ============================================================================
  // Search methods
  // ============================================================================

  searchEvents(query: string, options: EventSearchOptions = {}): Event[] {
    const limit = options.limit || 20;
    const sanitizedQuery = this.sanitizeFTSQuery(query);

    // If query can't be sanitized, fall back to LIKE search
    if (!sanitizedQuery) {
      let sql = 'SELECT * FROM events WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?';
      const params: any[] = [`%${query}%`, limit];

      if (options.sessionId) {
        sql = 'SELECT * FROM events WHERE content LIKE ? AND session_id = ? ORDER BY timestamp DESC LIMIT ?';
        params.splice(1, 0, options.sessionId);
      }

      return this.db.prepare(sql).all(...params).map(row => this.rowToEvent(row));
    }

    // Use FTS with sanitized query
    try {
      let sql = `
        SELECT e.* FROM events e
        JOIN events_fts fts ON fts.event_id = e.id
        WHERE events_fts MATCH ?
      `;
      const params: any[] = [sanitizedQuery];

      if (options.sessionId) {
        sql += ' AND e.session_id = ?';
        params.push(options.sessionId);
      }

      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);

      return this.db.prepare(sql).all(...params).map(row => this.rowToEvent(row));
    } catch (error) {
      // If FTS still fails, fall back to LIKE
      console.error('FTS search failed, falling back to LIKE:', error);
      return this.db.prepare(
        'SELECT * FROM events WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?'
      ).all(`%${query}%`, limit).map(row => this.rowToEvent(row));
    }
  }

  searchLearnings(query: string, options: LearningQueryOptions = {}): Learning[] {
    const limit = options.limit || 10;
    const sanitizedQuery = this.sanitizeFTSQuery(query);

    // If query can't be sanitized, fall back to LIKE search
    if (!sanitizedQuery) {
      let sql = 'SELECT * FROM learnings WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?';
      const params: any[] = [`%${query}%`, limit];

      if (options.projectPath) {
        sql = `SELECT * FROM learnings WHERE content LIKE ? AND (project_path = ? OR scope = 'global') ORDER BY created_at DESC LIMIT ?`;
        params.splice(1, 0, options.projectPath);
      }

      return this.db.prepare(sql).all(...params).map(row => this.rowToLearning(row));
    }

    // Use FTS with sanitized query
    try {
      let sql = `
        SELECT l.* FROM learnings l
        JOIN learnings_fts fts ON fts.learning_id = l.id
        WHERE learnings_fts MATCH ?
      `;
      const params: any[] = [sanitizedQuery];

      if (options.projectPath) {
        sql += " AND (l.project_path = ? OR l.scope = 'global')";
        params.push(options.projectPath);
      }

      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);

      return this.db.prepare(sql).all(...params).map(row => this.rowToLearning(row));
    } catch (error) {
      // If FTS still fails, fall back to LIKE
      console.error('FTS search failed, falling back to LIKE:', error);
      return this.db.prepare(
        'SELECT * FROM learnings WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?'
      ).all(`%${query}%`, limit).map(row => this.rowToLearning(row));
    }
  }

  getAllLearnings(): Learning[] {
    const stmt = this.db.prepare('SELECT * FROM learnings ORDER BY created_at DESC');
    const rows = stmt.all();
    return rows.map(row => this.rowToLearning(row));
  }

  getLearningsByConfidence(threshold: number): Learning[] {
    const stmt = this.db.prepare('SELECT * FROM learnings WHERE confidence < ? ORDER BY confidence ASC');
    const rows = stmt.all(threshold);
    return rows.map(row => this.rowToLearning(row));
  }

  getLearningsByType(type: string): Learning[] {
    const stmt = this.db.prepare('SELECT * FROM learnings WHERE type = ? ORDER BY created_at DESC');
    const rows = stmt.all(type);
    return rows.map(row => this.rowToLearning(row));
  }

  deleteLearnings(ids: string[]): number {
    if (ids.length === 0) {
      return 0;
    }

    const placeholders = ids.map(() => '?').join(',');

    // Delete from FTS table first
    const ftsStmt = this.db.prepare(`DELETE FROM learnings_fts WHERE learning_id IN (${placeholders})`);
    ftsStmt.run(...ids);

    // Delete from main table
    const stmt = this.db.prepare(`DELETE FROM learnings WHERE id IN (${placeholders})`);
    const result = stmt.run(...ids);

    return result.changes;
  }

  getLearningsForReview(options: {
    unreviewed?: boolean;
    type?: string;
    projectPath?: string;
    limit?: number;
  }): Learning[] {
    let sql = 'SELECT * FROM learnings WHERE 1=1';
    const params: any[] = [];

    if (options.unreviewed) {
      sql += ' AND reviewed = 0';
    }

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    if (options.projectPath) {
      sql += ' AND project_path = ?';
      params.push(options.projectPath);
    }

    sql += ' ORDER BY created_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map(row => this.rowToLearning(row));
  }

  markLearningReviewed(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE learnings
      SET reviewed = 1, reviewed_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(id);
  }

  updateLearningContent(id: string, content: string): void {
    const stmt = this.db.prepare(`
      UPDATE learnings
      SET content = ?
      WHERE id = ?
    `);
    stmt.run(content, id);

    // Also update FTS table
    const ftsStmt = this.db.prepare(`
      UPDATE learnings_fts
      SET content = ?
      WHERE learning_id = ?
    `);
    ftsStmt.run(content, id);
  }

  getLearningsForSession(sessionId: string): Learning[] {
    const sql = 'SELECT * FROM learnings WHERE session_id = ?';
    return this.db.prepare(sql).all(sessionId).map(row => this.rowToLearning(row));
  }

  // ============================================================================
  // Stats methods
  // ============================================================================

  getStats(): Stats {
    const totalSessions = (this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any).count;
    const totalTokens = (this.db.prepare('SELECT SUM(token_count) as sum FROM sessions').get() as any).sum || 0;
    const totalErrors = (this.db.prepare('SELECT COUNT(*) as count FROM errors').get() as any).count;
    const totalLearnings = (this.db.prepare('SELECT COUNT(*) as count FROM learnings').get() as any).count;

    const sessionsBySource = this.db.prepare(`
      SELECT source, COUNT(*) as count
      FROM sessions
      GROUP BY source
    `).all() as Array<{ source: string; count: number }>;

    const sessionsByOutcome = this.db.prepare(`
      SELECT outcome, COUNT(*) as count
      FROM sessions
      GROUP BY outcome
    `).all() as Array<{ outcome: string; count: number }>;

    return {
      totalSessions,
      totalTokens,
      totalErrors,
      totalLearnings,
      sessionsBySource,
      sessionsByOutcome,
    };
  }

  getSkillStats(): SkillStats[] {
    const rows = this.db.prepare(`
      SELECT
        si.skill_name as skillName,
        COUNT(*) as usageCount,
        AVG(CASE WHEN s.outcome = 'success' THEN 1.0 ELSE 0.0 END) as successRate
      FROM skill_invocations si
      JOIN sessions s ON si.session_id = s.id
      GROUP BY si.skill_name
      ORDER BY usageCount DESC
    `).all() as SkillStats[];

    return rows;
  }

  getSubAgentStats(): SubAgentStats[] {
    const rows = this.db.prepare(`
      SELECT
        outcome,
        COUNT(*) as count,
        AVG(token_count) as avgTokens
      FROM sub_agent_invocations
      GROUP BY outcome
    `).all() as SubAgentStats[];

    return rows;
  }

  getToolPatternStats(): ToolPatternStats[] {
    const rows = this.db.prepare(`
      SELECT
        tools,
        COUNT(*) as count,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as successRate
      FROM tool_sequences
      GROUP BY tools
      HAVING count > 1
      ORDER BY count DESC
      LIMIT 20
    `).all() as ToolPatternStats[];

    return rows;
  }

  getModeEffectiveness(): ModeEffectiveness[] {
    const modes = ['plan_mode', 'thinking', 'sub_agents'];
    const results: ModeEffectiveness[] = [];

    for (const mode of modes) {
      const column = mode === 'plan_mode' ? 'used_plan_mode' : mode === 'thinking' ? 'used_thinking' : 'used_sub_agents';

      const withMode = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success
        FROM sessions
        WHERE ${column} = 1
      `).get() as any;

      const withoutMode = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success
        FROM sessions
        WHERE ${column} = 0
      `).get() as any;

      results.push({
        mode,
        withMode: { success: withMode.success || 0, total: withMode.total || 0 },
        withoutMode: { success: withoutMode.success || 0, total: withoutMode.total || 0 },
      });
    }

    return results;
  }

  // ============================================================================
  // Utility
  // ============================================================================

  close(): void {
    this.db.close();
  }

  // ============================================================================
  // Helper methods for row-to-type conversions
  // ============================================================================

  private rowToSession(row: any): Session {
    return {
      id: row.id,
      source: row.source,
      projectPath: row.project_path,
      projectName: row.project_name,
      gitBranch: row.git_branch || undefined,
      gitUser: row.git_user || undefined,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      status: row.status,
      tokenCount: row.token_count,
      turnCount: row.turn_count,
      toolCallCount: row.tool_call_count,
      errorCount: row.error_count,
      filesModified: row.files_modified,
      rawPath: row.raw_path,
      summary: row.summary || undefined,
      outcome: row.outcome,
      skillInvocationCount: row.skill_invocation_count,
      subAgentCount: row.sub_agent_count,
      usedPlanMode: row.used_plan_mode === 1,
      usedThinking: row.used_thinking === 1,
      usedSubAgents: row.used_sub_agents === 1,
      primaryTools: JSON.parse(row.primary_tools || '[]'),
    };
  }

  private rowToEvent(row: any): Event {
    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      timestamp: new Date(row.timestamp),
      sequenceNumber: row.sequence_number,
      content: row.content || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToToolCall(row: any): ToolCall {
    return {
      id: row.id,
      sessionId: row.session_id,
      eventId: row.event_id,
      toolName: row.tool_name,
      parameters: JSON.parse(row.parameters || '{}'),
      result: row.result || undefined,
      success: row.success === 1,
      durationMs: row.duration_ms || undefined,
      timestamp: new Date(row.timestamp),
    };
  }

  private rowToErrorRecord(row: any): ErrorRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      eventId: row.event_id,
      errorType: row.error_type,
      errorMessage: row.error_message,
      stackTrace: row.stack_trace || undefined,
      filePath: row.file_path || undefined,
      lineNumber: row.line_number || undefined,
      resolved: row.resolved === 1,
      resolutionEventId: row.resolution_event_id || undefined,
      timestamp: new Date(row.timestamp),
    };
  }

  private rowToLearning(row: any): Learning {
    return {
      id: row.id,
      sessionId: row.session_id || undefined,
      projectPath: row.project_path || undefined,
      content: row.content,
      type: row.type,
      scope: row.scope,
      confidence: row.confidence,
      tags: JSON.parse(row.tags || '[]'),
      relatedFiles: JSON.parse(row.related_files || '[]'),
      relatedErrors: JSON.parse(row.related_errors || '[]'),
      source: row.source,
      appliedCount: row.applied_count,
      lastAppliedAt: row.last_applied_at ? new Date(row.last_applied_at) : undefined,
      createdAt: new Date(row.created_at),
    };
  }
}
