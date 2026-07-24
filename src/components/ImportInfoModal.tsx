"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importCandidateInfo } from "@/app/(app)/console/actions";

// Import partial info for candidates already in the system. Match is by email;
// emails not found are skipped. Two kinds of columns:
//  - LinkedIn: fills blanks only (never overwrites).
//  - School: RE-ROUTES the candidate — a sourcing sheet is authoritative for
//    where its people belong, so a recognizable school value moves the
//    candidate (e.g. "Purdue Fort Wayne" → Satellite Schools) even off a core
//    row. Unrecognized school text leaves the candidate untouched.

const C = {
  navy: "#11123E", navy3: "#8591AD", canvas: "#F4F6FB",
  line: "#E1E5EE", gray: "#33384D", grayMute: "#6E7385", orange: "#E8743B", good: "#2E9E6B",
};
const HEAD = "var(--font-head)";

type Row = { email: string; linkedin: string; school: string };
const emptyRow = (): Row => ({ email: "", linkedin: "", school: "" });

function parseRows(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const cells = lines.map((line) => line.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim()));
  const header = cells[0].map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => h.includes("email") || h.includes("linkedin") || h.includes("school"));
  const data = hasHeader ? cells.slice(1) : cells;
  const findCol = (keys: string[], fallback: number) =>
    hasHeader ? Math.max(...keys.map((k) => header.findIndex((h) => h.includes(k)))) : fallback;
  const iEmail = findCol(["email"], 0);
  const iLink = findCol(["linkedin", "li url", "linked in"], 1);
  // School only reads from a named header — never positional — so a pasted
  // two-column email+linkedin sheet can't misread a stray column as a school.
  const iSchool = hasHeader ? header.findIndex((h) => h.includes("school") || h.includes("university") || h.includes("campus")) : -1;
  return data
    .filter((r) => (r[iEmail] ?? "").trim())
    .map((r) => ({
      email: r[iEmail] ?? "",
      linkedin: iLink >= 0 ? (r[iLink] ?? "") : "",
      school: iSchool >= 0 ? (r[iSchool] ?? "") : "",
    }));
}

