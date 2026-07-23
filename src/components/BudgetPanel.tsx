"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addBudgetEntry, deleteBudgetEntry, uploadReceipt, signedReceiptUrl, setBudgetGuidance } from "@/app/(app)/console/actions";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD", orange: "#DD5434",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};
const HEAD = "var(--font-head)";

export type BudgetEntry = {
  id: string; school_id: string | null; kind: "allocation" | "expense";
  label: string; amount: number | string; notes: string | null;
  receipt_url: string | null; created_by: string | null;
};
// `pct` is the legacy DB column name; it now holds a recommended DOLLAR amount
// per category (not a percentage). Kept as-is to avoid a destructive rename.
export type Guidance = { id?: string; school_id: string | null; category: string; pct: number | string };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function BudgetPanel({
  entries, schools = [], schoolId = null, accent = C.orange, meId,
  scopePicker = false, canAllocate = false, canExpense = false, canManage = false, guidance = [],
}: {
  entries: BudgetEntry[];
  schools?: { id: string; name: string }[];
  schoolId?: string | null;
  accent?: string;
  meId: string;
  scopePicker?: boolean;
  canAllocate?: boolean;
  canExpense?: boolean;
  canManage?: boolean;
  guidance?: Guidance[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<string>(scopePicker ? "" : (schoolId ?? ""));
  const activeScope = scopePicker ? scope : (schoolId ?? "");

  const scoped = useMemo(
    () => entries.filter((e) => (activeScope ? e.school_id === activeScope : e.school_id == null)),
    [entries, activeScope],
  );
  const allocated = scoped.filter((e) => e.kind === "allocation").reduce((s, e) => s + Number(e.amount || 0), 0);
  const spent = scoped.filter((e) => e.kind === "expense").reduce((s, e) => s + Number(e.amount || 0), 0);
  const remaining = allocated - spent;
  const sorted = [...scoped].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "allocation" ? -1 : 1));
  const scopeName = activeScope ? (schools.find((s) => s.id === activeScope)?.name ?? "School") : "Organization-wide";
  const scopedGuidance = useMemo(
    () => guidance.filter((g) => activeScope ? g.school_id === activeScope : g.school_id == null),
    [guidance, activeScope],
  );

  const openReceipt = (path: string) => startTransition(() => { signedReceiptUrl(path).then((r) => { if ("url" in r) window.open(r.url, "_blank"); else alert(r.error); }); });
  const remove = (id: string) => { if (confirm("Delete this entry?")) startTransition(() => { deleteBudgetEntry(id).then(() => router.refresh()); }); };

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

      <GuidanceSection guidance={scopedGuidance} allocated={allocated} canManage={canManage} pending={pending}
        onSave={(items) => startTransition(() => { setBudgetGuidance(activeScope || null, items).then(() => router.refresh()); })} />

      {/* Add forms */}
      {canAllocate && <EntryForm kind="allocation" schoolId={activeScope || null} accent={accent} pending={pending}
        onSaved={() => router.refresh()} />}
      {canExpense && <EntryForm kind="expense" schoolId={activeScope || null} accent={accent} pending={pending}
        onSaved={() => router.refresh()} />}

      {/* Entries */}
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16, opacity: pending ? 0.7 : 1 }}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.line}`, background: C.canvas, fontFamily: HEAD, fontWeight: 700, color: C.navy, fontSize: 14 }}>
          {scopeName} · {sorted.length} {sorted.length === 1 ? "entry" : "entries"}
        </div>
        {sorted.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.grayMute, fontSize: 13.5 }}>No entries yet.</div>}
        {sorted.map((e) => {
          const isAlloc = e.kind === "allocation";
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, padding: "3px 8px", borderRadius: 999, color: isAlloc ? C.navy2 : C.orange, background: isAlloc ? `${C.navy2}18` : `${C.orange}18`, flexShrink: 0 }}>
                {isAlloc ? "Allocation" : "Expense"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.gray }}>{e.label}</div>
                {e.notes && <div style={{ fontSize: 12, color: C.grayMute, fontStyle: "italic" }}>{e.notes}</div>}
              </div>
              {e.receipt_url && (
                <button onClick={() => openReceipt(e.receipt_url!)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy2, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 8, cursor: "pointer", flexShrink: 0 }}>📎 Receipt</button>
              )}
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: isAlloc ? C.good : C.orange, flexShrink: 0, minWidth: 64, textAlign: "right" }}>
                {isAlloc ? "+" : "−"}{usd(Number(e.amount || 0))}
              </div>
              {(canManage || e.created_by === meId) && (
                <button onClick={() => remove(e.id)} title="Delete" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 17, lineHeight: 1, flexShrink: 0 }}>×</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Recommended dollar amount by category ----------------------------------
function GuidanceSection({ guidance, allocated, canManage, pending, onSave }: {
  guidance: Guidance[]; allocated: number; canManage: boolean; pending: boolean;
  onSave: (items: { category: string; pct: number }[]) => void;
}) {
  const recommendedTotal = guidance.reduce((sum, g) => sum + (Number(g.pct) || 0), 0);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<{ category: string; pct: string }[]>(
    guidance.length ? guidance.map((g) => ({ category: g.category, pct: String(g.pct) })) : [{ category: "", pct: "" }],
  );
  const inp: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13.5, boxSizing: "border-box" };

  useEffect(() => {
    setEditing(false);
    setRows(guidance.length ? guidance.map((g) => ({ category: g.category, pct: String(g.pct) })) : [{ category: "", pct: "" }]);
  }, [guidance]);

  if (guidance.length === 0 && !canManage) return null;

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, color: C.navy, fontSize: 14 }}>Recommended budget by category</div>
        {canManage && !editing && <button onClick={() => setEditing(true)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy2, fontWeight: 600, fontSize: 12.5, padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}>Edit</button>}
      </div>

      {!editing ? (
        guidance.length === 0 ? (
          <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No recommendation set.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {guidance.map((g, i) => {
              const amount = Number(g.pct || 0);
              // Bar shows this category's share of the total recommendation.
              const share = recommendedTotal > 0 ? (amount / recommendedTotal) * 100 : 0;
              return (
                <div key={g.id ?? i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 140, fontSize: 13, color: C.gray }}>{g.category}</div>
                  <div style={{ flex: 1, height: 8, background: C.canvas, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(share, 100)}%`, height: "100%", background: C.navy2 }} />
                  </div>
                  <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 700, color: C.navy }}>{usd(amount)}</div>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.line}`, marginTop: 4, paddingTop: 8, fontSize: 12.5 }}>
              <span style={{ color: C.grayMute }}>Recommended total</span>
              <span style={{ fontWeight: 700, color: recommendedTotal > allocated && allocated > 0 ? C.orange : C.navy }}>
                {usd(recommendedTotal)}{allocated > 0 ? ` of ${usd(allocated)} allocated` : ""}
              </span>
            </div>
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={r.category} onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} placeholder="Category (e.g. Events)" style={{ ...inp, flex: 1 }} />
              <div style={{ position: "relative", width: 120 }}>
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13.5, color: C.grayMute, pointerEvents: "none" }}>$</span>
                <input value={r.pct} onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} placeholder="0" inputMode="decimal" style={{ ...inp, width: "100%", paddingLeft: 20 }} />
              </div>
              <button onClick={() => setRows((p) => p.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 17 }}>×</button>
            </div>
          ))}
          <div>
            <button onClick={() => setRows((p) => [...p, { category: "", pct: "" }])} style={{ border: `1px dashed ${C.line}`, background: "transparent", color: C.navy2, fontWeight: 600, fontSize: 13, padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}>+ Add category</button>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button onClick={() => { setEditing(false); setRows(guidance.length ? guidance.map((g) => ({ category: g.category, pct: String(g.pct) })) : [{ category: "", pct: "" }]); }} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "8px 14px", borderRadius: 9, cursor: "pointer" }}>Cancel</button>
            <button disabled={pending} onClick={() => { onSave(rows.map((r) => ({ category: r.category, pct: Number(r.pct) || 0 }))); setEditing(false); }} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "8px 16px", borderRadius: 9, cursor: "pointer" }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Allocation / Expense entry form ----------------------------------------
function EntryForm({ kind, schoolId, accent, pending, onSaved }: {
  kind: "allocation" | "expense"; schoolId: string | null; accent: string; pending: boolean; onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" };
  const isExpense = kind === "expense";

  const submit = async () => {
    if (!label.trim()) { setError("Add a label."); return; }
    if (isExpense && !file) { setError("A receipt image is required for expenses."); return; }
    setError(null); setBusy(true);
    try {
      let receipt_url: string | null = null;
      if (isExpense && file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await uploadReceipt(fd);
        if ("error" in up) { setError(up.error); setBusy(false); return; }
        receipt_url = up.path;
      }
      const res = await addBudgetEntry({ school_id: schoolId, kind, label: label.trim(), amount: Number(amount) || 0, notes: notes.trim() || null, receipt_url });
      if ("error" in res && res.error) { setError(res.error); setBusy(false); return; }
      setLabel(""); setAmount(""); setNotes(""); setFile(null);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ fontFamily: HEAD, fontWeight: 700, color: C.navy, fontSize: 14, marginBottom: 12 }}>{isExpense ? "Log an expense" : "Add an allocation"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={isExpense ? "What was it for?" : "Allocation label"} style={inp} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ($)" inputMode="decimal" style={inp} />
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" style={{ ...inp, width: "100%", marginBottom: 10 }} />
      {isExpense && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, color: file ? C.good : C.grayMute }}>
          <span style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, padding: "8px 12px", borderRadius: 8, cursor: "pointer" }}>📎 {file ? "Change receipt" : "Attach receipt *"}</span>
          {file ? file.name : "Required — image of the receipt/transaction"}
          <input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
        </label>
      )}
      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "8px 12px", fontSize: 13, color: "#8A3A1E", marginBottom: 10 }}>{error}</div>}
      <button onClick={submit} disabled={busy || pending} style={{ border: "none", background: isExpense ? accent : C.navy, color: "#fff", fontWeight: 700, padding: "10px 18px", borderRadius: 10, cursor: busy ? "default" : "pointer", fontSize: 13.5 }}>
        {busy ? "Saving…" : isExpense ? "Log expense" : "Add allocation"}
      </button>
    </div>
  );
}

// ---- Per-team + overall analysis (admin) ------------------------------------
export function BudgetAnalysis({ entries, schools }: {
  entries: BudgetEntry[];
  schools: { id: string; name: string }[];
}) {
  const rowFor = (label: string, ids: (string | null)[]) => {
    const set = new Set(ids);
    const es = entries.filter((e) => set.has(e.school_id));
    const alloc = es.filter((e) => e.kind === "allocation").reduce((s, e) => s + Number(e.amount || 0), 0);
    const spent = es.filter((e) => e.kind === "expense").reduce((s, e) => s + Number(e.amount || 0), 0);
    return { label, alloc, spent, remaining: alloc - spent };
  };
  const rows = schools.map((s) => rowFor(s.name, [s.id]));
  const total = {
    alloc: entries.filter((e) => e.kind === "allocation").reduce((s, e) => s + Number(e.amount || 0), 0),
    spent: entries.filter((e) => e.kind === "expense").reduce((s, e) => s + Number(e.amount || 0), 0),
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, background: C.canvas, fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute }}>
        <div>Scope</div><div style={{ textAlign: "right" }}>Allocated</div><div style={{ textAlign: "right" }}>Spent</div><div style={{ textAlign: "right" }}>Remaining</div>
      </div>
      {/* Total up top so the org-wide picture is the first thing you see. */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", padding: "13px 18px", borderBottom: `2px solid ${C.line}`, background: "#FAFBFE", alignItems: "center", fontFamily: HEAD }}>
        <div style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>Total</div>
        <div style={{ textAlign: "right", color: C.navy2, fontWeight: 700 }}>{usd(total.alloc)}</div>
        <div style={{ textAlign: "right", color: C.orange, fontWeight: 700 }}>{usd(total.spent)}</div>
        <div style={{ textAlign: "right", color: total.alloc - total.spent < 0 ? C.orange : C.good, fontWeight: 700 }}>{usd(total.alloc - total.spent)}</div>
      </div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", padding: "11px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center" }}>
          <div style={{ fontWeight: 600, color: C.gray, fontSize: 13.5 }}>{r.label}</div>
          <div style={{ textAlign: "right", color: C.navy2, fontWeight: 700 }}>{usd(r.alloc)}</div>
          <div style={{ textAlign: "right", color: C.orange, fontWeight: 700 }}>{usd(r.spent)}</div>
          <div style={{ textAlign: "right", color: r.remaining < 0 ? C.orange : C.good, fontWeight: 700 }}>{usd(r.remaining)}</div>
        </div>
      ))}
    </div>
  );
}
