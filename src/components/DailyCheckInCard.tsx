import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { apiRequest, uploadMediaFile } from '../lib/api';
import type { ModuleId } from '../types/echo';

export interface DailyCheckInEntry {
  id: string;
  title: string;
  content: string;
  mood: string;
  memoryDate: string;
  createdAt: string;
}

export interface DailyCheckInHistoryItem {
  id: string;
  title: string;
  memoryDate: string;
  mood: string;
  sentimentTone: string;
  emotionalImpact: string;
  sentimentScore: number | null;
  sentimentRationale: string;
  aiExcluded: boolean;
  excerpt: string;
  createdAt: string;
}

export interface MonthlyReflectionTheme {
  name: string;
  insight: string;
  memoryIds: string[];
}

export interface MonthlyReflectionData {
  periodKey: string;
  summary: string;
  themes: MonthlyReflectionTheme[];
  emotionalArc: string;
  gentlePrompt: string;
  checkInCount: number;
  sourceIds: string[];
  generatedAt: string;
}

export interface DailyCheckInStatus {
  date: string;
  streak: number;
  totalCheckIns: number;
  history?: DailyCheckInHistoryItem[];
  monthlyReflection?: MonthlyReflectionData | null;
  todayEntry: DailyCheckInEntry | null;
}

interface MindfulPrompt {
  id: string;
  theme: string;
  tag: string;
  category: string;
  question: string;
  hint: string;
}

const MINDFUL_PROMPTS: MindfulPrompt[] = [
  {
    id: 'small-joy',
    theme: 'Small Joys',
    tag: 'gratitude',
    category: 'Happiness',
    question: 'What small, ordinary detail made today feel slightly brighter?',
    hint: 'A conversation, a good cup of coffee, morning light, or a quiet five minutes.',
  },
  {
    id: 'presence',
    theme: 'Presence',
    tag: 'mindfulness',
    category: 'Important moments',
    question: 'When did you feel most grounded and present in your own skin today?',
    hint: 'Notice what you were doing, who was nearby, and what eased your mind.',
  },
  {
    id: 'connection',
    theme: 'Connection',
    tag: 'people',
    category: 'Friends',
    question: 'Who crossed your mind or showed up for you today, even in a brief way?',
    hint: 'A message, an unexpected kindness, or someone you quietly appreciate.',
  },
  {
    id: 'gratitude',
    theme: 'Gratitude',
    tag: 'gratitude',
    category: 'Important moments',
    question: 'What is one thing from today you would miss if it vanished tomorrow?',
    hint: 'Often the routines we barely notice become our favorite memories later.',
  },
  {
    id: 'lesson',
    theme: 'Perspective',
    tag: 'growth',
    category: 'Life lessons',
    question: 'What did today teach you about your energy, patience, or priorities?',
    hint: 'Capture an honest observation without judging how the day went.',
  },
  {
    id: 'sensory',
    theme: 'Sensory Snapshot',
    tag: 'presence',
    category: 'Important moments',
    question: 'If you froze one scene from today—a sound, scent, or view—what would it be?',
    hint: 'Sensory details keep memories vivid years after the date fades.',
  },
  {
    id: 'kindness',
    theme: 'Kindness',
    tag: 'compassion',
    category: 'Important moments',
    question: 'How were you gentle with yourself or someone else today?',
    hint: 'Small acts of care count just as much as big milestones.',
  },
  {
    id: 'surprise',
    theme: 'Unexpected Turn',
    tag: 'wonder',
    category: 'Important moments',
    question: 'What surprised you today—big, subtle, or completely unplanned?',
    hint: 'Write down what shifted your mood or changed how your day unfolded.',
  },
  {
    id: 'pride',
    theme: 'Quiet Effort',
    tag: 'resilience',
    category: 'Achievements',
    question: 'What effort from today deserves a quiet thank-you, even if nobody else saw it?',
    hint: 'Showing up, finishing something hard, or resting when you needed to.',
  },
  {
    id: 'home',
    theme: 'Belonging',
    tag: 'family',
    category: 'Family',
    question: 'What moment today made you feel safe, understood, or at home?',
    hint: 'Describe the setting or words that lingered with you.',
  },
  {
    id: 'curiosity',
    theme: 'Curiosity',
    tag: 'curiosity',
    category: 'Life lessons',
    question: 'What sparked your curiosity or made you pause and look twice today?',
    hint: 'An idea, a page you read, or a question you want to explore later.',
  },
  {
    id: 'release',
    theme: 'Letting Go',
    tag: 'reflection',
    category: 'Important moments',
    question: 'What worry or rush from today are you ready to set down before tonight ends?',
    hint: 'Putting a heavy thought into words makes it lighter to carry.',
  },
  {
    id: 'love',
    theme: 'Affection',
    tag: 'love',
    category: 'Love',
    question: 'Where did you notice warmth, laughter, or genuine affection today?',
    hint: 'Record the exact phrasing or expression before it slips away.',
  },
  {
    id: 'future-self',
    theme: 'Time Capsule Note',
    tag: 'perspective',
    category: 'Important moments',
    question: 'What would you want your future self to remember about this exact season of life?',
    hint: 'Write one honest paragraph as if handing a postcard forward in time.',
  },
];

