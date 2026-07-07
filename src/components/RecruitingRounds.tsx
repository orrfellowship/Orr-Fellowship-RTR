"use client";

import { useState } from "react";
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

type RoundStatus = "Completed" | "Current" | "Upcoming";
type CampaignPhaseStatus = "Completed" | "Current" | "Upcoming";
type CampaignPhase = {
  title: string;
  timeFrame: string;
  description: string;
  start?: Date;
  end: Date;
};
type RecruitingRound = {
  number: number;
  title: string;
  timeFrame: string;
  description: string;
  start?: Date;
  end: Date;
};
type PhaseMilestone = {
  title: string;
  timeFrame: string;
  description: string;
};
type PhaseDetail = {
  title: string;
  subtitle: string;
  milestones: PhaseMilestone[];
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

export const recruitingRounds: RecruitingRound[] = [
  {
    number: 1,
    title: "Gear Check",
    timeFrame: "Now - July 12",
    description: "Log into RTR, confirm school assignments, review goals, and make sure the team is ready to use the tracker.",
    end: cycleDate(6, 12),
  },
  {
    number: 2,
    title: "Scout the Arena",
    timeFrame: "July 13 - July 20",
    description: "Build the school recruiting plan: key dates, career fairs, student orgs, faculty/staff contacts, alumni, and campus opportunities.",
    start: cycleDate(6, 13),
    end: cycleDate(6, 20),
  },
  {
    number: 3,
    title: "Work the Corner",
    timeFrame: "July 21 - Applications Open (July 28)",
    description: "Assign owners, schedule outreach, prepare events, and get sourced candidates ready for application launch.",
    start: cycleDate(6, 21),
    end: APPLICATIONS_OPEN,
  },
];

const phaseDetails: Record<string, PhaseDetail> = {
  "Training Camp": {
    title: "Training Camp Recruiting Rounds",
    subtitle: "Pre-application milestones for getting each school team ready before applications open.",
    milestones: recruitingRounds,
  },
  "Opening Bell": {
    title: "Opening Bell Application Push",
    subtitle: "Milestones for moving sourced candidates to submitted applications before the deadline.",
    milestones: [
      {
        title: "Source the Pipeline",
        timeFrame: "July 28 - Mid August",
        description: "Add and update sourced candidates for each assigned school.",
      },
      {
        title: "Land the First Punches",
        timeFrame: "Mid August - Early September",
        description: "Move sourced candidates from interest to applied status.",
      },
      {
        title: "Final Bell Push",
        timeFrame: "September 16 - September 25",
        description: "Follow up with sourced-but-not-applied candidates before applications close.",
      },
    ],
  },
  "Media Week": {
    title: "Media Week ONI Readiness",
    subtitle: "Milestones for tracking Orr Network Interview logistics, readiness, and follow-up.",
    milestones: [
      {
        title: "Schedule Check",
        timeFrame: "Before ONIs",
        description: "Confirm candidate/interviewer scheduling readiness.",
      },
      {
        title: "Interview Week",
        timeFrame: "Oct 7 - Oct 14",
        description: "Track ONI activity, issues, and completion.",
      },
      {
        title: "Evaluation Follow-Up",
        timeFrame: "After ONIs",
        description: "Confirm follow-up items and interview feedback are complete.",
      },
    ],
  },
  "Weigh-In": {
    title: "Weigh-In ROTC Readiness",
    subtitle: "Milestones for Reception on the Circle readiness, attendance, and follow-up.",
    milestones: [
      {
        title: "RSVP Check",
        timeFrame: "Before Oct 22",
        description: "Review invite and RSVP readiness.",
      },
      {
        title: "Reception on the Circle",
        timeFrame: "Oct 22",
        description: "Track attendance, fellow coverage, and event notes.",
      },
      {
        title: "Post-Reception Follow-Up",
        timeFrame: "After Oct 22",
        description: "Capture candidate notes and next steps.",
      },
    ],
  },
  "Fight Night": {
    title: "Fight Night Finalist Day",
    subtitle: "Milestones for Finalist Day execution and final-stage recruiting operations.",
    milestones: [
      {
        title: "Finalist Readiness",
        timeFrame: "Before Dec 4",
        description: "Confirm finalist readiness, logistics, and assignments.",
      },
      {
        title: "Finalist Day",
        timeFrame: "Dec 4",
        description: "Support event execution and real-time tracking.",
      },
      {
        title: "Final Outcomes",
        timeFrame: "After Dec 4",
        description: "Capture final-stage notes, outcomes, and follow-up items.",
      },
    ],
  },
};

function currentCampaignPhaseTitle(today: Date): string | null {
  const todayTime = dateOnly(today);
  const active = campaignPhases
    .filter((phase) => todayTime <= dateOnly(phase.end))
    .filter((phase) => !phase.start || todayTime >= dateOnly(phase.start))
    // If phases share a handoff day, the later phase owns the top-level status.
    .sort((a, b) => dateOnly(b.start ?? b.end) - dateOnly(a.start ?? a.end))[0];
  return active?.title ?? null;
}

function defaultSelectedPhaseTitle(today: Date): string {
  const current = currentCampaignPhaseTitle(today);
  if (current) return current;
  const todayTime = dateOnly(today);
  const upcoming = campaignPhases.find((phase) => todayTime < dateOnly(phase.start ?? phase.end));
  return upcoming?.title ?? campaignPhases[campaignPhases.length - 1].title;
}

function campaignStatusFor(phase: CampaignPhase, currentTitle: string | null, today: Date): CampaignPhaseStatus {
  const todayTime = dateOnly(today);
  if (phase.title === currentTitle) return "Current";
  if (phase.start && todayTime < dateOnly(phase.start)) return "Upcoming";
  if (todayTime > dateOnly(phase.end)) return "Completed";
  return currentTitle ? "Completed" : "Upcoming";
}

function currentMainRoundNumber(today: Date): number | null {
  const todayTime = dateOnly(today);
  const active = recruitingRounds
    .filter((round) => todayTime <= dateOnly(round.end))
    .filter((round) => !round.start || todayTime >= dateOnly(round.start))
    .sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0];
  return active?.number ?? null;
}

