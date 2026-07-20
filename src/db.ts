import { DatabaseSync } from 'node:sqlite'

/**
 * Read-only handle to Conductor's SQLite DB.
 *
 * The desktop app holds the same file open in WAL mode; a second read-only
 * connection sees every committed write without blocking the app. We never
 * write through this handle — writes go through the actuator (see writes.ts).
 */
export class ConductorDb {
	private readonly dbPath: string
	private db: DatabaseSync

	constructor(dbPath: string) {
		this.dbPath = dbPath
		this.db = this.open()
	}

	private open(): DatabaseSync {
		const db = new DatabaseSync(this.dbPath, { readOnly: true })
		try {
			db.exec('PRAGMA busy_timeout = 2000')
		} catch {
			// read-only connections may reject some pragmas; harmless
		}
		return db
	}

	query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
		try {
			return this.db.prepare(sql).all(...(params as never[])) as T[]
		} catch {
			// If the DB file was swapped underneath us (app update), reopen once.
			this.db = this.open()
			return this.db.prepare(sql).all(...(params as never[])) as T[]
		}
	}
}
