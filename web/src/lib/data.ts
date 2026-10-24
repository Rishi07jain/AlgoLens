import { useEffect, useState } from "react";

const cache = new Map<string, Promise<unknown>>();

export function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(`/results/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path) as Promise<T>;
}

export function useData<T>(path: string | null): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null; path: string | null }>({ data: null, error: null, path: null });
  useEffect(() => {
    if (!path) return;
    let live = true;
    load<T>(path)
      .then((d) => live && setState({ data: d, error: null, path }))
      .catch((e) => live && setState({ data: null, error: String(e), path }));
    return () => { live = false; };
  }, [path]);
  return state.path === path ? { data: state.data, error: state.error } : { data: null, error: null };
}
