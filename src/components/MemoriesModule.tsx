import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FolderPlus,
  Heart,
  Link2,
  Loader2,
  MapPin,
  Mic,
  Navigation,
  Play,
  Plus,
  Search,
  Shuffle,
  Sparkles,
  Square,
  Tag,
  Tags,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest, readOfflineCache, saveOfflineCache, uploadMediaFile } from '../lib/api';
import {
  isBrowserSpeechSupported,
  startBrowserSpeechCapture,
  type LiveSpeechCaptureSession,
} from '../lib/browserSpeech';
import type { MediaMeta, MemoryCollection, MemoryItem } from '../types/echo';
import { AuthMedia, MediaPicker, VoiceRecorder } from './MediaElements';
import { MemoriesMapView } from './MemoriesMapView';
import { HorizontalMemoryTimeline } from './HorizontalMemoryTimeline';
import { DEFAULT_CATEGORIES, PRIMARY_CATEGORIES, getCategoryStyle } from '../lib/memoryCategories';

const MOODS = [
  'Joyful',
  'Grateful',
  'Peaceful',
  'Inspired',
  'Hopeful',
  'Reflective',
  'Nostalgic',
  'Bittersweet',
  'Tender',
  'Melancholic',
  'Anxious',
  'Courageous',
];

const EMOTIONAL_IMPACTS = [
  {
    id: 'Uplifting',
    label: 'Uplifting',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    activeClass: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 font-semibold',
    barClass: 'bg-emerald-500 dark:bg-emerald-400',
  },
  {
    id: 'Calm',
    label: 'Calm',
    textClass: 'text-sky-700 dark:text-sky-300',
    activeClass: 'border-sky-500/50 bg-sky-500/15 text-sky-800 dark:text-sky-200 font-semibold',
    barClass: 'bg-sky-500 dark:bg-sky-400',
  },
  {
    id: 'Reflective',
    label: 'Reflective',
    textClass: 'text-indigo-700 dark:text-indigo-300',
    activeClass: 'border-indigo-500/50 bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 font-semibold',
    barClass: 'bg-indigo-500 dark:bg-indigo-400',
  },
  {
    id: 'Bittersweet',
    label: 'Bittersweet',
    textClass: 'text-amber-700 dark:text-amber-300',
    activeClass: 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200 font-semibold',
    barClass: 'bg-amber-500 dark:bg-amber-400',
  },
  {
    id: 'Challenging',
    label: 'Challenging',
    textClass: 'text-rose-700 dark:text-rose-300',
    activeClass: 'border-rose-500/50 bg-rose-500/15 text-rose-800 dark:text-rose-200 font-semibold',
    barClass: 'bg-rose-500 dark:bg-rose-400',
  },
] as const;

interface SentimentSummary {
  totalMemories: number;
  unanalyzedCount: number;
  analyzableUnanalyzedCount: number;
  impactCounts: Record<string, number>;
  tones: Array<{ tone: string; count: number }>;
  categoryCounts?: Array<{ category: string; count: number }>;
}

function getImpactStyle(impact: string) {
  return (
    EMOTIONAL_IMPACTS.find((x) => x.id.toLowerCase() === impact.toLowerCase()) || {
      id: impact,
      label: impact,
      textClass: 'text-ink-secondary',
      activeClass: 'border-hairline-strong bg-surface-raised text-ink font-semibold',
      barClass: 'bg-sky-400',
    }
  );
}

const CARD_ENTRY_DELAY_CLASSES = [
  '',
  '[animation-delay:30ms]',
  '[animation-delay:60ms]',
  '[animation-delay:90ms]',
  '[animation-delay:120ms]',
  '[animation-delay:150ms]',
  '[animation-delay:180ms]',
  '[animation-delay:210ms]',
  '[animation-delay:240ms]',
] as const;

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
  if (!cleaned) return `Voice Memory (${new Date().toLocaleDateString('en-CA')})`;
  const words = cleaned.split(' ').slice(0, 7).join(' ');
  return words.length < cleaned.length ? `${words}...` : words;
}

