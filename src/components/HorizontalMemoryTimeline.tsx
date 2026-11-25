import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock, RotateCcw } from 'lucide-react';
import type { MemoryItem } from '../types/echo';
import { getCategoryStyle } from '../lib/memoryCategories';

interface HorizontalMemoryTimelineProps {
  memories: MemoryItem[];
  selectedYear: string | null;
  selectedDate: string | null;
  activeMemoryId: string | null;
  onSelectYear: (year: string | null) => void;
  onJumpToDate: (dateIso: string, targetMemory?: MemoryItem) => void;
  onClearJump: () => void;
}

interface DateCluster {
  date: string;
  ts: number;
  year: string;
  month: string;
  memories: MemoryItem[];
  positionPct: number;
  primaryColor: string;
}

interface YearTick {
  year: string;
  ts: number;
  count: number;
  positionPct: number;
  latestDate: string;
}

interface MonthDensityBar {
  month: string;
  label: string;
  count: number;
  positionPct: number;
  widthPct: number;
  latestMemory: MemoryItem;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseUtcDate(iso: string): number | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const ts = Date.UTC(y, m - 1, d);
  return Number.isFinite(ts) ? ts : null;
}

function formatReadableDate(iso: string): string {
  const ts = parseUtcDate(iso);
  if (ts === null) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ts));
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function HorizontalMemoryTimeline({
  memories,
  selectedYear,
  selectedDate,
  activeMemoryId,
  onSelectYear,
  onJumpToDate,
  onClearJump,
}: HorizontalMemoryTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredClusterDate, setHoveredClusterDate] = useState<string | null>(null);
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState<string>(selectedDate || '');
  const [jumpFeedback, setJumpFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDate) {
      setDateInput(selectedDate);
    } else if (!selectedYear) {
      setDateInput('');
      setJumpFeedback(null);
    }
  }, [selectedDate, selectedYear]);

  const timelineData = useMemo(() => {
    const validItems: Array<{ memory: MemoryItem; ts: number }> = [];
    for (const m of memories) {
      const ts = parseUtcDate(m.memoryDate);
      if (ts !== null) {
        validItems.push({ memory: m, ts });
      }
    }

    if (validItems.length === 0) {
      return {
        clusters: [] as DateCluster[],
        years: [] as YearTick[],
        months: [] as MonthDensityBar[],
        minDate: '',
        maxDate: '',
        trackMinWidthPx: 640,
        totalValid: 0,
        maxMonthCount: 1,
      };
    }

    validItems.sort((a, b) => a.ts - b.ts);

    const minTs = validItems[0].ts;
    const maxTs = validItems[validItems.length - 1].ts;
    const spanMs = Math.max(maxTs - minTs, 1);
    const singlePoint = minTs === maxTs;

    // Group into chronological date clusters
    const clusterMap = new Map<string, { ts: number; memories: MemoryItem[] }>();
    const yearCounts = new Map<string, { count: number; latestDate: string }>();
    const monthBuckets = new Map<string, MemoryItem[]>();

    for (const { memory, ts } of validItems) {
      const existing = clusterMap.get(memory.memoryDate);
      if (existing) {
        existing.memories.push(memory);
      } else {
        clusterMap.set(memory.memoryDate, { ts, memories: [memory] });
      }

      const year = memory.memoryDate.slice(0, 4);
      const yEntry = yearCounts.get(year);
      if (yEntry) {
        yEntry.count += 1;
        if (memory.memoryDate > yEntry.latestDate) yEntry.latestDate = memory.memoryDate;
      } else {
        yearCounts.set(year, { count: 1, latestDate: memory.memoryDate });
      }

      const ym = memory.memoryDate.slice(0, 7);
      const mList = monthBuckets.get(ym);
      if (mList) {
        mList.push(memory);
      } else {
        monthBuckets.set(ym, [memory]);
      }
    }

    const toPct = (ts: number) => {
      if (singlePoint) return 50;
      const raw = ((ts - minTs) / spanMs) * 100;
      // Keep 3% padding on left and right edges so edge markers are never clipped
      return 3 + raw * 0.94;
    };

    const clusters: DateCluster[] = Array.from(clusterMap.entries())
      .map(([date, info]) => {
        const lead = info.memories[0];
        return {
          date,
          ts: info.ts,
          year: date.slice(0, 4),
          month: date.slice(0, 7),
          memories: info.memories,
          positionPct: toPct(info.ts),
          primaryColor: getCategoryStyle(lead.category).dotHex,
        };
      })
      .sort((a, b) => a.ts - b.ts);

    const years: YearTick[] = Array.from(yearCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, info]) => {
        const jan1 = Date.UTC(Number(year), 0, 1);
        const clampedTs = Math.max(minTs, Math.min(maxTs, jan1));
        return {
          year,
          ts: clampedTs,
          count: info.count,
          positionPct: singlePoint ? 50 : toPct(clampedTs),
          latestDate: info.latestDate,
        };
      });

    const maxMonthCount = Math.max(
      1,
      ...Array.from(monthBuckets.values()).map((items) => items.length)
    );
    const monthsSpanCount = Math.max(1, Math.round(spanMs / (1000 * 60 * 60 * 24 * 30.44)));
    const barWidthPct = Math.max(1.2, Math.min(6, 72 / Math.max(monthsSpanCount, 12)));

    const months: MonthDensityBar[] = Array.from(monthBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, items]) => {
        const [y, m] = ym.split('-').map(Number);
        const midMonthTs = Math.max(minTs, Math.min(maxTs, Date.UTC(y, m - 1, 15)));
        const sortedItems = [...items].sort((a, b) => b.memoryDate.localeCompare(a.memoryDate));
        return {
          month: ym,
          label: formatMonthLabel(ym),
          count: items.length,
          positionPct: toPct(midMonthTs),
          widthPct: barWidthPct,
          latestMemory: sortedItems[0],
        };
      });

    // Scale inner track width cleanly based on month span & cluster count
    const trackMinWidthPx = Math.min(
      2800,
      Math.max(640, monthsSpanCount * 42, clusters.length * 26)
    );

    return {
      clusters,
      years,
      months,
      minDate: validItems[0].memory.memoryDate,
      maxDate: validItems[validItems.length - 1].memory.memoryDate,
      trackMinWidthPx,
      totalValid: validItems.length,
      maxMonthCount,
    };
  }, [memories]);

  // Smoothly scroll horizontal timeline track so selected year/date/active memory stays in view
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || timelineData.clusters.length === 0) return;

    let targetPct: number | null = null;
    if (selectedDate) {
      const matched = timelineData.clusters.find((c) => c.date === selectedDate);
      if (matched) targetPct = matched.positionPct;
    } else if (activeMemoryId) {
      const matched = timelineData.clusters.find((c) =>
        c.memories.some((m) => m.id === activeMemoryId)
      );
      if (matched) targetPct = matched.positionPct;
    } else if (selectedYear) {
      const yearClusters = timelineData.clusters.filter((c) => c.year === selectedYear);
      if (yearClusters.length > 0) {
        const firstPct = yearClusters[0].positionPct;
        const lastPct = yearClusters[yearClusters.length - 1].positionPct;
        targetPct = (firstPct + lastPct) / 2;
      }
    }

    if (targetPct === null) return;
    const totalScrollWidth = container.scrollWidth;
    const viewWidth = container.clientWidth;
    if (totalScrollWidth <= viewWidth + 4) return;

    const targetCenterPx = (targetPct / 100) * totalScrollWidth;
    const desiredLeft = Math.max(0, targetCenterPx - viewWidth / 2);
    container.scrollTo({ left: desiredLeft, behavior: 'smooth' });
  }, [selectedYear, selectedDate, activeMemoryId, timelineData.clusters]);

  const handleDateInputChange = (val: string) => {
    setDateInput(val);
    if (!val || timelineData.clusters.length === 0) {
      setJumpFeedback(null);
      return;
    }
    const targetTs = parseUtcDate(val);
    if (targetTs === null) return;

    const exact = timelineData.clusters.find((c) => c.date === val);
    if (exact) {
      setJumpFeedback(null);
      onJumpToDate(exact.date, exact.memories[0]);
      return;
    }

    // Snap to closest recorded date in the archive
    let nearest = timelineData.clusters[0];
    let bestDiff = Math.abs(nearest.ts - targetTs);
    for (const c of timelineData.clusters) {
      const diff = Math.abs(c.ts - targetTs);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = c;
      }
    }
    setJumpFeedback(`Nearest archive entry: ${nearest.date}`);
    onJumpToDate(nearest.date, nearest.memories[0]);
  };

  const panTrack = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const step = Math.max(220, Math.round(container.clientWidth * 0.6));
    container.scrollBy({
      left: direction === 'left' ? -step : step,
      behavior: 'smooth',
    });
  };

  const previewCluster = useMemo(() => {
    if (hoveredClusterDate) {
      return timelineData.clusters.find((c) => c.date === hoveredClusterDate) || null;
    }
    if (selectedDate) {
      return timelineData.clusters.find((c) => c.date === selectedDate) || null;
    }
    if (activeMemoryId) {
      return (
        timelineData.clusters.find((c) => c.memories.some((m) => m.id === activeMemoryId)) || null
      );
    }
    return null;
  }, [hoveredClusterDate, selectedDate, activeMemoryId, timelineData.clusters]);

  const previewMonth = useMemo(() => {
    if (!hoveredMonth) return null;
    return timelineData.months.find((m) => m.month === hoveredMonth) || null;
  }, [hoveredMonth, timelineData.months]);

  const hasActiveJump = Boolean(selectedYear || selectedDate);

  return (
    <section
      aria-label="Chronological memory timeline navigation"
      className="rounded-2xl border border-hairline bg-surface p-3.5 sm:p-4 space-y-3 min-w-0"
    >
      {/* Top Bar: Archive Span, Year Quick-Jumps & Exact Date Picker */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Clock className="w-3.5 h-3.5 text-accent-text shrink-0" />
            <span>Archive Timeline</span>
          </div>
          {timelineData.totalValid > 0 ? (
            <span className="font-mono text-[11px] text-ink-muted tabular-nums">
              {timelineData.minDate.slice(0, 4)}
              {timelineData.maxDate.slice(0, 4) !== timelineData.minDate.slice(0, 4)
                ? ` – ${timelineData.maxDate.slice(0, 4)}`
                : ''}
              {' · '}
              {timelineData.totalValid} {timelineData.totalValid === 1 ? 'memory' : 'memories'}
            </span>
          ) : (
            <span className="text-[11px] text-ink-muted">No dated memories in current view</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Date Picker Jump */}
          {timelineData.totalValid > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-inset px-2.5 py-1 min-h-[36px]">
              <Calendar className="w-3.5 h-3.5 text-ink-muted shrink-0" />
              <label htmlFor="timeline-date-jump" className="text-[11px] text-ink-muted whitespace-nowrap">
                Jump to:
              </label>
              <input
                id="timeline-date-jump"
                type="date"
                value={dateInput}
                min={timelineData.minDate || undefined}
                max={timelineData.maxDate || undefined}
                onChange={(e) => handleDateInputChange(e.target.value)}
                aria-label="Jump to specific date in archive"
                className="bg-transparent font-mono text-[11px] text-ink focus:outline-none tabular-nums"
              />
            </div>
          )}

          {hasActiveJump && (
            <button
              type="button"
              onClick={() => {
                setDateInput('');
                setJumpFeedback(null);
                onClearJump();
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-hairline-strong bg-inset px-2.5 py-1.5 text-[11px] font-medium text-ink-secondary hover:text-ink hover:bg-tint-hover whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <RotateCcw className="w-3 h-3" />
              All Dates
            </button>
          )}
        </div>
      </div>

      {/* Year Quick-Jump Strip */}
      {timelineData.years.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap shrink-0 mr-0.5">
            Years:
          </span>
          <button
            type="button"
            onClick={() => {
              setJumpFeedback(null);
              onSelectYear(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
              selectedYear === null
                ? 'border-accent-border bg-accent-soft text-accent-text font-semibold'
                : 'border-hairline bg-inset text-ink-secondary hover:text-ink hover:border-hairline-strong'
            }`}
          >
            <span>All</span>
            <span className="font-mono text-[10px] opacity-80 tabular-nums">
              {timelineData.totalValid}
            </span>
          </button>
          {timelineData.years.map((yr) => {
            const isActive = selectedYear === yr.year;
            return (
              <button
                key={yr.year}
                type="button"
                onClick={() => {
                  setJumpFeedback(null);
                  onSelectYear(isActive ? null : yr.year);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                  isActive
                    ? 'border-accent-border bg-accent-soft text-accent-text font-semibold'
                    : 'border-hairline bg-inset text-ink-secondary hover:text-ink hover:border-hairline-strong'
                }`}
              >
                <span>{yr.year}</span>
                <span className="text-[10px] opacity-75">{yr.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Horizontal Scrubbable Visualization Track */}
      {timelineData.totalValid > 0 ? (
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => panTrack('left')}
              aria-label="Scroll timeline earlier"
              className="hidden sm:inline-flex items-center justify-center w-8 h-16 rounded-xl border border-hairline bg-inset text-ink-muted hover:text-ink hover:border-hairline-strong shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div
              ref={scrollContainerRef}
              className="relative flex-1 min-w-0 overflow-x-auto rounded-xl border border-hairline bg-inset px-2 py-2.5"
            >
              <div
                className="relative h-20 select-none"
                style={{ minWidth: `${timelineData.trackMinWidthPx}px`, width: '100%' }}
              >
                {/* Monthly Density Histogram Bars */}
                {timelineData.months.map((mo) => {
                  const heightPct = Math.max(
                    18,
                    Math.round((mo.count / (timelineData.maxMonthCount || 1)) * 52)
                  );
                  const inSelectedYear = !selectedYear || mo.month.startsWith(selectedYear);
                  return (
                    <button
                      key={mo.month}
                      type="button"
                      onClick={() => {
                        setJumpFeedback(null);
                        onJumpToDate(mo.latestMemory.memoryDate, mo.latestMemory);
                      }}
                      onMouseEnter={() => setHoveredMonth(mo.month)}
                      onMouseLeave={() => setHoveredMonth(null)}
                      onFocus={() => setHoveredMonth(mo.month)}
                      onBlur={() => setHoveredMonth(null)}
                      aria-label={`${mo.label}: ${mo.count} ${mo.count === 1 ? 'memory' : 'memories'}. Jump to latest.`}
                      style={{
                        left: `${mo.positionPct}%`,
                        width: `${mo.widthPct}%`,
                        height: `${heightPct}%`,
                        bottom: '26px',
                      }}
                      className={`absolute -translate-x-1/2 rounded-t transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                        inSelectedYear ? 'bg-accent/20 hover:bg-accent/35' : 'bg-tint opacity-40 hover:opacity-75'
                      }`}
                    />
                  );
                })}

                {/* Main Chronological Axis Baseline */}
                <div
                  className="absolute left-0 right-0 h-px bg-hairline-strong"
                  style={{ bottom: '26px' }}
                  aria-hidden="true"
                />

                {/* Year Boundary Ticks & Labels */}
                {timelineData.years.map((yr) => {
                  const isActiveYear = selectedYear === yr.year;
                  return (
                    <button
                      key={`tick-${yr.year}`}
                      type="button"
                      onClick={() => {
                        setJumpFeedback(null);
                        onSelectYear(isActiveYear ? null : yr.year);
                      }}
                      style={{ left: `${yr.positionPct}%`, bottom: '2px' }}
                      aria-label={`Filter timeline to ${yr.year}`}
                      className={`absolute -translate-x-1/2 inline-flex flex-col items-center group focus-visible:outline-none ${
                        isActiveYear ? 'text-accent-text font-semibold' : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      <span
                        className={`w-px h-2.5 mb-0.5 ${
                          isActiveYear ? 'bg-accent' : 'bg-hairline-strong group-hover:bg-ink-secondary'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="font-mono text-[10px] leading-none tabular-nums">
                        {yr.year}
                      </span>
                    </button>
                  );
                })}

                {/* Interactive Date Cluster Nodes */}
                {timelineData.clusters.map((cluster) => {
                  const isSelectedDate = selectedDate === cluster.date;
                  const containsActive = cluster.memories.some((m) => m.id === activeMemoryId);
                  const isHighlighted = isSelectedDate || containsActive;
                  const dimmedByYear = Boolean(selectedYear && cluster.year !== selectedYear);

                  return (
                    <button
                      key={cluster.date}
                      type="button"
                      onClick={() => {
                        setJumpFeedback(null);
                        onJumpToDate(cluster.date, cluster.memories[0]);
                      }}
                      onMouseEnter={() => setHoveredClusterDate(cluster.date)}
                      onMouseLeave={() => setHoveredClusterDate(null)}
                      onFocus={() => setHoveredClusterDate(cluster.date)}
                      onBlur={() => setHoveredClusterDate(null)}
                      aria-label={`Jump to ${cluster.date}: ${cluster.memories[0].title}${
                        cluster.memories.length > 1 ? ` and ${cluster.memories.length - 1} more` : ''
                      }`}
                      style={{
                        left: `${cluster.positionPct}%`,
                        bottom: '19px',
                      }}
                      className={`absolute -translate-x-1/2 flex flex-col items-center justify-center w-6 h-8 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        dimmedByYear ? 'opacity-35 hover:opacity-90' : 'opacity-100'
                      } ${isHighlighted ? 'z-20 scale-115' : 'z-10 hover:z-20 hover:scale-110'}`}
                    >
                      <span
                        className={`block rounded-full border transition-all ${
                          isHighlighted
                            ? 'w-3.5 h-3.5 border-white dark:border-slate-950 ring-2 ring-accent'
                            : cluster.memories.length > 1
                              ? 'w-3 h-3 border-surface'
                              : 'w-2.5 h-2.5 border-surface'
                        }`}
                        style={{ backgroundColor: cluster.primaryColor }}
                      />
                      {cluster.memories.length > 1 && (
                        <span
                          className="absolute -top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-surface border border-hairline-strong font-mono text-[9px] leading-[12px] text-ink text-center tabular-nums"
                          aria-hidden="true"
                        >
                          {cluster.memories.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => panTrack('right')}
              aria-label="Scroll timeline later"
              className="hidden sm:inline-flex items-center justify-center w-8 h-16 rounded-xl border border-hairline bg-inset text-ink-muted hover:text-ink hover:border-hairline-strong shrink-0"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Dedicated Live Preview & Status Row (No Clipped Tooltips) */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs min-h-[20px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 text-ink-secondary">
              {previewCluster ? (
                <>
                  <span className="font-mono text-[11px] font-semibold text-accent-text tabular-nums shrink-0">
                    {formatReadableDate(previewCluster.date)}
                  </span>
                  <span className="text-ink-muted" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-medium text-ink truncate max-w-[300px] sm:max-w-[460px]">
                    {previewCluster.memories[0].title}
                  </span>
                  {previewCluster.memories.length > 1 && (
                    <span className="font-mono text-[11px] text-ink-muted tabular-nums shrink-0">
                      +{previewCluster.memories.length - 1} more
                    </span>
                  )}
                  <span className="text-[11px] text-ink-muted shrink-0">
                    ({previewCluster.memories[0].category})
                  </span>
                </>
              ) : previewMonth ? (
                <>
                  <span className="font-mono text-[11px] font-semibold text-accent-text tabular-nums">
                    {previewMonth.label}
                  </span>
                  <span className="text-ink-muted" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-ink-secondary tabular-nums">
                    {previewMonth.count} {previewMonth.count === 1 ? 'memory' : 'memories'} — click to jump to{' '}
                    <span className="font-medium text-ink">{previewMonth.latestMemory.title}</span>
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-ink-muted">
                  Select any marker, month bar, or year above to jump across your archive.
                </span>
              )}
            </div>

            {jumpFeedback && (
              <span className="font-mono text-[11px] text-sky-700 dark:text-sky-300 tabular-nums shrink-0">
                {jumpFeedback}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-hairline bg-inset px-3 py-2.5 text-xs text-ink-muted">
          Dated memories will appear along this chronological axis once added or when filters match entries.
        </div>
      )}
    </section>
  );
}
