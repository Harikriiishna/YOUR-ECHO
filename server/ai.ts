import { db } from './db.ts';

export interface GroundedSource {
  kind: 'memory' | 'dream' | 'object' | 'capsule';
  id: string;
  title: string;
  date: string;
}

export interface MemoryAiResult {
  answer: string;
  factsSummary: string;
  reflection: string;
  followUpQuestions: string[];
  sources: GroundedSource[];
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'was', 'were', 'with', 'that', 'this', 'from', 'have',
  'has', 'had', 'what', 'when', 'where', 'which', 'who', 'why', 'how', 'about',
  'into', 'your', 'mine', 'did', 'does', 'are', 'you', 'our', 'all', 'any',
  'tell', 'show', 'find', 'give', 'list', 'there', 'their', 'been', 'will',
  'would', 'could', 'should', 'some', 'most', 'more', 'very', 'much', 'like',
]);

function stemToken(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(/(ies|ing|ied|ed|es|ness|ful|est|er|s)$/i, '');
}

function tokenizeQuery(question: string): string[] {
  const rawTokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  const expanded = new Set<string>();
  for (const tok of rawTokens) {
    expanded.add(tok);
    const stem = stemToken(tok);
    if (stem.length >= 3) expanded.add(stem);
  }
  return Array.from(expanded);
}