export function MemoriesModule() {
  const { user, focusItemId, isOnline, queueMutation, quickCaptureTarget, setQuickCaptureTarget } = useEcho();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [collections, setCollections] = useState<MemoryCollection[]>([]);
  const [allTagsDirectory, setAllTagsDirectory] = useState<Array<{ tag: string; count: number }>>([]);
  const [sentimentSummary, setSentimentSummary] = useState<SentimentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'timeline' | 'calendar' | 'collections' | 'map' | 'people' | 'tags'>('timeline');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [moodFilter, setMoodFilter] = useState('All');
  const [impactFilter, setImpactFilter] = useState('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<'any' | 'all'>('any');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedDateJump, setSelectedDateJump] = useState<string | null>(null);
  const [pendingScrollMemoryId, setPendingScrollMemoryId] = useState<string | null>(null);
  const [sentimentBusy, setSentimentBusy] = useState(false);
  const [analyzingMemoryId, setAnalyzingMemoryId] = useState<string | null>(null);
  const [updatingCategoryId, setUpdatingCategoryId] = useState<string | null>(null);
  const [sentimentNotice, setSentimentNotice] = useState<string | null>(null);

  const [activeMemory, setActiveMemory] = useState<MemoryItem | null>(null);
  const [relatedMemories, setRelatedMemories] = useState<MemoryItem[]>([]);
  const [slideshowIndex, setSlideshowIndex] = useState<number | null>(null);
  const [detailTagDraft, setDetailTagDraft] = useState('');

  // Tag Manager State
  const [tagSearch, setTagSearch] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [renameTagDraft, setRenameTagDraft] = useState('');
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [tagManagerBusy, setTagManagerBusy] = useState(false);
  const [tagManagerNotice, setTagManagerNotice] = useState<string | null>(null);
  const [batchAssignFilter, setBatchAssignFilter] = useState<'all' | 'untagged'>('untagged');
  const [activeAssignTag, setActiveAssignTag] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [memoryDate, setMemoryDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [locationName, setLocationName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [mood, setMood] = useState('Reflective');
  const [category, setCategory] = useState('Personal');
  const [customCategory, setCustomCategory] = useState('');
  const [editorTags, setEditorTags] = useState<string[]>([]);
  const [editorTagDraft, setEditorTagDraft] = useState('');
  const [peopleInput, setPeopleInput] = useState('');
  const [collectionId, setCollectionId] = useState<string>('');
  const [aiExcluded, setAiExcluded] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [sentimentTone, setSentimentTone] = useState('');
  const [emotionalImpact, setEmotionalImpact] = useState('');
  const [sentimentScore, setSentimentScore] = useState<number | null>(null);
  const [sentimentRationale, setSentimentRationale] = useState('');
  const [analyzingDraftSentiment, setAnalyzingDraftSentiment] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<MediaMeta[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voice-to-Memory (SpeechRecognition) Auto-Save State
  const [voiceAutoPhase, setVoiceAutoPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [voiceAutoSeconds, setVoiceAutoSeconds] = useState(0);
  const [voiceLiveTranscript, setVoiceLiveTranscript] = useState('');
  const [voiceAutoError, setVoiceAutoError] = useState<string | null>(null);
  const voiceSpeechRef = useRef<LiveSpeechCaptureSession | null>(null);
  const voiceTranscriptRef = useRef('');
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceRecorderStopResolveRef = useRef<((result: { blob: Blob | null; mimeType: string }) => void) | null>(null);
  const voiceSessionCancelledRef = useRef(false);

  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDesc, setNewCollectionDesc] = useState('');

  const loadMemories = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (moodFilter !== 'All') params.set('mood', moodFilter);
      if (impactFilter !== 'All') params.set('impact', impactFilter);
      if (favoritesOnly) params.set('favorite', 'true');
      if (selectedCollectionId) params.set('collectionId', selectedCollectionId);
      if (selectedPerson) params.set('person', selectedPerson);
      if (selectedTags.length > 0) {
        params.set('tags', selectedTags.join(','));
        params.set('tagMode', tagFilterMode);
      }

      const [memRes, colRes, tagsRes, sentimentRes] = await Promise.all([
        apiRequest<{ memories: MemoryItem[] }>(`/memories?${params.toString()}`),
        apiRequest<{ collections: MemoryCollection[] }>('/collections'),
        apiRequest<{ tags: Array<{ tag: string; count: number }> }>('/memories/tags'),
        apiRequest<SentimentSummary>('/memories/sentiment-summary'),
      ]);
      setMemories(memRes.memories);
      setCollections(colRes.collections);
      setAllTagsDirectory(tagsRes.tags);
      setSentimentSummary(sentimentRes);
      void saveOfflineCache('memories', memRes.memories);
    } catch (err) {
      const cached = await readOfflineCache<MemoryItem[]>('memories');
      if (cached) {
        setMemories(cached);
      } else {
        setSentimentNotice(err instanceof Error ? err.message : 'Unable to load memories.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMemories();
  }, [categoryFilter, moodFilter, impactFilter, favoritesOnly, selectedCollectionId, selectedPerson, selectedTags, tagFilterMode]);

  useEffect(() => {
    if (!focusItemId) return;
    setView('timeline');
    if (memories.length > 0) {
      const found = memories.find((m) => m.id === focusItemId);
      if (found) {
        if (selectedYear && !found.memoryDate.startsWith(selectedYear)) {
          setSelectedYear(null);
        }
        setActiveMemory(found);
        setPendingScrollMemoryId(found.id);
      }
    }
  }, [focusItemId, memories]);

  useEffect(() => {
    if (quickCaptureTarget === 'memory') {
      openNewEditor();
      setQuickCaptureTarget(null);
    } else if (quickCaptureTarget === 'voice') {
      openNewEditor({ autoStartVoice: true });
      setQuickCaptureTarget(null);
    }
  }, [quickCaptureTarget]);

  const cleanupVoiceAutoResources = () => {
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (voiceStreamRef.current) {
      voiceStreamRef.current.getTracks().forEach((t) => t.stop());
      voiceStreamRef.current = null;
    }
  };

  const cancelVoiceAutoCapture = () => {
    voiceSessionCancelledRef.current = true;
    voiceSpeechRef.current?.cancel();
    voiceSpeechRef.current = null;
    voiceTranscriptRef.current = '';
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      try {
        voiceRecorderRef.current.stop();
      } catch {
        // Ignore stop errors on cancel
      }
    }
    voiceRecorderRef.current = null;
    voiceChunksRef.current = [];
    if (voiceRecorderStopResolveRef.current) {
      const resolve = voiceRecorderStopResolveRef.current;
      voiceRecorderStopResolveRef.current = null;
      resolve({ blob: null, mimeType: 'audio/webm' });
    }
    cleanupVoiceAutoResources();
    setVoiceLiveTranscript('');
    setVoiceAutoSeconds(0);
    setVoiceAutoPhase('idle');
  };

  useEffect(() => {
    return () => {
      cancelVoiceAutoCapture();
    };
  }, []);

  const displayedMemories = useMemo(() => {
    if (!selectedYear) return memories;
    return memories.filter((m) => m.memoryDate.startsWith(selectedYear));
  }, [memories, selectedYear]);

  useEffect(() => {
    if (!pendingScrollMemoryId || view !== 'timeline') return;
    const targetId = pendingScrollMemoryId;
    const raf = window.requestAnimationFrame(() => {
      const el = document.getElementById(`memory-card-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setPendingScrollMemoryId(null);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pendingScrollMemoryId, view, displayedMemories]);

  const handleSelectTimelineYear = (year: string | null) => {
    setSelectedYear(year);
    setSelectedDateJump(null);
    if (year) {
      const yearMemories = memories.filter((m) => m.memoryDate.startsWith(year));
      if (view === 'calendar') {
        if (yearMemories.length > 0) {
          setCalendarMonth(yearMemories[0].memoryDate.slice(0, 7));
          setSelectedDay(yearMemories[0].memoryDate);
        }
      } else if (view !== 'timeline' && view !== 'map') {
        setView('timeline');
      }
    }
  };

  const handleJumpToTimelineDate = (dateIso: string, targetMemory?: MemoryItem) => {
    setSelectedDateJump(dateIso);
    if (selectedYear && !dateIso.startsWith(selectedYear)) {
      setSelectedYear(null);
    }
    const target = targetMemory || memories.find((m) => m.memoryDate === dateIso) || null;
    if (view === 'calendar') {
      setCalendarMonth(dateIso.slice(0, 7));
      setSelectedDay(dateIso);
      if (target) setActiveMemory(target);
      return;
    }
    if (view !== 'timeline') {
      setView('timeline');
    }
    if (target) {
      setActiveMemory(target);
      setPendingScrollMemoryId(target.id);
    }
  };

  const handleClearTimelineJump = () => {
    setSelectedYear(null);
    setSelectedDateJump(null);
    setPendingScrollMemoryId(null);
  };

  useEffect(() => {
    if (!activeMemory) {
      setRelatedMemories([]);
      return;
    }
    apiRequest<{ related: MemoryItem[] }>(`/memories/${encodeURIComponent(activeMemory.id)}/related`)
      .then((res) => setRelatedMemories(res.related))
      .catch(() => setRelatedMemories([]));
  }, [activeMemory?.id]);

  const startVoiceAutoCapture = async () => {
    if (voiceSpeechRef.current || voiceAutoPhase === 'saving') return;
    setVoiceAutoError(null);
    setError(null);

    if (!isBrowserSpeechSupported()) {
      setVoiceAutoError('SpeechRecognition is unavailable in this browser. Type your memory or use Upload Audio below.');
      return;
    }

    voiceSessionCancelledRef.current = false;
    voiceTranscriptRef.current = '';
    setVoiceLiveTranscript('');
    setVoiceAutoSeconds(0);
    voiceChunksRef.current = [];

    // Start live SpeechRecognition immediately inside the user interaction flow
    const speechSession = startBrowserSpeechCapture({
      onInterim: (transcript) => {
        voiceTranscriptRef.current = transcript;
        setVoiceLiveTranscript(transcript);
      },
      onError: (code, msg) => {
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'start-failed') {
          setVoiceAutoError(msg);
          cancelVoiceAutoCapture();
        } else if (code !== 'no-speech') {
          setVoiceAutoError(msg);
        }
      },
    });
    if (voiceSessionCancelledRef.current) {
      return;
    }
    voiceSpeechRef.current = speechSession;
    setVoiceAutoPhase('recording');
    voiceTimerRef.current = window.setInterval(() => setVoiceAutoSeconds((s) => s + 1), 1000);

    // Optionally capture an accompanying audio clip via MediaRecorder when supported
    if (navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (voiceSessionCancelledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        voiceStreamRef.current = stream;
        const mimeType = pickSupportedAudioMimeType();
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) voiceChunksRef.current.push(ev.data);
        };
        recorder.onstop = () => {
          const finalMime = recorder.mimeType || mimeType || 'audio/webm';
          const blob =
            voiceChunksRef.current.length > 0
              ? new Blob(voiceChunksRef.current, { type: finalMime })
              : null;
          voiceChunksRef.current = [];
          voiceRecorderRef.current = null;
          const resolve = voiceRecorderStopResolveRef.current;
          voiceRecorderStopResolveRef.current = null;
          if (resolve) {
            resolve({ blob: blob && blob.size > 0 ? blob : null, mimeType: finalMime });
          }
        };
        voiceRecorderRef.current = recorder;
        recorder.start(250);
      } catch {
        // SpeechRecognition can still capture live transcript if MediaRecorder mic stream is unavailable
      }
    }
  };

  const stopAndSaveVoiceAutoCapture = async () => {
    if (voiceAutoPhase !== 'recording') return;
    setVoiceAutoError(null);
    setError(null);

    if (category === 'Custom' && !customCategory.trim()) {
      setError('Please enter a custom category name before saving.');
      return;
    }

    let parsedLat: number | null = null;
    if (latitude.trim()) {
      const n = Number(latitude.trim());
      if (!Number.isFinite(n) || n < -90 || n > 90) {
        setError('Latitude must be a valid number between -90 and 90.');
        return;
      }
      parsedLat = n;
    }

    let parsedLng: number | null = null;
    if (longitude.trim()) {
      const n = Number(longitude.trim());
      if (!Number.isFinite(n) || n < -180 || n > 180) {
        setError('Longitude must be a valid number between -180 and 180.');
        return;
      }
      parsedLng = n;
    }

    // Snapshot form fields before asynchronous stop & save completes
    const draftTitle = title.trim();
    const draftContent = content.trim();
    const draftDate = memoryDate || new Date().toLocaleDateString('en-CA');
    const draftLocation = locationName.trim();
    const draftMood = mood;
    const draftCategory = category === 'Custom' ? customCategory.trim() : category;
    const draftCollectionId = collectionId || null;
    const draftAiExcluded = aiExcluded;
    const draftPeople = peopleInput.split(',').map((p) => p.trim()).filter(Boolean);
    const pendingDraftTag = editorTagDraft.trim().replace(/^#+/, '').slice(0, 40);
    const baseTags =
      pendingDraftTag && !editorTags.some((t) => t.toLowerCase() === pendingDraftTag.toLowerCase())
        ? [...editorTags, pendingDraftTag]
        : [...editorTags];
    if (!baseTags.some((t) => t.toLowerCase() === 'voice-memory')) {
      baseTags.push('voice-memory');
    }
    const baseMediaIds = attachedMedia.map((m) => m.id);

    setVoiceAutoPhase('saving');

    // Stop SpeechRecognition and wait briefly for any buffered final phrase
    const speechSession = voiceSpeechRef.current;
    voiceSpeechRef.current = null;
    const waitedTranscript = speechSession ? await speechSession.stopAndWait(300) : '';
    const finalTranscript = (waitedTranscript || voiceTranscriptRef.current).trim();

    // Stop optional MediaRecorder audio capture
    let audioResult: { blob: Blob | null; mimeType: string } = { blob: null, mimeType: 'audio/webm' };
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      audioResult = await new Promise<{ blob: Blob | null; mimeType: string }>((resolve) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          voiceRecorderStopResolveRef.current = null;
          resolve({ blob: null, mimeType: 'audio/webm' });
        }, 1200);
        voiceRecorderStopResolveRef.current = (res) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(res);
        };
        try {
          voiceRecorderRef.current?.stop();
        } catch {
          window.clearTimeout(timer);
          voiceRecorderStopResolveRef.current = null;
          resolve({ blob: null, mimeType: 'audio/webm' });
        }
      });
    }

    cleanupVoiceAutoResources();

    if (voiceSessionCancelledRef.current) {
      setVoiceAutoPhase('idle');
      return;
    }

    if (!finalTranscript) {
      setVoiceAutoPhase('idle');
      setVoiceAutoError('No speech transcript was detected. Try speaking clearly and click Record & Auto-Save again.');
      return;
    }

    try {
      const nextMediaIds = [...baseMediaIds];
      if (audioResult.blob && isOnline) {
        try {
          const ext = extensionForMime(audioResult.mimeType);
          const uploaded = await uploadMediaFile(
            audioResult.blob,
            `voice-memory-${Date.now()}.${ext}`,
            'memory'
          );
          nextMediaIds.push(uploaded.id);
        } catch {
          // Audio upload failure is non-fatal; SpeechRecognition transcript still saves cleanly
        }
      }

      let resolvedTitle = draftTitle || deriveTitleFromTranscript(finalTranscript);
      let resolvedSummary = aiSummary;

      if (!draftTitle && user?.aiConsent && isOnline && !draftAiExcluded) {
        try {
          const assist = await apiRequest<{ title?: string; summary?: string }>('/ai/assist', {
            method: 'POST',
            body: JSON.stringify({ mode: 'title_and_summary', text: finalTranscript }),
          });
          if (assist.title?.trim()) resolvedTitle = assist.title.trim();
          if (assist.summary?.trim() && !resolvedSummary) resolvedSummary = assist.summary.trim();
        } catch {
          // Keep locally derived title if AI assist is unavailable
        }
      }

      const combinedContent = draftContent ? `${draftContent}\n\n${finalTranscript}` : finalTranscript;

      const payload = {
        title: resolvedTitle,
        content: combinedContent,
        memoryDate: draftDate,
        locationName: draftLocation,
        latitude: parsedLat,
        longitude: parsedLng,
        mood: draftMood,
        category: draftCategory,
        aiExcluded: draftAiExcluded,
        aiSummary: resolvedSummary,
        sentimentTone,
        emotionalImpact,
        sentimentScore,
        sentimentRationale,
        autoAnalyzeSentiment: !draftAiExcluded && !emotionalImpact && Boolean(user?.aiConsent),
        collectionId: draftCollectionId,
        tags: baseTags,
        people: draftPeople,
        mediaIds: nextMediaIds,
      };

      if (!isOnline) {
        await queueMutation({
          endpoint: '/memories',
          payload,
          label: `Voice Memory: ${payload.title}`,
        });
        setEditorOpen(false);
        setVoiceLiveTranscript('');
        setVoiceAutoSeconds(0);
        setSentimentNotice('Offline mode — your transcribed voice memory was queued to sync automatically.');
        return;
      }

      const saved = await apiRequest<{ memory: MemoryItem }>('/memories', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setEditorOpen(false);
      setVoiceLiveTranscript('');
      setVoiceAutoSeconds(0);
      if (selectedYear && !saved.memory.memoryDate.startsWith(selectedYear)) {
        setSelectedYear(null);
      }
      setView('timeline');
      setActiveMemory(saved.memory);
      setPendingScrollMemoryId(saved.memory.id);
      setSentimentNotice(`Voice memory "${saved.memory.title}" transcribed and saved.`);
      await loadMemories();
    } catch (err) {
      setVoiceAutoError(err instanceof Error ? err.message : 'Unable to save voice memory.');
    } finally {
      setVoiceAutoPhase('idle');
    }
  };

  const closeEditor = () => {
    cancelVoiceAutoCapture();
    setVoiceAutoError(null);
    setEditorOpen(false);
  };

  const openNewEditor = (options?: { autoStartVoice?: boolean }) => {
    cancelVoiceAutoCapture();
    setVoiceAutoError(null);
    setEditingId(null);
    setTitle('');
    setContent('');
    setMemoryDate(new Date().toLocaleDateString('en-CA'));
    setLocationName('');
    setLatitude('');
    setLongitude('');
    setMood('Reflective');
    setCategory('Personal');
    setCustomCategory('');
    setEditorTags([]);
    setEditorTagDraft('');
    setPeopleInput('');
    setCollectionId('');
    setAiExcluded(false);
    setAiSummary('');
    setSentimentTone('');
    setEmotionalImpact('');
    setSentimentScore(null);
    setSentimentRationale('');
    setAttachedMedia([]);
    setError(null);
    setEditorOpen(true);
    if (options?.autoStartVoice) {
      void startVoiceAutoCapture();
    }
  };

  const openEditEditor = (m: MemoryItem) => {
    setEditingId(m.id);
    setTitle(m.title);
    setContent(m.content);
    setMemoryDate(m.memoryDate);
    setLocationName(m.locationName);
    setLatitude(m.latitude !== null ? String(m.latitude) : '');
    setLongitude(m.longitude !== null ? String(m.longitude) : '');
    setMood(m.mood);
    const matchedDefault = DEFAULT_CATEGORIES.find(
      (c) => c.toLowerCase() === m.category.trim().toLowerCase()
    );
    if (matchedDefault) {
      setCategory(matchedDefault);
      setCustomCategory('');
    } else {
      setCategory('Custom');
      setCustomCategory(m.category);
    }
    setEditorTags(m.tags);
    setEditorTagDraft('');
    setPeopleInput(m.people.join(', '));
    setCollectionId(m.collectionId || '');
    setAiExcluded(m.aiExcluded);
    setAiSummary(m.aiSummary);
    setSentimentTone(m.sentimentTone || '');
    setEmotionalImpact(m.emotionalImpact || '');
    setSentimentScore(m.sentimentScore ?? null);
    setSentimentRationale(m.sentimentRationale || '');
    setAttachedMedia(m.media);
    setError(null);
    setEditorOpen(true);
  };

  const addEditorTag = (raw: string) => {
    const clean = raw.trim().replace(/^#+/, '').slice(0, 40);
    if (!clean) return;
    setEditorTags((prev) =>
      prev.some((t) => t.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean]
    );
    setEditorTagDraft('');
  };

  const toggleEditorTag = (tag: string) => {
    setEditorTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev, tag]
    );
  };

  const handleGenerateAiTitleSummary = async () => {
    if (!content.trim()) return;
    setAiBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ title?: string; summary?: string }>('/ai/assist', {
        method: 'POST',
        body: JSON.stringify({ mode: 'title_and_summary', text: content }),
      });
      if (res.title && !title.trim()) setTitle(res.title);
      if (res.summary) setAiSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI assist unavailable.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleAnalyzeDraftSentiment = async () => {
    if (!content.trim()) return;
    setAnalyzingDraftSentiment(true);
    setError(null);
    try {
      const res = await apiRequest<{
        tone: string;
        suggestedMood: string;
        emotionalImpact: string;
        valenceScore: number;
        rationale: string;
      }>('/ai/analyze-sentiment', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), content: content.trim(), mood }),
      });
      setSentimentTone(res.tone);
      setEmotionalImpact(res.emotionalImpact);
      setSentimentScore(res.valenceScore);
      setSentimentRationale(res.rationale);
      if (res.suggestedMood && MOODS.includes(res.suggestedMood)) {
        setMood(res.suggestedMood);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sentiment analysis unavailable.');
    } finally {
      setAnalyzingDraftSentiment(false);
    }
  };

  const handleAnalyzeBatchSentiment = async () => {
    setSentimentBusy(true);
    setSentimentNotice(null);
    try {
      const res = await apiRequest<{ analyzedCount: number; memories: MemoryItem[] }>(
        '/memories/analyze-sentiment-batch',
        {
          method: 'POST',
          body: JSON.stringify({ applyMood: true }),
        }
      );
      setSentimentNotice(
        res.analyzedCount > 0
          ? `Analyzed emotional tone & impact for ${res.analyzedCount} memory entry(s).`
          : 'All eligible memories already have emotional impact analysis.'
      );
      await loadMemories();
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Batch sentiment analysis failed.');
    } finally {
      setSentimentBusy(false);
    }
  };

  const handleAnalyzeSingleMemory = async (memoryId: string) => {
    setAnalyzingMemoryId(memoryId);
    setSentimentNotice(null);
    try {
      const res = await apiRequest<{ memory: MemoryItem }>(`/memories/${encodeURIComponent(memoryId)}/analyze-sentiment`, {
        method: 'POST',
        body: JSON.stringify({ applyMood: true }),
      });
      setMemories((prev) => prev.map((x) => (x.id === memoryId ? res.memory : x)));
      if (activeMemory?.id === memoryId) {
        setActiveMemory(res.memory);
      }
      const summaryRes = await apiRequest<SentimentSummary>('/memories/sentiment-summary');
      setSentimentSummary(summaryRes);
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Unable to analyze memory sentiment.');
    } finally {
      setAnalyzingMemoryId(null);
    }
  };

  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (voiceAutoPhase !== 'idle') return;
    setError(null);

    if (category === 'Custom' && !customCategory.trim()) {
      setError('Please enter a custom category name.');
      return;
    }

    let parsedLat: number | null = null;
    if (latitude.trim()) {
      const n = Number(latitude.trim());
      if (!Number.isFinite(n) || n < -90 || n > 90) {
        setError('Latitude must be a valid number between -90 and 90.');
        return;
      }
      parsedLat = n;
    }

    let parsedLng: number | null = null;
    if (longitude.trim()) {
      const n = Number(longitude.trim());
      if (!Number.isFinite(n) || n < -180 || n > 180) {
        setError('Longitude must be a valid number between -180 and 180.');
        return;
      }
      parsedLng = n;
    }

    setSaving(true);
    const chosenCategory = category === 'Custom' ? customCategory.trim() : category;
    const pendingDraftTag = editorTagDraft.trim().replace(/^#+/, '').slice(0, 40);
    const finalTags =
      pendingDraftTag && !editorTags.some((t) => t.toLowerCase() === pendingDraftTag.toLowerCase())
        ? [...editorTags, pendingDraftTag]
        : editorTags;

    const payload = {
      title: title.trim() || 'Untitled Memory',
      content: content.trim(),
      memoryDate,
      locationName: locationName.trim(),
      latitude: parsedLat,
      longitude: parsedLng,
      mood,
      category: chosenCategory,
      aiExcluded,
      aiSummary,
      sentimentTone,
      emotionalImpact,
      sentimentScore,
      sentimentRationale,
      autoAnalyzeSentiment: !editingId && !aiExcluded && !emotionalImpact && Boolean(user?.aiConsent),
      collectionId: collectionId || null,
      tags: finalTags,
      people: peopleInput.split(',').map((p) => p.trim()).filter(Boolean),
      mediaIds: attachedMedia.map((m) => m.id),
    };

    try {
      if (!isOnline && !editingId) {
        await queueMutation({
          endpoint: '/memories',
          payload,
          label: `Memory: ${payload.title}`,
        });
        setEditorOpen(false);
        return;
      }

      if (editingId) {
        const res = await apiRequest<{ memory: MemoryItem }>(`/memories/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setActiveMemory(res.memory);
      } else {
        await apiRequest<{ memory: MemoryItem }>('/memories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditorOpen(false);
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    setSentimentNotice(null);
    try {
      await apiRequest(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (activeMemory?.id === id) setActiveMemory(null);
      await loadMemories();
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Failed to delete memory.');
    }
  };

  const handleToggleFavorite = async (m: MemoryItem) => {
    setSentimentNotice(null);
    try {
      const res = await apiRequest<{ isFavorite: boolean }>(`/memories/${encodeURIComponent(m.id)}/favorite`, {
        method: 'POST',
      });
      setMemories((prev) => prev.map((x) => (x.id === m.id ? { ...x, isFavorite: res.isFavorite } : x)));
      if (activeMemory?.id === m.id) {
        setActiveMemory({ ...activeMemory, isFavorite: res.isFavorite });
      }
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Unable to update favorite status.');
    }
  };

  const handleRandomMemory = async () => {
    setSentimentNotice(null);
    try {
      const res = await apiRequest<{ memory: MemoryItem | null }>('/memories/random');
      if (res.memory) setActiveMemory(res.memory);
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Unable to fetch random memory.');
    }
  };

  const handleExportMemories = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), memories }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    setSentimentNotice(null);
    try {
      await apiRequest('/collections', {
        method: 'POST',
        body: JSON.stringify({ name: newCollectionName.trim(), description: newCollectionDesc.trim() }),
      });
      setNewCollectionName('');
      setNewCollectionDesc('');
      await loadMemories();
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Failed to create collection.');
    }
  };

  const toggleTagFilter = (tag: string) => {
    setSelectedTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev, tag]
    );
  };

  const handleUpdateMemoryTags = async (memoryId: string, nextTags: string[]) => {
    setSentimentNotice(null);
    try {
      const res = await apiRequest<{ memory: MemoryItem }>(`/memories/${encodeURIComponent(memoryId)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: nextTags }),
      });
      setMemories((prev) => prev.map((x) => (x.id === memoryId ? res.memory : x)));
      if (activeMemory?.id === memoryId) {
        setActiveMemory(res.memory);
      }
      const tagsRes = await apiRequest<{ tags: Array<{ tag: string; count: number }> }>('/memories/tags');
      setAllTagsDirectory(tagsRes.tags);
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Unable to update memory tags.');
    }
  };

  const handleUpdateMemoryCategory = async (memoryId: string, nextCategory: string) => {
    const clean = nextCategory.trim().slice(0, 48);
    if (!clean) return;
    setUpdatingCategoryId(memoryId);
    setSentimentNotice(null);
    try {
      const res = await apiRequest<{ memory: MemoryItem }>(`/memories/${encodeURIComponent(memoryId)}/category`, {
        method: 'POST',
        body: JSON.stringify({ category: clean }),
      });
      setMemories((prev) => prev.map((x) => (x.id === memoryId ? res.memory : x)));
      if (activeMemory?.id === memoryId) {
        setActiveMemory(res.memory);
      }
      const summaryRes = await apiRequest<SentimentSummary>('/memories/sentiment-summary');
      setSentimentSummary(summaryRes);
    } catch (err) {
      setSentimentNotice(err instanceof Error ? err.message : 'Unable to update memory category.');
    } finally {
      setUpdatingCategoryId(null);
    }
  };

  const handleRenameTag = async (oldTag: string) => {
    const cleanNew = renameTagDraft.trim().replace(/^#+/, '').slice(0, 40);
    if (!cleanNew || cleanNew.toLowerCase() === oldTag.toLowerCase()) {
      setEditingTag(null);
      return;
    }
    setTagManagerBusy(true);
    setTagManagerNotice(null);
    try {
      const res = await apiRequest<{ updatedCount: number }>('/memories/tags/rename', {
        method: 'PUT',
        body: JSON.stringify({ oldTag, newTag: cleanNew }),
      });
      setSelectedTags((prev) => prev.map((t) => (t.toLowerCase() === oldTag.toLowerCase() ? cleanNew : t)));
      if (activeAssignTag.toLowerCase() === oldTag.toLowerCase()) setActiveAssignTag(cleanNew);
      setEditingTag(null);
      setRenameTagDraft('');
      setTagManagerNotice(`Renamed "#${oldTag}" to "#${cleanNew}" across ${res.updatedCount} memory entry(s).`);
      await loadMemories();
    } catch (err) {
      setTagManagerNotice(err instanceof Error ? err.message : 'Unable to rename tag.');
    } finally {
      setTagManagerBusy(false);
    }
  };

  const handleDeleteGlobalTag = async (tag: string) => {
    setTagManagerBusy(true);
    setTagManagerNotice(null);
    try {
      const res = await apiRequest<{ updatedCount: number }>(`/memories/tags/${encodeURIComponent(tag)}`, {
        method: 'DELETE',
      });
      setSelectedTags((prev) => prev.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
      setDeletingTag(null);
      setTagManagerNotice(`Removed "#${tag}" from ${res.updatedCount} memory entry(s).`);
      await loadMemories();
    } catch (err) {
      setTagManagerNotice(err instanceof Error ? err.message : 'Unable to delete tag.');
    } finally {
      setTagManagerBusy(false);
    }
  };

  const categoryCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of sentimentSummary?.categoryCounts || []) {
      map.set(item.category.toLowerCase(), item.count);
    }
    if (map.size === 0) {
      for (const m of memories) {
        const key = m.category.trim().toLowerCase();
        if (key) map.set(key, (map.get(key) || 0) + 1);
      }
    }
    return map;
  }, [sentimentSummary?.categoryCounts, memories]);

  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const c of DEFAULT_CATEGORIES) {
      const key = c.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(c);
      }
    }
    for (const item of sentimentSummary?.categoryCounts || []) {
      const clean = item.category.trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        list.push(clean);
      }
    }
    for (const m of memories) {
      const clean = m.category.trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        list.push(clean);
      }
    }
    return list;
  }, [sentimentSummary?.categoryCounts, memories]);

  const filterStripCategories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const c of PRIMARY_CATEGORIES) {
      seen.add(c.toLowerCase());
      list.push(c);
    }
    for (const item of sentimentSummary?.categoryCounts || []) {
      const clean = item.category.trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        list.push(clean);
      }
    }
    return list;
  }, [sentimentSummary?.categoryCounts]);

  const peopleDirectory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories) {
      for (const p of m.people) {
        counts.set(p, (counts.get(p) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [memories]);

  const filteredTagDirectory = useMemo(() => {
    const q = tagSearch.trim().toLowerCase().replace(/^#+/, '');
    if (!q) return allTagsDirectory;
    return allTagsDirectory.filter((item) => item.tag.toLowerCase().includes(q));
  }, [allTagsDirectory, tagSearch]);

  const calendarDays = useMemo(() => {
    const safeMonth = /^\d{4}-\d{2}$/.test(calendarMonth)
      ? calendarMonth
      : new Date().toLocaleDateString('en-CA').slice(0, 7);
    const [yr, mo] = safeMonth.split('-').map(Number);
    const firstDay = new Date(yr, mo - 1, 1).getDay();
    const totalDays = new Date(yr, mo, 0).getDate();
    const cells: Array<{ day: number | null; iso: string | null; items: MemoryItem[] }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, iso: null, items: [] });
    for (let d = 1; d <= totalDays; d++) {
      const iso = `${safeMonth}-${String(d).padStart(2, '0')}`;
      cells.push({
        day: d,
        iso,
        items: memories.filter((m) => m.memoryDate === iso),
      });
    }
    return cells;
  }, [calendarMonth, memories]);

  return (
    <div className="space-y-5 min-w-0 w-full">
      {/* Header & Primary Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">ECHO Memory</h1>
          <p className="text-sm text-ink-muted">
            Your private life archive across time, places, people, and voice.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRandomMemory}
            disabled={memories.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink-secondary hover:bg-tint-hover disabled:opacity-40 whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Shuffle className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
            Random
          </button>
          <button
            type="button"
            onClick={() => memories.length > 0 && setSlideshowIndex(0)}
            disabled={memories.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink-secondary hover:bg-tint-hover disabled:opacity-40 whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Play className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
            Slideshow
          </button>
          <button
            type="button"
            onClick={handleExportMemories}
            disabled={memories.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink-secondary hover:bg-tint-hover disabled:opacity-40 whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Download className="w-3.5 h-3.5 text-ink-secondary" />
            Export
          </button>
          <button
            type="button"
            onClick={() => openNewEditor({ autoStartVoice: true })}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Mic className="w-4 h-4" />
            Voice Memory
          </button>
          <button
            type="button"
            onClick={() => openNewEditor()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Plus className="w-4 h-4" />
            New Memory
          </button>
        </div>
      </div>

      {/* Horizontal Chronological Timeline Visualization */}
      <HorizontalMemoryTimeline
        memories={memories}
        selectedYear={selectedYear}
        selectedDate={selectedDateJump}
        activeMemoryId={activeMemory?.id || null}
        onSelectYear={handleSelectTimelineYear}
        onJumpToDate={handleJumpToTimelineDate}
        onClearJump={handleClearTimelineJump}
      />

      {/* View Switcher & Search Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
        <div className="w-full lg:w-auto min-w-0 flex items-center gap-1 p-1 rounded-xl bg-surface border border-hairline overflow-x-auto no-scrollbar">
          {[
            { id: 'timeline', label: 'Timeline' },
            { id: 'calendar', label: 'Calendar' },
            { id: 'collections', label: 'Collections' },
            { id: 'map', label: 'Map' },
            { id: 'people', label: 'People' },
            { id: 'tags', label: `Tags (${allTagsDirectory.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id as typeof view)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                view === tab.id ? 'bg-accent text-accent-ink font-semibold' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0 w-full lg:w-auto">
          <div className="relative w-full sm:w-52">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void loadMemories()}
              placeholder="Search memories, tags..."
              className="w-full rounded-xl border border-hairline-strong bg-surface pl-8 pr-3 py-2 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            className="flex-1 sm:flex-none rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink-secondary focus:outline-none min-w-0"
          >
            <option value="All">All Categories</option>
            {availableCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={moodFilter}
            onChange={(e) => setMoodFilter(e.target.value)}
            aria-label="Filter by mood or tone"
            className="flex-1 sm:flex-none rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink-secondary focus:outline-none min-w-0"
          >
            <option value="All">All Moods & Tones</option>
            {Array.from(new Set([...MOODS, ...(sentimentSummary?.tones.map((t) => t.tone) || [])])).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setFavoritesOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              favoritesOnly
                ? 'border-rose-400/50 bg-rose-400/15 text-rose-700 dark:text-rose-200'
                : 'border-hairline-strong bg-surface text-ink-secondary hover:text-ink'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-current' : ''}`} />
            Favorites
          </button>
          <button
            type="button"
            onClick={() => void loadMemories()}
            className="rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-tint-hover"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Category Tag Filter Strip */}
      {view !== 'tags' && (
        <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap shrink-0 mr-1">
            Category:
          </span>
          <button
            type="button"
            onClick={() => setCategoryFilter('All')}
            className={`touch-manipulation inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
              categoryFilter === 'All'
                ? 'border-accent-border bg-accent-soft text-accent-text font-semibold'
                : 'border-hairline bg-inset text-ink-secondary hover:text-ink'
            }`}
          >
            <span>All</span>
            {sentimentSummary && (
              <span className="font-mono text-[11px] text-ink-muted tabular-nums">
                {sentimentSummary.totalMemories}
              </span>
            )}
          </button>
          {filterStripCategories.map((cat) => {
            const style = getCategoryStyle(cat);
            const active = categoryFilter.toLowerCase() === cat.toLowerCase();
            const count = categoryCountMap.get(cat.toLowerCase()) || 0;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(active ? 'All' : cat)}
                className={`touch-manipulation inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                  active ? style.activeClass : style.badgeClass
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: style.dotHex }}
                  aria-hidden="true"
                />
                <span>{cat}</span>
                <span className="font-mono text-[11px] opacity-75 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Emotional Impact Filter & AI Sentiment Strip */}
      {view !== 'tags' && (
        <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap shrink-0 mr-1">
              Emotional Impact:
            </span>
            <button
              type="button"
              onClick={() => setImpactFilter('All')}
              className={`touch-manipulation inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                impactFilter === 'All'
                  ? 'border-sky-400 bg-sky-400/15 text-sky-800 dark:text-sky-200 font-semibold'
                  : 'border-hairline bg-inset text-ink-secondary hover:text-ink'
              }`}
            >
              <span>All</span>
              {sentimentSummary && (
                <span className="font-mono text-[11px] text-ink-muted tabular-nums">
                  {sentimentSummary.totalMemories}
                </span>
              )}
            </button>
            {EMOTIONAL_IMPACTS.map((imp) => {
              const count = sentimentSummary?.impactCounts?.[imp.id] || 0;
              const active = impactFilter.toLowerCase() === imp.id.toLowerCase();
              return (
                <button
                  key={imp.id}
                  type="button"
                  onClick={() => setImpactFilter(active ? 'All' : imp.id)}
                  className={`touch-manipulation inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                    active
                      ? imp.activeClass
                      : 'border-hairline bg-inset text-ink-secondary hover:text-ink hover:border-hairline-strong'
                  }`}
                >
                  <span className={active ? '' : imp.textClass}>{imp.label}</span>
                  <span className="font-mono text-[11px] text-ink-muted tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between xl:justify-end gap-2.5 shrink-0">
            {sentimentSummary && sentimentSummary.analyzableUnanalyzedCount > 0 ? (
              <button
                type="button"
                onClick={() => void handleAnalyzeBatchSentiment()}
                disabled={sentimentBusy || !user?.aiConsent}
                title={
                  user?.aiConsent
                    ? 'Run AI sentiment analysis on uncategorized memories'
                    : 'Enable ECHO AI in Profile privacy settings to analyze sentiment'
                }
                className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-45 whitespace-nowrap shrink-0 min-h-[36px]"
              >
                {sentimentBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {sentimentBusy
                  ? 'Analyzing Tone...'
                  : `Analyze Sentiment (${Math.min(sentimentSummary.analyzableUnanalyzedCount, 15)})`}
              </button>
            ) : (
              sentimentSummary &&
              sentimentSummary.totalMemories > 0 && (
                <span className="text-[11px] text-ink-muted whitespace-nowrap">
                  {sentimentSummary.unanalyzedCount === 0
                    ? 'All memories analyzed'
                    : `${sentimentSummary.unanalyzedCount} excluded from AI`}
                </span>
              )
            )}
          </div>
        </div>
      )}

      {sentimentNotice && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs text-cyan-900 dark:text-cyan-100 flex items-center justify-between gap-2">
          <span>{sentimentNotice}</span>
          <button type="button" onClick={() => setSentimentNotice(null)} className="shrink-0 hover:opacity-80">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Quick Tag Filter Strip */}
      {allTagsDirectory.length > 0 && view !== 'tags' && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted shrink-0">
            <Tag className="w-3 h-3 text-sky-500 dark:text-sky-400" />
            Tags:
          </span>
          {allTagsDirectory.slice(0, 14).map((item) => {
            const active = selectedTags.some((t) => t.toLowerCase() === item.tag.toLowerCase());
            return (
              <button
                key={item.tag}
                type="button"
                onClick={() => toggleTagFilter(item.tag)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-sky-400 bg-sky-400/20 text-sky-800 dark:text-sky-200 font-semibold'
                    : 'border-hairline bg-surface text-ink-secondary hover:border-hairline-strong hover:text-ink'
                }`}
              >
                <span>#{item.tag}</span>
                <span className="font-mono text-[10px] text-ink-muted tabular-nums">{item.count}</span>
              </button>
            );
          })}
          {selectedTags.length > 1 && (
            <button
              type="button"
              onClick={() => setTagFilterMode((m) => (m === 'any' ? 'all' : 'any'))}
              className="rounded-lg border border-hairline-strong bg-inset px-2.5 py-1 text-[11px] font-mono text-sky-700 dark:text-sky-300 whitespace-nowrap shrink-0"
              title="Toggle whether memories must match ANY or ALL selected tags"
            >
              Match: {tagFilterMode.toUpperCase()}
            </button>
          )}
          <button
            type="button"
            onClick={() => setView('tags')}
            className="rounded-lg border border-hairline-strong bg-tint px-2.5 py-1 text-[11px] font-medium text-ink-secondary hover:text-ink whitespace-nowrap shrink-0"
          >
            Manage Tags
          </button>
        </div>
      )}

      {(categoryFilter !== 'All' || selectedCollectionId || selectedPerson || selectedTags.length > 0 || impactFilter !== 'All' || moodFilter !== 'All' || selectedYear || selectedDateJump) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-sky-700 dark:text-sky-300">
          <span>
            Filtered by{' '}
            {[
              selectedYear ? `Year: ${selectedYear}` : null,
              selectedDateJump ? `Date: ${selectedDateJump}` : null,
              categoryFilter !== 'All' ? `Category: ${categoryFilter}` : null,
              impactFilter !== 'All' ? `Impact: ${impactFilter}` : null,
              moodFilter !== 'All' ? `Tone: ${moodFilter}` : null,
              selectedPerson ? `Person: ${selectedPerson}` : null,
              selectedCollectionId ? 'Collection' : null,
              selectedTags.length > 0
                ? `Tags (${tagFilterMode === 'all' ? 'all' : 'any'}): ${selectedTags.map((t) => `#${t}`).join(', ')}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <button
            type="button"
            onClick={() => {
              setCategoryFilter('All');
              setImpactFilter('All');
              setMoodFilter('All');
              setSelectedCollectionId(null);
              setSelectedPerson(null);
              setSelectedTags([]);
              setSelectedYear(null);
              setSelectedDateJump(null);
            }}
            className="underline hover:text-ink"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* VIEW: TIMELINE */}
      {view === 'timeline' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`${activeMemory ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-4 min-w-0`}>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 rounded-2xl bg-tint animate-pulse" />
                ))}
              </div>
            ) : displayedMemories.length === 0 ? (
              <div className="rounded-2xl border border-hairline bg-surface p-10 text-center space-y-3">
                <p className="font-display text-lg font-semibold text-ink">No memories match this view yet</p>
                <p className="text-sm text-ink-muted max-w-md mx-auto">
                  Record a story, attach photos or voice notes, and organize them by people, places, and mood.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => openNewEditor({ autoStartVoice: true })}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2.5 text-xs font-semibold text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/20 transition-colors"
                  >
                    <Mic className="w-4 h-4" /> Record Voice Memory
                  </button>
                  <button
                    type="button"
                    onClick={() => openNewEditor()}
                    className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Capture First Memory
                  </button>
                </div>
              </div>
            ) : (
              <div className={activeMemory ? 'space-y-4' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
                {displayedMemories.map((m, index) => (
                  <article
                    key={m.id}
                    id={`memory-card-${m.id}`}
                    onClick={() => {
                      setActiveMemory(m);
                      setSelectedDateJump(m.memoryDate);
                    }}
                    className={`echo-memory-card-enter ${CARD_ENTRY_DELAY_CLASSES[Math.min(index, CARD_ENTRY_DELAY_CLASSES.length - 1)]} touch-manipulation cursor-pointer rounded-2xl border p-5 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 space-y-3 ${
                      activeMemory?.id === m.id || (selectedDateJump && m.memoryDate === selectedDateJump)
                        ? 'border-sky-400/50 bg-surface-raised'
                        : 'border-hairline bg-surface hover:border-hairline-strong'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs text-ink-muted font-mono tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span>{m.memoryDate}</span>
                        <span aria-hidden="true">·</span>
                        <span>{m.sentimentTone || m.mood}</span>
                        {m.emotionalImpact && (
                          <>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setImpactFilter(m.emotionalImpact);
                              }}
                              className={`font-sans font-semibold hover:underline ${getImpactStyle(m.emotionalImpact).textClass}`}
                              title={`Filter by ${m.emotionalImpact} impact`}
                            >
                              {m.emotionalImpact}
                            </button>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleToggleFavorite(m);
                        }}
                        aria-label="Toggle favorite"
                        className="text-ink-muted hover:text-rose-600 dark:hover:text-rose-300 p-1 shrink-0"
                      >
                        <Heart className={`w-4 h-4 ${m.isFavorite ? 'fill-rose-400 text-rose-400' : ''}`} />
                      </button>
                    </div>
                    <h3 className="font-display text-lg font-semibold text-ink">{m.title}</h3>
                    <p className="text-sm text-ink-secondary line-clamp-3 leading-relaxed">{m.content}</p>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-muted pt-1">
                      {(() => {
                        const catStyle = getCategoryStyle(m.category);
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCategoryFilter(
                                categoryFilter.toLowerCase() === m.category.toLowerCase() ? 'All' : m.category
                              );
                            }}
                            title={`Filter by ${m.category}`}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${catStyle.badgeClass}`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: catStyle.dotHex }}
                              aria-hidden="true"
                            />
                            {m.category}
                          </button>
                        );
                      })()}
                      {m.locationName && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-sky-500 dark:text-sky-400" /> {m.locationName}
                        </span>
                      )}
                      {m.people.length > 0 && <span>With: {m.people.join(', ')}</span>}
                      {m.tags.length > 0 && (
                        <span className="inline-flex flex-wrap gap-1.5">
                          {m.tags.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTagFilter(t);
                              }}
                              className="rounded-md border border-hairline bg-inset px-1.5 py-0.5 text-[11px] text-sky-700 dark:text-sky-300 hover:border-sky-400/50"
                            >
                              #{t}
                            </button>
                          ))}
                        </span>
                      )}
                      {m.media.length > 0 && <span>{m.media.length} attachment(s)</span>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {activeMemory && (
            <aside className="lg:col-span-5 rounded-2xl border border-hairline bg-surface p-6 space-y-5 h-fit lg:sticky lg:top-6">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-sky-700 dark:text-sky-300 font-mono tabular-nums">
                    <span>{activeMemory.memoryDate} · {activeMemory.sentimentTone || activeMemory.mood}</span>
                    {(() => {
                      const catStyle = getCategoryStyle(activeMemory.category);
                      return (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-sans text-[11px] font-medium ${catStyle.badgeClass}`}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: catStyle.dotHex }}
                            aria-hidden="true"
                          />
                          {activeMemory.category}
                        </span>
                      );
                    })()}
                  </div>
                  <h2 className="font-display text-2xl font-bold text-ink">{activeMemory.title}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveMemory(null)}
                  className="p-1.5 text-ink-muted hover:text-ink rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {activeMemory.aiSummary && (
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3.5 text-xs text-cyan-900 dark:text-cyan-100 leading-relaxed">
                  <span className="font-semibold text-cyan-700 dark:text-cyan-300">AI Summary: </span>
                  {activeMemory.aiSummary}
                </div>
              )}

              {/* AI Sentiment & Emotional Impact Insight */}
              <div className="rounded-xl border border-hairline bg-inset p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-ink-secondary">Emotional Impact & Tone</div>
                  <button
                    type="button"
                    onClick={() => void handleAnalyzeSingleMemory(activeMemory.id)}
                    disabled={analyzingMemoryId === activeMemory.id || !user?.aiConsent}
                    className="touch-manipulation inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-45"
                  >
                    {analyzingMemoryId === activeMemory.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {analyzingMemoryId === activeMemory.id
                      ? 'Analyzing...'
                      : activeMemory.emotionalImpact
                        ? 'Re-analyze'
                        : 'Analyze Tone'}
                  </button>
                </div>

                {activeMemory.emotionalImpact ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${getImpactStyle(activeMemory.emotionalImpact).textClass}`}>
                          {activeMemory.emotionalImpact}
                        </span>
                        <span className="text-ink-muted" aria-hidden="true">·</span>
                        <span className="text-ink font-medium">{activeMemory.sentimentTone || activeMemory.mood}</span>
                      </div>
                      {activeMemory.sentimentScore !== null && (
                        <span className="font-mono text-[11px] text-ink-muted tabular-nums">
                          Valence {activeMemory.sentimentScore > 0 ? `+${activeMemory.sentimentScore}` : activeMemory.sentimentScore}
                        </span>
                      )}
                    </div>

                    {activeMemory.sentimentScore !== null && (
                      <div className="h-1.5 w-full rounded-full bg-tint overflow-hidden" aria-label="Emotional valence bar">
                        <div
                          className={`h-full rounded-full transition-all ${getImpactStyle(activeMemory.emotionalImpact).barClass}`}
                          style={{
                            width: `${Math.max(8, Math.min(100, Math.round((activeMemory.sentimentScore + 100) / 2)))}%`,
                          }}
                        />
                      </div>
                    )}

                    {activeMemory.sentimentRationale && (
                      <p className="text-xs text-ink-muted leading-relaxed">{activeMemory.sentimentRationale}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">
                    Not yet analyzed. Run AI sentiment analysis to classify emotional impact and tone.
                  </p>
                )}
              </div>

              <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap">{activeMemory.content}</p>

              {activeMemory.media.length > 0 && (
                <div className="space-y-3">
                  {activeMemory.media.map((med) => (
                    <div key={med.id} className="space-y-1.5">
                      <AuthMedia mediaId={med.id} mimeTypeHint={med.mime_type || med.mimeType} />
                      {med.transcript && (
                        <p className="text-xs text-ink-muted italic">Transcript: "{med.transcript}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3 text-xs text-ink-muted border-t border-hairline pt-4">
                {activeMemory.locationName && <div>Location: {activeMemory.locationName}</div>}
                {activeMemory.people.length > 0 && <div>People: {activeMemory.people.join(', ')}</div>}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-secondary">Category</span>
                    {updatingCategoryId === activeMemory.id && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                        <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRIMARY_CATEGORIES.map((cat) => {
                      const style = getCategoryStyle(cat);
                      const isCurrent = activeMemory.category.toLowerCase() === cat.toLowerCase();
                      return (
                        <button
                          key={cat}
                          type="button"
                          disabled={updatingCategoryId === activeMemory.id}
                          onClick={() => void handleUpdateMemoryCategory(activeMemory.id, cat)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                            isCurrent ? style.activeClass : style.badgeClass
                          }`}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: style.dotHex }}
                            aria-hidden="true"
                          />
                          {cat}
                        </button>
                      );
                    })}
                    <select
                      aria-label="Choose category"
                      value={
                        availableCategories.find(
                          (c) => c.toLowerCase() === activeMemory.category.toLowerCase()
                        ) || activeMemory.category
                      }
                      disabled={updatingCategoryId === activeMemory.id}
                      onChange={(e) => void handleUpdateMemoryCategory(activeMemory.id, e.target.value)}
                      className="rounded-full border border-hairline-strong bg-inset px-2.5 py-1 text-[11px] text-ink-secondary focus:outline-none"
                    >
                      {availableCategories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="font-medium text-ink-secondary">Tags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeMemory.tags.length === 0 ? (
                      <span className="text-ink-muted">No tags assigned yet</span>
                    ) : (
                      activeMemory.tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-inset px-2 py-1 text-xs text-sky-700 dark:text-sky-300"
                        >
                          <button
                            type="button"
                            onClick={() => toggleTagFilter(t)}
                            className="hover:underline"
                            title="Filter timeline by this tag"
                          >
                            #{t}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleUpdateMemoryTags(
                                activeMemory.id,
                                activeMemory.tags.filter((x) => x !== t)
                              )
                            }
                            aria-label={`Remove tag ${t}`}
                            className="text-ink-muted hover:text-rose-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const clean = detailTagDraft.trim().replace(/^#+/, '').slice(0, 40);
                      if (!clean) return;
                      setDetailTagDraft('');
                      if (activeMemory.tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
                        return;
                      }
                      void handleUpdateMemoryTags(activeMemory.id, [...activeMemory.tags, clean]);
                    }}
                    className="flex items-center gap-2 pt-1"
                  >
                    <input
                      type="text"
                      value={detailTagDraft}
                      onChange={(e) => setDetailTagDraft(e.target.value)}
                      placeholder="Add tag..."
                      className="flex-1 min-w-0 rounded-lg border border-hairline-strong bg-inset px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                    />
                    <button
                      type="submit"
                      disabled={!detailTagDraft.trim()}
                      className="rounded-lg border border-hairline-strong bg-tint px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-tint-hover disabled:opacity-40"
                    >
                      Add
                    </button>
                  </form>
                </div>
                <div>AI Access: {activeMemory.aiExcluded ? 'Excluded from AI' : 'Accessible to ECHO AI'}</div>
              </div>

              {relatedMemories.length > 0 && (
                <div className="border-t border-hairline pt-4 space-y-2">
                  <div className="text-xs font-semibold text-ink-secondary inline-flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" /> Related Memories
                  </div>
                  <div className="space-y-1.5">
                    {relatedMemories.map((rel) => (
                      <button
                        key={rel.id}
                        type="button"
                        onClick={() => setActiveMemory(rel)}
                        className="w-full text-left rounded-lg border border-hairline bg-inset px-3 py-2 text-xs hover:border-sky-400/50"
                      >
                        <div className="font-medium text-ink">{rel.title}</div>
                        <div className="text-ink-muted font-mono tabular-nums">{rel.memoryDate} · {rel.category}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => openEditEditor(activeMemory)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-strong bg-tint px-3 py-2 text-xs font-medium text-ink hover:bg-tint-hover"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteMemory(activeMemory.id)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-200 hover:bg-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* VIEW: CALENDAR */}
      {view === 'calendar' && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-sky-500 dark:text-sky-400" /> Memory Calendar
            </h2>
            <input
              type="month"
              value={calendarMonth}
              onChange={(e) => setCalendarMonth(e.target.value)}
              className="rounded-xl border border-hairline-strong bg-inset px-3 py-1.5 text-xs text-ink font-mono w-full sm:w-auto"
            />
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-xs text-ink-muted">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={`weekday-${i}`} className="py-1">{d}</div>
            ))}
            {calendarDays.map((cell, idx) => (
              <button
                key={cell.iso ?? `empty-${idx}`}
                type="button"
                disabled={!cell.day}
                onClick={() => cell.iso && setSelectedDay(cell.iso)}
                className={`min-h-[48px] sm:min-h-[68px] rounded-lg sm:rounded-xl border p-1 sm:p-2 text-left flex flex-col justify-between transition-colors ${
                  !cell.day
                    ? 'border-transparent bg-transparent cursor-default'
                    : selectedDay === cell.iso
                    ? 'border-sky-400 bg-sky-500/15'
                    : cell.items.length > 0
                    ? 'border-sky-500/35 bg-surface-raised hover:border-sky-400'
                    : 'border-hairline bg-inset hover:border-hairline-strong'
                }`}
              >
                <span className="font-mono text-[11px] sm:text-xs text-ink-secondary tabular-nums">{cell.day || ''}</span>
                {cell.items.length > 0 && (
                  <span className="text-[10px] sm:text-[11px] font-medium text-sky-700 dark:text-sky-300 truncate">
                    {cell.items.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {selectedDay && (
            <div className="pt-4 border-t border-hairline space-y-2">
              <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 font-mono">Memories on {selectedDay}</div>
              {memories.filter((m) => m.memoryDate === selectedDay).length === 0 ? (
                <p className="text-xs text-ink-muted">No memories saved on this date.</p>
              ) : (
                memories
                  .filter((m) => m.memoryDate === selectedDay)
                  .map((m, index) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        setActiveMemory(m);
                        setView('timeline');
                      }}
                      className={`echo-memory-card-enter ${CARD_ENTRY_DELAY_CLASSES[Math.min(index, CARD_ENTRY_DELAY_CLASSES.length - 1)]} touch-manipulation cursor-pointer rounded-xl border border-hairline bg-inset p-3 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-sky-400/50`}
                    >
                      <div className="text-sm font-semibold text-ink">{m.title}</div>
                      <div className="text-xs text-ink-muted line-clamp-2 mt-0.5">{m.content}</div>
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW: COLLECTIONS */}
      {view === 'collections' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={handleCreateCollection} className="rounded-2xl border border-hairline bg-surface p-6 space-y-4 h-fit">
            <h2 className="font-display text-base font-semibold text-ink inline-flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-sky-500 dark:text-sky-400" /> New Collection
            </h2>
            <input
              type="text"
              required
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="Collection title"
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted"
            />
            <textarea
              rows={2}
              value={newCollectionDesc}
              onChange={(e) => setNewCollectionDesc(e.target.value)}
              placeholder="Short description..."
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors"
            >
              Create Collection
            </button>
          </form>

          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {collections.length === 0 ? (
              <div className="sm:col-span-2 rounded-2xl border border-hairline bg-surface p-8 text-center text-sm text-ink-muted">
                Create collections to group related life chapters together.
              </div>
            ) : (
              collections.map((c) => (
                <div
                  key={c.id}
                  className="rounded-2xl border border-hairline bg-surface p-5 flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="font-display text-base font-semibold text-ink">{c.name}</div>
                    <p className="text-xs text-ink-muted mt-1">{c.description || 'Personal memory collection'}</p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-hairline">
                    <span className="text-xs font-mono text-sky-700 dark:text-sky-300 tabular-nums">{c.memory_count} memories</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCollectionId(c.id);
                        setView('timeline');
                      }}
                      className="text-xs font-medium text-ink hover:text-sky-600 dark:hover:text-sky-300"
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* VIEW: MAP (CONSTELLATION + WORLD ATLAS) */}
      {view === 'map' && (
        <MemoriesMapView
          memories={displayedMemories}
          allMemories={memories}
          onOpenMemory={(m) => {
            setActiveMemory(m);
            setView('timeline');
          }}
          onCreateMemory={() => openNewEditor()}
          onMemoryUpdated={(updated) => {
            setMemories((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            if (activeMemory?.id === updated.id) {
              setActiveMemory(updated);
            }
          }}
        />
      )}

      {/* VIEW: PEOPLE CONNECTED TO MEMORIES */}
      {view === 'people' && (
        <div className="rounded-2xl border border-hairline bg-surface p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-500 dark:text-sky-400" /> People Connected to Memories
          </h2>
          {peopleDirectory.length === 0 ? (
            <p className="text-sm text-ink-muted">Tag people in your memories to see your life connections here.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {peopleDirectory.map(([person, count]) => (
                <button
                  key={person}
                  type="button"
                  onClick={() => {
                    setSelectedPerson(person);
                    setView('timeline');
                  }}
                  className="rounded-xl border border-hairline bg-inset p-4 text-left hover:border-sky-400/50 flex items-center justify-between"
                >
                  <span className="text-sm font-medium text-ink">{person}</span>
                  <span className="text-xs font-mono text-sky-700 dark:text-sky-300 tabular-nums">{count} memories</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: TAG MANAGER */}
      {view === 'tags' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
          {/* Left: Global Tag Directory (Rename / Merge / Delete / Filter) */}
          <div className="lg:col-span-7 rounded-2xl border border-hairline bg-surface p-5 sm:p-6 space-y-5 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
                  <Tags className="w-4 h-4 text-sky-500 dark:text-sky-400" /> Tag Manager
                </h2>
                <p className="text-xs text-ink-muted">
                  Rename, merge, delete, or multi-select tags to filter your memory archive.
                </p>
              </div>
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setView('timeline')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 whitespace-nowrap shrink-0"
                >
                  View {selectedTags.length} Selected in Timeline
                </button>
              )}
            </div>

            {tagManagerNotice && (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5 text-xs text-sky-800 dark:text-sky-200 flex items-center justify-between gap-2">
                <span>{tagManagerNotice}</span>
                <button type="button" onClick={() => setTagManagerNotice(null)} className="shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="Filter tags..."
                  className="w-full rounded-xl border border-hairline-strong bg-inset pl-8 pr-3 py-2 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                />
              </div>
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTags([])}
                  className="rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink-secondary hover:text-ink"
                >
                  Clear selection ({selectedTags.length})
                </button>
              )}
            </div>

            {filteredTagDirectory.length === 0 ? (
              <div className="rounded-xl border border-hairline bg-inset p-6 text-center text-xs text-ink-muted">
                {allTagsDirectory.length === 0
                  ? 'No tags yet. Assign tags on any memory card or use the Categorize panel on the right.'
                  : 'No tags match your search.'}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTagDirectory.map((item) => {
                  const isSelected = selectedTags.some((t) => t.toLowerCase() === item.tag.toLowerCase());
                  const isEditing = editingTag === item.tag;
                  const isDeleting = deletingTag === item.tag;
                  return (
                    <div
                      key={item.tag}
                      className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                        isSelected
                          ? 'border-sky-400/60 bg-surface-raised'
                          : 'border-hairline bg-inset hover:border-hairline-strong'
                      }`}
                    >
                      {isEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleRenameTag(item.tag);
                          }}
                          className="flex-1 flex items-center gap-2 min-w-0"
                        >
                          <input
                            type="text"
                            autoFocus
                            value={renameTagDraft}
                            onChange={(e) => setRenameTagDraft(e.target.value)}
                            placeholder="New tag name..."
                            className="flex-1 min-w-0 rounded-lg border border-sky-400/50 bg-surface px-2.5 py-1.5 text-xs text-ink focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={tagManagerBusy}
                            className="inline-flex items-center gap-1 rounded-lg bg-sky-400 px-2.5 py-1.5 text-xs font-semibold text-slate-950"
                          >
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTag(null)}
                            className="rounded-lg border border-hairline-strong px-2.5 py-1.5 text-xs text-ink-secondary"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleTagFilter(item.tag)}
                            className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                          >
                            <span
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'border-sky-400 bg-sky-400 text-slate-950'
                                  : 'border-hairline-strong bg-surface'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </span>
                            <span className="text-sm font-medium text-ink truncate">#{item.tag}</span>
                            <span className="text-xs font-mono text-ink-muted tabular-nums shrink-0">
                              {item.count} {item.count === 1 ? 'memory' : 'memories'}
                            </span>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTags([item.tag]);
                                setView('timeline');
                              }}
                              className="rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300 hover:bg-tint-hover"
                            >
                              Filter
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTag(item.tag);
                                setRenameTagDraft(item.tag);
                                setDeletingTag(null);
                              }}
                              aria-label={`Rename ${item.tag}`}
                              className="rounded-lg border border-hairline-strong bg-surface p-1.5 text-ink-secondary hover:text-ink"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {isDeleting ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={tagManagerBusy}
                                  onClick={() => void handleDeleteGlobalTag(item.tag)}
                                  className="rounded-lg bg-rose-500 px-2 py-1 text-[11px] font-semibold text-white"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingTag(null)}
                                  className="rounded-lg border border-hairline-strong px-2 py-1 text-[11px] text-ink-secondary"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setDeletingTag(item.tag);
                                  setEditingTag(null);
                                }}
                                aria-label={`Delete ${item.tag}`}
                                className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-700 dark:text-rose-200 hover:bg-rose-500/20"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Batch Categorize & Tag Individual Entries */}
          <div className="lg:col-span-5 rounded-2xl border border-hairline bg-surface p-5 sm:p-6 space-y-4 h-fit min-w-0">
            <div className="space-y-1">
              <h3 className="font-display text-base font-semibold text-ink">Categorize Entries</h3>
              <p className="text-xs text-ink-muted">
                Choose or type an active tag, then click any memory below to toggle that tag on or off.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-ink-muted block">Active Tag to Apply</label>
              <input
                type="text"
                value={activeAssignTag}
                onChange={(e) => setActiveAssignTag(e.target.value)}
                placeholder="Type a tag name (e.g. family-trip)"
                className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
              />
              {allTagsDirectory.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {allTagsDirectory.slice(0, 10).map((t) => {
                    const isPicked = activeAssignTag.trim().toLowerCase() === t.tag.toLowerCase();
                    return (
                      <button
                        key={t.tag}
                        type="button"
                        onClick={() => setActiveAssignTag(t.tag)}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                          isPicked
                            ? 'border-sky-400 bg-sky-400 text-slate-950 font-semibold'
                            : 'border-hairline bg-inset text-ink-secondary hover:text-ink'
                        }`}
                      >
                        #{t.tag}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-hairline pt-3">
              <span className="text-xs font-medium text-ink-secondary">Memories</span>
              <div className="inline-flex rounded-lg border border-hairline bg-inset p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setBatchAssignFilter('untagged')}
                  className={`px-2.5 py-1 rounded-md ${
                    batchAssignFilter === 'untagged' ? 'bg-sky-400 text-slate-950 font-semibold' : 'text-ink-muted'
                  }`}
                >
                  Untagged ({memories.filter((m) => m.tags.length === 0).length})
                </button>
                <button
                  type="button"
                  onClick={() => setBatchAssignFilter('all')}
                  className={`px-2.5 py-1 rounded-md ${
                    batchAssignFilter === 'all' ? 'bg-sky-400 text-slate-950 font-semibold' : 'text-ink-muted'
                  }`}
                >
                  All ({memories.length})
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {memories
                .filter((m) => (batchAssignFilter === 'untagged' ? m.tags.length === 0 : true))
                .map((m) => {
                  const cleanAssign = activeAssignTag.trim().replace(/^#+/, '').slice(0, 40);
                  const hasActiveTag = cleanAssign
                    ? m.tags.some((t) => t.toLowerCase() === cleanAssign.toLowerCase())
                    : false;
                  return (
                    <div
                      key={m.id}
                      className="rounded-xl border border-hairline bg-inset p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="text-xs font-semibold text-ink truncate">{m.title}</div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-ink-muted tabular-nums">
                            <span>{m.memoryDate}</span>
                            {(() => {
                              const catStyle = getCategoryStyle(m.category);
                              return (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-sans text-[10px] font-medium ${catStyle.badgeClass}`}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: catStyle.dotHex }}
                                    aria-hidden="true"
                                  />
                                  {m.category}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            aria-label={`Category for ${m.title}`}
                            value={
                              availableCategories.find(
                                (c) => c.toLowerCase() === m.category.toLowerCase()
                              ) || m.category
                            }
                            disabled={updatingCategoryId === m.id}
                            onChange={(e) => void handleUpdateMemoryCategory(m.id, e.target.value)}
                            className="rounded-lg border border-hairline-strong bg-surface px-2 py-1 text-[11px] text-ink-secondary focus:outline-none max-w-[120px]"
                          >
                            {availableCategories.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          {cleanAssign && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextTags = hasActiveTag
                                  ? m.tags.filter((t) => t.toLowerCase() !== cleanAssign.toLowerCase())
                                  : [...m.tags, cleanAssign];
                                void handleUpdateMemoryTags(m.id, nextTags);
                              }}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold shrink-0 transition-colors ${
                                hasActiveTag
                                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-200'
                                  : 'bg-sky-400 text-slate-950 hover:bg-sky-300'
                              }`}
                            >
                              {hasActiveTag ? `✓ #${cleanAssign}` : `+ #${cleanAssign}`}
                            </button>
                          )}
                        </div>
                      </div>
                      {m.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {m.tags.map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300"
                            >
                              #{t}
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateMemoryTags(
                                    m.id,
                                    m.tags.filter((x) => x !== t)
                                  )
                                }
                                className="text-ink-muted hover:text-rose-500"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              {memories.filter((m) => (batchAssignFilter === 'untagged' ? m.tags.length === 0 : true)).length === 0 && (
                <p className="text-xs text-ink-muted text-center py-6">
                  {batchAssignFilter === 'untagged'
                    ? 'Every visible memory already has at least one tag.'
                    : 'No memories match your current view.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN SLIDESHOW MODAL (dark cinema mode across themes) */}
      {slideshowIndex !== null && memories[slideshowIndex] && (
        <div className="fixed inset-0 z-50 bg-[#050811]/95 backdrop-blur-lg flex flex-col justify-between p-6 sm:p-10">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {slideshowIndex + 1} / {memories.length} · {memories[slideshowIndex].memoryDate}
            </span>
            <button
              type="button"
              onClick={() => setSlideshowIndex(null)}
              className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Close Slideshow
            </button>
          </div>
          <div className="max-w-3xl mx-auto w-full space-y-5 text-center my-auto">
            <div className="text-xs text-sky-300">
              {memories[slideshowIndex].category} · {memories[slideshowIndex].mood}
              {memories[slideshowIndex].locationName ? ` · ${memories[slideshowIndex].locationName}` : ''}
            </div>
            <h2 className="font-display text-3xl sm:text-5xl font-bold text-white [text-wrap:balance]">
              {memories[slideshowIndex].title}
            </h2>
            <p className="text-base sm:text-lg text-slate-300 leading-relaxed whitespace-pre-wrap">
              {memories[slideshowIndex].content}
            </p>
            {memories[slideshowIndex].media[0] && (
              <div className="max-w-md mx-auto">
                <AuthMedia
                  mediaId={memories[slideshowIndex].media[0].id}
                  mimeTypeHint={memories[slideshowIndex].media[0].mime_type || memories[slideshowIndex].media[0].mimeType}
                  className="max-h-64"
                />
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setSlideshowIndex((i) => (i !== null ? (i - 1 + memories.length) % memories.length : 0))}
              className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white hover:bg-white/10 inline-flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <button
              type="button"
              onClick={() => setSlideshowIndex((i) => (i !== null ? (i + 1) % memories.length : 0))}
              className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 inline-flex items-center gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MEMORY MODAL */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveMemory}
            className="w-full max-w-2xl rounded-2xl border border-hairline-strong bg-surface p-4 sm:p-6 space-y-4 my-4 sm:my-8"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-ink">
                {editingId ? 'Edit Memory' : 'Capture New Memory'}
              </h2>
              <button
                type="button"
                onClick={closeEditor}
                aria-label="Close memory editor"
                className="p-1.5 text-ink-muted hover:text-ink"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!editingId && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3.5 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="space-y-0.5 min-w-0">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-ink">
                      <Mic className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-300 shrink-0" />
                      <span>Voice-to-Memory (SpeechRecognition)</span>
                      {voiceAutoPhase === 'recording' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-700 dark:text-rose-200 tabular-nums">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                          {String(Math.floor(voiceAutoSeconds / 60)).padStart(2, '0')}:
                          {String(voiceAutoSeconds % 60).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-muted">
                      Record your voice to transcribe live and automatically save as a new memory entry.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {voiceAutoPhase === 'idle' && (
                      <button
                        type="button"
                        onClick={() => void startVoiceAutoCapture()}
                        disabled={saving || !isBrowserSpeechSupported()}
                        className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-45 transition-colors whitespace-nowrap min-h-[38px]"
                      >
                        <Mic className="w-3.5 h-3.5" />
                        Record & Auto-Save
                      </button>
                    )}

                    {voiceAutoPhase === 'recording' && (
                      <>
                        <button
                          type="button"
                          onClick={cancelVoiceAutoCapture}
                          className="touch-manipulation rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs font-medium text-ink-secondary hover:text-ink whitespace-nowrap min-h-[38px]"
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          onClick={() => void stopAndSaveVoiceAutoCapture()}
                          className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-400 transition-colors whitespace-nowrap min-h-[38px]"
                        >
                          <Square className="w-3 h-3 fill-current" />
                          Stop & Save Memory
                        </button>
                      </>
                    )}

                    {voiceAutoPhase === 'saving' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-800 dark:text-cyan-200 whitespace-nowrap">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Saving memory...
                      </span>
                    )}
                  </div>
                </div>

                {voiceAutoPhase === 'recording' && (
                  <div className="rounded-lg border border-hairline bg-surface px-3 py-2 text-xs text-ink-secondary min-h-[44px]">
                    {voiceLiveTranscript ? (
                      <p className="leading-relaxed whitespace-pre-wrap">{voiceLiveTranscript}</p>
                    ) : (
                      <p className="text-ink-muted italic">Listening... speak your memory naturally.</p>
                    )}
                  </div>
                )}

                {!isBrowserSpeechSupported() && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Browser SpeechRecognition is unavailable here. Use a Chromium-based browser or type your memory below.
                  </p>
                )}

                {voiceAutoError && (
                  <p className="text-xs text-rose-600 dark:text-rose-300">{voiceAutoError}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Memory title"
                  className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
                />
                <button
                  type="button"
                  onClick={handleGenerateAiTitleSummary}
                  disabled={aiBusy || !content.trim() || !user?.aiConsent}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3 py-2.5 text-xs font-medium text-cyan-800 dark:text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {aiBusy ? 'Thinking...' : 'AI Title & Summary'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAnalyzeDraftSentiment()}
                  disabled={analyzingDraftSentiment || !content.trim() || !user?.aiConsent}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-400/10 px-3 py-2.5 text-xs font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-400/20 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  {analyzingDraftSentiment ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {analyzingDraftSentiment ? 'Detecting...' : 'AI Mood & Tone'}
                </button>
              </div>

              <div className="sm:col-span-2">
                <textarea
                  required
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe this moment in your own words..."
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
                />
              </div>

              {aiSummary && (
                <div className="sm:col-span-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3.5 py-2.5 text-xs text-cyan-900 dark:text-cyan-100">
                  AI Summary: {aiSummary}
                </div>
              )}

              {emotionalImpact && (
                <div className="sm:col-span-2 rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-xs space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${getImpactStyle(emotionalImpact).textClass}`}>
                        {emotionalImpact}
                      </span>
                      <span className="text-ink-muted" aria-hidden="true">·</span>
                      <span className="text-ink font-medium">{sentimentTone || mood}</span>
                    </div>
                    {sentimentScore !== null && (
                      <span className="font-mono text-[11px] text-ink-muted tabular-nums">
                        Valence {sentimentScore > 0 ? `+${sentimentScore}` : sentimentScore}
                      </span>
                    )}
                  </div>
                  {sentimentRationale && <p className="text-ink-muted">{sentimentRationale}</p>}
                </div>
              )}

              <div>
                <label className="text-xs text-ink-muted block mb-1">Date</label>
                <input
                  type="date"
                  value={memoryDate}
                  onChange={(e) => setMemoryDate(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-ink-muted block mb-1">Mood</label>
                <select
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                >
                  {MOODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label className="text-xs text-ink-muted block">Category Tag</label>
                <div className="flex flex-wrap gap-1.5">
                  {availableCategories.map((c) => {
                    const style = getCategoryStyle(c);
                    const isSelected = category !== 'Custom' && category.toLowerCase() === c.toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setCategory(c);
                          setCustomCategory('');
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                          isSelected ? style.activeClass : style.badgeClass
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: style.dotHex }}
                          aria-hidden="true"
                        />
                        {c}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setCategory('Custom')}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      category === 'Custom'
                        ? 'border-accent-border bg-accent-soft text-accent-text font-semibold'
                        : 'border-hairline-strong bg-inset text-ink-secondary hover:text-ink'
                    }`}
                  >
                    + Custom
                  </button>
                </div>
              </div>

              {category === 'Custom' ? (
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Custom Category</label>
                  <input
                    type="text"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="Enter custom category name"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Collection (optional)</label>
                  <select
                    value={collectionId}
                    onChange={(e) => setCollectionId(e.target.value)}
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                  >
                    <option value="">None</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-ink-muted block mb-1">Location</label>
                <input
                  type="text"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="City or place"
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-xs text-ink-muted">Coordinates (optional)</label>
                  <button
                    type="button"
                    disabled={locatingGps}
                    onClick={() => {
                      if (!navigator.geolocation) {
                        setError('Geolocation is not supported in this browser.');
                        return;
                      }
                      setLocatingGps(true);
                      setError(null);
                      navigator.geolocation.getCurrentPosition(
                        (pos) => {
                          setLatitude(pos.coords.latitude.toFixed(5));
                          setLongitude(pos.coords.longitude.toFixed(5));
                          setLocatingGps(false);
                        },
                        (geoErr) => {
                          setError(geoErr.message || 'Unable to detect GPS coordinates.');
                          setLocatingGps(false);
                        },
                        { enableHighAccuracy: true, timeout: 10000 }
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-text hover:underline disabled:opacity-40"
                  >
                    {locatingGps ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Navigation className="w-3 h-3" />
                    )}
                    {locatingGps ? 'Locating...' : 'Use GPS'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="Latitude"
                    aria-label="Latitude"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink font-mono"
                  />
                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="Longitude"
                    aria-label="Longitude"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-ink-muted block mb-1">People (comma-separated)</label>
                <input
                  type="text"
                  value={peopleInput}
                  onChange={(e) => setPeopleInput(e.target.value)}
                  placeholder="Names separated by commas"
                  className="w-full rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                />
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label className="text-xs text-ink-muted block">Tags</label>
                {editorTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {editorTags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-400/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-800 dark:text-sky-200"
                      >
                        #{t}
                        <button
                          type="button"
                          onClick={() => toggleEditorTag(t)}
                          aria-label={`Remove ${t}`}
                          className="text-ink-muted hover:text-rose-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editorTagDraft}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.endsWith(',')) {
                        addEditorTag(val.slice(0, -1));
                      } else {
                        setEditorTagDraft(val);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEditorTag(editorTagDraft);
                      }
                    }}
                    placeholder="Type a tag and press Enter or comma..."
                    className="flex-1 min-w-0 rounded-xl border border-hairline-strong bg-inset px-3 py-2 text-sm text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => addEditorTag(editorTagDraft)}
                    disabled={!editorTagDraft.trim()}
                    className="rounded-xl border border-hairline-strong bg-tint px-3.5 py-2 text-xs font-medium text-ink hover:bg-tint-hover disabled:opacity-40"
                  >
                    Add Tag
                  </button>
                </div>

                {allTagsDirectory.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-ink-muted">Existing tags:</span>
                    {allTagsDirectory.slice(0, 12).map((item) => {
                      const selected = editorTags.some((t) => t.toLowerCase() === item.tag.toLowerCase());
                      return (
                        <button
                          key={item.tag}
                          type="button"
                          onClick={() => toggleEditorTag(item.tag)}
                          className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                            selected
                              ? 'border-sky-400 bg-sky-400/20 text-sky-800 dark:text-sky-200 font-semibold'
                              : 'border-hairline bg-inset text-ink-secondary hover:text-ink'
                          }`}
                        >
                          {selected ? `✓ #${item.tag}` : `+ #${item.tag}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Media & Voice Recording */}
            <div className="border-t border-hairline pt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <MediaPicker
                  contextType="memory"
                  onUploaded={(m) => setAttachedMedia((prev) => [...prev, m])}
                />
                <VoiceRecorder
                  contextType="memory"
                  onUploaded={(m) => setAttachedMedia((prev) => [...prev, m])}
                  onTranscribed={(tr) => setContent((prev) => (prev ? `${prev}\n\n[Voice Transcript]: ${tr}` : tr))}
                />
              </div>
              {attachedMedia.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs text-ink-secondary">
                  {attachedMedia.map((m) => (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-inset px-2.5 py-1"
                    >
                      {m.originalName || m.original_name || 'Attachment'}
                      <button
                        type="button"
                        onClick={() => setAttachedMedia((prev) => prev.filter((x) => x.id !== m.id))}
                        className="text-ink-muted hover:text-rose-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <label className="flex items-center gap-2.5 text-xs text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={aiExcluded}
                onChange={(e) => setAiExcluded(e.target.checked)}
                className="rounded border-hairline-strong bg-inset"
              />
              Exclude this memory from ECHO AI reading & reflection
            </label>

            {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-xl border border-hairline-strong px-4 py-2.5 text-xs font-medium text-ink-secondary hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || voiceAutoPhase !== 'idle'}
                className="rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : editingId ? 'Update Memory' : 'Save Memory'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
