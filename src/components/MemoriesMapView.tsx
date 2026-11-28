import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CircleDot,
  Compass,
  Crosshair,
  ExternalLink,
  Globe,
  Heart,
  Layers,
  Loader2,
  MapPin,
  Navigation,
  Route,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import { DEFAULT_CATEGORIES, getCategoryStyle } from '../lib/memoryCategories';
import { ECHO_THEMES, getSavedThemeId } from '../lib/themes';
import type { MemoryItem } from '../types/echo';
import { MemoryConstellationCanvas } from './MemoryConstellationCanvas';
import {
  getMemoryDayMs,
  TemporalMemorySlider,
  type TemporalDateRange,
} from './TemporalMemorySlider';

export interface MemoriesMapViewProps {
  memories: MemoryItem[];
  allMemories?: MemoryItem[];
  onOpenMemory: (memory: MemoryItem) => void;
  onCreateMemory: () => void;
  onMemoryUpdated: (memory: MemoryItem) => void;
  showInlineFilters?: boolean;
  initialMode?: 'constellation' | 'world';
}

type MapWorkspaceMode = 'constellation' | 'world';
type BasemapMode = 'auto' | 'light' | 'dark' | 'terrain' | 'street';

interface PlottedMemory {
  memory: MemoryItem;
  lat: number;
  lng: number;
  displayLat: number;
  displayLng: number;
  coordSource: 'exact' | 'estimated';
}

type MapClusterNode =
  | {
      kind: 'single';
      item: PlottedMemory;
    }
  | {
      kind: 'cluster';
      key: string;
      lat: number;
      lng: number;
      latSpan: number;
      lngSpan: number;
      items: PlottedMemory[];
      palette: { hex: string; ring: string; label: string };
      summaryPlace: string;
      hasFavorite: boolean;
    };

