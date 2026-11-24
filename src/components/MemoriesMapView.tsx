import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Compass,
  Crosshair,
  ExternalLink,
  Heart,
  Layers,
  Loader2,
  MapPin,
  Navigation,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import { ECHO_THEMES, getSavedThemeId } from '../lib/themes';
import type { MemoryItem } from '../types/echo';

interface MemoriesMapViewProps {
  memories: MemoryItem[];
  onOpenMemory: (memory: MemoryItem) => void;
  onCreateMemory: () => void;
  onMemoryUpdated: (memory: MemoryItem) => void;
}

type BasemapMode = 'auto' | 'light' | 'dark' | 'street';

interface PlottedMemory {
  memory: MemoryItem;
  lat: number;
  lng: number;
  displayLat: number;
  displayLng: number;
  coordSource: 'exact' | 'estimated';
}

const CITY_GAZETTEER: Array<{ keys: string[]; lat: number; lng: number }> = [
  { keys: ['san francisco', 'sf, ca'], lat: 37.7749, lng: -122.4194 },
  { keys: ['new york', 'nyc', 'manhattan', 'brooklyn'], lat: 40.7128, lng: -74.006 },
  { keys: ['los angeles', 'la, ca', 'hollywood'], lat: 34.0522, lng: -118.2437 },
  { keys: ['seattle'], lat: 47.6062, lng: -122.3321 },
  { keys: ['chicago'], lat: 41.8781, lng: -87.6298 },
  { keys: ['austin'], lat: 30.2672, lng: -97.7431 },
  { keys: ['boston'], lat: 42.3601, lng: -71.0589 },
  { keys: ['miami'], lat: 25.7617, lng: -80.1918 },
  { keys: ['toronto'], lat: 43.6532, lng: -79.3832 },
  { keys: ['vancouver'], lat: 49.2827, lng: -123.1207 },
  { keys: ['mexico city', 'cdmx'], lat: 19.4326, lng: -99.1332 },
  { keys: ['rio de janeiro'], lat: -22.9068, lng: -43.1729 },
  { keys: ['sao paulo', 'são paulo'], lat: -23.5505, lng: -46.6333 },
  { keys: ['buenos aires'], lat: -34.6037, lng: -58.3816 },
  { keys: ['london'], lat: 51.5072, lng: -0.1276 },
  { keys: ['paris'], lat: 48.8566, lng: 2.3522 },
  { keys: ['berlin'], lat: 52.52, lng: 13.405 },
  { keys: ['amsterdam'], lat: 52.3676, lng: 4.9041 },
  { keys: ['barcelona'], lat: 41.3874, lng: 2.1686 },
  { keys: ['madrid'], lat: 40.4168, lng: -3.7038 },
  { keys: ['rome', 'roma'], lat: 41.9028, lng: 12.4964 },
  { keys: ['lisbon', 'lisboa'], lat: 38.7223, lng: -9.1393 },
  { keys: ['zurich', 'zürich'], lat: 47.3769, lng: 8.5417 },
  { keys: ['vienna', 'wien'], lat: 48.2082, lng: 16.3738 },
  { keys: ['prague'], lat: 50.0755, lng: 14.4378 },
  { keys: ['athens'], lat: 37.9838, lng: 23.7275 },
  { keys: ['istanbul'], lat: 41.0082, lng: 28.9784 },
  { keys: ['reykjavik'], lat: 64.1466, lng: -21.9426 },
  { keys: ['dublin'], lat: 53.3498, lng: -6.2603 },
  { keys: ['edinburgh'], lat: 55.9533, lng: -3.1883 },
  { keys: ['cairo'], lat: 30.0444, lng: 31.2357 },
  { keys: ['cape town'], lat: -33.9249, lng: 18.4241 },
  { keys: ['nairobi'], lat: -1.2921, lng: 36.8219 },
  { keys: ['dubai'], lat: 25.2048, lng: 55.2708 },
  { keys: ['mumbai', 'bombay'], lat: 19.076, lng: 72.8777 },
  { keys: ['bengaluru', 'bangalore'], lat: 12.9716, lng: 77.5946 },
  { keys: ['hyderabad'], lat: 17.385, lng: 78.4867 },
  { keys: ['delhi', 'new delhi'], lat: 28.6139, lng: 77.209 },
  { keys: ['chennai'], lat: 13.0827, lng: 80.2707 },
  { keys: ['kolkata'], lat: 22.5726, lng: 88.3639 },
  { keys: ['goa'], lat: 15.2993, lng: 74.124 },
  { keys: ['singapore'], lat: 1.3521, lng: 103.8198 },
  { keys: ['bangkok'], lat: 13.7563, lng: 100.5018 },
  { keys: ['bali', 'ubud', 'denpasar'], lat: -8.4095, lng: 115.1889 },
  { keys: ['tokyo'], lat: 35.6762, lng: 139.6503 },
  { keys: ['kyoto'], lat: 35.0116, lng: 135.7681 },
  { keys: ['osaka'], lat: 34.6937, lng: 135.5023 },
  { keys: ['seoul'], lat: 37.5665, lng: 126.978 },
  { keys: ['taipei'], lat: 25.033, lng: 121.5654 },
  { keys: ['hong kong'], lat: 22.3193, lng: 114.1694 },
  { keys: ['sydney'], lat: -33.8688, lng: 151.2093 },
  { keys: ['melbourne'], lat: -37.8136, lng: 144.9631 },
  { keys: ['auckland'], lat: -36.8509, lng: 174.7645 },
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
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: 'abc',
    maxZoom: 19,
  },
};

