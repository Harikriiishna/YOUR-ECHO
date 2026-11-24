export interface CategoryBadgeStyle {
  id: string;
  label: string;
  dotHex: string;
  badgeClass: string;
  activeClass: string;
  textClass: string;
}

export const PRIMARY_CATEGORIES = ['Personal', 'Professional', 'Creative'] as const;

export const LIFE_CATEGORIES = [
  'Family',
  'Friends',
  'Love',
  'Travel',
  'Childhood',
  'Achievements',
  'Life lessons',
  'Important moments',
  'Happiness',
  'Sadness',
  'Failures',
  'Dreams',
] as const;

export const DEFAULT_CATEGORIES: string[] = [...PRIMARY_CATEGORIES, ...LIFE_CATEGORIES];

const CATEGORY_STYLE_MAP: Record<string, Omit<CategoryBadgeStyle, 'id' | 'label'>> = {
  personal: {
    dotHex: '#F43F5E',
    badgeClass:
      'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200 hover:border-rose-500/50',
    activeClass:
      'border-rose-500 bg-rose-500/20 text-rose-900 dark:text-rose-100 font-semibold',
    textClass: 'text-rose-700 dark:text-rose-300',
  },
  professional: {
    dotHex: '#3B82F6',
    badgeClass:
      'border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-200 hover:border-blue-500/50',
    activeClass:
      'border-blue-500 bg-blue-500/20 text-blue-900 dark:text-blue-100 font-semibold',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  creative: {
    dotHex: '#8B5CF6',
    badgeClass:
      'border-violet-500/30 bg-violet-500/10 text-violet-800 dark:text-violet-200 hover:border-violet-500/50',
    activeClass:
      'border-violet-500 bg-violet-500/20 text-violet-900 dark:text-violet-100 font-semibold',
    textClass: 'text-violet-700 dark:text-violet-300',
  },
  family: {
    dotHex: '#F59E0B',
    badgeClass:
      'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200 hover:border-amber-500/50',
    activeClass:
      'border-amber-500 bg-amber-500/20 text-amber-900 dark:text-amber-100 font-semibold',
    textClass: 'text-amber-700 dark:text-amber-300',
  },
  friends: {
    dotHex: '#06B6D4',
    badgeClass:
      'border-cyan-500/30 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200 hover:border-cyan-500/50',
    activeClass:
      'border-cyan-500 bg-cyan-500/20 text-cyan-900 dark:text-cyan-100 font-semibold',
    textClass: 'text-cyan-700 dark:text-cyan-300',
  },
  love: {
    dotHex: '#EC4899',
    badgeClass:
      'border-pink-500/30 bg-pink-500/10 text-pink-800 dark:text-pink-200 hover:border-pink-500/50',
    activeClass:
      'border-pink-500 bg-pink-500/20 text-pink-900 dark:text-pink-100 font-semibold',
    textClass: 'text-pink-700 dark:text-pink-300',
  },
  travel: {
    dotHex: '#10B981',
    badgeClass:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 hover:border-emerald-500/50',
    activeClass:
      'border-emerald-500 bg-emerald-500/20 text-emerald-900 dark:text-emerald-100 font-semibold',
    textClass: 'text-emerald-700 dark:text-emerald-300',
  },
  childhood: {
    dotHex: '#F97316',
    badgeClass:
      'border-orange-500/30 bg-orange-500/10 text-orange-800 dark:text-orange-200 hover:border-orange-500/50',
    activeClass:
      'border-orange-500 bg-orange-500/20 text-orange-900 dark:text-orange-100 font-semibold',
    textClass: 'text-orange-700 dark:text-orange-300',
  },
  achievements: {
    dotHex: '#22C55E',
    badgeClass:
      'border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-200 hover:border-green-500/50',
    activeClass:
      'border-green-500 bg-green-500/20 text-green-900 dark:text-green-100 font-semibold',
    textClass: 'text-green-700 dark:text-green-300',
  },
  'life lessons': {
    dotHex: '#6366F1',
    badgeClass:
      'border-indigo-500/30 bg-indigo-500/10 text-indigo-800 dark:text-indigo-200 hover:border-indigo-500/50',
    activeClass:
      'border-indigo-500 bg-indigo-500/20 text-indigo-900 dark:text-indigo-100 font-semibold',
    textClass: 'text-indigo-700 dark:text-indigo-300',
  },
  'important moments': {
    dotHex: '#0EA5E9',
    badgeClass:
      'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200 hover:border-sky-500/50',
    activeClass:
      'border-sky-500 bg-sky-500/20 text-sky-900 dark:text-sky-100 font-semibold',
    textClass: 'text-sky-700 dark:text-sky-300',
  },
  happiness: {
    dotHex: '#14B8A6',
    badgeClass:
      'border-teal-500/30 bg-teal-500/10 text-teal-800 dark:text-teal-200 hover:border-teal-500/50',
    activeClass:
      'border-teal-500 bg-teal-500/20 text-teal-900 dark:text-teal-100 font-semibold',
    textClass: 'text-teal-700 dark:text-teal-300',
  },
  sadness: {
    dotHex: '#64748B',
    badgeClass:
      'border-slate-500/30 bg-slate-500/10 text-slate-800 dark:text-slate-200 hover:border-slate-500/50',
    activeClass:
      'border-slate-500 bg-slate-500/20 text-slate-900 dark:text-slate-100 font-semibold',
    textClass: 'text-slate-700 dark:text-slate-300',
  },
  failures: {
    dotHex: '#EF4444',
    badgeClass:
      'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200 hover:border-red-500/50',
    activeClass:
      'border-red-500 bg-red-500/20 text-red-900 dark:text-red-100 font-semibold',
    textClass: 'text-red-700 dark:text-red-300',
  },
  dreams: {
    dotHex: '#A855F7',
    badgeClass:
      'border-purple-500/30 bg-purple-500/10 text-purple-800 dark:text-purple-200 hover:border-purple-500/50',
    activeClass:
      'border-purple-500 bg-purple-500/20 text-purple-900 dark:text-purple-100 font-semibold',
    textClass: 'text-purple-700 dark:text-purple-300',
  },
};

const CUSTOM_FALLBACK_STYLES: Array<Omit<CategoryBadgeStyle, 'id' | 'label'>> = [
  CATEGORY_STYLE_MAP.personal,
  CATEGORY_STYLE_MAP.professional,
  CATEGORY_STYLE_MAP.creative,
  CATEGORY_STYLE_MAP.travel,
  CATEGORY_STYLE_MAP.family,
  CATEGORY_STYLE_MAP.friends,
  CATEGORY_STYLE_MAP['life lessons'],
  CATEGORY_STYLE_MAP.childhood,
];

export function getCategoryStyle(category: string): CategoryBadgeStyle {
  const clean = (category || 'Personal').trim() || 'Personal';
  const key = clean.toLowerCase();
  const mapped = CATEGORY_STYLE_MAP[key];
  if (mapped) {
    return {
      id: clean,
      label: clean,
      ...mapped,
    };
  }
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const fallback = CUSTOM_FALLBACK_STYLES[hash % CUSTOM_FALLBACK_STYLES.length];
  return {
    id: clean,
    label: clean,
    ...fallback,
  };
}
