"use client";

import { BellRing, Clock3, TrendingUp } from "lucide-react";

const C = {
  navy: "#11123E",
  navySoft: "#20214F",
  gold: "#D8BC7A",
  goldSoft: "#F7F1E4",
  ink: "#303333",
  muted: "#6E7385",
  line: "#E4E7EE",
  good: "#2F8F6B",
};

const RECRUITING_YEAR = 2026;
const cycleDate = (monthIndex: number, day: number) => new Date(RECRUITING_YEAR, monthIndex, day);

export type CampaignPhase = {
  title: string;
  timeFrame: string;
  description: string;
  start: Date;
  end: Date;
  milestone: string;
};

export const campaignPhases: CampaignPhase[] = [
  {
    title: "Training Camp",
    timeFrame: "Now - Applications Open (July 28)",
    description: "Prepare school teams before applications open.",
    start: cycleDate(6, 1),
    end: cycleDate(6, 28),
    milestone: "Opening Bell",
  },
  {
    title: "Opening Bell",
    timeFrame: "July 28 - Sept 25",
    description: "Drive sourced candidates to submitted applications before the deadline.",
    start: cycleDate(6, 28),
    end: cycleDate(8, 25),
    milestone: "Application Deadline",
  },
  {
    title: "Media Week",
    timeFrame: "ONIs (Oct 7 - Oct 14)",
    description: "Track ONI logistics, readiness, and follow-up.",
    start: cycleDate(9, 7),
    end: cycleDate(9, 14),
    milestone: "ONIs Complete",
  },
  {
    title: "Weigh-In",
    timeFrame: "ROTC (Oct 22)",
    description: "Manage ROTC readiness, attendance, and follow-up.",
    start: cycleDate(9, 22),
    end: cycleDate(9, 22),
    milestone: "ROTC",
  },
  {
    title: "Fight Night",
    timeFrame: "Finalist Day (Dec 4)",
    description: "Support Finalist Day execution and final-stage operations.",
    start: cycleDate(11, 4),
    end: cycleDate(11, 4),
    milestone: "Finalist Day",
  },
];

const day = 86_400_000;
const dateOnly = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
const visibleAccent = (accent: string) => {
  const hex = accent.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return accent;
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
  return luminance < 0.28 ? C.gold : accent;
};

export function campaignStatusFor(
  phase: CampaignPhase,
  today: Date,
): "Completed" | "Current" | "Upcoming" {
  const now = dateOnly(today);
  let currentIndex = -1;
  for (let index = 0; index < campaignPhases.length; index++) {
    const candidate = campaignPhases[index];
    if (now >= dateOnly(candidate.start) && now <= dateOnly(candidate.end)) currentIndex = index;
  }
  const phaseIndex = campaignPhases.indexOf(phase);
  if (phaseIndex === currentIndex) return "Current";
  if (now < dateOnly(phase.start)) return "Upcoming";
  return "Completed";
}

export function getCampaignMoment(today = new Date()) {
  const now = dateOnly(today);
  let currentIndex = -1;
  for (let phaseIndex = 0; phaseIndex < campaignPhases.length; phaseIndex++) {
    const phase = campaignPhases[phaseIndex];
    if (now >= dateOnly(phase.start) && now <= dateOnly(phase.end)) currentIndex = phaseIndex;
  }
  const nextIndex = campaignPhases.findIndex((phase) => now < dateOnly(phase.start));
  const index = currentIndex >= 0
    ? currentIndex
    : nextIndex >= 0
      ? nextIndex
      : campaignPhases.length - 1;
  const phase = campaignPhases[index];
  const beforePhase = now < dateOnly(phase.start);
  const target = beforePhase ? phase.start : phase.end;
  const daysRemaining = Math.max(0, Math.ceil((dateOnly(target) - now) / day));
  const duration = Math.max(day, dateOnly(phase.end) - dateOnly(phase.start));
  const progress = beforePhase
    ? 0
    : Math.max(0, Math.min(100, ((now - dateOnly(phase.start)) / duration) * 100));

  return {
    phase,
    index,
    daysRemaining,
    progress,
    milestone: beforePhase ? phase.title : phase.milestone,
    betweenRounds: currentIndex < 0 && nextIndex >= 0,
  };
}

