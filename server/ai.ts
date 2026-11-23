import { GoogleGenAI, Type } from '@google/genai';
import { db } from './db.ts';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

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

export async function runMemoryAiQuery(userId: string, question: string): Promise<MemoryAiResult> {
  const ai = getClient();

  const memories = db
    .prepare(`
      SELECT m.id, m.title, m.content, m.memory_date, m.location_name, m.mood, m.category, m.is_favorite,
        COALESCE((SELECT GROUP_CONCAT(tag, ', ') FROM memory_tags WHERE memory_id = m.id), '') AS tags,
        COALESCE((SELECT GROUP_CONCAT(person_name, ', ') FROM memory_people WHERE memory_id = m.id), '') AS people
      FROM memories m
      WHERE m.user_id = ? AND m.ai_excluded = 0
      ORDER BY m.memory_date DESC
      LIMIT 120
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const dreams = db
    .prepare(`
      SELECT id, title, content, dream_date, emotion, location, category, is_recurring
      FROM dreams
      WHERE user_id = ?
      ORDER BY dream_date DESC
      LIMIT 40
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const objects = db
    .prepare(`
      SELECT id, name, category, story, acquisition_date, location
      FROM objects
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 40
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const nowIso = new Date().toISOString();
  const unlockedCapsules = db
    .prepare(`
      SELECT id, title, message, unlock_at, capsule_type
      FROM time_capsules
      WHERE user_id = ? AND (is_locked = 0 OR unlock_at <= ?)
      ORDER BY created_at DESC
      LIMIT 30
    `)
    .all(userId, nowIso) as Array<Record<string, unknown>>;

  if (memories.length === 0 && dreams.length === 0 && objects.length === 0 && unlockedCapsules.length === 0) {
    return {
      answer:
        'Your personal ECHO archive does not have any AI-accessible memories, dreams, objects, or unlocked capsules yet. Save your first memory or dream, and I will reflect on your real entries with you.',
      factsSummary: 'No stored personal records are currently available for AI reflection.',
      reflection: 'Whenever you are ready, capture a single ordinary moment or meaningful object to start building your timeline.',
      followUpQuestions: [
        'What small moment from this week do you want to remember a year from now?',
        'Is there an object near you right now that holds a story?',
      ],
      sources: [],
    };
  }

  const archivePayload = {
    todayIso: nowIso.slice(0, 10),
    memories: memories.map((m) => ({
      id: m.id,
      title: m.title,
      date: m.memory_date,
      category: m.category,
      mood: m.mood,
      location: m.location_name,
      people: m.people,
      tags: m.tags,
      favorite: Boolean(m.is_favorite),
      content: String(m.content).slice(0, 900),
    })),
    dreams: dreams.map((d) => ({
      id: d.id,
      title: d.title,
      date: d.dream_date,
      emotion: d.emotion,
      recurring: Boolean(d.is_recurring),
      content: String(d.content).slice(0, 500),
    })),
    objects: objects.map((o) => ({
      id: o.id,
      name: o.name,
      category: o.category,
      acquisitionDate: o.acquisition_date,
      location: o.location,
      story: String(o.story).slice(0, 500),
    })),
    unlockedCapsules: unlockedCapsules.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.capsule_type,
      unlockAt: c.unlock_at,
      message: String(c.message).slice(0, 500),
    })),
  };

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `User question: "${question}"\n\nPersonal Archive JSON:\n${JSON.stringify(archivePayload)}`,
    config: {
      systemInstruction: [
        'You are ECHO AI, a warm, precise, deeply respectful personal memory companion.',
        'STRICT GROUNDING RULES:',
        '1. Use ONLY the provided Personal Archive JSON. Never invent, extrapolate, or fabricate memories, dates, people, places, or quotes.',
        '2. If no relevant memory/dream/object/capsule exists in the archive for the question, state clearly in `answer` and `factsSummary` that no relevant memory was found.',
        '3. Strictly distinguish stored FACTS (actual dates, titles, places, people, quoted snippets) from AI REFLECTION (gentle thematic observations or reflective questions).',
        '4. Never diagnose medical or psychological conditions. Never present dream themes as scientific fact or prediction.',
        '5. Populate `referencedIds` ONLY with exact IDs from the provided JSON that you actually relied on.',
      ].join('\n'),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: { type: Type.STRING },
          factsSummary: { type: Type.STRING },
          reflection: { type: Type.STRING },
          followUpQuestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          referencedItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                kind: { type: Type.STRING },
                id: { type: Type.STRING },
              },
            },
          },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    answer?: string;
    factsSummary?: string;
    reflection?: string;
    followUpQuestions?: string[];
    referencedItems?: Array<{ kind?: string; id?: string }>;
  };

  const sourceMap = new Map<string, GroundedSource>();
  for (const m of memories) {
    sourceMap.set(String(m.id), { kind: 'memory', id: String(m.id), title: String(m.title), date: String(m.memory_date) });
  }
  for (const d of dreams) {
    sourceMap.set(String(d.id), { kind: 'dream', id: String(d.id), title: String(d.title), date: String(d.dream_date) });
  }
  for (const o of objects) {
    sourceMap.set(String(o.id), { kind: 'object', id: String(o.id), title: String(o.name), date: String(o.acquisition_date || '') });
  }
  for (const c of unlockedCapsules) {
    sourceMap.set(String(c.id), { kind: 'capsule', id: String(c.id), title: String(c.title), date: String(c.unlock_at) });
  }

  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const ref of parsed.referencedItems || []) {
    if (ref.id && sourceMap.has(ref.id) && !seen.has(ref.id)) {
      seen.add(ref.id);
      sources.push(sourceMap.get(ref.id)!);
    }
  }

  return {
    answer: parsed.answer || 'I searched your archive, please rephrase your question.',
    factsSummary: parsed.factsSummary || 'Based only on your stored entries.',
    reflection: parsed.reflection || '',
    followUpQuestions: Array.isArray(parsed.followUpQuestions) ? parsed.followUpQuestions.slice(0, 3) : [],
    sources,
  };
}

export async function generateMemoryAssist(params: {
  mode: 'title_and_summary' | 'writing_polish' | 'dream_reflection' | 'connection_suggest';
  text: string;
  context?: string;
}): Promise<{ title?: string; summary?: string; suggestion: string; disclaimer?: string }> {
  const ai = getClient();

  if (params.mode === 'title_and_summary') {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Memory text:\n${params.text}`,
      config: {
        systemInstruction:
          'Generate a concise evocative title (max 7 words) and a factual 1-2 sentence summary strictly from the provided memory text. Do not invent any details not present in the text.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
        },
      },
    });
    const parsed = JSON.parse((response.text ?? '{}').trim()) as { title?: string; summary?: string };
    return {
      title: parsed.title || 'Untitled Memory',
      summary: parsed.summary || '',
      suggestion: parsed.summary || '',
    };
  }

  if (params.mode === 'dream_reflection') {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Dream entry:\n${params.text}\nContext: ${params.context || ''}`,
      config: {
        systemInstruction:
          'Offer 2-3 gentle, open-ended personal reflection prompts about the imagery and emotions in this dream entry. Explicitly avoid claiming scientific facts, predictions, or medical/psychological diagnoses.',
      },
    });
    return {
      suggestion: (response.text ?? '').trim(),
      disclaimer: 'AI-generated personal reflection prompt — not a factual statement, prediction, or diagnosis.',
    };
  }

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Draft text:\n${params.text}\nModule context: ${params.context || 'personal writing'}`,
    config: {
      systemInstruction:
        'Help the user refine or expand their personal writing warmly while preserving their authentic voice and facts. Do not invent biographical facts they did not mention.',
    },
  });

  return {
    suggestion: (response.text ?? '').trim(),
  };
}