const CHECKIN_MOODS = ['Grateful', 'Peaceful', 'Reflective', 'Joyful', 'Hopeful', 'Tender'] as const;

type VoiceState = 'idle' | 'recording' | 'uploading' | 'transcribing';

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

function dateSeedIndex(dateStr: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i += 1) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

interface DailyCheckInCardProps {
  localDate: string;
  checkIn: DailyCheckInStatus | null;
  aiConsent: boolean;
  onSaved: () => Promise<void>;
  onNavigate: (module: ModuleId, targetId?: string) => void;
}

export function DailyCheckInCard({
  localDate,
  checkIn,
  aiConsent,
  onSaved,
  onNavigate,
}: DailyCheckInCardProps) {
  const defaultIndex = useMemo(
    () => dateSeedIndex(localDate, MINDFUL_PROMPTS.length),
    [localDate]
  );
  const [promptOffset, setPromptOffset] = useState(0);
  const [answer, setAnswer] = useState('');
  const [mood, setMood] = useState<(typeof CHECKIN_MOODS)[number]>('Reflective');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composingAnother, setComposingAnother] = useState(false);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceMediaIds, setVoiceMediaIds] = useState<string[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const cleanupRecording = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore cleanup stop errors
        }
      }
      cleanupRecording();
    };
  }, []);

  const prompt = MINDFUL_PROMPTS[(defaultIndex + promptOffset) % MINDFUL_PROMPTS.length];
  const todayEntry = checkIn?.todayEntry || null;
  const showComposer = !todayEntry || composingAnother;

  const transcribeVoiceBlob = async (blob: Blob, filename: string) => {
    setVoiceError(null);
    try {
      setVoiceState('uploading');
      const uploaded = await uploadMediaFile(blob, filename, 'memory');

      setVoiceState('transcribing');
      const tr = await apiRequest<{ transcript: string }>('/ai/transcribe', {
        method: 'POST',
        body: JSON.stringify({ mediaId: uploaded.id }),
      });

      const transcript = (tr.transcript || '').trim();
      if (!transcript) {
        setVoiceError('No clear speech was detected in that recording. Please try again.');
        return;
      }

      setAnswer((prev) => (prev.trim() ? `${prev.trim()}\n\n${transcript}` : transcript));
      setVoiceMediaIds((prev) => [...prev, uploaded.id]);
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : 'Unable to transcribe your voice recording.'
      );
    } finally {
      setVoiceState('idle');
    }
  };

  const startVoiceRecording = async () => {
    if (voiceState !== 'idle' || saving) return;
    setVoiceError(null);
    cancelledRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickSupportedAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMime });
        cleanupRecording();

        if (cancelledRef.current) {
          setVoiceState('idle');
          return;
        }
        if (blob.size === 0) {
          setVoiceError('Recording was empty. Speak for a moment before stopping.');
          setVoiceState('idle');
          return;
        }

        const ext = extensionForMime(finalMime);
        void transcribeVoiceBlob(blob, `checkin-voice-${Date.now()}.${ext}`);
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setRecordingSeconds(0);
      setVoiceState('recording');
      timerRef.current = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      cleanupRecording();
      setVoiceState('idle');
      setVoiceError('Microphone access was denied or unavailable.');
    }
  };

  const stopVoiceRecording = () => {
    if (voiceState !== 'recording') return;
    cancelledRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      cleanupRecording();
      setVoiceState('idle');
    }
  };

  const cancelVoiceRecording = () => {
    if (voiceState !== 'recording') return;
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      cleanupRecording();
      setVoiceState('idle');
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!answer.trim() || saving || voiceState !== 'idle') return;
    setSaving(true);
    setError(null);

    try {
      const formattedContent = `Daily Check-In Prompt: "${prompt.question}"\n\n${answer.trim()}`;
      await apiRequest('/memories', {
        method: 'POST',
        body: JSON.stringify({
          title: `Daily Check-In · ${prompt.theme}`,
          content: formattedContent,
          memoryDate: localDate,
          mood,
          category: prompt.category,
          tags: ['daily-checkin', prompt.tag],
          mediaIds: voiceMediaIds,
          autoAnalyzeSentiment: aiConsent,
        }),
      });
      setAnswer('');
      setVoiceMediaIds([]);
      setVoiceError(null);
      setComposingAnother(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your daily check-in.');
    } finally {
      setSaving(false);
    }
  };

  const mm = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
  const ss = String(recordingSeconds % 60).padStart(2, '0');
  const isVoiceBusy = voiceState !== 'idle';

  return (
    <section
      aria-labelledby="daily-checkin-heading"
      className="rounded-2xl border border-hairline bg-surface p-6 space-y-5 min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink-muted min-w-0">
          <Sun className="w-4 h-4 text-accent-text shrink-0" />
          <span className="font-semibold text-accent-text">Daily Check-In</span>
          <span aria-hidden="true">·</span>
          <span>{prompt.theme}</span>
          {checkIn && checkIn.streak > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-ink-secondary">
                {checkIn.streak} day streak
              </span>
            </>
          )}
          {checkIn && checkIn.totalCheckIns > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {checkIn.totalCheckIns} {checkIn.totalCheckIns === 1 ? 'reflection' : 'reflections'}
              </span>
            </>
          )}
        </div>

        {showComposer && (
          <button
            type="button"
            onClick={() => setPromptOffset((prev) => prev + 1)}
            className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-inset px-3 py-1.5 text-xs font-medium text-ink-secondary hover:bg-tint-hover hover:text-ink transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Another question
          </button>
        )}
      </div>

      {showComposer ? (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5 max-w-3xl">
            <h2
              id="daily-checkin-heading"
              className="font-display text-xl sm:text-2xl font-bold text-ink leading-snug [text-wrap:balance]"
            >
              {prompt.question}
            </h2>
            <p className="text-sm text-ink-muted">{prompt.hint}</p>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-ink-secondary">
              How did today feel?
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Check-in mood">
              {CHECKIN_MOODS.map((option) => {
                const active = mood === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMood(option)}
                    aria-pressed={active}
                    className={`touch-manipulation rounded-xl border px-3.5 py-2 text-xs transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                      active
                        ? 'border-accent-border bg-accent-soft text-accent-text font-semibold'
                        : 'border-hairline bg-inset text-ink-secondary hover:bg-tint-hover hover:text-ink'
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Unified input field with integrated voice-to-text recording bar */}
          <div className="rounded-xl border border-hairline-strong bg-inset focus-within:border-accent transition-colors">
            <textarea
              rows={3}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && answer.trim() && !isVoiceBusy) {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              placeholder="Write or speak today's honest answer—it will be saved directly to your ECHO Memories..."
              className="touch-manipulation w-full bg-transparent px-4 pt-3 pb-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none resize-y min-h-[88px]"
            />

            <div className="px-3 pb-2.5 pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-hairline">
              <div className="text-xs text-ink-muted min-w-0">
                {voiceState === 'recording' ? (
                  <span className="font-medium text-rose-600 dark:text-rose-300">
                    Listening... tap Stop when finished to transcribe
                  </span>
                ) : voiceState === 'uploading' ? (
                  <span className="text-ink-secondary">Uploading voice clip...</span>
                ) : voiceState === 'transcribing' ? (
                  <span className="text-accent-text font-medium">Transcribing speech to text...</span>
                ) : voiceMediaIds.length > 0 ? (
                  <span className="font-mono tabular-nums text-ink-secondary">
                    {voiceMediaIds.length} voice {voiceMediaIds.length === 1 ? 'clip' : 'clips'} attached
                  </span>
                ) : (
                  <span>Type or record with your microphone</span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {voiceState === 'recording' ? (
                  <>
                    <button
                      type="button"
                      onClick={cancelVoiceRecording}
                      aria-label="Cancel voice recording"
                      className="touch-manipulation inline-flex items-center gap-1 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={stopVoiceRecording}
                      aria-label="Stop recording and transcribe"
                      className="touch-manipulation inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-200 hover:bg-rose-500/25 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop</span>
                      <span className="font-mono tabular-nums">{mm}:{ss}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={startVoiceRecording}
                    disabled={isVoiceBusy || saving}
                    aria-label="Record voice answer"
                    className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-secondary hover:bg-tint-hover hover:text-ink disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    {voiceState === 'uploading' || voiceState === 'transcribing' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-text" />
                    ) : (
                      <Mic className="w-3.5 h-3.5 text-accent-text" />
                    )}
                    <span>
                      {voiceState === 'uploading' || voiceState === 'transcribing'
                        ? 'Transcribing...'
                        : 'Speak Answer'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {voiceError && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
              {voiceError}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span>Saved privately as an ECHO Memory</span>
              {composingAnother && todayEntry && (
                <button
                  type="button"
                  onClick={() => {
                    setComposingAnother(false);
                    setError(null);
                    setVoiceError(null);
                  }}
                  className="touch-manipulation text-xs font-medium text-ink-secondary hover:text-ink hover:underline whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={saving || isVoiceBusy || !answer.trim()}
              className="touch-manipulation inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              {saving ? 'Saving Check-In...' : 'Save Today’s Check-In'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <h2 id="daily-checkin-heading" className="font-display text-lg font-bold text-ink">
                  Today’s mindful check-in is saved
                </h2>
              </div>
              <div className="text-xs text-ink-muted">
                <span>{todayEntry.title}</span>
                <span aria-hidden="true"> · </span>
                <span>Mood: {todayEntry.mood}</span>
                <span aria-hidden="true"> · </span>
                <span className="font-mono tabular-nums">{todayEntry.memoryDate}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setComposingAnother(true)}
                className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-inset px-3.5 py-2 text-xs font-medium text-ink-secondary hover:bg-tint-hover hover:text-ink transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Plus className="w-3.5 h-3.5" />
                Add another reflection
              </button>
              <button
                type="button"
                onClick={() => onNavigate('memories', todayEntry.id)}
                className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl bg-accent-soft border border-accent-border px-3.5 py-2 text-xs font-semibold text-accent-text hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 min-h-[40px]"
              >
                View in Memories
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap line-clamp-4">
            {todayEntry.content}
          </p>
        </div>
      )}
    </section>
  );
}
