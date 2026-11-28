import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Pause, Play, RotateCcw } from 'lucide-react';
import type { MemoryItem } from '../types/echo';

export interface TemporalDateRange {
  startMs: number;
  endMs: number;
}

interface TemporalMemorySliderProps {
  memories: MemoryItem[];
  filteredCount: number;
  range: TemporalDateRange | null;
  onChange: (nextRange: TemporalDateRange | null) => void;
}

const DAY_MS = 86_400_000;
const BIN_COUNT = 44;

export function getMemoryDayMs(memory: MemoryItem): number | null {
  const dateStr = (memory.memoryDate || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const ms = Date.UTC(year, month, day);
    if (Number.isFinite(ms)) return ms;
  }

  if (memory.createdAt) {
    const parsed = new Date(memory.createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
    }
  }
  return null;
}

function formatUtcFullDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ms));
}

function formatUtcCompactTick(ms: number, spanDays: number): string {
  if (spanDays >= 540) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(ms));
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ms));
}

function snapToDay(ms: number, minMs: number, maxMs: number): number {
  const clamped = Math.max(minMs, Math.min(maxMs, ms));
  const daysFromMin = Math.round((clamped - minMs) / DAY_MS);
  return Math.max(minMs, Math.min(maxMs, minMs + daysFromMin * DAY_MS));
}

type DragTarget = 'start' | 'end' | 'window';

