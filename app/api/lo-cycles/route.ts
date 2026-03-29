/**
 * GET /api/lo-cycles?year=YYYY
 *
 * Restituisce i cicli di Licenza Ordinaria attivi per l'anno indicato,
 * con quota, giorni usati e rimasti per ciascun ciclo.
 * Usato dal frontend per popolare il selettore "Ciclo LO da scalare".
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const runtime = 'nodejs';

function getDbPath() {
  return path.join(process.cwd(), 'data', 'calendar.db');
}

function scadenzaCiclo(cicloAnno: number): Date {
  return new Date(cicloAnno + 2, 5, 30); // 30 giugno anno+2
}

function getNumericSetting(db: DatabaseSync, key: string, fallback: number): number {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: Request) {
  let db: DatabaseSync | null = null;

  try {
    const { searchParams } = new URL(request.url);
    const year = Number(searchParams.get('year'));

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return Response.json({ error: 'Parametro year non valido.' }, { status: 400 });
    }

    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return Response.json({ error: 'File database non trovato.', dbPath }, { status: 500 });
    }

    db = new DatabaseSync(dbPath, { readOnly: true });

    // Tipo Licenza Ordinaria
    const tipoLO = db.prepare(`
      SELECT id, annual_quota FROM absence_types WHERE name = 'Licenza Ordinaria'
    `).get() as { id: number; annual_quota: number | null } | undefined;

    if (!tipoLO) {
      return Response.json({ cicli: [] });
    }

    const quota_lo   = Number(tipoLO.annual_quota ?? 32);
    const today      = new Date();
    const refDate    = new Date(year, 11, 31); // 31 dicembre dell'anno richiesto
    const settingStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);

    const cicli = [];

    // Considera gli ultimi 5 anni + anno corrente
    for (let delta = 5; delta >= 0; delta--) {
      const annoC    = year - delta;
      const scadenza = scadenzaCiclo(annoC);

      // Includi il ciclo solo se non ancora scaduto oggi
      if (today > scadenza) continue;
      // ed è pertinente all'anno visualizzato
      if (refDate > scadenza && new Date(annoC, 0, 1) > refDate) continue;

      const initRow  = settingStmt.get(`lo_init_used_${annoC}`) as { value: string } | undefined;
      const init_used = Number(initRow?.value ?? 0);

      // Giorni usati con ciclo esplicito
      const explicitCount = Number(
        (db.prepare(`
          SELECT COUNT(*) as count FROM absences
          WHERE absence_type_id = ? AND lo_competence_year = ?
        `).get(tipoLO.id, annoC) as { count: number } | undefined)?.count ?? 0
      );

      const usati_tot = init_used + explicitCount;
      const rimasti   = quota_lo - usati_tot;

      cicli.push({
        ciclo:    annoC,
        label:    `Ciclo ${annoC} · scade 30/06/${annoC + 2}`,
        scadenza: `30/06/${annoC + 2}`,
        quota:    quota_lo,
        init_used,
        usati_espliciti: explicitCount,
        usati_tot,
        rimasti: Math.max(rimasti, 0),
        scaduto: today > scadenza,
        disponibile: rimasti > 0,
      });
    }

    return Response.json({ anno: year, quota_lo, cicli });
  } catch (error) {
    return Response.json(
      { error: 'Errore nel calcolo cicli LO.', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    try { db?.close(); } catch {}
  }
}
