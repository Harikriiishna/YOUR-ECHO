import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { ModuleId } from '../types/echo';
import type { DailyCheckInStatus, MonthlyReflectionData } from './DailyCheckInCard';

interface MonthlyReflectionCardProps {
  localDate: string;
  checkIn: DailyCheckInStatus | null;
  aiConsent: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (module: ModuleId, targetId?: string) => void;
}

export function MonthlyReflectionCard({
  localDate,
  checkIn,
  aiConsent,
  onRefresh,
  onNavigate,
}: MonthlyReflectionCardProps) {
  const [reflection, setReflection] = useState<MonthlyReflectionData | null>(
    checkIn?.monthlyReflection ?? null
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReflection(checkIn?.monthlyReflection ?? null);
  }, [checkIn?.monthlyReflection]);

  const historyCount = (checkIn?.history || []).filter((item) => !item.aiExcluded).length;
  const hasNewCheckIns =
    Boolean(reflection) && historyCount > (reflection?.checkInCount ?? 0);

  const handleGenerate = async () => {
    if (generating || !aiConsent || historyCount === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await apiRequest<{ reflection: MonthlyReflectionData }>('/ai/monthly-reflection', {
        method: 'POST',
        body: JSON.stringify({ localDate }),
      });
      setReflection(res.reflection);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate Monthly Reflection.');
    } finally {
      setGenerating(false);
    }
  };

  const formattedGeneratedDate = reflection?.generatedAt
    ? new Date(reflection.generatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  return (
    <section
      aria-labelledby="monthly-reflection-heading"
      className="rounded-2xl border border-hairline bg-surface p-6 space-y-5 min-w-0"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Sparkles className="w-4 h-4 text-accent-text shrink-0" />
            <h2 id="monthly-reflection-heading" className="font-display text-lg font-semibold text-ink">
              Monthly Reflection
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <span>Key themes from your daily check-in answers</span>
            {reflection && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Based on {reflection.checkInCount}{' '}
                  {reflection.checkInCount === 1 ? 'check-in' : 'check-ins'}
                </span>
                {formattedGeneratedDate && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Updated {formattedGeneratedDate}</span>
                  </>
                )}
              </>
            )}
            {hasNewCheckIns && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-accent-text">
                  New check-ins available
                </span>
              </>
            )}
          </div>
        </div>

        {aiConsent && historyCount > 0 && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className={`touch-manipulation inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
              reflection
                ? 'border border-accent-border bg-accent-soft text-accent-text hover:opacity-90 disabled:opacity-60'
                : 'bg-accent text-accent-ink hover:bg-accent-strong disabled:opacity-60'
            }`}
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : reflection ? (
              <RefreshCw className="w-3.5 h-3.5" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {generating
              ? 'Summarizing Month...'
              : reflection
              ? 'Refresh Summary'
              : 'Generate Monthly Reflection'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {!aiConsent ? (
        <div className="rounded-xl border border-hairline bg-inset px-5 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <h3 className="font-display text-sm font-semibold text-ink">
              AI summaries are currently paused
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Enable AI archive reflection in your Profile settings if you’d like Gemini AI to distill monthly themes from your daily check-ins.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('profile')}
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-tint-hover transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            Privacy Settings
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : historyCount === 0 ? (
        <div className="rounded-xl border border-hairline bg-inset px-5 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <h3 className="font-display text-sm font-semibold text-ink">
              No check-ins to summarize yet
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Once you record daily check-in reflections from the last 30 days, Gemini AI can surface recurring themes, emotional shifts, and a gentle question for the month ahead.
            </p>
          </div>
          <a
            href="#daily-checkin-heading"
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-tint-hover transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            Write First Check-In
          </a>
        </div>
      ) : generating && !reflection ? (
        <div className="rounded-xl border border-hairline bg-inset px-5 py-8 flex items-center gap-3 text-sm text-ink-secondary">
          <Loader2 className="w-4 h-4 animate-spin text-accent-text shrink-0" />
          <span>Reading your check-ins from the last 30 days and distilling key themes...</span>
        </div>
      ) : !reflection ? (
        <div className="rounded-xl border border-hairline bg-inset px-5 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h3 className="font-display text-sm font-semibold text-ink">
              Ready to synthesize your month
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              You have <span className="font-mono tabular-nums font-medium text-ink-secondary">{historyCount}</span>{' '}
              {historyCount === 1 ? 'check-in reflection' : 'check-in reflections'} from the last 30 days. Generate a grounded Monthly Reflection highlighting your core themes and emotional arc.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm sm:text-[15px] text-ink leading-relaxed max-w-3xl">
            {reflection.summary}
          </p>

          {reflection.themes.length > 0 && (
            <div className="pt-4 border-t border-hairline grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
              {reflection.themes.map((theme, idx) => (
                <div key={`${theme.name}-${idx}`} className="space-y-1.5 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-sm font-semibold text-ink">
                      {String(idx + 1).padStart(2, '0')}. {theme.name}
                    </h3>
                    {theme.memoryIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onNavigate('memories', theme.memoryIds[0])}
                        className="touch-manipulation inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline whitespace-nowrap shrink-0"
                      >
                        <BookOpen className="w-3 h-3" />
                        <span className="font-mono tabular-nums">{theme.memoryIds.length}</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-ink-secondary leading-relaxed">{theme.insight}</p>
                </div>
              ))}
            </div>
          )}

          {(reflection.emotionalArc || reflection.gentlePrompt) && (
            <div className="pt-4 border-t border-hairline grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              {reflection.emotionalArc && (
                <div className="space-y-1">
                  <span className="font-semibold text-ink-muted">Emotional Arc</span>
                  <p className="text-ink-secondary leading-relaxed">{reflection.emotionalArc}</p>
                </div>
              )}
              {reflection.gentlePrompt && (
                <div className="space-y-1">
                  <span className="font-semibold text-accent-text">Carry Forward</span>
                  <p className="text-ink leading-relaxed font-medium">{reflection.gentlePrompt}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
