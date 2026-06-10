"use client";

import ImportTable from "@/components/ImportTable";

const C = { navy: "#11123E", grayMute: "#6E7385", line: "#E4E7EE" };
const HEAD = "'Cabin', sans-serif";

export default function ImportClient({ schools, existingEmails }: {
  schools: { id: string; name: string; tier?: string | null }[];
  existingEmails: Set<string>;
}) {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 28px 80px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: HEAD, fontSize: 30, color: C.navy, margin: 0 }}>Import Candidates</h1>
        <p style={{ color: C.grayMute, margin: "4px 0 0" }}>
          Type directly into cells, or paste CSV / Excel data into any cell to populate the table.
        </p>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <ImportTable schools={schools} existingEmails={existingEmails} />
      </div>
    </div>
  );
}
