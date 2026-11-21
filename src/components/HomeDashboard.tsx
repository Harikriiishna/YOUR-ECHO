import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Clock,
  Compass,
  Feather,
  HeartHandshake,
  Moon,
  Plus,
  Repeat,
  Send,
  Sparkles,
  Watch,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import type { ModuleId } from '../types/echo';
import { SafeImage } from './MediaElements';

interface DashboardData {
  stats: {
    memoryCount: number;
    dreamCount: number;
    objectCount: number;
    capsuleCount: number;
    readyCapsules: number;
    unreadNotifications: number;
  };
  featuredMemory: {
    id: string;
    title: string;
    content: string;
    memory_date: string;
    category: string;
    mood: string;
    location_name: string;
  } | null;
  recentMemories: Array<{
    id: string;
    title: string;
    content: string;
    memory_date: string;
    category: string;
    mood: string;
    location_name: string;
  }>;
  onThisDay: Array<{
    id: string;
    title: string;
    memory_date: string;
    content: string;
  }>;
  nextCapsule: {
    id: string;
    title: string;
    capsule_type: string;
    unlock_occasion: string;
    unlock_at: string;
  } | null;
  humanityHighlights: Array<{
    id: string;
    category: string;
    title: string;
    content: string;
    approx_region: string;
    helpful_count: number;
  }>;
  skillDiscovery: Array<{
    user_id: string;
    display_name: string;
    teach_skills_json: string;
    learn_skills_json: string;
    mode: string;
    location_city: string;
  }>;
}

const DAILY_REFLECTIONS = [
  'What small ordinary moment from today would you hope to remember five years from now?',
  'Who taught you something silently, just by the way they lived?',
  'What version of yourself from three years ago would feel proud of you tonight?',
  'Which object within arm’s reach carries a memory nobody else knows?',
];

