import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Flag,
  Globe,
  Heart,
  MessageCircle,
  Plus,
  Search,
  Send,
  ShieldBan,
  Sparkles,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import type { HumanityPost, WisdomPost } from '../types/echo';
import { SafeImage } from './MediaElements';

const WISDOM_CATEGORIES = [
  'All',
  'Life',
  'Love',
  'Friendship',
  'Family',
  'Motivation',
  'Heartbreak',
  'Career',
  'Dreams',
  'Regrets',
  'Happiness',
  'Loneliness',
  'Lessons',
];

const HUMANITY_CATEGORIES = [
  'All',
  'Kindness',
  'Life experiences',
  'Lessons',
  'Hope',
  'Difficult moments',
  'Small achievements',
  'Personal reflections',
  'Meaningful encounters',
];

const APPROX_REGIONS = [
  'Global',
  'North America',
  'South America',
  'Western Europe',
  'Eastern Europe',
  'Middle East & North Africa',
  'Sub-Saharan Africa',
  'South Asia',
  'East Asia',
  'Southeast Asia',
  'Oceania',
];

export function StrangersWisdomModule() {
  const { quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [posts, setPosts] = useState<WisdomPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [postType, setPostType] = useState('lesson');
  const [newCategory, setNewCategory] = useState('Life');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('Harmful or abusive');
  const [notice, setNotice] = useState<string | null>(null);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== 'All') params.set('category', category);
      if (search.trim()) params.set('q', search.trim());
      if (savedOnly) params.set('savedOnly', 'true');
      const res = await apiRequest<{ posts: WisdomPost[] }>(`/wisdom?${params.toString()}`);
      setPosts(res.posts);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to load wisdom posts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPosts();
  }, [category, savedOnly]);

  useEffect(() => {
    if (quickCaptureTarget === 'wisdom') {
      setCreateOpen(true);
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setNotice(null);
    try {
      await apiRequest('/wisdom', {
        method: 'POST',
        body: JSON.stringify({
          postType,
          category: newCategory,
          title: newTitle.trim(),
          content: newContent.trim(),
        }),
      });
      setNewTitle('');
      setNewContent('');
      setCreateOpen(false);
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to publish wisdom post.');
    }
  };

  const handleReact = async (postId: string, reactionType: 'helpful' | 'resonate' | 'save') => {
    setNotice(null);
    try {
      await apiRequest(`/wisdom/${encodeURIComponent(postId)}/react`, {
        method: 'POST',
        body: JSON.stringify({ reactionType }),
      });
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to update reaction.');
    }
  };

  const handleReply = async (postId: string) => {
    const text = (replyDrafts[postId] || '').trim();
    if (!text) return;
    setNotice(null);
    try {
      await apiRequest(`/wisdom/${encodeURIComponent(postId)}/replies`, {
        method: 'POST',
        body: JSON.stringify({ content: text }),
      });
      setReplyDrafts((prev) => ({ ...prev, [postId]: '' }));
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to post reply.');
    }
  };

  const handleBlockAuthor = async (postId: string) => {
    setNotice(null);
    try {
      await apiRequest('/community/block', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'wisdom', targetId: postId }),
      });
      setNotice('Author muted from your feed without revealing their identity.');
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to mute author.');
    }
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTargetId) return;
    setNotice(null);
    try {
      await apiRequest('/community/report', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'wisdom', targetId: reportTargetId, reason: reportReason }),
      });
      setReportTargetId(null);
      setNotice('Report submitted for moderation review.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to submit report.');
    }
  };

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">Stranger&apos;s Wisdom</h1>
          <p className="text-sm text-ink-muted">
            Anonymous questions, hard-earned lessons, and quiet counsel — no followers, no rankings, no exposed identities.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-violet-300 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          Share Anonymously
        </button>
      </div>

      {notice && (
        <div className="rounded-xl border border-violet-400/35 bg-violet-400/10 px-4 py-2.5 text-xs text-violet-800 dark:text-violet-100 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-violet-700 dark:text-violet-200 hover:underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Category Controls */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between min-w-0 w-full">
        <div className="w-full min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {WISDOM_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                category === cat
                  ? 'bg-violet-400 text-slate-950 font-semibold'
                  : 'bg-surface border border-hairline text-ink-secondary hover:text-ink'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 min-w-0 w-full lg:w-auto shrink-0">
          <div className="relative flex-1 min-w-0 sm:w-52">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void loadPosts()}
              placeholder="Search wisdom..."
              className="w-full rounded-xl border border-hairline-strong bg-surface pl-8 pr-3 py-2 text-xs text-ink"
            />
          </div>
          <button
            type="button"
            onClick={() => setSavedOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 ${
              savedOnly
                ? 'border-violet-400/50 bg-violet-400/15 text-violet-700 dark:text-violet-200'
                : 'border-hairline-strong bg-surface text-ink-secondary'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" /> Saved
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-tint animate-pulse" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-10 text-center text-sm text-ink-muted">
          No wisdom posts match this filter yet.
        </div>
      ) : (
        <div className="space-y-5">
          {posts.map((p) => (
            <article key={p.id} className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 space-y-4 min-w-0">
              <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
                <div>
                  <span className="text-violet-700 dark:text-violet-300 font-medium">{p.anonymousHandle}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{p.postType}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{p.category}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono tabular-nums">{new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                {!p.isMine && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReportTargetId(p.id)}
                      title="Report content"
                      className="text-ink-muted hover:text-amber-600 dark:hover:text-amber-300 p-1"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBlockAuthor(p.id)}
                      title="Block anonymous account"
                      className="text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 p-1"
                    >
                      <ShieldBan className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <h2 className="font-display text-xl font-bold text-ink">{p.title}</h2>
              <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap">{p.content}</p>

              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => void handleReact(p.id, 'helpful')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    p.userHelpful ? 'bg-violet-400/20 text-violet-800 dark:text-violet-200' : 'bg-tint text-ink-secondary hover:bg-tint-hover'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${p.userHelpful ? 'fill-current' : ''}`} />
                  Helpful ({p.helpfulCount})
                </button>
                <button
                  type="button"
                  onClick={() => void handleReact(p.id, 'resonate')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    p.userResonate ? 'bg-sky-400/20 text-sky-800 dark:text-sky-200' : 'bg-tint text-ink-secondary hover:bg-tint-hover'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Resonates ({p.resonateCount})
                </button>
                <button
                  type="button"
                  onClick={() => void handleReact(p.id, 'save')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    p.userSaved ? 'bg-amber-400/20 text-amber-800 dark:text-amber-200' : 'bg-tint text-ink-secondary hover:bg-tint-hover'
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${p.userSaved ? 'fill-current' : ''}`} />
                  {p.userSaved ? 'Saved' : 'Save'}
                </button>
              </div>

              {/* Replies */}
              <div className="space-y-3 pt-2">
                {p.replies.map((r) => (
                  <div key={r.id} className="rounded-xl border border-hairline bg-inset p-3.5 space-y-1">
                    <div className="text-[11px] text-ink-muted">
                      <span className="text-violet-700 dark:text-violet-300">{r.anonymousHandle}</span> · {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                    <p className="text-xs text-ink-secondary leading-relaxed">{r.content}</p>
                  </div>
                ))}

                <div className="flex gap-2 min-w-0">
                  <input
                    type="text"
                    value={replyDrafts[p.id] || ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && void handleReply(p.id)}
                    placeholder="Offer an anonymous, thoughtful reply..."
                    className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-xs text-ink placeholder:text-ink-muted"
                  />
                  <button
                    type="button"
                    onClick={() => void handleReply(p.id)}
                    className="inline-flex items-center gap-1 rounded-xl bg-tint-hover px-3.5 py-2 text-xs font-medium text-ink hover:opacity-85 shrink-0 border border-hairline"
                  >
                    <Send className="w-3.5 h-3.5" /> Reply
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="w-full max-w-lg rounded-2xl border border-hairline-strong bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">Share Anonymous Wisdom</h2>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={postType}
                onChange={(e) => setPostType(e.target.value)}
                className="rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink"
              >
                <option value="lesson">Life Lesson</option>
                <option value="question">Ask a Question</option>
                <option value="experience">Experience</option>
                <option value="advice">Advice</option>
              </select>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink"
              >
                {WISDOM_CATEGORIES.filter((c) => c !== 'All').map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title or question..."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />
            <textarea
              required
              rows={5}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Share honestly. Your name, email, and user ID are never revealed."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-xs text-ink-secondary">
                Cancel
              </button>
              <button type="submit" className="rounded-xl bg-violet-400 px-5 py-2 text-xs font-semibold text-slate-950">
                Post Anonymously
              </button>
            </div>
          </form>
        </div>
      )}

      {reportTargetId && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleReport} className="w-full max-w-sm rounded-2xl border border-hairline-strong bg-surface p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-ink">Report Content</h3>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink"
            >
              <option>Harmful or abusive</option>
              <option>Spam or solicitation</option>
              <option>Personal identifying info</option>
              <option>Other</option>
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReportTargetId(null)} className="px-3 py-1.5 text-xs text-ink-secondary">
                Cancel
              </button>
              <button type="submit" className="rounded-xl bg-amber-400 px-4 py-1.5 text-xs font-semibold text-slate-950">
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function HumanityFeedModule() {
  const { quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [posts, setPosts] = useState<HumanityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [showMap, setShowMap] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('Kindness');
  const [newRegion, setNewRegion] = useState('Global');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== 'All') params.set('category', category);
      if (search.trim()) params.set('q', search.trim());
      if (savedOnly) params.set('savedOnly', 'true');
      const res = await apiRequest<{ posts: HumanityPost[] }>(`/humanity?${params.toString()}`);
      setPosts(res.posts);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to load humanity stories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPosts();
  }, [category, savedOnly]);

  useEffect(() => {
    if (quickCaptureTarget === 'humanity') {
      setCreateOpen(true);
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setNotice(null);
    try {
      await apiRequest('/humanity', {
        method: 'POST',
        body: JSON.stringify({
          category: newCategory,
          approxRegion: newRegion,
          title: newTitle.trim(),
          content: newContent.trim(),
        }),
      });
      setNewTitle('');
      setNewContent('');
      setCreateOpen(false);
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to publish story.');
    }
  };

  const handleReact = async (postId: string, reactionType: 'helpful' | 'save') => {
    setNotice(null);
    try {
      await apiRequest(`/humanity/${encodeURIComponent(postId)}/react`, {
        method: 'POST',
        body: JSON.stringify({ reactionType }),
      });
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to update reaction.');
    }
  };

  const handleReply = async (postId: string) => {
    const text = (replyDrafts[postId] || '').trim();
    if (!text) return;
    setNotice(null);
    try {
      await apiRequest(`/humanity/${encodeURIComponent(postId)}/replies`, {
        method: 'POST',
        body: JSON.stringify({ content: text }),
      });
      setReplyDrafts((prev) => ({ ...prev, [postId]: '' }));
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to send reply.');
    }
  };

  const handleBlock = async (postId: string) => {
    setNotice(null);
    try {
      await apiRequest('/community/block', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'humanity', targetId: postId }),
      });
      setNotice('Story author blocked from your feed.');
      await loadPosts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to block author.');
    }
  };

  const handleReport = async (postId: string) => {
    setNotice(null);
    try {
      await apiRequest('/community/report', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'humanity', targetId: postId, reason: 'Community review requested' }),
      });
      setNotice('Story flagged for moderation.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to submit report.');
    }
  };

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div className="relative overflow-hidden rounded-2xl border border-hairline bg-[#0D1424] w-full">
        <SafeImage
          src="/src/assets/images/echo_humanity_lanterns_1795260972998.jpg"
          alt="Warm paper lanterns floating above a calm harbor at night"
          className="absolute inset-0 w-full h-full object-cover opacity-35"
        />
        <div className="relative z-10 bg-gradient-to-r from-[#070B14]/95 via-[#070B14]/80 to-[#070B14]/55 p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
          <div className="space-y-1.5 max-w-xl min-w-0">
            <p className="text-xs font-medium text-teal-300">Global Anonymous Storytelling</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Humanity Feed</h1>
            <p className="text-sm text-slate-300">
              Quiet moments of kindness, endurance, and hope shared anonymously across approximate world regions — never exact locations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowMap((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#070B14]/80 px-3.5 py-2.5 text-xs font-medium text-teal-200 hover:bg-white/10 whitespace-nowrap"
            >
              <Globe className="w-4 h-4" />
              {showMap ? 'Hide World Map' : 'World Map'}
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-400 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-teal-300 whitespace-nowrap min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              Share Story
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-teal-400/35 bg-teal-400/10 px-4 py-2.5 text-xs text-teal-800 dark:text-teal-100 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {/* Global Discovery Map (Approximate Regions Only) */}
      {showMap && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5 space-y-3 overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-teal-700 dark:text-teal-300">Global Discovery Map (Approximate Regions Only)</span>
            <span className="text-ink-muted font-mono tabular-nums shrink-0">{posts.length} stories visible</span>
          </div>
          <div className="rounded-xl border border-hairline bg-[#070B14] p-2 sm:p-3 overflow-hidden">
            <svg viewBox="0 0 800 320" className="w-full h-40 sm:h-64 block">
              {[-60, -30, 0, 30, 60].map((lat) => {
                const y = ((90 - lat) / 180) * 320;
                return <line key={lat} x1="0" y1={y} x2="800" y2={y} stroke="rgba(45,212,191,0.12)" strokeDasharray="3 4" />;
              })}
              {posts.map((p) => {
                const lat = p.approxLat ?? 20;
                const lng = p.approxLng ?? 0;
                const x = ((lng + 180) / 360) * 800;
                const y = ((90 - lat) / 180) * 320;
                return (
                  <g key={p.id}>
                    <circle cx={x} cy={y} r="12" fill="rgba(45,212,191,0.18)" />
                    <circle cx={x} cy={y} r="4.5" fill="#2DD4BF" />
                    <text x={x + 8} y={y + 4} fill="#CBD5E1" fontSize="10">
                      {p.approxRegion}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between min-w-0 w-full">
        <div className="w-full min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {HUMANITY_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                category === cat
                  ? 'bg-teal-400 text-slate-950 font-semibold'
                  : 'bg-surface border border-hairline text-ink-secondary hover:text-ink'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 min-w-0 w-full lg:w-auto shrink-0">
          <div className="relative flex-1 min-w-0 sm:w-52">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void loadPosts()}
              placeholder="Search stories..."
              className="w-full rounded-xl border border-hairline-strong bg-surface pl-8 pr-3 py-2 text-xs text-ink"
            />
          </div>
          <button
            type="button"
            onClick={() => setSavedOnly((s) => !s)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 ${
              savedOnly ? 'border-teal-400/50 bg-teal-400/15 text-teal-800 dark:text-teal-200' : 'border-hairline-strong bg-surface text-ink-secondary'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" /> Saved
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-44 rounded-2xl bg-tint animate-pulse" />
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-10 text-center space-y-3">
          <Globe className="w-8 h-8 text-teal-600 dark:text-teal-300 mx-auto" />
          <h2 className="font-display text-lg font-semibold text-ink">No stories match this filter yet</h2>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            Share an anonymous act of kindness, small achievement, or meaningful encounter from your region.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-w-0">
          {posts.map((p) => (
            <article key={p.id} className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 flex flex-col justify-between space-y-4 min-w-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <div>
                    <span className="text-teal-700 dark:text-teal-300 font-medium">{p.anonymousHandle}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{p.category}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{p.approxRegion}</span>
                  </div>
                  {!p.isMine && (
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => void handleReport(p.id)} className="text-ink-muted hover:text-amber-600 dark:hover:text-amber-300 p-1">
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => void handleBlock(p.id)} className="text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 p-1">
                        <ShieldBan className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <h2 className="font-display text-lg font-bold text-ink">{p.title}</h2>
                <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap">{p.content}</p>
              </div>

              <div className="space-y-3 pt-3 border-t border-hairline">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReact(p.id, 'helpful')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                      p.userHelpful ? 'bg-teal-400/20 text-teal-800 dark:text-teal-200' : 'bg-tint text-ink-secondary hover:bg-tint-hover'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${p.userHelpful ? 'fill-current' : ''}`} />
                    Helpful ({p.helpfulCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReact(p.id, 'save')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                      p.userSaved ? 'bg-amber-400/20 text-amber-800 dark:text-amber-200' : 'bg-tint text-ink-secondary hover:bg-tint-hover'
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${p.userSaved ? 'fill-current' : ''}`} />
                    {p.userSaved ? 'Saved' : 'Save'}
                  </button>
                  <span className="ml-auto text-xs text-ink-muted inline-flex items-center gap-1">
                    <MessageCircle className="w-3.5 h-3.5" /> {p.replies.length}
                  </span>
                </div>

                {p.replies.map((r) => (
                  <div key={r.id} className="rounded-xl border border-hairline bg-inset p-3 text-xs text-ink-secondary">
                    <span className="text-teal-700 dark:text-teal-300 font-medium">{r.anonymousHandle}: </span>
                    {r.content}
                  </div>
                ))}

                <div className="flex gap-2 min-w-0">
                  <input
                    type="text"
                    value={replyDrafts[p.id] || ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && void handleReply(p.id)}
                    placeholder="Send a warm anonymous note..."
                    className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => void handleReply(p.id)}
                    className="rounded-xl bg-tint-hover border border-hairline px-3 py-2 text-xs text-ink hover:opacity-85 shrink-0"
                  >
                    Reply
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="w-full max-w-lg rounded-2xl border border-hairline-strong bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">Share to Humanity Feed</h2>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink"
              >
                {HUMANITY_CATEGORIES.filter((c) => c !== 'All').map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={newRegion}
                onChange={(e) => setNewRegion(e.target.value)}
                className="rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink"
              >
                {APPROX_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Moment headline..."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />
            <textarea
              required
              rows={5}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Share a human experience, act of kindness, or reflection..."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-xs text-ink-secondary">
                Cancel
              </button>
              <button type="submit" className="rounded-xl bg-teal-400 px-5 py-2 text-xs font-semibold text-slate-950">
                Publish Anonymously
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