const CITY_GAZETTEER: Array<{ keys: string[]; lat: number; lng: number }> = [
  // North America
  { keys: ['san francisco', 'sf, ca', 'bay area'], lat: 37.7749, lng: -122.4194 },
  { keys: ['silicon valley', 'palo alto', 'mountain view', 'san jose'], lat: 37.3861, lng: -122.0839 },
  { keys: ['new york', 'nyc', 'manhattan', 'brooklyn', 'queens'], lat: 40.7128, lng: -74.006 },
  { keys: ['los angeles', 'la, ca', 'hollywood', 'santa monica'], lat: 34.0522, lng: -118.2437 },
  { keys: ['san diego'], lat: 32.7157, lng: -117.1611 },
  { keys: ['seattle'], lat: 47.6062, lng: -122.3321 },
  { keys: ['portland'], lat: 45.5152, lng: -122.6784 },
  { keys: ['chicago'], lat: 41.8781, lng: -87.6298 },
  { keys: ['austin'], lat: 30.2672, lng: -97.7431 },
  { keys: ['dallas', 'houston'], lat: 29.7604, lng: -95.3698 },
  { keys: ['denver', 'boulder'], lat: 39.7392, lng: -104.9903 },
  { keys: ['boston', 'cambridge, ma'], lat: 42.3601, lng: -71.0589 },
  { keys: ['washington, dc', 'washington dc'], lat: 38.9072, lng: -77.0369 },
  { keys: ['atlanta'], lat: 33.749, lng: -84.388 },
  { keys: ['miami'], lat: 25.7617, lng: -80.1918 },
  { keys: ['las vegas'], lat: 36.1699, lng: -115.1398 },
  { keys: ['phoenix'], lat: 33.4484, lng: -112.074 },
  { keys: ['honolulu', 'hawaii', 'maui'], lat: 21.3069, lng: -157.8583 },
  { keys: ['toronto'], lat: 43.6532, lng: -79.3832 },
  { keys: ['vancouver'], lat: 49.2827, lng: -123.1207 },
  { keys: ['montreal', 'montréal'], lat: 45.5017, lng: -73.5673 },
  { keys: ['banff', 'calgary'], lat: 51.1784, lng: -115.5708 },
  { keys: ['mexico city', 'cdmx'], lat: 19.4326, lng: -99.1332 },
  { keys: ['cancun', 'cancún', 'tulum'], lat: 21.1619, lng: -86.8515 },
  // South America
  { keys: ['bogota', 'bogotá'], lat: 4.711, lng: -74.0721 },
  { keys: ['lima'], lat: -12.0464, lng: -77.0428 },
  { keys: ['cusco', 'machu picchu'], lat: -13.5319, lng: -71.9675 },
  { keys: ['santiago'], lat: -33.4489, lng: -70.6693 },
  { keys: ['rio de janeiro'], lat: -22.9068, lng: -43.1729 },
  { keys: ['sao paulo', 'são paulo'], lat: -23.5505, lng: -46.6333 },
  { keys: ['buenos aires'], lat: -34.6037, lng: -58.3816 },
  { keys: ['patagonia'], lat: -50.3379, lng: -72.2648 },
  // Europe
  { keys: ['london'], lat: 51.5072, lng: -0.1276 },
  { keys: ['oxford', 'cambridge, uk'], lat: 51.752, lng: -1.2577 },
  { keys: ['edinburgh'], lat: 55.9533, lng: -3.1883 },
  { keys: ['dublin'], lat: 53.3498, lng: -6.2603 },
  { keys: ['paris'], lat: 48.8566, lng: 2.3522 },
  { keys: ['nice', 'cannes', 'provence'], lat: 43.7102, lng: 7.262 },
  { keys: ['lyon'], lat: 45.764, lng: 4.8357 },
  { keys: ['amsterdam'], lat: 52.3676, lng: 4.9041 },
  { keys: ['brussels'], lat: 50.8503, lng: 4.3517 },
  { keys: ['berlin'], lat: 52.52, lng: 13.405 },
  { keys: ['munich', 'münchen'], lat: 48.1351, lng: 11.582 },
  { keys: ['frankfurt'], lat: 50.1109, lng: 8.6821 },
  { keys: ['hamburg'], lat: 53.5511, lng: 9.9937 },
  { keys: ['zurich', 'zürich'], lat: 47.3769, lng: 8.5417 },
  { keys: ['geneva'], lat: 46.2044, lng: 6.1432 },
  { keys: ['vienna', 'wien'], lat: 48.2082, lng: 16.3738 },
  { keys: ['prague'], lat: 50.0755, lng: 14.4378 },
  { keys: ['budapest'], lat: 47.4979, lng: 19.0402 },
  { keys: ['warsaw'], lat: 52.2297, lng: 21.0122 },
  { keys: ['krakow', 'kraków'], lat: 50.0647, lng: 19.945 },
  { keys: ['madrid'], lat: 40.4168, lng: -3.7038 },
  { keys: ['barcelona'], lat: 41.3874, lng: 2.1686 },
  { keys: ['seville', 'sevilla'], lat: 37.3891, lng: -5.9845 },
  { keys: ['lisbon', 'lisboa'], lat: 38.7223, lng: -9.1393 },
  { keys: ['porto'], lat: 41.1579, lng: -8.6291 },
  { keys: ['rome', 'roma'], lat: 41.9028, lng: 12.4964 },
  { keys: ['florence', 'firenze', 'tuscany'], lat: 43.7696, lng: 11.2558 },
  { keys: ['venice', 'venezia'], lat: 45.4408, lng: 12.3155 },
  { keys: ['milan', 'milano'], lat: 45.4642, lng: 9.19 },
  { keys: ['amalfi', 'naples'], lat: 40.6333, lng: 14.6029 },
  { keys: ['athens'], lat: 37.9838, lng: 23.7275 },
  { keys: ['santorini'], lat: 36.3932, lng: 25.4615 },
  { keys: ['istanbul'], lat: 41.0082, lng: 28.9784 },
  { keys: ['copenhagen'], lat: 55.6761, lng: 12.5683 },
  { keys: ['stockholm'], lat: 59.3293, lng: 18.0686 },
  { keys: ['oslo'], lat: 59.9139, lng: 10.7522 },
  { keys: ['helsinki'], lat: 60.1699, lng: 24.9384 },
  { keys: ['reykjavik', 'iceland'], lat: 64.1466, lng: -21.9426 },
  // Middle East & Africa
  { keys: ['cairo'], lat: 30.0444, lng: 31.2357 },
  { keys: ['marrakech', 'morocco'], lat: 31.6295, lng: -7.9811 },
  { keys: ['casablanca'], lat: 33.5731, lng: -7.5898 },
  { keys: ['nairobi'], lat: -1.2921, lng: 36.8219 },
  { keys: ['zanzibar'], lat: -6.1659, lng: 39.2026 },
  { keys: ['cape town'], lat: -33.9249, lng: 18.4241 },
  { keys: ['johannesburg'], lat: -26.2041, lng: 28.0473 },
  { keys: ['dubai'], lat: 25.2048, lng: 55.2708 },
  { keys: ['abu dhabi'], lat: 24.4539, lng: 54.3773 },
  { keys: ['doha'], lat: 25.2854, lng: 51.531 },
  { keys: ['riyadh'], lat: 24.7136, lng: 46.6753 },
  { keys: ['petra', 'amman', 'jordan'], lat: 30.3285, lng: 35.4444 },
  { keys: ['jerusalem', 'tel aviv'], lat: 32.0853, lng: 34.7818 },
  // South Asia & India
  { keys: ['mumbai', 'bombay'], lat: 19.076, lng: 72.8777 },
  { keys: ['bengaluru', 'bangalore'], lat: 12.9716, lng: 77.5946 },
  { keys: ['hyderabad'], lat: 17.385, lng: 78.4867 },
  { keys: ['delhi', 'new delhi'], lat: 28.6139, lng: 77.209 },
  { keys: ['chennai', 'madras'], lat: 13.0827, lng: 80.2707 },
  { keys: ['kolkata', 'calcutta'], lat: 22.5726, lng: 88.3639 },
  { keys: ['pune'], lat: 18.5204, lng: 73.8567 },
  { keys: ['ahmedabad'], lat: 23.0225, lng: 72.5714 },
  { keys: ['jaipur'], lat: 26.9124, lng: 75.7873 },
  { keys: ['udaipur'], lat: 24.5854, lng: 73.7125 },
  { keys: ['goa', 'panaji'], lat: 15.2993, lng: 74.124 },
  { keys: ['kochi', 'cochin', 'kerala', 'munnar'], lat: 9.9312, lng: 76.2673 },
  { keys: ['mysore', 'mysuru'], lat: 12.2958, lng: 76.6394 },
  { keys: ['pondicherry', 'puducherry'], lat: 11.9416, lng: 79.8083 },
  { keys: ['chandigarh'], lat: 30.7333, lng: 76.7794 },
  { keys: ['varanasi'], lat: 25.3176, lng: 82.9739 },
  { keys: ['rishikesh', 'dehradun'], lat: 30.0869, lng: 78.2676 },
  { keys: ['shimla'], lat: 31.1048, lng: 77.1734 },
  { keys: ['manali'], lat: 32.2432, lng: 77.1892 },
  { keys: ['ladakh', 'leh'], lat: 34.1526, lng: 77.5771 },
  { keys: ['darjeeling'], lat: 27.041, lng: 88.2663 },
  { keys: ['visakhapatnam', 'vizag'], lat: 17.6868, lng: 83.2185 },
  { keys: ['vijayawada'], lat: 16.5062, lng: 80.648 },
  { keys: ['tirupati'], lat: 13.6288, lng: 79.4192 },
  { keys: ['lucknow'], lat: 26.8467, lng: 80.9462 },
  { keys: ['indore'], lat: 22.7196, lng: 75.8577 },
  { keys: ['surat'], lat: 21.1702, lng: 72.8311 },
  { keys: ['nagpur'], lat: 21.1458, lng: 79.0882 },
  { keys: ['coimbatore'], lat: 11.0168, lng: 76.9558 },
  { keys: ['madurai'], lat: 9.9252, lng: 78.1198 },
  { keys: ['kathmandu', 'nepal'], lat: 27.7172, lng: 85.324 },
  { keys: ['colombo', 'sri lanka'], lat: 6.9271, lng: 79.8612 },
  // East & Southeast Asia
  { keys: ['singapore'], lat: 1.3521, lng: 103.8198 },
  { keys: ['kuala lumpur'], lat: 3.139, lng: 101.6869 },
  { keys: ['bangkok'], lat: 13.7563, lng: 100.5018 },
  { keys: ['chiang mai'], lat: 18.7883, lng: 98.9853 },
  { keys: ['phuket'], lat: 7.8804, lng: 98.3923 },
  { keys: ['hanoi'], lat: 21.0278, lng: 105.8342 },
  { keys: ['ho chi minh', 'saigon'], lat: 10.8231, lng: 106.6297 },
  { keys: ['bali', 'ubud', 'denpasar'], lat: -8.4095, lng: 115.1889 },
  { keys: ['jakarta'], lat: -6.2088, lng: 106.8456 },
  { keys: ['manila'], lat: 14.5995, lng: 120.9842 },
  { keys: ['tokyo'], lat: 35.6762, lng: 139.6503 },
  { keys: ['kyoto'], lat: 35.0116, lng: 135.7681 },
  { keys: ['osaka'], lat: 34.6937, lng: 135.5023 },
  { keys: ['sapporo', 'hokkaido'], lat: 43.0618, lng: 141.3545 },
  { keys: ['seoul'], lat: 37.5665, lng: 126.978 },
  { keys: ['busan'], lat: 35.1796, lng: 129.0756 },
  { keys: ['taipei'], lat: 25.033, lng: 121.5654 },
  { keys: ['hong kong'], lat: 22.3193, lng: 114.1694 },
  { keys: ['shanghai'], lat: 31.2304, lng: 121.4737 },
  { keys: ['beijing'], lat: 39.9042, lng: 116.4074 },
  // Oceania
  { keys: ['sydney'], lat: -33.8688, lng: 151.2093 },
  { keys: ['melbourne'], lat: -37.8136, lng: 144.9631 },
  { keys: ['brisbane'], lat: -27.4705, lng: 153.026 },
  { keys: ['perth'], lat: -31.9523, lng: 115.8613 },
  { keys: ['auckland'], lat: -36.8509, lng: 174.7645 },
  { keys: ['queenstown'], lat: -45.0312, lng: 168.6626 },
  // Broad country fallbacks
  { keys: ['india'], lat: 20.5937, lng: 78.9629 },
  { keys: ['united states', 'usa'], lat: 39.8283, lng: -98.5795 },
  { keys: ['canada'], lat: 56.1304, lng: -106.3468 },
  { keys: ['united kingdom', 'england', 'scotland'], lat: 54.0, lng: -2.0 },
  { keys: ['france'], lat: 46.2276, lng: 2.2137 },
  { keys: ['germany'], lat: 51.1657, lng: 10.4515 },
  { keys: ['italy'], lat: 41.8719, lng: 12.5674 },
  { keys: ['spain'], lat: 40.4637, lng: -3.7492 },
  { keys: ['japan'], lat: 36.2048, lng: 138.2529 },
  { keys: ['australia'], lat: -25.2744, lng: 133.7751 },
];

const IMPACT_MARKER_COLOR: Record<string, { hex: string; ring: string; label: string }> = {
  Uplifting: { hex: '#10B981', ring: 'rgba(16, 185, 129, 0.28)', label: 'Uplifting' },
  Calm: { hex: '#0EA5E9', ring: 'rgba(14, 165, 233, 0.28)', label: 'Calm' },
  Reflective: { hex: '#6366F1', ring: 'rgba(99, 102, 241, 0.28)', label: 'Reflective' },
  Bittersweet: { hex: '#F59E0B', ring: 'rgba(245, 158, 11, 0.28)', label: 'Bittersweet' },
  Challenging: { hex: '#F43F5E', ring: 'rgba(244, 63, 94, 0.28)', label: 'Challenging' },
};

const DEFAULT_MARKER_COLOR = {
  hex: '#E11D48',
  ring: 'rgba(225, 29, 72, 0.24)',
  label: 'General',
};

