"use client";

import { useEffect, useMemo, useState } from "react";

// ============================================================================
// ReviewDeck — a "quizlet"-style popup that walks an admin through review items
// one card at a time (the same pattern as the LinkedIn / Assign Point People
// decks), instead of a long scroll of stacked rows.
//
// Every admin review (school match, duplicates, routing, JazzHR match) renders
// its own card + action buttons via `renderCard`; the deck owns the shared
// chrome: the overlay, progress, snapshot-on-open, Esc-to-close, and an
// optional "Select multiple" mode that lets you tick several items and apply a
// bulk action in one go.
//
// The list is snapshotted when the deck opens so it doesn't shift underfoot as
// you resolve items. Reviews mark items done by calling api.resolve(keys); the
// deck drops them from the queue and slides the next one into place.
// ============================================================================

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", good: "#2F8F6B",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227",
};
const HEAD = "var(--font-head)";

export type DeckApi = {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  // Mark item(s) handled and advance. With no argument, resolves the current card.
  resolve: (keys?: string | string[]) => void;
  // Move to the next card without resolving the current one.
  skip: () => void;
  index: number;      // 1-based position within the remaining queue
  remaining: number;  // items not yet resolved
  total: number;      // snapshot size when the deck opened
};

export type BulkAction<T> = {
  label: (n: number) => string;
  tone?: "primary" | "default" | "danger";
  run: (items: T[], api: DeckApi) => Promise<{ error?: string } | void>;
};

export type BulkConfig<T> = {
  row: (item: T) => React.ReactNode;          // compact label shown in select mode
  selectable?: (item: T) => boolean;          // default: every item is selectable
  actions: BulkAction<T>[];
  hint?: string;
};