export async function transcribeAudioBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  const ai = getClient();
  const base64Audio = buffer.toString('base64');
  const cleanMimeType = (mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: cleanMimeType,
            data: base64Audio,
          },
        },
        { text: 'Transcribe this spoken recording accurately with natural punctuation.' },
      ],
    },
  });
  return (response.text ?? '').trim();
}

export const EMOTIONAL_IMPACT_LEVELS = ['Uplifting', 'Calm', 'Reflective', 'Bittersweet', 'Challenging'] as const;
export type EmotionalImpactLevel = (typeof EMOTIONAL_IMPACT_LEVELS)[number];

const KNOWN_MOODS = [
  'Joyful',
  'Peaceful',
  'Reflective',
  'Grateful',
  'Nostalgic',
  'Hopeful',
  'Bittersweet',
  'Inspired',
  'Melancholic',
  'Tender',
  'Anxious',
  'Courageous',
] as const;

export interface SentimentAnalysisResult {
  emotionalImpact: EmotionalImpactLevel;
  tone: string;
  suggestedMood: string;
  valenceScore: number;
  rationale: string;
}

function normalizeImpact(value: unknown): EmotionalImpactLevel {
  const raw = String(value || '').trim().toLowerCase();
  const matched = EMOTIONAL_IMPACT_LEVELS.find((lvl) => lvl.toLowerCase() === raw);
  if (matched) return matched;
  if (raw.includes('uplift') || raw.includes('joy') || raw.includes('happy') || raw.includes('positive')) return 'Uplifting';
  if (raw.includes('calm') || raw.includes('peace') || raw.includes('serene')) return 'Calm';
  if (raw.includes('bitter') || raw.includes('nostalg') || raw.includes('mixed')) return 'Bittersweet';
  if (raw.includes('challeng') || raw.includes('sad') || raw.includes('hard') || raw.includes('heavy') || raw.includes('anxi')) return 'Challenging';
  return 'Reflective';
}

