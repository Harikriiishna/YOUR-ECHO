import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Download,
  Edit3,
  Globe,
  Link2,
  Lock,
  Moon,
  Plus,
  QrCode,
  Repeat,
  Search,
  Sparkles,
  Trash2,
  Watch,
  X,
} from 'lucide-react';
import dreamNebulaImg from '../assets/images/echo_dream_nebula_1795260972846.jpg';
import heirloomWatchImg from '../assets/images/echo_heirloom_watch_1795260972446.jpg';
import { useEcho } from '../context/EchoContext';
import { apiRequest, readOfflineCache, saveOfflineCache } from '../lib/api';
import type { DreamItem, EchoObject, MemoryItem } from '../types/echo';
import { AuthMedia, MediaPicker, SafeImage, VoiceRecorder } from './MediaElements';

const OBJECT_CATEGORIES = [
  'Watches',
  'Gifts',
  'Old phones',
  'Toys',
  'Books',
  'Family photographs',
  'Letters',
  'Bicycles',
  'Jewellery',
  'Musical instruments',
  'Other',
];

const DREAM_CATEGORIES = ['Lucid', 'Recurring', 'Surreal', 'Symbolic', 'Nostalgic', 'Nightmare', 'Prophetic-feeling', 'Everyday'];
const DREAM_EMOTIONS = ['Wonder', 'Peace', 'Curiosity', 'Nostalgia', 'Fear', 'Joy', 'Mystery', 'Longing'];

