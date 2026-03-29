'use client';

import { useEffect, useMemo, useState } from 'react';

const mesi = [
  '',
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

const giorniSettimana = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];

type MonthDay = {
  date: string;
  is_weekend: boolean;
  is_holiday: boolean;
  holiday_name: string;
};

type WorkEntry = {
  time_in: string | null;
  time_out: string | null;
  total_hours: number;
  overtime: number;
  deficit: number;
  notes?: string;
  oncall_hours?: number;
};

type Absence = {
  id?: number;
  name: string;
  color: string;
  note?: string;
};

type AbsenceType = {
  id: number;
  name: string;
  color: string;
  annual_quota: number;
};

type MonthData = {
  year: number;
  month: number;
  days: MonthDay[];
  work_entries: Record<string, WorkEntry>;
  absences: Record<string, Absence>;
};

type DayCell = {
  day: number;
  dateStr: string;
  isToday: boolean;
};

type DayDetails = {
  date: string;
  day: MonthDay | null;
  work_entry: WorkEntry | null;
  absence: Absence | null;
};

type StatsData = {
  year: number;
  month: number;
  total_worked: number;
  total_overtime: number;
  total_oncall: number;
  total_overtime_with_oncall: number;
  total_deficit: number;
  absence_counts: Record<string, number>;
  stats_937: {
    quota_annua: number;
    usati_anno: number;
    usati_mese: number;
    rimasti_anno: number;
    color: string;
  } | null;
  stats_rf: {
    quota: number;
    usati_anno: number;
    usati_mese: number;
    rimasti: number;
    color: string;
  } | null;
  stats_lo: {
    quota_lo: number;
    cicli: Array<{
      ciclo: number;
      scadenza: string;
      quota: number;
      usati_db: number;
      init_used: number;
      usati_tot: number;
      rimasti: number;
      color: string;
    }>;
  } | null;
};

