export default function WorkspaceLoading() {
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 28px 80px" }}>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -600px 0; }
          100% { background-position: 600px 0; }
        }
        .sk {
          border-radius: 8px;
          background: linear-gradient(90deg, #ecedf2 25%, #f5f5f8 50%, #ecedf2 75%);
          background-size: 1200px 100%;
          animation: shimmer 1.4s infinite linear;
        }
      `}</style>

      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
        <div>
          <div className="sk" style={{ width: 220, height: 34, marginBottom: 10 }} />
          <div className="sk" style={{ width: 160, height: 16 }} />
        </div>
        <div className="sk" style={{ width: 110, height: 38, borderRadius: 10 }} />
      </div>

      {/* Three stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 88, borderRadius: 14 }} />
        ))}
      </div>

      {/* Two-column content area */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="sk" style={{ height: 18, width: 120, marginBottom: 4 }} />
          {[100, 80, 90, 70, 85].map((w, i) => (
            <div key={i} className="sk" style={{ height: 52, borderRadius: 12 }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="sk" style={{ height: 18, width: 100, marginBottom: 4 }} />
          {[90, 75, 85, 60].map((w, i) => (
            <div key={i} className="sk" style={{ height: 44, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
