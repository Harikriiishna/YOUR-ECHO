import React, { useMemo, useRef, useState } from 'react';
import {
  Compass,
  Crosshair,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Layers,
  MapPin,
  Mic,
  Minus,
  Plus,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { getCategoryStyle } from '../lib/memoryCategories';
import type { MemoryItem } from '../types/echo';
import { AuthMedia } from './MediaElements';

export type ConstellationLayout = 'galaxy' | 'orbit' | 'mood' | 'web';

interface MemoryConstellationCanvasProps {
  memories: MemoryItem[];
  allMemoriesCount: number;
  onOpenMemory: (memory: MemoryItem) => void;
  onCreateMemory: () => void;
  onPinOnWorldMap: (memory: MemoryItem) => void;
}

interface PositionedNode {
  memory: MemoryItem;
  x: number;
  y: number;
  radius: number;
  color: string;
  haloColor: string;
  clusterLabel: string;
  valence: number;
}

interface ConnectionEdge {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  reason: string;
  kind: 'person' | 'place' | 'tag' | 'chronicle';
}

interface BackdropGuide {
  kind: 'circle' | 'line' | 'label' | 'quadrant';
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  r?: number;
  text?: string;
  subtext?: string;
  color?: string;
}

const IMPACT_PALETTE: Record<string, { hex: string; halo: string; defaultScore: number }> = {
  Uplifting: { hex: '#10B981', halo: 'rgba(16, 185, 129, 0.24)', defaultScore: 76 },
  Calm: { hex: '#0EA5E9', halo: 'rgba(14, 165, 233, 0.24)', defaultScore: 42 },
  Reflective: { hex: '#6366F1', halo: 'rgba(99, 102, 241, 0.24)', defaultScore: 10 },
  Bittersweet: { hex: '#F59E0B', halo: 'rgba(245, 158, 11, 0.24)', defaultScore: -28 },
  Challenging: { hex: '#F43F5E', halo: 'rgba(244, 63, 94, 0.24)', defaultScore: -68 },
};

const MOOD_SCORES: Record<string, number> = {
  joyful: 84,
  grateful: 72,
  inspired: 68,
  hopeful: 56,
  peaceful: 45,
  courageous: 35,
  tender: 16,
  reflective: 8,
  nostalgic: -10,
  bittersweet: -32,
  melancholic: -54,
  anxious: -68,
};

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function getMemoryValence(m: MemoryItem): number {
  if (typeof m.sentimentScore === 'number' && Number.isFinite(m.sentimentScore)) {
    return Math.max(-95, Math.min(95, m.sentimentScore));
  }
  const impactEntry = Object.entries(IMPACT_PALETTE).find(
    ([k]) => k.toLowerCase() === (m.emotionalImpact || '').toLowerCase()
  );
  if (impactEntry) return impactEntry[1].defaultScore;
  const moodScore = MOOD_SCORES[(m.mood || '').toLowerCase()];
  if (typeof moodScore === 'number') return moodScore;
  return 0;
}

function getNodeColor(m: MemoryItem): { hex: string; halo: string } {
  const impactEntry = Object.entries(IMPACT_PALETTE).find(
    ([k]) => k.toLowerCase() === (m.emotionalImpact || '').toLowerCase()
  );
  if (impactEntry) {
    return { hex: impactEntry[1].hex, halo: impactEntry[1].halo };
  }
  const catStyle = getCategoryStyle(m.category);
  return { hex: catStyle.dotHex, halo: `${catStyle.dotHex}3D` };
}

function truncateLabel(text: string, max = 22): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

const CANVAS_W = 1100;
const CANVAS_H = 740;
const CENTER_X = CANVAS_W / 2;
const CENTER_Y = CANVAS_H / 2;

export function MemoryConstellationCanvas({
  memories,
  allMemoriesCount,
  onOpenMemory,
  onCreateMemory,
  onPinOnWorldMap,
}: MemoryConstellationCanvasProps) {
  const [layout, setLayout] = useState<ConstellationLayout>('galaxy');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const sortedMemories = useMemo(
    () =>
      [...memories].sort(
        (a, b) => a.memoryDate.localeCompare(b.memoryDate) || a.createdAt.localeCompare(b.createdAt)
      ),
    [memories]
  );

  const { nodes, edges, guides, hubNodes } = useMemo(() => {
    const computedNodes: PositionedNode[] = [];
    const computedEdges: ConnectionEdge[] = [];
    const computedGuides: BackdropGuide[] = [];
    const computedHubs: Array<{ id: string; label: string; kind: 'person' | 'place'; x: number; y: number; count: number }> = [];

    if (sortedMemories.length === 0) {
      return { nodes: computedNodes, edges: computedEdges, guides: computedGuides, hubNodes: computedHubs };
    }

    if (layout === 'galaxy') {
      const byCategory = new Map<string, MemoryItem[]>();
      for (const m of sortedMemories) {
        const key = (m.category || 'Personal').trim() || 'Personal';
        const list = byCategory.get(key) || [];
        list.push(m);
        byCategory.set(key, list);
      }

      const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
      const numClusters = categories.length;
      const orbitRadius = numClusters <= 1 ? 0 : numClusters <= 3 ? 195 : Math.min(255, 165 + numClusters * 12);

      categories.forEach(([catName, items], idx) => {
        const angle = (idx / Math.max(1, numClusters)) * Math.PI * 2 - Math.PI / 2;
        const cx = numClusters === 1 ? CENTER_X : CENTER_X + Math.cos(angle) * orbitRadius;
        const cy = numClusters === 1 ? CENTER_Y : CENTER_Y + Math.sin(angle) * (orbitRadius * 0.78);
        const catStyle = getCategoryStyle(catName);
        const haloR = Math.max(58, Math.min(138, 42 + Math.sqrt(items.length) * 26));

        computedGuides.push({
          kind: 'circle',
          x: cx,
          y: cy,
          r: haloR,
          color: catStyle.dotHex,
        });
        computedGuides.push({
          kind: 'label',
          x: cx,
          y: cy - haloR - 12,
          text: catName,
          subtext: `${items.length}`,
          color: catStyle.dotHex,
        });

        items.forEach((m, itemIdx) => {
          const localAngle = itemIdx * 2.39996 + hashSeed(m.id) * 0.4;
          const localDist = items.length === 1 ? 0 : Math.min(haloR - 16, 22 + Math.sqrt(itemIdx + 1) * 24);
          const nx = cx + Math.cos(localAngle) * localDist;
          const ny = cy + Math.sin(localAngle) * localDist;
          const { hex, halo } = getNodeColor(m);
          const richness = (m.isFavorite ? 3 : 0) + Math.min(3, m.media.length) + (m.content.length > 220 ? 1 : 0);

          computedNodes.push({
            memory: m,
            x: nx,
            y: ny,
            radius: 7 + richness * 1.15,
            color: hex,
            haloColor: halo,
            clusterLabel: catName,
            valence: getMemoryValence(m),
          });
        });
      });
    } else if (layout === 'orbit') {
      const byYear = new Map<string, MemoryItem[]>();
      for (const m of sortedMemories) {
        const year = m.memoryDate.slice(0, 4) || 'Undated';
        const list = byYear.get(year) || [];
        list.push(m);
        byYear.set(year, list);
      }

      const years = [...byYear.keys()].sort((a, b) => a.localeCompare(b));
      const minR = years.length <= 1 ? 110 : 78;
      const maxR = 305;

      years.forEach((yr, yIdx) => {
        const ringR =
          years.length === 1 ? 160 : minR + (yIdx / Math.max(1, years.length - 1)) * (maxR - minR);
        const items = byYear.get(yr) || [];

        computedGuides.push({
          kind: 'circle',
          x: CENTER_X,
          y: CENTER_Y,
          r: ringR,
          color: 'var(--echo-hairline-strong)',
        });
        computedGuides.push({
          kind: 'label',
          x: CENTER_X,
          y: CENTER_Y - ringR - 9,
          text: yr,
          subtext: `${items.length}`,
        });

        items.forEach((m, iIdx) => {
          const month = Number(m.memoryDate.slice(5, 7)) || ((iIdx % 12) + 1);
          const day = Number(m.memoryDate.slice(8, 10)) || 15;
          const yearFraction = ((month - 1) * 31 + day) / 372;
          const spreadOffset = (iIdx % 5) * 0.045 - 0.09;
          const theta = (yearFraction + spreadOffset) * Math.PI * 2 - Math.PI / 2;
          const nx = CENTER_X + Math.cos(theta) * ringR;
          const ny = CENTER_Y + Math.sin(theta) * ringR;
          const { hex, halo } = getNodeColor(m);
          const richness = (m.isFavorite ? 3 : 0) + Math.min(3, m.media.length);

          computedNodes.push({
            memory: m,
            x: nx,
            y: ny,
            radius: 7.5 + richness * 1.1,
            color: hex,
            haloColor: halo,
            clusterLabel: yr,
            valence: getMemoryValence(m),
          });
        });
      });
    } else if (layout === 'mood') {
      const padX = 110;
      const padY = 85;
      const plotW = CANVAS_W - padX * 2;
      const plotH = CANVAS_H - padY * 2;

      computedGuides.push({ kind: 'line', x: CENTER_X, y: padY - 10, x2: CENTER_X, y2: CANVAS_H - padY + 10 });
      computedGuides.push({ kind: 'line', x: padX - 10, y: CENTER_Y, x2: CANVAS_W - padX + 10, y2: CENTER_Y });
      computedGuides.push({ kind: 'quadrant', x: padX + plotW * 0.25, y: padY + 26, text: 'Deep Resilience', subtext: 'Recent · Challenging' });
      computedGuides.push({ kind: 'quadrant', x: padX + plotW * 0.75, y: padY + 26, text: 'Radiant Peaks', subtext: 'Recent · Uplifting' });
      computedGuides.push({ kind: 'quadrant', x: padX + plotW * 0.25, y: CANVAS_H - padY - 14, text: 'Tender Crossroads', subtext: 'Earlier · Bittersweet' });
      computedGuides.push({ kind: 'quadrant', x: padX + plotW * 0.75, y: CANVAS_H - padY - 14, text: 'Quiet Harbor', subtext: 'Earlier · Grounded' });

      const timestamps = sortedMemories.map((m) => Date.parse(`${m.memoryDate}T12:00:00Z`) || 0);
      const minT = Math.min(...timestamps);
      const maxT = Math.max(...timestamps);
      const spanT = Math.max(86400_000, maxT - minT);

      sortedMemories.forEach((m, idx) => {
        const valence = getMemoryValence(m);
        const jitterX = (hashSeed(`${m.id}-x`) - 0.5) * 46;
        const jitterY = (hashSeed(`${m.id}-y`) - 0.5) * 32;
        const normX = (valence + 100) / 200;
        const t = timestamps[idx];
        const normY = maxT === minT ? 0.5 : (t - minT) / spanT;

        const nx = Math.max(padX, Math.min(CANVAS_W - padX, padX + normX * plotW + jitterX));
        const ny = Math.max(padY + 34, Math.min(CANVAS_H - padY - 24, CANVAS_H - padY - 24 - normY * (plotH - 60) + jitterY));
        const { hex, halo } = getNodeColor(m);
        const richness = (m.isFavorite ? 3 : 0) + Math.min(3, m.media.length);

        computedNodes.push({
          memory: m,
          x: nx,
          y: ny,
          radius: 7.5 + richness * 1.1,
          color: hex,
          haloColor: halo,
          clusterLabel: m.emotionalImpact || m.mood || 'Reflective',
          valence,
        });
      });
    } else {
      // 'web': People & Places relationship web
      const hubCounts = new Map<string, { label: string; kind: 'person' | 'place'; count: number }>();
      for (const m of sortedMemories) {
        for (const p of m.people) {
          const clean = p.trim();
          if (!clean) continue;
          const k = `person:${clean.toLowerCase()}`;
          const prev = hubCounts.get(k);
          hubCounts.set(k, { label: clean, kind: 'person', count: (prev?.count || 0) + 1 });
        }
        if (m.locationName?.trim()) {
          const clean = m.locationName.trim();
          const k = `place:${clean.toLowerCase()}`;
          const prev = hubCounts.get(k);
          hubCounts.set(k, { label: clean, kind: 'place', count: (prev?.count || 0) + 1 });
        }
      }

      const topHubs = [...hubCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 12);

      const hubR = topHubs.length <= 1 ? 0 : 145;
      topHubs.forEach(([hubKey, info], idx) => {
        const angle = (idx / Math.max(1, topHubs.length)) * Math.PI * 2 - Math.PI / 2;
        const hx = topHubs.length === 1 ? CENTER_X : CENTER_X + Math.cos(angle) * hubR;
        const hy = topHubs.length === 1 ? CENTER_Y : CENTER_Y + Math.sin(angle) * (hubR * 0.8);
        computedHubs.push({
          id: hubKey,
          label: info.label,
          kind: info.kind,
          x: hx,
          y: hy,
          count: info.count,
        });
      });

      const hubById = new Map(computedHubs.map((h) => [h.id, h]));

      sortedMemories.forEach((m, idx) => {
        const matchedHubs: typeof computedHubs = [];
        for (const p of m.people) {
          const h = hubById.get(`person:${p.trim().toLowerCase()}`);
          if (h) matchedHubs.push(h);
        }
        if (m.locationName?.trim()) {
          const h = hubById.get(`place:${m.locationName.trim().toLowerCase()}`);
          if (h) matchedHubs.push(h);
        }

        let nx = CENTER_X;
        let ny = CENTER_Y;
        if (matchedHubs.length > 0) {
          const avgX = matchedHubs.reduce((s, h) => s + h.x, 0) / matchedHubs.length;
          const avgY = matchedHubs.reduce((s, h) => s + h.y, 0) / matchedHubs.length;
          const outAngle = Math.atan2(avgY - CENTER_Y, avgX - CENTER_X) + (hashSeed(m.id) - 0.5) * 0.9;
          const outDist = 85 + (idx % 4) * 24 + hashSeed(`${m.id}-d`) * 32;
          nx = Math.max(90, Math.min(CANVAS_W - 90, avgX + Math.cos(outAngle) * outDist));
          ny = Math.max(70, Math.min(CANVAS_H - 70, avgY + Math.sin(outAngle) * outDist));
        } else {
          const outerAngle = (idx / Math.max(1, sortedMemories.length)) * Math.PI * 2;
          nx = CENTER_X + Math.cos(outerAngle) * 290;
          ny = CENTER_Y + Math.sin(outerAngle) * 225;
        }

        const { hex, halo } = getNodeColor(m);
        const richness = (m.isFavorite ? 3 : 0) + Math.min(3, m.media.length);
        computedNodes.push({
          memory: m,
          x: nx,
          y: ny,
          radius: 7.5 + richness * 1.1,
          color: hex,
          haloColor: halo,
          clusterLabel: matchedHubs[0]?.label || m.category,
          valence: getMemoryValence(m),
        });

        for (const hub of matchedHubs) {
          computedEdges.push({
            fromId: m.id,
            toId: hub.id,
            x1: nx,
            y1: ny,
            x2: hub.x,
            y2: hub.y,
            reason: hub.label,
            kind: hub.kind,
          });
        }
      });
    }

    // Add memory-to-memory constellation edges for Galaxy, Orbit & Mood
    if (layout !== 'web') {
      const nodeById = new Map(computedNodes.map((n) => [n.memory.id, n]));
      if (layout === 'orbit') {
        for (let i = 0; i < computedNodes.length - 1; i += 1) {
          const a = computedNodes[i];
          const b = computedNodes[i + 1];
          computedEdges.push({
            fromId: a.memory.id,
            toId: b.memory.id,
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            reason: 'Timeline path',
            kind: 'chronicle',
          });
        }
      } else {
        const seenPairs = new Set<string>();
        for (let i = 0; i < computedNodes.length && computedEdges.length < 160; i += 1) {
          const a = computedNodes[i];
          const aPeople = new Set(a.memory.people.map((p) => p.trim().toLowerCase()).filter(Boolean));
          const aTags = new Set(a.memory.tags.map((t) => t.trim().toLowerCase()).filter(Boolean));
          const aPlace = a.memory.locationName.trim().toLowerCase();

          for (let j = i + 1; j < computedNodes.length && computedEdges.length < 160; j += 1) {
            const b = computedNodes[j];
            const pairKey = `${a.memory.id}:${b.memory.id}`;
            if (seenPairs.has(pairKey)) continue;

            const sharedPerson = b.memory.people.find((p) => aPeople.has(p.trim().toLowerCase()));
            const sharedPlace = aPlace && b.memory.locationName.trim().toLowerCase() === aPlace ? a.memory.locationName.trim() : null;
            const sharedTag = !sharedPerson && !sharedPlace ? b.memory.tags.find((t) => aTags.has(t.trim().toLowerCase())) : null;

            if (sharedPerson || sharedPlace || sharedTag) {
              seenPairs.add(pairKey);
              const nA = nodeById.get(a.memory.id)!;
              const nB = nodeById.get(b.memory.id)!;
              computedEdges.push({
                fromId: a.memory.id,
                toId: b.memory.id,
                x1: nA.x,
                y1: nA.y,
                x2: nB.x,
                y2: nB.y,
                reason: sharedPerson ? sharedPerson : sharedPlace ? sharedPlace : `#${sharedTag}`,
                kind: sharedPerson ? 'person' : sharedPlace ? 'place' : 'tag',
              });
            }
          }
        }
      }
    }

    return {
      nodes: computedNodes,
      edges: computedEdges,
      guides: computedGuides,
      hubNodes: computedHubs,
    };
  }, [sortedMemories, layout]);

  const activeFocusId = hoveredId || selectedId;
  const selectedNode = useMemo(
    () => nodes.find((n) => n.memory.id === selectedId) || null,
    [nodes, selectedId]
  );
  const hoveredNode = useMemo(
    () => (hoveredId ? nodes.find((n) => n.memory.id === hoveredId) || null : null),
    [nodes, hoveredId]
  );

  const connectedIdSet = useMemo(() => {
    const set = new Set<string>();
    if (!activeFocusId) return set;
    set.add(activeFocusId);
    for (const edge of edges) {
      if (edge.fromId === activeFocusId) set.add(edge.toId);
      if (edge.toId === activeFocusId) set.add(edge.fromId);
    }
    return set;
  }, [activeFocusId, edges]);

  const relatedConnections = useMemo(() => {
    if (!selectedNode) return [];
    const seen = new Set<string>();
    const results: Array<{ memory: MemoryItem; reason: string }> = [];
    for (const edge of edges) {
      const otherId =
        edge.fromId === selectedNode.memory.id
          ? edge.toId
          : edge.toId === selectedNode.memory.id
          ? edge.fromId
          : null;
      if (!otherId || seen.has(otherId)) continue;
      const other = nodes.find((n) => n.memory.id === otherId);
      if (other) {
        seen.add(otherId);
        results.push({ memory: other.memory, reason: edge.reason });
      }
    }
    return results.slice(0, 6);
  }, [selectedNode, edges, nodes]);

  const resetCamera = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const focusNode = (node: PositionedNode) => {
    setSelectedId(node.memory.id);
    const nextZoom = Math.max(zoom, 1.35);
    setZoom(nextZoom);
    setPan({
      x: (CENTER_X - node.x) * nextZoom * 0.55,
      y: (CENTER_Y - node.y) * nextZoom * 0.55,
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, [data-node="true"]')) return;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragStartRef.current.moved = true;
    }
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    setZoom((z) => Math.max(0.6, Math.min(2.8, Number((z * factor).toFixed(2)))));
  };

  const firstImage = selectedNode?.memory.media.find((med) =>
    (med.mimeType || med.mime_type || '').startsWith('image/')
  );
  const hasAudio = selectedNode?.memory.media.some((med) =>
    (med.mimeType || med.mime_type || '').startsWith('audio/')
  );

  return (
    <div className="space-y-4">
      {/* Constellation Layout Type Switcher + Camera Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div
          className="flex items-center gap-1 p-1 rounded-xl border border-hairline bg-inset overflow-x-auto no-scrollbar"
          role="group"
          aria-label="Constellation layout"
        >
          {(
            [
              { id: 'galaxy', label: 'Galaxy Clusters' },
              { id: 'orbit', label: 'Chronicle Orbit' },
              { id: 'mood', label: 'Mood Landscape' },
              { id: 'web', label: 'People & Places Web' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setLayout(item.id);
                resetCamera();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                layout === item.id
                  ? 'bg-accent text-accent-ink font-semibold'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
            aria-label="Zoom out"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-hairline-strong bg-inset text-ink-secondary hover:text-ink"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[11px] text-ink-muted tabular-nums w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.8, Number((z + 0.2).toFixed(2))))}
            aria-label="Zoom in"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-hairline-strong bg-inset text-ink-secondary hover:text-ink"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={resetCamera}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink whitespace-nowrap shrink-0"
          >
            <Compass className="w-3.5 h-3.5 text-accent-text" />
            Fit View
          </button>
        </div>
      </div>

      {/* Main Split: Spatial Constellation Canvas + Editorial Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-8 flex flex-col gap-2 min-w-0">
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
            className={`relative rounded-xl border border-hairline bg-inset overflow-hidden h-[430px] sm:h-[520px] select-none ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{
              backgroundImage:
                'radial-gradient(circle at 22% 20%, var(--echo-accent-soft), transparent 55%), radial-gradient(circle at 78% 78%, rgba(56, 189, 248, 0.08), transparent 55%)',
            }}
          >
            {memories.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <Sparkles className="w-6 h-6 text-accent-text" />
                <div className="space-y-1 max-w-sm">
                  <p className="font-display text-base font-semibold text-ink">
                    {allMemoriesCount > 0
                      ? 'No memories match the active filter'
                      : 'Your Memory Map is ready for its first star'}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {allMemoriesCount > 0
                      ? 'Clear or adjust your filters to see every memory mapped across clusters, time, and emotion.'
                      : 'Every memory you capture automatically appears here across categories, years, moods, and relationships.'}
                  </p>
                </div>
                {allMemoriesCount === 0 && (
                  <button
                    type="button"
                    onClick={onCreateMemory}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                  >
                    <Plus className="w-3.5 h-3.5" /> Capture First Memory
                  </button>
                )}
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                className="w-full h-full touch-none"
                role="img"
                aria-label="Interactive memory constellation map"
              >
                <defs>
                  <pattern id="echo-constellation-grid" width="44" height="44" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="0.85" fill="currentColor" opacity="0.16" />
                  </pattern>
                </defs>

                <rect width={CANVAS_W} height={CANVAS_H} fill="url(#echo-constellation-grid)" className="text-ink-muted" />

                <g
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: '50% 50%',
                    transition: isDragging ? 'none' : 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {/* Backdrop Guides (Clusters / Orbit Rings / Mood Quadrants) */}
                  {guides.map((g, i) => {
                    if (g.kind === 'circle' && g.x !== undefined && g.y !== undefined && g.r !== undefined) {
                      return (
                        <circle
                          key={`guide-c-${i}`}
                          cx={g.x}
                          cy={g.y}
                          r={g.r}
                          fill={layout === 'galaxy' ? `${g.color || '#6366F1'}0F` : 'none'}
                          stroke={g.color || 'currentColor'}
                          strokeOpacity={layout === 'galaxy' ? 0.25 : 0.28}
                          strokeWidth={1}
                          strokeDasharray={layout === 'orbit' ? '4 5' : '3 4'}
                        />
                      );
                    }
                    if (g.kind === 'line' && g.x !== undefined && g.y !== undefined && g.x2 !== undefined && g.y2 !== undefined) {
                      return (
                        <line
                          key={`guide-l-${i}`}
                          x1={g.x}
                          y1={g.y}
                          x2={g.x2}
                          y2={g.y2}
                          stroke="currentColor"
                          strokeOpacity={0.18}
                          strokeDasharray="4 4"
                          className="text-ink-muted"
                        />
                      );
                    }
                    if (g.kind === 'label' && g.x !== undefined && g.y !== undefined) {
                      return (
                        <text
                          key={`guide-t-${i}`}
                          x={g.x}
                          y={g.y}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="600"
                          fill="currentColor"
                          className="text-ink-secondary font-display"
                        >
                          {g.text} · {g.subtext}
                        </text>
                      );
                    }
                    if (g.kind === 'quadrant' && g.x !== undefined && g.y !== undefined) {
                      return (
                        <g key={`guide-q-${i}`}>
                          <text
                            x={g.x}
                            y={g.y}
                            textAnchor="middle"
                            fontSize="13"
                            fontWeight="600"
                            fill="currentColor"
                            opacity="0.72"
                            className="text-ink font-display"
                          >
                            {g.text}
                          </text>
                          <text
                            x={g.x}
                            y={g.y + 14}
                            textAnchor="middle"
                            fontSize="10"
                            fill="currentColor"
                            opacity="0.55"
                            className="text-ink-muted font-mono"
                          >
                            {g.subtext}
                          </text>
                        </g>
                      );
                    }
                    return null;
                  })}

                  {/* Connection Strands */}
                  {edges.map((edge, idx) => {
                    const highlighted =
                      activeFocusId && (edge.fromId === activeFocusId || edge.toId === activeFocusId);
                    const dimmed = Boolean(activeFocusId && !highlighted);
                    const midX = (edge.x1 + edge.x2) / 2;
                    const midY = (edge.y1 + edge.y2) / 2 - (edge.kind === 'chronicle' ? 12 : 18);
                    return (
                      <path
                        key={`edge-${edge.fromId}-${edge.toId}-${idx}`}
                        d={`M ${edge.x1} ${edge.y1} Q ${midX} ${midY} ${edge.x2} ${edge.y2}`}
                        fill="none"
                        stroke={highlighted ? 'var(--echo-accent)' : 'currentColor'}
                        strokeOpacity={highlighted ? 0.85 : dimmed ? 0.06 : edge.kind === 'chronicle' ? 0.28 : 0.22}
                        strokeWidth={highlighted ? 2 : 1.1}
                        strokeDasharray={edge.kind === 'chronicle' ? '5 4' : undefined}
                        className={highlighted ? '' : 'text-ink-muted'}
                      />
                    );
                  })}

                  {/* People & Places Hubs (in 'web' layout) */}
                  {hubNodes.map((hub) => {
                    const highlighted = activeFocusId && connectedIdSet.has(hub.id);
                    return (
                      <g key={hub.id}>
                        <circle
                          cx={hub.x}
                          cy={hub.y}
                          r={16 + Math.min(8, hub.count * 2)}
                          fill="var(--echo-surface)"
                          stroke={hub.kind === 'person' ? '#0EA5E9' : '#10B981'}
                          strokeWidth={highlighted ? 2.5 : 1.5}
                          strokeOpacity={0.85}
                        />
                        <text
                          x={hub.x}
                          y={hub.y + 3.5}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="700"
                          fill="currentColor"
                          className="text-ink font-display pointer-events-none"
                        >
                          {truncateLabel(hub.label, 14)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Memory Nodes */}
                  {nodes.map((node) => {
                    const isSelected = node.memory.id === selectedId;
                    const isHovered = node.memory.id === hoveredId;
                    const isConnected = activeFocusId ? connectedIdSet.has(node.memory.id) : false;
                    const isDimmed = Boolean(activeFocusId && !isConnected);
                    const showTextLabel =
                      nodes.length <= 28 || isSelected || isHovered || isConnected || node.memory.isFavorite || zoom >= 1.3;

                    return (
                      <g
                        key={node.memory.id}
                        data-node="true"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          focusNode(node);
                        }}
                        onMouseEnter={() => setHoveredId(node.memory.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        style={{
                          cursor: 'pointer',
                          opacity: isDimmed ? 0.3 : 1,
                          transition: 'opacity 160ms ease',
                        }}
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius + (isSelected || isHovered ? 9 : 5)}
                          fill={node.haloColor}
                        />
                        {node.memory.isFavorite && (
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={node.radius + 3.5}
                            fill="none"
                            stroke="#F43F5E"
                            strokeWidth={1.25}
                            strokeDasharray="2 2"
                          />
                        )}
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={isSelected || isHovered ? node.radius + 2 : node.radius}
                          fill={node.color}
                          stroke="var(--echo-surface)"
                          strokeWidth={isSelected ? 2.5 : 1.75}
                        />
                        {node.memory.media.length > 0 && (
                          <circle
                            cx={node.x + node.radius * 0.7}
                            cy={node.y - node.radius * 0.7}
                            r={3}
                            fill="var(--echo-surface)"
                            stroke={node.color}
                            strokeWidth={1.2}
                          />
                        )}
                        {showTextLabel && (
                          <text
                            x={node.x}
                            y={node.y + node.radius + 14}
                            textAnchor="middle"
                            fontSize={isSelected || isHovered ? '11.5' : '10.5'}
                            fontWeight={isSelected || isHovered ? '700' : '500'}
                            fill="currentColor"
                            className="text-ink font-display pointer-events-none"
                          >
                            {truncateLabel(node.memory.title, 22)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}

            {/* Subtle Hover Caption Overlay (no card clutter) */}
            {hoveredNode && (
              <div className="pointer-events-none absolute left-3 bottom-3 max-w-xs rounded-xl border border-hairline-strong bg-surface/95 px-3 py-2 shadow-sm">
                <div className="text-[11px] font-mono text-ink-muted tabular-nums">
                  {hoveredNode.memory.memoryDate} · {hoveredNode.memory.category}
                  {hoveredNode.memory.locationName ? ` · ${hoveredNode.memory.locationName}` : ''}
                </div>
                <div className="font-display text-xs font-semibold text-ink truncate">
                  {hoveredNode.memory.title}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted px-0.5">
            <span>
              Drag canvas to pan · Scroll to zoom · Click any star to inspect story and connections
            </span>
            <span className="font-mono tabular-nums">
              {nodes.length} of {allMemoriesCount} memories mapped
            </span>
          </div>
        </div>

        {/* Right Column: Selected Memory Inspector OR All-Memory Directory */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-w-0">
          {selectedNode ? (
            <div className="rounded-xl border border-accent-border bg-inset p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-mono text-ink-muted tabular-nums">
                  {selectedNode.memory.memoryDate} · {selectedNode.memory.category}
                  {selectedNode.memory.emotionalImpact ? ` · ${selectedNode.memory.emotionalImpact}` : ''}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close selected memory preview"
                  className="text-ink-muted hover:text-ink p-0.5 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-bold text-ink leading-snug">
                  {selectedNode.memory.title}
                </h3>
                {selectedNode.memory.isFavorite && (
                  <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400 shrink-0 mt-1" />
                )}
              </div>

              {firstImage && (
                <div className="rounded-lg overflow-hidden border border-hairline h-36 bg-surface">
                  <AuthMedia
                    mediaId={firstImage.id}
                    alt={selectedNode.memory.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <p className="text-xs text-ink-secondary line-clamp-4 leading-relaxed">
                {selectedNode.memory.content}
              </p>

              <div className="text-[11px] text-ink-muted space-y-1">
                {selectedNode.memory.locationName && (
                  <div className="inline-flex items-center gap-1.5 mr-3">
                    <MapPin className="w-3 h-3 text-accent-text shrink-0" />
                    <span>{selectedNode.memory.locationName}</span>
                  </div>
                )}
                {selectedNode.memory.people.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 mr-3">
                    <Users className="w-3 h-3 text-sky-500 shrink-0" />
                    <span>{selectedNode.memory.people.join(', ')}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 font-mono text-[10px]">
                  {selectedNode.memory.media.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> {selectedNode.memory.media.length} media
                    </span>
                  )}
                  {hasAudio && (
                    <span className="inline-flex items-center gap-1">
                      <Mic className="w-3 h-3" /> Voice
                    </span>
                  )}
                  {selectedNode.memory.tags.length > 0 && (
                    <span className="text-sky-700 dark:text-sky-300 truncate">
                      {selectedNode.memory.tags.map((t) => `#${t}`).join(' · ')}
                    </span>
                  )}
                </div>
              </div>

              {relatedConnections.length > 0 && (
                <div className="border-t border-hairline pt-2.5 space-y-1.5">
                  <div className="text-[11px] font-medium text-ink-muted">Connected Memories</div>
                  <div className="space-y-1">
                    {relatedConnections.map((rel) => (
                      <button
                        key={rel.memory.id}
                        type="button"
                        onClick={() => {
                          const targetNode = nodes.find((n) => n.memory.id === rel.memory.id);
                          if (targetNode) focusNode(targetNode);
                        }}
                        className="w-full text-left flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-lg hover:bg-surface transition-colors"
                      >
                        <span className="text-ink truncate">{rel.memory.title}</span>
                        <span className="text-[10px] font-mono text-ink-muted shrink-0">{rel.reason}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenMemory(selectedNode.memory)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Full Memory
                </button>
                <button
                  type="button"
                  onClick={() => onPinOnWorldMap(selectedNode.memory)}
                  className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-surface px-2.5 py-2 text-xs font-medium text-ink-secondary hover:text-ink whitespace-nowrap"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  Pin Place
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-hairline bg-inset p-4 space-y-1.5">
              <div className="text-xs font-semibold text-ink inline-flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-accent-text" />
                {layout === 'galaxy' && 'Galaxy by Category & Shared Links'}
                {layout === 'orbit' && 'Concentric Years & Life Trajectory'}
                {layout === 'mood' && 'Emotional Valence & Time Horizon'}
                {layout === 'web' && 'People & Places Constellation'}
              </div>
              <p className="text-xs text-ink-muted leading-relaxed">
                Select any star on the map or pick a memory below to inspect photos, stories, and connected memories.
              </p>
            </div>
          )}

          {/* Directory of All Mapped Memories */}
          <div className="flex-1 max-h-[300px] lg:max-h-[340px] overflow-y-auto space-y-1.5 pr-0.5">
            {nodes.map((node) => {
              const active = node.memory.id === selectedId;
              return (
                <button
                  key={node.memory.id}
                  type="button"
                  onClick={() => focusNode(node)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors space-y-1 ${
                    active
                      ? 'border-accent-border bg-surface-raised'
                      : 'border-hairline bg-inset hover:border-hairline-strong'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink truncate inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: node.color }}
                        aria-hidden="true"
                      />
                      {node.memory.title}
                    </span>
                    <span className="text-[10px] font-mono text-ink-muted tabular-nums shrink-0">
                      {node.memory.memoryDate}
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-muted truncate">
                    {node.memory.category}
                    {node.memory.locationName ? ` · ${node.memory.locationName}` : ''}
                    {node.memory.emotionalImpact ? ` · ${node.memory.emotionalImpact}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
