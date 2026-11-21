import { useEffect, useState } from 'react';
import { ArrowUpRight, Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import type { AiChatMessage, ModuleId } from '../types/echo';

const SUGGESTED_QUESTIONS = [
  'What was my happiest memory?',
  'What happened this day last year?',
  'What was my biggest dream?',
  'What did I promise myself?',
  'What places did I visit?',
  'Summarize my last year.',
  'What changed in my life?',
  'What did I write about my future?',
];

export function AiMemoryModule() {
  const { user, focusItemId, navigateTo } = useEcho();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await apiRequest<{ messages: AiChatMessage[] }>('/ai/history');
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load AI conversation history.');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (focusItemId && focusItemId.length > 4) {
      setInput(focusItemId);
    }
  }, [focusItemId]);

  const askQuestion = async (questionText: string) => {
    const clean = questionText.trim();
    if (!clean || sending) return;
    setError(null);
    setSending(true);
    setInput('');

    const optimisticUser: AiChatMessage = {
      id: `tmp-${Date.now()}`,
      module: 'memory_ai',
      role: 'user',
      content: clean,
      sources: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await apiRequest<{
        id: string;
        formatted: string;
        followUpQuestions: string[];
        sources: AiChatMessage['sources'];
        createdAt: string;
      }>('/ai/query', {
        method: 'POST',
        body: JSON.stringify({ question: clean }),
      });

      setMessages((prev) => [
        ...prev,
        {
          id: res.id,
          module: 'memory_ai',
          role: 'assistant',
          content: res.formatted,
          sources: res.sources || [],
          createdAt: res.createdAt,
        },
      ]);
      setFollowUps(res.followUpQuestions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ECHO AI query failed.');
    } finally {
      setSending(false);
    }
  };

  const clearHistory = async () => {
    await apiRequest('/ai/history', { method: 'DELETE' });
    setMessages([]);
    setFollowUps([]);
  };

  const sourceKindToModule = (kind: string): ModuleId => {
    if (kind === 'dream') return 'dreams';
    if (kind === 'object') return 'objects';
    if (kind === 'capsule') return 'capsules';
    return 'memories';
  };

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto min-w-0 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">AI Life Memory</h1>
          <p className="text-sm text-slate-400">
            Ask questions about your real memories, dreams, objects, and unlocked capsules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => navigateTo('profile')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#0D1424] px-3.5 py-2 text-xs text-slate-300 hover:text-white whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-300" />
            AI Access: {user?.aiConsent ? 'Enabled' : 'Paused'}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#0D1424] px-3.5 py-2 text-xs text-slate-300 hover:text-rose-200 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear History
            </button>
          )}
        </div>
      </div>

      {!user?.aiConsent && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 text-sm text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span>ECHO AI memory access is turned off in your privacy settings.</span>
          <button
            type="button"
            onClick={() => navigateTo('profile')}
            className="rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-semibold text-slate-950 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            Review Privacy Settings
          </button>
        </div>
      )}

      {/* Prompt Starters */}
      <div className="w-full min-w-0 flex sm:flex-wrap gap-2 overflow-x-auto sm:overflow-visible no-scrollbar pb-1">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => void askQuestion(q)}
            disabled={sending || !user?.aiConsent}
            className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/15 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 sm:whitespace-normal"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Conversation Transcript */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0D1424] p-5 sm:p-6 space-y-5 min-h-[380px] flex flex-col justify-between">
        <div className="space-y-4 overflow-y-auto max-h-[540px] pr-1">
          {loadingHistory ? (
            <div className="h-24 rounded-xl bg-white/[0.04] animate-pulse" />
          ) : messages.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <Sparkles className="w-7 h-7 text-cyan-300 mx-auto" />
              <h2 className="font-display text-lg font-semibold text-white">Grounded in your real life archive</h2>
              <p className="text-sm text-slate-400 max-w-lg mx-auto">
                ECHO AI reads only entries you haven’t excluded, separates stored facts from gentle reflection, and never fabricates memories that aren’t in your database.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl p-4 sm:p-5 space-y-3 ${
                  m.role === 'user'
                    ? 'bg-[#121D34] border border-sky-400/20 ml-auto max-w-2xl'
                    : 'bg-[#070B14] border border-white/[0.08] mr-auto max-w-3xl'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className={m.role === 'assistant' ? 'text-cyan-300 font-medium' : 'text-sky-300 font-medium'}>
                    {m.role === 'assistant' ? 'ECHO AI' : user?.displayName}
                  </span>
                  <span className="font-mono tabular-nums">
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{m.content}</div>

                {m.sources && m.sources.length > 0 && (
                  <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                    <div className="text-xs text-slate-400">Referenced entries from your archive:</div>
                    <div className="flex flex-wrap gap-2">
                      {m.sources.map((src) => (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() => navigateTo(sourceKindToModule(src.kind), src.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-cyan-200 hover:bg-white/[0.08]"
                        >
                          <span>{src.title}</span>
                          {src.date && <span className="text-slate-400 font-mono">({src.date.slice(0, 10)})</span>}
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {sending && (
            <div className="rounded-2xl bg-[#070B14] border border-cyan-500/20 p-4 text-xs text-cyan-200">
              Searching your archive and preparing grounded reflection...
            </div>
          )}
        </div>

        {followUps.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
            {followUps.map((fq) => (
              <button
                key={fq}
                type="button"
                onClick={() => void askQuestion(fq)}
                className="text-xs text-slate-300 hover:text-cyan-200 underline underline-offset-4"
              >
                {fq}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void askQuestion(input);
          }}
          className="flex flex-col sm:flex-row gap-2.5 pt-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending || !user?.aiConsent}
            placeholder="Ask about a memory, person, place, emotion, or year..."
            className="flex-1 min-w-0 rounded-xl border border-white/10 bg-[#070B14] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || !user?.aiConsent}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
          >
            <Send className="w-4 h-4" />
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
