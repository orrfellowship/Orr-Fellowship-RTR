"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { bulkImportCandidates } from "@/app/(app)/console/actions";
import { routeToSchoolName } from "@/lib/stages";

// The canonical bulk-import UI: a spreadsheet-style grid you can type into or
// paste CSV/Excel cells into. Used both by the /import page and the
// BulkImportModal wrapper so the experience is identical everywhere.

const C = {
  navy: "#11123E", navy3: "#8591AD", canvas: "#F4F6FB",
  line: "#E1E5EE", gray: "#33384D", grayMute: "#6E7385",
  orange: "#E8743B", good: "#2E9E6B",
};
const HEAD = "'Cabin', sans-serif";
const STAGES = ["new", "contacted", "applied", "bmi", "finalist", "fellow"];

type Row = { name: string; email: string; school: string; stage: string; gpa: string; major: string };
const emptyRow = (): Row => ({ name: "", email: "", school: "", stage: "", gpa: "", major: "" });

function parseRows(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const cells = lines.map((line) =>
    line.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim())
  );
  const header = cells[0].map((h) => h.toLowerCase());
  const hasHeader = header.includes("name") || header.includes("email");
  const data = hasHeader ? cells.slice(1) : cells;
  const idx = (keys: string[], fallback: number) =>
    hasHeader ? Math.max(...keys.map((k) => header.indexOf(k))) : fallback;
  const iName = idx(["name"], 0);
  const iEmail = idx(["email"], 1);
  const iSchool = idx(["school"], 2);
  const iStage = idx(["stage"], 3);
  const iGpa = idx(["gpa"], 4);
  const iMajor = idx(["major", "area_of_study"], 5);
  return data
    .filter((r) => (r[iName] ?? "").trim())
    .map((r) => ({
      name: r[iName] ?? "",
      email: r[iEmail] ?? "",
      school: r[iSchool] ?? "",
      stage: r[iStage] ?? "",
      gpa: r[iGpa] ?? "",
      major: r[iMajor] ?? "",
    }));
}

