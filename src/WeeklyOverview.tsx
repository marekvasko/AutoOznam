import { useState } from 'react';
import { Church, Download, LoaderCircle } from 'lucide-react';
import { nextSunday, displayDate } from '../shared/schedule';
import {
  weeklyReportSchema,
  type WeeklyReport,
  type ReportItem,
} from '../shared/report';
export default function WeeklyOverview() {
  const [sunday, setSunday] = useState(nextSunday);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function request(format: 'json' | 'txt') {
    const response = await fetch(
      `/api/reports/weekly?sunday=${encodeURIComponent(sunday)}&format=${format}`,
    );
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || 'Prehľad sa nepodarilo načítať.');
    }
    return response;
  }
  async function load(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const value = weeklyReportSchema.parse(
        await (await request('json')).json(),
      );
      setReport(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(format: 'txt' | 'json') {
    setBusy(true);
    setError('');
    try {
      const response = await request(format);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `oznamy-${sunday}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function section(title: string, items: ReportItem[], full = false) {
    return (
      <section className="report-section">
        <h2>
          {title} <span>({items.length})</span>
        </h2>
        {!items.length ? (
          <p className="muted">Žiadne oznamy.</p>
        ) : (
          items.map((item) => (
            <article key={item.id} className="report-item">
              <h3>{item.title}</h3>
              <a className="text-button" href={`/#edit=${item.id}`}>
                Uprav oznam
              </a>
              <p className="report-meta">
                {[
                  item.date ? displayDate(item.date) : 'Bez presného dátumu',
                  item.time,
                  item.location,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {full && <p className="report-text">{item.text}</p>}
              {item.status !== 'pending' && (
                <p className="report-flag">
                  Na kontrolu:{' '}
                  {item.status === 'needs_changes'
                    ? 'doplň údaje alebo skráť text'
                    : item.status === 'checking'
                      ? 'kontrola prebieha'
                      : 'AI kontrola nedostupná'}
                </p>
              )}
              {item.timingIssue && (
                <p className="report-flag">{item.timingIssue}</p>
              )}
            </article>
          ))
        )}
      </section>
    );
  }
  return (
    <>
      <header className="site-header">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Church size={21} />
          </span>
          Auto<span>Oznam</span>
        </a>
        <a className="overview-link" href="/">
          Pridaj oznam
        </a>
      </header>
      <main className="overview">
        <h1>Prehľad oznamov</h1>
        <form className="form-card report-filter" onSubmit={load}>
          <div>
            <label htmlFor="report-sunday">Nedeľa zverejnenia</label>
            <input
              id="report-sunday"
              type="date"
              required
              value={sunday}
              onChange={(e) => {
                setSunday(e.target.value);
                setReport(null);
              }}
            />
          </div>

          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : null}Zobraz
            prehľad
          </button>
        </form>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {report && (
          <>
            <div className="report-downloads">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => download('txt')}
              >
                <Download size={15} />
                Stiahni TXT
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => download('json')}
              >
                Stiahni JSON
              </button>
              <button className="text-button" onClick={() => window.print()}>
                Vytlač / PDF
              </button>
            </div>
            <div className="report-content">
              {section(
                `Na zverejnenie ${displayDate(report.sunday)}`,
                report.announcements,
                true,
              )}
              {section(
                `Nasledujúci týždeň: ${displayDate(report.weekStart)} – ${displayDate(report.weekEnd)}`,
                report.weekEvents,
              )}
              {section('Neskoršie udalosti', report.futureEvents)}
              {section('Bez presného dátumu', report.undated, true)}
            </div>
          </>
        )}
      </main>
    </>
  );
}
