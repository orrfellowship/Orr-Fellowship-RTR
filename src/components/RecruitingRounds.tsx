"use client";

import type { CSSProperties } from "react";

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
const RECRUITING_YEAR = 2026;
const cycleDate = (monthIndex: number, day: number) => new Date(RECRUITING_YEAR, monthIndex, day);
const APPLICATIONS_OPEN = cycleDate(6, 28);
const APPLICATIONS_CLOSE = cycleDate(8, 25);
const ONI_START = cycleDate(9, 7);
const ONI_END = cycleDate(9, 14);
const ROTC_DATE = cycleDate(9, 22);
const FINALIST_DAY = cycleDate(11, 4);

type CampaignPhaseStatus = "Completed" | "Current" | "Upcoming";
type CampaignPhase = {
  title: string;
  timeFrame: string;
  description: string;
  start?: Date;
  end: Date;
};
const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const campaignPhases: CampaignPhase[] = [
  {
    title: "Training Camp",
    timeFrame: "Now - Applications Open (July 28)",
    description: "Prepare school teams before applications open.",
    end: APPLICATIONS_OPEN,
  },
  {
    title: "Opening Bell",
    timeFrame: "July 28 - Sept 25",
    description: "Drive sourced candidates to submitted applications before the deadline.",
    start: APPLICATIONS_OPEN,
    end: APPLICATIONS_CLOSE,
  },
  {
    title: "Media Week",
    timeFrame: "ONIs (Oct 7 - Oct 14)",
    description: "Track ONI logistics, readiness, and follow-up.",
    start: ONI_START,
    end: ONI_END,
  },
  {
    title: "Weigh-In",
    timeFrame: "ROTC (Oct 22)",
    description: "Manage ROTC readiness, attendance, and follow-up.",
    start: ROTC_DATE,
    end: ROTC_DATE,
  },
  {
    title: "Fight Night",
    timeFrame: "Finalist Day (Dec 4)",
    description: "Support Finalist Day execution and final-stage operations.",
    start: FINALIST_DAY,
    end: FINALIST_DAY,
  },
];

function currentCampaignPhaseTitle(today: Date): string | null {
  const todayTime = dateOnly(today);
  const active = campaignPhases
    .filter((phase) => todayTime <= dateOnly(phase.end))
    .filter((phase) => !phase.start || todayTime >= dateOnly(phase.start))
    // If phases share a handoff day, the later phase owns the top-level status.
    .sort((a, b) => dateOnly(b.start ?? b.end) - dateOnly(a.start ?? a.end))[0];
  return active?.title ?? null;
}

function campaignStatusFor(phase: CampaignPhase, currentTitle: string | null, today: Date): CampaignPhaseStatus {
  const todayTime = dateOnly(today);
  if (phase.title === currentTitle) return "Current";
  if (phase.start && todayTime < dateOnly(phase.start)) return "Upcoming";
  if (todayTime > dateOnly(phase.end)) return "Completed";
  return currentTitle ? "Completed" : "Upcoming";
}

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
  const currentPhaseTitle = currentCampaignPhaseTitle(today);

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
          const status = campaignStatusFor(phase, currentPhaseTitle, today);
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
