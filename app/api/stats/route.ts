import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const runtime = 'nodejs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function semaforo(rimasti: number, quota: number) {
  if (rimasti <= 0) return '#e74c3c';
  if (quota > 0 && rimasti / quota <= 0.25) return '#f39c12';
  return '#27ae60';
}

function getDbPath() {
  return path.join(process.cwd(), 'data', 'calendar.db');
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/** Data di scadenza di un ciclo LO: anno X scade il 30 giugno di X+2 */
function scadenzaCiclo(cicloAnno: number): Date {
  return new Date(cicloAnno + 2, 5, 30); // mese 5 = giugno (0-based)
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function parseTimeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
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
  const dt = new Date(`${dateStr}T00:00:00`);
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

  const raw = totalMins / 60;
  const effective = breakMinutes > 0 && raw >= 6 ? raw - breakMinutes / 60 : raw;
  const rounded = Number(Math.max(effective, 0).toFixed(2));
  const diff = rounded - expectedHours;

  return {
    total_hours: rounded,
    overtime: Number((diff > 0 ? diff : 0).toFixed(2)),
    deficit: Number((diff < 0 ? Math.abs(diff) : 0).toFixed(2)),
  };
}

// ─── GET /api/stats ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  let db: DatabaseSync | null = null;

  try {
    const { searchParams } = new URL(request.url);
    const year  = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return Response.json({ error: 'Parametri year/month non validi.' }, { status: 400 });
    }

    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return Response.json({ error: 'File database non trovato.', dbPath }, { status: 500 });
    }

    db = new DatabaseSync(dbPath, { readOnly: true });

    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
    const yearPrefix  = `${year}-`;
    const refDate     = new Date(year, month - 1, lastDayOfMonth(year, month));
    const refDateStr  = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
    const breakMins   = getNumericSetting(db, 'break_minutes', 0);

    // ── Ore lavorate del mese ───────────────────────────────────────────────
    const workRows = db.prepare(`
      SELECT w.date_str, w.time_in, w.time_out, w.time_in2, w.time_out2,
             w.oncall_hours, COALESCE(d.is_holiday, 0) AS is_holiday
      FROM work_entries w
      LEFT JOIN calendar_days d ON d.date_str = w.date_str
      WHERE w.date_str LIKE ?
    `).all(`${monthPrefix}%`) as Array<{
      date_str: string;
      time_in: string | null; time_out: string | null;
      time_in2: string | null; time_out2: string | null;
      oncall_hours: number | null;
      is_holiday: number;
    }>;

    let total_worked = 0, total_overtime = 0, total_deficit = 0, total_oncall = 0;

    for (const row of workRows) {
      const exp = getExpectedHours(db, row.date_str, Boolean(row.is_holiday));
      const c   = calculateTimes(row.time_in, row.time_out, row.time_in2, row.time_out2, exp, breakMins);
      total_worked   += c.total_hours;
      total_overtime += c.overtime;
      total_deficit  += c.deficit;
      total_oncall   += Number(row.oncall_hours ?? 0);
    }

    // ── Assenze del mese ───────────────────────────────────────────────────
    const absMonthRows = db.prepare(`
      SELECT t.name, COUNT(*) as count
      FROM absences a
      JOIN absence_types t ON a.absence_type_id = t.id
      WHERE a.date_str LIKE ?
      GROUP BY t.name ORDER BY t.name
    `).all(`${monthPrefix}%`) as Array<{ name: string; count: number }>;

    const absence_counts: Record<string, number> = {};
    for (const r of absMonthRows) absence_counts[r.name] = Number(r.count);

    // ── Tipi assenza ───────────────────────────────────────────────────────
    const typesRows = db.prepare(`
      SELECT id, name, color, annual_quota FROM absence_types ORDER BY name
    `).all() as Array<{ id: number; name: string; color: string; annual_quota: number | null }>;

    const tipo937 = typesRows.find((t) => t.name === '937');
    const tipoRF  = typesRows.find((t) => t.name === 'Recupero Festività');
    const tipoLO  = typesRows.find((t) => t.name === 'Licenza Ordinaria');

    const settingStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);

    // ── 937 ────────────────────────────────────────────────────────────────
    // Quota: 4 giorni per anno solare (1 gen – 31 dic). Si azzera ogni 1 gennaio.
    let stats_937 = null;
    if (tipo937) {
      const quota_annua = Number(tipo937.annual_quota ?? 4);

      // Conteggio SOLO nell'anno solare corrente → reset automatico ogni anno
      const usati_anno = Number(
        (db.prepare(`
          SELECT COUNT(*) as count FROM absences
          WHERE absence_type_id = ? AND date_str LIKE ?
        `).get(tipo937.id, `${yearPrefix}%`) as { count: number } | undefined)?.count ?? 0
      );

      const usati_mese = Number(
        (db.prepare(`
          SELECT COUNT(*) as count FROM absences
          WHERE absence_type_id = ? AND date_str LIKE ?
        `).get(tipo937.id, `${monthPrefix}%`) as { count: number } | undefined)?.count ?? 0
      );

      const rimasti_anno = quota_annua - usati_anno;

      stats_937 = {
        quota_annua,
        usati_anno,
        usati_mese,
        rimasti_anno,
        anno_riferimento: year,
        color: rimasti_anno <= 0 ? '#e74c3c' : rimasti_anno === 1 ? '#f39c12' : '#27ae60',
      };
    }

    // ── Recupero Festività ─────────────────────────────────────────────────
    let stats_rf = null;
    if (tipoRF) {
      const quotaRFRow = settingStmt.get(`rf_quota_${year}`) as { value: string } | undefined;
      const quota = Number(quotaRFRow?.value ?? 0);

      const usati_anno = Number(
        (db.prepare(`SELECT COUNT(*) as count FROM absences WHERE absence_type_id = ? AND date_str LIKE ?`)
          .get(tipoRF.id, `${yearPrefix}%`) as { count: number } | undefined)?.count ?? 0
      );
      const usati_mese = Number(
        (db.prepare(`SELECT COUNT(*) as count FROM absences WHERE absence_type_id = ? AND date_str LIKE ?`)
          .get(tipoRF.id, `${monthPrefix}%`) as { count: number } | undefined)?.count ?? 0
      );
      const rimasti = quota - usati_anno;

      stats_rf = {
        quota, usati_anno, usati_mese, rimasti,
        color: rimasti <= 0 && quota > 0 ? '#e74c3c' : rimasti === 1 ? '#f39c12' : '#27ae60',
      };
    }

    // ── Licenza Ordinaria ──────────────────────────────────────────────────
    // Ogni anno solare genera 32 giorni (ciclo con scadenza 30/06/anno+2).
    // La scalatura avviene per ciclo scelto dall'utente (lo_competence_year).
    // Le voci legacy (lo_competence_year IS NULL) vengono distribuite FIFO.
    let stats_lo = null;
    if (tipoLO) {
      const quota_lo = Number(tipoLO.annual_quota ?? 32);

      // Cicli attivi: tutti i cicli non ancora scaduti alla data di riferimento
      const cicliAttivi: Array<{
        ciclo: number;
        scadenza: string;
        quota: number;
        init_used: number;   // storico pre-app (da settings)
        explicit: number;    // giorni scalati con lo_competence_year esplicito
        legacy: number;      // giorni legacy (FIFO, lo_competence_year IS NULL)
      }> = [];

      for (let delta = 5; delta >= 0; delta--) {
        const annoC = year - delta;
        if (refDate <= scadenzaCiclo(annoC)) {
          const initRow = settingStmt.get(`lo_init_used_${annoC}`) as { value: string } | undefined;
          cicliAttivi.push({
            ciclo: annoC,
            scadenza: `30/06/${annoC + 2}`,
            quota: quota_lo,
            init_used: Number(initRow?.value ?? 0),
            explicit: 0,
            legacy: 0,
          });
        }
      }

      // 1) Conteggio ESPLICITO: voci con lo_competence_year valorizzato
      const explicitRows = db.prepare(`
        SELECT lo_competence_year, COUNT(*) as count
        FROM absences
        WHERE absence_type_id = ? AND lo_competence_year IS NOT NULL AND date_str <= ?
        GROUP BY lo_competence_year
      `).all(tipoLO.id, refDateStr) as Array<{ lo_competence_year: number; count: number }>;

      for (const r of explicitRows) {
        const ciclo = cicliAttivi.find((c) => c.ciclo === Number(r.lo_competence_year));
        if (ciclo) ciclo.explicit = Number(r.count);
      }

      // 2) Conteggio LEGACY (FIFO): voci senza lo_competence_year
      const legacyRows = db.prepare(`
        SELECT date_str FROM absences
        WHERE absence_type_id = ? AND lo_competence_year IS NULL AND date_str <= ?
        ORDER BY date_str ASC
      `).all(tipoLO.id, refDateStr) as Array<{ date_str: string }>;

      for (const row of legacyRows) {
        const absDate = parseDate(row.date_str);
        for (const ciclo of cicliAttivi) {
          const used    = ciclo.init_used + ciclo.explicit + ciclo.legacy;
          const rimasti = ciclo.quota - used;
          if (absDate <= scadenzaCiclo(ciclo.ciclo) && rimasti > 0) {
            ciclo.legacy += 1;
            break;
          }
        }
      }

      const cicli = cicliAttivi.map((c) => {
        const usati_tot = c.init_used + c.explicit + c.legacy;
        const rimasti   = c.quota - usati_tot;
        return {
          ciclo:       c.ciclo,
          scadenza:    c.scadenza,
          quota:       c.quota,
          init_used:   c.init_used,   // storico pre-app
          usati_espliciti: c.explicit, // scelti dall'utente
          usati_legacy:    c.legacy,  // legacy FIFO
          usati_tot,
          rimasti,
          color: semaforo(rimasti, c.quota),
        };
      });

      stats_lo = { quota_lo, cicli };
    }

    return Response.json({
      year, month,
      total_worked:              Number(total_worked.toFixed(2)),
      total_overtime:            Number(total_overtime.toFixed(2)),
      total_oncall:              Number(total_oncall.toFixed(2)),
      total_overtime_with_oncall: Number((total_overtime + total_oncall).toFixed(2)),
      total_deficit:             Number(total_deficit.toFixed(2)),
      absence_counts,
      stats_937,
      stats_rf,
      stats_lo,
    });
  } catch (error) {
    return Response.json(
      { error: 'Errore durante il calcolo statistiche.', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    try { db?.close(); } catch {}
  }
}