export function FightNightCurrentRound({
  accent = C.gold,
  compact = false,
}: {
  accent?: string;
  compact?: boolean;
}) {
  const moment = getCampaignMoment();
  const dayLabel = moment.daysRemaining === 1 ? "day" : "days";
  const campaignAccent = visibleAccent(accent);

  return (
    <section
      className="fight-current-round"
      aria-label="Current Fight Night campaign round"
      style={{
        position: "relative",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: compact ? "minmax(0,1fr) auto" : "minmax(0,1.45fr) minmax(190px,.55fr)",
        alignItems: "stretch",
        background: C.navy,
        border: `1px solid ${C.navySoft}`,
        borderTop: `3px solid ${campaignAccent}`,
        borderRadius: 14,
        color: "#fff",
        marginTop: 18,
        boxShadow: "0 10px 28px rgba(17,18,62,.10)",
      }}
    >
      <style>{responsiveStyles}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.16,
          backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)",
          backgroundSize: "18px 18px",
          maskImage: "linear-gradient(90deg, transparent, #000 55%, #000)",
        }}
      />
      <div style={{ position: "relative", padding: compact ? "15px 18px" : "19px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: compact ? 8 : 11 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.gold, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.15, textTransform: "uppercase" }}>
            <BellRing size={13} /> Current round
          </span>
          <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,.38)" }} />
          <span style={{ color: "rgba(255,255,255,.62)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8 }}>
            {moment.index + 1} of {campaignPhases.length}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-head)", fontSize: compact ? 20 : 24, lineHeight: 1.05 }}>{moment.phase.title}</h2>
          {moment.betweenRounds && <span style={{ color: C.gold, fontSize: 11, fontWeight: 700 }}>Next up</span>}
        </div>
        {!compact && <p style={{ margin: "7px 0 0", color: "rgba(255,255,255,.72)", fontSize: 13.5, lineHeight: 1.45 }}>{moment.phase.description}</p>}
        <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,.14)", overflow: "hidden", marginTop: compact ? 11 : 15 }}>
          <div style={{ height: "100%", width: `${moment.progress}%`, borderRadius: 99, background: campaignAccent }} />
        </div>
      </div>
      <div className="fight-current-round-countdown" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 11, minWidth: compact ? 180 : undefined, padding: compact ? "13px 18px" : "17px 22px", borderLeft: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.035)" }}>
        <Clock3 size={18} color={C.gold} />
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: compact ? 18 : 23, lineHeight: 1 }}>
            {moment.daysRemaining} <span style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,.65)" }}>{dayLabel}</span>
          </div>
          <div style={{ marginTop: 5, color: "rgba(255,255,255,.62)", fontSize: 10.5 }}>until {moment.milestone}</div>
        </div>
      </div>
    </section>
  );
}

export function FightNightOverviewPulse({
  sourced,
  sourcedGoal,
  applied,
  appliedGoal,
}: {
  sourced: number;
  sourcedGoal: number;
  applied: number;
  appliedGoal: number;
}) {
  const moment = getCampaignMoment();
  const sourcedDelta = sourcedGoal > 0 ? sourced - sourcedGoal : 0;
  const applicationsNeeded = Math.max(0, appliedGoal - applied);
  const momentum = [
    {
      label: "Sourcing pace",
      value: sourcedGoal <= 0
        ? "Goal not set"
        : sourcedDelta >= 0
          ? `${sourcedDelta.toLocaleString()} above goal`
          : `${Math.abs(sourcedDelta).toLocaleString()} to goal`,
      tone: sourcedDelta >= 0 && sourcedGoal > 0 ? C.good : C.gold,
    },
    {
      label: "Application push",
      value: appliedGoal <= 0
        ? "Goal not set"
        : applicationsNeeded === 0
          ? "Goal secured"
          : `${applicationsNeeded.toLocaleString()} to goal`,
      tone: applicationsNeeded === 0 && appliedGoal > 0 ? C.good : "#DD5434",
    },
  ];

  return (
    <section className="fight-overview-pulse" aria-label="Fight Night campaign pulse" style={{ display: "grid", gridTemplateColumns: "minmax(240px,.8fr) minmax(0,1.2fr)", margin: "18px auto 0", maxWidth: 696, background: "#fff", border: `1px solid ${C.line}`, borderTop: `3px solid ${C.gold}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(17,18,62,.06)" }}>
      <style>{responsiveStyles}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 17px", background: C.navy, color: "#fff" }}>
        <span style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 10, background: "rgba(216,188,122,.14)", color: C.gold }}><Clock3 size={19} /></span>
        <div>
          <div style={{ color: C.gold, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>Round {moment.index + 1} · {moment.phase.title}</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 17 }}>{moment.daysRemaining} days to {moment.milestone}</div>
        </div>
      </div>
      <div className="fight-overview-momentum" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", alignItems: "center" }}>
        {momentum.map((item, index) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "14px 16px", borderLeft: index === 0 ? "none" : `1px solid ${C.line}` }}>
            <TrendingUp size={17} color={item.tone} style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.muted, fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: .7 }}>{item.label}</div>
              <div style={{ marginTop: 3, color: C.ink, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const responsiveStyles = `
  @media (max-width: 700px) {
    .fight-current-round,
    .fight-overview-pulse {
      grid-template-columns: 1fr !important;
    }
    .fight-current-round-countdown {
      min-width: 0 !important;
      justify-content: flex-start !important;
      border-left: 0 !important;
      border-top: 1px solid rgba(255,255,255,.12);
    }
    .fight-overview-momentum {
      grid-template-columns: 1fr !important;
    }
    .fight-overview-momentum > div + div {
      border-left: 0 !important;
      border-top: 1px solid #E4E7EE;
    }
  }
`;
