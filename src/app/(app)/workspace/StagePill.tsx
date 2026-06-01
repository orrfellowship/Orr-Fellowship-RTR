import { PHASE_OF, phaseTone } from "./constants";

export default function StagePill({ stage }: { stage: string | null }) {
  const ph = stage ? PHASE_OF[stage] ?? "Sourced" : "Sourced";
  const tone = phaseTone[ph];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: tone, background: `${tone}22`, padding: "4px 9px", borderRadius: 999 }}>
      {stage ?? "—"}
    </span>
  );
}
