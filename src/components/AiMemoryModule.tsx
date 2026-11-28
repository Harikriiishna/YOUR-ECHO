import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  FileAudio,
  History,
  Loader2,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest, uploadMediaFile } from '../lib/api';
import { startBrowserSpeechCapture, type LiveSpeechCaptureSession } from '../lib/browserSpeech';
import type { AiChatMessage, MemoryItem, ModuleId } from '../types/echo';
import { AuthMedia } from './MediaElements';

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

type VoicePhase = 'idle' | 'recording' | 'uploading' | 'transcribing' | 'saving';

interface RecentSearchItem {
  query: string;
  searchedAt: string;
  sourceCount: number;
}

const MAX_RECENT_SEARCHES = 8;

function getRecentSearchesKey(userId?: string | null): string {
  return `echo.ai.recentSearches.${userId || 'guest'}`;
}

function loadRecentSearches(storageKey: string): RecentSearchItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentSearchItem =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as RecentSearchItem).query === 'string' &&
          (entry as RecentSearchItem).query.trim().length > 0
      )
      .slice(0, MAX_RECENT_SEARCHES)
      .map((entry) => ({
        query: entry.query.trim(),
        searchedAt: typeof entry.searchedAt === 'string' ? entry.searchedAt : new Date().toISOString(),
        sourceCount: typeof entry.sourceCount === 'number' && Number.isFinite(entry.sourceCount) ? entry.sourceCount : 0,
      }));
  } catch {
    return [];
  }
}

function persistRecentSearches(storageKey: string, items: RecentSearchItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items.slice(0, MAX_RECENT_SEARCHES)));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

function formatRelativeSearchTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diffMins = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pickSupportedAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionForMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a')) return 'mp4';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return 'webm';
}

function deriveTitleFromTranscript(transcript: string): string {
  const cleaned = transcript.replace(/\s+/g, ' ').trim();
  if (!cleaned) return `Spoken Memory (${new Date().toLocaleDateString('en-CA')})`;
  const words = cleaned.split(' ').slice(0, 7).join(' ');
  return words.length < cleaned.length ? `${words}...` : words;
}