export function ReviewDeck<T>({
  title, subtitle, accent = C.navy, items, getKey, onClose, renderCard,
  bulk, doneMessage,
}: {
  title: string;
  subtitle?: string;
  accent?: string;
  items: T[];
  getKey: (item: T) => string;
  onClose: () => void;
  renderCard: (item: T, api: DeckApi) => React.ReactNode;
  bulk?: BulkConfig<T>;
  doneMessage?: (handled: number) => string;
}) {
  const [snapshot] = useState<T[]>(items);          // freeze the list on open
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [pos, setPos] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"card" | "list">("card");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const total = snapshot.length;
  const queue = useMemo(() => snapshot.filter((it) => !handled.has(getKey(it))), [snapshot, handled, getKey]);
  const remaining = queue.length;
  const current = remaining ? queue[pos % remaining] : null;

  const resolve = (keys?: string | string[]) => {
    const list = keys == null ? (current ? [getKey(current)] : []) : Array.isArray(keys) ? keys : [keys];
    if (!list.length) return;
    setHandled((prev) => { const next = new Set(prev); list.forEach((k) => next.add(k)); return next; });
    setSelected((prev) => { const next = new Set(prev); list.forEach((k) => next.delete(k)); return next; });
    setError(null);
  };

  const api: DeckApi = {
    busy, setBusy, setError,
    index: remaining ? (pos % remaining) + 1 : 0,
    remaining, total, resolve,
    skip: () => { setError(null); setPos((p) => p + 1); },
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const done = remaining === 0;
  const handledCount = total - remaining;
  const pct = total ? (handledCount / total) * 100 : 0;

  const selectableItems = useMemo(
    () => queue.filter((it) => (bulk?.selectable ? bulk.selectable(it) : true)),
    [queue, bulk],
  );
  const selectedItems = selectableItems.filter((it) => selected.has(getKey(it)));
  const allSelected = selectableItems.length > 0 && selectedItems.length === selectableItems.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableItems.map(getKey)));
  };
  const toggleOne = (key: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const runBulk = async (action: BulkAction<T>) => {
    if (!selectedItems.length || busy) return;
    setBusy(true); setError(null);
    const res = await action.run(selectedItems, api).catch(() => ({ error: "Something went wrong — try again." }));
    setBusy(false);
    if (res && "error" in res && res.error) { setError(res.error); return; }
    // Actions resolve their own keys, but resolve anything they missed too.
    resolve(selectedItems.map(getKey));
    if (remaining - selectedItems.length <= 0) setMode("card");
  };

  const btn = (tone: BulkAction<T>["tone"]): React.CSSProperties =>
    tone === "danger"
      ? { border: `1px solid ${C.orange}`, background: "#fff", color: C.orange }
      : tone === "primary"
        ? { border: "none", background: accent, color: "#fff" }
        : { border: `1px solid ${C.line}`, background: "#fff", color: C.gray };

  const card: React.CSSProperties = {
    position: "relative", background: "#fff", borderRadius: 18, padding: 24,
    width: 560, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto",
    boxShadow: "0 24px 60px rgba(11,12,42,.28)", display: "flex", flexDirection: "column", gap: 14,
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={() => !busy && onClose()} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.5)" }} />

      <div style={card}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", lineHeight: 1 }}>×</button>

        {/* header + progress */}
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, paddingRight: 24 }}>
            <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: C.navy }}>{title}</span>
            {!done && <span style={{ fontSize: 12.5, color: C.grayMute, fontWeight: 700, marginLeft: "auto" }}>{handledCount} of {total} done</span>}
          </div>
          {subtitle && <div style={{ fontSize: 12.5, color: C.grayMute, marginTop: 3 }}>{subtitle}</div>}
          <div style={{ height: 6, borderRadius: 99, background: C.line, overflow: "hidden", marginTop: 12 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: accent, transition: "width .2s" }} />
          </div>
        </div>

        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#8A3A1E" }}>{error}</div>}

        {done ? (
          <div style={{ textAlign: "center", padding: "18px 0 8px" }}>
            <div style={{ fontSize: 34, marginBottom: 6 }}>🎉</div>
            <h2 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "0 0 6px" }}>All caught up</h2>
            <p style={{ fontSize: 13.5, color: C.gray, margin: "0 0 18px" }}>
              {doneMessage ? doneMessage(handledCount) : `${handledCount} item${handledCount === 1 ? "" : "s"} handled.`}
            </p>
            <button onClick={onClose} style={{ border: "none", background: accent, color: "#fff", fontWeight: 700, padding: "11px 20px", borderRadius: 11, cursor: "pointer", fontSize: 14 }}>Close</button>
          </div>
        ) : mode === "list" && bulk ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: C.navy, cursor: "pointer" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                Select all {selectableItems.length}
              </label>
              <button onClick={() => setMode("card")} style={{ marginLeft: "auto", border: "none", background: "none", color: C.navy2, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>← One at a time</button>
            </div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden", maxHeight: "48vh", overflowY: "auto" }}>
              {selectableItems.map((it, i) => {
                const key = getKey(it);
                return (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, cursor: "pointer", background: selected.has(key) ? `${accent}0d` : "#fff" }}>
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggleOne(key)} />
                    <div style={{ flex: 1, minWidth: 0 }}>{bulk.row(it)}</div>
                  </label>
                );
              })}
              {selectableItems.length === 0 && <div style={{ padding: "12px 14px", fontSize: 12.5, color: C.grayMute, fontStyle: "italic" }}>Nothing here can be actioned in bulk — review these one at a time.</div>}
            </div>
            {bulk.hint && <div style={{ fontSize: 11.5, color: C.grayMute }}>{bulk.hint}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {bulk.actions.map((a, i) => (
                <button key={i} disabled={busy || selectedItems.length === 0} onClick={() => runBulk(a)}
                  style={{ ...btn(a.tone), fontWeight: 700, fontSize: 13, padding: "10px 16px", borderRadius: 10, cursor: busy || !selectedItems.length ? "not-allowed" : "pointer", opacity: busy || !selectedItems.length ? 0.55 : 1 }}>
                  {busy ? "Working…" : a.label(selectedItems.length)}
                </button>
              ))}
            </div>
          </>
        ) : current ? (
          <>
            {renderCard(current, api)}
            <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              <span style={{ fontSize: 12, color: C.grayMute, fontWeight: 700 }}>{api.index} of {remaining} left</span>
              {bulk && remaining > 1 && (
                <button onClick={() => setMode("list")} disabled={busy} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy2, fontWeight: 700, fontSize: 12, padding: "6px 11px", borderRadius: 8, cursor: busy ? "default" : "pointer" }}>
                  ☑ Select multiple
                </button>
              )}
              <div style={{ flex: 1 }} />
              {remaining > 1 && (
                <button onClick={api.skip} disabled={busy} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 700, fontSize: 12.5, padding: "7px 13px", borderRadius: 8, cursor: busy ? "default" : "pointer" }}>Skip →</button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