export function MemoriesMapView({
  memories,
  onOpenMemory,
  onCreateMemory,
  onMemoryUpdated,
}: MemoriesMapViewProps) {
  const { user, isOnline } = useEcho();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markerInstancesRef = useRef<Map<string, L.Marker>>(new Map());
  const pinningMemoryRef = useRef<MemoryItem | null>(null);

  const [basemap, setBasemap] = useState<BasemapMode>('auto');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listTab, setListTab] = useState<'located' | 'unlocated'>('located');
  const [pinningMemory, setPinningMemory] = useState<MemoryItem | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [tileNotice, setTileNotice] = useState(false);

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

    for (const m of memories) {
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

    // Apply tiny deterministic spiral offset when multiple pins share the exact same spot
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
      const angle = indexAtSpot * 2.39996; // golden angle
      const radius = 0.0012 * Math.sqrt(indexAtSpot);
      return {
        ...entry,
        displayLat: Math.max(-85, Math.min(85, entry.lat + radius * Math.sin(angle))),
        displayLng: Math.max(-180, Math.min(180, entry.lng + radius * Math.cos(angle))),
      };
    });

    return { plottedMemories: plotted, unlocatedMemories: unlocated };
  }, [memories]);

  const selectedPlotted = useMemo(
    () => plottedMemories.find((p) => p.memory.id === selectedId) || null,
    [plottedMemories, selectedId]
  );

  // Keep pinningMemoryRef synchronized for Leaflet map click handler
  useEffect(() => {
    pinningMemoryRef.current = pinningMemory;
  }, [pinningMemory]);

  // Clear selection if filtered out
  useEffect(() => {
    if (selectedId && !plottedMemories.some((p) => p.memory.id === selectedId)) {
      setSelectedId(null);
    }
  }, [plottedMemories, selectedId]);

  // Auto-switch list tab if there are no plotted entries yet
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
      onMemoryUpdated(res.memory);
      setPinningMemory(null);
      setSelectedId(res.memory.id);
      setListTab('located');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Unable to save coordinates.');
    } finally {
      setSavingPin(false);
    }
  };

  // Initialize Leaflet map once
  useEffect(() => {
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

    const markersLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    markersLayerRef.current = markersLayer;

    map.on('click', (e: L.LeafletMouseEvent) => {
      const targetMemory = pinningMemoryRef.current;
      if (!targetMemory) return;
      void saveCoordinatesForMemory(targetMemory, e.latlng.lat, e.latlng.lng);
    });

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      markerInstancesRef.current.clear();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  // Swap tile layer when basemap or theme changes
  useEffect(() => {
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
  }, [resolvedTileMode]);

  // Update cursor when pinning mode is active
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    container.style.cursor = pinningMemory ? 'crosshair' : '';
  }, [pinningMemory]);

  // Render Leaflet markers whenever plotted memories or selection change
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    markerInstancesRef.current.clear();

    for (const item of plottedMemories) {
      const { memory, displayLat, displayLng, coordSource } = item;
      const palette = getMarkerPalette(memory.emotionalImpact);
      const isSelected = memory.id === selectedId;
      const size = isSelected ? 22 : memory.isFavorite ? 17 : 14;
      const borderStyle = coordSource === 'estimated' ? 'dashed' : 'solid';

      const icon = L.divIcon({
        className: 'echo-leaflet-pin',
        iconSize: [size + 12, size + 12],
        iconAnchor: [(size + 12) / 2, (size + 12) / 2],
        popupAnchor: [0, -(size / 2 + 6)],
        html: `
          <div style="
            width:${size + 12}px;
            height:${size + 12}px;
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
              box-shadow:0 0 0 ${isSelected ? '6px' : '4px'} ${palette.ring}, 0 2px 8px rgba(0,0,0,0.35);
              display:block;
              transition:transform 160ms ease;
            "></span>
          </div>
        `,
      });

      const marker = L.marker([displayLat, displayLng], {
        icon,
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
        setListTab('located');
      });

      marker.addTo(layer);
      markerInstancesRef.current.set(memory.id, marker);
    }
  }, [plottedMemories, selectedId, onOpenMemory]);

  // Fit bounds when plotted set changes (unless user is mid-selection)
  const fitAllMarkers = () => {
    const map = mapRef.current;
    if (!map) return;
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

  useEffect(() => {
    fitAllMarkers();
  }, [plottedMemories.length]);

  const focusMemoryOnMap = (item: PlottedMemory) => {
    setSelectedId(item.memory.id);
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([item.displayLat, item.displayLng], Math.max(map.getZoom(), 8), {
      duration: 0.65,
    });
    const marker = markerInstancesRef.current.get(item.memory.id);
    if (marker) {
      marker.openPopup();
    }
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

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6 space-y-4">
      {/* Header & Map Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
            <MapPin className="w-4 h-4 text-accent-text" />
            Memory Map
          </h2>
          <p className="text-xs text-ink-muted">
            <span className="font-mono tabular-nums">{plottedMemories.length}</span> located on map
            {unlocatedMemories.length > 0 && (
              <>
                {' '}
                <span aria-hidden="true">·</span>{' '}
                <span className="font-mono tabular-nums">{unlocatedMemories.length}</span> without coordinates
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            onClick={fitAllMarkers}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink hover:bg-tint-hover whitespace-nowrap shrink-0 min-h-[34px]"
          >
            <Compass className="w-3.5 h-3.5 text-accent-text" />
            Fit Pins
          </button>
        </div>
      </div>

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
          Map tiles could not load from the tile server (offline or restricted network). Your plotted pins and metadata remain interactive.
        </div>
      )}

      {/* Main Split Viewport: Leaflet Canvas + Metadata Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-8 flex flex-col gap-2.5 min-w-0">
          <div className="relative rounded-xl border border-hairline bg-inset overflow-hidden">
            <div
              ref={mapContainerRef}
              className="w-full h-[360px] sm:h-[460px] z-0"
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
              Dashed border = matched from place name
            </span>
          </div>
        </div>

        {/* Right Sidebar: Selected Preview & Place Directory */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-w-0">
          {/* Selected Memory Card */}
          {selectedPlotted && (
            <div className="rounded-xl border border-accent-border bg-inset p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-mono text-ink-muted tabular-nums">
                  {selectedPlotted.memory.memoryDate} · {selectedPlotted.memory.category}
                  {selectedPlotted.memory.emotionalImpact
                    ? ` · ${selectedPlotted.memory.emotionalImpact}`
                    : ''}
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

          {/* Directory Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl border border-hairline bg-inset">
            <button
              type="button"
              onClick={() => setListTab('located')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
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
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                listTab === 'unlocated'
                  ? 'bg-surface text-ink font-semibold shadow-xs'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Unpinned ({unlocatedMemories.length})
            </button>
          </div>

          {/* Scrollable Memory Directory */}
          <div className="flex-1 max-h-[340px] lg:max-h-[380px] overflow-y-auto space-y-2 pr-0.5">
            {listTab === 'located' ? (
              plottedMemories.length === 0 ? (
                <div className="rounded-xl border border-hairline bg-inset p-5 text-center space-y-2.5">
                  <p className="text-xs font-medium text-ink">No located memories yet</p>
                  <p className="text-xs text-ink-muted">
                    Add a city name or GPS coordinates to any memory, or pick an unpinned entry to place it on the map.
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
                      <div className="text-[11px] text-ink-muted truncate">
                        {item.memory.locationName || 'Pinned coordinates'}
                        {item.coordSource === 'estimated' ? ' · Approx.' : ''}
                      </div>
                    </button>
                  );
                })
              )
            ) : unlocatedMemories.length === 0 ? (
              <div className="rounded-xl border border-hairline bg-inset p-5 text-center space-y-2">
                <p className="text-xs font-medium text-ink">All visible memories are mapped</p>
                <p className="text-xs text-ink-muted">
                  Every memory in your current filter already has a location on the map.
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
    </div>
  );
}