export function AiMemoryModule() {
  const { user, focusItemId, isOnline, queueMutation, navigateTo } = useEcho();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const recentSearchesKey = getRecentSearchesKey(user?.id);
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>(() =>
    loadRecentSearches(getRecentSearchesKey(user?.id))
  );

  // Microphone Spoken Memory Capture State
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(() => Array(12).fill(0.18));
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [savedVoiceMemory, setSavedVoiceMemory] = useState<MemoryItem | null>(null);
  const [liveSpeechPreview, setLiveSpeechPreview] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelledRef = useRef(false);
  const speechCaptureRef = useRef<LiveSpeechCaptureSession | null>(null);
  const liveTranscriptRef = useRef<string>('');

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
    setRecentSearches(loadRecentSearches(recentSearchesKey));
  }, [recentSearchesKey]);

  useEffect(() => {
    if (focusItemId && focusItemId.length > 4) {
      setInput(focusItemId);
    }
  }, [focusItemId]);

  const cleanupRecordingResources = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setAudioLevels(Array(12).fill(0.18));
  };

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      speechCaptureRef.current?.cancel();
      speechCaptureRef.current = null;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore cleanup stop errors
        }
      }
      cleanupRecordingResources();
    };
  }, []);

  const processAudioAndSaveMemory = async (
    audioBlob: Blob,
    filename: string,
    browserTranscript = ''
  ) => {
    setVoiceError(null);
    setSavedVoiceMemory(null);

    try {
      setVoicePhase('uploading');
      const uploaded = await uploadMediaFile(audioBlob, filename, 'memory');

      setVoicePhase('transcribing');
      let serverTranscript = '';
      try {
        const tr = await apiRequest<{ transcript: string }>('/ai/transcribe', {
          method: 'POST',
          body: JSON.stringify({ mediaId: uploaded.id }),
        });
        serverTranscript = (tr.transcript || '').trim();
      } catch {
        // Fallback smoothly to browser speech capture or saved audio memory note
      }

      const memoryDate = new Date().toLocaleDateString('en-CA');
      const rawTranscript = (serverTranscript || browserTranscript).trim();
      const transcript =
        rawTranscript ||
        `Voice memory recorded on ${memoryDate}. Listen to the attached audio recording below.`;

      setVoicePhase('saving');
      let generatedTitle = rawTranscript
        ? deriveTitleFromTranscript(rawTranscript)
        : `Spoken Memory (${memoryDate})`;
      let generatedSummary = '';

      if (user?.aiConsent && rawTranscript) {
        try {
          const assist = await apiRequest<{ title?: string; summary?: string }>('/ai/assist', {
            method: 'POST',
            body: JSON.stringify({ mode: 'title_and_summary', text: rawTranscript }),
          });
          if (assist.title?.trim()) generatedTitle = assist.title.trim();
          if (assist.summary?.trim()) generatedSummary = assist.summary.trim();
        } catch {
          // Keep derived title if AI title assist fails
        }
      }

      const payload = {
        title: generatedTitle,
        content: transcript,
        memoryDate,
        locationName: user?.locationHint || '',
        latitude: null,
        longitude: null,
        mood: 'Reflective',
        category: 'Important moments',
        aiExcluded: false,
        aiSummary: generatedSummary,
        collectionId: null,
        tags: ['voice-memory', 'spoken'],
        people: [],
        mediaIds: [uploaded.id],
        autoAnalyzeSentiment: Boolean(user?.aiConsent),
      };

      if (!isOnline) {
        await queueMutation({
          endpoint: '/memories',
          payload,
          label: `Spoken Memory: ${generatedTitle}`,
        });
        setVoiceError('Saved offline — your transcribed spoken memory will sync when reconnected.');
        setVoicePhase('idle');
        return;
      }

      const saved = await apiRequest<{ memory: MemoryItem }>('/memories', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setSavedVoiceMemory(saved.memory);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Unable to transcribe and save spoken memory.');
    } finally {
      setVoicePhase('idle');
    }
  };

  const startVoiceMemoryRecording = async () => {
    if (voicePhase !== 'idle') return;
    setVoiceError(null);
    setSavedVoiceMemory(null);
    cancelledRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Microphone recording is not supported in this browser. Use Upload Audio below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const capturedSpeech = speechCaptureRef.current?.stop() || '';
        speechCaptureRef.current = null;
        liveTranscriptRef.current = capturedSpeech;
        setLiveSpeechPreview('');
        cleanupRecordingResources();

        if (cancelledRef.current) {
          setVoicePhase('idle');
          return;
        }
        if (blob.size === 0) {
          setVoiceError('Recording was empty. Please speak for a moment before stopping.');
          setVoicePhase('idle');
          return;
        }

        const ext = extensionForMime(finalMime);
        void processAudioAndSaveMemory(
          blob,
          `spoken-memory-${Date.now()}.${ext}`,
          capturedSpeech
        );
      };

      // Live audio level meter
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 32;
          source.connect(analyser);
          const bins = new Uint8Array(analyser.frequencyBinCount);

          const updateLevels = () => {
            if (!audioCtxRef.current) return;
            analyser.getByteFrequencyData(bins);
            const nextLevels = Array.from({ length: 12 }, (_, idx) => {
              const val = bins[idx % bins.length] ?? 0;
              return Math.max(0.18, Math.min(1, val / 180));
            });
            setAudioLevels(nextLevels);
            rafRef.current = window.requestAnimationFrame(updateLevels);
          };
          rafRef.current = window.requestAnimationFrame(updateLevels);
        }
      } catch {
        // Waveform visual is optional; recording proceeds normally
      }

      recorderRef.current = recorder;
      liveTranscriptRef.current = '';
      setLiveSpeechPreview('');
      recorder.start(250);
      speechCaptureRef.current = startBrowserSpeechCapture({
        onInterim: (transcript) => setLiveSpeechPreview(transcript),
      });
      setRecordSeconds(0);
      setVoicePhase('recording');
      timerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      speechCaptureRef.current?.cancel();
      speechCaptureRef.current = null;
      cleanupRecordingResources();
      setVoiceError('Microphone access was denied or unavailable. You can upload an audio file instead.');
      setVoicePhase('idle');
    }
  };

  const stopAndSaveVoiceRecording = () => {
    cancelledRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      cleanupRecordingResources();
      setVoicePhase('idle');
    }
  };

  const cancelVoiceRecording = () => {
    cancelledRef.current = true;
    speechCaptureRef.current?.cancel();
    speechCaptureRef.current = null;
    liveTranscriptRef.current = '';
    setLiveSpeechPreview('');
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      cleanupRecordingResources();
      setVoicePhase('idle');
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || voicePhase !== 'idle') return;
    await processAudioAndSaveMemory(file, file.name);
  };

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
      const nextEntry: RecentSearchItem = {
        query: clean,
        searchedAt: res.createdAt || new Date().toISOString(),
        sourceCount: (res.sources || []).length,
      };
      setRecentSearches((prev) => {
        const filtered = prev.filter((item) => item.query.toLowerCase() !== clean.toLowerCase());
        const updated = [nextEntry, ...filtered].slice(0, MAX_RECENT_SEARCHES);
        persistRecentSearches(recentSearchesKey, updated);
        return updated;
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setInput((prev) => prev || clean);
      setError(err instanceof Error ? err.message : 'ECHO AI query failed.');
    } finally {
      setSending(false);
    }
  };

  const removeRecentSearch = (queryToRemove: string) => {
    setRecentSearches((prev) => {
      const updated = prev.filter((item) => item.query.toLowerCase() !== queryToRemove.toLowerCase());
      persistRecentSearches(recentSearchesKey, updated);
      return updated;
    });
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(recentSearchesKey);
      } catch {
        // Ignore storage errors
      }
    }
  };

  const clearHistory = async () => {
    setError(null);
    try {
      await apiRequest('/ai/history', { method: 'DELETE' });
      setMessages([]);
      setFollowUps([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear AI conversation history.');
    }
  };

  const sourceKindToModule = (kind: string): ModuleId => {
    if (kind === 'dream') return 'dreams';
    if (kind === 'object') return 'objects';
    if (kind === 'capsule') return 'capsules';
    return 'memories';
  };

  const mm = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
  const ss = String(recordSeconds % 60).padStart(2, '0');
  const isBusyVoice = voicePhase !== 'idle';

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto min-w-0 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">AI Life Memory</h1>
          <p className="text-sm text-ink-muted">
            Ask questions about your archive or speak a memory aloud to auto-transcribe and save it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0">
          {voicePhase === 'recording' ? (
            <button
              type="button"
              onClick={stopAndSaveVoiceRecording}
              className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl border border-rose-500/45 bg-rose-500/20 px-3.5 py-2 text-xs font-semibold text-rose-700 dark:text-rose-200 hover:bg-rose-500/30 whitespace-nowrap shrink-0 min-h-[38px]"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop & Save ({mm}:{ss})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startVoiceMemoryRecording()}
              disabled={isBusyVoice}
              className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[38px]"
            >
              {isBusyVoice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              {voicePhase === 'idle' ? 'Record Spoken Memory' : 'Processing...'}
            </button>
          )}

          <label className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink-secondary hover:text-ink cursor-pointer whitespace-nowrap shrink-0 min-h-[38px]">
            <FileAudio className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
            Upload Audio
            <input
              type="file"
              accept="audio/*"
              disabled={isBusyVoice}
              onChange={(e) => void handleAudioFileUpload(e)}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => navigateTo('profile')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs text-ink-secondary hover:text-ink whitespace-nowrap shrink-0 min-h-[38px]"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
            AI Access: {user?.aiConsent ? 'Enabled' : 'Paused'}
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs text-ink-secondary hover:text-rose-600 dark:hover:text-rose-200 whitespace-nowrap shrink-0 min-h-[38px]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear History
            </button>
          )}
        </div>
      </div>

      {/* Live Microphone Recording & Auto-Transcription Studio Panel */}
      {isBusyVoice && (
        <div className="rounded-2xl border border-cyan-500/35 bg-surface-raised p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                voicePhase === 'recording'
                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 animate-pulse'
                  : 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'
              }`}
            >
              {voicePhase === 'recording' ? (
                <Mic className="w-5 h-5" />
              ) : (
                <Loader2 className="w-5 h-5 animate-spin" />
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-ink">
                  {voicePhase === 'recording' && 'Recording spoken memory...'}
                  {voicePhase === 'uploading' && 'Uploading voice recording...'}
                  {voicePhase === 'transcribing' && 'Processing voice capture...'}
                  {voicePhase === 'saving' && 'Generating title & saving to ECHO Memory...'}
                </span>
                {voicePhase === 'recording' && (
                  <span className="font-mono text-xs font-semibold text-rose-600 dark:text-rose-300 tabular-nums">
                    {mm}:{ss}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                {voicePhase === 'recording'
                  ? 'Speak naturally about your moment, people, or feelings. Stop when done to transcribe and save automatically.'
                  : 'Please keep this tab open while your spoken memory is processed and archived.'}
              </p>
              {voicePhase === 'recording' && liveSpeechPreview && (
                <p className="text-xs text-cyan-700 dark:text-cyan-200 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-2.5 py-1.5 italic line-clamp-2">
                  “{liveSpeechPreview}”
                </p>
              )}
            </div>
          </div>

          {voicePhase === 'recording' && (
            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
              <div className="flex items-center gap-1 h-7 px-2" aria-hidden="true">
                {audioLevels.map((lvl, idx) => (
                  <span
                    key={idx}
                    className="w-1 rounded-sm bg-cyan-500 dark:bg-cyan-300 transition-all duration-75"
                    style={{ height: `${Math.round(lvl * 24)}px` }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={cancelVoiceRecording}
                className="touch-manipulation inline-flex items-center gap-1 rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink-secondary hover:text-ink"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                type="button"
                onClick={stopAndSaveVoiceRecording}
                className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop & Save
              </button>
            </div>
          )}
        </div>
      )}

      {voiceError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-3">
          <span>{voiceError}</span>
          <button type="button" onClick={() => setVoiceError(null)} className="shrink-0 hover:opacity-80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Newly Saved Spoken Memory Confirmation Card */}
      {savedVoiceMemory && (
        <div className="rounded-2xl border border-emerald-500/35 bg-surface-raised p-4 sm:p-5 space-y-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Spoken Memory Transcribed & Saved
                </div>
                <h2 className="font-display text-base sm:text-lg font-bold text-ink truncate">
                  {savedVoiceMemory.title}
                </h2>
                <div className="text-[11px] font-mono text-ink-muted">
                  {savedVoiceMemory.memoryDate} · {savedVoiceMemory.category} · {savedVoiceMemory.mood}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSavedVoiceMemory(null)}
              aria-label="Dismiss saved memory notice"
              className="text-ink-muted hover:text-ink shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap rounded-xl border border-hairline bg-inset p-3.5">
            {savedVoiceMemory.content}
          </p>

          {savedVoiceMemory.aiSummary && (
            <p className="text-xs text-ink-muted">
              <span className="font-semibold text-ink-secondary">Summary:</span> {savedVoiceMemory.aiSummary}
            </p>
          )}

          {savedVoiceMemory.media.length > 0 && (
            <AuthMedia
              mediaId={savedVoiceMemory.media[0].id}
              mimeTypeHint={savedVoiceMemory.media[0].mime_type || savedVoiceMemory.media[0].mimeType}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => navigateTo('memories', savedVoiceMemory.id)}
              className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl bg-sky-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Open in ECHO Memory
            </button>
            {user?.aiConsent && (
              <button
                type="button"
                onClick={() =>
                  void askQuestion(
                    `Reflect on my newly recorded spoken memory titled "${savedVoiceMemory.title}".`
                  )
                }
                disabled={sending}
                className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3.5 py-2 text-xs font-medium text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Ask AI About This Memory
              </button>
            )}
          </div>
        </div>
      )}

      {!user?.aiConsent && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 text-sm text-amber-800 dark:text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 sm:whitespace-normal"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Recent Searches (saved locally in browser storage) */}
      <section aria-label="Recent searches" className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
            <History className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300 shrink-0" />
            <span>Recent Searches</span>
            {recentSearches.length > 0 && (
              <>
                <span aria-hidden="true" className="text-ink-muted">·</span>
                <span className="font-mono tabular-nums text-ink-muted">{recentSearches.length}</span>
              </>
            )}
          </div>
          {recentSearches.length > 0 && (
            <button
              type="button"
              onClick={clearRecentSearches}
              className="text-xs text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 transition-colors whitespace-nowrap shrink-0"
            >
              Clear recent
            </button>
          )}
        </div>

        {recentSearches.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Your past reflection queries are saved locally in this browser for quick one-click recall.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((item) => {
              const relTime = formatRelativeSearchTime(item.searchedAt);
              return (
                <div
                  key={item.query}
                  className="inline-flex items-center max-w-full rounded-lg border border-hairline-strong bg-surface hover:bg-surface-raised transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => void askQuestion(item.query)}
                    disabled={sending || !user?.aiConsent}
                    title={`Run recent query: ${item.query}`}
                    className="touch-manipulation min-w-0 min-h-[40px] sm:min-h-[34px] flex items-center gap-2 pl-3 pr-2 py-1.5 text-left text-xs text-ink hover:text-cyan-700 dark:hover:text-cyan-200 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-l-lg"
                  >
                    <span className="truncate max-w-[200px] sm:max-w-[280px] font-medium">
                      {item.query}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-ink-muted whitespace-nowrap shrink-0">
                      {item.sourceCount > 0 ? `${item.sourceCount} src` : ''}
                      {item.sourceCount > 0 && relTime ? ' · ' : ''}
                      {relTime}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRecentSearch(item.query)}
                    aria-label={`Remove "${item.query}" from recent searches`}
                    title="Remove from recent searches"
                    className="touch-manipulation min-h-[40px] sm:min-h-[34px] inline-flex items-center justify-center px-2.5 text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-r-lg"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Conversation Transcript */}
      <div className="rounded-2xl border border-hairline bg-surface p-5 sm:p-6 space-y-5 min-h-[380px] flex flex-col justify-between">
        <div className="space-y-4 overflow-y-auto max-h-[540px] pr-1">
          {loadingHistory ? (
            <div className="h-24 rounded-xl bg-tint animate-pulse" />
          ) : messages.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <Sparkles className="w-7 h-7 text-cyan-600 dark:text-cyan-300 mx-auto" />
              <h2 className="font-display text-lg font-semibold text-ink">Grounded in your real life archive</h2>
              <p className="text-sm text-ink-muted max-w-lg mx-auto">
                ECHO AI reads only entries you haven’t excluded, separates stored facts from gentle reflection, and lets you speak memories directly into your archive.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl p-4 sm:p-5 space-y-3 ${
                  m.role === 'user'
                    ? 'bg-surface-raised border border-sky-400/25 ml-auto max-w-2xl'
                    : 'bg-inset border border-hairline mr-auto max-w-3xl'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span className={m.role === 'assistant' ? 'text-cyan-700 dark:text-cyan-300 font-medium' : 'text-sky-700 dark:text-sky-300 font-medium'}>
                    {m.role === 'assistant' ? 'ECHO AI' : user?.displayName}
                  </span>
                  <span className="font-mono tabular-nums">
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap">{m.content}</div>

                {m.sources && m.sources.length > 0 && (
                  <div className="pt-2 border-t border-hairline space-y-1.5">
                    <div className="text-xs text-ink-muted">Referenced entries from your archive:</div>
                    <div className="flex flex-wrap gap-2">
                      {m.sources.map((src) => (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() => navigateTo(sourceKindToModule(src.kind), src.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-tint px-2.5 py-1 text-xs text-cyan-700 dark:text-cyan-200 hover:bg-tint-hover"
                        >
                          <span>{src.title}</span>
                          {src.date && <span className="text-ink-muted font-mono">({src.date.slice(0, 10)})</span>}
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
            <div className="rounded-2xl bg-inset border border-cyan-500/25 p-4 text-xs text-cyan-800 dark:text-cyan-200">
              Searching your archive and preparing grounded reflection...
            </div>
          )}
        </div>

        {followUps.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-hairline">
            {followUps.map((fq) => (
              <button
                key={fq}
                type="button"
                onClick={() => void askQuestion(fq)}
                className="text-xs text-ink-secondary hover:text-cyan-700 dark:hover:text-cyan-200 underline underline-offset-4"
              >
                {fq}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-200">
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
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending || !user?.aiConsent}
              placeholder="Ask about a memory, person, place, emotion, or year..."
              className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={() =>
                voicePhase === 'recording'
                  ? stopAndSaveVoiceRecording()
                  : void startVoiceMemoryRecording()
              }
              disabled={voicePhase !== 'idle' && voicePhase !== 'recording'}
              aria-label={voicePhase === 'recording' ? 'Stop and save spoken memory' : 'Record spoken memory'}
              title={voicePhase === 'recording' ? 'Stop & save spoken memory' : 'Speak a new memory to transcribe & save'}
              className={`touch-manipulation inline-flex items-center justify-center w-11 h-11 rounded-xl border shrink-0 transition-colors ${
                voicePhase === 'recording'
                  ? 'border-rose-500/50 bg-rose-500/20 text-rose-600 dark:text-rose-300 animate-pulse'
                  : 'border-hairline-strong bg-inset text-cyan-600 dark:text-cyan-300 hover:bg-tint-hover disabled:opacity-50'
              }`}
            >
              {voicePhase === 'recording' ? (
                <Square className="w-4 h-4 fill-current" />
              ) : isBusyVoice ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          </div>
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
