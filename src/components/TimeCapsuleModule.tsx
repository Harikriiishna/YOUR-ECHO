import React, { useEffect, useState } from 'react';
import { Clock, Edit3, Lock, Plus, Sparkles, Trash2, Unlock, X } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import type { MediaMeta, TimeCapsuleItem } from '../types/echo';
import { AuthMedia, MediaPicker, SafeImage, VoiceRecorder } from './MediaElements';

const CAPSULE_TYPES = [
  { id: 'letter', label: 'Letter' },
  { id: 'promise', label: 'Personal Promise' },
  { id: 'prediction', label: 'Prediction' },
  { id: 'goal', label: 'Future Goal' },
  { id: 'memory', label: 'Preserved Memory' },
];

const OCCASIONS = [
  { id: 'specific_date', label: 'Specific Date' },
  { id: 'birthday', label: 'Birthday' },
  { id: 'graduation', label: 'Graduation' },
  { id: 'anniversary', label: 'Anniversary' },
  { id: 'custom', label: 'Custom Milestone' },
];

export function TimeCapsuleModule() {
  const { user, quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [capsules, setCapsules] = useState<TimeCapsuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(Date.now());
  const [openingCapsule, setOpeningCapsule] = useState<TimeCapsuleItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [capsuleType, setCapsuleType] = useState('letter');
  const [unlockOccasion, setUnlockOccasion] = useState('specific_date');
  const [unlockDateLocal, setUnlockDateLocal] = useState(() => {
    const d = new Date(Date.now() + 86400000 * 30);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [attachedMedia, setAttachedMedia] = useState<MediaMeta[]>([]);
  const [lockImmediately, setLockImmediately] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCapsules = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ capsules: TimeCapsuleItem[] }>('/capsules');
      setCapsules(res.capsules);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load capsules.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCapsules();
  }, []);

  const hasLockedCapsules = capsules.some((c) => c.isLocked);
  useEffect(() => {
    if (!hasLockedCapsules) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasLockedCapsules]);

  useEffect(() => {
    if (quickCaptureTarget === 'capsule') {
      openNewCapsule();
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  const openNewCapsule = () => {
    setEditingId(null);
    setTitle('');
    setMessage('');
    setCapsuleType('letter');
    setUnlockOccasion('specific_date');
    const d = new Date(Date.now() + 86400000 * 30);
    setUnlockDateLocal(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setAttachedMedia([]);
    setLockImmediately(false);
    setError(null);
    setEditorOpen(true);
  };

  const openEditCapsule = (c: TimeCapsuleItem) => {
    setEditingId(c.id);
    setTitle(c.title);
    setMessage(c.message || '');
    setCapsuleType(c.capsuleType);
    setUnlockOccasion(c.unlockOccasion);
    const d = new Date(c.unlockAt);
    const safeDate = Number.isFinite(d.getTime()) ? d : new Date(Date.now() + 86400000 * 30);
    setUnlockDateLocal(new Date(safeDate.getTime() - safeDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setAttachedMedia(c.media);
    setLockImmediately(false);
    setError(null);
    setEditorOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const unlockMs = Date.parse(unlockDateLocal);
      if (!Number.isFinite(unlockMs)) {
        setError('Please enter a valid unlock date and time.');
        return;
      }
      const unlockIso = new Date(unlockMs).toISOString();
      const payload = {
        title: title.trim(),
        message: message.trim(),
        capsuleType,
        unlockOccasion,
        unlockAt: unlockIso,
        timezone: user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        mediaIds: attachedMedia.map((m) => m.id),
        lockImmediately,
      };
      if (editingId) {
        await apiRequest(`/capsules/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (lockImmediately) {
          await apiRequest(`/capsules/${encodeURIComponent(editingId)}/lock`, { method: 'POST' });
        }
      } else {
        await apiRequest('/capsules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditorOpen(false);
      await loadCapsules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save capsule.');
    } finally {
      setSaving(false);
    }
  };

  const handleLock = async (id: string) => {
    try {
      await apiRequest(`/capsules/${encodeURIComponent(id)}/lock`, { method: 'POST' });
      await loadCapsules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to seal capsule.');
    }
  };

  const handleOpenCeremony = async (c: TimeCapsuleItem) => {
    try {
      const res = await apiRequest<{ capsule: TimeCapsuleItem }>(`/capsules/${encodeURIComponent(c.id)}/open`, {
        method: 'POST',
      });
      setOpeningCapsule(res.capsule);
      await loadCapsules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capsule cannot be opened yet.');
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await apiRequest(`/capsules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadCapsules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete capsule.');
    }
  };

  const formatRemaining = (unlockAt: string) => {
    const diff = Math.max(0, Date.parse(unlockAt) - nowTick);
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  };

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div className="relative overflow-hidden rounded-2xl border border-hairline bg-[#0D1424] w-full">
        <SafeImage
          src="/src/assets/images/echo_capsule_vault_1795260972711.jpg"
          alt="Brushed titanium and amber glass time capsule"
          className="absolute inset-0 w-full h-full object-cover opacity-35"
        />
        <div className="relative z-10 bg-gradient-to-r from-[#070B14]/95 via-[#070B14]/80 to-[#070B14]/60 p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
          <div className="space-y-1.5 max-w-xl">
            <p className="text-xs font-medium text-amber-300">Server-Enforced Vault</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Time Capsules</h1>
            <p className="text-sm text-slate-300">
              Once sealed, neither the API, database query, nor media endpoints will reveal a capsule before its exact unlock timestamp.
            </p>
          </div>
          <button
            type="button"
            onClick={openNewCapsule}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            Create Time Capsule
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-2xl bg-tint animate-pulse" />
          ))}
        </div>
      ) : capsules.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-10 text-center space-y-3">
          <Clock className="w-8 h-8 text-amber-600 dark:text-amber-300 mx-auto" />
          <h2 className="font-display text-lg font-semibold text-ink">No Time Capsules yet</h2>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            Draft a letter, promise, or voice message to your future self and seal it for a birthday, graduation, or anniversary.
          </p>
          <button
            type="button"
            onClick={openNewCapsule}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-semibold text-slate-950"
          >
            <Plus className="w-4 h-4" /> Create First Capsule
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {capsules.map((c) => {
            const sealedAndWaiting = c.isLocked && Date.parse(c.unlockAt) > nowTick;
            const readyToReveal = c.isLocked && Date.parse(c.unlockAt) <= nowTick;

            return (
              <article
                key={c.id}
                className={`rounded-2xl border p-6 flex flex-col justify-between space-y-4 ${
                  readyToReveal
                    ? 'border-emerald-400/50 bg-surface-raised'
                    : sealedAndWaiting
                    ? 'border-amber-400/30 bg-surface'
                    : 'border-hairline bg-surface'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">
                      {c.capsuleType} · {c.unlockOccasion.replace('_', ' ')}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        sealedAndWaiting
                          ? 'text-amber-700 dark:text-amber-300'
                          : readyToReveal
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-sky-700 dark:text-sky-300'
                      }`}
                    >
                      {sealedAndWaiting ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      {sealedAndWaiting ? 'Sealed' : readyToReveal ? 'Ready to Open' : 'Draft'}
                    </span>
                  </div>

                  <h3 className="font-display text-lg font-bold text-ink">{c.title}</h3>

                  {sealedAndWaiting ? (
                    <div className="rounded-xl border border-amber-500/25 bg-inset p-4 space-y-1.5">
                      <div className="text-xs text-ink-muted">Unlocks in</div>
                      <div className="font-mono text-xl font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                        {formatRemaining(c.unlockAt)}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        Content & media are strictly locked server-side until {new Date(c.unlockAt).toLocaleString()} ({c.timezone}).
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-secondary line-clamp-4 whitespace-pre-wrap">
                      {c.message || 'Ready to reveal inside the opening ceremony.'}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-hairline flex flex-wrap items-center justify-between gap-2">
                  {!c.isLocked && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditCapsule(c)}
                        className="inline-flex items-center gap-1 text-xs text-ink-secondary hover:text-ink"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLock(c.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300"
                      >
                        <Lock className="w-3.5 h-3.5" /> Seal Capsule
                      </button>
                    </>
                  )}

                  {readyToReveal && (
                    <button
                      type="button"
                      onClick={() => void handleOpenCeremony(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {c.openedAt ? 'Read Capsule' : 'Open Capsule Ceremony'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleDelete(c.id)}
                    aria-label="Delete capsule"
                    className="ml-auto text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 p-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* OPENING CEREMONY MODAL */}
      {openingCapsule && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl border border-emerald-400/40 bg-surface p-6 sm:p-8 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Capsule Unlocked · {new Date(openingCapsule.unlockAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                onClick={() => setOpeningCapsule(null)}
                className="p-1.5 text-ink-muted hover:text-ink"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <h2 className="font-display text-3xl font-bold text-ink">{openingCapsule.title}</h2>
            <p className="text-base text-ink-secondary leading-relaxed whitespace-pre-wrap">{openingCapsule.message}</p>
            {openingCapsule.media.length > 0 && (
              <div className="space-y-3 pt-2">
                {openingCapsule.media.map((med) => (
                  <AuthMedia key={med.id} mediaId={med.id} mimeTypeHint={med.mime_type} />
                ))}
              </div>
            )}
            <div className="text-xs text-ink-muted pt-3 border-t border-hairline">
              Written on {new Date(openingCapsule.createdAt).toLocaleDateString()} · Occasion: {openingCapsule.unlockOccasion.replace('_', ' ')}
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSave} className="w-full max-w-xl rounded-2xl border border-hairline-strong bg-surface p-4 sm:p-6 space-y-4 my-4 sm:my-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-ink">
                {editingId ? 'Edit Draft Capsule' : 'Create Time Capsule'}
              </h2>
              <button type="button" onClick={() => setEditorOpen(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Capsule title"
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />

            <textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your letter, promise, goal, or prediction..."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-ink-muted block mb-1">Capsule Type</label>
                <select
                  value={capsuleType}
                  onChange={(e) => setCapsuleType(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                >
                  {CAPSULE_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-ink-muted block mb-1">Occasion</label>
                <select
                  value={unlockOccasion}
                  onChange={(e) => setUnlockOccasion(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                >
                  {OCCASIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-ink-muted block mb-1">
                Unlock Date & Time (Timezone: {user?.timezone || 'Local'})
              </label>
              <input
                type="datetime-local"
                required
                value={unlockDateLocal}
                onChange={(e) => setUnlockDateLocal(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink font-mono"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <MediaPicker contextType="capsule" onUploaded={(m) => setAttachedMedia((prev) => [...prev, m])} />
              <VoiceRecorder contextType="capsule" onUploaded={(m) => setAttachedMedia((prev) => [...prev, m])} />
            </div>

            {attachedMedia.length > 0 && (
              <div className="text-xs text-ink-secondary">
                {attachedMedia.length} attachment(s) ready to seal.
              </div>
            )}

            <label className="flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={lockImmediately}
                onChange={(e) => setLockImmediately(e.target.checked)}
                className="mt-0.5 rounded border-amber-400/40 bg-inset"
              />
              <span>Seal immediately upon saving (irreversible — cannot be viewed or edited until unlock date).</span>
            </label>

            {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-xl border border-hairline-strong px-4 py-2 text-xs text-ink-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-amber-400 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-300"
              >
                {saving ? 'Saving...' : lockImmediately ? 'Save & Seal Capsule' : 'Save Draft'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
