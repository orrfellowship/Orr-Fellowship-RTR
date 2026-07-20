"use client";

import ImportTable from "./ImportTable";

// Modal wrapper around the shared ImportTable. Same grid/paste experience as the
// /import page, just presented as an overlay for in-context imports.

const C = { navy: "#11123E", grayMute: "#6E7385" };
const HEAD = "var(--font-head)";

export default function BulkImportModal({ schools, team = [], canAssignPointPerson = false, existingEmails, existingNames, onClose }: {
  schools: { id: string; name: string; tier?: string | null }[];
  team?: { id: string; full_name: string }[];
  canAssignPointPerson?: boolean;
  existingEmails: Set<string>;
  existingNames?: Set<string>;
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 900, maxWidth: "98vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 4px" }}>Bulk Import</h2>
            <p style={{ fontSize: 13, color: C.grayMute, margin: 0 }}>
              Type directly into cells, or paste CSV / Excel data into any cell to populate the table.
            </p>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", padding: "0 4px", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <ImportTable schools={schools} team={team} canAssignPointPerson={canAssignPointPerson} existingEmails={existingEmails} existingNames={existingNames} onClose={onClose} />
      </div>
    </div>
  );
}
