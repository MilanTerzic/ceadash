// Browser-local persistence for watchlists, alerts, saved views and scenarios.
//
// The application has no user accounts, so these live in localStorage on this device.
// They can be exported to and imported from a JSON file (see the Watchlist workspace).
import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "cea.v2.";
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFIX + key);
  } catch {
    return fallback;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function write<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or privacy mode: keep the value for this session only.
    cache.set(key, { raw: null, value });
  }
  listeners.get(key)?.forEach((listener) => listener());
}

/** useState that survives reloads. `fallback` must be a stable reference. */
export function usePersistent<T>(
  key: string,
  fallback: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      const onStorage = (event: StorageEvent) => {
        if (event.key === PREFIX + key) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        set.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current = read(key, fallback);
      write(key, typeof next === "function" ? (next as (prev: T) => T)(current) : next);
    },
    [key, fallback],
  );
  return [value, set];
}

export const STORE_KEYS = [
  "watch.markets",
  "watch.borders",
  "alerts",
  "views",
  "ppa.projects",
  "bess.scenarios",
];

export function exportStore(): string {
  const out: Record<string, unknown> = {};
  for (const key of STORE_KEYS) {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw !== null) out[key] = JSON.parse(raw);
  }
  return JSON.stringify({ app: "cea-power-intelligence", version: 2, data: out }, null, 2);
}

/** Returns the number of keys restored; throws on a file that is not a CEA export. */
export function importStore(json: string): number {
  const parsed = JSON.parse(json) as { app?: string; data?: Record<string, unknown> };
  if (parsed.app !== "cea-power-intelligence" || !parsed.data) throw new Error("not_a_cea_export");
  let restored = 0;
  for (const key of STORE_KEYS) {
    if (key in parsed.data) {
      write(key, parsed.data[key]);
      restored += 1;
    }
  }
  return restored;
}