function runLocalMemoryAiQuery(
  question: string,
  memories: Array<Record<string, unknown>>,
  dreams: Array<Record<string, unknown>>,
  objects: Array<Record<string, unknown>>,
  unlockedCapsules: Array<Record<string, unknown>>,
  nowIso: string
): MemoryAiResult {
  const qLower = question.toLowerCase();
  const tokens = tokenizeQuery(question);

  const todayMmDd = nowIso.slice(5, 10);
  const currentYear = Number(nowIso.slice(0, 4));
  const lastYearStr = String(currentYear - 1);
  const yearMatch = qLower.match(/\b(19\d{2}|20\d{2})\b/);
  const requestedYear = yearMatch?.[1] || (qLower.includes('last year') ? lastYearStr : null);

  interface ScoredEntry {
    source: GroundedSource;
    score: number;
    date: string;
    excerpt: string;
    location: string;
    people: string;
    mood: string;
    impact: string;
  }

  const candidates: ScoredEntry[] = [];

  for (const m of memories) {
    const title = String(m.title || 'Untitled');
    const content = String(m.content || '');
    const date = String(m.memory_date || '');
    const location = String(m.location_name || '');
    const people = String(m.people || '');
    const tags = String(m.tags || '');
    const mood = String(m.mood || '');
    const category = String(m.category || '');
    const impact = String(m.emotional_impact || '');
    const scoreVal = typeof m.sentiment_score === 'number' ? m.sentiment_score : 0;
    const isFav = Boolean(m.is_favorite);

    let score = 0;
    const titleL = title.toLowerCase();
    const metaL = `${tags} ${people} ${location} ${mood} ${category} ${impact}`.toLowerCase();
    const bodyL = content.toLowerCase();

    for (const tok of tokens) {
      if (titleL.includes(tok)) score += 6;
      if (metaL.includes(tok)) score += 5;
      if (bodyL.includes(tok)) score += 2.5;
    }

    if (
      (qLower.includes('happi') || qLower.includes('joy') || qLower.includes('best') || qLower.includes('favorite')) &&
      (isFav || impact === 'Uplifting' || scoreVal >= 30 || /joy|happy|grateful|wonderful|love|laugh|proud/i.test(`${mood} ${bodyL}`))
    ) {
      score += 8 + (isFav ? 3 : 0);
    }

    if (
      (qLower.includes('hard') || qLower.includes('challeng') || qLower.includes('sad') || qLower.includes('anxious')) &&
      (impact === 'Challenging' || scoreVal <= -20 || /sad|anxi|grief|hard|struggle|heavy/i.test(`${mood} ${bodyL}`))
    ) {
      score += 7;
    }

    if ((qLower.includes('this day') || qLower.includes('on this day')) && date.slice(5, 10) === todayMmDd && date.slice(0, 4) !== String(currentYear)) {
      score += 14;
    }

    if (requestedYear && date.startsWith(requestedYear)) {
      score += 10;
    }

    if ((qLower.includes('place') || qLower.includes('visit') || qLower.includes('travel') || qLower.includes('where') || qLower.includes('city')) && location) {
      score += 6;
    }

    if ((qLower.includes('people') || qLower.includes('friend') || qLower.includes('family') || qLower.includes('who')) && people) {
      score += 6;
    }

    if (qLower.includes('mood') || qLower.includes('feel') || qLower.includes('tone')) {
      score += mood ? 3 : 0;
    }

    if (qLower.includes('promise') || qLower.includes('future') || qLower.includes('change') || qLower.includes('summar') || qLower.includes('recent')) {
      score += 1;
    }

    candidates.push({
      source: { kind: 'memory', id: String(m.id), title, date },
      score,
      date,
      excerpt: content.slice(0, 150).trim(),
      location,
      people,
      mood,
      impact,
    });
  }

  for (const d of dreams) {
    const title = String(d.title || 'Untitled Dream');
    const content = String(d.content || '');
    const date = String(d.dream_date || '');
    const emotion = String(d.emotion || '');
    const location = String(d.location || '');
    let score = qLower.includes('dream') || qLower.includes('sleep') ? 9 : 0;
    if (requestedYear && date.startsWith(requestedYear)) score += 6;
    const hay = `${title} ${content} ${emotion} ${location}`.toLowerCase();
    for (const tok of tokens) {
      if (hay.includes(tok)) score += 3;
    }
    candidates.push({
      source: { kind: 'dream', id: String(d.id), title, date },
      score,
      date,
      excerpt: content.slice(0, 150).trim(),
      location,
      people: '',
      mood: emotion,
      impact: '',
    });
  }

  for (const o of objects) {
    const title = String(o.name || 'Object');
    const story = String(o.story || '');
    const date = String(o.acquisition_date || '');
    const location = String(o.location || '');
    let score = qLower.includes('object') || qLower.includes('heirloom') || qLower.includes('kept') || qLower.includes('thing') ? 8 : 0;
    const hay = `${title} ${story} ${o.category || ''} ${location}`.toLowerCase();
    for (const tok of tokens) {
      if (hay.includes(tok)) score += 3;
    }
    candidates.push({
      source: { kind: 'object', id: String(o.id), title, date },
      score,
      date,
      excerpt: story.slice(0, 150).trim(),
      location,
      people: '',
      mood: String(o.category || ''),
      impact: '',
    });
  }

  for (const c of unlockedCapsules) {
    const title = String(c.title || 'Time Capsule');
    const msg = String(c.message || '');
    const date = String(c.unlock_at || '').slice(0, 10);
    let score = qLower.includes('capsule') || qLower.includes('promise') || qLower.includes('future') || qLower.includes('letter') ? 9 : 0;
    const hay = `${title} ${msg}`.toLowerCase();
    for (const tok of tokens) {
      if (hay.includes(tok)) score += 3;
    }
    candidates.push({
      source: { kind: 'capsule', id: String(c.id), title, date },
      score,
      date,
      excerpt: msg.slice(0, 150).trim(),
      location: '',
      people: '',
      mood: String(c.capsule_type || 'capsule'),
      impact: '',
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  const matched = candidates.filter((c) => c.score > 0).slice(0, 5);
  const topList = matched.length > 0 ? matched : candidates.slice(0, 4);

  if (matched.length === 0 && (qLower.includes('this day') || qLower.includes('on this day'))) {
    return {
      answer: `No archived entries were found specifically on ${todayMmDd} from an earlier year, though you have ${memories.length} memories recorded overall.`,
      factsSummary: `Checked ${memories.length} memories and ${dreams.length} dreams for anniversary matches on ${todayMmDd}.`,
      reflection: 'If today holds a quiet highlight, capturing it now creates your first anchor for next year.',
      followUpQuestions: ['Summarize my recent memories', 'What places did I visit?', 'What moods appear most often?'],
      sources: topList.slice(0, 2).map((x) => x.source),
    };
  }

  const uniquePlaces = Array.from(
    new Set(memories.map((m) => String(m.location_name || '').trim()).filter(Boolean))
  ).slice(0, 6);

  const uniquePeople = Array.from(
    new Set(
      memories
        .flatMap((m) => String(m.people || '').split(','))
        .map((p) => p.trim())
        .filter(Boolean)
    )
  ).slice(0, 6);

  const moodCounts = new Map<string, number>();
  for (const m of memories) {
    const moodVal = String(m.mood || '').trim();
    if (moodVal) moodCounts.set(moodVal, (moodCounts.get(moodVal) || 0) + 1);
  }
  const topMoods = [...moodCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const bulletFacts = topList.map((entry) => {
    const meta = [entry.date, entry.location, entry.mood].filter(Boolean).join(' · ');
    return `• ${entry.source.title}${meta ? ` (${meta})` : ''}: "${entry.excerpt}${entry.excerpt.length >= 150 ? '…' : ''}"`;
  });

  let leadAnswer = '';
  if (qLower.includes('place') || qLower.includes('visit') || qLower.includes('city')) {
    leadAnswer =
      uniquePlaces.length > 0
        ? `Across your archive, your memories span places including ${uniquePlaces.join(', ')}. Here are the clearest matching entries:`
        : 'None of your stored entries list a place name yet, though your closest matching memories are listed below.';
  } else if (qLower.includes('mood') || qLower.includes('feel') || qLower.includes('emotion')) {
    leadAnswer =
      topMoods.length > 0
        ? `Your most frequent emotional tones are ${topMoods.map(([name, cnt]) => `${name} (${cnt})`).join(', ')}.`
        : 'Here are the emotional tones reflected across your recent entries:';
  } else if (qLower.includes('summar') || requestedYear) {
    leadAnswer = `Your archive currently holds ${memories.length} memories, ${dreams.length} dreams, ${objects.length} keepsake objects, and ${unlockedCapsules.length} unlocked capsules${uniquePlaces.length ? ` across ${uniquePlaces.slice(0, 3).join(', ')}` : ''}.`;
  } else if (matched.length > 0) {
    leadAnswer = `Here is what your personal archive shows for "${question}" (${matched.length} closest ${matched.length === 1 ? 'entry' : 'entries'} found):`;
  } else {
    leadAnswer = `No direct keyword match appeared for "${question}", so here are your most recent stored entries for context:`;
  }

  const factsSummary = [
    ...bulletFacts,
    uniquePeople.length > 0 ? `People mentioned across your archive: ${uniquePeople.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    answer: leadAnswer,
    factsSummary,
    reflection:
      matched.length > 0
        ? `Notice how ${topList[0].mood ? `a ${topList[0].mood.toLowerCase()} tone` : 'these details'} connect across ${topList.length} ${topList.length === 1 ? 'moment' : 'moments'} in your timeline.`
        : 'Try asking about a specific city, person, mood, or year to surface exact entries.',
    followUpQuestions: [
      uniquePlaces.length > 0 ? `What happened in ${uniquePlaces[0]}?` : 'What places appear in my memories?',
      uniquePeople.length > 0 ? `Show memories with ${uniquePeople[0]}` : 'What was my happiest memory?',
      'What moods appear most often?',
    ],
    sources: topList.map((t) => t.source),
  };
}

export async function runMemoryAiQuery(userId: string, question: string): Promise<MemoryAiResult> {
  const memories = db
    .prepare(`
      SELECT m.id, m.title, m.content, m.memory_date, m.location_name, m.mood, m.category, m.is_favorite, m.emotional_impact, m.sentiment_score,
        COALESCE((SELECT GROUP_CONCAT(tag, ', ') FROM memory_tags WHERE memory_id = m.id), '') AS tags,
        COALESCE((SELECT GROUP_CONCAT(person_name, ', ') FROM memory_people WHERE memory_id = m.id), '') AS people
      FROM memories m
      WHERE m.user_id = ? AND m.ai_excluded = 0
      ORDER BY m.memory_date DESC
      LIMIT 150
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const dreams = db
    .prepare(`
      SELECT id, title, content, dream_date, emotion, location, category, is_recurring
      FROM dreams
      WHERE user_id = ?
      ORDER BY dream_date DESC
      LIMIT 50
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const objects = db
    .prepare(`
      SELECT id, name, category, story, acquisition_date, location
      FROM objects
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const nowIso = new Date().toISOString();
  const unlockedCapsules = db
    .prepare(`
      SELECT id, title, message, unlock_at, capsule_type
      FROM time_capsules
      WHERE user_id = ? AND (is_locked = 0 OR unlock_at <= ?)
      ORDER BY created_at DESC
      LIMIT 40
    `)
    .all(userId, nowIso) as Array<Record<string, unknown>>;

  if (memories.length === 0 && dreams.length === 0 && objects.length === 0 && unlockedCapsules.length === 0) {
    return {
      answer:
        'Your personal ECHO archive does not have any AI-accessible memories, dreams, objects, or unlocked capsules yet. Save your first memory or dream, and I will reflect on your real entries with you.',
      factsSummary: 'No stored personal records are currently available for reflection.',
      reflection: 'Whenever you are ready, capture a single ordinary moment or meaningful object to start building your timeline.',
      followUpQuestions: [
        'What small moment from this week do you want to remember a year from now?',
        'Is there an object near you right now that holds a story?',
      ],
      sources: [],
    };
  }

  return runLocalMemoryAiQuery(question, memories, dreams, objects, unlockedCapsules, nowIso);
}

function generateLocalMemoryAssist(params: {
  mode: 'title_and_summary' | 'writing_polish' | 'dream_reflection' | 'connection_suggest';
  text: string;
  context?: string;
}): { title?: string; summary?: string; suggestion: string; disclaimer?: string } {
  const cleanText = (params.text || '').replace(/\s+/g, ' ').trim();
  const sentences = cleanText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const firstSentence = sentences[0] || cleanText;

  if (params.mode === 'title_and_summary') {
    const words = firstSentence
      .replace(/[^a-zA-Z0-9\s'-]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const titleWords = words.slice(0, 7);
    const title = titleWords.length > 0
      ? titleWords.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
      : 'Untitled Memory';
    const summary = sentences.slice(0, 2).join(' ').slice(0, 220);
    return {
      title,
      summary,
      suggestion: summary,
    };
  }

  if (params.mode === 'dream_reflection') {
    const lower = cleanText.toLowerCase();
    const prompts: string[] = [];
    if (/water|ocean|sea|river|rain|swim|lake|wave/.test(lower)) {
      prompts.push('• Notice how water appeared in the dream — did it feel calm, overwhelming, or cleansing?');
    }
    if (/fly|sky|fall|height|wing|float|cliff/.test(lower)) {
      prompts.push('• Consider what sense of freedom, release, or uncertainty showed up in that movement.');
    }
    if (/house|room|door|window|stairs|home|hallway/.test(lower)) {
      prompts.push('• What did the spaces or rooms represent to you emotionally as you moved through them?');
    }
    if (/chase|run|escape|late|lost|search|miss/.test(lower)) {
      prompts.push('• Was there something you felt rushed toward or trying to avoid in waking life this week?');
    }
    if (/forest|tree|animal|bird|garden|mountain|sun|moon|star/.test(lower)) {
      prompts.push('• How did the natural imagery mirror your current pace or need for grounding?');
    }
    if (/talk|voice|letter|call|mirror|face|friend|family/.test(lower)) {
      prompts.push('• Who or what part of yourself seemed to be asking to be heard in that conversation?');
    }
    if (prompts.length < 2) {
      prompts.push(
        '• Which image or emotion stayed with you longest right after waking up?',
        '• Does any detail in this dream echo something you have been quietly thinking about lately?'
      );
    }
    return {
      suggestion: prompts.slice(0, 3).join('\n'),
      disclaimer: 'Built-in personal reflection prompt — not a factual statement, prediction, or diagnosis.',
    };
  }

  if (params.mode === 'connection_suggest') {
    const suggestedTags = new Set<string>();
    const lower = cleanText.toLowerCase();
    if (/family|mom|dad|mother|father|sister|brother|home/.test(lower)) suggestedTags.add('family');
    if (/friend|together|laugh|coffee|dinner|party/.test(lower)) suggestedTags.add('friends');
    if (/trip|travel|train|flight|city|beach|mountain|road/.test(lower)) suggestedTags.add('travel');
    if (/work|learn|study|project|achieve|milestone/.test(lower)) suggestedTags.add('milestone');
    if (/grateful|thankful|happy|joy|love/.test(lower)) suggestedTags.add('gratitude');

    const namedEntities = Array.from(
      new Set((cleanText.match(/\b[A-Z][a-z]{2,}\b/g) || []).filter((w) => !['The', 'This', 'That', 'Today', 'When', 'After', 'Before', 'While', 'Yesterday'].includes(w)))
    ).slice(0, 4);

    const parts: string[] = [];
    if (namedEntities.length > 0) {
      parts.push(`Consider linking names or places mentioned (${namedEntities.join(', ')}) in your People or Location fields.`);
    }
    if (suggestedTags.size > 0) {
      parts.push(`Suggested tags for your Memory Constellation: ${Array.from(suggestedTags).map((t) => `#${t}`).join(' ')}.`);
    }
    if (parts.length === 0) {
      parts.push('Tag shared people, places, or emotional themes consistently so this entry links automatically on your Memory Constellation and World Atlas.');
    }
    return {
      suggestion: parts.join(' '),
    };
  }

  const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
  const hasSensory = /saw|heard|smell|taste|warm|cold|light|sound|quiet|bright|wind|rain|sun/i.test(cleanText);
  if (wordCount < 18) {
    return {
      suggestion: 'Try adding one sensory detail (what you saw, heard, or felt in that moment) and who was with you to anchor this memory vividly.',
    };
  }
  if (!hasSensory) {
    return {
      suggestion: `Your draft captures "${firstSentence.slice(0, 60)}${firstSentence.length > 60 ? '…' : ''}" clearly. Adding one small sensory cue (light, weather, or sound) and why it mattered will bring it back even faster later.`,
    };
  }
  return {
    suggestion: `Strong sensory detail around "${firstSentence.slice(0, 60)}${firstSentence.length > 60 ? '…' : ''}". Consider closing with one line for your future self on what you want to carry forward from this moment.`,
  };
}

export async function generateMemoryAssist(params: {
  mode: 'title_and_summary' | 'writing_polish' | 'dream_reflection' | 'connection_suggest';
  text: string;
  context?: string;
}): Promise<{ title?: string; summary?: string; suggestion: string; disclaimer?: string }> {
  return generateLocalMemoryAssist(params);
}

export async function transcribeAudioBuffer(_buffer: Buffer, _mimeType: string): Promise<string> {
  // Handled locally in-browser via Web Speech live dictation + local audio attachment
  return '';
}

export const EMOTIONAL_IMPACT_LEVELS = ['Uplifting', 'Calm', 'Reflective', 'Bittersweet', 'Challenging'] as const;
export type EmotionalImpactLevel = (typeof EMOTIONAL_IMPACT_LEVELS)[number];

export interface SentimentAnalysisResult {
  emotionalImpact: EmotionalImpactLevel;
  tone: string;
  suggestedMood: string;
  valenceScore: number;
  rationale: string;
}

function normalizeTone(value: unknown, fallback = 'Reflective'): string {
  const clean = String(value || '')
    .trim()
    .replace(/[^a-zA-Z\s-]/g, '')
    .slice(0, 32);
  if (!clean) return fallback;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function clampValence(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(-100, Math.min(100, Math.round(num)));
}

const SENTIMENT_LEXICON: Array<{ words: string[]; weight: number; toneHint: string }> = [
  { words: ['joy', 'joyful', 'happy', 'happiest', 'happiness', 'celebrate', 'celebrated', 'laugh', 'laughed', 'laughter', 'delight', 'thrilled', 'amazing', 'wonderful', 'proud', 'achievement', 'won', 'victory', 'excited'], weight: 28, toneHint: 'Joyful' },
  { words: ['grateful', 'gratitude', 'thankful', 'blessed', 'appreciate', 'appreciated', 'cherish', 'warmth', 'love', 'loved', 'kindness', 'hug'], weight: 24, toneHint: 'Grateful' },
  { words: ['hope', 'hopeful', 'inspired', 'inspiring', 'bright', 'courage', 'courageous', 'brave', 'curious', 'relieved', 'relief'], weight: 22, toneHint: 'Inspired' },
  { words: ['calm', 'peace', 'peaceful', 'quiet', 'serene', 'gentle', 'still', 'breeze', 'tea', 'coffee', 'sunlight', 'walk', 'rest', 'breathe', 'steady'], weight: 14, toneHint: 'Peaceful' },
  { words: ['nostalgic', 'nostalgia', 'childhood', 'miss', 'missed', 'goodbye', 'farewell', 'memories', 'bittersweet', 'tender', 'old'], weight: -6, toneHint: 'Bittersweet' },
  { words: ['sad', 'cry', 'cried', 'grief', 'loss', 'lost', 'lonely', 'alone', 'hurt', 'pain', 'heartbreak', 'tears', 'miss'], weight: -32, toneHint: 'Melancholic' },
  { words: ['anxious', 'anxiety', 'worry', 'worried', 'fear', 'afraid', 'stress', 'stressed', 'overwhelmed', 'nervous', 'panic', 'uncertain'], weight: -26, toneHint: 'Anxious' },
  { words: ['hard', 'difficult', 'struggle', 'failed', 'failure', 'exhausted', 'heavy', 'angry', 'frustrated', 'tired'], weight: -22, toneHint: 'Melancholic' },
];

const NEGATORS = new Set(['not', 'never', 'no', 'without', 'hardly', 'barely']);
const INTENSIFIERS = new Set(['very', 'so', 'deeply', 'extremely', 'truly', 'really', 'incredibly']);

function analyzeLocalSentiment(params: {
  title?: string;
  content: string;
  currentMood?: string;
}): SentimentAnalysisResult {
  const rawCombined = `${params.title || ''} ${params.content}`;
  const text = rawCombined.toLowerCase();
  const words = text.replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);

  let score = 0;
  const matchedWords: string[] = [];
  const toneScores = new Map<string, number>();

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const prev1 = i > 0 ? words[i - 1] : '';
    const prev2 = i > 1 ? words[i - 2] : '';
    const negated = NEGATORS.has(prev1) || NEGATORS.has(prev2);
    const boosted = INTENSIFIERS.has(prev1) ? 1.35 : 1;

    for (const group of SENTIMENT_LEXICON) {
      if (group.words.includes(w)) {
        const delta = (negated ? -group.weight * 0.65 : group.weight) * boosted;
        score += delta;
        matchedWords.push(w);
        toneScores.set(group.toneHint, (toneScores.get(group.toneHint) || 0) + Math.abs(delta));
      }
    }
  }

  // Subtle emoji valence hints
  if (/[😊😄❤️🎉✨🙏🌿☀️]/.test(rawCombined)) score += 12;
  if (/[😢😭💔😰😞😔]/.test(rawCombined)) score -= 14;

  const moodHint = (params.currentMood || '').trim();
  if (moodHint) {
    const lowerMood = moodHint.toLowerCase();
    if (['joyful', 'grateful', 'hopeful', 'inspired', 'courageous'].includes(lowerMood)) score += 12;
    if (['peaceful', 'calm', 'tender'].includes(lowerMood)) score += 6;
    if (['melancholic', 'anxious', 'sad'].includes(lowerMood)) score -= 14;
  }

  const valenceScore = clampValence(score);
  let emotionalImpact: EmotionalImpactLevel = 'Reflective';
  if (valenceScore >= 25) emotionalImpact = 'Uplifting';
  else if (valenceScore >= 8) emotionalImpact = 'Calm';
  else if (valenceScore <= -20) emotionalImpact = 'Challenging';
  else if ((toneScores.get('Bittersweet') || 0) > 0 || (valenceScore < 8 && valenceScore > -20 && matchedWords.length > 0)) {
    emotionalImpact = 'Bittersweet';
  }

  let bestTone = normalizeTone(moodHint, 'Reflective');
  let maxToneScore = 0;
  for (const [tone, sc] of toneScores.entries()) {
    if (sc > maxToneScore) {
      maxToneScore = sc;
      bestTone = tone;
    }
  }
  if (maxToneScore === 0 && !moodHint) {
    bestTone = emotionalImpact === 'Calm' ? 'Peaceful' : 'Reflective';
  }

  const uniqueMatched = Array.from(new Set(matchedWords)).slice(0, 3);
  const rationale =
    uniqueMatched.length > 0
      ? `Detected ${emotionalImpact.toLowerCase()} tone from themes around ${uniqueMatched.join(', ')}.`
      : `Classified as ${emotionalImpact.toLowerCase()} based on the entry's overall contemplative phrasing.`;

  return {
    emotionalImpact,
    tone: bestTone,
    suggestedMood: bestTone,
    valenceScore,
    rationale,
  };
}

export async function analyzeMemorySentiment(params: {
  title?: string;
  content: string;
  currentMood?: string;
}): Promise<SentimentAnalysisResult> {
  return analyzeLocalSentiment(params);
}

export async function analyzeMemoryBatchSentiment(
  entries: Array<{ id: string; title: string; content: string; mood: string }>
): Promise<Array<{ id: string } & SentimentAnalysisResult>> {
  if (entries.length === 0) return [];
  return entries.slice(0, 15).map((e) => ({
    id: e.id,
    ...analyzeLocalSentiment({ title: e.title, content: e.content, currentMood: e.mood }),
  }));
}

export interface MonthlyReflectionTheme {
  name: string;
  insight: string;
  memoryIds: string[];
}

export interface MonthlyReflectionResult {
  summary: string;
  themes: MonthlyReflectionTheme[];
  emotionalArc: string;
  gentlePrompt: string;
}

function generateLocalMonthlyReflection(
  entries: Array<{
    id: string;
    title: string;
    memoryDate: string;
    mood: string;
    emotionalImpact: string;
    content: string;
  }>
): MonthlyReflectionResult {
  const moodBuckets = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = (e.mood || 'Reflective').trim() || 'Reflective';
    const arr = moodBuckets.get(key) || [];
    arr.push(e);
    moodBuckets.set(key, arr);
  }

  const sortedMoods = [...moodBuckets.entries()].sort((a, b) => b[1].length - a[1].length);
  const topMood = sortedMoods[0]?.[0] || 'Reflective';
  const earliestMood = entries[0]?.mood || topMood;
  const latestMood = entries[entries.length - 1]?.mood || topMood;

  const themes: MonthlyReflectionTheme[] = sortedMoods.slice(0, 4).map(([moodName, list]) => {
    const sample = list[0];
    const cleanAnswer = String(sample?.content || '')
      .replace(/^Daily Check-In Prompt:\s*"[^"]*"\s*/i, '')
      .trim()
      .slice(0, 140);
    return {
      name: `${moodName} Moments`,
      insight: `Appeared across ${list.length} check-${list.length === 1 ? 'in' : 'ins'}, including "${cleanAnswer}${cleanAnswer.length >= 140 ? '…' : ''}"`,
      memoryIds: list.slice(0, 8).map((x) => x.id),
    };
  });

  const valences = entries.map((e) =>
    analyzeLocalSentiment({ title: e.title, content: e.content, currentMood: e.mood }).valenceScore
  );
  const mid = Math.ceil(valences.length / 2);
  const firstAvg = valences.slice(0, mid).reduce((a, b) => a + b, 0) / Math.max(1, mid);
  const secondAvg = valences.slice(mid).reduce((a, b) => a + b, 0) / Math.max(1, valences.length - mid);

  let emotionalArc = `Your recent check-ins stayed anchored around a ${topMood.toLowerCase()} rhythm.`;
  if (entries.length >= 2) {
    if (secondAvg - firstAvg >= 12) {
      emotionalArc = `Your tone brightened steadily across the month, shifting from ${earliestMood.toLowerCase()} toward ${latestMood.toLowerCase()}.`;
    } else if (firstAvg - secondAvg >= 12) {
      emotionalArc = `Your entries moved from ${earliestMood.toLowerCase()} earlier in the month into a quieter, ${latestMood.toLowerCase()} season recently.`;
    } else if (earliestMood.toLowerCase() !== latestMood.toLowerCase()) {
      emotionalArc = `Your entries shifted from ${earliestMood.toLowerCase()} earlier in the month toward ${latestMood.toLowerCase()} most recently.`;
    }
  }

  return {
    summary: `Across ${entries.length} daily check-${entries.length === 1 ? 'in' : 'ins'} over the past 30 days, your reflections centered most strongly on ${topMood.toLowerCase()} moments. Taking time to capture these honest snapshots preserves how your perspective evolved day by day.`,
    themes,
    emotionalArc,
    gentlePrompt: `Looking back over these ${topMood.toLowerCase()} reflections, which quiet habit or person brought you the most steadiness this month?`,
  };
}

export async function generateMonthlyCheckInReflection(
  entries: Array<{
    id: string;
    title: string;
    memoryDate: string;
    mood: string;
    emotionalImpact: string;
    content: string;
  }>
): Promise<MonthlyReflectionResult> {
  if (entries.length === 0) {
    throw new Error('At least one daily check-in entry is required to generate a Monthly Reflection.');
  }
  return generateLocalMonthlyReflection(entries);
}
