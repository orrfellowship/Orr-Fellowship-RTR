"use client";

import type { CSSProperties } from "react";
import { campaignPhases, campaignStatusFor } from "@/components/FightNightCampaign";

const C = {
  navy: "#11123E",
  navy2: "#485F92",
  navy3: "#8591AD",
  orange: "#DD5434",
  orangeSoft: "#FBE7DF",
  gray: "#303333",
  grayMute: "#6E7385",
  line: "#E4E7EE",
  canvas: "#F7F8FB",
  gold: "#C9A227",
  good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";
type CampaignPhaseStatus = "Completed" | "Current" | "Upcoming";

function toneFor(status: CampaignPhaseStatus, accent: string) {
  if (status === "Current") {
    return { border: accent, bg: `${accent}12`, pillBg: accent, pillFg: "#fff", text: accent };
  }
  if (status === "Completed") {
    return { border: C.line, bg: "#fff", pillBg: `${C.good}18`, pillFg: C.good, text: C.good };
  }
  return { border: C.line, bg: "#fff", pillBg: C.canvas, pillFg: C.grayMute, text: C.grayMute };
}

export default function RecruitingRounds({ accent = C.orange }: { accent?: string }) {
  const today = new Date();

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, color: C.navy, margin: 0, fontFamily: HEAD }}>Fight Night Campaign Timeline</h2>
          <p style={{ color: C.grayMute, margin: "4px 0 0", fontSize: 13.5 }}>Where each school team should be in the 2026 recruiting campaign.</p>
        </div>
      </div>

      <div style={{ overflowX: "auto", padding: "2px 0 8px" }}>
        <div style={{ display: "flex", alignItems: "stretch", minWidth: 980 }}>
        {campaignPhases.map((phase, index) => {
          const status: CampaignPhaseStatus = campaignStatusFor(phase, today);
          const tone = toneFor(status, accent);
          const isCurrent = status === "Current";
          const connectorTone = isCurrent ? accent : C.line;
          const currentStyle: CSSProperties = isCurrent
            ? { boxShadow: `0 8px 18px ${accent}1f` }
            : { boxShadow: "none" };
          return (
            <div key={phase.title} style={{ display: "flex", alignItems: "center", flex: "1 0 0", minWidth: 0 }}>
              <div
                style={{
                  textAlign: "left",
                  font: "inherit",
                  background: tone.bg,
                  border: `${isCurrent ? 2 : 1}px solid ${isCurrent ? accent : tone.border}`,
                  borderTop: `4px solid ${isCurrent ? accent : status === "Upcoming" ? C.line : tone.border}`,
                  borderRadius: 12,
                  padding: isCurrent ? "12px 13px" : "13px 14px",
                  minHeight: 168,
                  flex: "1 1 0",
                  minWidth: 170,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  ...currentStyle,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: isCurrent ? accent : status === "Completed" ? `${C.good}18` : C.canvas, color: isCurrent ? "#fff" : status === "Completed" ? C.good : C.grayMute, fontFamily: HEAD, fontWeight: 800, fontSize: 12 }}>
                    {index + 1}
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: tone.pillFg, background: tone.pillBg, padding: "4px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
                    {status}
                  </span>
                </div>
                <div>
                  <h3 style={{ fontFamily: HEAD, fontSize: 17.5, color: C.navy, margin: 0 }}>{phase.title}</h3>
                  <div style={{ fontSize: 12, color: C.grayMute, fontWeight: 700, marginTop: 3 }}>{phase.timeFrame}</div>
                </div>
                <p style={{ fontSize: 12.5, lineHeight: 1.4, color: C.gray, margin: 0 }}>{phase.description}</p>
              </div>
              {index < campaignPhases.length - 1 && (
                <div aria-hidden style={{ width: 34, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 7px" }}>
                  <div style={{ position: "relative", width: "100%", height: 2, borderRadius: 99, background: connectorTone }}>
                    <span style={{ position: "absolute", right: -5, top: -7, color: connectorTone, fontSize: 14, fontWeight: 800, lineHeight: 1 }}>→</span>
                  </div>
                </div>
              )}
              </div>
          );
        })}
        </div>
      </div>
    </section>
  );
}
