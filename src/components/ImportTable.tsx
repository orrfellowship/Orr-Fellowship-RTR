"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { bulkImportCandidates } from "@/app/(app)/console/actions";
import { resolveCandidateSchool } from "@/lib/stages";

// The canonical bulk-import UI: a spreadsheet-style grid you can type into or
// paste CSV/Excel cells into. Used both by the /import page and the
// BulkImportModal wrapper so the experience is identical everywhere.

const C = {
  navy: "#11123E", navy3: "#8591AD", canvas: "#F4F6FB",
  line: "#E1E5EE", gray: "#33384D", grayMute: "#6E7385",
  orange: "#E8743B", good: "#2E9E6B",
};
const HEAD = "'Cabin', sans-serif";

// Stage, GPA and major are intentionally NOT imported here — those flow in from
// JazzHR. We seed name, email, school, LinkedIn, and point person.
// `point_person` is free text (a typed name); it's resolved to a team-member id
// at import time, so an unmatched name simply imports as unassigned.
type Row = { name: string; email: string; school: string; linkedin: string; point_person: string };
const emptyRow = (): Row => ({ name: "", email: "", school: "", linkedin: "", point_person: "" });

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
  // LinkedIn and point person are only read from a named header — never a
  // positional fallback — so stray columns aren't misread.
  const headerHas = (keys: string[]) => hasHeader ? Math.max(...keys.map((k) => header.findIndex((h) => h.includes(k)))) : -1;
  const iLink = headerHas(["linkedin", "linked in"]);
  const iPerson = hasHeader ? Math.max(...["point person", "point_person", "owner", "assignee"].map((k) => header.indexOf(k))) : -1;
  return data
    .filter((r) => (r[iName] ?? "").trim())
    .map((r) => ({
      name: r[iName] ?? "",
      email: r[iEmail] ?? "",
      school: r[iSchool] ?? "",
      linkedin: iLink >= 0 ? (r[iLink] ?? "") : "",
      point_person: iPerson >= 0 ? (r[iPerson] ?? "") : "",
    }));
}

