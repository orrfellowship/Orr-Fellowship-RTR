// Instant skeleton shown while a section route streams its data, so navigation
// feels immediate instead of frozen. Rendered inside the persistent AppShell.
export default function SectionSkeleton() {
  const bar = (w: number | string, h = 14, mt = 0): React.CSSProperties => ({
    width: w, height: h, marginTop: mt, borderRadius: 8,
    background: "linear-gradient(90deg,#ECECF3 25%,#F5F5FA 37%,#ECECF3 63%)",
    backgroundSize: "400% 100%", animation: "orrShimmer 1.3s ease infinite",
  });
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #E4E7EE", borderRadius: 14, padding: 20 };
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 28px 80px" }}>
      <style>{`@keyframes orrShimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }`}</style>
      <div style={bar(260, 30)} />
      <div style={bar(160, 14, 10)} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 24 }}>
        {[0, 1, 2].map((i) => <div key={i} style={card}><div style={bar("60%", 12)} /><div style={bar("40%", 26, 12)} /></div>)}
      </div>
      <div style={{ ...card, marginTop: 20 }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} style={bar("100%", 16, i ? 14 : 0)} />)}
      </div>
    </div>
  );
}