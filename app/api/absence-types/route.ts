import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const runtime = 'nodejs';

export async function GET() {
  let db: DatabaseSync | null = null;

  try {
    const dbPath = path.join(process.cwd(), 'data', 'calendar.db');

    if (!fs.existsSync(dbPath)) {
      return Response.json(
        { error: 'File database non trovato.', dbPath },
        { status: 500 }
      );
    }

    db = new DatabaseSync(dbPath, { readOnly: true });

    const stmt = db.prepare(`
      SELECT id, name, color, annual_quota
      FROM absence_types
      ORDER BY name
    `);

    const rows = stmt.all() as Array<{
      id: number;
      name: string;
      color: string;
      annual_quota: number | null;
    }>;

    return Response.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        annual_quota: Number(r.annual_quota ?? 0),
      }))
    );
  } catch (error) {
    return Response.json(
      {
        error: 'Errore durante la lettura dei tipi di assenza.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    try {
      db?.close();
    } catch {}
  }
}