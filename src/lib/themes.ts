export type EchoThemeId = 'midnight' | 'glass' | 'crystal' | 'aurora' | 'amber' | 'violet';

export interface EchoThemeDefinition {
  id: EchoThemeId;
  name: string;
  tagline: string;
  isDark: boolean;
  isGlass: boolean;
  swatches: {
    canvas: string;
    surface: string;
    accent: string;
    secondary: string;
  };
}

export const ECHO_THEMES: EchoThemeDefinition[] = [
  {
    id: 'midnight',
    name: 'Midnight Obsidian',
    tagline: 'Deep obsidian canvas with crisp high-contrast slate surfaces',
    isDark: true,
    isGlass: false,
    swatches: {
      canvas: '#070B14',
      surface: '#0D1424',
      accent: '#38BDF8',
      secondary: '#22D3EE',
    },
  },
  {
    id: 'glass',
    name: 'Obsidian Glass',
    tagline: 'Translucent dark frosted panes over an ambient aurora backdrop',
    isDark: true,
    isGlass: true,
    swatches: {
      canvas: '#081229',
      surface: 'rgba(20, 34, 66, 0.56)',
      accent: '#38BDF8',
      secondary: '#818CF8',
    },
  },
  {
    id: 'crystal',
    name: 'Crystal Glass',
    tagline: 'Bright frosted alabaster glass with crisp slate typography',
    isDark: false,
    isGlass: true,
    swatches: {
      canvas: '#E5EFFB',
      surface: 'rgba(255, 255, 255, 0.72)',
      accent: '#0284C7',
      secondary: '#6366F1',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora Borealis',
    tagline: 'Nordic deep-sea slate with tranquil teal and cyan highlights',
    isDark: true,
    isGlass: false,
    swatches: {
      canvas: '#041115',
      surface: '#091C22',
      accent: '#2DD4BF',
      secondary: '#38BDF8',
    },
  },
  {
    id: 'amber',
    name: 'Amber Hearth',
    tagline: 'Warm walnut dark mode tuned for late-evening journaling',
    isDark: true,
    isGlass: false,
    swatches: {
      canvas: '#120C08',
      surface: '#1D140E',
      accent: '#FBBF24',
      secondary: '#FB923C',
    },
  },
  {
    id: 'violet',
    name: 'Nebula Dusk',
    tagline: 'Twilight indigo & plum surfaces for dream and reflection logs',
    isDark: true,
    isGlass: false,
    swatches: {
      canvas: '#0C0818',
      surface: '#16102B',
      accent: '#A78BFA',
      secondary: '#F472B6',
    },
  },
];

const THEME_STORAGE_KEY = 'echo_theme';
const VALID_THEME_IDS = new Set<string>(ECHO_THEMES.map((t) => t.id));

export function normalizeThemeId(value: unknown): EchoThemeId {
  if (typeof value === 'string' && VALID_THEME_IDS.has(value)) {
    return value as EchoThemeId;
  }
  return 'midnight';
}

export function getSavedThemeId(): EchoThemeId {
  if (typeof window === 'undefined') return 'midnight';
  try {
    return normalizeThemeId(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'midnight';
  }
}

export function applyThemeToDocument(themeId: EchoThemeId): void {
  if (typeof document === 'undefined') return;
  const resolved = normalizeThemeId(themeId);
  const def = ECHO_THEMES.find((t) => t.id === resolved) || ECHO_THEMES[0];
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  if (def.isDark) {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
  } catch {
    // ignore storage restriction
  }
}
