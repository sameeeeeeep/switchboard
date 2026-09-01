/** Types for the pure task-document transforms in tasks.mjs (Bank's tasks.md kanban dialect).
 *  Only the surface the daemon consumes is declared; see tasks.mjs for the full module. */

export interface AddTaskOptions {
  /** The `## Heading` list to file under (default "Inbox"). */
  list?: string;
  /** A due date — `YYYY-MM-DD` becomes a `due:` token, anything else a friendly "— by <hint>". */
  due?: string;
  /** Open-state column token (backlog/todo/doing/blocked/review). */
  status?: string;
  /** The epic slug this card belongs to. */
  epic?: string;
  /** Priority (high/med/low). */
  prio?: string;
  /** A stable short id token. */
  id?: string;
  /** Indented body lines (plain notes and/or nested `- [ ]` subtasks). */
  detail?: string[];
}

export interface AddTaskResult {
  /** The next markdown document (unchanged when not added). */
  doc: string;
  added: boolean;
  reason?: string;
  list?: string;
}

/** Append `- [ ] text` under `## <list>` (creating the section if missing), deduped by base text. */
export function addTask(text: string, opts?: AddTaskOptions, existing?: string): AddTaskResult;
