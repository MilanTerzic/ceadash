import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { marketTime, type Series } from "@/lib/see/analytics";
import { fmt, fmtEpochHour } from "@/lib/see/format";
import { cn } from "@/lib/utils";
import { LegendDot } from "./primitives";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  data: Series;
  kind?: "line" | "area" | "bar" | "step";
  /** Stack id for area/bar series. */
  stack?: string;
  dashed?: boolean;
  /** De-emphasised context line (thinner, lower opacity). */
  muted?: boolean;
}

const HOUR_MS = 3_600_000;
/** Above this many hourly points a chart is drawn from daily means. */
const DAILY_THRESHOLD = 24 * 45;

/** Daily means in market time, placed at each day's first hour. */
export function toDailyMeans(series: Series): Series {
  const out: Series = { t: [], v: [] };
  let day = "";
  let sum = 0;
  let count = 0;
  let first = 0;
  const flush = () => {
    if (count) {
      out.t.push(first);
      out.v.push(sum / count);
    }
  };
  for (let i = 0; i < series.t.length; i++) {
    const d = marketTime(series.t[i]).day;
    if (d !== day) {
      flush();
      day = d;
      sum = 0;
      count = 0;
      first = series.t[i];
    }
    sum += series.v[i];
    count += 1;
  }
  flush();
  return out;
}

