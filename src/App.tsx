import { useEffect, useRef, useState } from 'react';
import { informalFeedback } from './wording';
import WeeklyOverview from './WeeklyOverview';
import EditableEventTime from './EditableEventTime';
import { nextSunday, addDays, displayDate } from '../shared/schedule';
import { sample, longSample } from './examples';
import {
  ArrowRight,
  Check,
  Church,
  Copy,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import {
  measureText,
  formatEventDate,
  MAX_WORDS,
  MAX_SENTENCES,
  submissionSchema,
  savedAnnouncementSchema,
  type SavedAnnouncement,
  type WriteAnnouncement,
  type EventOverride,
} from '../shared/contracts';

type EditSession = { id: string };
const SESSION_KEY = 'autooznam-edit';
function readSession(): EditSession | null {
  const match = location.hash.match(
    /^#edit=([a-f0-9-]{36})(?:\.[a-f0-9]{64})?$/,
  );
  if (match) return { id: match[1] };
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return typeof value?.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id)
      ? { id: value.id }
      : null;
  } catch {
    return null;
  }
}
function remember(session: EditSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* URL remains available when storage is disabled. */
  }
  history.replaceState(null, '', `#edit=${session.id}`);
}
async function api(
  path: string,
  session: EditSession,
  payload?: WriteAnnouncement,
): Promise<SavedAnnouncement> {
  const response = await fetch(path, {
    method: payload ? 'POST' : 'GET',
    headers: {
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  }).catch(() => {
    throw new Error('Spojenie zlyhalo. Skús uloženie znova.');
  });
  const body = await response
    .json()
    .catch(() => ({ error: 'Server neodpovedal. Skús to znova.' }));
  if (!response.ok)
    throw Object.assign(
      new Error(body.error || 'Oznam sa nepodarilo uložiť.'),
      { status: response.status },
    );
  const parsed = savedAnnouncementSchema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      'Server vrátil neplatné údaje oznamu. Skús obnoviť stránku.',
    );
  return parsed.data;
}
function AnnouncementForm() {
  const [session, setSession] = useState<EditSession | null>(readSession);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [publishOn, setPublishOn] = useState<string[]>(() => [nextSunday()]);
  const [eventOverride, setEventOverride] = useState<EventOverride | null>(
    null,
  );
  const upcomingSunday = nextSunday();
  const followingSunday = addDays(upcomingSunday, 7);
  const sundayOptions = [
    ...new Set([upcomingSunday, followingSunday, ...publishOn]),
  ].sort();
  const [saved, setSaved] = useState<SavedAnnouncement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dateSaving, setDateSaving] = useState(false);
  const [loading, setLoading] = useState(!!session);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<WriteAnnouncement | null>(null);
  const metrics = measureText(text);
  const analysis = dirty ? null : saved?.analysis;
  const editLink = session ? `${location.origin}/#edit=${session.id}` : '';

  useEffect(() => {
    const initial = readSession();
    if (!initial) return;
    let cancelled = false;
    api(`/api/announcements/${initial.id}`, initial)
      .then((value) => {
        if (cancelled) return;
        setSaved(value);
        setText(value.text);
        setName(value.name);
        setContact(value.contact);
        setPublishOn(value.publishOn.length ? value.publishOn : [nextSunday()]);
        setEventOverride(value.eventOverride);
        remember(initial);
      })
      .catch((e) => {
        if (!cancelled && (e.status !== 404 || location.hash))
          setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function changed() {
    setDirty(true);
    setError('');
    setCopied(false);
  }
  function changeText(value: string) {
    setText(value);
    changed();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || loading || dateSaving) return;
    const result = submissionSchema.safeParse({
      text,
      name,
      contact,
      publishOn,
      eventOverride,
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    const current = session || { id: crypto.randomUUID() };
    setSession(current);
    remember(current);
    // Reuse the request ID after a lost response, so retrying cannot create another version.
    if (
      !pending.current ||
      pending.current.text !== result.data.text ||
      pending.current.name !== result.data.name ||
      pending.current.contact !== result.data.contact ||
      JSON.stringify(pending.current.publishOn) !==
        JSON.stringify(result.data.publishOn) ||
      JSON.stringify(pending.current.eventOverride) !==
        JSON.stringify(result.data.eventOverride)
    ) {
      pending.current = {
        ...result.data,
        id: current.id,
        requestId: crypto.randomUUID(),
        baseRevision: saved?.revision || 0,
      };
    }
    setBusy(true);
    setError('');
    try {
      const value = await api('/api/announcements', current, pending.current);
      setSaved(value);
      setText(value.text);
      setName(value.name);
      setContact(value.contact);
      setPublishOn(value.publishOn);
      setEventOverride(value.eventOverride);
      setDirty(false);
      pending.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* No local storage available. */
    }
    history.replaceState(null, '', '/');
    setSession(null);
    setSaved(null);
    setText('');
    setName('');
    setContact('');
    setPublishOn([nextSunday()]);
    setEventOverride(null);
    setDirty(false);
    setError('');
    setCopied(false);
    pending.current = null;
    textRef.current?.focus();
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(editLink);
      setCopied(true);
    } catch {
      setError('Odkaz označ a skopíruj ručne.');
    }
  }
  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="AutoOznam – domov">
          <span className="brand-icon">
            <Church size={21} strokeWidth={1.6} />
          </span>
          Auto<span>Oznam</span>
        </a>
        <a className="overview-link" href="/prehlad">
          Prehľad oznamov
        </a>
      </header>
      <main>
        {loading ? (
          <p role="status">Načítavame oznam…</p>
        ) : (
          <form
            className="form-card"
            onSubmit={submit}
            aria-label="Farský oznam"
          >
            <div className="label-row">
              <label className="sr-only" htmlFor="announcement">
                Oznam
              </label>
              <button
                type="button"
                className="text-button"
                disabled={busy || dateSaving}
                onClick={() => {
                  changeText(sample);
                  textRef.current?.focus();
                }}
              >
                Vyskúšaj príklad
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy || dateSaving}
                onClick={() => {
                  changeText(longSample);
                  textRef.current?.focus();
                }}
              >
                Dlhý príklad
              </button>
            </div>
            <textarea
              ref={textRef}
              id="announcement"
              value={text}
              onChange={(e) => changeText(e.target.value)}
              maxLength={6000}
              minLength={10}
              required
              readOnly={busy || dateSaving}
              placeholder="Napr. Brigáda v sobotu o 9:00 pri farskom kostole."
              aria-describedby="text-count"
            />
            <p
              id="text-count"
              className={`count ${metrics.tooLong ? 'long' : ''}`}
            >
              {metrics.words} / {MAX_WORDS} slov · {metrics.sentences} /{' '}
              {MAX_SENTENCES} vety
            </p>
            {metrics.tooLong && (
              <p className="warning">
                <TriangleAlert size={16} />
                Oznam je príliš dlhý. Pri odoslaní ti navrhneme skrátenie.
              </p>
            )}
            <fieldset
              className="publication-picker"
              disabled={busy || dateSaving}
            >
              <legend>Pridaj do oznamov</legend>
              <div className="publication-options">
                {sundayOptions.map((date) => (
                  <label key={date}>
                    <input
                      type="checkbox"
                      checked={publishOn.includes(date)}
                      onChange={(e) => {
                        setPublishOn(
                          e.target.checked
                            ? [...publishOn, date].sort()
                            : publishOn.filter((d) => d !== date),
                        );
                        changed();
                      }}
                    />
                    <span>
                      {date === upcomingSunday
                        ? 'Túto nedeľu'
                        : date === followingSunday
                          ? 'Budúcu nedeľu'
                          : 'Nedeľa'}{' '}
                      <small>{displayDate(date)}</small>
                    </span>
                  </label>
                ))}
              </div>
              {publishOn.length > 0 && (
                <p>
                  Relatívne termíny rátame od{' '}
                  {displayDate([...publishOn].sort()[0])}.
                </p>
              )}
            </fieldset>
            <div className="contact-fields">
              <div>
                <label htmlFor="name">Tvoje meno</label>
                <input
                  id="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  disabled={busy || dateSaving}
                  onChange={(e) => {
                    setName(e.target.value);
                    changed();
                  }}
                />
              </div>
              <div>
                <label htmlFor="contact">E-mail alebo telefón</label>
                <input
                  id="contact"
                  autoComplete="email"
                  required
                  maxLength={150}
                  value={contact}
                  disabled={busy || dateSaving}
                  onChange={(e) => {
                    setContact(e.target.value);
                    changed();
                  }}
                />
              </div>
            </div>
            {error && (
              <div className="error-message" role="alert">
                <TriangleAlert size={17} />
                <span>{error}</span>
                {error.includes('medzičasom') && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => location.reload()}
                  >
                    Načítaj aktuálnu verziu
                  </button>
                )}
              </div>
            )}
            <div className="form-bottom">
              <p>Kontakt použijeme iba k tomuto oznamu.</p>
              <button
                type="submit"
                className="primary"
                disabled={busy || dateSaving}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="spin" size={17} />
                    Ukladáme a kontrolujeme…
                  </>
                ) : (
                  <>
                    {saved ? 'Ulož zmeny' : 'Odošli oznam'}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </div>
            <div aria-live="polite" aria-atomic="true">
              {saved && (
                <p className="save-status" role="status">
                  {dirty ? 'Zmeny ešte nie sú uložené.' : 'Oznam je uložený.'}
                </p>
              )}
              {!dirty && saved?.reviewError && (
                <p className="warning">{saved.reviewError}</p>
              )}
              {analysis && (
                <div className="review">
                  <p className="review-title">
                    {saved?.status === 'pending'
                      ? 'Oznam je kompletný.'
                      : 'Doplň alebo skráť text.'}
                  </p>
                  <div className="review-checks">
                    {(
                      [
                        { key: 'what', label: 'Čo' },
                        { key: 'where', label: 'Kde' },
                        { key: 'when', label: 'Kedy' },
                      ] as const
                    ).map(({ key, label }) => (
                      <div
                        key={key}
                        className={`review-item ${analysis[key].present && (key !== 'when' || !analysis.extracted?.timingIssue) ? 'passed' : 'missing'}`}
                      >
                        <span
                          className="check-label"
                          aria-label={`${label}: ${analysis[key].present && (key !== 'when' || !analysis.extracted?.timingIssue) ? 'v poriadku' : 'chýba'}`}
                        >
                          {analysis[key].present &&
                          (key !== 'when' ||
                            !analysis.extracted?.timingIssue) ? (
                            <Check size={17} />
                          ) : (
                            <TriangleAlert size={17} />
                          )}
                          <strong>{label}</strong>
                        </span>
                        {key === 'what' && (
                          <p>
                            {analysis[key].present
                              ? analysis.extracted?.title ||
                                analysis[key].detail
                              : informalFeedback(analysis[key].detail)}
                          </p>
                        )}
                        {key === 'where' && (
                          <p>
                            {analysis[key].present
                              ? analysis.extracted?.location ||
                                analysis[key].detail
                              : informalFeedback(analysis[key].detail)}
                          </p>
                        )}
                        {key === 'when' && (
                          <>
                            {analysis.extracted &&
                              formatEventDate(analysis.extracted) && (
                                <p>
                                  <time
                                    dateTime={
                                      analysis.extracted.startsAt ??
                                      analysis.extracted.date ??
                                      analysis.extracted.time ??
                                      undefined
                                    }
                                  >
                                    {formatEventDate(analysis.extracted)}
                                  </time>
                                  {analysis.extracted.dateInferred && (
                                    <small className="inferred-date">
                                      odvodený dátum
                                    </small>
                                  )}
                                </p>
                              )}
                            {(!analysis[key].present ||
                              !analysis.extracted ||
                              !formatEventDate(analysis.extracted)) && (
                              <p>{informalFeedback(analysis[key].detail)}</p>
                            )}
                            {analysis.extracted?.source &&
                              !saved?.eventOverride &&
                              (analysis.extracted.dateInferred ||
                                !analysis.extracted.startsAt) &&
                              (analysis.extracted.date ||
                                analysis.extracted.time) && (
                                <small className="date-source">
                                  {analysis.extracted.source}
                                </small>
                              )}
                            {saved && analysis.extracted?.date && (
                              <EditableEventTime
                                announcement={saved}
                                disabled={busy}
                                onBusyChange={setDateSaving}
                                onSaved={(value) => {
                                  setSaved(value);
                                  setEventOverride(value.eventOverride);
                                  if (!dirty) {
                                    setText(value.text);
                                    setName(value.name);
                                    setContact(value.contact);
                                    setPublishOn(value.publishOn);
                                  }
                                }}
                              />
                            )}
                            {analysis.extracted?.timingIssue && (
                              <p className="timing-issue">
                                {informalFeedback(
                                  analysis.extracted.timingIssue,
                                )}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  {analysis.suggestion && (
                    <div className="suggestion">
                      <h2>Návrh skrátenia</h2>
                      <p>{analysis.suggestion}</p>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy || dateSaving}
                        onClick={() => {
                          changeText(analysis.suggestion!);
                          textRef.current?.focus();
                        }}
                      >
                        Použi tento návrh
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {saved && (
              <div className="edit-actions">
                <div className="edit-link-block">
                  <p id="edit-link-label">Odkaz na ďalšie úpravy</p>
                  <div className="edit-link-row">
                    <a
                      className="edit-link"
                      href={editLink}
                      aria-describedby="edit-link-label"
                    >
                      {editLink}
                    </a>
                    <button
                      type="button"
                      className="text-button copy-link-button"
                      onClick={copyLink}
                      aria-label={copied ? 'Skopírované' : 'Skopíruj odkaz'}
                      title={copied ? 'Skopírované' : 'Skopíruj odkaz'}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                    <span className="sr-only" aria-live="polite">
                      {copied ? 'Odkaz je skopírovaný.' : ''}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || dateSaving}
                  onClick={reset}
                >
                  Pridaj ďalší oznam
                </button>
              </div>
            )}
          </form>
        )}
      </main>
    </>
  );
}

export default function App() {
  return location.pathname === '/prehlad' ? (
    <WeeklyOverview />
  ) : (
    <AnnouncementForm />
  );
}