export function LifeBehindObjectsModule() {
  const { user, focusItemId, navigateTo, quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [objects, setObjects] = useState<EchoObject[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selected, setSelected] = useState<EchoObject | null>(null);
  const [qrModal, setQrModal] = useState<{ qrDataUrl: string; shareUrl: string; isPublic: boolean } | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Watches');
  const [description, setDescription] = useState('');
  const [story, setStory] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState('');
  const [currentOwner, setCurrentOwner] = useState(user?.displayName || '');
  const [previousOwnersInput, setPreviousOwnersInput] = useState('');
  const [connectedPeopleInput, setConnectedPeopleInput] = useState('');
  const [location, setLocation] = useState('');
  const [historicalNotes, setHistoricalNotes] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [relatedMemoryIds, setRelatedMemoryIds] = useState<string[]>([]);
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(null);
  const [voiceMediaId, setVoiceMediaId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadObjects = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (search.trim()) params.set('q', search.trim());

      const [objRes, memRes] = await Promise.all([
        apiRequest<{ objects: EchoObject[] }>(`/objects?${params.toString()}`),
        apiRequest<{ memories: MemoryItem[] }>('/memories'),
      ]);
      setObjects(objRes.objects);
      setMemories(memRes.memories);
      void saveOfflineCache('objects', objRes.objects);
    } catch (err) {
      const cached = await readOfflineCache<EchoObject[]>('objects');
      if (cached) {
        setObjects(cached);
      } else {
        setObjects([]);
        setError(err instanceof Error ? err.message : 'Unable to load objects.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadObjects();
  }, [categoryFilter]);

  useEffect(() => {
    if (focusItemId && objects.length > 0) {
      const match = objects.find((o) => o.id === focusItemId);
      if (match) setSelected(match);
    }
  }, [focusItemId, objects]);

  useEffect(() => {
    if (quickCaptureTarget === 'object') {
      openNew();
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  const openNew = () => {
    setEditingId(null);
    setName('');
    setCategory('Watches');
    setDescription('');
    setStory('');
    setAcquisitionDate('');
    setCurrentOwner(user?.displayName || '');
    setPreviousOwnersInput('');
    setConnectedPeopleInput('');
    setLocation('');
    setHistoricalNotes('');
    setTagsInput('');
    setRelatedMemoryIds([]);
    setPhotoMediaId(null);
    setVoiceMediaId(null);
    setIsPublic(false);
    setError(null);
    setEditorOpen(true);
  };

  const openEdit = (obj: EchoObject) => {
    setEditingId(obj.id);
    setName(obj.name);
    setCategory(obj.category);
    setDescription(obj.description);
    setStory(obj.story);
    setAcquisitionDate(obj.acquisitionDate);
    setCurrentOwner(obj.currentOwner);
    setPreviousOwnersInput(obj.previousOwners.join(', '));
    setConnectedPeopleInput(obj.connectedPeople.join(', '));
    setLocation(obj.location);
    setHistoricalNotes(obj.historicalNotes);
    setTagsInput(obj.tags.join(', '));
    setRelatedMemoryIds(obj.relatedMemoryIds);
    setPhotoMediaId(obj.photoMediaId);
    setVoiceMediaId(obj.voiceMediaId);
    setIsPublic(obj.isPublic);
    setError(null);
    setEditorOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const payload = {
      name: name.trim(),
      category,
      description: description.trim(),
      story: story.trim(),
      acquisitionDate,
      currentOwner: currentOwner.trim(),
      previousOwners: split(previousOwnersInput),
      connectedPeople: split(connectedPeopleInput),
      location: location.trim(),
      historicalNotes: historicalNotes.trim(),
      tags: split(tagsInput),
      relatedMemoryIds,
      photoMediaId,
      voiceMediaId,
      isPublic,
    };

    try {
      if (editingId) {
        const res = await apiRequest<{ object: EchoObject }>(`/objects/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setSelected(res.object);
      } else {
        await apiRequest('/objects', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditorOpen(false);
      await loadObjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save object story.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenQr = async (obj: EchoObject) => {
    setError(null);
    try {
      const res = await apiRequest<{ qrDataUrl: string; shareUrl: string; isPublic: boolean }>(
        `/objects/${encodeURIComponent(obj.id)}/qrcode`
      );
      setQrModal(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate QR code.');
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), objects }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-objects-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await apiRequest(`/objects/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (selected?.id === id) setSelected(null);
      await loadObjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete object.');
    }
  };

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div className="relative overflow-hidden rounded-2xl border border-hairline bg-[#0D1424] w-full">
        <SafeImage
          src={heirloomWatchImg}
          alt="Antique brass pocket watch beside a worn leather notebook"
          className="absolute inset-0 w-full h-full object-cover opacity-35"
        />
        <div className="relative z-10 bg-gradient-to-r from-[#070B14]/95 via-[#070B14]/80 to-[#070B14]/55 p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
          <div className="space-y-1.5 max-w-xl min-w-0">
            <p className="text-xs font-medium text-rose-300">Heirlooms & Provenance</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Life Behind Objects</h1>
            <p className="text-sm text-slate-300">
              Preserve the human history, ownership lineage, voice stories, and QR tags behind meaningful everyday objects.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExport}
              disabled={objects.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#070B14]/80 px-3.5 py-2.5 text-xs font-medium text-slate-200 disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> Export
            </button>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-400 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-rose-300 min-h-[44px]"
            >
              <Plus className="w-4 h-4" /> Add Object Story
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 hover:opacity-80">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between min-w-0 w-full">
        <div className="w-full min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {['All', ...OBJECT_CATEGORIES].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                categoryFilter === cat
                  ? 'bg-rose-400 text-slate-950 font-semibold'
                  : 'bg-surface border border-hairline text-ink-secondary hover:text-ink'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadObjects();
          }}
          className="flex items-center gap-1.5 w-full sm:w-auto min-w-0 shrink-0"
        >
          <div className="relative flex-1 sm:w-48 min-w-0">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search objects..."
              className="w-full rounded-xl border border-hairline-strong bg-surface pl-8 pr-3 py-2 text-xs text-ink"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs font-medium text-ink-secondary hover:text-ink shrink-0"
          >
            Search
          </button>
        </form>
      </div>

      {loading ? (
        <div className="h-44 rounded-2xl bg-tint animate-pulse" />
      ) : objects.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-10 text-center space-y-3">
          <Watch className="w-8 h-8 text-rose-600 dark:text-rose-300 mx-auto" />
          <h2 className="font-display text-lg font-semibold text-ink">No object stories archived yet</h2>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            Document a family watch, childhood toy, handwritten letter, or musical instrument and link it to your ECHO memories.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`${selected ? 'lg:col-span-7' : 'lg:col-span-12'} grid grid-cols-1 sm:grid-cols-2 gap-4`}>
            {objects.map((obj) => (
              <article
                key={obj.id}
                onClick={() => setSelected(obj)}
                className={`touch-manipulation cursor-pointer rounded-2xl border p-5 space-y-3 transition-colors ${
                  selected?.id === obj.id
                    ? 'border-rose-400/50 bg-surface-raised'
                    : 'border-hairline bg-surface hover:border-hairline-strong'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span>{obj.category} · {obj.acquisitionDate || 'Undated'}</span>
                  <span className="inline-flex items-center gap-1 text-ink-secondary">
                    {obj.isPublic ? <Globe className="w-3.5 h-3.5 text-teal-600 dark:text-teal-300" /> : <Lock className="w-3.5 h-3.5" />}
                    {obj.isPublic ? 'Public' : 'Private'}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-ink">{obj.name}</h3>
                <p className="text-sm text-ink-secondary line-clamp-3">{obj.story}</p>
                <div className="text-xs text-ink-muted">
                  Steward: {obj.currentOwner || 'You'}
                  {obj.previousOwners.length > 0 && ` · ${obj.previousOwners.length} previous owner(s)`}
                </div>
              </article>
            ))}
          </div>

          {selected && (
            <aside className="lg:col-span-5 rounded-2xl border border-hairline bg-surface p-6 space-y-5 h-fit">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-rose-700 dark:text-rose-300">
                    {selected.category} · {selected.acquisitionDate || 'Undated'}
                  </div>
                  <h2 className="font-display text-2xl font-bold text-ink mt-1">{selected.name}</h2>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="text-ink-muted hover:text-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {selected.photoMediaId && <AuthMedia mediaId={selected.photoMediaId} className="max-h-60" />}
              {selected.voiceMediaId && <AuthMedia mediaId={selected.voiceMediaId} mimeTypeHint="audio/webm" />}

              {selected.description && <p className="text-xs text-ink-muted">{selected.description}</p>}
              <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap">{selected.story}</p>

              {/* Ownership Provenance Timeline */}
              <div className="rounded-xl border border-hairline bg-inset p-4 space-y-2">
                <div className="text-xs font-semibold text-rose-700 dark:text-rose-300">Ownership History</div>
                <div className="text-xs text-ink-secondary space-y-1">
                  {selected.previousOwners.map((owner, idx) => (
                    <div key={`${owner}-${idx}`}>Past owner #{idx + 1}: {owner}</div>
                  ))}
                  <div className="font-semibold text-ink">Current steward: {selected.currentOwner}</div>
                </div>
              </div>

              {selected.historicalNotes && (
                <div className="text-xs text-ink-muted">
                  <span className="text-ink-secondary font-medium">Historical Notes: </span>
                  {selected.historicalNotes}
                </div>
              )}

              {selected.relatedMemoryIds.length > 0 && (
                <div className="space-y-1.5 border-t border-hairline pt-3">
                  <div className="text-xs font-semibold text-ink-secondary inline-flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" /> Linked ECHO Memories
                  </div>
                  {selected.relatedMemoryIds.map((mid) => {
                    const m = memories.find((x) => x.id === mid);
                    if (!m) return null;
                    return (
                      <button
                        key={mid}
                        type="button"
                        onClick={() => navigateTo('memories', m.id)}
                        className="w-full text-left rounded-lg border border-hairline bg-inset px-3 py-2 text-xs text-sky-700 dark:text-sky-200 hover:border-sky-400/50"
                      >
                        {m.title} ({m.memoryDate})
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => void handleOpenQr(selected)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-tint px-3 py-2 text-xs text-ink hover:bg-tint-hover"
                >
                  <QrCode className="w-3.5 h-3.5 text-rose-600 dark:text-rose-300" /> QR Share
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(selected)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-tint px-3 py-2 text-xs text-ink hover:bg-tint-hover"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(selected.id)}
                  className="ml-auto inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* QR SHARE MODAL */}
      {qrModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-hairline-strong bg-surface p-6 text-center space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-ink">Object QR Tag</h3>
              <button type="button" onClick={() => setQrModal(null)} className="text-ink-muted hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>
            <img src={qrModal.qrDataUrl} alt="Object QR Code" className="w-52 h-52 mx-auto rounded-xl bg-white p-2" />
            <p className="text-xs text-ink-secondary">
              {qrModal.isPublic
                ? 'Anyone scanning this QR code can read this object story.'
                : 'This object is currently Private. Enable Public Sharing in Edit to allow external QR scans.'}
            </p>
            <div className="text-[11px] font-mono text-ink-muted break-all bg-inset border border-hairline rounded-lg p-2">
              {qrModal.shareUrl}
            </div>
          </div>
        </div>
      )}

      {/* EDITOR MODAL */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSave} className="w-full max-w-2xl rounded-2xl border border-hairline-strong bg-surface p-4 sm:p-6 space-y-4 my-4 sm:my-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-ink">
                {editingId ? 'Edit Object Story' : 'Preserve Meaningful Object'}
              </h2>
              <button type="button" onClick={() => setEditorOpen(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Object name"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              >
                {OBJECT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short physical description"
                className="sm:col-span-2 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />

              <textarea
                required
                rows={4}
                value={story}
                onChange={(e) => setStory(e.target.value)}
                placeholder="Tell the full story behind this object..."
                className="sm:col-span-2 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />

              <input
                type="text"
                value={acquisitionDate}
                onChange={(e) => setAcquisitionDate(e.target.value)}
                placeholder="Acquisition date or era"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Origin or current location"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />

              <input
                type="text"
                value={currentOwner}
                onChange={(e) => setCurrentOwner(e.target.value)}
                placeholder="Current owner"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
              <input
                type="text"
                value={previousOwnersInput}
                onChange={(e) => setPreviousOwnersInput(e.target.value)}
                placeholder="Previous owners (comma-separated)"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />

              <input
                type="text"
                value={connectedPeopleInput}
                onChange={(e) => setConnectedPeopleInput(e.target.value)}
                placeholder="Connected people (comma-separated)"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="Tags (comma-separated)"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />

              <textarea
                rows={2}
                value={historicalNotes}
                onChange={(e) => setHistoricalNotes(e.target.value)}
                placeholder="Historical or restoration notes (optional)"
                className="sm:col-span-2 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
            </div>

            {memories.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs text-ink-muted block">Link Related ECHO Memories</label>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {memories.slice(0, 12).map((m) => {
                    const checked = relatedMemoryIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setRelatedMemoryIds((prev) =>
                            checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                          )
                        }
                        className={`rounded-lg border px-2.5 py-1 text-xs ${
                          checked ? 'border-sky-400 bg-sky-400/20 text-sky-800 dark:text-sky-100' : 'border-hairline-strong bg-inset text-ink-muted'
                        }`}
                      >
                        {m.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <MediaPicker
                contextType="object_photo"
                accept="image/*"
                label={photoMediaId ? 'Photo Attached' : 'Upload Object Photo'}
                onUploaded={(m) => setPhotoMediaId(m.id)}
              />
              <VoiceRecorder
                contextType="object_voice"
                onUploaded={(m) => setVoiceMediaId(m.id)}
                onTranscribed={(tr) => setStory((prev) => (prev ? `${prev}\n\n[Voice Story]: ${tr}` : tr))}
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="rounded border-hairline-strong bg-inset"
              />
              Allow public read-only sharing via link & QR code
            </label>

            {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditorOpen(false)} className="px-4 py-2 text-xs text-ink-secondary">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-rose-400 px-5 py-2 text-xs font-semibold text-slate-950 disabled:opacity-60"
              >
                {saving ? 'Saving...' : editingId ? 'Update Object' : 'Save Object'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function DreamArchiveModule() {
  const { focusItemId, isOnline, queueMutation, quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [dreams, setDreams] = useState<DreamItem[]>([]);
  const [patterns, setPatterns] = useState<{
    totalDreams: number;
    recurringCount: number;
    topTags: Array<{ tag: string; count: number }>;
    topEmotions: Array<{ emotion: string; count: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'timeline' | 'calendar' | 'patterns'>('timeline');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7));

  const [editorOpen, setEditorOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [dreamDate, setDreamDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [emotion, setEmotion] = useState('Wonder');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('Lucid');
  const [vividness, setVividness] = useState(3);
  const [isRecurring, setIsRecurring] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  const [imageMediaId, setImageMediaId] = useState<string | null>(null);
  const [voiceMediaId, setVoiceMediaId] = useState<string | null>(null);
  const [aiReflection, setAiReflection] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [savingDream, setSavingDream] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDreams = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (recurringOnly) params.set('recurring', 'true');
      if (search.trim()) params.set('q', search.trim());

      const [dRes, pRes] = await Promise.all([
        apiRequest<{ dreams: DreamItem[] }>(`/dreams?${params.toString()}`),
        apiRequest<typeof patterns>('/dreams/patterns'),
      ]);
      setDreams(dRes.dreams);
      setPatterns(pRes);
      void saveOfflineCache('dreams', dRes.dreams);
    } catch (err) {
      const cached = await readOfflineCache<DreamItem[]>('dreams');
      if (cached) {
        setDreams(cached);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load dreams.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDreams();
  }, [categoryFilter, recurringOnly]);

  const openNewDreamEditor = () => {
    setTitle('');
    setContent('');
    setDreamDate(new Date().toLocaleDateString('en-CA'));
    setEmotion('Wonder');
    setLocation('');
    setCategory('Lucid');
    setVividness(3);
    setIsRecurring(false);
    setTagsInput('');
    setImageMediaId(null);
    setVoiceMediaId(null);
    setAiReflection('');
    setError(null);
    setEditorOpen(true);
  };

  useEffect(() => {
    if (focusItemId && dreams.some((d) => d.id === focusItemId)) {
      setView('timeline');
    }
  }, [focusItemId, dreams]);

  useEffect(() => {
    if (quickCaptureTarget === 'dream') {
      openNewDreamEditor();
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  const handleGenerateReflection = async (dreamText: string) => {
    if (!dreamText.trim()) return;
    setAiBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ suggestion: string; disclaimer?: string }>('/ai/assist', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'dream_reflection',
          text: dreamText,
          context: `${emotion} · ${category}`,
        }),
      });
      const combined = res.disclaimer ? `${res.suggestion}\n\n(${res.disclaimer})` : res.suggestion;
      setAiReflection(combined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate dream reflection.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleSaveDream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingDream) return;
    setError(null);
    setSavingDream(true);
    const payload = {
      title: title.trim(),
      content: content.trim(),
      dreamDate,
      emotion,
      location: location.trim(),
      category,
      vividness,
      isRecurring,
      tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
      imageMediaId,
      voiceMediaId,
      aiReflection,
    };

    try {
      if (!isOnline) {
        await queueMutation({
          endpoint: '/dreams',
          payload,
          label: `Dream: ${payload.title}`,
        });
        setEditorOpen(false);
        return;
      }

      await apiRequest('/dreams', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setTitle('');
      setContent('');
      setLocation('');
      setTagsInput('');
      setIsRecurring(false);
      setVividness(3);
      setAiReflection('');
      setImageMediaId(null);
      setVoiceMediaId(null);
      setEditorOpen(false);
      await loadDreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save dream.');
    } finally {
      setSavingDream(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await apiRequest(`/dreams/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadDreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete dream.');
    }
  };

  const calendarDays = useMemo(() => {
    const safeMonth = /^\d{4}-\d{2}$/.test(calendarMonth)
      ? calendarMonth
      : new Date().toLocaleDateString('en-CA').slice(0, 7);
    const [yr, mo] = safeMonth.split('-').map(Number);
    const first = new Date(yr, mo - 1, 1).getDay();
    const total = new Date(yr, mo, 0).getDate();
    const cells: Array<{ day: number | null; iso: string | null; items: DreamItem[] }> = [];
    for (let i = 0; i < first; i++) cells.push({ day: null, iso: null, items: [] });
    for (let d = 1; d <= total; d++) {
      const iso = `${safeMonth}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, iso, items: dreams.filter((x) => x.dreamDate === iso) });
    }
    return cells;
  }, [calendarMonth, dreams]);

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div className="relative overflow-hidden rounded-2xl border border-hairline bg-[#0D1424] w-full">
        <SafeImage
          src={dreamNebulaImg}
          alt="Twilight alpine lake with soft violet and coral reflections"
          className="absolute inset-0 w-full h-full object-cover opacity-35"
        />
        <div className="relative z-10 bg-gradient-to-r from-[#070B14]/95 via-[#070B14]/80 to-[#070B14]/55 p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
          <div className="space-y-1.5 max-w-xl min-w-0">
            <p className="text-xs font-medium text-indigo-300">Nightly Journal & Pattern Explorer</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Dream Archive</h1>
            <p className="text-sm text-slate-300">
              Capture morning dreams by text or voice, rate vividness, track recurring motifs, and explore open-ended personal reflections.
            </p>
          </div>
          <button
            type="button"
            onClick={openNewDreamEditor}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-400 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-indigo-300 whitespace-nowrap shrink-0 min-h-[44px] w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" /> Record Dream
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 hover:opacity-80">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0 w-full">
        <div className="w-full lg:w-auto min-w-0 flex items-center gap-1 p-1 rounded-xl bg-surface border border-hairline overflow-x-auto no-scrollbar">
          {[
            { id: 'timeline', label: 'Dream Timeline' },
            { id: 'calendar', label: 'Dream Calendar' },
            { id: 'patterns', label: 'Recurring Patterns' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id as typeof view)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                view === t.id ? 'bg-indigo-400 text-slate-950 font-semibold' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0 w-full lg:w-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadDreams();
            }}
            className="flex items-center gap-1.5 w-full sm:w-auto min-w-0"
          >
            <div className="relative flex-1 sm:w-44 min-w-0">
              <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dreams..."
                className="w-full rounded-xl border border-hairline-strong bg-surface pl-8 pr-3 py-2 text-xs text-ink"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs font-medium text-ink-secondary hover:text-ink shrink-0"
            >
              Search
            </button>
          </form>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink"
          >
            <option value="All">All Categories</option>
            {DREAM_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setRecurringOnly((r) => !r)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium ${
              recurringOnly ? 'border-indigo-400/50 bg-indigo-400/15 text-indigo-800 dark:text-indigo-200' : 'border-hairline-strong bg-surface text-ink-secondary'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" /> Recurring
          </button>
        </div>
      </div>

      {view === 'timeline' && (
        loading ? (
          <div className="h-44 rounded-2xl bg-tint animate-pulse" />
        ) : dreams.length === 0 ? (
          <div className="rounded-2xl border border-hairline bg-surface p-10 text-center space-y-3">
            <Moon className="w-8 h-8 text-indigo-600 dark:text-indigo-300 mx-auto" />
            <h2 className="font-display text-lg font-semibold text-ink">No dreams recorded yet</h2>
            <p className="text-sm text-ink-muted max-w-md mx-auto">
              Log fragments before they fade — add emotions, vividness, voice recordings, and tags.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {dreams.map((d) => (
              <article key={d.id} className="rounded-2xl border border-hairline bg-surface p-6 space-y-3">
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span className="font-mono tabular-nums">
                    {d.dreamDate} · {d.category} · {d.emotion} · Vividness {d.vividness}/5
                  </span>
                  <button type="button" onClick={() => void handleDelete(d.id)} className="text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <h3 className="font-display text-lg font-bold text-ink">
                  {d.title} {d.isRecurring && <span className="text-xs font-normal text-indigo-700 dark:text-indigo-300">· Recurring</span>}
                </h3>
                <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap">{d.content}</p>
                {d.imageMediaId && <AuthMedia mediaId={d.imageMediaId} className="max-h-48" />}
                {d.voiceMediaId && <AuthMedia mediaId={d.voiceMediaId} mimeTypeHint="audio/webm" />}
                {d.aiReflection && (
                  <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-3 text-xs text-indigo-900 dark:text-indigo-100 whitespace-pre-wrap">
                    <span className="font-semibold text-indigo-700 dark:text-indigo-300">Personal Reflection Prompt: </span>
                    {d.aiReflection}
                  </div>
                )}
                {d.tags.length > 0 && (
                  <div className="text-xs text-indigo-700 dark:text-indigo-300/80">#{d.tags.join(' #')}</div>
                )}
              </article>
            ))}
          </div>
        )
      )}

      {view === 'calendar' && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-300" /> Dream Calendar
            </h2>
            <input
              type="month"
              value={calendarMonth}
              onChange={(e) => setCalendarMonth(e.target.value)}
              className="rounded-xl border border-hairline-strong bg-inset px-3 py-1.5 text-xs text-ink font-mono w-full sm:w-auto"
            />
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2 text-xs">
            {calendarDays.map((cell, idx) => (
              <div
                key={cell.iso ?? `empty-${idx}`}
                className={`min-h-[48px] sm:min-h-[64px] rounded-lg sm:rounded-xl border p-1 sm:p-2 ${
                  !cell.day
                    ? 'border-transparent'
                    : cell.items.length > 0
                    ? 'border-indigo-400/40 bg-surface-raised'
                    : 'border-hairline bg-inset'
                }`}
              >
                <div className="font-mono text-ink-muted tabular-nums">{cell.day || ''}</div>
                {cell.items.map((x) => (
                  <div key={x.id} className="text-[11px] text-indigo-700 dark:text-indigo-200 truncate mt-1">{x.title}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'patterns' && patterns && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-hairline bg-surface p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-ink">Recurring Motifs & Tags</h2>
            <div className="text-xs text-ink-muted font-mono tabular-nums">
              {patterns.totalDreams} dreams logged · {patterns.recurringCount} marked recurring
            </div>
            {patterns.topTags.length === 0 ? (
              <p className="text-xs text-ink-muted">Add tags to your dreams to uncover recurring motifs.</p>
            ) : (
              <div className="space-y-2">
                {patterns.topTags.map((t) => (
                  <div key={t.tag} className="flex items-center justify-between text-xs border-b border-hairline pb-2">
                    <span className="text-ink-secondary">#{t.tag}</span>
                    <span className="font-mono text-indigo-700 dark:text-indigo-300 tabular-nums">{t.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-hairline bg-surface p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-ink">Emotional Landscape</h2>
            {patterns.topEmotions.length === 0 ? (
              <p className="text-xs text-ink-muted">Log dream emotions to see patterns across nights.</p>
            ) : (
              <div className="space-y-2">
                {patterns.topEmotions.map((em) => (
                  <div key={em.emotion} className="flex items-center justify-between text-xs border-b border-hairline pb-2">
                    <span className="text-ink-secondary">{em.emotion}</span>
                    <span className="font-mono text-rose-600 dark:text-rose-300 tabular-nums">{em.count}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-ink-muted pt-2">
              Note: Dream reflections and patterns in ECHO are personal journaling aids, never medical diagnoses or predictive claims.
            </p>
          </div>
        </div>
      )}

      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSaveDream} className="w-full max-w-2xl rounded-2xl border border-hairline-strong bg-surface p-4 sm:p-6 space-y-4 my-4 sm:my-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-ink">Record a Dream</h2>
              <button type="button" onClick={() => setEditorOpen(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Dream title"
                className="sm:col-span-2 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
              <textarea
                required
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Describe scenes, symbols, feelings, or fragments..."
                className="sm:col-span-2 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
              <div>
                <label className="text-xs text-ink-muted block mb-1">Date</label>
                <input
                  type="date"
                  value={dreamDate}
                  onChange={(e) => setDreamDate(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-ink-muted block mb-1">Emotion</label>
                <select
                  value={emotion}
                  onChange={(e) => setEmotion(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                >
                  {DREAM_EMOTIONS.map((em) => (
                    <option key={em} value={em}>{em}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-ink-muted block mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                >
                  {DREAM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-ink-muted block mb-1">Vividness ({vividness}/5)</label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={vividness}
                  onChange={(e) => setVividness(Number(e.target.value))}
                  className="w-full accent-indigo-400"
                />
              </div>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Dream setting / place"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="Tags (comma-separated)"
                className="rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <MediaPicker
                contextType="dream_image"
                accept="image/*"
                label={imageMediaId ? 'Image Attached' : 'Attach Sketch / Image'}
                onUploaded={(m) => setImageMediaId(m.id)}
              />
              <VoiceRecorder
                contextType="dream_voice"
                onUploaded={(m) => setVoiceMediaId(m.id)}
                onTranscribed={(tr) => setContent((prev) => (prev ? `${prev}\n\n[Voice Transcript]: ${tr}` : tr))}
              />
              <button
                type="button"
                disabled={aiBusy || !content.trim()}
                onClick={() => void handleGenerateReflection(content)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/35 bg-indigo-400/10 px-3.5 py-2 text-xs font-medium text-indigo-800 dark:text-indigo-200 disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiBusy ? 'Reflecting...' : 'AI Reflection Prompt'}
              </button>
            </div>

            {aiReflection && (
              <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-3 text-xs text-indigo-900 dark:text-indigo-100 whitespace-pre-wrap">
                {aiReflection}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="rounded border-hairline-strong bg-inset"
              />
              Mark as recurring dream
            </label>

            {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditorOpen(false)} className="px-4 py-2 text-xs text-ink-secondary">
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingDream}
                className="rounded-xl bg-indigo-400 px-5 py-2 text-xs font-semibold text-slate-950 disabled:opacity-60"
              >
                {savingDream ? 'Saving...' : 'Save Dream'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
