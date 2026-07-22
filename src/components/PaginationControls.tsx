"use client";

const C = { navy: "#11123E", gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE" };

export default function PaginationControls({ page, pageSize, total, loading = false, onPageChange, onPageSizeChange }: {
  page: number; pageSize: number; total: number; loading?: boolean;
  onPageChange: (page: number) => void; onPageSizeChange: (pageSize: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 50 && pageSize === 50) return null;
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);
  const btn = (disabled: boolean): React.CSSProperties => ({ padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", color: disabled ? C.grayMute : C.navy, fontWeight: 700, cursor: disabled ? "default" : "pointer" });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 0", color: C.grayMute, fontSize: 12.5 }}>
      <span>{first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>Rows
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} disabled={loading}
            style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 8px", background: "#fff", color: C.gray }}>
            {[50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 0 || loading} style={btn(page <= 0 || loading)}>← Prev</button>
        <span>Page {page + 1} of {pages}</span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pages - 1 || loading} style={btn(page >= pages - 1 || loading)}>Next →</button>
      </div>
    </div>
  );
}
