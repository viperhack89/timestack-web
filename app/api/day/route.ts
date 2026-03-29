import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const runtime = 'nodejs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseTimeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function getDbPath() {
  return path.join(process.cwd(), 'data', 'calendar.db');
}

function getNumericSetting(db: DatabaseSync, key: string, fallback: number): number {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Ore attese per la data:
 *  - Sab (6), Dom (0), Festivo → 0 (tutto straordinario)
 *  - Ven (5) → friday_hours
 *  - Lun-Gio → standard_hours
 */
function getExpectedHours(db: DatabaseSync, dateStr: string, isHoliday: boolean): number {
  const dt  = new Date(`${dateStr}T00:00:00`);
  const day = dt.getDay();
  if (day === 0 || day === 6 || isHoliday) return 0;
  if (day === 5) return getNumericSetting(db, 'friday_hours', 4);
  return getNumericSetting(db, 'standard_hours', 8.5);
}

function workedMins(timeIn: string | null, timeOut: string | null): number {
  const a = parseTimeToMinutes(timeIn);
  const b = parseTimeToMinutes(timeOut);
  if (a === null || b === null || b < a) return 0;
  return b - a;
}

function calculateTimes(
  ti: string | null, to: string | null,
  ti2: string | null, to2: string | null,
  expectedHours: number,
  breakMinutes: number
) {
  const totalMins = workedMins(ti, to) + workedMins(ti2, to2);
  if (totalMins === 0) return { total_hours: 0, overtime: 0, deficit: 0 };

  const raw       = totalMins / 60;
  const effective = breakMinutes > 0 && raw >= 6 ? raw - breakMinutes / 60 : raw;
  const rounded   = Number(Math.max(effective, 0).toFixed(2));
  const diff      = rounded - expectedHours;

  return {
    total_hours: rounded,
    overtime:    Number((diff > 0 ? diff : 0).toFixed(2)),
    deficit:     Number((diff < 0 ? Math.abs(diff) : 0).toFixed(2)),
  };
}

// ─── GET /api/day ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  let db: DatabaseSync | null = null;

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date) return Response.json({ error: 'Parametro date mancante.' }, { status: 400 });

    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return Response.json({ error: 'File database non trovato.', dbPath }, { status: 500 });
    }

    db = new DatabaseSync(dbPath);

    const dayRow = db.prepare(`
      SELECT date_str, is_weekend, is_holiday, holiday_name
      FROM calendar_days WHERE date_str = ?
    `).get(date) as
      | { date_str: string; is_weekend: number; is_holiday: number; holiday_name: string | null }
      | undefined;

    const workRow = db.prepare(`
      SELECT time_in, time_out, time_in2, time_out2,
             total_hours, overtime, deficit, notes, oncall_hours
      FROM work_entries WHERE date_str = ?
    `).get(date) as
      | {
          time_in: string | null; time_out: string | null;
          time_in2: string | null; time_out2: string | null;
          total_hours: number | null; overtime: number | null; deficit: number | null;
          notes: string | null; oncall_hours: number | null;
        }
      | undefined;

    const absRow = db.prepare(`
      SELECT a.absence_type_id, t.name, t.color, a.note, a.lo_competence_year
      FROM absences a
      JOIN absence_types t ON a.absence_type_id = t.id
      WHERE a.date_str = ?
    `).get(date) as
      | { absence_type_id: number; name: string; color: string; note: string | null; lo_competence_year: number | null }
      | undefined;

    let computedWorkEntry = null;
    if (workRow) {
      const isHoliday     = Boolean(dayRow?.is_holiday);
      const expectedHours = getExpectedHours(db, date, isHoliday);
      const breakMins     = getNumericSetting(db, 'break_minutes', 0);

      const computed = calculateTimes(
        workRow.time_in, workRow.time_out,
        workRow.time_in2, workRow.time_out2,
        expectedHours, breakMins
      );

      computedWorkEntry = {
        time_in:        workRow.time_in,
        time_out:       workRow.time_out,
        time_in2:       workRow.time_in2,
        time_out2:      workRow.time_out2,
        total_hours:    computed.total_hours,
        overtime:       computed.overtime,
        deficit:        computed.deficit,
        notes:          workRow.notes ?? '',
        oncall_hours:   Number(workRow.oncall_hours ?? 0),
        expected_hours: expectedHours,
      };
    }

    return Response.json({
      date,
      day: dayRow
        ? {
            date:         dayRow.date_str,
            is_weekend:   Boolean(dayRow.is_weekend),
            is_holiday:   Boolean(dayRow.is_holiday),
            holiday_name: dayRow.holiday_name ?? '',
          }
        : null,
      work_entry: computedWorkEntry,
      absence: absRow
        ? {
            id:                 absRow.absence_type_id,
            name:               absRow.name,
            color:              absRow.color,
            note:               absRow.note ?? '',
            lo_competence_year: absRow.lo_competence_year ?? null,
          }
        : null,
    });
  } catch (error) {
    return Response.json(
      { error: 'Errore durante la lettura del giorno.', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    try { db?.close(); } catch {}
  }
}

// ─── POST /api/day ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let db: DatabaseSync | null = null;

  try {
    const body = await request.json();

    const date        = String(body.date ?? '').trim();
    const time_in     = body.time_in  ? String(body.time_in).trim()  : null;
    const time_out    = body.time_out ? String(body.time_out).trim() : null;
    const time_in2    = body.time_in2  ? String(body.time_in2).trim()  : null;
    const time_out2   = body.time_out2 ? String(body.time_out2).trim() : null;
    const notes       = String(body.notes ?? '').trim();
    const oncall_hours = Number(body.oncall_hours ?? 0);

    const absence_type_id =
      body.absence_type_id == null || body.absence_type_id === ''
        ? null
        : Number(body.absence_type_id);

    // lo_competence_year: obbligatorio quando si sceglie Licenza Ordinaria
    const lo_competence_year =
      body.lo_competence_year == null || body.lo_competence_year === ''
        ? null
        : Number(body.lo_competence_year);

    if (!date) return Response.json({ error: 'Campo date mancante.' }, { status: 400 });

    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return Response.json({ error: 'File database non trovato.', dbPath }, { status: 500 });
    }

    db = new DatabaseSync(dbPath);

    const dayRow = db.prepare(`SELECT is_holiday FROM calendar_days WHERE date_str = ?`).get(date) as
      | { is_holiday: number }
      | undefined;
    const isHoliday     = Boolean(dayRow?.is_holiday);
    const expectedHours = getExpectedHours(db, date, isHoliday);
    const breakMins     = getNumericSetting(db, 'break_minutes', 0);

    const { total_hours, overtime, deficit } = calculateTimes(
      time_in, time_out, time_in2, time_out2, expectedHours, breakMins
    );

    db.exec('BEGIN');

    db.prepare(`
      INSERT OR REPLACE INTO work_entries
        (date_str, time_in, time_out, time_in2, time_out2,
         total_hours, overtime, deficit, notes, oncall_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      date, time_in, time_out, time_in2, time_out2,
      total_hours, overtime, deficit, notes,
      Number.isFinite(oncall_hours) ? oncall_hours : 0
    );

    if (absence_type_id === null) {
      db.prepare(`DELETE FROM absences WHERE date_str = ?`).run(date);
    } else {
      // Salva lo_competence_year solo per Licenza Ordinaria
      db.prepare(`
        INSERT OR REPLACE INTO absences (date_str, absence_type_id, note, lo_competence_year)
        VALUES (?, ?, ?, ?)
      `).run(date, absence_type_id, '', lo_competence_year);
    }

    db.exec('COMMIT');

    return Response.json({
      ok: true, date, total_hours, overtime, deficit,
      expected_hours: expectedHours,
      break_minutes:  breakMins,
    });
  } catch (error) {
    try { db?.exec('ROLLBACK'); } catch {}
    return Response.json(
      { error: 'Errore durante il salvataggio del giorno.', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    try { db?.close(); } catch {}
  }
}
