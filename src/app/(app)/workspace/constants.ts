export const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", orangeSoft: "#FBE7DF", blue: "#8AB9E2", blueSoft: "#E1E9F4",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
export const HEAD = "'Cabin', sans-serif";
export const MONTHS = ["July", "August", "September", "Oct/Nov"] as const;
export const SOURCED  = new Set(["new", "contacted", "applied", "bmi", "finalist", "fellow"]);
export const CONTACTD = new Set(["contacted", "applied", "bmi", "finalist", "fellow"]);
export const APPLIED  = new Set(["applied", "bmi", "finalist", "fellow"]);
export const PHASE_OF: Record<string, string> = { new: "Sourced", contacted: "Contacted", applied: "Applied", bmi: "Advanced", finalist: "Finalist", fellow: "Fellow" };
export const phaseTone: Record<string, string> = { Sourced: C.navy3, Contacted: C.blue, Applied: C.navy2, Advanced: C.orange, Finalist: C.gold, Fellow: C.good };