export default function ImportInfoModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const delRow = (i: number) => setRows((prev) => prev.length === 1 ? [emptyRow()] : prev.filter((_, idx) => idx !== i));

  const onPaste = (e: React.ClipboardEvent) => {
    const txt = e.clipboardData.getData("text");
    if (!(txt.includes("\t") || txt.includes("\n") || txt.includes(","))) return;
    const parsed = parseRows(txt);
    if (!parsed.length) return;
    e.preventDefault();
    setRows(parsed.length < 3 ? [...parsed, ...Array(3 - parsed.length).fill(null).map(emptyRow)] : parsed);
    setError(null); setResult(null);
  };

  const onFile = async (file: File) => {
    setError(null); setResult(null);
    try {
      let csv: string;
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        const rows = await readSheet(file);
        csv = rows
          .map((row) => row.map((cell) => cell == null ? "" : String(cell)).join("\t"))
          .join("\n");
      } else {
        csv = await file.text();
      }
      const parsed = parseRows(csv);
      if (!parsed.length) { setError("No rows with an email found in that file."); return; }
      setRows(parsed.length < 3 ? [...parsed, ...Array(3 - parsed.length).fill(null).map(emptyRow)] : parsed);
    } catch {
      setError("Couldn't read that file — please upload a .csv or .xlsx.");
    }
  };

  const valid = rows.filter((r) => r.email.trim() && (r.linkedin.trim() || r.school.trim()));

  const doImport = () => {
    if (!valid.length) { setError("Add at least one row with an email plus a LinkedIn URL or a school."); return; }
    setError(null); setPending(true);
    importCandidateInfo(valid.map((r) => ({ email: r.email.trim(), linkedin: r.linkedin.trim() || null, school: r.school.trim() || null }))).then((r) => {
      setPending(false);
      if (r.error) { setError(r.error); return; }
      const parts = [];
      if (r.updated > 0) parts.push(`filled in ${r.updated} LinkedIn URL${r.updated !== 1 ? "s" : ""}`);
      if (r.schoolsUpdated > 0) parts.push(`re-routed ${r.schoolsUpdated} school${r.schoolsUpdated !== 1 ? "s" : ""}`);
      if (parts.length === 0) parts.push("no changes needed — everything already matched");
      setResult(`✓ ${parts.join(" · ")}.${r.skipped > 0 ? ` ${r.skipped} email${r.skipped !== 1 ? "s were" : " was"} not found and skipped.` : ""}`);
      router.refresh();
    });
  };

  const cell: React.CSSProperties = { borderRight: `1px solid ${C.line}`, padding: 0 };
  const inp: React.CSSProperties = { width: "100%", border: "none", outline: "none", fontSize: 13, padding: "8px 10px", background: "transparent", color: C.gray, boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 720, maxWidth: "97vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 4px" }}>Add Partial Info</h2>
            <p style={{ fontSize: 13, color: C.grayMute, margin: 0 }}>
              Add extra details to candidates who are <b>already in the system</b> — this does not create new candidates. Records are matched by <b>email</b>. A LinkedIn value fills a blank only (never overwrites); a <b>school</b> value re-routes the candidate — use this to fix placements from a sourcing sheet (e.g. &ldquo;Purdue Fort Wayne&rdquo; → Satellite Schools). Emails not found are skipped.
            </p>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", padding: "0 4px", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13, padding: "8px 14px", borderRadius: 9, cursor: "pointer" }}>
            ⬆ Upload CSV / Excel
            <input type="file" accept=".csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} style={{ display: "none" }} />
          </label>
          <span style={{ fontSize: 12.5, color: C.grayMute }}>or type / paste rows below (columns: email, linkedin, school — school is read from a named header).</span>
        </div>

        <div onPaste={onPaste} style={{ overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup><col style={{ width: "32%" }} /><col style={{ width: "36%" }} /><col style={{ width: "27%" }} /><col style={{ width: "5%" }} /></colgroup>
            <thead>
              <tr style={{ background: C.canvas, borderBottom: `2px solid ${C.line}` }}>
                {(["Email *", "LinkedIn URL", "School"] as const).map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.6, borderRight: `1px solid ${C.line}` }}>{h}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.line}`, background: i % 2 === 0 ? "#fff" : "#FAFBFE" }}>
                  <td style={cell}><input value={row.email} onChange={(e) => update(i, { email: e.target.value })} placeholder="email@school.edu" style={{ ...inp, color: row.email ? C.gray : C.grayMute }} /></td>
                  <td style={cell}><input value={row.linkedin} onChange={(e) => update(i, { linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" style={{ ...inp, color: row.linkedin ? C.gray : C.grayMute }} /></td>
                  <td style={cell}><input value={row.school} onChange={(e) => update(i, { school: e.target.value })} placeholder="e.g. IU Indianapolis" style={{ ...inp, color: row.school ? C.gray : C.grayMute }} /></td>
                  <td style={{ padding: "0 6px", textAlign: "center" }}>
                    <button onClick={() => delRow(i)} title="Remove row" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "2px 4px" }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button onClick={addRow} style={{ alignSelf: "flex-start", border: `1px dashed ${C.line}`, background: "transparent", color: C.navy3, fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" }}>+ Add row</button>

        {valid.length > 0 && !result && <div style={{ padding: "9px 14px", background: C.canvas, borderRadius: 9, fontSize: 13 }}><b style={{ color: C.navy }}>{valid.length}</b> row{valid.length !== 1 ? "s" : ""} ready to add</div>}
        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E" }}>{error}</div>}
        {result && <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F" }}>{result}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>{result ? "Done" : "Cancel"}</button>
          <button onClick={doImport} disabled={pending || valid.length === 0} style={{ border: "none", background: valid.length > 0 && !pending ? C.navy : C.navy3, color: "#fff", fontWeight: 700, padding: "11px 22px", borderRadius: 10, cursor: valid.length > 0 && !pending ? "pointer" : "not-allowed" }}>{pending ? "Adding…" : "Add info"}</button>
        </div>
      </div>
    </div>
  );
}