export function HomeDashboard() {
  const { user, navigateTo, setQuickCaptureTarget, refreshNotifications } = useEcho();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quickText, setQuickText] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const res = await apiRequest<DashboardData>('/dashboard');
      setData(res);
      void refreshNotifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!data?.nextCapsule) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data?.nextCapsule]);

  const handleQuickCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickText.trim()) return;
    setSavingQuick(true);
    try {
      const title = quickTitle.trim() || quickText.trim().slice(0, 48);
      await apiRequest('/memories', {
        method: 'POST',
        body: JSON.stringify({
          title,
          content: quickText.trim(),
          memoryDate: new Date().toISOString().slice(0, 10),
          category: 'Important moments',
          mood: 'Reflective',
        }),
      });
      setQuickTitle('');
      setQuickText('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quick memory.');
    } finally {
      setSavingQuick(false);
    }
  };

  const formatCountdown = (unlockAt: string) => {
    const diff = Math.max(0, Date.parse(unlockAt) - nowTick);
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const reflection = DAILY_REFLECTIONS[new Date().getDate() % DAILY_REFLECTIONS.length];

  const moduleCards: Array<{
    id: ModuleId;
    title: string;
    subtitle: string;
    accent: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'memories', title: 'ECHO Memory', subtitle: 'Timeline, calendar, map & voice', accent: 'text-sky-600 dark:text-sky-300', icon: BookOpen },
    { id: 'ai', title: 'AI Life Memory', subtitle: 'Ask grounded questions about your past', accent: 'text-cyan-600 dark:text-cyan-300', icon: Sparkles },
    { id: 'capsules', title: 'Time Capsule', subtitle: 'Seal letters & media for future dates', accent: 'text-amber-600 dark:text-amber-300', icon: Clock },
    { id: 'wisdom', title: "Stranger's Wisdom", subtitle: 'Anonymous advice & life lessons', accent: 'text-violet-600 dark:text-violet-300', icon: Feather },
    { id: 'skillswap', title: 'SkillSwap', subtitle: 'Mutual learning & live chat', accent: 'text-emerald-600 dark:text-emerald-300', icon: Repeat },
    { id: 'objects', title: 'Life Behind Objects', subtitle: 'Heirloom stories & QR provenance', accent: 'text-rose-600 dark:text-rose-300', icon: Watch },
    { id: 'dreams', title: 'Dream Archive', subtitle: 'Dreams, vividness & patterns', accent: 'text-indigo-600 dark:text-indigo-300', icon: Moon },
    { id: 'humanity', title: 'Humanity Feed', subtitle: 'Global anonymous reflections', accent: 'text-teal-600 dark:text-teal-300', icon: HeartHandshake },
  ];

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-44 rounded-2xl bg-tint animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="h-52 rounded-2xl bg-tint animate-pulse lg:col-span-2" />
          <div className="h-52 rounded-2xl bg-tint animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 min-w-0 w-full">
      {/* Greeting & Real Archive Summary (dark photo scrim keeps white text legible in all themes) */}
      <section className="relative overflow-hidden rounded-2xl border border-hairline bg-[#0D1424] w-full">
        <SafeImage
          src="/src/assets/images/echo_hero_cosmos_1795260972427.jpg"
          alt="Midnight sky and glowing memory trails"
          className="absolute inset-0 w-full h-full object-cover opacity-35"
        />
        <div className="relative z-10 bg-gradient-to-r from-[#070B14]/95 via-[#070B14]/80 to-[#070B14]/65 p-5 sm:p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-6 min-w-0">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs text-sky-300 font-medium">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <h1 className="font-display text-2xl sm:text-4xl font-bold text-white [text-wrap:balance]">
              {greeting}, {user?.displayName}
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              {reflection}
            </p>
          </div>

          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 border-t lg:border-t-0 lg:border-l border-white/10 pt-4 lg:pt-0 lg:pl-6">
              <div>
                <div className="font-mono text-2xl font-semibold text-white tabular-nums">{data.stats.memoryCount}</div>
                <div className="text-xs text-slate-400">Memories</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-semibold text-amber-300 tabular-nums">{data.stats.capsuleCount}</div>
                <div className="text-xs text-slate-400">Capsules</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-semibold text-indigo-300 tabular-nums">{data.stats.dreamCount}</div>
                <div className="text-xs text-slate-400">Dreams</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-semibold text-rose-300 tabular-nums">{data.stats.objectCount}</div>
                <div className="text-xs text-slate-400">Objects</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* Primary Split: Quick Capture + Featured Memory or Genuine Onboarding Empty State */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Quick Memory Capture */}
        <form
          onSubmit={handleQuickCapture}
          className="lg:col-span-5 rounded-2xl border border-hairline bg-surface p-6 flex flex-col justify-between space-y-4 min-w-0"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-ink">Quick Memory Capture</h2>
              <button
                type="button"
                onClick={() => setQuickCaptureTarget('memory')}
                className="text-xs font-medium text-sky-600 dark:text-sky-300 hover:underline whitespace-nowrap shrink-0"
              >
                Full Editor
              </button>
            </div>
            <input
              type="text"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="Give this moment a title (optional)"
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
            />
            <textarea
              rows={4}
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder="Write what happened, who was there, or how tonight felt..."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={savingQuick || !quickText.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            {savingQuick ? 'Saving...' : 'Save to ECHO Memory'}
          </button>
        </form>

        {/* Featured Memory or Genuine Onboarding Empty State */}
        <div className="lg:col-span-7 rounded-2xl border border-hairline bg-surface p-6 flex flex-col justify-between min-w-0">
          {data?.featuredMemory ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-medium text-sky-600 dark:text-sky-300">
                  Featured Memory · {data.featuredMemory.category} · {data.featuredMemory.memory_date}
                </span>
                <button
                  type="button"
                  onClick={() => navigateTo('memories', data.featuredMemory!.id)}
                  className="text-xs font-medium text-ink-secondary hover:text-ink inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  Open Archive <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <h3 className="font-display text-2xl font-bold text-ink">{data.featuredMemory.title}</h3>
              <p className="text-sm text-ink-secondary leading-relaxed line-clamp-5 whitespace-pre-wrap">
                {data.featuredMemory.content}
              </p>
              <div className="text-xs text-ink-muted pt-2">
                Mood: {data.featuredMemory.mood}
                {data.featuredMemory.location_name ? ` · ${data.featuredMemory.location_name}` : ''}
              </div>
            </div>
          ) : (
            <div className="space-y-4 my-auto py-4">
              <p className="text-xs font-medium text-sky-600 dark:text-sky-300">Your archive begins here</p>
              <h3 className="font-display text-2xl font-bold text-ink [text-wrap:balance]">
                No memories recorded yet — only yours will ever live here.
              </h3>
              <p className="text-sm text-ink-secondary leading-relaxed max-w-xl">
                ECHO never fills your personal timeline with synthetic entries. Capture a memory on the left, seal a Time Capsule for next year, record a dream, or preserve the story of a meaningful family object.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setQuickCaptureTarget('capsule')}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-500/20 transition-colors min-h-[40px]"
                >
                  <Clock className="w-4 h-4" /> Create Time Capsule
                </button>
                <button
                  type="button"
                  onClick={() => setQuickCaptureTarget('object')}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-800 dark:text-rose-200 hover:bg-rose-500/20 transition-colors min-h-[40px]"
                >
                  <Watch className="w-4 h-4" /> Preserve an Object
                </button>
                <button
                  type="button"
                  onClick={() => setQuickCaptureTarget('dream')}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-4 py-2 text-xs font-medium text-indigo-800 dark:text-indigo-200 hover:bg-indigo-500/20 transition-colors min-h-[40px]"
                >
                  <Moon className="w-4 h-4" /> Record a Dream
                </button>
              </div>
            </div>
          )}

          {data && data.onThisDay.length > 0 && (
            <div className="mt-6 pt-4 border-t border-hairline flex items-center justify-between gap-4">
              <div className="text-xs text-ink-secondary">
                <span className="text-cyan-700 dark:text-cyan-300 font-medium">On This Day:</span> {data.onThisDay[0].title} ({data.onThisDay[0].memory_date})
              </div>
              <button
                type="button"
                onClick={() => navigateTo('memories')}
                className="text-xs text-cyan-700 dark:text-cyan-300 hover:underline whitespace-nowrap shrink-0"
              >
                Revisit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Time Capsule Countdown + ECHO AI Assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-2xl border border-hairline bg-surface overflow-hidden flex flex-col justify-between min-w-0">
          <div className="relative h-36">
            <SafeImage
              src="/src/assets/images/echo_capsule_vault_1795260972711.jpg"
              alt="Sealed titanium and amber glass time capsule"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          </div>
          <div className="p-6 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Time Capsule Vault</span>
              {data && data.stats.readyCapsules > 0 && (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {data.stats.readyCapsules} ready to open
                </span>
              )}
            </div>
            {data?.nextCapsule ? (
              <>
                <h3 className="font-display text-lg font-semibold text-ink">{data.nextCapsule.title}</h3>
                <div className="font-mono text-2xl font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  {formatCountdown(data.nextCapsule.unlock_at)}
                </div>
                <p className="text-xs text-ink-muted">
                  Sealed until {new Date(data.nextCapsule.unlock_at).toLocaleDateString()} · {data.nextCapsule.unlock_occasion.replace('_', ' ')}
                </p>
              </>
            ) : (
              <>
                <h3 className="font-display text-lg font-semibold text-ink">Send a letter to your future self</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Lock text, photos, or voice notes on the server until a birthday, graduation, or custom date.
                </p>
              </>
            )}
            <button
              type="button"
              onClick={() => navigateTo('capsules')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline pt-1"
            >
              Open Time Capsules <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ECHO AI Assistant Quick Launcher */}
        <div className="lg:col-span-7 rounded-2xl border border-hairline bg-surface p-6 flex flex-col justify-between space-y-5 min-w-0">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-cyan-700 dark:text-cyan-300">ECHO AI Life Memory</span>
              <button
                type="button"
                onClick={() => navigateTo('ai')}
                className="text-xs text-ink-secondary hover:text-ink whitespace-nowrap shrink-0"
              >
                Open Full Conversation
              </button>
            </div>
            <h3 className="font-display text-xl font-bold text-ink">Ask your real archive anything</h3>
            <p className="text-sm text-ink-muted">
              Grounded strictly in memories you allow AI to read. Facts are separated from personal reflection, and missing memories are never invented.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (aiQuestion.trim()) {
                navigateTo('ai', aiQuestion.trim());
              } else {
                navigateTo('ai');
              }
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <input
              type="text"
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              placeholder="Ask about your memories, places, or past year..."
              className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
            >
              <Send className="w-4 h-4" />
              Ask ECHO AI
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            {[
              'What was my happiest memory?',
              'What places did I visit?',
              'What did I promise myself?',
            ].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => navigateTo('ai', prompt)}
                className="rounded-lg border border-hairline bg-tint px-3 py-1.5 text-xs text-ink-secondary hover:bg-tint-hover hover:text-ink transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Seven Integrated Modules Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">Explore All ECHO Systems</h2>
          <button
            type="button"
            onClick={() => navigateTo('discover')}
            className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1"
          >
            <Compass className="w-3.5 h-3.5" /> Discovery Hub
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {moduleCards.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => navigateTo(mod.id)}
                className="text-left rounded-2xl border border-hairline bg-surface hover:border-hairline-strong hover:bg-surface-raised p-5 transition-colors flex flex-col justify-between space-y-4 min-h-[120px]"
              >
                <Icon className={`w-5 h-5 ${mod.accent}`} />
                <div>
                  <div className="font-display text-sm font-semibold text-ink">{mod.title}</div>
                  <div className="text-xs text-ink-muted mt-1">{mod.subtitle}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent Memories + Humanity Highlights + SkillSwap Discovery */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="rounded-2xl border border-hairline bg-surface p-6 space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-ink">Recent Memories</h3>
            <button
              type="button"
              onClick={() => navigateTo('memories')}
              className="text-xs text-sky-600 dark:text-sky-300 hover:underline"
            >
              View all
            </button>
          </div>
          {data && data.recentMemories.length > 0 ? (
            <div className="divide-y divide-hairline">
              {data.recentMemories.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => navigateTo('memories', m.id)}
                  className="w-full text-left py-3 first:pt-0 last:pb-0 hover:opacity-80 transition-opacity"
                >
                  <div className="text-sm font-medium text-ink truncate">{m.title}</div>
                  <div className="text-xs text-ink-muted mt-0.5 font-mono tabular-nums">
                    {m.memory_date} · {m.category}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">Your recent memories will appear here once saved.</p>
          )}
        </section>

        <section className="rounded-2xl border border-hairline bg-surface p-6 space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-ink">Humanity Highlights</h3>
            <button
              type="button"
              onClick={() => navigateTo('humanity')}
              className="text-xs text-teal-700 dark:text-teal-300 hover:underline"
            >
              Open Feed
            </button>
          </div>
          {data && data.humanityHighlights.length > 0 ? (
            <div className="divide-y divide-hairline">
              {data.humanityHighlights.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => navigateTo('humanity')}
                  className="w-full text-left py-3 first:pt-0 last:pb-0 hover:opacity-80 transition-opacity"
                >
                  <div className="text-sm font-medium text-ink line-clamp-1">{h.title}</div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {h.category} · {h.approx_region} · {h.helpful_count} helpful
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">Anonymous stories shared by the community will appear here.</p>
          )}
        </section>

        <section className="rounded-2xl border border-hairline bg-surface p-6 space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-ink">SkillSwap People</h3>
            <button
              type="button"
              onClick={() => navigateTo('skillswap')}
              className="text-xs text-emerald-700 dark:text-emerald-300 hover:underline"
            >
              Discover
            </button>
          </div>
          {data && data.skillDiscovery.length > 0 ? (
            <div className="divide-y divide-hairline">
              {data.skillDiscovery.map((s) => {
                const teaches = (() => {
                  try {
                    return (JSON.parse(s.teach_skills_json) as string[]).slice(0, 2).join(', ');
                  } catch {
                    return '';
                  }
                })();
                return (
                  <button
                    key={s.user_id}
                    type="button"
                    onClick={() => navigateTo('skillswap')}
                    className="w-full text-left py-3 first:pt-0 last:pb-0 hover:opacity-80 transition-opacity"
                  >
                    <div className="text-sm font-medium text-ink">{s.display_name}</div>
                    <div className="text-xs text-ink-muted mt-0.5 truncate">
                      Teaches: {teaches || 'Open to collaborate'} · {s.mode}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">Skill profiles published by members will appear here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