// onClose: when provided (modal usage), a Cancel/Done button is shown alongside
// Import. The page usage omits it and simply shows the result inline.
export default function ImportTable({ schools, team = [], canAssignPointPerson = false, existingEmails, existingNames, onClose }: {
  schools: { id: string; name: string; tier?: string | null }[];
  team?: { id: string; full_name: string }[];
  // Only team leads / admins may set point person; fellows don't get the column.
  canAssignPointPerson?: boolean;
  existingEmails: Set<string>;
  existingNames?: Set<string>;
  onClose?: () => void;
}) {
  const showPP = canAssignPointPerson && team.length > 0;
  const names = existingNames ?? new Set<string>();
  const resolvePerson = (txt: string) => {
    const t = txt.trim().toLowerCase();
    if (!t) return "";
    return team.find((m) => m.full_name.toLowerCase() === t)?.id
      ?? team.find((m) => m.full_name.toLowerCase().includes(t))?.id
      ?? "";
  };
  const isDupeRow = (r: { name: string; email: string }) =>
    (!!r.email && existingEmails.has(r.email.toLowerCase())) || (!!r.name && names.has(r.name.trim().toLowerCase()));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Read an uploaded CSV/Excel file into the grid. Excel is parsed with SheetJS
  // (loaded on demand) by converting the first sheet to CSV, then reusing parseRows.
  const onFile = async (file: File) => {
    setError(null); setResult(null);
    try {
      let csv: string;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      } else {
        csv = await file.text();
      }
      const parsed = parseRows(csv);
      if (parsed.length === 0) { setError("No rows found in that file."); return; }
      setRows(parsed.length < 3 ? [...parsed, ...Array(3 - parsed.length).fill(null).map(emptyRow)] : parsed);
    } catch {
      setError("Couldn't read that file — please upload a .csv or .xlsx.");
    }
  };

  const validRows = rows.filter((r) => r.name.trim());
  const dupeCount = validRows.filter(isDupeRow).length;
  const unmatchedPeople = showPP ? validRows.filter((r) => r.point_person.trim() && !resolvePerson(r.point_person)).length : 0;
  const resolved = validRows.map((r) => {
    const { school_id, university_raw } = resolveCandidateSchool(r.school, schools);
    return {
      name: r.name.trim(),
      email: r.email.trim() || null,
      school_id,
      university_raw,
      stage: null,
      gpa: null,
      area_of_study: null,
      linkedin: r.linkedin.trim() || null,
      point_person_id: showPP ? resolvePerson(r.point_person) || null : null,
    };
  });

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

  return (
    <>
      {/* Suggestions for the per-row inputs (you can also type freely). */}
      <datalist id="import-schools">
        {schools.some((s) => s.tier === "satellite") && <option value="Satellite School" />}
        {schools.some((s) => s.tier === "bonus") && <option value="Bonus School" />}
        {schools.map((s) => <option key={s.id} value={s.name} />)}
      </datalist>
      {showPP && <datalist id="import-people">{team.map((m) => <option key={m.id} value={m.full_name} />)}</datalist>}

      {/* Upload / hint toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13, padding: "8px 14px", borderRadius: 9, cursor: "pointer" }}>
          ⬆ Upload CSV / Excel
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} style={{ display: "none" }} />
        </label>
        {showPP && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.grayMute }}>
            Assign all to
            <select value="" onChange={(e) => { if (!e.target.value) return; const v = e.target.value === "__none__" ? "" : e.target.value; setRows((prev) => prev.map((r) => ({ ...r, point_person: v }))); }}
              style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 12.5, padding: "7px 10px", borderRadius: 8, cursor: "pointer" }}>
              <option value="">Choose…</option>
              {team.map((m) => <option key={m.id} value={m.full_name}>{m.full_name}</option>)}
              <option value="__none__">Unassigned</option>
            </select>
          </label>
        )}
        <span style={{ fontSize: 12.5, color: C.grayMute }}>or type / paste rows below. Stage, GPA and major sync from JazzHR.</span>
      </div>

      {/* Table */}
      <div ref={containerRef} onPaste={onPaste} style={{ overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            {showPP ? (
              <>
                <col style={{ width: "22%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "5%" }} />
              </>
            ) : (
              <>
                <col style={{ width: "26%" }} />
                <col style={{ width: "26%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "21%" }} />
                <col style={{ width: "5%" }} />
              </>
            )}
          </colgroup>
          <thead>
            <tr style={{ background: C.canvas, borderBottom: `2px solid ${C.line}` }}>
              {(showPP ? ["Name *", "Email", "School", "LinkedIn", "Point Person"] : ["Name *", "Email", "School", "LinkedIn"]).map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.6, borderRight: `1px solid ${C.line}` }}>{h}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isDupe = isDupeRow(row);
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
                    <input list="import-schools" value={row.school} onChange={(e) => update(i, { school: e.target.value })}
                      placeholder="School (or type any)"
                      style={{ ...inp, color: row.school ? C.gray : C.grayMute }} />
                  </td>
                  <td style={cell}>
                    <input value={row.linkedin} onChange={(e) => update(i, { linkedin: e.target.value })}
                      placeholder="linkedin.com/in/…"
                      style={{ ...inp, color: row.linkedin ? C.gray : C.grayMute }} />
                  </td>
                  {showPP && (
                    <td style={cell}>
                      <input list="import-people" value={row.point_person} onChange={(e) => update(i, { point_person: e.target.value })}
                        placeholder="Team member"
                        title={row.point_person && !resolvePerson(row.point_person) ? "No matching team member — will import as unassigned" : undefined}
                        style={{ ...inp, color: !row.point_person ? C.grayMute : resolvePerson(row.point_person) ? C.gray : C.orange }} />
                    </td>
                  )}
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
          {dupeCount > 0 && <span style={{ color: C.orange, marginLeft: 10 }}>⚠ {dupeCount} possible duplicate{dupeCount !== 1 ? "s" : ""} (name or email match) — will still be imported</span>}
          {unmatchedPeople > 0 && <span style={{ color: C.orange, marginLeft: 10 }}>⚠ {unmatchedPeople} point person name{unmatchedPeople !== 1 ? "s" : ""} not matched — will import as unassigned</span>}
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
