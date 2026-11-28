import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  MessageSquare,
  Repeat,
  Search,
  Send,
  ShieldBan,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import type { ExchangeMessage, SkillExchange, SkillProfile } from '../types/echo';

export function SkillSwapModule() {
  const { user, lastWsEvent, quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [tab, setTab] = useState<'discover' | 'exchanges' | 'profile'>('discover');
  const [myProfile, setMyProfile] = useState<SkillProfile | null>(null);
  const [listings, setListings] = useState<SkillProfile[]>([]);
  const [exchanges, setExchanges] = useState<SkillExchange[]>([]);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('All');

  // My Skill Profile editor state
  const [teachInput, setTeachInput] = useState('');
  const [learnInput, setLearnInput] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('Intermediate');
  const [bio, setBio] = useState('');
  const [languagesInput, setLanguagesInput] = useState('English');
  const [availability, setAvailability] = useState('Weekends & Evenings');
  const [mode, setMode] = useState('Online & In-Person');
  const [locationCity, setLocationCity] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [interestsInput, setInterestsInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Request modal
  const [requestTarget, setRequestTarget] = useState<SkillProfile | null>(null);
  const [offeredSkill, setOfferedSkill] = useState('');
  const [requestedSkill, setRequestedSkill] = useState('');
  const [requestMsg, setRequestMsg] = useState('');

  // Chat & Schedule drawer
  const [activeExchange, setActiveExchange] = useState<SkillExchange | null>(null);
  const [chatMessages, setChatMessages] = useState<ExchangeMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [scheduleInput, setScheduleInput] = useState('');
  const [scheduleNotes, setScheduleNotes] = useState('');
  const [rating, setRating] = useState(5);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const loadAll = async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (modeFilter !== 'All') params.set('mode', modeFilter);

    try {
      const [profRes, discRes, exRes] = await Promise.all([
        apiRequest<{ profile: SkillProfile }>('/skills/profile'),
        apiRequest<{ listings: SkillProfile[] }>(`/skills/discover?${params.toString()}`),
        apiRequest<{ exchanges: SkillExchange[] }>('/skills/exchanges'),
      ]);

      setMyProfile(profRes.profile);
      setTeachInput(profRes.profile.teachSkills.join(', '));
      setLearnInput(profRes.profile.learnSkills.join(', '));
      setExperienceLevel(profRes.profile.experienceLevel);
      setBio(profRes.profile.bio);
      setLanguagesInput(profRes.profile.languages.join(', '));
      setAvailability(profRes.profile.availability);
      setMode(profRes.profile.mode);
      setLocationCity(profRes.profile.locationCity);
      setPortfolioUrl(profRes.profile.portfolioUrl);
      setInterestsInput(profRes.profile.interests.join(', '));

      setListings(discRes.listings);
      setExchanges(exRes.exchanges);
      setActiveExchange((prev) =>
        prev ? exRes.exchanges.find((x) => x.id === prev.id) || prev : null
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to load SkillSwap listings.');
    }
  };

  useEffect(() => {
    void loadAll();
  }, [modeFilter]);

  useEffect(() => {
    if (quickCaptureTarget === 'skill') {
      setTab('profile');
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  // Listen to real-time WebSocket chat messages
  useEffect(() => {
    if (
      lastWsEvent &&
      lastWsEvent.type === 'exchange:message' &&
      activeExchange &&
      lastWsEvent.exchangeId === activeExchange.id &&
      lastWsEvent.message
    ) {
      const incoming = lastWsEvent.message as ExchangeMessage;
      setChatMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
    }
  }, [lastWsEvent, activeExchange?.id]);

  const openExchangeChat = async (ex: SkillExchange) => {
    setActiveExchange(ex);
    setChatInput('');
    setScheduleInput('');
    setScheduleNotes('');
    setFeedbackNote('');
    setNotice(null);
    try {
      const res = await apiRequest<{ messages: ExchangeMessage[] }>(`/skills/exchanges/${encodeURIComponent(ex.id)}/messages`);
      setChatMessages(res.messages);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to load exchange messages.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setNotice(null);
    try {
      const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
      await apiRequest('/skills/profile', {
        method: 'PUT',
        body: JSON.stringify({
          teachSkills: split(teachInput),
          learnSkills: split(learnInput),
          experienceLevel,
          bio,
          languages: split(languagesInput),
          availability,
          mode,
          locationCity,
          portfolioUrl,
          interests: split(interestsInput),
        }),
      });
      setNotice('Skill profile saved and matched against the network.');
      await loadAll();
      setTab('discover');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to save skill profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestTarget) return;
    setNotice(null);
    try {
      await apiRequest('/skills/exchanges', {
        method: 'POST',
        body: JSON.stringify({
          recipientId: requestTarget.userId,
          offeredSkill: offeredSkill.trim(),
          requestedSkill: requestedSkill.trim(),
          message: requestMsg.trim(),
        }),
      });
      setRequestTarget(null);
      setRequestMsg('');
      setNotice('SkillSwap request sent.');
      await loadAll();
      setTab('exchanges');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to send SkillSwap request.');
    }
  };

  const handleExchangeAction = async (
    exchangeId: string,
    action: 'accept' | 'reject' | 'cancel' | 'schedule' | 'confirm_complete' | 'feedback'
  ) => {
    setNotice(null);
    let scheduledIso: string | undefined;
    if (action === 'schedule') {
      const parsedMs = scheduleInput ? Date.parse(scheduleInput) : NaN;
      if (!Number.isFinite(parsedMs)) {
        setNotice('Please choose a valid session date and time.');
        return;
      }
      scheduledIso = new Date(parsedMs).toISOString();
    }

    try {
      await apiRequest(`/skills/exchanges/${encodeURIComponent(exchangeId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          scheduledAt: scheduledIso,
          sessionNotes: scheduleNotes,
          feedbackRating: rating,
          feedbackNote,
        }),
      });
      await loadAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to update exchange.');
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeExchange || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    setNotice(null);
    try {
      const res = await apiRequest<{ message: ExchangeMessage }>(
        `/skills/exchanges/${encodeURIComponent(activeExchange.id)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: text }),
        }
      );
      setChatMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    } catch (err) {
      setChatInput(text);
      setNotice(err instanceof Error ? err.message : 'Unable to send message.');
    }
  };

  const handleBlockUser = async (partnerId: string) => {
    setNotice(null);
    try {
      await apiRequest('/community/block', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'skill_user', userId: partnerId }),
      });
      setNotice('User blocked from your SkillSwap discovery.');
      await loadAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to block user.');
    }
  };

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">SkillSwap</h1>
          <p className="text-sm text-ink-muted">
            Trade knowledge directly with people whose skills complement yours — real-time chat, scheduling, and mutual completion.
          </p>
        </div>
        <div className="w-full sm:w-auto min-w-0 flex items-center gap-1 p-1 rounded-xl bg-surface border border-hairline overflow-x-auto no-scrollbar">
          {[
            { id: 'discover', label: 'Discover Matches' },
            { id: 'exchanges', label: `Exchanges (${exchanges.length})` },
            { id: 'profile', label: 'My Skill Profile' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap ${
                tab === t.id ? 'bg-emerald-400 text-slate-950 font-semibold' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-100 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {/* DISCOVER MATCHES */}
      {tab === 'discover' && (
        <div className="space-y-5">
          {myProfile && myProfile.teachSkills.length === 0 && myProfile.learnSkills.length === 0 && (
            <div className="rounded-2xl border border-emerald-400/35 bg-emerald-400/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-ink">Complete your Skill Profile for automatic mutual matching</div>
                <div className="text-xs text-ink-secondary mt-0.5">
                  Add skills you can teach and skills you want to learn.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTab('profile')}
                className="rounded-xl bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 whitespace-nowrap shrink-0"
              >
                Set Skills
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 min-w-0">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadAll()}
                placeholder="Search by skill or city..."
                className="w-full rounded-xl border border-hairline-strong bg-surface pl-10 pr-4 py-2.5 text-sm text-ink"
              />
            </div>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              className="rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-xs text-ink"
            >
              <option value="All">All Modes</option>
              <option value="Online">Online</option>
              <option value="In-Person">In-Person</option>
            </select>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="rounded-xl border border-hairline-strong bg-surface px-4 py-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            >
              Search
            </button>
          </div>

          {listings.length === 0 ? (
            <div className="rounded-2xl border border-hairline bg-surface p-10 text-center space-y-3">
              <Repeat className="w-8 h-8 text-emerald-600 dark:text-emerald-300 mx-auto" />
              <h2 className="font-display text-lg font-semibold text-ink">No SkillSwap profiles match yet</h2>
              <p className="text-sm text-ink-muted max-w-md mx-auto">
                Publish your own Skill Profile to connect with community members as they join and share what they teach.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {listings.map((person) => (
              <article key={person.userId} className="rounded-2xl border border-hairline bg-surface p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg font-bold text-ink">{person.displayName}</h2>
                      <div className="text-xs text-ink-muted">
                        {person.experienceLevel} · {person.mode}
                        {person.locationCity ? ` · ${person.locationCity}` : ''}
                      </div>
                    </div>
                    {person.isMutualMatch && (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap">
                        <UserCheck className="w-3.5 h-3.5" /> Mutual Match
                      </span>
                    )}
                  </div>

                  {person.bio && <p className="text-xs text-ink-secondary leading-relaxed">{person.bio}</p>}

                  <div className="space-y-2 text-xs pt-1">
                    <div>
                      <span className="text-emerald-700 dark:text-emerald-300 font-medium">Teaches: </span>
                      <span className="text-ink-secondary">{person.teachSkills.join(' · ') || 'None listed'}</span>
                    </div>
                    <div>
                      <span className="text-sky-700 dark:text-sky-300 font-medium">Wants to learn: </span>
                      <span className="text-ink-secondary">{person.learnSkills.join(' · ') || 'None listed'}</span>
                    </div>
                    <div className="text-ink-muted">
                      Languages: {person.languages.join(', ')} · Availability: {person.availability}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-hairline">
                  <button
                    type="button"
                    onClick={() => void handleBlockUser(person.userId)}
                    className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-rose-600 dark:hover:text-rose-300"
                  >
                    <ShieldBan className="w-3.5 h-3.5" /> Block
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRequestTarget(person);
                      setOfferedSkill(person.theyWantWhatITeach?.[0] || myProfile?.teachSkills[0] || '');
                      setRequestedSkill(person.theyTeachWhatIWant?.[0] || person.teachSkills[0] || '');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300"
                  >
                    <Repeat className="w-3.5 h-3.5" /> Propose Exchange
                  </button>
                </div>
              </article>
            ))}
            </div>
          )}
        </div>
      )}

      {/* EXCHANGES & REAL-TIME CHAT */}
      {tab === 'exchanges' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`${activeExchange ? 'lg:col-span-6' : 'lg:col-span-12'} space-y-4`}>
            {exchanges.length === 0 ? (
              <div className="rounded-2xl border border-hairline bg-surface p-10 text-center text-sm text-ink-muted">
                No skill exchanges yet. Discover matches to propose your first trade.
              </div>
            ) : (
              exchanges.map((ex) => {
                const isRequester = ex.requesterId === user?.id;
                const partnerName = isRequester ? ex.recipientName : ex.requesterName;
                const myConfirmed = isRequester ? ex.requesterConfirmed : ex.recipientConfirmed;
                const partnerConfirmed = isRequester ? ex.recipientConfirmed : ex.requesterConfirmed;

                return (
                  <div
                    key={ex.id}
                    className={`rounded-2xl border p-5 space-y-3 ${
                      activeExchange?.id === ex.id
                        ? 'border-emerald-400/50 bg-surface-raised'
                        : 'border-hairline bg-surface'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-ink">{partnerName}</span>
                      <span className="font-mono uppercase text-emerald-700 dark:text-emerald-300">{ex.status}</span>
                    </div>
                    <div className="text-sm text-ink-secondary">
                      {ex.offeredSkill} ↔ {ex.requestedSkill}
                    </div>
                    {ex.message && <p className="text-xs text-ink-muted">"{ex.message}"</p>}
                    {ex.scheduledAt && (
                      <div className="text-xs text-cyan-700 dark:text-cyan-300 font-mono">
                        Scheduled: {new Date(ex.scheduledAt).toLocaleString()}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      {ex.status === 'pending' && !isRequester && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleExchangeAction(ex.id, 'accept')}
                            className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleExchangeAction(ex.id, 'reject')}
                            className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-200"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {['pending', 'accepted', 'scheduled'].includes(ex.status) && (
                        <button
                          type="button"
                          onClick={() => void handleExchangeAction(ex.id, 'cancel')}
                          className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs text-ink-secondary"
                        >
                          Cancel
                        </button>
                      )}

                      {['accepted', 'scheduled'].includes(ex.status) && !myConfirmed && (
                        <button
                          type="button"
                          onClick={() => void handleExchangeAction(ex.id, 'confirm_complete')}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-200"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Completed
                        </button>
                      )}

                      {myConfirmed && ex.status !== 'completed' && (
                        <span className="text-xs text-amber-700 dark:text-amber-300">
                          Waiting for {partnerName} to confirm completion ({partnerConfirmed ? '1/1' : '0/1'})
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => void openExchangeChat(ex)}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-tint-hover border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:opacity-85"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" /> Chat & Session
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* LIVE CHAT & SESSION SCHEDULING PANEL */}
          {activeExchange && (
            <div className="lg:col-span-6 rounded-2xl border border-hairline bg-surface p-6 space-y-5 flex flex-col justify-between h-fit">
              <div className="flex items-center justify-between border-b border-hairline pb-3">
                <div>
                  <h3 className="font-display text-base font-bold text-ink">
                    {activeExchange.requesterId === user?.id ? activeExchange.recipientName : activeExchange.requesterName}
                  </h3>
                  <div className="text-xs text-emerald-700 dark:text-emerald-300">
                    {activeExchange.offeredSkill} ↔ {activeExchange.requestedSkill} · {activeExchange.status}
                  </div>
                </div>
                <button type="button" onClick={() => setActiveExchange(null)} className="text-ink-muted hover:text-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {['accepted', 'scheduled'].includes(activeExchange.status) && (
                <div className="rounded-xl border border-hairline bg-inset p-4 space-y-2.5">
                  <div className="text-xs font-semibold text-ink inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" /> Schedule Session
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="datetime-local"
                      value={scheduleInput}
                      onChange={(e) => setScheduleInput(e.target.value)}
                      className="flex-1 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-xs text-ink font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => void handleExchangeAction(activeExchange.id, 'schedule')}
                      disabled={!scheduleInput}
                      className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-40"
                    >
                      Save Time
                    </button>
                  </div>
                  <input
                    type="text"
                    value={scheduleNotes}
                    onChange={(e) => setScheduleNotes(e.target.value)}
                    placeholder="Meeting link or agenda note..."
                    className="w-full rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-xs text-ink"
                  />
                </div>
              )}

              {activeExchange.status === 'completed' && !activeExchange.feedbackRating && (
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4 space-y-2.5">
                  <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 inline-flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" /> Leave Exchange Feedback
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <select
                      value={rating}
                      onChange={(e) => setRating(Number(e.target.value))}
                      className="rounded-lg border border-hairline-strong bg-inset px-2.5 py-1.5 text-xs text-ink"
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>{n} / 5</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={feedbackNote}
                      onChange={(e) => setFeedbackNote(e.target.value)}
                      placeholder="How was the exchange?"
                      className="flex-1 rounded-lg border border-hairline-strong bg-inset px-3 py-1.5 text-xs text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => void handleExchangeAction(activeExchange.id, 'feedback')}
                      className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {chatMessages.length === 0 ? (
                  <p className="text-xs text-ink-muted text-center py-6">
                    Start chatting in real time to coordinate your skill exchange.
                  </p>
                ) : (
                  chatMessages.map((msg) => {
                    const isMine = msg.sender_id === user?.id;
                    return (
                      <div
                        key={msg.id}
                        className={`rounded-xl px-3.5 py-2.5 text-xs max-w-[85%] ${
                          isMine
                            ? 'ml-auto bg-emerald-500/20 border border-emerald-400/35 text-ink'
                            : 'mr-auto bg-inset border border-hairline-strong text-ink-secondary'
                        }`}
                      >
                        <div className="text-[10px] text-ink-muted mb-0.5">
                          {msg.sender_name} · {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div>{msg.content}</div>
                      </div>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleSendChat} className="flex gap-2 min-w-0">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Write a message..."
                  className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-xs text-ink"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-slate-950 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* MY SKILL PROFILE */}
      {tab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="max-w-2xl rounded-2xl border border-hairline bg-surface p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-ink">Your SkillSwap Profile</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs text-ink-muted block mb-1">Skills you can teach (comma-separated)</label>
              <input
                type="text"
                value={teachInput}
                onChange={(e) => setTeachInput(e.target.value)}
                placeholder="Comma-separated skills you can teach"
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-ink-muted block mb-1">Skills you want to learn (comma-separated)</label>
              <input
                type="text"
                value={learnInput}
                onChange={(e) => setLearnInput(e.target.value)}
                placeholder="Comma-separated skills you want to learn"
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Experience</label>
              <select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2.5 text-sm text-ink"
              >
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
                <option>Mentor</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Preference</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2.5 text-sm text-ink"
              >
                <option>Online & In-Person</option>
                <option>Online</option>
                <option>In-Person</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Languages</label>
              <input
                type="text"
                value={languagesInput}
                onChange={(e) => setLanguagesInput(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">City</label>
              <input
                type="text"
                value={locationCity}
                onChange={(e) => setLocationCity(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Availability</label>
              <input
                type="text"
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Portfolio URL (optional)</label>
              <input
                type="url"
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-ink-muted block mb-1">Interests & Bio</label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-ink-muted block mb-1">Interests (comma-separated)</label>
              <input
                type="text"
                value={interestsInput}
                onChange={(e) => setInterestsInput(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="rounded-xl bg-emerald-400 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300"
          >
            {savingProfile ? 'Saving...' : 'Save Skill Profile'}
          </button>
        </form>
      )}

      {/* PROPOSE EXCHANGE MODAL */}
      {requestTarget && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSendRequest} className="w-full max-w-md rounded-2xl border border-hairline-strong bg-surface p-5 sm:p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">Exchange with {requestTarget.displayName}</h2>
              <button type="button" onClick={() => setRequestTarget(null)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Skill You Offer</label>
              <input
                type="text"
                required
                value={offeredSkill}
                onChange={(e) => setOfferedSkill(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Skill You Want to Learn</label>
              <input
                type="text"
                required
                value={requestedSkill}
                onChange={(e) => setRequestedSkill(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="text-xs text-ink-muted block mb-1">Introduction Message</label>
              <textarea
                rows={3}
                value={requestMsg}
                onChange={(e) => setRequestMsg(e.target.value)}
                placeholder="Introduce yourself and suggest a rough schedule..."
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2 text-sm text-ink"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRequestTarget(null)} className="px-4 py-2 text-xs text-ink-secondary">
                Cancel
              </button>
              <button type="submit" className="rounded-xl bg-emerald-400 px-5 py-2 text-xs font-semibold text-slate-950">
                Send Request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
