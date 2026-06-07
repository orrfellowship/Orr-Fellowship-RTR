"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkImportCandidates } from "@/app/(app)/console/actions";
import { routeToSchoolName } from "@/lib/stages";

const C = {
  navy: "#11123E", navy3: "#8591AD", canvas: "#F4F6FB",
  line: "#E1E5EE", gray: "#33384D", grayMute: "#6E7385",
  orange: "#E8743B", good: "#2E9E6B",
};
const HEAD = "'Cabin', sans-serif";

function parseCSVRows(text: string): string[][] {
  return text.trim().split("\n").filter((l) => l.trim()).map((line) =>
    line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim())
  );
}

// Shared candidate bulk-import modal used by both the Console and Workspace.
// Any signed-in user may import (the server action enforces auth only).
export default function BulkImportModal({ schools, existingEmails, onClose }: {
  schools: { id: string; name: string }[];
  existingEmails: Set<string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const schoolByName = new Map(schools.map((s) => [s.name.toLowerCase(), s.id]));
  const resolveSchoolId = (raw: string): string | null => {
    const exact = schoolByName.get(raw.toLowerCase());
    if (exact) return exact;
    const routed = routeToSchoolName(raw);
    return routed ? (schoolByName.get(routed.toLowerCase()) ?? null) : null;
  };

  const parsed = (() => {
    if (!text.trim()) return null;
    const rows = parseCSVRows(text);
    const header = rows[0]?.map((h) => h.toLowerCase()) ?? [];
    const hasHeader = header.includes("name") || header.includes("email");
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const iName = hasHeader ? header.indexOf("name") : 0;
    const iEmail = hasHeader ? header.indexOf("email") : 1;
    const iSchool = hasHeader ? header.indexOf("school") : 2;
    const iStage = hasHeader ? header.indexOf("stage") : 3;
    const iGpa = hasHeader ? header.indexOf("gpa") : 4;
    const iMajor = hasHeader ? Math.max(header.indexOf("major"), header.indexOf("area_of_study")) : 5;
    const items = dataRows.map((r) => ({
      name: r[iName] ?? "",
      email: r[iEmail] || null,
      school_id: resolveSchoolId(r[iSchool] ?? ""),
      stage: r[iStage] || null,
      gpa: r[iGpa] || null,
      area_of_study: r[iMajor] || null,
    })).filter((r) => r.name);
    const dupes = items.filter((r) => r.email && existingEmails.has((r.email ?? "").toLowerCase()));
    return { items, dupes };
  })();

  // Read an uploaded CSV/Excel file into the textarea so the same preview +
  // dedupe pipeline runs. Excel is parsed with SheetJS (loaded on demand).
  const onFile = async (file: File) => {
    setResult(null); setError(null);
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        setText(XLSX.utils.sheet_to_csv(ws));
      } else {
        setText(await file.text());
      }
    } catch {
      setError("Couldn't read that file — please upload a .csv or .xlsx.");
    }
  };

  const doImport = () => {
    if (!parsed || parsed.items.length === 0) { setError("No valid rows to import."); return; }
    setError(null);
    startTransition(() => {
      bulkImportCandidates(parsed.items).then((r) => {
        if ("error" in r && r.error) setError(r.error);
        else {
          setResult(`✓ Imported ${"count" in r ? r.count : parsed.items.length} candidate${parsed.items.length !== 1 ? "s" : ""}.`);
          router.refresh();
        }
      });
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 8px" }}>Bulk Import</h2>
        <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 16px" }}>
          Columns: <code style={{ background: C.canvas, padding: "1px 5px", borderRadius: 4 }}>Name, Email, School</code>. Header row is auto-detected. Upload a CSV/Excel file or paste below.
        </p>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px", marginBottom: 12, borderRadius: 10, border: `1.5px dashed ${C.line}`, background: C.canvas, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: C.navy }}>
          ⬆ Upload .csv or .xlsx
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} style={{ display: "none" }} />
        </label>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); setError(null); }}
          placeholder={"Name,Email,School\nJane Doe,jane@example.com,Purdue"}
          rows={8} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 13, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
        {parsed && (
          <div style={{ margin: "12px 0", padding: "10px 14px", background: C.canvas, borderRadius: 9, fontSize: 13 }}>
            <b style={{ color: C.navy }}>{parsed.items.length}</b> row{parsed.items.length !== 1 ? "s" : ""} parsed
            {parsed.dupes.length > 0 && <span style={{ color: C.orange, marginLeft: 10 }}>⚠ {parsed.dupes.length} may be duplicate{parsed.dupes.length !== 1 ? "s" : ""} (email match)</span>}
          </div>
        )}
        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E", marginBottom: 14 }}>{error}</div>}
        {result && <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F", marginBottom: 14 }}>{result}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>{result ? "Done" : "Cancel"}</button>
          <button onClick={doImport} disabled={pending || !parsed || parsed.items.length === 0}
            style={{ border: "none", background: parsed && parsed.items.length > 0 && !pending ? C.navy : C.navy3, color: "#fff", fontWeight: 700, padding: "11px 20px", borderRadius: 10, cursor: parsed && parsed.items.length > 0 && !pending ? "pointer" : "not-allowed" }}>
            {pending ? "Importing…" : `Import ${parsed ? parsed.items.length : 0} rows`}
          </button>
        </div>
      </div>
    </div>
  );
}
