"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { listCandidates, bulkDeleteCandidates, deleteDuplicateCandidates } from "@/app/(app)/console/actions";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";

// Admin tool to clean up after a bad import: search candidates by name, select
// the ones to remove, and delete them in bulk. Matches by name/email/major.

const C = {
  navy: "#11123E", navy2: "#485F92", gray: "#33384D", grayMute: "#6E7385",
  line: "#E1E5EE", canvas: "#F4F6FB", orange: "#E8743B", orangeBg: "#FBE7DF", good: "#2E9E6B",
};
const HEAD = "'Cabin', sans-serif";

type Row = { id: string; name: string; email: string | null; school_id: string | null; university_raw?: string | null; stage: string | null };

export default function BulkDeleteCandidatesModal({ schools, onClose }: {
  schools: { id: string; name: string; tier?: string | null }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("all"); // "all" | <school_id> | "__unrouted__"
  const [rows, setRows] = useState<Row[]>([]);
  const sortedSchools = [...schools].sort((a, b) => a.name.localeCompare(b.name));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dedupeRunning, setDedupeRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const schoolName = (row: Row) => candidateSchoolDisplay(row, schools).label;

  // Load matches (debounced). Empty query lists the first batch alphabetically.
  const mounted = useRef(false);
  useEffect(() => {
    const run = () => {
      setLoading(true);
      listCandidates({
        variant: "console", page: 0, pageSize: 1000, q, sortKey: "name", sortDir: "asc",
        scope: school === "__unrouted__" ? "all" : school,
        unroutedOnly: school === "__unrouted__",
      }).then((res) => {
        setRows((res.rows as Row[]) ?? []);
        setLoading(false);
      });
    };
    if (!mounted.current) { mounted.current = true; run(); return; }
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [q, school]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected((prev) => {
    const n = new Set(prev);
    if (allShownSelected) rows.forEach((r) => n.delete(r.id));
    else rows.forEach((r) => n.add(r.id));
    return n;
  });

  const doDelete = () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Permanently delete ${ids.length} candidate${ids.length !== 1 ? "s" : ""}? This also removes their outreach and warm intros and cannot be undone.`)) return;
    setDeleting(true);
    bulkDeleteCandidates(ids).then((r) => {
      setDeleting(false);
      if (r.error) { setResult(`Error: ${r.error}`); return; }
      setResult(`✓ Deleted ${r.deleted} candidate${r.deleted !== 1 ? "s" : ""}.`);
      setSelected(new Set());
      setRows((prev) => prev.filter((row) => !ids.includes(row.id)));
      router.refresh();
    });
  };

  // One-click sweep: delete every email + name duplicate across the whole table,
  // keeping one record per group. Dry-runs first to show the count in the confirm.
  const deleteAllDuplicates = async () => {
    setResult(null);
    setDedupeRunning(true);
    const preview = await deleteDuplicateCandidates(true);
    if (preview.error) { setResult(`Error: ${preview.error}`); setDedupeRunning(false); return; }
    if (preview.count === 0) { setResult("✓ No email or name duplicates found."); setDedupeRunning(false); return; }
    if (!confirm(`Delete ${preview.count} duplicate candidate${preview.count !== 1 ? "s" : ""}? This keeps one record per name/email group (preferring JazzHR-linked records) and permanently removes the rest, including their outreach and warm intros. This cannot be undone.`)) {
      setDedupeRunning(false);
      return;
    }
    const res = await deleteDuplicateCandidates(false);
    setDedupeRunning(false);
    if (res.error) { setResult(`Error: ${res.error}`); return; }
    setResult(`✓ Deleted ${res.count} duplicate candidate${res.count !== 1 ? "s" : ""}.`);
    setSelected(new Set());
    // Refresh the visible list with the current filters.
    setLoading(true);
    const refreshed = await listCandidates({
      variant: "console", page: 0, pageSize: 1000, q, sortKey: "name", sortDir: "asc",
      scope: school === "__unrouted__" ? "all" : school, unroutedOnly: school === "__unrouted__",
    });
    setRows((refreshed.rows as Row[]) ?? []);
    setLoading(false);
    router.refresh();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 24, width: 720, maxWidth: "97vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 4px" }}>Bulk delete candidates</h2>
            <p style={{ fontSize: 13, color: C.grayMute, margin: 0 }}>Filter by school or search by name, select the ones to remove, then delete. Useful for cleaning up a bad import.</p>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", padding: "0 4px", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, or major…"
            style={{ flex: "1 1 240px", minWidth: 180, padding: "11px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" }} />
          <select value={school} onChange={(e) => setSchool(e.target.value)}
            style={{ padding: "11px 12px", borderRadius: 10, border: `1px solid ${school !== "all" ? C.orange : C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600, maxWidth: 220 }}>
            <option value="all">All schools</option>
            {sortedSchools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__unrouted__">Unrouted (no school)</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, color: C.grayMute }}>
          <button onClick={toggleAll} disabled={rows.length === 0} style={{ border: "none", background: "none", color: C.navy2, fontWeight: 700, cursor: rows.length ? "pointer" : "default", padding: 0 }}>
            {allShownSelected ? "Clear all shown" : "Select all shown"}
          </button>
          <span>{loading ? "Searching…" : `${rows.length} shown · ${selected.size} selected`}</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, minHeight: 200 }}>
          {rows.map((r, i) => {
            const sel = selected.has(r.id);
            return (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: `1px solid ${C.line}`, background: sel ? C.orangeBg : i % 2 ? "#FAFBFE" : "#fff", cursor: "pointer" }}>
                <input type="checkbox" checked={sel} onChange={() => toggle(r.id)} style={{ accentColor: C.orange, width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: C.grayMute, marginLeft: 8 }}>{[r.email, schoolName(r), r.stage].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            );
          })}
          {!loading && rows.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.grayMute, fontSize: 13 }}>No candidates match.</div>}
        </div>

        {result && <div style={{ background: result.startsWith("Error") ? C.orangeBg : "#E8F5EE", border: `1px solid ${result.startsWith("Error") ? C.orange : C.good}`, borderRadius: 9, padding: "9px 13px", fontSize: 13, color: result.startsWith("Error") ? "#8A3A1E" : "#1B5E3F" }}>{result}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={deleteAllDuplicates} disabled={dedupeRunning || deleting}
            title="Keep one record per name/email group and delete the rest, across all candidates"
            style={{ border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, padding: "11px 16px", borderRadius: 10, cursor: dedupeRunning || deleting ? "default" : "pointer", whiteSpace: "nowrap", opacity: dedupeRunning || deleting ? 0.6 : 1 }}>
            {dedupeRunning ? "Working…" : "⚠ Delete all email + name duplicates"}
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>Close</button>
            <button onClick={doDelete} disabled={deleting || selected.size === 0}
              style={{ border: "none", background: selected.size > 0 && !deleting ? C.orange : "#E6A892", color: "#fff", fontWeight: 700, padding: "11px 20px", borderRadius: 10, cursor: selected.size > 0 && !deleting ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
              {deleting ? "Deleting…" : `Delete ${selected.size || ""} selected`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