function getMonthGrid(year: number, month: number): (DayCell | null)[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const jsDay = firstDay.getDay();
  const startOffset = jsDay === 0 ? 6 : jsDay - 1;

  const totalDays = lastDay.getDate();
  const cells: (DayCell | null)[] = [];

  for (let i = 0; i < startOffset; i++) {
    cells.push(null);
  }

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();

  for (let day = 1; day <= totalDays; day++) {
    cells.push({
      day,
      dateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      isToday: year === todayY && month === todayM && day === todayD,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

export default function HomePage() {
  const oggi = new Date();

  const [currentYear, setCurrentYear] = useState(oggi.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(oggi.getMonth() + 1);

  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetails, setDayDetails] = useState<DayDetails | null>(null);
  const [absenceTypes, setAbsenceTypes] = useState<AbsenceType[]>([]);
  const [saving, setSaving] = useState(false);

  const [formTimeIn, setFormTimeIn] = useState('');
  const [formTimeOut, setFormTimeOut] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formOncall, setFormOncall] = useState('0');
  const [formAbsenceId, setFormAbsenceId] = useState('');

  const monthGrid = useMemo(
    () => getMonthGrid(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  async function loadMonth(dateToKeep?: string | null) {
    setLoading(true);

    try {
      const res = await fetch(`/api/month?year=${currentYear}&month=${currentMonth}`);
      const text = await res.text();

      if (!res.ok) {
        console.error('Errore API /api/month:', res.status, text);
        setMonthData(null);
        return;
      }

      if (!text) {
        console.error('La route /api/month ha restituito una risposta vuota.');
        setMonthData(null);
        return;
      }

      const data = JSON.parse(text) as MonthData;
      setMonthData(data);

      if (dateToKeep) {
        setSelectedDate(dateToKeep);
      } else {
        const firstDayOfMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
        setSelectedDate(firstDayOfMonth);
      }
    } catch (error) {
      console.error('Errore caricamento dati mese:', error);
      setMonthData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const res = await fetch(`/api/stats?year=${currentYear}&month=${currentMonth}`);
      const text = await res.text();

      if (!res.ok) {
        console.error('Errore API /api/stats:', res.status, text);
        setStatsData(null);
        return;
      }

      if (!text) {
        console.error('La route /api/stats ha restituito una risposta vuota.');
        setStatsData(null);
        return;
      }

      const data = JSON.parse(text) as StatsData;
      setStatsData(data);
    } catch (error) {
      console.error('Errore caricamento statistiche:', error);
      setStatsData(null);
    }
  }

  async function loadAbsenceTypes() {
    try {
      const res = await fetch('/api/absence-types');
      const text = await res.text();

      if (!res.ok || !text) {
        console.error('Errore API /api/absence-types:', res.status, text);
        return;
      }

      const data = JSON.parse(text) as AbsenceType[];
      setAbsenceTypes(data);
    } catch (error) {
      console.error('Errore caricamento tipi assenza:', error);
    }
  }

  async function loadDay(date: string) {
    try {
      const res = await fetch(`/api/day?date=${date}`);
      const text = await res.text();

      if (!res.ok || !text) {
        console.error('Errore API /api/day:', res.status, text);
        setDayDetails(null);
        return;
      }

      const data = JSON.parse(text) as DayDetails;
      setDayDetails(data);

      setFormTimeIn(data.work_entry?.time_in ?? '');
      setFormTimeOut(data.work_entry?.time_out ?? '');
      setFormNotes(data.work_entry?.notes ?? '');
      setFormOncall(String(data.work_entry?.oncall_hours ?? 0));
      setFormAbsenceId(data.absence?.id ? String(data.absence.id) : '');
    } catch (error) {
      console.error('Errore caricamento dettaglio giorno:', error);
      setDayDetails(null);
    }
  }

  useEffect(() => {
    loadMonth();
    loadStats();
  }, [currentYear, currentMonth]);

  useEffect(() => {
    loadAbsenceTypes();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      loadDay(selectedDate);
    }
  }, [selectedDate]);

  function prevMonth() {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }

  async function handleSaveDay() {
    if (!selectedDate) return;

    setSaving(true);

    try {
      const res = await fetch('/api/day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          time_in: formTimeIn || null,
          time_out: formTimeOut || null,
          notes: formNotes,
          oncall_hours: Number((formOncall || '0').replace(',', '.')),
          absence_type_id: formAbsenceId ? Number(formAbsenceId) : null,
        }),
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : null;

      if (!res.ok) {
        console.error('Errore salvataggio giorno:', data);
        alert(`Errore salvataggio: ${data?.error || 'errore sconosciuto'}`);
        return;
      }

      await loadMonth(selectedDate);
      await loadDay(selectedDate);
      await loadStats();
      alert('Giorno salvato correttamente.');
    } catch (error) {
      console.error('Errore salvataggio giorno:', error);
      alert('Errore durante il salvataggio.');
    } finally {
      setSaving(false);
    }
  }

  const daysMap = useMemo(() => {
    const map: Record<string, MonthDay> = {};
    monthData?.days.forEach((d) => {
      map[d.date] = d;
    });
    return map;
  }, [monthData]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <header className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <img
                src="/timestack_logo.png"
                alt="TimeStack Logo"
                className="h-14 w-14 rounded-xl bg-slate-800 p-1 object-contain"
              />
              <div>
                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                  TimeStack
                </h1>
                <p className="mt-1 text-slate-400">
                  Calendario di lavoro web responsive
                </p>
              </div>
            </div>

            <div className="text-sm text-slate-400">
              {loading ? 'Caricamento mese...' : 'Dati mese caricati'}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg xl:col-span-2">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={prevMonth}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 transition hover:bg-slate-700"
                >
                  ←
                </button>

                <h2 className="text-2xl font-bold">
                  {mesi[currentMonth]} {currentYear}
                </h2>

                <button
                  onClick={nextMonth}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 transition hover:bg-slate-700"
                >
                  →
                </button>
              </div>

              <div className="text-sm text-slate-400">Vista mensile operativa</div>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-2">
              {giorniSettimana.map((g) => (
                <div
                  key={g}
                  className="rounded-xl bg-slate-800 py-3 text-center text-xs font-semibold text-sky-400 md:text-sm"
                >
                  {g}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {monthGrid.map((cell, index) => {
                if (!cell) {
                  return (
                    <div
                      key={`empty-${index}`}
                      className="min-h-[88px] rounded-xl border border-dashed border-slate-800 bg-slate-950/40 md:min-h-[110px]"
                    />
                  );
                }

                const dayInfo = daysMap[cell.dateStr];
                const workEntry = monthData?.work_entries?.[cell.dateStr];
                const absEntry = monthData?.absences?.[cell.dateStr];
                const isSelected = selectedDate === cell.dateStr;

                let classes =
                  'min-h-[88px] md:min-h-[120px] rounded-xl border p-2 text-left transition hover:bg-slate-800';

                if (dayInfo?.is_weekend) {
                  classes += ' bg-slate-800 border-slate-700';
                } else if (dayInfo?.is_holiday) {
                  classes += ' bg-slate-700 border-slate-600';
                } else {
                  classes += ' bg-slate-900 border-slate-800';
                }

                if (cell.isToday) classes += ' ring-2 ring-sky-500';
                if (isSelected) classes += ' ring-2 ring-yellow-400';

                const style = absEntry
                  ? { borderColor: absEntry.color }
                  : workEntry?.overtime && workEntry.overtime > 0
                    ? { borderColor: '#27ae60' }
                    : workEntry?.deficit && workEntry.deficit > 0
                      ? { borderColor: '#e74c3c' }
                      : undefined;

                return (
                  <button
                    key={cell.dateStr}
                    className={classes}
                    style={style}
                    onClick={() => setSelectedDate(cell.dateStr)}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-sm font-bold md:text-base">{cell.day}</span>
                      {dayInfo?.is_weekend && (
                        <span className="text-[10px] text-slate-400 md:text-xs">
                          weekend
                        </span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1">
                      {dayInfo?.is_holiday && (
                        <div className="text-[11px] text-yellow-400 md:text-xs">
                          {dayInfo.holiday_name}
                        </div>
                      )}

                      {absEntry && (
                        <div
                          className="text-[11px] font-semibold md:text-xs"
                          style={{ color: absEntry.color }}
                        >
                          {absEntry.name}
                        </div>
                      )}

                      {workEntry?.time_in && (
                        <div className="text-[11px] text-slate-300 md:text-xs">
                          {workEntry.time_in} - {workEntry.time_out}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <h3 className="mb-3 text-xl font-semibold">Statistiche</h3>

              {!statsData ? (
                <div className="rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
                  Statistiche non disponibili
                </div>
              ) : (
                <div className="space-y-4 text-sm">
                  <div className="rounded-xl bg-slate-800 p-3">
                    Ore lavorate:{' '}
                    <span className="font-bold">
                      {statsData.total_worked.toFixed(2)}h
                    </span>
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3 text-green-400">
                    Straordinario: {statsData.total_overtime.toFixed(2)}h
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3 text-cyan-400">
                    Reperibilità: {statsData.total_oncall.toFixed(2)}h
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3 text-emerald-400">
                    Straordinario totale:{' '}
                    {statsData.total_overtime_with_oncall.toFixed(2)}h
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3 text-red-400">
                    Deficit: {statsData.total_deficit.toFixed(2)}h
                  </div>

                  {statsData.stats_937 && (
                    <div className="rounded-xl bg-slate-800 p-3">
                      <div className="mb-2 font-semibold">937</div>
                      <div>Quota annua: {statsData.stats_937.quota_annua}</div>
                      <div>Usati anno: {statsData.stats_937.usati_anno}</div>
                      <div>Usati mese: {statsData.stats_937.usati_mese}</div>
                      <div style={{ color: statsData.stats_937.color }}>
                        Rimasti anno: {statsData.stats_937.rimasti_anno}
                      </div>
                    </div>
                  )}

                  {statsData.stats_rf && (
                    <div className="rounded-xl bg-slate-800 p-3">
                      <div className="mb-2 font-semibold">Recupero Festività</div>
                      <div>Quota: {statsData.stats_rf.quota}</div>
                      <div>Usati anno: {statsData.stats_rf.usati_anno}</div>
                      <div>Usati mese: {statsData.stats_rf.usati_mese}</div>
                      <div style={{ color: statsData.stats_rf.color }}>
                        Rimasti: {statsData.stats_rf.rimasti}
                      </div>
                    </div>
                  )}

                  {statsData.stats_lo && (
                    <div className="rounded-xl bg-slate-800 p-3">
                      <div className="mb-3 font-semibold">Licenza Ordinaria</div>
                      <div className="mb-2">
                        Quota annua: {statsData.stats_lo.quota_lo} giorni
                      </div>

                      <div className="space-y-3">
                        {statsData.stats_lo.cicli.map((ciclo) => (
                          <div
                            key={ciclo.ciclo}
                            className="rounded-lg border border-slate-700 bg-slate-900 p-3"
                          >
                            <div className="font-semibold">
                              Ciclo {ciclo.ciclo} · scadenza {ciclo.scadenza}
                            </div>
                            <div>Quota: {ciclo.quota}</div>
                            <div>Usati DB: {ciclo.usati_db}</div>
                            <div>Storico iniziale: {ciclo.init_used}</div>
                            <div>Usati totali: {ciclo.usati_tot}</div>
                            <div style={{ color: ciclo.color }}>
                              Rimasti: {ciclo.rimasti}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <h3 className="mb-3 text-xl font-semibold">Dettaglio / Modifica giorno</h3>

              {!selectedDate ? (
                <div className="rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
                  Seleziona un giorno dal calendario.
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl bg-slate-800 p-3">
                    <div className="text-slate-400">Data</div>
                    <div className="font-semibold">{selectedDate}</div>
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3">
                    <label className="mb-1 block text-slate-400">Ora ingresso</label>
                    <input
                      value={formTimeIn}
                      onChange={(e) => setFormTimeIn(e.target.value)}
                      placeholder="08:00"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                    />
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3">
                    <label className="mb-1 block text-slate-400">Ora uscita</label>
                    <input
                      value={formTimeOut}
                      onChange={(e) => setFormTimeOut(e.target.value)}
                      placeholder="16:30"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                    />
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3">
                    <label className="mb-1 block text-slate-400">Note</label>
                    <input
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      placeholder="Note del giorno"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                    />
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3">
                    <label className="mb-1 block text-slate-400">Ore reperibilità</label>
                    <input
                      value={formOncall}
                      onChange={(e) => setFormOncall(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                    />
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3">
                    <label className="mb-1 block text-slate-400">Tipo assenza</label>
                    <select
                      value={formAbsenceId}
                      onChange={(e) => setFormAbsenceId(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                    >
                      <option value="">Nessuna</option>
                      {absenceTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-xl bg-slate-800 p-3">
                    <div className="text-slate-400">Situazione attuale</div>
                    <div className="mt-2 space-y-1">
                      <div>
                        Ore:{' '}
                        <span className="font-semibold">
                          {dayDetails?.work_entry?.total_hours?.toFixed(2) ?? '0.00'}h
                        </span>
                      </div>
                      <div className="text-green-400">
                        Straordinario:{' '}
                        {dayDetails?.work_entry?.overtime?.toFixed(2) ?? '0.00'}h
                      </div>
                      <div className="text-red-400">
                        Deficit:{' '}
                        {dayDetails?.work_entry?.deficit?.toFixed(2) ?? '0.00'}h
                      </div>
                      <div>
                        Assenza:{' '}
                        <span style={{ color: dayDetails?.absence?.color || '#fff' }}>
                          {dayDetails?.absence?.name || 'Nessuna'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleSaveDay}
                    disabled={saving}
                    className="w-full rounded-xl bg-sky-600 px-4 py-3 font-semibold hover:bg-sky-500 disabled:opacity-50"
                  >
                    {saving ? 'Salvataggio...' : 'Salva giorno'}
                  </button>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <h3 className="mb-3 text-xl font-semibold">Assenze del mese</h3>
              <div className="space-y-3 text-sm text-slate-300">
                {!statsData || Object.keys(statsData.absence_counts).length === 0 ? (
                  <div className="rounded-xl bg-slate-800 p-3">
                    Nessuna assenza registrata
                  </div>
                ) : (
                  Object.entries(statsData.absence_counts).map(([name, count]) => (
                    <div key={name} className="rounded-xl bg-slate-800 p-3">
                      {name}: {count} giorni
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>

      <div className="fixed bottom-3 left-3 z-50 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 text-xs italic text-slate-400 shadow-lg backdrop-blur">
        Viperhack89 Grd.Capo Giovanni PIROZZI
      </div>
    </main>
  );
}