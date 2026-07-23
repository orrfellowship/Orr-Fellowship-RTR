"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, Link2, ChevronDown, ChevronRight, CheckCircle2, Star, CopyX, Route } from "lucide-react";
import { setCandidateLinkedin, resolveHelpRequest, resolveDirectPlacement } from "./actions";
import ContactPopover from "@/components/ContactPopover";
import PaginationControls from "@/components/PaginationControls";
import { FightNightCurrentRound } from "@/components/FightNightCampaign";

const C = {
  navy: "#11123E", orange: "#DD5434", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};
const HEAD = "var(--font-head)";

export type HelpRequest = { id: string; title: string; body: string | null; dedupeKey: string | null; created_at: string };
export type MissingLinkedinCand = { id: string; name: string; email: string | null; school: string | null; area_of_study: string | null; gpa: string | null };
export type DirectPlacementCand = { id: string; name: string; email: string | null; school: string | null; area_of_study: string | null; gpa: string | null; flaggedBy: string; flaggedAt: string | null };

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d === 1 ? "yesterday" : `${d}d ago`;
}

export default function AdminSnapshotClient({ helpRequests, missingLinkedin, directPlacement = [], duplicateGroups = 0, misrouted = 0, isSuper = false }: {
  helpRequests: HelpRequest[];
  missingLinkedin: MissingLinkedinCand[];
  directPlacement?: DirectPlacementCand[];
  duplicateGroups?: number;
  misrouted?: number;
  isSuper?: boolean;
}) {
  const [deckOpen, setDeckOpen] = useState(false);
  // Category filter: "all" shows every category (collapsed); picking one shows
  // only that category, expanded — so the snapshot never opens as a long flood.
  const [filter, setFilter] = useState<string>("all");

  const cats = [
    ...(isSuper ? [{ id: "dpp", label: "Direct Placement Potential", count: directPlacement.length }] : []),
    { id: "help", label: "Help requests", count: helpRequests.length },
    { id: "dups", label: "Potential duplicates", count: duplicateGroups },
    { id: "routing", label: "School routing", count: misrouted },
    { id: "linkedin", label: "Missing LinkedIn", count: missingLinkedin.length },
  ];
  const total = cats.reduce((s, c) => s + c.count, 0);
  const show = (id: string) => filter === "all" || filter === id;
  const single = filter !== "all"; // a specific category is selected → expand it

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 28px 80px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Weekly Snapshot</h1>
          <p style={{ color: C.grayMute, margin: "4px 0 0" }}>
            {total === 0 ? "You're all caught up." : "Tasks needing your attention, grouped by type."}
          </p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.navy, fontWeight: 700, cursor: "pointer", marginTop: 6 }}>
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.count})</option>)}
        </select>
      </div>

      <FightNightCurrentRound accent="#DD5434" compact />

      <div key={filter} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
        {isSuper && show("dpp") && <DirectPlacementCategory candidates={directPlacement} defaultOpen={single} />}
        {show("help") && <HelpRequestsCategory requests={helpRequests} defaultOpen={single} />}
        {show("dups") && (
          <LinkCategory icon={<CopyX size={18} />} title="Review potential duplicates" count={duplicateGroups} tone={C.orange} defaultOpen={single}
            blurb={`${duplicateGroups} group${duplicateGroups === 1 ? "" : "s"} of candidates share a name or email. Keep one record per person and delete the rest.`}
            cta="Review duplicates →" href="/console/applicants?review=duplicates" />
        )}
        {show("routing") && (
          <LinkCategory icon={<Route size={18} />} title="Review school routing" count={misrouted} tone={C.navy} defaultOpen={single}
            blurb={`${misrouted} candidate${misrouted === 1 ? "" : "s"} are filed somewhere other than where their imported school text routes (e.g. an IU campus sitting in the Bonus group).`}
            cta="Review routing →" href="/console/applicants?review=routing" />
        )}
        {show("linkedin") && <MissingLinkedinCategory count={missingLinkedin.length} onOpen={() => setDeckOpen(true)} defaultOpen={single} />}
      </div>

      {deckOpen && <LinkedinDeck candidates={missingLinkedin} onClose={() => setDeckOpen(false)} />}
    </div>
  );
}

