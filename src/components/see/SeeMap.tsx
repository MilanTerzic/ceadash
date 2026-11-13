import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, Scan } from "lucide-react";

import { IconButton } from "@/components/cea/primitives";
import { useLang } from "@/lib/i18n";
import { SEE_BORDERS, SEE_MARKETS, type SeeCode } from "@/lib/see/registry";
import geo from "@/lib/see/see-map.generated.json";
import { cn } from "@/lib/utils";

export interface MapNode {
  /** Headline value under the market code, already formatted. */
  value: string;
  fill?: string;
  ink?: string;
  /** Market has no value on this layer. */
  empty?: boolean;
}

export interface MapLink {
  /** Stroke width in map units, 1 to 10. */
  width: number;
  color: string;
  /** 1: a -> b, -1: b -> a, 0: no direction. */
  direction: 1 | -1 | 0;
  label?: string;
  dashed?: boolean;
  animated?: boolean;
  /** No value on this layer: drawn as a faint connection only. */
  empty?: boolean;
}

const ANCHORS = geo.anchors as Record<string, { x: number; y: number }>;
const CORE_COUNTRIES = new Set(
  Object.values(SEE_MARKETS)
    .filter((market) => market.tier === "core")
    .map((market) => market.country),
);
const NODE_W = 46;
const NODE_H = 30;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

interface View {
  k: number;
  x: number;
  y: number;
}
const HOME: View = { k: 1, x: 0, y: 0 };

function clampView(view: View): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k));
  const w = geo.width / k;
  const h = geo.height / k;
  return {
    k,
    x: Math.min(geo.width - w, Math.max(0, view.x)),
    y: Math.min(geo.height - h, Math.max(0, view.y)),
  };
}

/** Segment between two node anchors, trimmed so it starts and ends at the node edges. */
function segment(a: { x: number; y: number }, b: { x: number; y: number }, scale: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // Distance from a node centre to its rectangular edge along this direction.
  const edge = Math.min(
    Math.abs(ux) > 1e-6 ? (NODE_W * scale) / 2 / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-6 ? (NODE_H * scale) / 2 / Math.abs(uy) : Infinity,
  );
  const trim = Math.max(0, Math.min(edge + 3 * scale, length / 2 - 4 * scale));
  return {
    x1: a.x + ux * trim,
    y1: a.y + uy * trim,
    x2: b.x - ux * trim,
    y2: b.y - uy * trim,
    ux,
    uy,
    length: length - trim * 2,
  };
}

/**
 * Geographic map of the SEE power system. It draws what it is given: the workspace
 * decides what a node value, link width and colour mean for the active layer.
 */
