import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  let db: DatabaseSync | null = null;

  try {
    const { searchParams } = new URL(request.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return Response.json({ error: 'Parametri year/month non validi.' }, { status: 400 });
    }

    const monthStr = String(month).padStart(2, '0');
    const prefix = `${year}-${monthStr}-`;
    const dbPath = path.join(process.cwd(), 'data', 'calendar.db');

    if (!fs.existsSync(dbPath)) {
      return Response.json({ error: 'File database non trovato.', dbPath }, { status: 500 });
    }

    db = new DatabaseSync(dbPath, { readOnly: true });

    const daysRows = db.prepare(`
      SELECT date_str, is_weekend, is_holiday, holiday_name
      FROM calendar_days
      WHERE date_str LIKE ?
      ORDER BY date_str
    `).all(`${prefix}%`) as Array<{
      date_str: string;
      is_weekend: number | boolean;
      is_holiday: number | boolean;
      holiday_name: string | null;
    }>;

    const workRows = db.prepare(`
      SELECT date_str, time_in, time_out, time_in2, time_out2,
             total_hours, overtime, deficit, oncall_hours
      FROM work_entries
      WHERE date_str LIKE ?
    `).all(`${prefix}%`) as Array<{
      date_str: string;
      time_in: string | null;
      time_out: string | null;
      time_in2: string | null;
      time_out2: string | null;
      total_hours: number | null;
      overtime: number | null;
      deficit: number | null;
      oncall_hours: number | null;
    }>;

    const absRows = db.prepare(`
      SELECT a.date_str, t.name, t.color
      FROM absences a
      JOIN absence_types t ON a.absence_type_id = t.id
      WHERE a.date_str LIKE ?
    `).all(`${prefix}%`) as Array<{ date_str: string; name: string; color: string }>;

    const days = daysRows.map((r) => ({
      date: r.date_str,
      is_weekend: Boolean(r.is_weekend),
      is_holiday: Boolean(r.is_holiday),
      holiday_name: r.holiday_name ?? '',
    }));

    const work_entries: Record<string, any> = {};
    for (const r of workRows) {
      work_entries[r.date_str] = {
        time_in: r.time_in,
        time_out: r.time_out,
        time_in2: r.time_in2,
        time_out2: r.time_out2,
        total_hours: Number(r.total_hours ?? 0),
        overtime: Number(r.overtime ?? 0),
        deficit: Number(r.deficit ?? 0),
        oncall_hours: Number(r.oncall_hours ?? 0),
      };
    }

    const absences: Record<string, any> = {};
    for (const r of absRows) {
      absences[r.date_str] = { name: r.name, color: r.color };
    }

    return Response.json({
      year, month, days, work_entries, absences,
      debug: {
        dbPath,
        daysCount: days.length,
        workCount: Object.keys(work_entries).length,
        absCount: Object.keys(absences).length,
      },
    });
  } catch (error) {
    return Response.json(
      { error: 'Errore durante la lettura del database SQLite.', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    try { db?.close(); } catch {}
  }
}