function getMarkerPalette(impact: string) {
  if (!impact) return DEFAULT_MARKER_COLOR;
  const matched = Object.entries(IMPACT_MARKER_COLOR).find(
    ([key]) => key.toLowerCase() === impact.toLowerCase()
  );
  return matched ? matched[1] : DEFAULT_MARKER_COLOR;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolvePlaceEstimate(locationName: string): { lat: number; lng: number } | null {
  const normalized = locationName.trim().toLowerCase();
  if (!normalized) return null;
  for (const entry of CITY_GAZETTEER) {
    if (entry.keys.some((k) => normalized.includes(k))) {
      return { lat: entry.lat, lng: entry.lng };
    }
  }
  return null;
}

function hasValidCoords(m: MemoryItem): boolean {
  return (
    typeof m.latitude === 'number' &&
    Number.isFinite(m.latitude) &&
    typeof m.longitude === 'number' &&
    Number.isFinite(m.longitude) &&
    Math.abs(m.latitude) <= 90 &&
    Math.abs(m.longitude) <= 180
  );
}

function buildSpatialClusters(
  items: PlottedMemory[],
  zoom: number,
  enabled: boolean
): MapClusterNode[] {
  if (!enabled || items.length <= 1) {
    return items.map((item) => ({ kind: 'single', item }));
  }

  const radiusPx = zoom <= 4 ? 58 : zoom <= 8 ? 52 : zoom <= 12 ? 46 : 38;
  const radiusSq = radiusPx * radiusPx;
  const ordered = [...items].sort((a, b) =>
    `${b.memory.memoryDate}_${a.memory.id}`.localeCompare(`${a.memory.memoryDate}_${b.memory.id}`)
  );

  interface Bucket {
    sumLat: number;
    sumLng: number;
    sumX: number;
    sumY: number;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    items: PlottedMemory[];
  }

  const buckets: Bucket[] = [];

  for (const item of ordered) {
    const pt = L.CRS.EPSG3857.latLngToPoint(L.latLng(item.lat, item.lng), zoom);
    let bestBucket: Bucket | null = null;
    let bestDistSq = radiusSq;

    for (const bucket of buckets) {
      const cx = bucket.sumX / bucket.items.length;
      const cy = bucket.sumY / bucket.items.length;
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const dSq = dx * dx + dy * dy;
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        bestBucket = bucket;
      }
    }

    if (bestBucket) {
      bestBucket.items.push(item);
      bestBucket.sumLat += item.lat;
      bestBucket.sumLng += item.lng;
      bestBucket.sumX += pt.x;
      bestBucket.sumY += pt.y;
      bestBucket.minLat = Math.min(bestBucket.minLat, item.lat);
      bestBucket.maxLat = Math.max(bestBucket.maxLat, item.lat);
      bestBucket.minLng = Math.min(bestBucket.minLng, item.lng);
      bestBucket.maxLng = Math.max(bestBucket.maxLng, item.lng);
    } else {
      buckets.push({
        sumLat: item.lat,
        sumLng: item.lng,
        sumX: pt.x,
        sumY: pt.y,
        minLat: item.lat,
        maxLat: item.lat,
        minLng: item.lng,
        maxLng: item.lng,
        items: [item],
      });
    }
  }

  return buckets.map((bucket): MapClusterNode => {
    if (bucket.items.length === 1) {
      return { kind: 'single', item: bucket.items[0] };
    }

    const impactCounts = new Map<string, number>();
    const placeCounts = new Map<string, number>();
    let hasFavorite = false;

    for (const entry of bucket.items) {
      if (entry.memory.isFavorite) hasFavorite = true;
      const imp = entry.memory.emotionalImpact || '';
      if (imp) {
        impactCounts.set(imp, (impactCounts.get(imp) || 0) + 1);
      }
      const place = (entry.memory.locationName || '').trim();
      if (place) {
        placeCounts.set(place, (placeCounts.get(place) || 0) + 1);
      }
    }

    let dominantImpact = '';
    let maxImpCount = 0;
    for (const [imp, cnt] of impactCounts.entries()) {
      if (cnt > maxImpCount) {
        maxImpCount = cnt;
        dominantImpact = imp;
      }
    }

    const sortedPlaces = [...placeCounts.entries()].sort((a, b) => b[1] - a[1]);
    let summaryPlace = 'Grouped locations';
    if (sortedPlaces.length === 1) {
      summaryPlace = sortedPlaces[0][0];
    } else if (sortedPlaces.length > 1) {
      summaryPlace = `${sortedPlaces[0][0]} & ${sortedPlaces.length - 1} more`;
    }

    return {
      kind: 'cluster',
      key: bucket.items
        .map((i) => i.memory.id)
        .sort()
        .join('|'),
      lat: bucket.sumLat / bucket.items.length,
      lng: bucket.sumLng / bucket.items.length,
      latSpan: bucket.maxLat - bucket.minLat,
      lngSpan: bucket.maxLng - bucket.minLng,
      items: bucket.items,
      palette: getMarkerPalette(dominantImpact),
      summaryPlace,
      hasFavorite,
    };
  });
}

function getSpiderfyCoordinates(
  centerLat: number,
  centerLng: number,
  count: number,
  zoom: number
): Array<{ lat: number; lng: number }> {
  const centerPt = L.CRS.EPSG3857.latLngToPoint(L.latLng(centerLat, centerLng), zoom);
  const results: Array<{ lat: number; lng: number }> = [];

  if (count <= 9) {
    const radius = Math.max(46, Math.min(86, 28 + count * 6));
    const startAngle = -Math.PI / 2;
    for (let i = 0; i < count; i += 1) {
      const angle = startAngle + (2 * Math.PI * i) / count;
      const pt = L.point(centerPt.x + radius * Math.cos(angle), centerPt.y + radius * Math.sin(angle));
      const ll = L.CRS.EPSG3857.pointToLatLng(pt, zoom);
      results.push({ lat: ll.lat, lng: ll.lng });
    }
    return results;
  }

  // Golden-angle spiral for large co-located clusters
  for (let i = 0; i < count; i += 1) {
    const angle = i * 2.39996;
    const radius = 38 + 16 * Math.sqrt(i + 1);
    const pt = L.point(centerPt.x + radius * Math.cos(angle), centerPt.y + radius * Math.sin(angle));
    const ll = L.CRS.EPSG3857.pointToLatLng(pt, zoom);
    results.push({ lat: ll.lat, lng: ll.lng });
  }
  return results;
}

const TILE_CONFIGS: Record<
  Exclude<BasemapMode, 'auto'>,
  { url: string; attribution: string; subdomains?: string; maxZoom: number }
> = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; OpenTopoMap',
    subdomains: 'abc',
    maxZoom: 17,
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: 'abc',
    maxZoom: 19,
  },
};

