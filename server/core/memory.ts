import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export interface Memory {
  shortTerm: any[];
  longTerm: Record<string, any>;
}

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const MEMORY_FILE = path.join(DATA_DIR, 'memory.db');

export class MemorySystem {
  private db: Database.Database;

  constructor() {
    this.db = new Database(MEMORY_FILE);
    sqliteVec.load(this.db);
    this.initDb();
  }

  private initDb() {
    // 768 is the exact dimension for text-embedding-004 vector space
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS short_term (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS long_term (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        importance REAL DEFAULT 1.0
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_long_term USING vec0(
        embedding float[768]
      );
    `);
  }

  load() {
    // No-op for SQLite as data is read on demand
  }

  save() {
    // No-op for SQLite as writes are immediate, kept for interface compatibility
  }

  addEvent(event: any) {
    const timestamp = new Date().toISOString();
    const dataStr = JSON.stringify(event);
    
    // Insert new event
    const insert = this.db.prepare('INSERT INTO short_term (timestamp, data) VALUES (?, ?)');
    insert.run(timestamp, dataStr);

    // Keep only last 50 events to prevent bloat
    this.db.exec(`
      DELETE FROM short_term 
      WHERE id NOT IN (
        SELECT id FROM short_term ORDER BY id DESC LIMIT 50
      )
    `);
  }

  remember(key: string, value: any, embedding?: number[], importance: number = 1.0) {
    // Upsert into long_term standard table
    const result = this.db.prepare(
      'INSERT INTO long_term (key, value, importance) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, importance=excluded.importance RETURNING id'
    ).get(key, JSON.stringify(value), importance) as { id: number | bigint };

    if (embedding && result.id) {
       // Insert or replace embedding within vector backend mapped to the same rowid
       const insertVec = this.db.prepare('INSERT OR REPLACE INTO vec_long_term(rowid, embedding) VALUES (?, ?)');
       insertVec.run(BigInt(result.id), new Float32Array(embedding));
    }
  }

  recall(key: string) {
    const row = this.db.prepare('SELECT value FROM long_term WHERE key = ?').get(key) as any;
    if (row) {
      try {
        return JSON.parse(row.value);
      } catch (e) {
        return row.value;
      }
    }
    return undefined;
  }

  recallSemantic(queryEmbedding: number[], limit: number = 3) {
    // Query sqlite-vec index using knn match over the target embedding
    const rows = this.db.prepare(`
      SELECT 
        l.key, 
        l.value, 
        l.importance,
        v.distance
      FROM vec_long_term v
      JOIN long_term l ON l.id = v.rowid
      WHERE v.embedding MATCH ? AND k = ?
    `).all(new Float32Array(queryEmbedding), limit) as any[];
    
    // Process results and factor baseline db distance into an importance-weighted score matrix
    const scored = rows.map(row => {
      // vec0 distance is L2 distance for floats or cosine depending on index configurations.
      // Small distance = closer match. Convert distance into a similarity metric where higher is better.
      const similarity = 1.0 / (1.0 + row.distance);
      
      // Importance scoring amplifies relevant context
      const score = similarity * row.importance;
      
      let parsedValue;
      try { parsedValue = JSON.parse(row.value); } catch(e) { parsedValue = row.value; }
      
      return { key: row.key, value: parsedValue, score };
    });

    // Sort descending by calculated score 
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  getSnapshot(): Memory {
    const shortTermRows = this.db.prepare('SELECT timestamp, data FROM short_term ORDER BY id ASC').all() as any[];
    const shortTerm = shortTermRows.map(row => {
      try {
        return { ...JSON.parse(row.data), timestamp: row.timestamp };
      } catch (e) {
        return { data: row.data, timestamp: row.timestamp };
      }
    });

    const longTermRows = this.db.prepare('SELECT key, value FROM long_term').all() as any[];
    const longTerm: Record<string, any> = {};
    for (const row of longTermRows) {
      try {
        longTerm[row.key] = JSON.parse(row.value);
      } catch (e) {
        longTerm[row.key] = row.value;
      }
    }

    return { shortTerm, longTerm };
  }

  healthCheck(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      this.db.prepare('SELECT sqlite_version()').get();
      return true;
    } catch (e) {
      return false;
    }
  }
}