function normalizeTone(value: unknown, fallback = 'Reflective'): string {
  const clean = String(value || '')
    .trim()
    .replace(/[^a-zA-Z\s-]/g, '')
    .slice(0, 32);
  if (!clean) return fallback;
  const known = KNOWN_MOODS.find((m) => m.toLowerCase() === clean.toLowerCase());
  return known || clean.charAt(0).toUpperCase() + clean.slice(1);
}

function clampValence(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(-100, Math.min(100, Math.round(num)));
}

export async function analyzeMemorySentiment(params: {
  title?: string;
  content: string;
  currentMood?: string;
}): Promise<SentimentAnalysisResult> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Title: ${params.title || 'Untitled'}\nUser-selected mood: ${params.currentMood || 'Not specified'}\nMemory text:\n${params.content.slice(0, 4000)}`,
    config: {
      systemInstruction: [
        'You analyze personal life memory entries to classify emotional tone and overall emotional impact.',
        'Base your classification strictly on the provided memory title and text.',
        'emotionalImpact MUST be exactly one of: Uplifting, Calm, Reflective, Bittersweet, Challenging.',
        'tone should be a crisp 1-word emotional descriptor (e.g., Joyful, Grateful, Peaceful, Inspired, Hopeful, Reflective, Nostalgic, Bittersweet, Tender, Melancholic, Anxious, Courageous).',
        'suggestedMood should be the closest matching mood label.',
        'valenceScore must be an integer from -100 (deeply painful/heavy) through 0 (neutral/contemplative) to +100 (deeply joyful/uplifting).',
        'rationale must be one concise, empathetic sentence citing only themes present in the text (never invent facts or give medical diagnoses).',
      ].join('\n'),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          emotionalImpact: { type: Type.STRING },
          tone: { type: Type.STRING },
          suggestedMood: { type: Type.STRING },
          valenceScore: { type: Type.INTEGER },
          rationale: { type: Type.STRING },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
  const tone = normalizeTone(parsed.tone, params.currentMood || 'Reflective');
  return {
    emotionalImpact: normalizeImpact(parsed.emotionalImpact),
    tone,
    suggestedMood: normalizeTone(parsed.suggestedMood, tone),
    valenceScore: clampValence(parsed.valenceScore),
    rationale: String(parsed.rationale || '').trim().slice(0, 280),
  };
}

export async function analyzeMemoryBatchSentiment(
  entries: Array<{ id: string; title: string; content: string; mood: string }>
): Promise<Array<{ id: string } & SentimentAnalysisResult>> {
  if (entries.length === 0) return [];
  const ai = getClient();
  const compactEntries = entries.slice(0, 15).map((e) => ({
    id: e.id,
    title: e.title.slice(0, 120),
    mood: e.mood,
    content: e.content.slice(0, 700),
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Analyze the emotional impact and tone of each memory entry in this JSON array:\n${JSON.stringify(compactEntries)}`,
    config: {
      systemInstruction: [
        'For every memory entry provided, return an object with its exact id, emotionalImpact, tone, suggestedMood, valenceScore (-100 to 100), and a 1-sentence rationale.',
        'emotionalImpact MUST be one of: Uplifting, Calm, Reflective, Bittersweet, Challenging.',
        'tone and suggestedMood should be single-word emotional labels (Joyful, Grateful, Peaceful, Inspired, Hopeful, Reflective, Nostalgic, Bittersweet, Tender, Melancholic, Anxious, Courageous).',
        'Never invent facts not present in the memory text.',
      ].join('\n'),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            emotionalImpact: { type: Type.STRING },
            tone: { type: Type.STRING },
            suggestedMood: { type: Type.STRING },
            valenceScore: { type: Type.INTEGER },
            rationale: { type: Type.STRING },
          },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim()) as Array<Record<string, unknown>>;
  const validIds = new Set(compactEntries.map((e) => e.id));
  const out: Array<{ id: string } & SentimentAnalysisResult> = [];
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const id = String(item.id || '');
    if (!validIds.has(id)) continue;
    const tone = normalizeTone(item.tone);
    out.push({
      id,
      emotionalImpact: normalizeImpact(item.emotionalImpact),
      tone,
      suggestedMood: normalizeTone(item.suggestedMood, tone),
      valenceScore: clampValence(item.valenceScore),
      rationale: String(item.rationale || '').trim().slice(0, 280),
    });
  }
  return out;
}
