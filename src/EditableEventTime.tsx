import { useEffect, useRef, useState } from 'react';
import { Pencil, LoaderCircle } from 'lucide-react';
import {
  savedAnnouncementSchema,
  type EventOverride,
  type SavedAnnouncement,
} from '../shared/contracts';
type Props = {
  announcement: SavedAnnouncement;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: (value: SavedAnnouncement) => void;
};
type Patch = {
  requestId: string;
  baseRevision: number;
  eventOverride: EventOverride;
};
const valueOf = (value: SavedAnnouncement): EventOverride =>
  value.eventOverride ?? {
    date: value.analysis?.extracted?.date ?? null,
    time: value.analysis?.extracted?.time ?? null,
  };
export default function EditableEventTime({
  announcement,
  disabled,
  onBusyChange,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EventOverride>(() =>
    valueOf(announcement),
  );
  const [status, setStatus] = useState<
    'idle' | 'waiting' | 'saving' | 'saved' | 'error'
  >('idle');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const pending = useRef<Patch | null>(null);
  async function request(patch?: Patch) {
    const response = await fetch(
      `/api/announcements/${announcement.id}${patch ? '/event' : ''}`,
      patch
        ? {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
            keepalive: true,
            signal: AbortSignal.timeout(15_000),
          }
        : {},
    ).catch(() => {
      throw new Error('Termín sa nepodarilo uložiť. Skús to znova.');
    });
    const body = await response.json().catch(() => {
      throw new Error('Server vrátil neplatnú odpoveď. Skús to znova.');
    });
    if (!response.ok)
      throw Object.assign(
        new Error(body.error || 'Termín sa nepodarilo uložiť.'),
        { status: response.status },
      );
    const parsed = savedAnnouncementSchema.safeParse(body);
    if (!parsed.success) throw new Error('Server vrátil neplatný termín.');
    return parsed.data;
  }
  async function save() {
    if (disabled || status === 'saving') return;
    if (
      !pending.current ||
      JSON.stringify(pending.current.eventOverride) !== JSON.stringify(draft)
    )
      pending.current = {
        requestId: crypto.randomUUID(),
        baseRevision: announcement.revision,
        eventOverride: draft,
      };
    setStatus('saving');
    setError('');
    setConflict(false);
    onBusyChange(true);
    try {
      const value = await request(pending.current);
      setDraft(valueOf(value));
      pending.current = null;
      onSaved(value);
      setStatus('saved');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Spojenie zlyhalo. Skús uloženie znova.',
      );
      setConflict((e as { status?: number }).status === 409);
      setStatus('error');
    } finally {
      onBusyChange(false);
    }
  }
  useEffect(() => {
    if (status !== 'waiting' || disabled) return;
    const timer = setTimeout(() => void save(), 600);
    return () => clearTimeout(timer);
  }, [status, draft.date, draft.time, disabled, announcement.revision]);
  useEffect(() => {
    if (status !== 'waiting' && status !== 'saving' && status !== 'error')
      setDraft(valueOf(announcement));
  }, [announcement.revision]);
  function change(next: EventOverride) {
    setDraft(next);
    setError('');
    setConflict(false);
    setStatus('waiting');
    onBusyChange(true);
  }
  async function reload() {
    setStatus('saving');
    onBusyChange(true);
    try {
      const value = await request();
      onSaved(value);
      setDraft(valueOf(value));
      pending.current = null;
      setError('');
      setConflict(false);
      setStatus('idle');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    } finally {
      onBusyChange(false);
    }
  }
  const saving = status === 'saving' || status === 'waiting';
  return (
    <div className="inline-event-editor">
      <button
        type="button"
        className="text-button edit-time-button"
        disabled={disabled || saving}
        aria-expanded={editing}
        aria-controls="inline-event-fields"
        onClick={() => {
          if (!editing) {
            setDraft(valueOf(announcement));
            setStatus('idle');
            setError('');
          }
          setEditing(!editing);
        }}
      >
        <Pencil size={12} />
        {editing ? 'Zavri' : 'Uprav'}
      </button>
      {editing && (
        <div id="inline-event-fields" className="inline-event-fields">
          <label htmlFor="parsed-event-date">
            Dátum
            <input
              id="parsed-event-date"
              type="date"
              disabled={disabled || status === 'saving'}
              value={draft.date ?? ''}
              onChange={(e) =>
                change({ ...draft, date: e.target.value || null })
              }
            />
          </label>
          <label htmlFor="parsed-event-time">
            Čas
            <input
              id="parsed-event-time"
              type="time"
              disabled={disabled || status === 'saving'}
              value={draft.time ?? ''}
              onChange={(e) =>
                change({ ...draft, time: e.target.value || null })
              }
            />
          </label>
          <span className="date-save-status" aria-live="polite">
            {saving ? (
              <>
                <LoaderCircle className="spin" size={12} />
                Ukladáme…
              </>
            ) : status === 'saved' ? (
              'Uložené'
            ) : status === 'error' ? (
              'Neuložené'
            ) : (
              'Zmeny sa uložia automaticky.'
            )}
          </span>
          {error && (
            <div className="date-save-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="text-button"
                disabled={disabled || status === 'saving'}
                onClick={() => void (conflict ? reload() : save())}
              >
                {conflict ? 'Načítaj aktuálny termín' : 'Skús uložiť znova'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