// ---- Category shell: header row with a count, collapsible body ----
function CategoryCard({ icon, title, count, tone, defaultOpen, children }: {
  icon: React.ReactNode; title: string; count: number; tone: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${tone}18`, color: tone, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: C.navy }}>{title}</div>
        <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 15, color: count ? tone : C.grayMute, background: count ? `${tone}14` : C.canvas, borderRadius: 999, padding: "2px 12px", minWidth: 30, textAlign: "center" }}>{count}</div>
        {count > 0 && (open ? <ChevronDown size={18} color={C.grayMute} /> : <ChevronRight size={18} color={C.grayMute} />)}
      </button>
      {open && count > 0 && <div style={{ borderTop: `1px solid ${C.line}` }}>{children}</div>}
    </div>
  );
}

// Super-Admin-only queue: candidates a team lead flagged as Direct Placement
// Potential. Resolving unflags the candidate and clears every super admin's copy.
function DirectPlacementCategory({ candidates, defaultOpen }: { candidates: DirectPlacementCand[]; defaultOpen?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resolving, setResolving] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const shown = candidates.slice(page * pageSize, (page + 1) * pageSize);

  const resolve = (id: string) => {
    setResolving(id);
    startTransition(async () => {
      await resolveDirectPlacement(id);
      router.refresh();
    });
  };

  return (
    <CategoryCard icon={<Star size={18} />} title="Direct Placement Potential" count={candidates.length} tone={C.orange} defaultOpen={defaultOpen}>
      <PaginationControls page={page} pageSize={pageSize} total={candidates.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 12, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.gray }}><ContactPopover name={c.name} email={c.email} /></div>
              <div style={{ fontSize: 12.5, color: C.grayMute, marginTop: 2 }}>
                {[c.school, c.area_of_study, c.gpa ? `GPA ${c.gpa}` : null].filter(Boolean).join(" · ") || c.email}
              </div>
              <div style={{ fontSize: 11, color: "#A0A6B8", marginTop: 4 }}>
                Flagged by {c.flaggedBy}{c.flaggedAt ? ` · ${timeAgo(c.flaggedAt)}` : ""}
              </div>
            </div>
            <button onClick={() => resolve(c.id)} disabled={pending && resolving === c.id}
              style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, background: "#fff", color: C.good, fontWeight: 700, fontSize: 12.5, padding: "7px 12px", borderRadius: 8, cursor: "pointer" }}>
              <CheckCircle2 size={14} /> {pending && resolving === c.id ? "…" : "Resolve"}
            </button>
          </div>
        ))}
      </div>
      <PaginationControls page={page} pageSize={pageSize} total={candidates.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />
    </CategoryCard>
  );
}

function HelpRequestsCategory({ requests, defaultOpen }: { requests: HelpRequest[]; defaultOpen?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resolving, setResolving] = useState<string | null>(null);

  const resolve = (dedupeKey: string | null) => {
    if (!dedupeKey) return;
    setResolving(dedupeKey);
    startTransition(async () => {
      await resolveHelpRequest(dedupeKey);
      router.refresh();
    });
  };

  return (
    <CategoryCard icon={<LifeBuoy size={18} />} title="Help requests" count={requests.length} tone={C.orange} defaultOpen={defaultOpen ?? true}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {requests.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 12, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.gray }}>{r.title}</div>
              {r.body && <div style={{ fontSize: 13, color: C.gray, marginTop: 3, whiteSpace: "pre-wrap" }}>{r.body}</div>}
              <div style={{ fontSize: 11, color: "#A0A6B8", marginTop: 4 }}>{timeAgo(r.created_at)}</div>
            </div>
            <button onClick={() => resolve(r.dedupeKey)} disabled={pending && resolving === r.dedupeKey}
              style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, background: "#fff", color: C.good, fontWeight: 700, fontSize: 12.5, padding: "7px 12px", borderRadius: 8, cursor: "pointer" }}>
              <CheckCircle2 size={14} /> {pending && resolving === r.dedupeKey ? "…" : "Resolve"}
            </button>
          </div>
        ))}
      </div>
    </CategoryCard>
  );
}

// A category whose work happens elsewhere — the body is a one-liner plus a
// link to the page with the actual review tooling (Candidates tab panels).
function LinkCategory({ icon, title, count, tone, blurb, cta, href, defaultOpen }: {
  icon: React.ReactNode; title: string; count: number; tone: string; blurb: string; cta: string; href: string; defaultOpen?: boolean;
}) {
  const router = useRouter();
  return (
    <CategoryCard icon={icon} title={title} count={count} tone={tone} defaultOpen={defaultOpen}>
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: C.grayMute, flex: 1, minWidth: 220 }}>{blurb}</div>
        <button onClick={() => router.push(href)}
          style={{ flexShrink: 0, border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, cursor: "pointer" }}>
          {cta}
        </button>
      </div>
    </CategoryCard>
  );
}

function MissingLinkedinCategory({ count, onOpen, defaultOpen }: { count: number; onOpen: () => void; defaultOpen?: boolean }) {
  return (
    <CategoryCard icon={<Link2 size={18} />} title="Missing LinkedIn" count={count} tone={C.navy} defaultOpen={defaultOpen}>
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 13, color: C.grayMute }}>{count} active candidate{count === 1 ? "" : "s"} need a LinkedIn URL added.</div>
        <button onClick={onOpen}
          style={{ flexShrink: 0, border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, cursor: "pointer" }}>
          Assign LinkedIns →
        </button>
      </div>
    </CategoryCard>
  );
}

// ---- LinkedIn flashcard deck — go card-by-card, paste a URL or skip ----
// Mirrors the workspace "Assign Point People" deck: the list is snapshotted on
// open so it doesn't shift as you save.
function LinkedinDeck({ candidates, onClose }: { candidates: MissingLinkedinCand[]; onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [deck] = useState<MissingLinkedinCand[]>(candidates);
  const [idx, setIdx] = useState(0);
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(candidates.length === 0);

  const current = deck[idx] ?? null;
  const advance = () => {
    setUrl(""); setError(null);
    if (idx + 1 >= deck.length) { setDone(true); router.refresh(); }
    else setIdx((i) => i + 1);
  };

  const save = async () => {
    if (!current) return;
    const v = url.trim();
    if (!v) { setError("Enter a URL or skip."); return; }
    setSaving(true); setError(null);
    const res = await setCandidateLinkedin(current.id, v);
    setSaving(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    setSaved((n) => n + 1);
    advance();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const card: React.CSSProperties = { position: "relative", background: "#fff", borderRadius: 18, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(11,12,42,.28)" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.5)" }} />

      {!done && current && (
        <div style={card}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", lineHeight: 1 }}>×</button>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: C.grayMute, fontWeight: 600 }}>Add a <b style={{ color: C.navy }}>LinkedIn URL</b></div>
            <div style={{ fontSize: 12.5, color: C.grayMute, fontWeight: 700 }}>{idx + 1} / {deck.length}</div>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: C.line, overflow: "hidden", marginBottom: 22 }}>
            <div style={{ height: "100%", width: `${(idx / deck.length) * 100}%`, background: C.navy, transition: "width .2s" }} />
          </div>

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "24px 22px", textAlign: "center", marginBottom: 18, background: C.canvas }}>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 24, color: C.navy, marginBottom: 8 }}>{current.name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, color: C.gray }}>
              {current.email && <div>{current.email}</div>}
              {(current.school || current.area_of_study || current.gpa) && (
                <div style={{ color: C.grayMute }}>{[current.school, current.area_of_study, current.gpa ? `GPA ${current.gpa}` : null].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          </div>

          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="https://linkedin.com/in/…"
            autoFocus
            style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, marginBottom: 6, boxSizing: "border-box" }}
          />
          {error && <div style={{ color: "#C0392B", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}

          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button onClick={advance} style={{ flex: 1, border: `1.5px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 700, padding: "12px 18px", borderRadius: 11, cursor: "pointer", fontSize: 14 }}>Skip →</button>
            <button onClick={save} disabled={saving} style={{ flex: 2, border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "12px 18px", borderRadius: 11, cursor: saving ? "default" : "pointer", fontSize: 14, opacity: saving ? 0.7 : 1 }}>{saving ? "Saving…" : "Save & next"}</button>
          </div>
          <div style={{ textAlign: "center", marginTop: 12, fontSize: 11.5, color: C.grayMute }}>{saved} saved so far · Esc to close</div>
        </div>
      )}

      {done && (
        <div style={card}>
          <h2 style={{ fontFamily: HEAD, fontSize: 24, color: C.navy, margin: "0 0 6px" }}>All done</h2>
          <p style={{ fontSize: 14, color: C.gray, margin: "0 0 22px" }}>
            {saved > 0 ? `Saved ${saved} LinkedIn URL${saved === 1 ? "" : "s"}.` : "No changes made."}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "12px 18px", borderRadius: 11, cursor: "pointer", fontSize: 14 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