export function TemporalMemorySlider({
  memories,
  filteredCount,
  range,
  onChange,
}: TemporalMemorySliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    target: DragTarget;
    anchorMs: number;
    initialStartMs: number;
    initialEndMs: number;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const { minMs, maxMs, datedTimestamps, bins, maxBinCount, yearTicks } = useMemo(() => {
    const timestamps: number[] = [];
    for (const m of memories) {
      const ms = getMemoryDayMs(m);
      if (ms !== null) timestamps.push(ms);
    }
    timestamps.sort((a, b) => a - b);

    if (timestamps.length === 0) {
      return {
        minMs: 0,
        maxMs: 0,
        datedTimestamps: [] as number[],
        bins: [] as Array<{ count: number; startMs: number; endMs: number }>,
        maxBinCount: 1,
        yearTicks: [] as Array<{ label: string; pct: number }>,
      };
    }

    const min = timestamps[0];
    const max = timestamps[timestamps.length - 1];
    const span = Math.max(DAY_MS, max - min);

    const histogram: Array<{ count: number; startMs: number; endMs: number }> = Array.from(
      { length: BIN_COUNT },
      (_, idx) => ({
        count: 0,
        startMs: min + (idx / BIN_COUNT) * span,
        endMs: min + ((idx + 1) / BIN_COUNT) * span,
      })
    );

    if (max === min) {
      histogram[Math.floor(BIN_COUNT / 2)].count = timestamps.length;
    } else {
      for (const ts of timestamps) {
        const ratio = (ts - min) / (max - min);
        const binIdx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(ratio * BIN_COUNT)));
        histogram[binIdx].count += 1;
      }
    }

    const peak = Math.max(1, ...histogram.map((b) => b.count));

    const minYear = new Date(min).getUTCFullYear();
    const maxYear = new Date(max).getUTCFullYear();
    const ticks: Array<{ label: string; pct: number }> = [];
    if (maxYear > minYear && max > min) {
      const yearStep = maxYear - minYear > 8 ? Math.ceil((maxYear - minYear) / 5) : 1;
      for (let y = minYear + 1; y <= maxYear; y += yearStep) {
        const yMs = Date.UTC(y, 0, 1);
        if (yMs > min && yMs < max) {
          const pct = ((yMs - min) / (max - min)) * 100;
          if (pct >= 8 && pct <= 92) {
            ticks.push({ label: String(y), pct });
          }
        }
      }
    }

    return {
      minMs: min,
      maxMs: max,
      datedTimestamps: timestamps,
      bins: histogram,
      maxBinCount: peak,
      yearTicks: ticks,
    };
  }, [memories]);

  const hasSpan = datedTimestamps.length > 0 && maxMs > minMs;
  const spanDays = hasSpan ? Math.max(1, Math.round((maxMs - minMs) / DAY_MS)) : 0;

  const activeStartMs = range ? Math.max(minMs, Math.min(maxMs, range.startMs)) : minMs;
  const activeEndMs = range
    ? Math.max(activeStartMs, Math.min(maxMs, range.endMs))
    : maxMs;

  const isFilteredByDate =
    hasSpan &&
    range !== null &&
    (activeStartMs > minMs || activeEndMs < maxMs);

  const startPct = hasSpan ? ((activeStartMs - minMs) / (maxMs - minMs)) * 100 : 0;
  const endPct = hasSpan ? ((activeEndMs - minMs) / (maxMs - minMs)) * 100 : 100;

  const clientXToMs = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track || !hasSpan) return minMs;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return minMs;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return snapToDay(minMs + ratio * (maxMs - minMs), minMs, maxMs);
    },
    [hasSpan, minMs, maxMs]
  );

  const emitNormalizedRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      const s = snapToDay(Math.min(nextStart, nextEnd), minMs, maxMs);
      const e = snapToDay(Math.max(nextStart, nextEnd), minMs, maxMs);
      if (s <= minMs && e >= maxMs) {
        onChange(null);
      } else {
        onChange({ startMs: s, endMs: e });
      }
    },
    [minMs, maxMs, onChange]
  );

  useEffect(() => {
    if (!dragState || !hasSpan) return;

    const handlePointerMove = (ev: PointerEvent) => {
      const pointerMs = clientXToMs(ev.clientX);
      if (dragState.target === 'start') {
        const clampedStart = Math.min(pointerMs, dragState.initialEndMs);
        emitNormalizedRange(clampedStart, dragState.initialEndMs);
      } else if (dragState.target === 'end') {
        const clampedEnd = Math.max(pointerMs, dragState.initialStartMs);
        emitNormalizedRange(dragState.initialStartMs, clampedEnd);
      } else {
        const windowWidth = dragState.initialEndMs - dragState.initialStartMs;
        const delta = pointerMs - dragState.anchorMs;
        let nextStart = dragState.initialStartMs + delta;
        let nextEnd = nextStart + windowWidth;
        if (nextStart < minMs) {
          nextStart = minMs;
          nextEnd = minMs + windowWidth;
        }
        if (nextEnd > maxMs) {
          nextEnd = maxMs;
          nextStart = Math.max(minMs, maxMs - windowWidth);
        }
        emitNormalizedRange(nextStart, nextEnd);
      }
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, hasSpan, clientXToMs, emitNormalizedRange, minMs, maxMs]);

  // Stop playback if timeline collapses or loses span
  useEffect(() => {
    if (!hasSpan && isPlaying) {
      setIsPlaying(false);
    }
  }, [hasSpan, isPlaying]);

  // Chronological playback ticker
  const playbackRef = useRef<{
    startMs: number;
    endMs: number;
    mode: 'reveal' | 'slide';
    windowWidth: number;
  }>({
    startMs: minMs,
    endMs: maxMs,
    mode: 'reveal',
    windowWidth: 0,
  });

  useEffect(() => {
    if (!isPlaying || !hasSpan) return;

    const totalSpan = maxMs - minMs;
    const stepMs = Math.max(DAY_MS, Math.round(totalSpan / 110));

    const timer = window.setInterval(() => {
      const cur = playbackRef.current;
      if (cur.mode === 'slide') {
        const nextEnd = Math.min(maxMs, cur.endMs + stepMs);
        const nextStart = Math.max(minMs, nextEnd - cur.windowWidth);
        cur.startMs = nextStart;
        cur.endMs = nextEnd;
        emitNormalizedRange(nextStart, nextEnd);
        if (nextEnd >= maxMs) {
          setIsPlaying(false);
        }
      } else {
        const nextEnd = Math.min(maxMs, cur.endMs + stepMs);
        cur.endMs = nextEnd;
        emitNormalizedRange(cur.startMs, nextEnd);
        if (nextEnd >= maxMs) {
          setIsPlaying(false);
        }
      }
    }, 85);

    return () => window.clearInterval(timer);
  }, [isPlaying, hasSpan, minMs, maxMs, emitNormalizedRange]);

  const togglePlayback = () => {
    if (!hasSpan) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    const currentWidth = activeEndMs - activeStartMs;
    const isFullOrAtEnd = !isFilteredByDate || activeEndMs >= maxMs;
    const isSubWindow = isFilteredByDate && currentWidth > DAY_MS * 2 && currentWidth < (maxMs - minMs) * 0.82;

    if (isSubWindow && activeEndMs < maxMs) {
      playbackRef.current = {
        startMs: activeStartMs,
        endMs: activeEndMs,
        mode: 'slide',
        windowWidth: currentWidth,
      };
      setIsPlaying(true);
      return;
    }

    if (isSubWindow && activeEndMs >= maxMs) {
      const resetStart = minMs;
      const resetEnd = Math.min(maxMs, minMs + currentWidth);
      playbackRef.current = {
        startMs: resetStart,
        endMs: resetEnd,
        mode: 'slide',
        windowWidth: currentWidth,
      };
      emitNormalizedRange(resetStart, resetEnd);
      setIsPlaying(true);
      return;
    }

    const startFrom = isFullOrAtEnd ? minMs : activeStartMs;
    const firstEnd = isFullOrAtEnd ? snapToDay(minMs + Math.max(DAY_MS, (maxMs - minMs) * 0.04), minMs, maxMs) : activeEndMs;
    playbackRef.current = {
      startMs: startFrom,
      endMs: firstEnd,
      mode: 'reveal',
      windowWidth: 0,
    };
    emitNormalizedRange(startFrom, firstEnd);
    setIsPlaying(true);
  };

  const handleTrackPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!hasSpan) return;
    setIsPlaying(false);
    const clickedMs = clientXToMs(ev.clientX);
    const distToStart = Math.abs(clickedMs - activeStartMs);
    const distToEnd = Math.abs(clickedMs - activeEndMs);

    if (clickedMs > activeStartMs && clickedMs < activeEndMs) {
      setDragState({
        target: 'window',
        anchorMs: clickedMs,
        initialStartMs: activeStartMs,
        initialEndMs: activeEndMs,
      });
      return;
    }

    if (distToStart <= distToEnd) {
      const nextStart = Math.min(clickedMs, activeEndMs);
      emitNormalizedRange(nextStart, activeEndMs);
      setDragState({
        target: 'start',
        anchorMs: clickedMs,
        initialStartMs: nextStart,
        initialEndMs: activeEndMs,
      });
    } else {
      const nextEnd = Math.max(clickedMs, activeStartMs);
      emitNormalizedRange(activeStartMs, nextEnd);
      setDragState({
        target: 'end',
        anchorMs: clickedMs,
        initialStartMs: activeStartMs,
        initialEndMs: nextEnd,
      });
    }
  };

  const handleThumbKeyDown = (target: 'start' | 'end', ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasSpan) return;
    const stepDays = ev.shiftKey ? 30 : 1;
    let delta = 0;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') delta = -stepDays * DAY_MS;
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') delta = stepDays * DAY_MS;
    else if (ev.key === 'Home') delta = minMs - (target === 'start' ? activeStartMs : activeEndMs);
    else if (ev.key === 'End') delta = maxMs - (target === 'start' ? activeStartMs : activeEndMs);
    else return;

    ev.preventDefault();
    setIsPlaying(false);
    if (target === 'start') {
      const nextStart = Math.max(minMs, Math.min(activeEndMs, activeStartMs + delta));
      emitNormalizedRange(nextStart, activeEndMs);
    } else {
      const nextEnd = Math.min(maxMs, Math.max(activeStartMs, activeEndMs + delta));
      emitNormalizedRange(activeStartMs, nextEnd);
    }
  };

  const applyRecentDaysPreset = (days: number) => {
    if (!hasSpan) return;
    setIsPlaying(false);
    const nextStart = Math.max(minMs, maxMs - days * DAY_MS);
    emitNormalizedRange(nextStart, maxMs);
  };

  if (datedTimestamps.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Chronological life journey scrubber"
      className="pt-4 border-t border-hairline space-y-2.5"
    >
      {/* Header Row: Temporal Readout + Scrubbing Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink whitespace-nowrap">
            <Calendar className="w-3.5 h-3.5 text-accent-text shrink-0" />
            Chronological Timeline
          </span>
          <span aria-hidden="true" className="text-ink-muted text-xs">
            ·
          </span>
          <span className="text-xs font-mono text-ink-secondary tabular-nums">
            {hasSpan && activeStartMs !== activeEndMs
              ? `${formatUtcFullDate(activeStartMs)} — ${formatUtcFullDate(activeEndMs)}`
              : formatUtcFullDate(activeStartMs)}
          </span>
          <span aria-hidden="true" className="text-ink-muted text-xs">
            ·
          </span>
          <span className="text-xs font-mono text-ink-muted tabular-nums">
            {filteredCount} of {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </span>
        </div>

        {hasSpan && (
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={togglePlayback}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                isPlaying
                  ? 'border-accent-border bg-accent text-accent-ink hover:bg-accent-strong'
                  : 'border-hairline-strong bg-inset text-ink hover:bg-tint-hover'
              }`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause' : 'Play Journey'}
            </button>

            {spanDays > 365 && (
              <button
                type="button"
                onClick={() => applyRecentDaysPreset(365)}
                className="rounded-lg border border-hairline bg-inset px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink hover:bg-tint-hover transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
              >
                Last Year
              </button>
            )}

            {spanDays > 90 && (
              <button
                type="button"
                onClick={() => applyRecentDaysPreset(90)}
                className="rounded-lg border border-hairline bg-inset px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink hover:bg-tint-hover transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
              >
                90 Days
              </button>
            )}

            {isFilteredByDate && (
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  onChange(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-inset px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:text-ink hover:bg-tint-hover transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
              >
                <RotateCcw className="w-3 h-3" />
                All Time
              </button>
            )}
          </div>
        )}
      </div>

      {/* Interactive Density Histogram + Dual-Handle Scrubber Track */}
      {hasSpan ? (
        <div className="space-y-1.5 select-none">
          <div
            ref={trackRef}
            onPointerDown={handleTrackPointerDown}
            className="relative pt-1 pb-2 cursor-pointer touch-none"
          >
            {/* Chronological Density Bars */}
            <div
              className="flex items-end gap-[2px] h-8 mb-1.5 px-[1px]"
              aria-hidden="true"
            >
              {bins.map((bin, idx) => {
                const inWindow =
                  bin.endMs >= activeStartMs && bin.startMs <= activeEndMs;
                const heightPct =
                  bin.count === 0 ? 10 : Math.max(22, Math.round((bin.count / maxBinCount) * 100));
                return (
                  <div
                    key={idx}
                    className={`flex-1 rounded-t-xs transition-opacity duration-150 ${
                      bin.count === 0
                        ? 'bg-hairline'
                        : inWindow
                          ? 'bg-accent opacity-80'
                          : 'bg-ink-muted opacity-25'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                );
              })}
            </div>

            {/* Rail + Active Window + Handles */}
            <div className="relative h-6 flex items-center">
              {/* Base Track Rail */}
              <div className="w-full h-1.5 rounded-full bg-inset border border-hairline" />

              {/* Selected Time Window Highlight */}
              <div
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  setIsPlaying(false);
                  const anchor = clientXToMs(ev.clientX);
                  setDragState({
                    target: 'window',
                    anchorMs: anchor,
                    initialStartMs: activeStartMs,
                    initialEndMs: activeEndMs,
                  });
                }}
                title="Drag to shift your selected time window chronologically"
                className="absolute h-2 rounded-full bg-accent cursor-grab active:cursor-grabbing transition-opacity"
                style={{
                  left: `${startPct}%`,
                  width: `${Math.max(0.8, endPct - startPct)}%`,
                }}
              />

              {/* Start Handle */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Timeline start date"
                aria-valuemin={minMs}
                aria-valuemax={activeEndMs}
                aria-valuenow={activeStartMs}
                aria-valuetext={formatUtcFullDate(activeStartMs)}
                onKeyDown={(e) => handleThumbKeyDown('start', e)}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  setIsPlaying(false);
                  setDragState({
                    target: 'start',
                    anchorMs: activeStartMs,
                    initialStartMs: activeStartMs,
                    initialEndMs: activeEndMs,
                  });
                }}
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center cursor-ew-resize focus:outline-none group ${
                  startPct > 85 && endPct - startPct < 3 ? 'z-30' : 'z-10'
                }`}
                style={{ left: `${startPct}%` }}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-surface border-2 border-accent shadow-sm transition-transform duration-150 group-hover:scale-115 group-focus-visible:ring-2 group-focus-visible:ring-accent ${
                    dragState?.target === 'start' ? 'scale-120' : ''
                  }`}
                />
              </div>

              {/* End Handle */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Timeline end date"
                aria-valuemin={activeStartMs}
                aria-valuemax={maxMs}
                aria-valuenow={activeEndMs}
                aria-valuetext={formatUtcFullDate(activeEndMs)}
                onKeyDown={(e) => handleThumbKeyDown('end', e)}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  setIsPlaying(false);
                  setDragState({
                    target: 'end',
                    anchorMs: activeEndMs,
                    initialStartMs: activeStartMs,
                    initialEndMs: activeEndMs,
                  });
                }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center cursor-ew-resize focus:outline-none group z-20"
                style={{ left: `${endPct}%` }}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-accent border-2 border-surface shadow-sm transition-transform duration-150 group-hover:scale-115 group-focus-visible:ring-2 group-focus-visible:ring-accent ${
                    dragState?.target === 'end' ? 'scale-120' : ''
                  }`}
                />
              </div>
            </div>

            {/* Chronological Axis Labels */}
            <div className="relative h-4 mt-0.5 text-[11px] font-mono text-ink-muted tabular-nums">
              <span className="absolute left-0">{formatUtcCompactTick(minMs, spanDays)}</span>
              {yearTicks.map((t) => (
                <span
                  key={t.label}
                  className="hidden sm:inline absolute -translate-x-1/2"
                  style={{ left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ))}
              <span className="absolute right-0">{formatUtcCompactTick(maxMs, spanDays)}</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">
          All currently charted memories share {formatUtcFullDate(minMs)}. Add entries across more dates to scrub chronologically.
        </p>
      )}
    </section>
  );
}
