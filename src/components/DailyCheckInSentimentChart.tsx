import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, BarChart3, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { ModuleId } from '../types/echo';
import type { DailyCheckInHistoryItem, DailyCheckInStatus } from './DailyCheckInCard';

interface DailyCheckInSentimentChartProps {
  localDate: string;
  checkIn: DailyCheckInStatus | null;
  aiConsent: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (module: ModuleId, targetId?: string) => void;
}

type SentimentPolarity = 'positive' | 'neutral' | 'negative';

interface DayChartPoint {
  date: string;
  shortLabel: string;
  fullLabel: string;
  score: number | null;
  polarity: SentimentPolarity | null;
  entryCount: number;
  dominantMood: string;
  emotionalImpact: string;
  sentimentTone: string;
  rationale: string;
  excerpt: string;
  isAiScored: boolean;
  primaryEntryId: string | null;
}

const MOOD_FALLBACK_VALENCE: Record<string, { score: number; impact: string }> = {
  joyful: { score: 82, impact: 'Uplifting' },
  grateful: { score: 76, impact: 'Uplifting' },
  inspired: { score: 74, impact: 'Uplifting' },
  hopeful: { score: 62, impact: 'Uplifting' },
  peaceful: { score: 52, impact: 'Calm' },
  calm: { score: 48, impact: 'Calm' },
  tender: { score: 40, impact: 'Calm' },
  courageous: { score: 38, impact: 'Uplifting' },
  reflective: { score: 12, impact: 'Reflective' },
  nostalgic: { score: 8, impact: 'Bittersweet' },
  bittersweet: { score: -12, impact: 'Bittersweet' },
  melancholic: { score: -42, impact: 'Challenging' },
  anxious: { score: -56, impact: 'Challenging' },
};

const POSITIVE_THRESHOLD = 20;
const NEGATIVE_THRESHOLD = -15;

const POLARITY_META: Record<
  SentimentPolarity,
  { label: string; rangeLabel: string; color: string; textClass: string }
> = {
  positive: {
    label: 'Positive',
    rangeLabel: '+20 to +100',
    color: '#10B981',
    textClass: 'text-emerald-700 dark:text-emerald-300',
  },
  neutral: {
    label: 'Neutral',
    rangeLabel: '-14 to +19',
    color: '#F59E0B',
    textClass: 'text-amber-700 dark:text-amber-300',
  },
  negative: {
    label: 'Negative',
    rangeLabel: '-100 to -15',
    color: '#F43F5E',
    textClass: 'text-rose-700 dark:text-rose-300',
  },
};

const IMPACT_ORDER = ['Uplifting', 'Calm', 'Reflective', 'Bittersweet', 'Challenging'] as const;

const IMPACT_COLORS: Record<string, string> = {
  Uplifting: '#10B981',
  Calm: '#0EA5E9',
  Reflective: '#6366F1',
  Bittersweet: '#F59E0B',
  Challenging: '#F43F5E',
};

function getSentimentPolarity(score: number): SentimentPolarity {
  if (score >= POSITIVE_THRESHOLD) return 'positive';
  if (score <= NEGATIVE_THRESHOLD) return 'negative';
  return 'neutral';
}

function resolveEntrySentiment(entry: DailyCheckInHistoryItem): {
  score: number;
  polarity: SentimentPolarity;
  impact: string;
  tone: string;
  isAiScored: boolean;
} {
  if (entry.sentimentScore !== null && Number.isFinite(entry.sentimentScore)) {
    const score = Math.max(-100, Math.min(100, Math.round(entry.sentimentScore)));
    return {
      score,
      polarity: getSentimentPolarity(score),
      impact: entry.emotionalImpact || 'Reflective',
      tone: entry.sentimentTone || entry.mood || 'Reflective',
      isAiScored: true,
    };
  }
  const key = (entry.sentimentTone || entry.mood || 'reflective').trim().toLowerCase();
  const mapped = MOOD_FALLBACK_VALENCE[key] || { score: 12, impact: 'Reflective' };
  return {
    score: mapped.score,
    polarity: getSentimentPolarity(mapped.score),
    impact: entry.emotionalImpact || mapped.impact,
    tone: entry.sentimentTone || entry.mood || 'Reflective',
    isAiScored: false,
  };
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatFullDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DayChartPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt || pt.score === null || !pt.polarity) return null;

  const formattedScore = pt.score > 0 ? `+${pt.score}` : String(pt.score);
  const polarityMeta = POLARITY_META[pt.polarity];

  return (
    <div className="rounded-xl border border-hairline-strong bg-surface-raised px-3.5 py-3 shadow-lg max-w-xs space-y-1.5 text-left">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold text-ink">{pt.fullLabel}</span>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-xs font-bold tabular-nums ${polarityMeta.textClass}`}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: polarityMeta.color }}
            aria-hidden="true"
          />
          {polarityMeta.label} ({formattedScore})
        </span>
      </div>
      <div className="text-xs text-ink-secondary">
        <span>{pt.emotionalImpact}</span>
        <span aria-hidden="true"> · </span>
        <span>{pt.sentimentTone}</span>
        {pt.entryCount > 1 && (
          <>
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">{pt.entryCount} check-ins</span>
          </>
        )}
      </div>
      {pt.rationale ? (
        <p className="text-xs text-ink-muted leading-relaxed line-clamp-3">{pt.rationale}</p>
      ) : pt.excerpt ? (
        <p className="text-xs text-ink-muted leading-relaxed line-clamp-2">{pt.excerpt}</p>
      ) : null}
      <div className="text-[11px] text-ink-muted">
        {pt.isAiScored ? 'AI sentiment score' : 'Mood-mapped baseline'}
      </div>
    </div>
  );
}

function BreakdownTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { impact: string; count: number; percent: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-xl border border-hairline-strong bg-surface-raised px-3 py-2 shadow-lg text-xs">
      <div className="font-semibold text-ink">{item.impact}</div>
      <div className="font-mono tabular-nums text-ink-secondary mt-0.5">
        {item.count} {item.count === 1 ? 'check-in' : 'check-ins'} ({item.percent}%)
      </div>
    </div>
  );
}

export function DailyCheckInSentimentChart({
  localDate,
  checkIn,
  aiConsent,
  onRefresh,
  onNavigate,
}: DailyCheckInSentimentChartProps) {
  const [chartMode, setChartMode] = useState<'trend' | 'breakdown'>('trend');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const history = checkIn?.history || [];

  const {
    daySeries,
    impactSeries,
    polarityCounts,
    avgValence,
    dominantImpact,
    aiScoredCount,
    unanalyzedIds,
    latestScoredPoint,
    gradientStops,
  } = useMemo(() => {
    const byDate = new Map<string, DailyCheckInHistoryItem[]>();
    for (const item of history) {
      const list = byDate.get(item.memoryDate) || [];
      list.push(item);
      byDate.set(item.memoryDate, list);
    }

    const series: DayChartPoint[] = [];
    const impactCounts: Record<string, number> = {
      Uplifting: 0,
      Calm: 0,
      Reflective: 0,
      Bittersweet: 0,
      Challenging: 0,
    };
    const pCounts: Record<SentimentPolarity, number> = {
      positive: 0,
      neutral: 0,
      negative: 0,
    };

    let scoreSum = 0;
    let scoredEntries = 0;
    let aiCount = 0;
    const missingAiIds: string[] = [];
    let latestPoint: DayChartPoint | null = null;

    for (const item of history) {
      const resolved = resolveEntrySentiment(item);
      scoreSum += resolved.score;
      scoredEntries += 1;
      pCounts[resolved.polarity] += 1;
      impactCounts[resolved.impact] = (impactCounts[resolved.impact] || 0) + 1;
      if (resolved.isAiScored) {
        aiCount += 1;
      } else if (!item.aiExcluded) {
        missingAiIds.push(item.id);
      }
    }

    let minDayScore = Infinity;
    let maxDayScore = -Infinity;

    for (let offset = -29; offset <= 0; offset += 1) {
      const d = shiftIsoDate(localDate, offset);
      const items = byDate.get(d) || [];
      if (items.length === 0) {
        series.push({
          date: d,
          shortLabel: formatShortDate(d),
          fullLabel: formatFullDate(d),
          score: null,
          polarity: null,
          entryCount: 0,
          dominantMood: '',
          emotionalImpact: '',
          sentimentTone: '',
          rationale: '',
          excerpt: '',
          isAiScored: false,
          primaryEntryId: null,
        });
        continue;
      }

      const resolvedList = items.map((it) => ({ item: it, ...resolveEntrySentiment(it) }));
      const avgDayScore = Math.round(
        resolvedList.reduce((acc, cur) => acc + cur.score, 0) / resolvedList.length
      );
      minDayScore = Math.min(minDayScore, avgDayScore);
      maxDayScore = Math.max(maxDayScore, avgDayScore);

      const primary = resolvedList[resolvedList.length - 1];
      const pt: DayChartPoint = {
        date: d,
        shortLabel: formatShortDate(d),
        fullLabel: formatFullDate(d),
        score: avgDayScore,
        polarity: getSentimentPolarity(avgDayScore),
        entryCount: items.length,
        dominantMood: primary.item.mood,
        emotionalImpact: primary.impact,
        sentimentTone: primary.tone,
        rationale: primary.item.sentimentRationale,
        excerpt: primary.item.excerpt,
        isAiScored: resolvedList.some((x) => x.isAiScored),
        primaryEntryId: primary.item.id,
      };
      series.push(pt);
      latestPoint = pt;
    }

    // Calculate vertical stop offsets aligned to positive (>= 20), neutral, negative (<= -15)
    let posEnd = 0;
    let negStart = 1;
    let singleColor: string | null = null;
    if (!Number.isFinite(minDayScore) || !Number.isFinite(maxDayScore)) {
      singleColor = POLARITY_META.neutral.color;
    } else if (maxDayScore === minDayScore) {
      singleColor = POLARITY_META[getSentimentPolarity(maxDayScore)].color;
    } else {
      const span = maxDayScore - minDayScore;
      posEnd = clamp01((maxDayScore - POSITIVE_THRESHOLD) / span);
      negStart = clamp01((maxDayScore - NEGATIVE_THRESHOLD) / span);
    }

    const total = Math.max(1, history.length);
    const impactData = IMPACT_ORDER.map((impact) => ({
      impact,
      count: impactCounts[impact] || 0,
      percent: Math.round(((impactCounts[impact] || 0) / total) * 100),
      color: IMPACT_COLORS[impact],
    }));

    const topImpact =
      history.length > 0
        ? IMPACT_ORDER.slice().sort((a, b) => (impactCounts[b] || 0) - (impactCounts[a] || 0))[0]
        : '';

    return {
      daySeries: series,
      impactSeries: impactData,
      polarityCounts: pCounts,
      avgValence: scoredEntries > 0 ? Math.round(scoreSum / scoredEntries) : null,
      dominantImpact: topImpact,
      aiScoredCount: aiCount,
      unanalyzedIds: missingAiIds,
      latestScoredPoint: latestPoint,
      gradientStops: { posEnd, negStart, singleColor },
    };
  }, [history, localDate]);

  const activeEntry = useMemo(() => {
    if (history.length === 0) return null;
    if (selectedEntryId) {
      return history.find((h) => h.id === selectedEntryId) || history[history.length - 1];
    }
    return history[history.length - 1];
  }, [history, selectedEntryId]);

  const activeResolved = activeEntry ? resolveEntrySentiment(activeEntry) : null;

  const handleAnalyzeMissing = async () => {
    if (unanalyzedIds.length === 0 || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      await apiRequest('/memories/analyze-sentiment-batch', {
        method: 'POST',
        body: JSON.stringify({
          memoryIds: unanalyzedIds.slice(0, 15),
          applyMood: false,
        }),
      });
      await onRefresh();
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Unable to analyze check-in sentiment.');
    } finally {
      setAnalyzing(false);
    }
  };

  const formattedAvgValence =
    avgValence === null ? '—' : avgValence > 0 ? `+${avgValence}` : String(avgValence);

  const renderSentimentDot = (props: {
    cx?: number;
    cy?: number;
    payload?: DayChartPoint;
    index?: number;
  }) => {
    const { cx, cy, payload, index } = props;
    if (
      typeof cx !== 'number' ||
      typeof cy !== 'number' ||
      !payload ||
      payload.score === null ||
      !payload.polarity
    ) {
      return <g key={`dot-empty-${index ?? 'x'}`} />;
    }

    const color = POLARITY_META[payload.polarity].color;
    const isSelected = Boolean(selectedEntryId && payload.primaryEntryId === selectedEntryId);

    return (
      <g key={`dot-${payload.date}`}>
        {isSelected && (
          <circle
            cx={cx}
            cy={cy}
            r={8}
            fill={color}
            fillOpacity={0.2}
          />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={isSelected ? 5.5 : 4.5}
          fill={color}
          stroke="var(--echo-surface)"
          strokeWidth={2}
          style={{ cursor: 'pointer' }}
        />
      </g>
    );
  };

  const renderActiveSentimentDot = (props: {
    cx?: number;
    cy?: number;
    payload?: DayChartPoint;
    index?: number;
  }) => {
    const { cx, cy, payload, index } = props;
    if (
      typeof cx !== 'number' ||
      typeof cy !== 'number' ||
      !payload ||
      payload.score === null ||
      !payload.polarity
    ) {
      return <g key={`active-empty-${index ?? 'x'}`} />;
    }

    const color = POLARITY_META[payload.polarity].color;
    return (
      <g key={`active-${payload.date}`}>
        <circle cx={cx} cy={cy} r={9} fill={color} fillOpacity={0.22} />
        <circle
          cx={cx}
          cy={cy}
          r={6}
          fill={color}
          stroke="var(--echo-surface)"
          strokeWidth={2.5}
        />
      </g>
    );
  };

  return (
    <section
      aria-labelledby="checkin-sentiment-heading"
      className="rounded-2xl border border-hairline bg-surface p-6 space-y-5 min-w-0"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h2 id="checkin-sentiment-heading" className="font-display text-lg font-semibold text-ink">
            Check-In Sentiment · Last 30 Days
          </h2>
          {history.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              <span className="font-mono tabular-nums text-ink-secondary">
                {history.length} {history.length === 1 ? 'check-in' : 'check-ins'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Avg valence {formattedAvgValence}
              </span>
              {dominantImpact && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Dominant tone: {dominantImpact}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {aiScoredCount}/{history.length} AI scored
              </span>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              Tracks emotional valence (-100 to +100) and impact across your daily check-in reflections.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {aiConsent && unanalyzedIds.length > 0 && (
            <button
              type="button"
              onClick={handleAnalyzeMissing}
              disabled={analyzing}
              className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl border border-accent-border bg-accent-soft px-3.5 py-2 text-xs font-semibold text-accent-text hover:opacity-90 disabled:opacity-60 transition-opacity whitespace-nowrap shrink-0 min-h-[40px]"
            >
              {analyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {analyzing ? 'Analyzing...' : `Analyze ${unanalyzedIds.length} with AI`}
            </button>
          )}

          {history.length > 0 && (
            <div
              className="inline-flex items-center gap-1 p-1 rounded-xl border border-hairline bg-inset"
              role="group"
              aria-label="Sentiment chart view"
            >
              <button
                type="button"
                onClick={() => setChartMode('trend')}
                className={`touch-manipulation inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                  chartMode === 'trend'
                    ? 'bg-surface-raised text-ink shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                30-Day Trend
              </button>
              <button
                type="button"
                onClick={() => setChartMode('breakdown')}
                className={`touch-manipulation inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                  chartMode === 'breakdown'
                    ? 'bg-surface-raised text-ink shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Impact Mix
              </button>
            </div>
          )}
        </div>
      </div>

      {analyzeError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200">
          {analyzeError}
        </div>
      )}

      {history.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-inset px-5 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <h3 className="font-display text-sm font-semibold text-ink">
              No daily check-ins in the last 30 days yet
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Answer today’s mindful question above to plot your first emotional valence point and start spotting mood patterns across the month.
            </p>
          </div>
          <a
            href="#daily-checkin-heading"
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-tint-hover transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            Answer Today’s Prompt
          </a>
        </div>
      ) : (
        <>
          {chartMode === 'trend' && (
            <div
              className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs"
              aria-label="Sentiment color legend"
            >
              {(['positive', 'neutral', 'negative'] as const).map((key) => {
                const meta = POLARITY_META[key];
                const count = polarityCounts[key];
                return (
                  <div key={key} className="inline-flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: meta.color }}
                      aria-hidden="true"
                    />
                    <span className={`font-medium ${meta.textClass}`}>{meta.label}</span>
                    <span className="text-ink-muted font-mono tabular-nums">
                      ({meta.rangeLabel}) · {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="w-full h-64 sm:h-72 min-w-0">
            {chartMode === 'trend' ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart
                  data={daySeries}
                  margin={{ top: 12, right: 16, left: -12, bottom: 4 }}
                  onClick={(state) => {
                    const idx =
                      typeof state?.activeTooltipIndex === 'number'
                        ? state.activeTooltipIndex
                        : -1;
                    if (idx >= 0 && daySeries[idx]?.primaryEntryId) {
                      setSelectedEntryId(daySeries[idx].primaryEntryId);
                    }
                  }}
                >
                  <defs>
                    <linearGradient id="echoCheckInPolarityStroke" x1="0" y1="0" x2="0" y2="1">
                      {gradientStops.singleColor ? (
                        <>
                          <stop offset="0%" stopColor={gradientStops.singleColor} />
                          <stop offset="100%" stopColor={gradientStops.singleColor} />
                        </>
                      ) : (
                        <>
                          <stop offset="0%" stopColor={POLARITY_META.positive.color} />
                          <stop
                            offset={`${Math.round(gradientStops.posEnd * 100)}%`}
                            stopColor={POLARITY_META.positive.color}
                          />
                          <stop
                            offset={`${Math.round(gradientStops.posEnd * 100)}%`}
                            stopColor={POLARITY_META.neutral.color}
                          />
                          <stop
                            offset={`${Math.round(gradientStops.negStart * 100)}%`}
                            stopColor={POLARITY_META.neutral.color}
                          />
                          <stop
                            offset={`${Math.round(gradientStops.negStart * 100)}%`}
                            stopColor={POLARITY_META.negative.color}
                          />
                          <stop offset="100%" stopColor={POLARITY_META.negative.color} />
                        </>
                      )}
                    </linearGradient>

                    <linearGradient id="echoCheckInPolarityFill" x1="0" y1="0" x2="0" y2="1">
                      {gradientStops.singleColor ? (
                        <>
                          <stop offset="0%" stopColor={gradientStops.singleColor} stopOpacity={0.24} />
                          <stop offset="100%" stopColor={gradientStops.singleColor} stopOpacity={0.03} />
                        </>
                      ) : (
                        <>
                          <stop
                            offset="0%"
                            stopColor={POLARITY_META.positive.color}
                            stopOpacity={0.26}
                          />
                          <stop
                            offset={`${Math.round(gradientStops.posEnd * 100)}%`}
                            stopColor={POLARITY_META.positive.color}
                            stopOpacity={0.14}
                          />
                          <stop
                            offset={`${Math.round(gradientStops.negStart * 100)}%`}
                            stopColor={POLARITY_META.neutral.color}
                            stopOpacity={0.12}
                          />
                          <stop
                            offset="100%"
                            stopColor={POLARITY_META.negative.color}
                            stopOpacity={0.24}
                          />
                        </>
                      )}
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="var(--echo-hairline)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fill: 'var(--echo-ink-muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--echo-hairline)' }}
                    interval={4}
                    minTickGap={18}
                  />
                  <YAxis
                    domain={[-100, 100]}
                    ticks={[-100, -50, 0, 50, 100]}
                    tick={{ fill: 'var(--echo-ink-muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v > 0 ? `+${v}` : String(v))}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="var(--echo-hairline-strong)"
                    strokeDasharray="4 4"
                  />
                  <Tooltip
                    content={<TrendTooltip />}
                    cursor={{ stroke: 'var(--echo-hairline-strong)', strokeWidth: 1.5 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    connectNulls
                    stroke="url(#echoCheckInPolarityStroke)"
                    strokeWidth={2.5}
                    fill="url(#echoCheckInPolarityFill)"
                    dot={renderSentimentDot}
                    activeDot={renderActiveSentimentDot}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={impactSeries}
                  margin={{ top: 12, right: 16, left: -12, bottom: 4 }}
                >
                  <CartesianGrid
                    stroke="var(--echo-hairline)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="impact"
                    tick={{ fill: 'var(--echo-ink-muted)', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--echo-hairline)' }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'var(--echo-ink-muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={<BreakdownTooltip />}
                    cursor={{ fill: 'var(--echo-tint)' }}
                  />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={56}>
                    {impactSeries.map((entry) => (
                      <Cell key={entry.impact} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {(activeEntry || latestScoredPoint) && activeEntry && activeResolved && (
            <div className="pt-4 border-t border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                  <span className="font-medium text-ink">
                    {selectedEntryId ? 'Selected reflection' : 'Latest reflection'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{activeEntry.memoryDate}</span>
                  <span aria-hidden="true">·</span>
                  <span className={`font-semibold ${POLARITY_META[activeResolved.polarity].textClass}`}>
                    {POLARITY_META[activeResolved.polarity].label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeResolved.impact}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {activeResolved.score > 0 ? `+${activeResolved.score}` : activeResolved.score} valence
                  </span>
                </div>
                <p className="text-xs text-ink-secondary truncate">
                  {activeEntry.sentimentRationale || activeEntry.excerpt || activeEntry.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('memories', activeEntry.id)}
                className="touch-manipulation inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text hover:underline whitespace-nowrap shrink-0 min-h-[36px]"
              >
                Open reflection
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
