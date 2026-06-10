"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBudgetEntry, deleteBudgetEntry } from "@/app/(app)/console/actions";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD", orange: "#DD5434",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

export type BudgetEntry = {
  id: string; school_id: string | null; kind: "allocation" | "expense";
  label: string; amount: number | string; category: string | null;
  entry_date: string | null; notes: string | null; created_by: string | null;
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (d: string | null) =>
  d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

// Admin console passes scopePicker + the full school list and all entries; the
// team-lead workspace passes its own school's entries with canEdit=false.
export default function BudgetPanel({ entries, schools = [], canEdit, scopePicker = false, schoolId = null, accent = C.orange }: {
  entries: BudgetEntry[];
  schools?: { id: string; name: string }[];
  canEdit: boolean;
  scopePicker?: boolean;
  schoolId?: string | null;
  accent?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // "" = organization-wide; otherwise a school id. Non-picker views are locked to schoolId.
  const [scope, setScope] = useState<string>(scopePicker ? "" : (schoolId ?? ""));
  const activeScope = scopePicker ? scope : (schoolId ?? "");

  const scoped = useMemo(
    () => entries.filter((e) => (activeScope ? e.school_id === activeScope : e.school_id == null)),
    [entries, activeScope],
  );

  const allocated = scoped.filter((e) => e.kind === "allocation").reduce((s, e) => s + Number(e.amount || 0), 0);
  const spent = scoped.filter((e) => e.kind === "expense").reduce((s, e) => s + Number(e.amount || 0), 0);
  const remaining = allocated - spent;

  const sorted = [...scoped].sort((a, b) => (b.entry_date ?? "").localeCompare(a.entry_date ?? ""));

  const scopeLabel = activeScope ? (schools.find((s) => s.id === activeScope)?.name ?? "School") : "Organization-wide";

  return (
    <div>
      {scopePicker && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>Budget for</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.navy, fontWeight: 600 }}>
            <option value="">🌐 Organization-wide</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 18 }}>
        {([["Allocated", allocated, C.navy2], ["Spent", spent, C.orange], ["Remaining", remaining, remaining < 0 ? C.orange : C.good]] as const).map(([label, val, tone]) => (
          <div key={label} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: C.grayMute }}>{label}</div>
            <div style={{ fontFamily: HEAD, fontSize: 26, fontWeight: 700, color: tone, marginTop: 4 }}>{usd(val)}</div>
          </div>
        ))}
      </div>

      {canEdit && <AddEntryForm schoolId={activeScope || null} accent={accent} pending={pending}
        onAdd={(payload) => startTransition(() => { addBudgetEntry(payload).then(() => router.refresh()); })} />}

      {/* Entries */}
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16, opacity: pending ? 0.7 : 1 }}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.line}`, background: C.canvas, fontFamily: HEAD, fontWeight: 700, color: C.navy, fontSize: 14 }}>
          {scopeLabel} · {sorted.length} {sorted.length === 1 ? "entry" : "entries"}
        </div>
        {sorted.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.grayMute, fontSize: 13.5 }}>No budget entries yet.</div>}
        {sorted.map((e) => {
          const isAlloc = e.kind === "allocation";
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, padding: "3px 8px", borderRadius: 999, color: isAlloc ? C.navy2 : C.orange, background: isAlloc ? `${C.navy2}18` : `${C.orange}18`, flexShrink: 0 }}>
                {isAlloc ? "Allocation" : "Expense"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.gray }}>{e.label}</div>
                <div style={{ fontSize: 12, color: C.grayMute }}>
                  {[e.category, fmtDate(e.entry_date)].filter(Boolean).join(" · ")}
                  {e.notes ? <span style={{ fontStyle: "italic" }}> — {e.notes}</span> : null}
                </div>
              </div>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: isAlloc ? C.good : C.orange, flexShrink: 0 }}>
                {isAlloc ? "+" : "−"}{usd(Number(e.amount || 0))}
              </div>
              {canEdit && (
                <button onClick={() => { if (confirm("Delete this entry?")) startTransition(() => { deleteBudgetEntry(e.id).then(() => router.refresh()); }); }}
                  title="Delete" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 17, lineHeight: 1, flexShrink: 0 }}>×</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddEntryForm({ schoolId, accent, pending, onAdd }: {
  schoolId: string | null; accent: string; pending: boolean;
  onAdd: (e: { school_id: string | null; kind: "allocation" | "expense"; label: string; amount: number; category: string | null; entry_date: string | null; notes: string | null }) => void;
}) {
  const [kind, setKind] = useState<"allocation" | "expense">("expense");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" };

  const submit = () => {
    if (!label.trim()) { setError("Add a label."); return; }
    setError(null);
    onAdd({ school_id: schoolId, kind, label: label.trim(), amount: Number(amount) || 0, category: category.trim() || null, entry_date: date || null, notes: notes.trim() || null });
    setLabel(""); setAmount(""); setCategory(""); setDate(""); setNotes("");
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 }}>
      <div style={{ fontFamily: HEAD, fontWeight: 700, color: C.navy, fontSize: 14, marginBottom: 12 }}>Add entry</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {([["expense", "Expense"], ["allocation", "Allocation"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setKind(k)} style={{ flex: 1, border: `1px solid ${kind === k ? accent : C.line}`, background: kind === k ? `${accent}12` : "#fff", color: kind === k ? accent : C.gray, fontWeight: 700, padding: "9px", borderRadius: 9, cursor: "pointer", fontSize: 13 }}>{lbl}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Spring info session)" style={inp} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" style={inp} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" style={inp} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" style={{ ...inp, width: "100%", marginBottom: 12 }} />
      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "8px 12px", fontSize: 13, color: "#8A3A1E", marginBottom: 12 }}>{error}</div>}
      <button onClick={submit} disabled={pending} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "10px 18px", borderRadius: 10, cursor: pending ? "default" : "pointer", fontSize: 13.5 }}>
        {pending ? "Saving…" : "Add entry"}
      </button>
    </div>
  );
}
