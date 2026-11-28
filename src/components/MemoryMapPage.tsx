import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Calendar, Globe, MapPin, Plus, Users } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest, readOfflineCache, saveOfflineCache } from '../lib/api';
import type { MemoryItem } from '../types/echo';
import { MemoriesMapView } from './MemoriesMapView';

export function MemoryMapPage() {
  const { isOnline, navigateTo, setQuickCaptureTarget, lastWsEvent } = useEcho();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAllMemories = useCallback(async () => {
    try {
      setError(null);
      const res = await apiRequest<{ memories: MemoryItem[] }>('/memories');
      setMemories(res.memories);
      await saveOfflineCache('memories', res.memories);
    } catch (err) {
      const cached = await readOfflineCache<MemoryItem[]>('memories');
      if (cached && cached.length > 0) {
        setMemories(cached);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load your memories.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllMemories();
  }, [loadAllMemories, isOnline]);

  useEffect(() => {
    if (lastWsEvent?.type === 'memory_updated' || lastWsEvent?.type === 'memory_created') {
      void loadAllMemories();
    }
  }, [lastWsEvent, loadAllMemories]);

  const stats = useMemo(() => {
    const places = new Set<string>();
    const years = new Set<string>();
    const people = new Set<string>();
    let locatedCount = 0;

    for (const m of memories) {
      if (m.locationName && m.locationName.trim()) {
        places.add(m.locationName.trim().toLowerCase());
      }
      if (typeof m.latitude === 'number' && typeof m.longitude === 'number') {
        locatedCount += 1;
      }
      if (m.memoryDate && m.memoryDate.length >= 4) {
        years.add(m.memoryDate.slice(0, 4));
      }
      for (const p of m.people || []) {
        if (p.trim()) people.add(p.trim().toLowerCase());
      }
    }

    return {
      total: memories.length,
      places: places.size,
      locatedCount,
      years: years.size,
      people: people.size,
    };
  }, [memories]);

  const handleCreateMemory = () => {
    setQuickCaptureTarget('memory');
    navigateTo('memories');
  };

  return (
    <div className="space-y-6 min-w-0 w-full">
      {/* Editorial Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink tracking-tight inline-flex items-center gap-2.5">
            <MapPin className="w-6 h-6 text-accent-text shrink-0" />
            Memory Map
          </h1>
          <p className="text-sm text-ink-muted leading-relaxed">
            Explore every memory across your interactive constellation, emotional landscape, chronological years, and world atlas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigateTo('memories')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink-secondary hover:text-ink hover:bg-tint-hover whitespace-nowrap shrink-0"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Timeline View
          </button>
          <button
            type="button"
            onClick={handleCreateMemory}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Capture Memory
          </button>
        </div>
      </div>

      {/* Unboxed Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 space-y-1">
          <div className="text-[11px] font-medium text-ink-muted inline-flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            Memories Charted
          </div>
          <div className="font-display text-xl font-bold text-ink tabular-nums">
            {stats.total}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 space-y-1">
          <div className="text-[11px] font-medium text-ink-muted inline-flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
            Places & Coordinates
          </div>
          <div className="font-display text-xl font-bold text-ink tabular-nums">
            {stats.places}{' '}
            <span className="text-xs font-sans font-normal text-ink-muted">
              ({stats.locatedCount} pinned)
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 space-y-1">
          <div className="text-[11px] font-medium text-ink-muted inline-flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            Years Spanned
          </div>
          <div className="font-display text-xl font-bold text-ink tabular-nums">
            {stats.years}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 space-y-1">
          <div className="text-[11px] font-medium text-ink-muted inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" />
            Connected People
          </div>
          <div className="font-display text-xl font-bold text-ink tabular-nums">
            {stats.people}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadAllMemories()}
            className="rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-medium hover:bg-rose-500/15 whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-hairline bg-surface p-6 space-y-4">
          <div className="h-7 w-52 rounded-lg bg-tint animate-pulse" />
          <div className="h-[460px] rounded-xl bg-tint animate-pulse" />
        </div>
      ) : (
        <MemoriesMapView
          memories={memories}
          allMemories={memories}
          showInlineFilters
          onOpenMemory={(m) => navigateTo('memories', m.id)}
          onCreateMemory={handleCreateMemory}
          onMemoryUpdated={(updated) => {
            setMemories((prev) => {
              const next = prev.map((x) => (x.id === updated.id ? updated : x));
              void saveOfflineCache('memories', next);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