function mergeRows(series: ChartSeries[]): Array<Record<string, number>> {
  const rows = new Map<number, Record<string, number>>();
  for (const item of series) {
    for (let i = 0; i < item.data.t.length; i++) {
      const t = item.data.t[i];
      const row = rows.get(t) ?? { t };
      row[item.key] = item.data.v[i];
      rows.set(t, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  unit,
  digits,
  formatX,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: number;
  series: ChartSeries[];
  unit: string;
  digits: number;
  formatX: (x: number) => string;
}) {
  if (!active || !payload?.length || label === undefined) return null;
  const byKey = new Map(payload.map((item) => [String(item.dataKey), item.value]));
  return (
    <div className="rounded-sm border border-border-strong bg-popover px-2.5 py-2 text-[11.5px] shadow-pop">
      <div className="num mb-1 text-muted-foreground">{formatX(label)}</div>
      <div className="grid gap-0.5">
        {series
          .filter((item) => byKey.get(item.key) !== undefined)
          .map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4">
              <LegendDot
                color={item.color}
                label={item.label}
                shape={item.kind === "bar" || item.kind === "area" ? "dot" : "line"}
              />
              <span className="num text-foreground">
                {fmt(byKey.get(item.key), digits)}{" "}
                <span className="text-muted-foreground">{unit}</span>
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

/**
 * Time-series chart on market time. One y-axis only: quantities with different units go
 * in separate charts. Long ranges are drawn from daily means (stated under the chart).
 */
export function TimeChart({
  series,
  unit,
  height = 220,
  digits = 1,
  zeroLine = false,
  brush = false,
  legend = true,
  yDomain,
  referenceY,
  className,
}: {
  series: ChartSeries[];
  unit: string;
  height?: number;
  digits?: number;
  zeroLine?: boolean;
  brush?: boolean;
  legend?: boolean;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  referenceY?: { value: number; label: string };
  className?: string;
}) {
  const longest = Math.max(0, ...series.map((item) => item.data.t.length));
  const daily = longest > DAILY_THRESHOLD;
  const prepared = useMemo(
    () => (daily ? series.map((item) => ({ ...item, data: toDailyMeans(item.data) })) : series),
    [series, daily],
  );
  const rows = useMemo(() => mergeRows(prepared), [prepared]);
  const span = rows.length ? rows[rows.length - 1].t - rows[0].t : 0;
  const tickFormat = (t: number) => {
    const { day, hour } = marketTime(t);
    if (span <= 48) return `${String(hour).padStart(2, "0")}:00`;
    return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  };
  const formatX = (t: number) =>
    daily ? `${marketTime(t).day} · daily mean` : `${fmtEpochHour(t)} CET`;

  // Day boundaries as light vertical guides on multi-day hourly charts.
  const dayLines = useMemo(() => {
    if (daily || span <= 24 || span > 24 * 14) return [];
    return rows.filter((row) => marketTime(row.t).hour === 0).map((row) => row.t);
  }, [rows, daily, span]);

  return (
    <div className={cn("min-w-0", className)}>
      {legend && series.length > 1 && (
        <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((item) => (
            <LegendDot
              key={item.key}
              color={item.color}
              label={item.label}
              shape={item.kind === "bar" || item.kind === "area" ? "dot" : "line"}
            />
          ))}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis
              dataKey="t"
              type="number"
              scale="linear"
              domain={["dataMin", "dataMax"]}
              tickFormatter={tickFormat}
              tickLine={false}
              minTickGap={36}
              tickMargin={6}
              height={24}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              domain={yDomain ?? ["auto", "auto"]}
              tickFormatter={(value: number) =>
                fmt(value, Math.abs(value) >= 100 ? 0 : digits > 1 ? 1 : 0)
              }
              allowDataOverflow={Boolean(yDomain)}
            />
            {dayLines.map((t) => (
              <ReferenceLine key={t} x={t} stroke="var(--grid-line)" />
            ))}
            {zeroLine && <ReferenceLine y={0} stroke="var(--axis-line)" />}
            {referenceY && (
              <ReferenceLine
                y={referenceY.value}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
                label={{
                  value: referenceY.label,
                  position: "insideTopRight",
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
              />
            )}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={
                <ChartTooltip series={prepared} unit={unit} digits={digits} formatX={formatX} />
              }
            />
            {prepared.map((item) => {
              if (item.kind === "bar") {
                return (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    stackId={item.stack}
                    fill={item.color}
                    isAnimationActive={false}
                    maxBarSize={18}
                  />
                );
              }
              if (item.kind === "area") {
                return (
                  <Area
                    key={item.key}
                    dataKey={item.key}
                    stackId={item.stack}
                    type="monotone"
                    stroke={item.color}
                    strokeWidth={1}
                    fill={item.color}
                    fillOpacity={item.stack ? 0.85 : 0.18}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                );
              }
              return (
                <Line
                  key={item.key}
                  dataKey={item.key}
                  type={item.kind === "step" ? "stepAfter" : "monotone"}
                  stroke={item.color}
                  strokeWidth={item.muted ? 1.25 : 2}
                  strokeOpacity={item.muted ? 0.7 : 1}
                  strokeDasharray={item.dashed ? "4 3" : undefined}
                  dot={false}
                  activeDot={{ r: 3.5, stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              );
            })}
            {brush && rows.length > 48 && (
              <Brush
                dataKey="t"
                height={18}
                travellerWidth={8}
                tickFormatter={() => ""}
                stroke="var(--border-strong)"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {daily && (
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          Drawn from daily means; statistics use hourly values.
        </p>
      )}
    </div>
  );
}

/** Generic numeric-x line chart (duration curves, profiles by hour of day). */
export function XYChart({
  series,
  unit,
  xLabel,
  height = 200,
  digits = 1,
  formatX,
  xTicks,
  zeroLine = false,
}: {
  series: Array<{
    key: string;
    label: string;
    color: string;
    points: Array<{ x: number; y: number }>;
    muted?: boolean;
  }>;
  unit: string;
  xLabel?: string;
  height?: number;
  digits?: number;
  formatX: (x: number) => string;
  xTicks?: number[];
  zeroLine?: boolean;
}) {
  const rows = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    for (const item of series) {
      for (const point of item.points) {
        const row = map.get(point.x) ?? { t: point.x };
        row[item.key] = point.y;
        map.set(point.x, row);
      }
    }
    return [...map.values()].sort((a, b) => a.t - b.t);
  }, [series]);
  const asChart: ChartSeries[] = series.map((item) => ({
    key: item.key,
    label: item.label,
    color: item.color,
    data: { t: [], v: [] },
    muted: item.muted,
  }));
  return (
    <div className="min-w-0">
      {series.length > 1 && (
        <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((item) => (
            <LegendDot key={item.key} color={item.color} label={item.label} shape="line" />
          ))}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              ticks={xTicks}
              tickFormatter={formatX}
              tickLine={false}
              tickMargin={6}
              height={24}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => fmt(value, Math.abs(value) >= 100 ? 0 : 0)}
            />
            {zeroLine && <ReferenceLine y={0} stroke="var(--axis-line)" />}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={
                <ChartTooltip
                  series={asChart}
                  unit={unit}
                  digits={digits}
                  formatX={(x) => (xLabel ? `${xLabel} ${formatX(x)}` : formatX(x))}
                />
              }
            />
            {series.map((item) => (
              <Line
                key={item.key}
                dataKey={item.key}
                type="monotone"
                stroke={item.color}
                strokeWidth={item.muted ? 1.25 : 2}
                strokeOpacity={item.muted ? 0.7 : 1}
                dot={false}
                activeDot={{ r: 3.5, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Tiny trend line for tables. Decorative: the adjacent number carries the value. */
export function Spark({
  values,
  width = 72,
  height = 20,
  color = "var(--ink-2)",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return <span className="inline-block" style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - 2) / (values.length - 1);
  const d = values
    .map(
      (value, index) =>
        `${index ? "L" : "M"}${(1 + index * step).toFixed(1)} ${(height - 2 - ((value - min) / range) * (height - 4)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
}

export interface HeatCell {
  value: number | null;
  color: string;
  /** Text colour for an in-cell label, when shown. */
  ink?: string;
}

/**
 * Row x column heat grid. Colour is always backed by the hover read-out and the row
 * summary column, so no value is carried by colour alone.
 */
export function HeatGrid({
  rows,
  columns,
  rowHeader,
  summaryHeader,
  onRowClick,
  activeRow,
  describe,
  cellHeight = 17,
  showValues = false,
  compact = false,
  labelEvery,
  formatCell,
}: {
  rows: Array<{
    id: string;
    label: ReactNode;
    cells: HeatCell[];
    summary?: ReactNode;
    title?: string;
  }>;
  columns: string[];
  rowHeader?: ReactNode;
  summaryHeader?: ReactNode;
  onRowClick?: (id: string) => void;
  activeRow?: string | null;
  describe: (rowId: string, column: number, value: number | null) => string;
  cellHeight?: number;
  showValues?: boolean;
  /** Narrow columns for side panels. */
  compact?: boolean;
  /** Show every n-th column label (defaults to 3 in compact mode, otherwise 1). */
  labelEvery?: number;
  /** Print a value inside each cell. */
  formatCell?: (value: number) => string;
}) {
  const every = labelEvery ?? (compact ? 3 : 1);
  const [hover, setHover] = useState<{ row: string; col: number } | null>(null);
  const hovered = hover ? rows.find((row) => row.id === hover.row) : null;
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <div
          className={cn("grid items-center gap-px", compact ? "min-w-[360px]" : "min-w-[560px]")}
          style={{
            gridTemplateColumns: `${compact ? 40 : 64}px repeat(${columns.length}, minmax(0, 1fr)) ${compact ? 46 : 60}px`,
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div className="eyebrow">{rowHeader}</div>
          {columns.map((column, index) => (
            <div
              key={index}
              className={cn(
                "num text-center text-[9.5px] text-muted-foreground",
                hover?.col === index && "text-foreground",
              )}
            >
              {index % every !== 0 ? "" : column}
            </div>
          ))}
          <div className="eyebrow text-right">{summaryHeader}</div>
          {rows.map((row) => (
            <div key={row.id} className="contents">
              <button
                type="button"
                title={row.title}
                onClick={onRowClick ? () => onRowClick(row.id) : undefined}
                className={cn(
                  "truncate text-left font-condensed text-xs font-semibold tracking-wide transition-colors",
                  activeRow === row.id ? "text-brand" : "text-ink-2 hover:text-foreground",
                  !onRowClick && "cursor-default",
                )}
                style={{ height: cellHeight }}
              >
                {row.label}
              </button>
              {row.cells.map((cell, index) => (
                <div
                  key={index}
                  onMouseEnter={() => setHover({ row: row.id, col: index })}
                  className={cn(
                    "num flex items-center justify-center text-[9.5px]",
                    hover?.row === row.id &&
                      hover.col === index &&
                      "outline outline-1 outline-foreground",
                    cell.value === null &&
                      "bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,var(--border)_3px,var(--border)_4px)]",
                  )}
                  style={{
                    height: cellHeight,
                    background: cell.value === null ? undefined : cell.color,
                    color: cell.ink,
                  }}
                >
                  {cell.value !== null && formatCell
                    ? formatCell(cell.value)
                    : showValues && cell.value !== null
                      ? fmt(cell.value, 0)
                      : null}
                </div>
              ))}
              <div
                className="num text-right text-xs text-foreground"
                style={{ height: cellHeight, lineHeight: `${cellHeight}px` }}
              >
                {row.summary}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="num mt-1.5 h-4 truncate text-[11px] text-muted-foreground">
        {hover && hovered
          ? describe(hover.row, hover.col, hovered.cells[hover.col]?.value ?? null)
          : " "}
      </div>
    </div>
  );
}

/** Horizontal ranked bars with a signed baseline at zero. One colour: the label names the row. */
export function RankBars({
  items,
  unit,
  digits = 1,
  onClick,
  active,
}: {
  items: Array<{ id: string; label: string; value: number | null; hint?: string }>;
  unit: string;
  digits?: number;
  onClick?: (id: string) => void;
  active?: string | null;
}) {
  const finite = items.filter((item) => item.value !== null) as Array<{
    id: string;
    label: string;
    value: number;
    hint?: string;
  }>;
  const max = Math.max(1e-9, ...finite.map((item) => Math.abs(item.value)));
  const signed = finite.some((item) => item.value < 0);
  return (
    <div className="grid gap-1">
      {items.map((item) => {
        const share = item.value === null ? 0 : Math.abs(item.value) / max;
        const negative = (item.value ?? 0) < 0;
        return (
          <button
            key={item.id}
            type="button"
            onClick={onClick ? () => onClick(item.id) : undefined}
            title={item.hint}
            className={cn(
              "grid grid-cols-[52px_minmax(0,1fr)_64px] items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors",
              onClick && "hover:bg-surface-2",
              active === item.id && "bg-surface-2",
            )}
          >
            <span className="truncate font-condensed text-xs font-semibold tracking-wide text-ink-2">
              {item.label}
            </span>
            <span className="relative h-2.5">
              {signed && (
                <span
                  className="absolute inset-y-0 left-1/2 w-px bg-axis-line"
                  style={{ background: "var(--axis-line)" }}
                />
              )}
              <span
                className="absolute inset-y-0 rounded-[2px]"
                style={{
                  background:
                    item.value === null
                      ? "transparent"
                      : negative
                        ? "var(--price-low)"
                        : signed
                          ? "var(--price-high)"
                          : "var(--series-1)",
                  width: `${(signed ? share / 2 : share) * 100}%`,
                  left: signed ? (negative ? `${50 - (share / 2) * 100}%` : "50%") : 0,
                }}
              />
            </span>
            <span className="num text-right text-xs text-foreground">
              {fmt(item.value, digits)}{" "}
              <span className="text-[10px] text-muted-foreground">{unit}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Vertical bars over ordered categories (histogram bins, hours of day). */
export function CategoryBars({
  data,
  unit,
  height = 180,
  digits = 1,
  color = "var(--series-1)",
  signed = false,
  describe,
}: {
  data: Array<{ label: string; value: number | null }>;
  unit: string;
  height?: number;
  digits?: number;
  color?: string;
  /** Colour bars below zero with the diverging "low" pole. */
  signed?: boolean;
  describe?: (label: string) => string;
}) {
  const rows = data.map((item, index) => ({
    t: index,
    value: item.value ?? undefined,
    label: item.label,
  }));
  const every = Math.max(1, Math.ceil(data.length / 12));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
          barCategoryGap={2}
        >
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis
            dataKey="t"
            tickFormatter={(index: number) =>
              index % every === 0 ? (data[index]?.label ?? "") : ""
            }
            tickLine={false}
            interval={0}
            tickMargin={6}
            height={24}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) =>
              fmt(value, Math.abs(value) >= 100 ? 0 : digits > 0 ? 1 : 0)
            }
          />
          <ReferenceLine y={0} stroke="var(--axis-line)" />
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as { label: string; value?: number } | undefined;
              if (!active || !row) return null;
              return (
                <div className="rounded-sm border border-border-strong bg-popover px-2.5 py-2 text-[11.5px] shadow-pop">
                  <div className="text-muted-foreground">
                    {describe ? describe(row.label) : row.label}
                  </div>
                  <div className="num text-foreground">
                    {fmt(row.value, digits)} <span className="text-muted-foreground">{unit}</span>
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="value" isAnimationActive={false} radius={[2, 2, 0, 0]} fill={color}>
            {signed &&
              rows.map((row) => (
                <Cell
                  key={row.t}
                  fill={(row.value ?? 0) < 0 ? "var(--price-low)" : "var(--price-high)"}
                />
              ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Scatter of two quantities with their own units, for showing a relationship. */
export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  height = 240,
  color = "var(--series-1)",
}: {
  points: Array<{ x: number; y: number }>;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  height?: number;
  color?: string;
}) {
  // Thin very large clouds evenly: the shape of the relationship is what matters.
  const step = Math.max(1, Math.ceil(points.length / 1500));
  const shown = step === 1 ? points : points.filter((_, index) => index % step === 0);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={shown} margin={{ top: 6, right: 18, bottom: 14, left: 0 }}>
          <CartesianGrid strokeDasharray="0" />
          <XAxis
            dataKey="x"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            tickMargin={6}
            tickFormatter={(value: number) => fmt(value, 0)}
            label={{
              value: `${xLabel} · ${xUnit}`,
              position: "insideBottom",
              offset: -8,
              fill: "var(--muted-foreground)",
              fontSize: 10.5,
            }}
          />
          <YAxis
            dataKey="y"
            type="number"
            width={44}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => fmt(value, 0)}
          />
          <ReferenceLine y={0} stroke="var(--axis-line)" />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as { x: number; y: number } | undefined;
              if (!active || !point) return null;
              return (
                <div className="num rounded-sm border border-border-strong bg-popover px-2.5 py-2 text-[11.5px] shadow-pop">
                  <div className="text-ink-2">
                    {xLabel}: <span className="text-foreground">{fmt(point.x, 0)}</span> {xUnit}
                  </div>
                  <div className="text-ink-2">
                    {yLabel}: <span className="text-foreground">{fmt(point.y, 1)}</span> {yUnit}
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            dataKey="y"
            fill={color}
            fillOpacity={0.45}
            isAnimationActive={false}
            shape={<ScatterDot />}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScatterDot(props: { cx?: number; cy?: number; fill?: string; fillOpacity?: number }) {
  if (props.cx === undefined || props.cy === undefined) return null;
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={2.25}
      fill={props.fill}
      fillOpacity={props.fillOpacity}
    />
  );
}