// onClose: when provided (modal usage), a Cancel/Done button is shown alongside
// Import. The page usage omits it and simply shows the result inline.
export default function ImportTable({ schools, existingEmails, onClose }: {
  schools: { id: string; name: string }[];
  existingEmails: Set<string>;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const schoolByName = new Map(schools.map((s) => [s.name.toLowerCase(), s.id]));
  const resolveSchoolId = (raw: string): string | null => {
    const exact = schoolByName.get(raw.toLowerCase());
    if (exact) return exact;
    const routed = routeToSchoolName(raw);
    return routed ? (schoolByName.get(routed.toLowerCase()) ?? null) : null;
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const delRow = (i: number) =>
    setRows((prev) => prev.length === 1 ? [emptyRow()] : prev.filter((_, idx) => idx !== i));

  // Intercept paste anywhere in the table: if it looks like CSV/TSV, fill the grid.
  const onPaste = (e: React.ClipboardEvent) => {
    const txt = e.clipboardData.getData("text");
    const isMultiCell = txt.includes("\t") || txt.includes("\n") || txt.includes(",");
    if (!isMultiCell) return;
    const parsed = parseRows(txt);
    if (parsed.length === 0) return;
    e.preventDefault();
    setRows(parsed.length < 3 ? [...parsed, ...Array(3 - parsed.length).fill(null).map(emptyRow)] : parsed);
    setError(null);
    setResult(null);
  };

  const validRows = rows.filter((r) => r.name.trim());
  const dupeCount = validRows.filter((r) => r.email && existingEmails.has(r.email.toLowerCase())).length;
  const resolved = validRows.map((r) => ({
    name: r.name.trim(),
    email: r.email.trim() || null,
    school_id: resolveSchoolId(r.school),
    stage: r.stage || null,
    gpa: r.gpa || null,
    area_of_study: r.major || null,
  }));

  const doImport = () => {
    if (resolved.length === 0) { setError("No valid rows to import."); return; }
    setError(null);
    startTransition(() => {
      bulkImportCandidates(resolved).then((r) => {
        if ("error" in r && r.error) setError(r.error);
        else {
          setResult(`✓ Imported ${"count" in r ? r.count : resolved.length} candidate${resolved.length !== 1 ? "s" : ""}.`);
          router.refresh();
        }
      });
    });
  };

  const cell: React.CSSProperties = { borderRight: `1px solid ${C.line}`, padding: 0 };
  const inp: React.CSSProperties = { width: "100%", border: "none", outline: "none", fontSize: 13, padding: "8px 10px", background: "transparent", color: C.gray, fontFamily: "inherit", boxSizing: "border-box" };
  const sel: React.CSSProperties = { ...inp, cursor: "pointer", appearance: "none" as any };

  return (
    <>
      {/* Table */}
      <div ref={containerRef} onPaste={onPaste} style={{ overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "19%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "4%" }} />
          </colgroup>
          <thead>
            <tr style={{ background: C.canvas, borderBottom: `2px solid ${C.line}` }}>
              {(["Name *", "Email", "School", "Stage", "GPA", "Major"] as const).map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.6, borderRight: `1px solid ${C.line}` }}>{h}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isDupe = !!(row.email && existingEmails.has(row.email.toLowerCase()));
              const rowBg = isDupe ? "#FFF7F4" : i % 2 === 0 ? "#fff" : "#FAFBFE";
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${C.line}`, background: rowBg }}>
                  <td style={cell}>
                    <input value={row.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Full name"
                      style={{ ...inp, fontWeight: row.name ? 600 : 400, color: row.name ? C.gray : C.grayMute }} />
                  </td>
                  <td style={cell}>
                    <input value={row.email} onChange={(e) => update(i, { email: e.target.value })} placeholder="email@school.edu"
                      style={{ ...inp, color: isDupe ? C.orange : row.email ? C.gray : C.grayMute }} />
                  </td>
                  <td style={cell}>
                    <select value={row.school} onChange={(e) => update(i, { school: e.target.value })}
                      style={{ ...sel, color: row.school ? C.gray : C.grayMute }}>
                      <option value="">— School</option>
                      {schools.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </td>
                  <td style={cell}>
                    <select value={row.stage} onChange={(e) => update(i, { stage: e.target.value })}
                      style={{ ...sel, color: row.stage ? C.gray : C.grayMute }}>
                      <option value="">— Stage</option>
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={cell}>
                    <input value={row.gpa} onChange={(e) => update(i, { gpa: e.target.value })} placeholder="3.8"
                      style={{ ...inp, color: row.gpa ? C.gray : C.grayMute }} />
                  </td>
                  <td style={cell}>
                    <input value={row.major} onChange={(e) => update(i, { major: e.target.value })} placeholder="Major"
                      style={{ ...inp, color: row.major ? C.gray : C.grayMute }} />
                  </td>
                  <td style={{ padding: "0 6px", textAlign: "center" }}>
                    <button onClick={() => delRow(i)} title="Remove row"
                      style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "2px 4px" }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add row */}
      <button onClick={addRow}
        style={{ alignSelf: "flex-start", border: `1px dashed ${C.line}`, background: "transparent", color: C.navy3, fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 8, cursor: "pointer" }}>
        + Add row
      </button>

      {/* Status messages */}
      {validRows.length > 0 && !result && (
        <div style={{ padding: "9px 14px", background: C.canvas, borderRadius: 9, fontSize: 13 }}>
          <b style={{ color: C.navy }}>{validRows.length}</b> row{validRows.length !== 1 ? "s" : ""} ready to import
          {dupeCount > 0 && <span style={{ color: C.orange, marginLeft: 10 }}>⚠ {dupeCount} duplicate email{dupeCount !== 1 ? "s" : ""} — will still be imported</span>}
        </div>
      )}
      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E" }}>{error}</div>}
      {result && <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F" }}>{result}</div>}

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {onClose && (
          <button onClick={onClose}
            style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>
            {result ? "Done" : "Cancel"}
          </button>
        )}
        <button onClick={doImport} disabled={pending || validRows.length === 0}
          style={{ border: "none", background: validRows.length > 0 && !pending ? C.navy : C.navy3, color: "#fff", fontWeight: 700, padding: "11px 22px", borderRadius: 10, cursor: validRows.length > 0 && !pending ? "pointer" : "not-allowed" }}>
          {pending ? "Importing…" : `Import ${validRows.length} row${validRows.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </>
  );
}