export function SeeMap({
  nodes,
  links,
  countryFill,
  selectedMarket,
  selectedBorder,
  onSelectMarket,
  onSelectBorder,
  describeMarket,
  describeBorder,
  className,
}: {
  nodes: Partial<Record<SeeCode, MapNode>>;
  links: Record<string, MapLink>;
  countryFill?: Record<string, string>;
  selectedMarket: SeeCode | null;
  selectedBorder: string | null;
  onSelectMarket: (code: SeeCode | null) => void;
  onSelectBorder: (id: string | null) => void;
  describeMarket: (code: SeeCode) => ReactNode;
  describeBorder: (id: string) => ReactNode;
  className?: string;
}) {
  const { t, lang } = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [hover, setHover] = useState<{
    kind: "market" | "border";
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const drag = useRef<{ px: number; py: number; view: View; moved: boolean } | null>(null);

  const viewBox = `${view.x} ${view.y} ${geo.width / view.k} ${geo.height / view.k}`;

  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0, scale: 1 };
      const rect = svg.getBoundingClientRect();
      // preserveAspectRatio="xMidYMid meet": uniform scale, centred.
      const vw = geo.width / view.k;
      const vh = geo.height / view.k;
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const ox = (rect.width - vw * scale) / 2;
      const oy = (rect.height - vh * scale) / 2;
      return {
        x: view.x + (clientX - rect.left - ox) / scale,
        y: view.y + (clientY - rect.top - oy) / scale,
        scale,
      };
    },
    [view],
  );

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setView((current) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        if (k === current.k) return current;
        const svg = svgRef.current;
        const rect = svg?.getBoundingClientRect();
        const cx = clientX ?? (rect ? rect.left + rect.width / 2 : 0);
        const cy = clientY ?? (rect ? rect.top + rect.height / 2 : 0);
        const point = toMap(cx, cy);
        // Keep the map point under the cursor fixed while the scale changes.
        const ratio = current.k / k;
        return clampView({
          k,
          x: point.x - (point.x - current.x) * ratio,
          y: point.y - (point.y - current.y) * ratio,
        });
      });
    },
    [toMap],
  );

  const hoverAt = (kind: "market" | "border", id: string, event: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ kind, id, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const dimOthers = selectedMarket !== null || selectedBorder !== null;
  const relatedMarkets = useMemo(() => {
    const set = new Set<string>();
    if (selectedMarket) {
      set.add(selectedMarket);
      for (const border of SEE_BORDERS) {
        if (border.a === selectedMarket) set.add(border.b);
        if (border.b === selectedMarket) set.add(border.a);
      }
    }
    if (selectedBorder) {
      const border = SEE_BORDERS.find((item) => item.id === selectedBorder);
      if (border) {
        set.add(border.a);
        set.add(border.b);
      }
    }
    return set;
  }, [selectedMarket, selectedBorder]);

  // Nodes, labels and strokes keep a near-constant on-screen size, whatever the panel
  // size or zoom: the factor converts screen pixels to map units.
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () =>
      setFit(Math.min(element.clientWidth / geo.width, element.clientHeight / geo.height) || 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const inv = Math.min(1.4, 1 / fit) / view.k;

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full min-h-[320px] w-full overflow-hidden", className)}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className={cn(
          "h-full w-full touch-none select-none",
          drag.current ? "cursor-grabbing" : "cursor-grab",
        )}
        role="group"
        aria-label={t(
          "Map of Southeast European power markets and interconnections",
          "Mapa tržišta i interkonekcija jugoistočne Evrope",
        )}
        onWheel={(event) => zoomAt(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX, event.clientY)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { px: event.clientX, py: event.clientY, view, moved: false };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state) return;
          const dx = event.clientX - state.px;
          const dy = event.clientY - state.py;
          if (!state.moved && Math.hypot(dx, dy) < 4) return;
          state.moved = true;
          const { scale } = toMap(0, 0);
          setHover(null);
          setView(
            clampView({
              k: state.view.k,
              x: state.view.x - dx / scale,
              y: state.view.y - dy / scale,
            }),
          );
        }}
        onPointerUp={() => {
          const state = drag.current;
          drag.current = null;
          if (state && !state.moved) {
            // A plain click on empty map clears the selection.
            onSelectMarket(null);
          }
        }}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
      >
        <rect x={0} y={0} width={geo.width} height={geo.height} fill="var(--map-sea)" />
        <g>
          {geo.countries.map((country) => (
            <path
              key={country.code}
              d={country.d}
              fill={
                countryFill?.[country.code] ??
                (CORE_COUNTRIES.has(country.code) ? "var(--map-land-core)" : "var(--map-land)")
              }
              stroke="var(--map-stroke)"
              strokeWidth={0.8 * inv}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        <g>
          {SEE_BORDERS.map((border) => {
            const a = ANCHORS[border.a];
            const b = ANCHORS[border.b];
            const link = links[border.id];
            if (!a || !b) return null;
            const seg = segment(a, b, inv);
            const selected = selectedBorder === border.id;
            const related =
              selected ||
              (selectedMarket !== null &&
                (border.a === selectedMarket || border.b === selectedMarket));
            const faded = dimOthers && !related;
            const empty = !link || link.empty;
            const width = (empty ? 1 : Math.max(1, link.width)) * inv;
            const color = empty ? "var(--map-stroke)" : link.color;
            const mx = (seg.x1 + seg.x2) / 2;
            const my = (seg.y1 + seg.y2) / 2;
            const dir = link?.direction ?? 0;
            // Arrowhead pointing along the flow, drawn at the receiving end.
            const head = 3.5 * inv + width * 0.8;
            const tipX = dir === 1 ? seg.x2 : seg.x1;
            const tipY = dir === 1 ? seg.y2 : seg.y1;
            const sx = dir === 1 ? seg.ux : -seg.ux;
            const sy = dir === 1 ? seg.uy : -seg.uy;
            const arrow =
              dir !== 0 && !empty
                ? `M${tipX} ${tipY} L${tipX - sx * head * 1.6 - sy * head * 0.8} ${tipY - sy * head * 1.6 + sx * head * 0.8} L${tipX - sx * head * 1.6 + sy * head * 0.8} ${tipY - sy * head * 1.6 - sx * head * 0.8} Z`
                : null;
            const lineEndX = arrow ? tipX - sx * head * 1.4 : dir === 1 ? seg.x2 : seg.x1;
            const lineEndY = arrow ? tipY - sy * head * 1.4 : dir === 1 ? seg.y2 : seg.y1;
            const startX = dir === 1 ? seg.x1 : seg.x2;
            const startY = dir === 1 ? seg.y1 : seg.y2;
            const x1 = dir === 0 ? seg.x1 : startX;
            const y1 = dir === 0 ? seg.y1 : startY;
            const x2 = dir === 0 ? seg.x2 : lineEndX;
            const y2 = dir === 0 ? seg.y2 : lineEndY;
            const label = !empty && link.label && seg.length / inv > 34 ? link.label : null;
            const pairLabel = `${SEE_MARKETS[border.a].short}–${SEE_MARKETS[border.b].short}`;
            return (
              <g
                key={border.id}
                role="button"
                tabIndex={0}
                aria-label={`${t("Border", "Granica")} ${pairLabel}${link?.label ? `, ${link.label}` : ""}`}
                aria-pressed={selected}
                opacity={faded ? 0.25 : 1}
                className="cursor-pointer outline-none [&:focus-visible_.hit]:stroke-[var(--ring)]"
                onPointerUp={(event) => {
                  if (drag.current?.moved) return;
                  event.stopPropagation();
                  drag.current = null;
                  onSelectBorder(selected ? null : border.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectBorder(selected ? null : border.id);
                  }
                }}
                onMouseMove={(event) => hoverAt("border", border.id, event)}
                onMouseLeave={() => setHover(null)}
              >
                {/* Wide invisible stroke: a comfortable hit target for a thin line. */}
                <line
                  className="hit"
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={selected ? "var(--brand)" : "transparent"}
                  strokeOpacity={selected ? 0.35 : 1}
                  strokeWidth={Math.max(14 * inv, width + 8 * inv)}
                  strokeLinecap="round"
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={color}
                  strokeWidth={width}
                  strokeLinecap={link?.animated ? "round" : "butt"}
                  strokeDasharray={
                    empty
                      ? `${2 * inv} ${4 * inv}`
                      : link.dashed || border.link === "HVDC"
                        ? `${7 * inv} ${4 * inv}`
                        : undefined
                  }
                  strokeOpacity={empty ? 0.9 : link.animated ? 0.55 : 1}
                />
                {link?.animated && !empty && dir !== 0 && (
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={color}
                    strokeWidth={Math.max(1.5 * inv, width * 0.55)}
                    strokeLinecap="round"
                    className="flow-animated"
                  />
                )}
                {arrow && <path d={arrow} fill={color} />}
                {label && (
                  <text
                    x={mx}
                    y={my}
                    dy={3.5 * inv}
                    textAnchor="middle"
                    fontSize={10.5 * inv}
                    className="num pointer-events-none"
                    fill="var(--foreground)"
                    stroke="var(--map-sea)"
                    strokeWidth={3.5 * inv}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <g>
          {(Object.keys(ANCHORS) as SeeCode[]).map((code) => {
            const anchor = ANCHORS[code];
            const market = SEE_MARKETS[code];
            if (!market) return null;
            const node = nodes[code];
            const selected = selectedMarket === code;
            const faded = dimOthers && !relatedMarkets.has(code);
            const connected = market.tier === "connected";
            const w = (connected ? NODE_W - 4 : NODE_W) * inv;
            const h = (connected ? NODE_H - 4 : NODE_H) * inv;
            const empty = !node || node.empty;
            return (
              <g
                key={code}
                role="button"
                tabIndex={0}
                aria-label={`${lang === "sr" ? market.nameSr : market.name}${node ? `, ${node.value}` : ""}`}
                aria-pressed={selected}
                transform={`translate(${anchor.x} ${anchor.y})`}
                opacity={faded ? 0.3 : 1}
                className="cursor-pointer outline-none [&:focus-visible_rect]:stroke-[var(--ring)]"
                onPointerUp={(event) => {
                  if (drag.current?.moved) return;
                  event.stopPropagation();
                  drag.current = null;
                  onSelectMarket(selected ? null : code);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectMarket(selected ? null : code);
                  }
                }}
                onMouseMove={(event) => hoverAt("market", code, event)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={4 * inv}
                  fill={empty ? "var(--surface)" : (node.fill ?? "var(--surface)")}
                  stroke={selected ? "var(--brand)" : "var(--border-strong)"}
                  strokeWidth={(selected ? 2.25 : 1) * inv}
                  strokeDasharray={connected && !selected ? `${3 * inv} ${2 * inv}` : undefined}
                />
                <text
                  y={-3.5 * inv}
                  textAnchor="middle"
                  fontSize={9.5 * inv}
                  fontWeight={600}
                  letterSpacing={0.4 * inv}
                  className="pointer-events-none font-condensed"
                  fill={empty ? "var(--muted-foreground)" : (node.ink ?? "var(--ink-2)")}
                >
                  {market.short}
                </text>
                <text
                  y={9 * inv}
                  textAnchor="middle"
                  fontSize={11 * inv}
                  className="num pointer-events-none"
                  fill={empty ? "var(--muted-foreground)" : (node.ink ?? "var(--foreground)")}
                >
                  {empty ? "—" : node.value}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute right-2 top-2 flex flex-col gap-1 rounded-sm border border-border bg-surface/90 p-0.5 backdrop-blur">
        <IconButton label={t("Zoom in", "Uvećaj")} onClick={() => zoomAt(1.4)}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label={t("Zoom out", "Umanji")} onClick={() => zoomAt(1 / 1.4)}>
          <Minus className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label={t("Reset view", "Vrati prikaz")} onClick={() => setView(HOME)}>
          <Scan className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-60 rounded-sm border border-border-strong bg-popover px-2.5 py-2 text-[11.5px] shadow-pop"
          style={{
            left: Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 600) - 250),
            top: Math.max(
              4,
              Math.min(hover.y + 14, (containerRef.current?.clientHeight ?? 400) - 150),
            ),
          }}
        >
          {hover.kind === "market" ? describeMarket(hover.id as SeeCode) : describeBorder(hover.id)}
        </div>
      )}
    </div>
  );
}