function statusFor(round: RecruitingRound, currentNumber: number | null, today: Date): RoundStatus {
  const todayTime = dateOnly(today);
  if (round.number === currentNumber) return "Current";
  if (round.start && todayTime < dateOnly(round.start)) return "Upcoming";
  if (todayTime > dateOnly(round.end)) return "Completed";
  return round.number && currentNumber && round.number < currentNumber ? "Completed" : "Upcoming";
}

function toneFor(status: RoundStatus | CampaignPhaseStatus, accent: string) {
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
  const currentNumber = currentMainRoundNumber(today);
  const [selectedPhaseTitle, setSelectedPhaseTitle] = useState(() => defaultSelectedPhaseTitle(today));
  const selectedDetail = phaseDetails[selectedPhaseTitle] ?? phaseDetails["Training Camp"];

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
          const isSelected = selectedPhaseTitle === phase.title;
          const connectorTone = isCurrent ? accent : C.line;
          const currentStyle: CSSProperties = isCurrent
            ? { boxShadow: `0 8px 18px ${accent}1f` }
            : isSelected
              ? { boxShadow: "0 6px 16px rgba(17,18,62,0.10)" }
              : { boxShadow: "none" };
          const borderColor = isCurrent ? accent : isSelected ? C.navy : tone.border;
          return (
            <div key={phase.title} style={{ display: "flex", alignItems: "center", flex: "1 0 0", minWidth: 0 }}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedPhaseTitle(phase.title)}
                style={{
                  appearance: "none",
                  textAlign: "left",
                  font: "inherit",
                  cursor: "pointer",
                  background: tone.bg,
                  border: `${isCurrent || isSelected ? 2 : 1}px solid ${borderColor}`,
                  borderTop: `4px solid ${isCurrent ? accent : isSelected ? C.navy : status === "Upcoming" ? C.line : tone.border}`,
                  borderRadius: 12,
                  padding: isCurrent || isSelected ? "12px 13px" : "13px 14px",
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
              </button>
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

      <div style={{ marginTop: 18, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 17, color: C.navy, margin: 0, fontFamily: HEAD }}>{selectedDetail.title}</h3>
            <p style={{ color: C.grayMute, margin: "3px 0 0", fontSize: 13 }}>{selectedDetail.subtitle}</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {selectedDetail.milestones.map((milestone, index) => {
          const isTrainingRound = selectedPhaseTitle === "Training Camp";
          const round = isTrainingRound ? recruitingRounds[index] : null;
          const status = round ? statusFor(round, currentNumber, today) : null;
          const tone = status ? toneFor(status, accent) : { border: C.line, bg: "#fff", pillBg: C.canvas, pillFg: C.grayMute, text: C.grayMute };
          const currentStyle: CSSProperties = status === "Current"
            ? { boxShadow: `0 12px 28px ${accent}22`, transform: "translateY(-1px)" }
            : {};
          return (
            <article
              key={`${selectedPhaseTitle}-${milestone.title}`}
              style={{
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                borderLeft: `4px solid ${status === "Upcoming" ? C.line : tone.border}`,
                borderRadius: 12,
                padding: "14px 16px",
                minHeight: 166,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                ...currentStyle,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: tone.text, letterSpacing: 0.4 }}>
                  {round ? `Round ${round.number}` : "Milestone"}
                </span>
                {status && (
                  <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: tone.pillFg, background: tone.pillBg, padding: "4px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
                    {status}
                  </span>
                )}
              </div>
              <div>
                <h3 style={{ fontFamily: HEAD, fontSize: 18, color: C.navy, margin: 0 }}>{milestone.title}</h3>
                <div style={{ fontSize: 12.5, color: C.grayMute, fontWeight: 700, marginTop: 3 }}>{milestone.timeFrame}</div>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.45, color: C.gray, margin: 0 }}>{milestone.description}</p>
            </article>
          );
        })}
        </div>
      </div>
    </section>
  );
}