export function MemoriesMapView({
  memories,
  allMemories,
  onOpenMemory,
  onCreateMemory,
  onMemoryUpdated,
  showInlineFilters = false,
  initialMode,
}: MemoriesMapViewProps) {
  const { user, isOnline } = useEcho();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const trailsLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markerInstancesRef = useRef<Map<string, L.Marker>>(new Map());
  const pinningMemoryRef = useRef<MemoryItem | null>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const lastZoomRef = useRef<number>(2);

  const hasInitialLocated = useMemo(
    () =>
      memories.some(
        (m) => hasValidCoords(m) || resolvePlaceEstimate(m.locationName || '') !== null
      ),
    [memories]
  );

  const [mapMode, setMapMode] = useState<MapWorkspaceMode>(
    () => initialMode ?? (hasInitialLocated ? 'world' : 'constellation')
  );
  const [scopeMode, setScopeMode] = useState<'filtered' | 'all'>('filtered');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedImpact, setSelectedImpact] = useState('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [temporalRange, setTemporalRange] = useState<TemporalDateRange | null>(null);

  const [basemap, setBasemap] = useState<BasemapMode>('auto');
  const [showTrails, setShowTrails] = useState(true);
  const [clusterEnabled, setClusterEnabled] = useState(true);
  const [mapZoom, setMapZoom] = useState(2);
  const [expandedClusterKey, setExpandedClusterKey] = useState<string | null>(null);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listTab, setListTab] = useState<'located' | 'unlocated'>('located');
  const [pinningMemory, setPinningMemory] = useState<MemoryItem | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [tileNotice, setTileNotice] = useState(false);

  const hasMasterDifference = Boolean(allMemories && allMemories.length !== memories.length);
  const baseDataset = scopeMode === 'all' && allMemories ? allMemories : memories;
  const masterCount = allMemories ? allMemories.length : memories.length;

  const availableCategories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES);
    for (const m of baseDataset) {
      if (m.category) set.add(m.category);
    }
    return ['All', ...Array.from(set)];
  }, [baseDataset]);

  const inlineFilteredMemories = useMemo(() => {
    if (!showInlineFilters) return baseDataset;
    const q = searchQuery.trim().toLowerCase();
    return baseDataset.filter((m) => {
      if (favoritesOnly && !m.isFavorite) return false;
      if (selectedCategory !== 'All' && m.category.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      if (
        selectedImpact !== 'All' &&
        (m.emotionalImpact || 'Unscored').toLowerCase() !== selectedImpact.toLowerCase()
      ) {
        return false;
      }
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        (m.locationName || '').toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q) ||
        (m.mood || '').toLowerCase().includes(q) ||
        (m.sentimentTone || '').toLowerCase().includes(q) ||
        m.people.some((p) => p.toLowerCase().includes(q)) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [baseDataset, showInlineFilters, searchQuery, selectedCategory, selectedImpact, favoritesOnly]);

  const filteredMemories = useMemo(() => {
    if (!temporalRange) return inlineFilteredMemories;
    return inlineFilteredMemories.filter((m) => {
      const ms = getMemoryDayMs(m);
      if (ms === null) return false;
      return ms >= temporalRange.startMs && ms <= temporalRange.endMs;
    });
  }, [inlineFilteredMemories, temporalRange]);

  useEffect(() => {
    if (!temporalRange) return;
    const days = inlineFilteredMemories
      .map(getMemoryDayMs)
      .filter((ms): ms is number => ms !== null);
    if (days.length === 0) {
      setTemporalRange(null);
      return;
    }
    const min = Math.min(...days);
    const max = Math.max(...days);
    if (temporalRange.endMs < min || temporalRange.startMs > max) {
      setTemporalRange(null);
    }
  }, [inlineFilteredMemories, temporalRange]);

  const hasActiveInlineFilter =
    Boolean(searchQuery.trim()) ||
    selectedCategory !== 'All' ||
    selectedImpact !== 'All' ||
    favoritesOnly ||
    temporalRange !== null;

  const activeThemeId = user?.theme || getSavedThemeId();
  const isThemeDark = useMemo(
    () => Boolean(ECHO_THEMES.find((t) => t.id === activeThemeId)?.isDark),
    [activeThemeId]
  );

  const resolvedTileMode: Exclude<BasemapMode, 'auto'> =
    basemap === 'auto' ? (isThemeDark ? 'dark' : 'light') : basemap;

  const { plottedMemories, unlocatedMemories } = useMemo(() => {
    const rawPlotted: Array<{
      memory: MemoryItem;
      lat: number;
      lng: number;
      coordSource: 'exact' | 'estimated';
    }> = [];
    const unlocated: MemoryItem[] = [];

    for (const m of filteredMemories) {
      if (hasValidCoords(m)) {
        rawPlotted.push({
          memory: m,
          lat: m.latitude as number,
          lng: m.longitude as number,
          coordSource: 'exact',
        });
      } else {
        const est = resolvePlaceEstimate(m.locationName);
        if (est) {
          rawPlotted.push({
            memory: m,
            lat: est.lat,
            lng: est.lng,
            coordSource: 'estimated',
          });
        } else {
          unlocated.push(m);
        }
      }
    }

    const spotCounts = new Map<string, number>();
    const plotted: PlottedMemory[] = rawPlotted.map((entry) => {
      const key = `${entry.lat.toFixed(4)},${entry.lng.toFixed(4)}`;
      const indexAtSpot = spotCounts.get(key) || 0;
      spotCounts.set(key, indexAtSpot + 1);
      if (indexAtSpot === 0) {
        return {
          ...entry,
          displayLat: entry.lat,
          displayLng: entry.lng,
        };
      }
      const angle = indexAtSpot * 2.39996;
      const radius = 0.0012 * Math.sqrt(indexAtSpot);
      return {
        ...entry,
        displayLat: Math.max(-85, Math.min(85, entry.lat + radius * Math.sin(angle))),
        displayLng: Math.max(-180, Math.min(180, entry.lng + radius * Math.cos(angle))),
      };
    });

    return { plottedMemories: plotted, unlocatedMemories: unlocated };
  }, [filteredMemories]);

  const clusterNodes = useMemo(
    () => buildSpatialClusters(plottedMemories, mapZoom, clusterEnabled),
    [plottedMemories, mapZoom, clusterEnabled]
  );

  const clusterCount = useMemo(
    () => clusterNodes.filter((n) => n.kind === 'cluster').length,
    [clusterNodes]
  );

  const selectedCluster = useMemo(() => {
    if (!selectedClusterKey) return null;
    const match = clusterNodes.find(
      (n): n is Extract<MapClusterNode, { kind: 'cluster' }> =>
        n.kind === 'cluster' && n.key === selectedClusterKey
    );
    return match || null;
  }, [clusterNodes, selectedClusterKey]);

  const selectedPlotted = useMemo(
    () => plottedMemories.find((p) => p.memory.id === selectedId) || null,
    [plottedMemories, selectedId]
  );

  const plottedMemoriesRef = useRef<PlottedMemory[]>(plottedMemories);
  plottedMemoriesRef.current = plottedMemories;
  const clusterEnabledRef = useRef(clusterEnabled);
  clusterEnabledRef.current = clusterEnabled;
  const pendingMoveEndRef = useRef<(() => void) | null>(null);
  const skipNextAutoFitRef = useRef(false);

  useEffect(() => {
    pinningMemoryRef.current = pinningMemory;
  }, [pinningMemory]);

  useEffect(() => {
    if (selectedId && !plottedMemories.some((p) => p.memory.id === selectedId)) {
      setSelectedId(null);
    }
  }, [plottedMemories, selectedId]);

  useEffect(() => {
    if (
      expandedClusterKey &&
      !clusterNodes.some((n) => n.kind === 'cluster' && n.key === expandedClusterKey)
    ) {
      setExpandedClusterKey(null);
    }
    if (
      selectedClusterKey &&
      !clusterNodes.some((n) => n.kind === 'cluster' && n.key === selectedClusterKey)
    ) {
      setSelectedClusterKey(null);
    }
  }, [clusterNodes, expandedClusterKey, selectedClusterKey]);

  useEffect(() => {
    if (plottedMemories.length === 0 && unlocatedMemories.length > 0) {
      setListTab('unlocated');
    }
  }, [plottedMemories.length, unlocatedMemories.length]);

  const saveCoordinatesForMemory = async (mem: MemoryItem, lat: number, lng: number) => {
    setSavingPin(true);
    setPinError(null);
    try {
      const roundedLat = Number(lat.toFixed(5));
      const roundedLng = Number(lng.toFixed(5));
      const res = await apiRequest<{ memory: MemoryItem }>(`/memories/${encodeURIComponent(mem.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: mem.title,
          content: mem.content,
          memoryDate: mem.memoryDate,
          locationName: mem.locationName || `${roundedLat.toFixed(3)}, ${roundedLng.toFixed(3)}`,
          latitude: roundedLat,
          longitude: roundedLng,
          mood: mem.mood,
          category: mem.category,
          isFavorite: mem.isFavorite,
          aiExcluded: mem.aiExcluded,
          aiSummary: mem.aiSummary,
          sentimentTone: mem.sentimentTone,
          emotionalImpact: mem.emotionalImpact,
          sentimentScore: mem.sentimentScore,
          sentimentRationale: mem.sentimentRationale,
          collectionId: mem.collectionId,
          tags: mem.tags,
          people: mem.people,
          mediaIds: mem.media.map((x) => x.id),
        }),
      });
      skipNextAutoFitRef.current = true;
      onMemoryUpdated(res.memory);
      setPinningMemory(null);
      setSelectedId(res.memory.id);
      setSelectedClusterKey(null);
      setListTab('located');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Unable to save coordinates.');
    } finally {
      setSavingPin(false);
    }
  };

  const saveCoordinatesRef = useRef(saveCoordinatesForMemory);
  saveCoordinatesRef.current = saveCoordinatesForMemory;

  // Initialize Leaflet map only while World Atlas mode is mounted
  useEffect(() => {
    if (mapMode !== 'world') return;
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: [22, 12],
      zoom: 2,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
      zoomControl: true,
    });

    const trailsLayer = L.layerGroup().addTo(map);
    const markersLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    trailsLayerRef.current = trailsLayer;
    markersLayerRef.current = markersLayer;
    lastZoomRef.current = map.getZoom();
    setMapZoom(map.getZoom());

    map.on('click', (e: L.LeafletMouseEvent) => {
      const targetMemory = pinningMemoryRef.current;
      if (targetMemory) {
        void saveCoordinatesRef.current(targetMemory, e.latlng.lat, e.latlng.lng);
        return;
      }
      setExpandedClusterKey(null);
    });

    map.on('zoomend', () => {
      const nextZoom = map.getZoom();
      if (nextZoom < lastZoomRef.current) {
        setExpandedClusterKey(null);
      }
      lastZoomRef.current = nextZoom;
      setMapZoom(nextZoom);
    });

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(container);

    window.setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 50);

    return () => {
      if (pendingMoveEndRef.current) {
        map.off('moveend', pendingMoveEndRef.current);
        pendingMoveEndRef.current = null;
      }
      resizeObserver.disconnect();
      markerInstancesRef.current.clear();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      trailsLayerRef.current = null;
      markersLayerRef.current = null;
    };
  }, [mapMode]);

  // Swap tile layer when basemap or theme changes in World Atlas mode
  useEffect(() => {
    if (mapMode !== 'world') return;
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    setTileNotice(false);
    const cfg = TILE_CONFIGS[resolvedTileMode];
    let errorCount = 0;
    const layer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      subdomains: cfg.subdomains || 'abc',
      maxZoom: cfg.maxZoom,
    });

    layer.on('tileerror', () => {
      errorCount += 1;
      if (errorCount >= 4) {
        setTileNotice(true);
      }
    });

    layer.addTo(map);
    tileLayerRef.current = layer;
  }, [mapMode, resolvedTileMode]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    container.style.cursor = pinningMemory ? 'crosshair' : '';
  }, [pinningMemory, mapMode]);

  const buildMemoryMarker = useCallback(
    (item: PlottedMemory, lat: number, lng: number, isSpiderfied: boolean) => {
      const { memory, coordSource } = item;
      const palette = getMarkerPalette(memory.emotionalImpact);
      const isSelected = memory.id === selectedId;
      const size = isSelected ? 22 : memory.isFavorite ? 17 : 14;
      const borderStyle = coordSource === 'estimated' ? 'dashed' : 'solid';
      const starBadge = memory.isFavorite
        ? `<span style="position:absolute;top:1px;right:1px;width:7px;height:7px;border-radius:9999px;background:#FACC15;border:1px solid #ffffff;"></span>`
        : '';

      const icon = L.divIcon({
        className: 'echo-leaflet-pin',
        iconSize: [size + 14, size + 14],
        iconAnchor: [(size + 14) / 2, (size + 14) / 2],
        popupAnchor: [0, -(size / 2 + 7)],
        html: `
          <div class="echo-leaflet-pin-inner" style="
            position:relative;
            width:${size + 14}px;
            height:${size + 14}px;
            display:flex;
            align-items:center;
            justify-content:center;
          ">
            <span style="
              width:${size}px;
              height:${size}px;
              border-radius:9999px;
              background:${palette.hex};
              border:2.5px ${borderStyle} #ffffff;
              box-shadow:0 0 0 ${isSelected ? '7px' : '4px'} ${palette.ring}, 0 3px 10px rgba(0,0,0,0.38);
              display:block;
            "></span>
            ${starBadge}
          </div>
        `,
      });

      const marker = L.marker([lat, lng], {
        icon,
        zIndexOffset: isSelected ? 600 : isSpiderfied ? 350 : 100,
        title: memory.locationName ? `${memory.title} — ${memory.locationName}` : memory.title,
      });

      const metaParts = [
        escapeHtml(memory.memoryDate),
        escapeHtml(memory.category),
        escapeHtml(memory.sentimentTone || memory.mood),
      ];
      if (memory.emotionalImpact) {
        metaParts.push(escapeHtml(memory.emotionalImpact));
      }

      const excerptText =
        memory.content.length > 120 ? `${memory.content.slice(0, 120).trim()}…` : memory.content;

      const popupEl = document.createElement('div');
      popupEl.className = 'echo-leaflet-popup-body';
      popupEl.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:11px;opacity:0.75;margin-bottom:4px;">
          ${metaParts.join(' · ')}
        </div>
        <div style="font-family:var(--font-display);font-weight:700;font-size:14px;line-height:1.3;margin-bottom:4px;">
          ${escapeHtml(memory.title)}
        </div>
        <div style="font-size:12px;opacity:0.86;line-height:1.45;margin-bottom:8px;">
          ${escapeHtml(excerptText)}
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;opacity:0.75;margin-bottom:8px;">
          ${escapeHtml(memory.locationName || 'Pinned coordinates')} · ${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}${
            coordSource === 'estimated' ? ' (Approx.)' : ''
          }
        </div>
      `;

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = 'Open Full Memory';
      openBtn.className = 'echo-leaflet-open-btn';
      openBtn.onclick = (ev) => {
        ev.stopPropagation();
        onOpenMemory(memory);
      };
      popupEl.appendChild(openBtn);

      marker.bindPopup(popupEl, { maxWidth: 270, minWidth: 210 });
      marker.on('click', () => {
        setSelectedId(memory.id);
        if (!isSpiderfied) {
          setSelectedClusterKey(null);
        }
        setListTab('located');
      });

      return marker;
    },
    [selectedId, onOpenMemory]
  );

  // Render dynamic clusters, expanded spiderfied markers, single markers & Journey Trails
  useEffect(() => {
    if (mapMode !== 'world') return;
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    const trailsLayer = trailsLayerRef.current;
    if (!map || !layer || !trailsLayer) return;

    layer.clearLayers();
    trailsLayer.clearLayers();
    markerInstancesRef.current.clear();

    if (showTrails && plottedMemories.length >= 2) {
      const sorted = [...plottedMemories].sort((a, b) =>
        `${a.memory.memoryDate}_${a.memory.createdAt}`.localeCompare(
          `${b.memory.memoryDate}_${b.memory.createdAt}`
        )
      );
      const latLngs: L.LatLngExpression[] = sorted.map((p) => [p.displayLat, p.displayLng]);
      L.polyline(latLngs, {
        color: '#38BDF8',
        weight: 2.2,
        opacity: 0.72,
        dashArray: '6 7',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(trailsLayer);
    }

    const currentZoom = map.getZoom();

    for (const node of clusterNodes) {
      if (node.kind === 'single') {
        const marker = buildMemoryMarker(
          node.item,
          node.item.displayLat,
          node.item.displayLng,
          false
        );
        marker.addTo(layer);
        markerInstancesRef.current.set(node.item.memory.id, marker);
        continue;
      }

      const isExpanded = expandedClusterKey === node.key;

      if (isExpanded) {
        const positions = getSpiderfyCoordinates(
          node.lat,
          node.lng,
          node.items.length,
          currentZoom
        );

        // Radial spokes connecting center anchor to expanded pins
        node.items.forEach((item, idx) => {
          const pos = positions[idx];
          L.polyline(
            [
              [node.lat, node.lng],
              [pos.lat, pos.lng],
            ],
            {
              color: node.palette.hex,
              weight: 1.5,
              opacity: 0.65,
              dashArray: '4 4',
            }
          ).addTo(layer);

          const marker = buildMemoryMarker(item, pos.lat, pos.lng, true);
          marker.addTo(layer);
          markerInstancesRef.current.set(item.memory.id, marker);
        });

        // Center collapse hub
        const hubIcon = L.divIcon({
          className: 'echo-leaflet-cluster',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          html: `
            <div class="echo-leaflet-cluster-orb" style="
              width:28px;
              height:28px;
              border-radius:9999px;
              background:var(--echo-surface);
              color:var(--echo-ink);
              border:2px solid ${node.palette.hex};
              box-shadow:0 2px 10px rgba(0,0,0,0.35);
              display:flex;
              align-items:center;
              justify-content:center;
              font-family:var(--font-mono);
              font-size:12px;
              font-weight:700;
            ">&times;</div>
          `,
        });

        const hubMarker = L.marker([node.lat, node.lng], {
          icon: hubIcon,
          zIndexOffset: 420,
          title: `Collapse ${node.items.length} expanded memories`,
        });
        hubMarker.bindTooltip(`Collapse cluster (${node.items.length})`, {
          direction: 'top',
          offset: [0, -12],
        });
        hubMarker.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          setExpandedClusterKey(null);
        });
        hubMarker.addTo(layer);
        continue;
      }

      // Collapsed dynamic cluster bubble
      const count = node.items.length;
      const orbSize = count >= 25 ? 46 : count >= 10 ? 40 : 34;
      const isClusterSelected = selectedClusterKey === node.key;
      const favDot = node.hasFavorite
        ? `<span style="position:absolute;top:1px;right:1px;width:8px;height:8px;border-radius:9999px;background:#FACC15;border:1.5px solid #ffffff;"></span>`
        : '';

      const clusterIcon = L.divIcon({
        className: 'echo-leaflet-cluster',
        iconSize: [orbSize + 14, orbSize + 14],
        iconAnchor: [(orbSize + 14) / 2, (orbSize + 14) / 2],
        html: `
          <div style="
            position:relative;
            width:${orbSize + 14}px;
            height:${orbSize + 14}px;
            display:flex;
            align-items:center;
            justify-content:center;
          ">
            <div class="echo-leaflet-cluster-orb" style="
              width:${orbSize}px;
              height:${orbSize}px;
              border-radius:9999px;
              background:${node.palette.hex};
              color:#ffffff;
              border:2.5px solid #ffffff;
              box-shadow:0 0 0 ${isClusterSelected ? '8px' : '5px'} ${node.palette.ring}, 0 4px 14px rgba(0,0,0,0.38);
              display:flex;
              align-items:center;
              justify-content:center;
              font-family:var(--font-mono);
              font-variant-numeric:tabular-nums;
              font-size:${count >= 100 ? '11px' : '13px'};
              font-weight:700;
              letter-spacing:-0.02em;
            ">${count}</div>
            ${favDot}
          </div>
        `,
      });

      const clusterMarker = L.marker([node.lat, node.lng], {
        icon: clusterIcon,
        zIndexOffset: isClusterSelected ? 500 : 250,
        title: `${count} memories near ${node.summaryPlace}`,
      });

      clusterMarker.bindTooltip(
        `${count} memories · ${escapeHtml(node.summaryPlace)} · Click to expand`,
        {
          direction: 'top',
          offset: [0, -(orbSize / 2 + 4)],
        }
      );

      clusterMarker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        if (pinningMemoryRef.current) {
          void saveCoordinatesRef.current(pinningMemoryRef.current, node.lat, node.lng);
          return;
        }
        setSelectedId(null);
        setSelectedClusterKey(node.key);
        setListTab('located');

        const canZoomCloser =
          (node.latSpan > 0.004 || node.lngSpan > 0.004) && map.getZoom() < 14;
        if (canZoomCloser) {
          const bounds = L.latLngBounds(
            node.items.map((i) => [i.lat, i.lng] as [number, number])
          );
          map.fitBounds(bounds, { padding: [64, 64], maxZoom: 15, animate: true });
        } else {
          setExpandedClusterKey(node.key);
          map.panTo([node.lat, node.lng], { animate: true });
        }
      });

      clusterMarker.addTo(layer);
    }

    // If a directory click queued a pending focus that was inside a cluster, reveal and open it
    const pendingId = pendingFocusIdRef.current;
    if (pendingId) {
      const directMarker = markerInstancesRef.current.get(pendingId);
      if (directMarker) {
        pendingFocusIdRef.current = null;
        directMarker.openPopup();
      } else {
        const containingCluster = clusterNodes.find(
          (n): n is Extract<MapClusterNode, { kind: 'cluster' }> =>
            n.kind === 'cluster' && n.items.some((i) => i.memory.id === pendingId)
        );
        if (containingCluster && expandedClusterKey !== containingCluster.key) {
          setExpandedClusterKey(containingCluster.key);
          setSelectedClusterKey(containingCluster.key);
        }
      }
    }
  }, [
    mapMode,
    clusterNodes,
    expandedClusterKey,
    selectedClusterKey,
    plottedMemories,
    showTrails,
    buildMemoryMarker,
  ]);

  const fitAllMarkers = () => {
    const map = mapRef.current;
    if (!map) return;
    setExpandedClusterKey(null);
    setSelectedClusterKey(null);
    if (plottedMemories.length === 0) {
      map.setView([22, 12], 2, { animate: true });
      return;
    }
    if (plottedMemories.length === 1) {
      const only = plottedMemories[0];
      map.setView([only.displayLat, only.displayLng], 9, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(
      plottedMemories.map((p) => [p.displayLat, p.displayLng] as [number, number])
    );
    map.fitBounds(bounds, { padding: [44, 44], maxZoom: 12, animate: true });
  };

  const temporalActiveRef = useRef(false);
  temporalActiveRef.current = temporalRange !== null;

  useEffect(() => {
    if (mapMode !== 'world') return;
    if (skipNextAutoFitRef.current) {
      skipNextAutoFitRef.current = false;
      return;
    }
    if (temporalActiveRef.current) return;
    fitAllMarkers();
  }, [mapMode, plottedMemories.length]);

  const focusMemoryOnMap = (item: PlottedMemory) => {
    setSelectedId(item.memory.id);
    setSelectedClusterKey(null);
    const map = mapRef.current;
    if (!map) return;

    if (pendingMoveEndRef.current) {
      map.off('moveend', pendingMoveEndRef.current);
      pendingMoveEndRef.current = null;
    }

    const existingMarker = markerInstancesRef.current.get(item.memory.id);
    if (existingMarker) {
      map.flyTo(existingMarker.getLatLng(), Math.max(map.getZoom(), 11), {
        duration: 0.55,
      });
      existingMarker.openPopup();
      return;
    }

    // Memory is currently inside a collapsed cluster -> fly close and auto-spiderfy if still grouped
    pendingFocusIdRef.current = item.memory.id;
    const onMoveEnd = () => {
      pendingMoveEndRef.current = null;
      const zoom = map.getZoom();
      const updatedClusters = buildSpatialClusters(
        plottedMemoriesRef.current,
        zoom,
        clusterEnabledRef.current
      );
      const containerCluster = updatedClusters.find(
        (n): n is Extract<MapClusterNode, { kind: 'cluster' }> =>
          n.kind === 'cluster' && n.items.some((i) => i.memory.id === item.memory.id)
      );
      if (containerCluster) {
        setExpandedClusterKey(containerCluster.key);
        setSelectedClusterKey(containerCluster.key);
      }
    };
    pendingMoveEndRef.current = onMoveEnd;
    map.once('moveend', onMoveEnd);
    map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 13), {
      duration: 0.65,
    });
  };

  const handlePinWithDeviceGps = (mem: MemoryItem) => {
    if (!navigator.geolocation) {
      setPinError('Device geolocation is unavailable in this browser.');
      return;
    }
    setSavingPin(true);
    setPinError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void saveCoordinatesForMemory(mem, pos.coords.latitude, pos.coords.longitude);
      },
      (geoErr) => {
        setSavingPin(false);
        setPinError(geoErr.message || 'Unable to read current GPS location.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSwitchToPinOnWorldMap = (mem: MemoryItem) => {
    setMapMode('world');
    setPinningMemory(mem);
    setPinError(null);
    if (plottedMemories.some((p) => p.memory.id === mem.id)) {
      setSelectedId(mem.id);
    }
  };

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 space-y-4">
      {/* Top Workspace Bar: Title, Mode Switcher & Scope Toggle */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
              <MapPin className="w-4 h-4 text-accent-text shrink-0" />
              Memory Map Atlas
            </h2>
            {hasMasterDifference && (
              <div
                className="inline-flex items-center rounded-xl border border-hairline bg-inset p-0.5 text-xs"
                role="group"
                aria-label="Memory scope"
              >
                <button
                  type="button"
                  onClick={() => setScopeMode('filtered')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    scopeMode === 'filtered'
                      ? 'bg-surface text-ink font-semibold shadow-xs'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Filtered ({memories.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    scopeMode === 'all'
                      ? 'bg-surface text-ink font-semibold shadow-xs'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  All Memories ({allMemories?.length || memories.length})
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-ink-muted tabular-nums">
            {mapMode === 'constellation' ? (
              <>
                <span className="font-mono">{filteredMemories.length}</span> of{' '}
                <span className="font-mono">{masterCount}</span> memories charted across places, years,
                moods & people
              </>
            ) : (
              <>
                <span className="font-mono">{plottedMemories.length}</span> located on world atlas
                {clusterEnabled && clusterCount > 0 && (
                  <>
                    {' '}
                    <span aria-hidden="true">·</span>{' '}
                    <span className="font-mono">{clusterCount}</span> dynamic{' '}
                    {clusterCount === 1 ? 'cluster' : 'clusters'}
                  </>
                )}
                {unlocatedMemories.length > 0 && (
                  <>
                    {' '}
                    <span aria-hidden="true">·</span>{' '}
                    <span className="font-mono">{unlocatedMemories.length}</span> awaiting coordinates
                  </>
                )}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Primary Mode Switcher: World Atlas vs Constellation */}
          <div
            className="inline-flex items-center rounded-xl border border-hairline bg-inset p-0.5 text-xs"
            role="group"
            aria-label="Map view mode"
          >
            <button
              type="button"
              onClick={() => setMapMode('world')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mapMode === 'world'
                  ? 'bg-accent text-accent-ink font-semibold'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              World Atlas
            </button>
            <button
              type="button"
              onClick={() => setMapMode('constellation')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mapMode === 'constellation'
                  ? 'bg-accent text-accent-ink font-semibold'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Constellation
            </button>
          </div>

          {mapMode === 'world' && (
            <>
              <div
                className="inline-flex items-center rounded-xl border border-hairline bg-inset p-0.5 text-xs"
                role="group"
                aria-label="Basemap style"
              >
                <span className="inline-flex items-center gap-1 px-2 text-[11px] text-ink-muted whitespace-nowrap shrink-0">
                  <Layers className="w-3 h-3" />
                  Style
                </span>
                {(
                  [
                    { id: 'auto', label: 'Auto' },
                    { id: 'light', label: 'Light' },
                    { id: 'dark', label: 'Dark' },
                    { id: 'terrain', label: 'Terrain' },
                    { id: 'street', label: 'Street' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBasemap(opt.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      basemap === opt.id
                        ? 'bg-accent text-accent-ink font-semibold'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setClusterEnabled((v) => !v);
                  setExpandedClusterKey(null);
                  setSelectedClusterKey(null);
                }}
                aria-pressed={clusterEnabled}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 min-h-[34px] transition-colors ${
                  clusterEnabled
                    ? 'border-accent-border bg-accent-soft text-accent-text font-semibold'
                    : 'border-hairline-strong bg-inset text-ink-secondary hover:text-ink hover:bg-tint-hover'
                }`}
              >
                <CircleDot className="w-3.5 h-3.5" />
                Cluster Pins
              </button>

              <button
                type="button"
                onClick={() => setShowTrails((v) => !v)}
                aria-pressed={showTrails}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 min-h-[34px] transition-colors ${
                  showTrails
                    ? 'border-accent-border bg-accent-soft text-accent-text font-semibold'
                    : 'border-hairline-strong bg-inset text-ink-secondary hover:text-ink hover:bg-tint-hover'
                }`}
              >
                <Route className="w-3.5 h-3.5" />
                Journey Trails
              </button>

              <button
                type="button"
                onClick={fitAllMarkers}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink hover:bg-tint-hover whitespace-nowrap shrink-0 min-h-[34px]"
              >
                <Compass className="w-3.5 h-3.5 text-accent-text" />
                Fit Pins
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline Search & Filters (for dedicated Memory Map page) */}
      {showInlineFilters && (
        <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 pt-1 border-t border-hairline">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter memories by title, city, person, mood, or #tag..."
              className="w-full rounded-xl border border-hairline bg-inset pl-8 pr-8 py-2 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent-border"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter by category"
              className="rounded-xl border border-hairline bg-inset px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent-border whitespace-nowrap shrink-0"
            >
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'All' ? 'All Categories' : cat}
                </option>
              ))}
            </select>

            <select
              value={selectedImpact}
              onChange={(e) => setSelectedImpact(e.target.value)}
              aria-label="Filter by emotional tone"
              className="rounded-xl border border-hairline bg-inset px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent-border whitespace-nowrap shrink-0"
            >
              <option value="All">All Tones</option>
              <option value="Uplifting">Uplifting</option>
              <option value="Calm">Calm</option>
              <option value="Reflective">Reflective</option>
              <option value="Bittersweet">Bittersweet</option>
              <option value="Challenging">Challenging</option>
            </select>

            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              aria-pressed={favoritesOnly}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                favoritesOnly
                  ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-200 font-semibold'
                  : 'border-hairline bg-inset text-ink-secondary hover:text-ink'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-rose-400 text-rose-400' : ''}`} />
              Favorites
            </button>

            {hasActiveInlineFilter && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                  setSelectedImpact('All');
                  setFavoritesOnly(false);
                  setTemporalRange(null);
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-inset px-2.5 py-2 text-xs font-medium text-ink-muted hover:text-ink whitespace-nowrap shrink-0"
              >
                <X className="w-3 h-3" />
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* MODE 1: MEMORY CONSTELLATION (ALL MEMORIES) */}
      {mapMode === 'constellation' && (
        <MemoryConstellationCanvas
          memories={filteredMemories}
          allMemoriesCount={masterCount}
          onOpenMemory={onOpenMemory}
          onCreateMemory={onCreateMemory}
          onPinOnWorldMap={handleSwitchToPinOnWorldMap}
        />
      )}

      {/* MODE 2: WORLD ATLAS (LEAFLET GEO MAP WITH DYNAMIC CLUSTERING) */}
      {mapMode === 'world' && (
        <>
          {/* Pin-Placement Mode Banner */}
          {pinningMemory && (
            <div className="rounded-xl border border-accent-border bg-accent-soft px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-ink flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-accent-text shrink-0" />
                <span>
                  Click anywhere on the map to pin <strong>{pinningMemory.title}</strong>
                  {pinningMemory.locationName ? ` (${pinningMemory.locationName})` : ''}.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={savingPin || !isOnline}
                  onClick={() => handlePinWithDeviceGps(pinningMemory)}
                  className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-tint-hover disabled:opacity-40 whitespace-nowrap"
                >
                  {savingPin ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
                  Use My GPS
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPinningMemory(null);
                    setPinError(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-secondary hover:text-ink whitespace-nowrap"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          )}

          {pinError && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-2">
              <span>{pinError}</span>
              <button type="button" onClick={() => setPinError(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {tileNotice && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-800 dark:text-amber-200">
              Map tiles could not load from the tile server (offline or restricted network). Your plotted clusters, pins, and metadata remain interactive.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            <div className="lg:col-span-8 flex flex-col gap-2.5 min-w-0">
              <div className="relative rounded-xl border border-hairline bg-inset overflow-hidden">
                {/* Subtle offline coordinate graticule backdrop */}
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-25"
                  viewBox="0 0 800 460"
                  preserveAspectRatio="none"
                >
                  {[92, 184, 276, 368].map((y) => (
                    <line
                      key={`lat-${y}`}
                      x1="0"
                      y1={y}
                      x2="800"
                      y2={y}
                      stroke="currentColor"
                      strokeDasharray="4 6"
                      strokeOpacity="0.22"
                    />
                  ))}
                  {[160, 320, 480, 640].map((x) => (
                    <line
                      key={`lng-${x}`}
                      x1={x}
                      y1="0"
                      x2={x}
                      y2="460"
                      stroke="currentColor"
                      strokeDasharray="4 6"
                      strokeOpacity="0.22"
                    />
                  ))}
                </svg>
                <div
                  ref={mapContainerRef}
                  className="relative w-full h-[380px] sm:h-[480px] z-0"
                  aria-label="Interactive memory location map"
                />
              </div>

              {/* Unboxed Impact Color Legend */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted px-0.5">
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  {Object.values(IMPACT_MARKER_COLOR).map((item) => (
                    <span key={item.label} className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: item.hex }}
                        aria-hidden="true"
                      />
                      <span>{item.label}</span>
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                      style={{ backgroundColor: DEFAULT_MARKER_COLOR.hex }}
                      aria-hidden="true"
                    />
                    <span>Unscored</span>
                  </span>
                </div>
                <span className="text-[11px] text-ink-muted">
                  Click numbered clusters to zoom or fan out pins · Dashed ring = place match
                </span>
              </div>
            </div>

            {/* Right Sidebar: Selected Preview / Active Cluster & Place Directory */}
            <div className="lg:col-span-4 flex flex-col gap-3 min-w-0">
              {selectedPlotted && (
                <div className="rounded-xl border border-accent-border bg-inset p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-ink-muted tabular-nums">
                      <span>{selectedPlotted.memory.memoryDate}</span>
                      <span aria-hidden="true">·</span>
                      {(() => {
                        const catStyle = getCategoryStyle(selectedPlotted.memory.category);
                        return (
                          <span className={`inline-flex items-center gap-1 font-sans font-medium ${catStyle.textClass}`}>
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: catStyle.dotHex }}
                              aria-hidden="true"
                            />
                            {selectedPlotted.memory.category}
                          </span>
                        );
                      })()}
                      {selectedPlotted.memory.emotionalImpact && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{selectedPlotted.memory.emotionalImpact}</span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      aria-label="Clear selected pin"
                      className="text-ink-muted hover:text-ink p-0.5 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-ink leading-snug">
                      {selectedPlotted.memory.title}
                    </h3>
                    {selectedPlotted.memory.isFavorite && (
                      <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400 shrink-0 mt-1" />
                    )}
                  </div>

                  <p className="text-xs text-ink-secondary line-clamp-3 leading-relaxed">
                    {selectedPlotted.memory.content}
                  </p>

                  <div className="text-[11px] font-mono text-ink-muted tabular-nums space-y-0.5">
                    <div>
                      {selectedPlotted.memory.locationName || 'Pinned coordinates'} ·{' '}
                      {selectedPlotted.lat.toFixed(4)}, {selectedPlotted.lng.toFixed(4)}
                      {selectedPlotted.coordSource === 'estimated' ? ' (Approx.)' : ''}
                    </div>
                    {selectedPlotted.memory.people.length > 0 && (
                      <div className="font-sans">With: {selectedPlotted.memory.people.join(', ')}</div>
                    )}
                    {selectedPlotted.memory.tags.length > 0 && (
                      <div className="font-sans text-sky-700 dark:text-sky-300">
                        {selectedPlotted.memory.tags.map((t) => `#${t}`).join(' · ')}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onOpenMemory(selectedPlotted.memory)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Full Memory
                    </button>
                    <button
                      type="button"
                      disabled={!isOnline}
                      onClick={() => setPinningMemory(selectedPlotted.memory)}
                      title="Click on the map to adjust this memory's coordinates"
                      className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink disabled:opacity-40 whitespace-nowrap"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      Move Pin
                    </button>
                  </div>
                </div>
              )}

              {/* Active Cluster Inspector Card */}
              {!selectedPlotted && selectedCluster && (
                <div className="rounded-xl border border-accent-border bg-inset p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono text-ink-muted tabular-nums">
                        {selectedCluster.items.length} memories · {selectedCluster.summaryPlace}
                      </div>
                      <h3 className="font-display text-sm font-semibold text-ink">
                        Clustered Memories
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClusterKey(null);
                        setExpandedClusterKey(null);
                      }}
                      aria-label="Close cluster details"
                      className="text-ink-muted hover:text-ink p-0.5 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
                    {selectedCluster.items.map((item) => {
                      const pal = getMarkerPalette(item.memory.emotionalImpact);
                      return (
                        <button
                          key={item.memory.id}
                          type="button"
                          onClick={() => focusMemoryOnMap(item)}
                          className="w-full text-left rounded-lg border border-hairline bg-surface hover:border-accent-border px-2.5 py-2 transition-colors flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-ink truncate inline-flex items-center gap-1.5 max-w-full">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: pal.hex }}
                                aria-hidden="true"
                              />
                              <span className="truncate">{item.memory.title}</span>
                            </div>
                            <div className="text-[10px] font-mono text-ink-muted tabular-nums truncate">
                              {item.memory.memoryDate} · {item.memory.category}
                            </div>
                          </div>
                          <ExternalLink className="w-3 h-3 text-ink-muted shrink-0" />
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (expandedClusterKey === selectedCluster.key) {
                          setExpandedClusterKey(null);
                        } else {
                          setExpandedClusterKey(selectedCluster.key);
                          mapRef.current?.panTo([selectedCluster.lat, selectedCluster.lng], {
                            animate: true,
                          });
                        }
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors whitespace-nowrap"
                    >
                      <CircleDot className="w-3.5 h-3.5" />
                      {expandedClusterKey === selectedCluster.key ? 'Collapse Pins' : 'Expand All Pins'}
                    </button>
                  </div>
                </div>
              )}

              {/* Directory Tabs */}
              <div className="flex items-center gap-1 p-1 rounded-xl border border-hairline bg-inset">
                <button
                  type="button"
                  onClick={() => setListTab('located')}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                    listTab === 'located'
                      ? 'bg-surface text-ink font-semibold shadow-xs'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Located ({plottedMemories.length})
                </button>
                <button
                  type="button"
                  onClick={() => setListTab('unlocated')}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                    listTab === 'unlocated'
                      ? 'bg-surface text-ink font-semibold shadow-xs'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Unpinned ({unlocatedMemories.length})
                </button>
              </div>

              {/* Scrollable Memory Directory */}
              <div className="flex-1 max-h-[340px] lg:max-h-[400px] overflow-y-auto space-y-2 pr-0.5">
                {listTab === 'located' ? (
                  plottedMemories.length === 0 ? (
                    <div className="rounded-xl border border-hairline bg-inset p-5 text-center space-y-2.5">
                      <p className="text-xs font-medium text-ink">No located memories yet</p>
                      <p className="text-xs text-ink-muted">
                        Add a city name or GPS coordinates to any memory, or pick an unpinned entry to place it on the world atlas.
                      </p>
                      {unlocatedMemories.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setListTab('unlocated')}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                        >
                          Pin Existing Memory
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={onCreateMemory}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                        >
                          Capture Memory
                        </button>
                      )}
                    </div>
                  ) : (
                    plottedMemories.map((item) => {
                      const active = item.memory.id === selectedId;
                      const palette = getMarkerPalette(item.memory.emotionalImpact);
                      const catStyle = getCategoryStyle(item.memory.category);
                      return (
                        <button
                          key={item.memory.id}
                          type="button"
                          onClick={() => focusMemoryOnMap(item)}
                          className={`w-full text-left rounded-xl border p-3 transition-colors space-y-1 ${
                            active
                              ? 'border-accent-border bg-surface-raised'
                              : 'border-hairline bg-inset hover:border-hairline-strong'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-ink truncate inline-flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: palette.hex }}
                                aria-hidden="true"
                              />
                              {item.memory.title}
                            </span>
                            <span className="text-[10px] font-mono text-ink-muted tabular-nums shrink-0">
                              {item.memory.memoryDate}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
                            <span className="truncate">
                              {item.memory.locationName || 'Pinned coordinates'}
                              {item.coordSource === 'estimated' ? ' · Approx.' : ''}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[11px] font-medium shrink-0 ${catStyle.textClass}`}>
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: catStyle.dotHex }}
                                aria-hidden="true"
                              />
                              {item.memory.category}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )
                ) : unlocatedMemories.length === 0 ? (
                  <div className="rounded-xl border border-hairline bg-inset p-5 text-center space-y-2">
                    <p className="text-xs font-medium text-ink">All visible memories are mapped</p>
                    <p className="text-xs text-ink-muted">
                      Every memory in your current view already has a place on the world atlas.
                    </p>
                  </div>
                ) : (
                  unlocatedMemories.map((m) => {
                    const isBeingPinned = pinningMemory?.id === m.id;
                    return (
                      <div
                        key={m.id}
                        className={`rounded-xl border p-3 space-y-2 ${
                          isBeingPinned
                            ? 'border-accent-border bg-accent-soft'
                            : 'border-hairline bg-inset'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-ink truncate">{m.title}</div>
                            <div className="text-[11px] font-mono text-ink-muted tabular-nums">
                              {m.memoryDate} · {m.locationName || m.category}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!isOnline}
                            onClick={() => setPinningMemory(isBeingPinned ? null : m)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                              isBeingPinned
                                ? 'border border-hairline-strong bg-surface text-ink'
                                : 'bg-accent text-accent-ink hover:bg-accent-strong disabled:opacity-40'
                            }`}
                          >
                            {isBeingPinned ? 'Cancel' : 'Pin on Map'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Chronological Life Journey Temporal Slider */}
      <TemporalMemorySlider
        memories={inlineFilteredMemories}
        filteredCount={filteredMemories.length}
        range={temporalRange}
        onChange={setTemporalRange}
      />
    </div>
  );
}
