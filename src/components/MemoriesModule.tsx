import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FolderPlus,
  Heart,
  Link2,
  MapPin,
  Play,
  Plus,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest, readOfflineCache, saveOfflineCache } from '../lib/api';
import type { MediaMeta, MemoryCollection, MemoryItem } from '../types/echo';
import { AuthMedia, MediaPicker, VoiceRecorder } from './MediaElements';

const DEFAULT_CATEGORIES = [
  'Childhood',
  'Family',
  'Friends',
  'Love',
  'Travel',
  'Happiness',
  'Sadness',
  'Achievements',
  'Failures',
  'Life lessons',
  'Dreams',
  'Important moments',
];

const MOODS = ['Joyful', 'Peaceful', 'Reflective', 'Grateful', 'Nostalgic', 'Hopeful', 'Bittersweet', 'Inspired'];

export function MemoriesModule() {
  const { focusItemId, isOnline, queueMutation, quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [collections, setCollections] = useState<MemoryCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'timeline' | 'calendar' | 'collections' | 'map' | 'people'>('timeline');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [activeMemory, setActiveMemory] = useState<MemoryItem | null>(null);
  const [relatedMemories, setRelatedMemories] = useState<MemoryItem[]>([]);
  const [slideshowIndex, setSlideshowIndex] = useState<number | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [memoryDate, setMemoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [locationName, setLocationName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [mood, setMood] = useState('Reflective');
  const [category, setCategory] = useState('Important moments');
  const [customCategory, setCustomCategory] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [peopleInput, setPeopleInput] = useState('');
  const [collectionId, setCollectionId] = useState<string>('');
  const [aiExcluded, setAiExcluded] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [attachedMedia, setAttachedMedia] = useState<MediaMeta[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDesc, setNewCollectionDesc] = useState('');

  const loadMemories = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (favoritesOnly) params.set('favorite', 'true');
      if (selectedCollectionId) params.set('collectionId', selectedCollectionId);
      if (selectedPerson) params.set('person', selectedPerson);

      const [memRes, colRes] = await Promise.all([
        apiRequest<{ memories: MemoryItem[] }>(`/memories?${params.toString()}`),
        apiRequest<{ collections: MemoryCollection[] }>('/collections'),
      ]);
      setMemories(memRes.memories);
      setCollections(colRes.collections);
      void saveOfflineCache('memories', memRes.memories);
    } catch {
      const cached = await readOfflineCache<MemoryItem[]>('memories');
      if (cached) setMemories(cached);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMemories();
  }, [categoryFilter, favoritesOnly, selectedCollectionId, selectedPerson]);

  useEffect(() => {
    if (focusItemId && memories.length > 0) {
      const found = memories.find((m) => m.id === focusItemId);
      if (found) setActiveMemory(found);
    }
  }, [focusItemId, memories]);

  useEffect(() => {
    if (quickCaptureTarget === 'memory' || quickCaptureTarget === 'voice') {
      openNewEditor();
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  useEffect(() => {
    if (!activeMemory) {
      setRelatedMemories([]);
      return;
    }
    apiRequest<{ related: MemoryItem[] }>(`/memories/${encodeURIComponent(activeMemory.id)}/related`)
      .then((res) => setRelatedMemories(res.related))
      .catch(() => setRelatedMemories([]));
  }, [activeMemory?.id]);

  const openNewEditor = () => {
    setEditingId(null);
    setTitle('');
    setContent('');
    setMemoryDate(new Date().toISOString().slice(0, 10));
    setLocationName('');
    setLatitude('');
    setLongitude('');
    setMood('Reflective');
    setCategory('Important moments');
    setCustomCategory('');
    setTagsInput('');
    setPeopleInput('');
    setCollectionId('');
    setAiExcluded(false);
    setAiSummary('');
    setAttachedMedia([]);
    setError(null);
    setEditorOpen(true);
  };

  const openEditEditor = (m: MemoryItem) => {
    setEditingId(m.id);
    setTitle(m.title);
    setContent(m.content);
    setMemoryDate(m.memoryDate);
    setLocationName(m.locationName);
    setLatitude(m.latitude !== null ? String(m.latitude) : '');
    setLongitude(m.longitude !== null ? String(m.longitude) : '');
    setMood(m.mood);
    if (DEFAULT_CATEGORIES.includes(m.category)) {
      setCategory(m.category);
      setCustomCategory('');
    } else {
      setCategory('Custom');
      setCustomCategory(m.category);
    }
    setTagsInput(m.tags.join(', '));
    setPeopleInput(m.people.join(', '));
    setCollectionId(m.collectionId || '');
    setAiExcluded(m.aiExcluded);
    setAiSummary(m.aiSummary);
    setAttachedMedia(m.media);
    setError(null);
    setEditorOpen(true);
  };

  const handleGenerateAiTitleSummary = async () => {
    if (!content.trim()) return;
    setAiBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ title?: string; summary?: string }>('/ai/assist', {
        method: 'POST',
        body: JSON.stringify({ mode: 'title_and_summary', text: content }),
      });
      if (res.title && !title.trim()) setTitle(res.title);
      if (res.summary) setAiSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI assist unavailable.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const chosenCategory = category === 'Custom' && customCategory.trim() ? customCategory.trim() : category;
    const payload = {
      title: title.trim() || 'Untitled Memory',
      content: content.trim(),
      memoryDate,
      locationName: locationName.trim(),
      latitude: latitude.trim() ? Number(latitude) : null,
      longitude: longitude.trim() ? Number(longitude) : null,
      mood,
      category: chosenCategory,
      aiExcluded,
      aiSummary,
      collectionId: collectionId || null,
      tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
      people: peopleInput.split(',').map((p) => p.trim()).filter(Boolean),
      mediaIds: attachedMedia.map((m) => m.id),
    };

    try {
      if (!isOnline && !editingId) {
        await queueMutation({
          endpoint: '/memories',
          payload,
          label: `Memory: ${payload.title}`,
        });
        setEditorOpen(false);
        return;
      }

      if (editingId) {
        const res = await apiRequest<{ memory: MemoryItem }>(`/memories/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setActiveMemory(res.memory);
      } else {
        await apiRequest<{ memory: MemoryItem }>('/memories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditorOpen(false);
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    await apiRequest(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (activeMemory?.id === id) setActiveMemory(null);
    await loadMemories();
  };

  const handleToggleFavorite = async (m: MemoryItem) => {
    const res = await apiRequest<{ isFavorite: boolean }>(`/memories/${encodeURIComponent(m.id)}/favorite`, {
      method: 'POST',
    });
    setMemories((prev) => prev.map((x) => (x.id === m.id ? { ...x, isFavorite: res.isFavorite } : x)));
    if (activeMemory?.id === m.id) {
      setActiveMemory({ ...activeMemory, isFavorite: res.isFavorite });
    }
  };

  const handleRandomMemory = async () => {
    const res = await apiRequest<{ memory: MemoryItem | null }>('/memories/random');
    if (res.memory) setActiveMemory(res.memory);
  };

  const handleExportMemories = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), memories }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    await apiRequest('/collections', {
      method: 'POST',
      body: JSON.stringify({ name: newCollectionName.trim(), description: newCollectionDesc.trim() }),
    });
    setNewCollectionName('');
    setNewCollectionDesc('');
    await loadMemories();
  };

  const peopleDirectory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories) {
      for (const p of m.people) {
        counts.set(p, (counts.get(p) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [memories]);

  const calendarDays = useMemo(() => {
    const [yr, mo] = calendarMonth.split('-').map(Number);
    const firstDay = new Date(yr, mo - 1, 1).getDay();
    const totalDays = new Date(yr, mo, 0).getDate();
    const cells: Array<{ day: number | null; iso: string | null; items: MemoryItem[] }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, iso: null, items: [] });
    for (let d = 1; d <= totalDays; d++) {
      const iso = `${calendarMonth}-${String(d).padStart(2, '0')}`;
      cells.push({
        day: d,
        iso,
        items: memories.filter((m) => m.memoryDate === iso),
      });
    }
    return cells;
  }, [calendarMonth, memories]);

  const mappedMemories = useMemo(
    () => memories.filter((m) => m.locationName || (m.latitude !== null && m.longitude !== null)),
    [memories]
  );

  return (
    <div className="space-y-5 min-w-0 w-full">
      {/* Header & Primary Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">ECHO Memory</h1>
          <p className="text-sm text-ink-muted">
            Your private life archive across time, places, people, and voice.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRandomMemory}
            disabled={memories.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink-secondary hover:bg-tint-hover disabled:opacity-40 whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Shuffle className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
            Random
          </button>
          <button
            type="button"
            onClick={() => memories.length > 0 && setSlideshowIndex(0)}
            disabled={memories.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink-secondary hover:bg-tint-hover disabled:opacity-40 whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Play className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
            Slideshow
          </button>
          <button
            type="button"
            onClick={handleExportMemories}
            disabled={memories.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink-secondary hover:bg-tint-hover disabled:opacity-40 whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Download className="w-3.5 h-3.5 text-ink-secondary" />
            Export
          </button>
          <button
            type="button"
            onClick={openNewEditor}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Plus className="w-4 h-4" />
            New Memory
          </button>
        </div>
      </div>

      {/* View Switcher & Search Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
        <div className="w-full lg:w-auto min-w-0 flex items-center gap-1 p-1 rounded-xl bg-surface border border-hairline overflow-x-auto no-scrollbar">
          {[
            { id: 'timeline', label: 'Timeline' },
            { id: 'calendar', label: 'Calendar' },
            { id: 'collections', label: 'Collections' },
            { id: 'map', label: 'Memory Map' },
            { id: 'people', label: 'People' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id as typeof view)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                view === tab.id ? 'bg-sky-400 text-slate-950 font-semibold' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0 w-full lg:w-auto">
          <div className="relative w-full sm:w-52">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void loadMemories()}
              placeholder="Search memories, tags..."
              className="w-full rounded-xl border border-hairline-strong bg-surface pl-8 pr-3 py-2 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="flex-1 sm:flex-none rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink-secondary focus:outline-none min-w-0"
          >
            <option value="All">All Categories</option>
            {DEFAULT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setFavoritesOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              favoritesOnly
                ? 'border-rose-400/50 bg-rose-400/15 text-rose-700 dark:text-rose-200'
                : 'border-hairline-strong bg-surface text-ink-secondary hover:text-ink'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-current' : ''}`} />
            Favorites
          </button>
          <button
            type="button"
            onClick={() => void loadMemories()}
            className="rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-tint-hover"
          >
            Apply
          </button>
        </div>
      </div>

      {(selectedCollectionId || selectedPerson) && (
        <div className="flex items-center gap-3 text-xs text-sky-700 dark:text-sky-300">
          <span>
            Filtered by {selectedPerson ? `Person: ${selectedPerson}` : 'Collection'}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectedCollectionId(null);
              setSelectedPerson(null);
            }}
            className="underline hover:text-ink"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* VIEW: TIMELINE */}
      {view === 'timeline' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`${activeMemory ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-4 min-w-0`}>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 rounded-2xl bg-tint animate-pulse" />
                ))}
              </div>
            ) : memories.length === 0 ? (
              <div className="rounded-2xl border border-hairline bg-surface p-10 text-center space-y-3">
                <p className="font-display text-lg font-semibold text-ink">No memories match this view yet</p>
                <p className="text-sm text-ink-muted max-w-md mx-auto">
                  Record a story, attach photos or voice notes, and organize them by people, places, and mood.
                </p>
                <button
                  type="button"
                  onClick={openNewEditor}
                  className="inline-flex items-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-xs font-semibold text-slate-950"
                >
                  <Plus className="w-4 h-4" /> Capture First Memory
                </button>
              </div>
            ) : (
              <div className={activeMemory ? 'space-y-4' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
                {memories.map((m) => (
                  <article
                    key={m.id}
                    onClick={() => setActiveMemory(m)}
                    className={`touch-manipulation cursor-pointer rounded-2xl border p-5 transition-colors space-y-3 ${
                      activeMemory?.id === m.id
                        ? 'border-sky-400/50 bg-surface-raised'
                        : 'border-hairline bg-surface hover:border-hairline-strong'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs text-ink-muted font-mono tabular-nums">
                        {m.memoryDate} · {m.category} · {m.mood}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleToggleFavorite(m);
                        }}
                        aria-label="Toggle favorite"
                        className="text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 p-1"
                      >
                        <Heart className={`w-4 h-4 ${m.isFavorite ? 'fill-rose-400 text-rose-400' : ''}`} />
                      </button>
                    </div>
                    <h3 className="font-display text-lg font-semibold text-ink">{m.title}</h3>
                    <p className="text-sm text-ink-secondary line-clamp-3 leading-relaxed">{m.content}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted pt-1">
                      {m.locationName && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-sky-500 dark:text-sky-400" /> {m.locationName}
                        </span>
                      )}
                      {m.people.length > 0 && <span>With: {m.people.join(', ')}</span>}
                      {m.tags.length > 0 && <span className="text-sky-700 dark:text-sky-300/80">#{m.tags.join(' #')}</span>}
                      {m.media.length > 0 && <span>{m.media.length} attachment(s)</span>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {activeMemory && (
            <aside className="lg:col-span-5 rounded-2xl border border-hairline bg-surface p-6 space-y-5 h-fit lg:sticky lg:top-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-sky-700 dark:text-sky-300 font-mono tabular-nums">
                    {activeMemory.memoryDate} · {activeMemory.category} · {activeMemory.mood}
                  </div>
                  <h2 className="font-display text-2xl font-bold text-ink mt-1">{activeMemory.title}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveMemory(null)}
                  className="p-1.5 text-ink-muted hover:text-ink rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {activeMemory.aiSummary && (
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3.5 text-xs text-cyan-900 dark:text-cyan-100 leading-relaxed">
                  <span className="font-semibold text-cyan-700 dark:text-cyan-300">AI Summary: </span>
                  {activeMemory.aiSummary}
                </div>
              )}

              <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap">{activeMemory.content}</p>

              {activeMemory.media.length > 0 && (
                <div className="space-y-3">
                  {activeMemory.media.map((med) => (
                    <div key={med.id} className="space-y-1.5">
                      <AuthMedia mediaId={med.id} mimeTypeHint={med.mime_type || med.mimeType} />
                      {med.transcript && (
                        <p className="text-xs text-ink-muted italic">Transcript: "{med.transcript}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 text-xs text-ink-muted border-t border-hairline pt-4">
                {activeMemory.locationName && <div>Location: {activeMemory.locationName}</div>}
                {activeMemory.people.length > 0 && <div>People: {activeMemory.people.join(', ')}</div>}
                {activeMemory.tags.length > 0 && <div>Tags: {activeMemory.tags.join(', ')}</div>}
                <div>AI Access: {activeMemory.aiExcluded ? 'Excluded from AI' : 'Accessible to ECHO AI'}</div>
              </div>

              {relatedMemories.length > 0 && (
                <div className="border-t border-hairline pt-4 space-y-2">
                  <div className="text-xs font-semibold text-ink-secondary inline-flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" /> Related Memories
                  </div>
                  <div className="space-y-1.5">
                    {relatedMemories.map((rel) => (
                      <button
                        key={rel.id}
                        type="button"
                        onClick={() => setActiveMemory(rel)}
                        className="w-full text-left rounded-lg border border-hairline bg-inset px-3 py-2 text-xs hover:border-sky-400/50"
                      >
                        <div className="font-medium text-ink">{rel.title}</div>
                        <div className="text-ink-muted font-mono tabular-nums">{rel.memoryDate} · {rel.category}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => openEditEditor(activeMemory)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-strong bg-tint px-3 py-2 text-xs font-medium text-ink hover:bg-tint-hover"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteMemory(activeMemory.id)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-200 hover:bg-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* VIEW: CALENDAR */}
      {view === 'calendar' && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-sky-500 dark:text-sky-400" /> Memory Calendar
            </h2>
            <input
              type="month"
              value={calendarMonth}
              onChange={(e) => setCalendarMonth(e.target.value)}
              className="rounded-xl border border-hairline-strong bg-inset px-3 py-1.5 text-xs text-ink font-mono w-full sm:w-auto"
            />
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-xs text-ink-muted">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={`weekday-${i}`} className="py-1">{d}</div>
            ))}
            {calendarDays.map((cell, idx) => (
              <button
                key={cell.iso ?? `empty-${idx}`}
                type="button"
                disabled={!cell.day}
                onClick={() => cell.iso && setSelectedDay(cell.iso)}
                className={`min-h-[48px] sm:min-h-[68px] rounded-lg sm:rounded-xl border p-1 sm:p-2 text-left flex flex-col justify-between transition-colors ${
                  !cell.day
                    ? 'border-transparent bg-transparent cursor-default'
                    : selectedDay === cell.iso
                    ? 'border-sky-400 bg-sky-500/15'
                    : cell.items.length > 0
                    ? 'border-sky-500/35 bg-surface-raised hover:border-sky-400'
                    : 'border-hairline bg-inset hover:border-hairline-strong'
                }`}
              >
                <span className="font-mono text-[11px] sm:text-xs text-ink-secondary tabular-nums">{cell.day || ''}</span>
                {cell.items.length > 0 && (
                  <span className="text-[10px] sm:text-[11px] font-medium text-sky-700 dark:text-sky-300 truncate">
                    {cell.items.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {selectedDay && (
            <div className="pt-4 border-t border-hairline space-y-2">
              <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 font-mono">Memories on {selectedDay}</div>
              {memories.filter((m) => m.memoryDate === selectedDay).length === 0 ? (
                <p className="text-xs text-ink-muted">No memories saved on this date.</p>
              ) : (
                memories
                  .filter((m) => m.memoryDate === selectedDay)
                  .map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        setActiveMemory(m);
                        setView('timeline');
                      }}
                      className="touch-manipulation cursor-pointer rounded-xl border border-hairline bg-inset p-3 hover:border-sky-400/50"
                    >
                      <div className="text-sm font-semibold text-ink">{m.title}</div>
                      <div className="text-xs text-ink-muted line-clamp-2 mt-0.5">{m.content}</div>
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW: COLLECTIONS */}
      {view === 'collections' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={handleCreateCollection} className="rounded-2xl border border-hairline bg-surface p-6 space-y-4 h-fit">
            <h2 className="font-display text-base font-semibold text-ink inline-flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-sky-500 dark:text-sky-400" /> New Collection
            </h2>
            <input
              type="text"
              required
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="Collection title"
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted"
            />
            <textarea
              rows={2}
              value={newCollectionDesc}
              onChange={(e) => setNewCollectionDesc(e.target.value)}
              placeholder="Short description..."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-sky-400 px-4 py-2.5 text-xs font-semibold text-slate-950"
            >
              Create Collection
            </button>
          </form>

          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {collections.length === 0 ? (
              <div className="sm:col-span-2 rounded-2xl border border-hairline bg-surface p-8 text-center text-sm text-ink-muted">
                Create collections to group related life chapters together.
              </div>
            ) : (
              collections.map((c) => (
                <div
                  key={c.id}
                  className="rounded-2xl border border-hairline bg-surface p-5 flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="font-display text-base font-semibold text-ink">{c.name}</div>
                    <p className="text-xs text-ink-muted mt-1">{c.description || 'Personal memory collection'}</p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-hairline">
                    <span className="text-xs font-mono text-sky-700 dark:text-sky-300 tabular-nums">{c.memory_count} memories</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCollectionId(c.id);
                        setView('timeline');
                      }}
                      className="text-xs font-medium text-ink hover:text-sky-600 dark:hover:text-sky-300"
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* VIEW: MEMORY MAP */}
      {view === 'map' && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 space-y-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">Memory Map</h2>
              <p className="text-xs text-ink-muted">Places attached to your memories across the globe.</p>
            </div>
            <span className="text-xs font-mono text-sky-700 dark:text-sky-300 tabular-nums">{mappedMemories.length} located</span>
          </div>

          <div className="relative rounded-xl border border-hairline bg-[#070B14] overflow-hidden p-2 sm:p-4">
            <svg viewBox="0 0 800 360" className="w-full h-44 sm:h-80 block">
              <defs>
                <radialGradient id="mapGlow" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#1E3A5F" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#070B14" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width="800" height="360" fill="url(#mapGlow)" />
              {/* Subtle latitude / longitude grid */}
              {[-60, -30, 0, 30, 60].map((lat) => {
                const y = ((90 - lat) / 180) * 360;
                return <line key={lat} x1="0" y1={y} x2="800" y2={y} stroke="rgba(148,163,184,0.12)" strokeDasharray="4 4" />;
              })}
              {[-120, -60, 0, 60, 120].map((lng) => {
                const x = ((lng + 180) / 360) * 800;
                return <line key={lng} x1={x} y1="0" x2={x} y2="360" stroke="rgba(148,163,184,0.12)" strokeDasharray="4 4" />;
              })}
              {mappedMemories.map((m, idx) => {
                const lat = m.latitude ?? ((idx * 37) % 100) - 45;
                const lng = m.longitude ?? ((idx * 73) % 280) - 140;
                const x = ((lng + 180) / 360) * 800;
                const y = ((90 - lat) / 180) * 360;
                return (
                  <g
                    key={m.id}
                    className="touch-manipulation cursor-pointer"
                    onClick={() => {
                      setActiveMemory(m);
                      setView('timeline');
                    }}
                  >
                    <circle cx={x} cy={y} r="9" fill="rgba(56,189,248,0.22)" />
                    <circle cx={x} cy={y} r="4.5" fill="#38BDF8" />
                    <text x={x + 9} y={y + 4} fill="#E2E8F0" fontSize="10" fontFamily="DM Sans, sans-serif">
                      {m.locationName || m.title}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* VIEW: PEOPLE CONNECTED TO MEMORIES */}
      {view === 'people' && (
        <div className="rounded-2xl border border-hairline bg-surface p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-500 dark:text-sky-400" /> People Connected to Memories
          </h2>
          {peopleDirectory.length === 0 ? (
            <p className="text-sm text-ink-muted">Tag people in your memories to see your life connections here.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {peopleDirectory.map(([person, count]) => (
                <button
                  key={person}
                  type="button"
                  onClick={() => {
                    setSelectedPerson(person);
                    setView('timeline');
                  }}
                  className="rounded-xl border border-hairline bg-inset p-4 text-left hover:border-sky-400/50 flex items-center justify-between"
                >
                  <span className="text-sm font-medium text-ink">{person}</span>
                  <span className="text-xs font-mono text-sky-700 dark:text-sky-300 tabular-nums">{count} memories</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FULLSCREEN SLIDESHOW MODAL (dark cinema mode across themes) */}
      {slideshowIndex !== null && memories[slideshowIndex] && (
        <div className="fixed inset-0 z-50 bg-[#050811]/95 backdrop-blur-lg flex flex-col justify-between p-6 sm:p-10">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {slideshowIndex + 1} / {memories.length} · {memories[slideshowIndex].memoryDate}
            </span>
            <button
              type="button"
              onClick={() => setSlideshowIndex(null)}
              className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Close Slideshow
            </button>
          </div>
          <div className="max-w-3xl mx-auto w-full space-y-5 text-center my-auto">
            <div className="text-xs text-sky-300">
              {memories[slideshowIndex].category} · {memories[slideshowIndex].mood}
              {memories[slideshowIndex].locationName ? ` · ${memories[slideshowIndex].locationName}` : ''}
            </div>
            <h2 className="font-display text-3xl sm:text-5xl font-bold text-white [text-wrap:balance]">
              {memories[slideshowIndex].title}
            </h2>
            <p className="text-base sm:text-lg text-slate-300 leading-relaxed whitespace-pre-wrap">
              {memories[slideshowIndex].content}
            </p>
            {memories[slideshowIndex].media[0] && (
              <div className="max-w-md mx-auto">
                <AuthMedia
                  mediaId={memories[slideshowIndex].media[0].id}
                  mimeTypeHint={memories[slideshowIndex].media[0].mime_type}
                  className="max-h-64"
                />
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setSlideshowIndex((i) => (i !== null ? (i - 1 + memories.length) % memories.length : 0))}
              className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white hover:bg-white/10 inline-flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <button
              type="button"
              onClick={() => setSlideshowIndex((i) => (i !== null ? (i + 1) % memories.length : 0))}
              className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 inline-flex items-center gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MEMORY MODAL */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveMemory}
            className="w-full max-w-2xl rounded-2xl border border-hairline-strong bg-surface p-4 sm:p-6 space-y-4 my-4 sm:my-8"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-ink">
                {editingId ? 'Edit Memory' : 'Capture New Memory'}
              </h2>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="p-1.5 text-ink-muted hover:text-ink"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Memory title"
                  className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
                />
                <button
                  type="button"
                  onClick={handleGenerateAiTitleSummary}
                  disabled={aiBusy || !content.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3 py-2.5 text-xs font-medium text-cyan-800 dark:text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {aiBusy ? 'Thinking...' : 'AI Title & Summary'}
                </button>
              </div>

              <div className="sm:col-span-2">
                <textarea
                  required
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe this moment in your own words..."
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
                />
              </div>

              {aiSummary && (
                <div className="sm:col-span-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3.5 py-2.5 text-xs text-cyan-900 dark:text-cyan-100">
                  AI Summary: {aiSummary}
                </div>
              )}

              <div>
                <label className="text-xs text-ink-muted block mb-1">Date</label>
                <input
                  type="date"
                  value={memoryDate}
                  onChange={(e) => setMemoryDate(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-ink-muted block mb-1">Mood</label>
                <select
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                >
                  {MOODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
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
                  {DEFAULT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value="Custom">Custom category...</option>
                </select>
              </div>

              {category === 'Custom' ? (
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Custom Category</label>
                  <input
                    type="text"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="Enter custom category name"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Collection (optional)</label>
                  <select
                    value={collectionId}
                    onChange={(e) => setCollectionId(e.target.value)}
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                  >
                    <option value="">None</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-ink-muted block mb-1">Location</label>
                <input
                  type="text"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="City or place"
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Lat (optional)</label>
                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="Latitude"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Lng (optional)</label>
                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="Longitude"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-ink-muted block mb-1">People (comma-separated)</label>
                <input
                  type="text"
                  value={peopleInput}
                  onChange={(e) => setPeopleInput(e.target.value)}
                  placeholder="Names separated by commas"
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                />
              </div>

              <div>
                <label className="text-xs text-ink-muted block mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="Tags separated by commas"
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                />
              </div>
            </div>

            {/* Media & Voice Recording */}
            <div className="border-t border-hairline pt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <MediaPicker
                  contextType="memory"
                  onUploaded={(m) => setAttachedMedia((prev) => [...prev, m])}
                />
                <VoiceRecorder
                  contextType="memory"
                  onUploaded={(m) => setAttachedMedia((prev) => [...prev, m])}
                  onTranscribed={(tr) => setContent((prev) => (prev ? `${prev}\n\n[Voice Transcript]: ${tr}` : tr))}
                />
              </div>
              {attachedMedia.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs text-ink-secondary">
                  {attachedMedia.map((m) => (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-inset px-2.5 py-1"
                    >
                      {m.originalName || m.original_name || 'Attachment'}
                      <button
                        type="button"
                        onClick={() => setAttachedMedia((prev) => prev.filter((x) => x.id !== m.id))}
                        className="text-ink-muted hover:text-rose-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <label className="flex items-center gap-2.5 text-xs text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={aiExcluded}
                onChange={(e) => setAiExcluded(e.target.checked)}
                className="rounded border-hairline-strong bg-inset"
              />
              Exclude this memory from ECHO AI reading & reflection
            </label>

            {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-xl border border-hairline-strong px-4 py-2.5 text-xs font-medium text-ink-secondary hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-sky-400 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingId ? 'Update Memory' : 'Save Memory'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
