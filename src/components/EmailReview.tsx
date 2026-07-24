"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { updateCandidate } from "@/app/(app)/console/actions";
import { findMalformedEmails, suggestEmailFix, isValidEmail, type EmailCand } from "@/lib/emailFix";
import { ReviewDeck, type DeckApi } from "./ReviewDeck";

// Admin review for candidates whose email is malformed (typo'd domain, missing
// @, stray spaces, etc.). Each card shows the bad address, a best-guess fix you
// can accept or edit, and saves it. Flip to "Select multiple" to apply every
// confident suggestion at once. Presented as the same quizlet-style deck as the
// other admin reviews.

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", good: "#2F8F6B",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB",
};

export { findMalformedEmails };

export default function EmailReview({ candidates, open, onClose, onFixed }: {
  candidates: EmailCand[];
  open: boolean;
  onClose: () => void;
  // Lets the parent patch its client-side snapshot after a fix.
  onFixed?: (id: string, email: string) => void;
}) {
  const router = useRouter();
  const malformed = useMemo(() => findMalformedEmails(candidates), [candidates]);

  const save = async (id: string, email: string): Promise<{ error?: string }> => {
    const r: any = await updateCandidate(id, { email });
    if (r?.error) return { error: r.error };
    onFixed?.(id, email);
    router.refresh();
    return {};
  };

  if (!open) return null;

  return (
    <ReviewDeck<EmailCand>
      title="Fix malformed emails"
      subtitle="These addresses aren't valid (bad domain, missing @, stray characters). Accept the suggested fix or edit it."
      accent={C.orange}
      items={malformed}
      getKey={(c) => c.id}
      onClose={onClose}
      doneMessage={(n) => `Fixed ${n} email${n === 1 ? "" : "s"}.`}
      bulk={{
        selectable: (c) => !!suggestEmailFix(c.email),
        row: (c) => {
          const fix = suggestEmailFix(c.email);
          return (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: C.grayMute }}><s>{c.email}</s> → <b style={{ color: C.good }}>{fix}</b></div>
            </div>
          );
        },
        actions: [{
          label: (n) => `Apply ${n} suggestion${n === 1 ? "" : "s"}`,
          tone: "primary",
          run: async (rows) => {
            for (const c of rows) {
              const fix = suggestEmailFix(c.email);
              if (!fix) continue;
              const res = await save(c.id, fix);
              if (res.error) return res;
            }
            return {};
          },
        }],
        hint: "Only rows with a confident suggestion can be bulk-applied; the rest need a manual edit.",
      }}
      renderCard={(c, api) => <EmailCard cand={c} api={api} onSave={save} />}
    />
  );
}

function EmailCard({ cand, api, onSave }: {
  cand: EmailCand; api: DeckApi; onSave: (id: string, email: string) => Promise<{ error?: string }>;
}) {
  const suggestion = suggestEmailFix(cand.email);
  const [value, setValue] = useState(suggestion ?? cand.email ?? "");
  const valid = isValidEmail(value);

  const run = async () => {
    if (!valid || api.busy) return;
    api.setBusy(true); api.setError(null);
    const res = await onSave(cand.id, value.trim());
    api.setBusy(false);
    if (res.error) { api.setError(res.error); return; }
    api.resolve(cand.id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 17, color: C.navy }}>{cand.name}</div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", background: C.canvas }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: C.grayMute, marginBottom: 4 }}>Current</div>
        <div style={{ fontSize: 14, color: C.orange, fontWeight: 600, textDecoration: "line-through", wordBreak: "break-all" }}>{cand.email}</div>
      </div>
      <label style={{ display: "grid", gap: 5 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.gray }}>
          Corrected email{suggestion && value === suggestion && <em style={{ color: C.good, fontStyle: "normal", fontWeight: 600 }}> · suggested</em>}
        </span>
        <input value={value} onChange={(e) => setValue(e.target.value)} type="email" autoComplete="off"
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${valid ? C.line : C.orange}`, fontSize: 14, color: C.gray, boxSizing: "border-box" }} />
        {!valid && <span style={{ fontSize: 11.5, color: C.orange }}>This still isn&apos;t a valid email.</span>}
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={run} disabled={!valid || api.busy}
          style={{ border: "none", background: valid && !api.busy ? C.navy : C.navy2, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 18px", borderRadius: 9, cursor: valid && !api.busy ? "pointer" : "not-allowed" }}>
          {api.busy ? "Saving…" : "Save email"}
        </button>
      </div>
    </div>
  );
}
