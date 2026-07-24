"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  saveOutreachTemplate, setOutreachTemplateArchived,
  uploadOutreachTemplateAttachment, deleteOutreachTemplateAttachment,
} from "@/app/(app)/console/actions";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronLeft,
  ChevronRight, CircleAlert, History, Link2, Mail, Send, Unplug, UserRoundCheck, UsersRound,
} from "lucide-react";
import type { GmailConnectionStatus } from "@/lib/gmail/types";
import ContactPopover from "@/components/ContactPopover";
import PaginationControls from "@/components/PaginationControls";
import {
  OUTREACH_MERGE_VARIABLES,
  findUnsupportedOutreachVariables,
  findManualPlaceholders,
  sendEtaLabel,
  type ComposerRecipient,
  type OutreachAudience,
  type CampaignHistoryItem,
} from "@/lib/gmail/candidate-tokens";

const CAMPAIGN_STEPS = ["Recipients", "Compose", "Preview", "Review"] as const;
const LIMITS = { campaignName: 120, subject: 200, body: 20_000 };
const INITIAL_CAMPAIGN_SUBJECT = "{{candidate_first_name}}, connect with the Orr Fellowship";
const INITIAL_CAMPAIGN_BODY = `Hi {{candidate_first_name}},

I wanted to reach out about the Orr Fellowship. Your background at {{school}} stood out to us, and I'd love to tell you more about what the Fellowship offers graduating seniors.

Would you be open to a quick conversation?

Best,
{{fellow_point_person}}`;

// Friendly names for the merge tokens, shown on the draggable palette chips so
// admins recognize a field without decoding the {{snake_case}} token.
const MERGE_FIELD_LABELS: Record<string, string> = {
  "{{candidate_first_name}}": "Candidate first name",
  "{{candidate_last_name}}": "Candidate last name",
  "{{candidate_full_name}}": "Candidate full name",
  "{{school}}": "School",
  "{{stage}}": "Stage",
  "{{class_year}}": "Class year",
  "{{fellow_point_person}}": "Fellow point person",
};

// Custom dataTransfer type so a field only accepts drops that originate from our
// palette (a chip), not arbitrary dragged text/files.
const MERGE_FIELD_DND = "application/x-orr-merge-field";

// A field is a valid drop target while a palette chip is being dragged over it.
function allowMergeFieldDrop(e: React.DragEvent) {
  if (!e.dataTransfer.types.includes(MERGE_FIELD_DND)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
}

// Insert the dropped token where the drag caret landed. During dragover the
// browser moves the field's caret to follow the pointer, so selectionStart at
// drop time is the drop position; we fall back to the end if it's unavailable.
function insertMergeFieldOnDrop(
  e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>,
  value: string,
  setValue: (next: string) => void,
) {
  const token = e.dataTransfer.getData(MERGE_FIELD_DND);
  if (!token) return;
  e.preventDefault();
  const el = e.currentTarget;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;
  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
  setValue(next);
  const caret = start + token.length;
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
}

// One send result, in the same shape the Sent screen consumes.
type DemoCampaignResult = {
  success: true; attempted: number; sent: number; failed: number; excluded: number;
  recipients: Array<{ candidateId: string; candidateName: string; maskedRecipient: string | null; status: "sent" | "failed" | "excluded"; messageId?: string; failureReason?: string; exclusionReason?: string }>;
};

const fullName = (r: { name: string; email: string | null }) => r.name || r.email || "Unknown";
const isEmailValid = (email: string | null) => !!email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
const recipientEligible = (r: ComposerRecipient) => isEmailValid(r.email) && !r.doNotContact;
const exclusionReasonFor = (r: ComposerRecipient) =>
  !r.email ? "No email on file" : !isEmailValid(r.email) ? "Malformed email" : r.doNotContact ? "Do Not Contact" : null;

function renderHighlightedOutreachTemplate(template: string, tokens: ComposerRecipient["tokens"]): ReactNode[] {
  const parts: ReactNode[] = [];
  // Matches, in priority order: a [label](url) link (rendered clickable), a
  // {{merge_field}} (auto-filled, amber), or a [single-bracket] manual
  // placeholder (red — must be replaced before sending).
  const pattern = /\[([^[\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\{\{\s*([a-z_]+)\s*\}\}|\[[^[\]\n]+\]/gi;
  let cursor = 0;

  for (const match of template.matchAll(pattern)) {
    const index = match.index ?? 0;
    parts.push(template.slice(cursor, index));

    if (match[1] !== undefined && match[2] !== undefined) {
      // [label](url) — a real hyperlink; show it as one.
      parts.push(<a href={match[2]} target="_blank" rel="noreferrer" style={{ color: C.orange, textDecoration: "underline" }} key={`l-${index}`}>{match[1]}</a>);
    } else if (match[3] !== undefined) {
      // {{merge_field}} — swap in the recipient's value (or leave as-is if unknown).
      const key = match[3].toLowerCase();
      const value = (tokens as Record<string, string>)[key];
      parts.push(value === undefined
        ? match[0]
        : <mark className="merge-value" title={match[0]} key={`m-${index}`}>{value}</mark>);
    } else {
      // [manual placeholder] — keep the text, flag it red.
      parts.push(<mark className="manual-placeholder" title="Replace this before sending" key={`p-${index}`}>{match[0]}</mark>);
    }
    cursor = index + match[0].length;
  }

  parts.push(template.slice(cursor));
  return parts;
}

const C = { navy: "#11123E", navy2: "#485F92", orange: "#DD5434", gray: "#303333", muted: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B", gold: "#C9A227" };
const HEAD = "var(--font-head)";
const MONO = "var(--font-mono)";

type GmailNotice = { result?: string; error?: string };

type ProgressRecipient = { candidateName: string; maskedRecipient: string | null; status: "sent" | "failed" | "excluded" | "pending"; messageId?: string; failureReason?: string; exclusionReason?: string };
type CampaignProgress = { status: string; total: number; sent: number; failed: number; skipped: number; pending: number; done: boolean; recipients: ProgressRecipient[] };
type EnqueuedExclusion = { candidateName: string; maskedRecipient: string | null; exclusionReason?: string };
type EnqueueResponse = { success: true; campaignId: string; total: number; queued: number; invalid: number; replayed: boolean; excluded: EnqueuedExclusion[] };

const DEFAULT_GMAIL_STATUS: GmailConnectionStatus = {
  connected: false,
  connectedEmail: null,
  connectedAt: null,
};

function gmailNoticeText(notice: GmailNotice) {
  if (notice.result === "connected") return "Gmail connected successfully.";
  if (notice.result === "disconnected") return "Gmail disconnected.";
  const messages: Record<string, string> = {
    access_denied: "Google connection was canceled.",
    invalid_domain: "Use an @orrfellowship.org Google account.",
    invalid_state: "The connection request expired or could not be verified. Please try again.",
    missing_refresh_token: "Google did not return a reusable connection. Please reconnect and grant consent.",
    missing_scope: "The Gmail send permission was not granted.",
    authentication: "Your RTR session expired. Sign in and try again.",
    configuration: "Gmail connection is not configured on this environment.",
    disconnect_failed: "Gmail could not be disconnected. Please try again.",
    status_unavailable: "Gmail connection status is temporarily unavailable.",
  };
  return notice.error ? (messages[notice.error] ?? "Gmail could not be connected. Please try again.") : null;
}

// Client-safe view of an admin template (no storage paths cross the boundary).
export type OutreachTemplateView = {
  id: string; name: string; subject: string; body: string;
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
};

const fmtBytes = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export default function EmailCampaignsClient({
  gmailConnection = DEFAULT_GMAIL_STATUS,
  gmailNotice = {},
  gmailCampaignSendEnabled = false,
  audiences = [],
  recentCampaigns = [],
  templates = [],
  canFreeCompose = false,
  canCustomizeTemplate = false,
  sendDisabledReason,
}: {
  gmailConnection?: GmailConnectionStatus;
  gmailNotice?: GmailNotice;
  gmailCampaignSendEnabled?: boolean;
  audiences?: OutreachAudience[];
  recentCampaigns?: CampaignHistoryItem[];
  // Admin-curated templates. `canFreeCompose` controls whether a template is
  // required; `canCustomizeTemplate` lets template-required users edit the
  // selected template without granting template-management access.
  templates?: OutreachTemplateView[];
  canFreeCompose?: boolean;
  canCustomizeTemplate?: boolean;
  sendDisabledReason?: string;
}) {
  const [audienceKey, setAudienceKey] = useState<string>(audiences[0]?.key ?? "mine");
  const audience = audiences.find((a) => a.key === audienceKey) ?? audiences[0];
  const allRecipients = useMemo(() => audience?.recipients ?? [], [audience]);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [pointPersonFilter, setPointPersonFilter] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [campaignName, setCampaignName] = useState("Fall 2026 Outreach");
  // Non-admins start empty; picking a template fills the editable copy.
  const [subject, setSubject] = useState(canFreeCompose ? INITIAL_CAMPAIGN_SUBJECT : "");
  const [body, setBody] = useState(canFreeCompose ? INITIAL_CAMPAIGN_BODY : "");
  const [templateId, setTemplateId] = useState<string>("");
  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const templateRequired = !canFreeCompose;
  const contentLocked = templateRequired && !canCustomizeTemplate;
  const attachments = selectedTemplate?.attachments ?? [];

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) { setSubject(t.subject); setBody(t.body); }
    else if (templateRequired) { setSubject(""); setBody(""); }
  }
  const [activeField, setActiveField] = useState<"subject" | "body">("body");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [confirmationFingerprint, setConfirmationFingerprint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [campaignResult, setCampaignResult] = useState<DemoCampaignResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // Queue flow: after enqueue we hold the campaign id and poll for live progress
  // until the background drainer empties the queue.
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CampaignProgress | null>(null);
  const [recipientPage, setRecipientPage] = useState(0);
  const [recipientPageSize, setRecipientPageSize] = useState(50);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const isSearchOnlyAudience = audience?.key === "all";
  const hasRecipientSearch = search.trim().length > 0;
  const hasRecipientCriteria = hasRecipientSearch || pointPersonFilter.length > 0 || favOnly;

  // Distinct stages present in this audience, for the stage filter dropdown.
  const stageOptions = useMemo(
    () => Array.from(new Set(allRecipients.map((r) => r.stage).filter(Boolean))).sort(),
    [allRecipients],
  );
  const pointPersonOptions = useMemo(
    () => Array.from(new Set(allRecipients.map((r) => r.tokens.fellow_point_person).filter(Boolean))).sort(),
    [allRecipients],
  );
  // Recipients matching the current search + stage filter (drives the list and
  // the "select all filtered" action).
  const matchingRecipients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (audience?.key === "all" && !q && !pointPersonFilter && !favOnly) return [];
    return allRecipients.filter((r) => {
      if (favOnly && !r.isFavorite) return false;
      if (stageFilter && r.stage !== stageFilter) return false;
      if (pointPersonFilter && r.tokens.fellow_point_person !== pointPersonFilter) return false;
      if (!q) return true;
      return `${r.name} ${r.email ?? ""} ${r.school} ${r.tokens.fellow_point_person}`.toLowerCase().includes(q);
    });
  }, [allRecipients, audience?.key, search, stageFilter, pointPersonFilter, favOnly]);
  const filteredRecipients = matchingRecipients;
  const shownRecipients = filteredRecipients.slice(recipientPage * recipientPageSize, (recipientPage + 1) * recipientPageSize);
  useEffect(() => { setRecipientPage(0); }, [audienceKey, search, stageFilter, pointPersonFilter, favOnly, recipientPageSize]);

  const selectedRecipients = useMemo(
    () => allRecipients.filter((r) => selectedIds.has(r.id) && recipientEligible(r)),
    [allRecipients, selectedIds],
  );
  const currentPreview = selectedRecipients[Math.min(previewIndex, Math.max(0, selectedRecipients.length - 1))];
  const unsupportedVariables = [...findUnsupportedOutreachVariables(subject), ...findUnsupportedOutreachVariables(body)];
  // Single-bracket [placeholders] must be replaced before sending — they never
  // auto-fill. Blocks advancing past Compose (and sending) until they're gone.
  const manualPlaceholders = [...new Set([...findManualPlaceholders(subject), ...findManualPlaceholders(body)])];
  const selectedCandidateIds = Array.from(selectedIds);
  const campaignFingerprint = JSON.stringify({ audienceKey, campaignName, subject, body, selectedCandidateIds, templateId });
  const confirmed = confirmationFingerprint === campaignFingerprint;
  const composeReady = !!campaignName.trim()
    && !!subject.trim()
    && !!body.trim()
    && campaignName.length <= LIMITS.campaignName
    && subject.length <= LIMITS.subject
    && body.length <= LIMITS.body
    && unsupportedVariables.length === 0
    && manualPlaceholders.length === 0
    && (!templateRequired || !!selectedTemplate); // fellows must start from a template
  const canContinue = step === 0 ? selectedRecipients.length > 0 : step === 1 ? !!composeReady : true;
  const connectionNotice = gmailNoticeText(gmailNotice);
  // Reply/bounce tracking needs the gmail.metadata scope (added in Phase 6).
  // A connection made before that was requested is send-only until reconnect.
  const canTrackReplies = !!gmailConnection.grantedScopes?.includes("https://www.googleapis.com/auth/gmail.metadata");
  const canSend = gmailCampaignSendEnabled
    && gmailConnection.connected
    && selectedRecipients.length > 0
    && composeReady
    && confirmed
    && !sending;

  function goToStep(next: number) {
    if (next < 0 || next > 3 || next > maxReached) return;
    setStep(next);
  }

  function goNext() {
    if (!canContinue || step >= 3) return;
    const next = step + 1;
    setMaxReached((current) => Math.max(current, next));
    setStep(next);
    if (next === 2) setPreviewIndex(0);
  }

  function toggleCandidate(recipient: ComposerRecipient) {
    if (!recipientEligible(recipient)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(recipient.id)) next.delete(recipient.id);
      else next.add(recipient.id);
      return next;
    });
    setPreviewIndex(0);
  }

  // Bulk selection so a fellow never has to tick 200 boxes. "Select filtered"
  // respects the current search + stage filter; excluded (no email / DNC) rows
  // are skipped.
  function selectAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const r of filteredRecipients) if (recipientEligible(r)) next.add(r.id);
      return next;
    });
    setPreviewIndex(0);
  }
  function clearSelection() { setSelectedIds(new Set()); setPreviewIndex(0); }

  // Reset selection when switching audiences (ids don't carry across groups).
  function switchAudience(key: string) {
    setAudienceKey(key);
    setSelectedIds(new Set());
    setSearch(""); setStageFilter(""); setPointPersonFilter(""); setFavOnly(false); setPreviewIndex(0);
    setConfirmationFingerprint(null);
  }

  function insertVariable(variable: string) {
    const ref = activeField === "subject" ? subjectRef.current : bodyRef.current;
    const value = activeField === "subject" ? subject : body;
    const setValue = activeField === "subject" ? setSubject : setBody;
    const start = ref?.selectionStart ?? value.length;
    const end = ref?.selectionEnd ?? start;
    const nextValue = `${value.slice(0, start)}${variable}${value.slice(end)}`;
    setValue(nextValue);
    requestAnimationFrame(() => {
      ref?.focus();
      ref?.setSelectionRange(start + variable.length, start + variable.length);
    });
  }

  // Enqueue the campaign (returns immediately) and switch to the live progress
  // screen. The fellow can close the tab from here — the background drainer +
  // every-minute cron finish the batch regardless.
  async function handleCampaignSend() {
    if (!canSend || inFlight.current) return;
    const idempotencyKey = submission.current?.fingerprint === campaignFingerprint
      ? submission.current.key
      : crypto.randomUUID();
    submission.current = { fingerprint: campaignFingerprint, key: idempotencyKey };
    inFlight.current = true;
    setSending(true);
    setSendError(null);
    try {
      const endpoint = audience?.endpoint === "team" ? "/api/outreach/team" : "/api/outreach/candidates";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignName,
          subject,
          body,
          selectedIds: selectedCandidateIds,
          idempotencyKey,
          templateId: templateId || null,
        }),
      });
      const payload = await response.json() as EnqueueResponse | { success: false; error?: { message?: string } };
      if (!response.ok || payload.success !== true) {
        setSendError("error" in payload && payload.error?.message ? payload.error.message : "The campaign could not be queued.");
        return;
      }
      setConfirmationFingerprint(null);
      setProgress({ status: "queued", total: payload.total, sent: 0, failed: 0, skipped: 0, pending: payload.total, done: false, recipients: [] });
      setCampaignId(payload.campaignId); // starts polling
    } catch {
      setSendError("The campaign could not be queued.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  // Poll live progress while a campaign is draining; resolve to the Sent screen
  // once the queue is empty.
  useEffect(() => {
    if (!campaignId || campaignResult) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/google/campaign-status?id=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
        const data = await res.json() as CampaignProgress & { success: boolean };
        if (!active || !data.success) return;
        setProgress(data);
        if (data.done) {
          setCampaignResult({
            success: true,
            attempted: data.total,
            sent: data.sent,
            failed: data.failed,
            excluded: data.skipped,
            recipients: data.recipients.map((r, i) => ({ candidateId: `q-${i}`, candidateName: r.candidateName, maskedRecipient: r.maskedRecipient, status: (r.status === "pending" ? "failed" : r.status) as "sent" | "failed" | "excluded", messageId: r.messageId, failureReason: r.status === "pending" ? "Final delivery status is unavailable" : r.failureReason, exclusionReason: r.exclusionReason })),
          });
          setCampaignId(null);
        }
      } catch { /* transient — next tick retries */ }
    };
    void tick();
    const timer = setInterval(tick, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [campaignId, campaignResult]);

  // Clear the result and return to a fresh wizard for another campaign. The
  // composed template (name/subject/body) is kept so a follow-up send can reuse
  // it; only the audience, confirmation, and result are reset.
  function startAnotherCampaign() {
    setCampaignResult(null);
    setCampaignId(null);
    setProgress(null);
    setSelectedIds(new Set());
    setConfirmationFingerprint(null);
    setPreviewIndex(0);
    setStep(0);
    setMaxReached(0);
    submission.current = null;
  }

  // Re-open a campaign from history: seed progress from its saved counts, then
  // let the poller resolve it to the live "Sending…" or final "Sent" view. This
  // is how you click away and come back to check on a campaign later.
  function viewCampaign(item: CampaignHistoryItem) {
    setCampaignResult(null);
    setProgress({ status: item.status, total: item.total, sent: item.sent, failed: item.failed, skipped: item.skipped, pending: item.pending, done: item.pending === 0, recipients: [] });
    setCampaignId(item.id);
  }

  // A finished send takes over the screen with a clear confirmation; while it's
  // still draining, the live "Sending…" screen does. Either way the wizard is
  // hidden so the sender isn't left wondering whether it worked.
  const showSent = campaignResult?.success === true;
  const showSending = !showSent && !!campaignId;

  return (
    <div className="email-campaigns-page">
      <style>{styles}</style>

      <div className="campaign-heading">
        <div>
          <div className="heading-line">
            <h1>Email Campaigns</h1>
          </div>
          <p>Send personalized outreach to your candidates from your own Gmail.</p>
        </div>
        {gmailConnection.connected && gmailConnection.connectedEmail && (
          <div className="previewing-note"><UserRoundCheck size={17} /> <span>Sending as: <strong>{gmailConnection.connectedEmail}</strong></span></div>
        )}
      </div>

      {connectionNotice && (
        <div className={`gmail-notice ${gmailNotice.error ? "error" : "success"}`} role="status">
          {gmailNotice.error ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}
          <span>{connectionNotice}</span>
        </div>
      )}

      <section className="gmail-connection-card" aria-label="Gmail connection">
        <div className={`gmail-mark ${gmailConnection.connected ? "connected" : ""}`}>
          {gmailConnection.connected ? <CheckCircle2 size={21} /> : <Mail size={21} />}
        </div>
        <div className="gmail-connection-copy">
          <div className="gmail-connection-title">
            <h2>Orr Fellowship Gmail</h2>
            <StatusPill tone={gmailConnection.connected ? "good" : "warning"}>
              {gmailConnection.connected ? "Connected" : "Not connected"}
            </StatusPill>
          </div>
          {gmailConnection.connected ? (
            <p><strong>{gmailConnection.connectedEmail}</strong> is connected — outreach sends from your own Gmail.
              {!canTrackReplies && <span className="reconnect-hint"> Reconnect to enable automatic reply &amp; bounce tracking.</span>}
            </p>
          ) : (
            <p>Connect your Orr Fellowship Gmail to send outreach from your own account.</p>
          )}
        </div>
        {gmailConnection.connected ? (
          !canTrackReplies ? (
            <a className="gmail-action" href="/api/google/connect"><Link2 size={15} /> Reconnect</a>
          ) : (
            <form method="post" action="/api/google/disconnect">
              <button type="submit" className="gmail-action secondary"><Unplug size={15} /> Disconnect Gmail</button>
            </form>
          )
        ) : (
          <a className="gmail-action" href="/api/google/connect"><Link2 size={15} /> Connect Gmail</a>
        )}
      </section>

      {showSent && campaignResult && (
        <section className="sent-screen" role="status" aria-live="polite">
          <div className="sent-hero">
            <div className={`sent-badge ${campaignResult.failed > 0 ? "partial" : "good"}`}>
              <CheckCircle2 size={34} />
            </div>
            <h2>{campaignResult.failed > 0 ? "Campaign sent — with some issues" : "Campaign sent"}</h2>
            <p>
              {campaignResult.sent} of {campaignResult.attempted}{" "}
              {campaignResult.attempted === 1 ? "message was" : "messages were"} sent
              {gmailConnection.connectedEmail ? <> from <strong>{gmailConnection.connectedEmail}</strong></> : null}.
              {campaignResult.failed > 0 && <> {campaignResult.failed} could not be delivered — see the list below.</>}
            </p>
          </div>

          <div className="review-card">
            <div className="result-metrics" aria-label="Campaign result summary">
              <ResultMetric label="Sent" value={campaignResult.sent} tone="good" />
              <ResultMetric label="Failed" value={campaignResult.failed} tone="warning" />
              <ResultMetric label="Excluded" value={campaignResult.excluded} />
              <ResultMetric label="Attempted" value={campaignResult.attempted} />
            </div>
            <div className="campaign-results">
              {campaignResult.recipients.map((recipient) => (
                <div key={recipient.candidateId}>
                  <div><strong>{recipient.candidateName}</strong><small>{recipient.maskedRecipient ?? "No recipient address"}</small></div>
                  <div className="result-status">
                    <StatusPill tone={recipient.status === "sent" ? "good" : "warning"}>{recipient.status}</StatusPill>
                    {recipient.messageId && <small>Gmail ID: <code>{recipient.messageId}</code></small>}
                    {recipient.failureReason && <small>{recipient.failureReason}</small>}
                    {recipient.exclusionReason && <small>{recipient.exclusionReason}</small>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sent-actions">
            <button type="button" className="primary-action" onClick={startAnotherCampaign}><Mail size={16} /> Start another campaign</button>
          </div>
        </section>
      )}

      {showSending && progress && (() => {
        const done = progress.sent + progress.failed + progress.skipped;
        const pct = progress.total > 0 ? Math.round((done / progress.total) * 100) : 0;
        return (
          <section className="sent-screen" role="status" aria-live="polite">
            <div className="sent-hero">
              <div className="sent-badge sending"><Send size={30} /></div>
              <h2>Sending your campaign…</h2>
              <p>
                {progress.sent} of {progress.total} sent{progress.failed > 0 ? ` · ${progress.failed} failed` : ""}{progress.pending > 0 ? ` · ${sendEtaLabel(progress.pending)} remaining` : ""}.
                <br /><strong>You can close this tab</strong> — sending continues in the background and finishes on its own.
              </p>
            </div>
            <div className="send-progress" aria-label={`${pct}% complete`}>
              <div className="send-progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="review-card">
              <div className="result-metrics">
                <ResultMetric label="Sent" value={progress.sent} tone="good" />
                <ResultMetric label="Failed" value={progress.failed} tone="warning" />
                <ResultMetric label="Remaining" value={progress.pending} />
                <ResultMetric label="Total" value={progress.total} />
              </div>
            </div>
          </section>
        );
      })()}

      {!showSent && !showSending && (<>
      {canFreeCompose && step === 0 && <OutreachTemplateManager templates={templates} />}
      <div className="stepper" aria-label="Campaign steps">
        {CAMPAIGN_STEPS.map((label, index) => {
          const accessible = index <= maxReached;
          const complete = index < step;
          return (
            <button key={label} type="button" className={`step ${index === step ? "active" : ""} ${complete ? "complete" : ""}`} disabled={!accessible} onClick={() => goToStep(index)} aria-current={index === step ? "step" : undefined}>
              <span className="step-number">{complete ? <Check size={15} /> : index + 1}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {step === 0 && recentCampaigns.length > 0 && (
        <section className="history-card">
          <div className="history-head"><History size={16} /> Your recent campaigns <small>click one to check on it</small></div>
          <div className="history-list">
            {recentCampaigns.map((c) => {
              const inProgress = c.status === "queued" || c.status === "sending" || c.pending > 0;
              return (
                <button type="button" key={c.id} className="history-row" onClick={() => viewCampaign(c)}>
                  <div className="history-main">
                    <strong>{c.name}</strong>
                    <small>{new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {c.total} recipient{c.total === 1 ? "" : "s"}</small>
                  </div>
                  <div className="history-stats">
                    {inProgress
                      ? <StatusPill tone="warning">Sending · {c.sent}/{c.total}</StatusPill>
                      : <StatusPill tone={c.failed > 0 ? "warning" : "good"}>{c.sent} sent{c.failed > 0 ? ` · ${c.failed} failed` : ""}</StatusPill>}
                    {c.replied > 0 && <span className="history-tag good">📬 {c.replied}</span>}
                    {c.bounced > 0 && <span className="history-tag warn">✉️ {c.bounced}</span>}
                  </div>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {step === 0 && (
        <section>
          <div className="section-title">
            <div><h2>Choose recipients</h2><p>{audience?.description ?? "Pick who receives this campaign."}</p></div>
            <div className="recipient-title-actions">
              <span className="scope-pill"><UsersRound size={15} /> {selectedRecipients.length} selected</span>
              <button type="button" className="next-button" disabled={!canContinue} onClick={goNext}>Continue to Compose <ArrowRight size={16} /></button>
            </div>
          </div>

          {audiences.length > 1 && (
            <div className="audience-switch">
              {audiences.map((a) => (
                <button type="button" key={a.key} className={`aud-tab ${a.key === audienceKey ? "active" : ""}`} onClick={() => switchAudience(a.key)}>
                  {a.label} <small>{a.recipients.length}</small>
                </button>
              ))}
            </div>
          )}

          <div className="audience-card">
            <div className="audience-toolbar">
              <input className="aud-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isSearchOnlyAudience ? "Search all candidates by name, email, or school…" : "Search name, email, school…"} />
              {isSearchOnlyAudience && pointPersonOptions.length > 0 && (
                <select value={pointPersonFilter} onChange={(e) => setPointPersonFilter(e.target.value)} aria-label="Filter by point person">
                  <option value="">Choose point person</option>
                  {pointPersonOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
              {!isSearchOnlyAudience && stageOptions.length > 0 && (
                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
                  <option value="">All stages</option>
                  {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              {audience?.endpoint === "candidates" && (
                <button type="button" className={favOnly ? "aud-action" : "aud-action ghost"} onClick={() => setFavOnly((v) => !v)} title="Only candidates you've favorited"
                  style={favOnly ? { borderColor: "#C9A227", background: "#FBF3D6", color: "#8A6D0E" } : undefined}>
                  {favOnly ? "★ Favorites" : "☆ Favorites"}
                </button>
              )}
              {(!isSearchOnlyAudience || hasRecipientCriteria) && filteredRecipients.length > 0 && (
                <button type="button" className="aud-action" onClick={selectAllFiltered}>Select {isSearchOnlyAudience ? "matches" : search || stageFilter ? "filtered" : "all"} ({filteredRecipients.filter(recipientEligible).length})</button>
              )}
              <button type="button" className="aud-action ghost" onClick={clearSelection} disabled={selectedIds.size === 0}>Clear</button>
            </div>
            <div className="audience-summary">
              {isSearchOnlyAudience && !hasRecipientCriteria ? (
                <div><strong>{selectedRecipients.length}</strong> selected · Search {allRecipients.length} contacts or choose a point person</div>
              ) : (
                <>
                  <div><strong>{selectedRecipients.length}</strong> selected · {matchingRecipients.length} {matchingRecipients.length === 1 ? "match" : "matches"}</div>
                  <span>{filteredRecipients.filter((r) => !recipientEligible(r)).length} not emailable</span>
                </>
              )}
            </div>
            <div className="candidate-table-wrap">
              {isSearchOnlyAudience && !hasRecipientCriteria ? (
                <div className="candidate-empty search-prompt">Search by name, email, or school, or choose a point person to view their contacts.</div>
              ) : (<>
                <div className="candidate-table candidate-head">
                  <div>Include</div><div>Recipient</div><div>School</div><div>Stage</div><div>Email status</div><div>Class</div>
                </div>
                {filteredRecipients.length === 0 && <div className="candidate-empty">No recipients match — {allRecipients.length === 0 ? "you have no candidates in this audience yet." : "adjust your search or filter."}</div>}
                <PaginationControls page={recipientPage} pageSize={recipientPageSize} total={filteredRecipients.length} onPageChange={setRecipientPage} onPageSizeChange={setRecipientPageSize} />
                {shownRecipients.map((r) => {
                  const eligible = recipientEligible(r);
                  const included = selectedIds.has(r.id) && eligible;
                  const reason = exclusionReasonFor(r);
                  return (
                    <div className={`candidate-table candidate-row ${eligible ? "" : "excluded"}`} key={r.id}>
                      <div><input type="checkbox" aria-label={`Include ${fullName(r)}`} checked={selectedIds.has(r.id)} disabled={!eligible} onChange={() => toggleCandidate(r)} /></div>
                      <div><strong><ContactPopover name={fullName(r)} email={r.email} /></strong><small>{r.email ?? "No email on file"}</small></div>
                      <div>{r.school || "—"}</div>
                      <div>{r.stage ? <StagePill stage={r.stage} /> : <span className="muted">—</span>}</div>
                      <div>{reason ? <StatusPill tone="warning">{reason}</StatusPill> : included ? <StatusPill tone="good">Included</StatusPill> : <StatusPill>Not selected</StatusPill>}</div>
                      <div className={r.classYear ? "" : "muted"}>{r.classYear || "—"}</div>
                    </div>
                  );
                })}
                <PaginationControls page={recipientPage} pageSize={recipientPageSize} total={filteredRecipients.length} onPageChange={setRecipientPage} onPageSizeChange={setRecipientPageSize} />
              </>)}
            </div>
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <div className="section-title"><div><h2>Compose your email</h2><p>{templateRequired ? "Start with a template from your admins, then customize it for this campaign." : "Write one template — it's personalized for each recipient."}</p></div></div>
          <div className="compose-layout">
            <div className="form-card">
              <Field label="Campaign name" hint="Only visible to your recruiting team">
                <input value={campaignName} maxLength={LIMITS.campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Campaign name" />
              </Field>
              <Field label="Template" hint={templateRequired ? "Required starting point from your admins" : "Optional starting point — its attachments ride along"}>
                <select value={templateId} onChange={(event) => pickTemplate(event.target.value)}>
                  <option value="">{templateRequired ? "Choose a template…" : "None — write from scratch"}</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.attachments.length ? ` (${t.attachments.length} 📎)` : ""}</option>)}
                </select>
              </Field>
              {templateRequired && templates.length === 0 && (
                <div className="compose-warn"><CircleAlert size={15} /> No templates are available yet — ask an admin to create one in Email Campaigns.</div>
              )}
              <Field label="Subject line">
                <input ref={subjectRef} value={subject} maxLength={LIMITS.subject} readOnly={contentLocked} onFocus={() => setActiveField("subject")} onChange={(event) => setSubject(event.target.value)}
                  onDragOver={contentLocked ? undefined : allowMergeFieldDrop} onDrop={contentLocked ? undefined : (e) => insertMergeFieldOnDrop(e, subject, setSubject)}
                  placeholder={templateRequired ? "Pick a template above" : "Email subject"} />
              </Field>
              <Field label="Email body">
                <textarea ref={bodyRef} value={body} maxLength={LIMITS.body} readOnly={contentLocked} onFocus={() => setActiveField("body")} onChange={(event) => setBody(event.target.value)}
                  onDragOver={contentLocked ? undefined : allowMergeFieldDrop} onDrop={contentLocked ? undefined : (e) => insertMergeFieldOnDrop(e, body, setBody)}
                  rows={14} placeholder={templateRequired ? "The template's message will appear here." : undefined} />
              </Field>
              {attachments.length > 0 && (
                <div className="attachment-chips">
                  {attachments.map((a) => <span className="attachment-chip" key={a.id}>📎 {a.fileName} <small>{fmtBytes(a.sizeBytes)}</small></span>)}
                </div>
              )}
              {unsupportedVariables.length > 0 && <div className="compose-warn"><CircleAlert size={15} /> Unknown merge field(s): {unsupportedVariables.join(", ")}. Fix before continuing.</div>}
              {manualPlaceholders.length > 0 && (
                <div className="compose-warn placeholder-warn">
                  <CircleAlert size={15} />
                  <div className="compose-warn-body">
                    <strong>{manualPlaceholders.length} template note{manualPlaceholders.length === 1 ? "" : "s"} {contentLocked ? "need attention" : "need your edits"}</strong>
                    <span>
                      {contentLocked
                        ? "Ask an admin to replace the bracketed text before this template is used."
                        : "Replace the bracketed text in the subject or body before previewing. It won’t auto-fill."}
                    </span>
                    <details>
                      <summary>View {manualPlaceholders.length === 1 ? "note" : "notes"}</summary>
                      <div className="placeholder-list">
                        {manualPlaceholders.map((placeholder) => <code key={placeholder}>{placeholder}</code>)}
                      </div>
                    </details>
                  </div>
                </div>
              )}
            </div>
            <aside className="variables-card">
              <div className="variables-heading"><span>Merge variables</span><small>{contentLocked ? "Filled automatically" : `Insert into ${activeField}`}</small></div>
              <p>{contentLocked ? "These placeholders in the template are replaced with each recipient's details." : "Personalize the template with each recipient's details."}</p>
              <MergeFieldPalette disabled={contentLocked} onInsert={insertVariable} />
              {!contentLocked && <div className="tip"><CircleAlert size={15} /><span>Drag a field into the subject or body, or click it to insert at the cursor in the last-focused field.</span></div>}
            </aside>
          </div>
        </section>
      )}

      {step === 2 && currentPreview && (
        <section>
          <div className="section-title preview-title">
            <div><h2>Preview personalized emails</h2><p>Switch recipients to see how the same template adapts for each candidate.</p></div>
            <div className="recipient-switcher">
              <button type="button" aria-label="Previous recipient" onClick={() => setPreviewIndex((index) => (index - 1 + selectedRecipients.length) % selectedRecipients.length)}><ChevronLeft size={18} /></button>
              <select value={currentPreview.id} onChange={(event) => setPreviewIndex(selectedRecipients.findIndex((r) => r.id === event.target.value))}>
                {selectedRecipients.map((r) => <option key={r.id} value={r.id}>{fullName(r)}</option>)}
              </select>
              <button type="button" aria-label="Next recipient" onClick={() => setPreviewIndex((index) => (index + 1) % selectedRecipients.length)}><ChevronRight size={18} /></button>
            </div>
          </div>
          <div className="preview-layout">
            <div className="preview-context">
              <span className="preview-count">Recipient {previewIndex + 1} of {selectedRecipients.length}</span>
              <h3>{fullName(currentPreview)}</h3>
              <p>{currentPreview.email}</p>
              <dl>
                <div><dt>School</dt><dd>{currentPreview.school || "—"}</dd></div>
                <div><dt>Stage</dt><dd>{currentPreview.stage || "—"}</dd></div>
                <div><dt>Class</dt><dd>{currentPreview.classYear || "—"}</dd></div>
              </dl>
              <div className="personalization-note"><CheckCircle2 size={16} /><span>Highlighted values change for each recipient.</span></div>
            </div>
            <article className="email-preview">
              <div className="email-toolbar"><span></span><span></span><span></span><div>Email preview</div></div>
              <div className="email-meta">
                <div><span>From</span><strong>{gmailConnection.connectedEmail ?? "Gmail not connected"}</strong></div>
                <div><span>To</span><strong>{fullName(currentPreview)} &lt;{currentPreview.email}&gt;</strong></div>
                <div><span>Subject</span><strong>{renderHighlightedOutreachTemplate(subject, currentPreview.tokens)}</strong></div>
              </div>
              <div className="email-body">{renderHighlightedOutreachTemplate(body, currentPreview.tokens)}</div>
              {attachments.length > 0 && (
                <div className="attachment-chips email-attachments">
                  {attachments.map((a) => <span className="attachment-chip" key={a.id}>📎 {a.fileName} <small>{fmtBytes(a.sizeBytes)}</small></span>)}
                </div>
              )}
              <div className="preview-legend">
                <span className="lg"><mark className="merge-value">Aa</mark> auto-filled for each recipient</span>
                {/\[[^[\]\n]+\]/.test(`${subject}\n${body}`) && (
                  <span className="lg"><mark className="manual-placeholder">[ ]</mark> replace these before sending</span>
                )}
              </div>
            </article>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <div className="section-title">
            <div><h2>Review campaign</h2><p>Confirm the recipients and content before sending real Gmail messages.</p></div>
            <StatusPill tone="good">{audience?.label ?? "Recipients"}</StatusPill>
          </div>
          <div className="review-grid">
            <div className="review-main">
              <ReviewCard title="Campaign details">
                <div className="review-details">
                  <ReviewValue label="Campaign name" value={campaignName} />
                  <ReviewValue label="Recipients" value={`${selectedRecipients.length} personalized message${selectedRecipients.length === 1 ? "" : "s"}`} />
                  <ReviewValue label="Sending from" value={gmailConnection.connectedEmail ?? "Gmail not connected"} />
                  <ReviewValue label="Audience" value={audience?.label ?? "—"} />
                  {selectedTemplate && <ReviewValue label="Template" value={selectedTemplate.name} />}
                  <ReviewValue label="Attachments" value={attachments.length ? attachments.map((a) => a.fileName).join(", ") : "None"} />
                  <ReviewValue label="Subject template" value={subject} wide />
                </div>
              </ReviewCard>
              <ReviewCard title={`Recipients (${selectedRecipients.length})`}>
                <div className="recipient-list">
                  {selectedRecipients.slice(0, 200).map((r) => <div key={r.id}><span className="avatar">{fullName(r).slice(0, 1).toUpperCase()}</span><div><strong>{fullName(r)}</strong><small>{r.email}{r.school ? ` · ${r.school}` : ""}</small></div><CheckCircle2 size={17} /></div>)}
                  {selectedRecipients.length > 200 && <div className="muted" style={{ padding: "8px 0", fontSize: 12 }}>…and {selectedRecipients.length - 200} more</div>}
                </div>
              </ReviewCard>
            </div>
            <aside className="send-card">
              <div className="send-icon"><Send size={22} /></div>
              <h3>{sendDisabledReason ? "Preview only" : "Send with Gmail"}</h3>
              {sendDisabledReason ? (
                <p>{sendDisabledReason}</p>
              ) : gmailConnection.connected ? (
                <p><strong>{gmailConnection.connectedEmail}</strong> will send {selectedRecipients.length} personalized {selectedRecipients.length === 1 ? "message" : "messages"} — {sendEtaLabel(selectedRecipients.length)} to finish.</p>
              ) : (
                <p>Connect your Gmail before sending.</p>
              )}
              {sendDisabledReason ? (
                <div className="send-warning"><CircleAlert size={16} /><span>No messages can be sent from this workspace yet. Use Preview to review each candidate&apos;s personalized email.</span></div>
              ) : (
                <>
                  <div className="send-warning"><CircleAlert size={16} /><span>Do-Not-Contact and over-quota recipients are skipped automatically. There&apos;s no unsend — this goes out from your own inbox.</span></div>
                  <label className="campaign-confirmation">
                    <input type="checkbox" checked={confirmed} disabled={!gmailConnection.connected || sending} onChange={(event) => setConfirmationFingerprint(event.target.checked ? campaignFingerprint : null)} />
                    <span>I&apos;m ready to send {selectedRecipients.length} real emails through {gmailConnection.connectedEmail ?? "my connected Gmail"}.</span>
                  </label>
                </>
              )}
              <button type="button" className="primary-action" disabled={!canSend} onClick={handleCampaignSend}><Send size={16} /> {sendDisabledReason ? "Sending not enabled" : sending ? "Queuing…" : "Send with Gmail"}</button>
              {!sendDisabledReason && !gmailConnection.connected && <a className="gmail-action review-connect" href="/api/google/connect"><Link2 size={15} /> Connect Gmail</a>}
              {sendError && <div className="campaign-send-error" role="alert"><CircleAlert size={15} /> {sendError}</div>}
            </aside>
          </div>
        </section>
      )}

      <div className="wizard-footer">
        <div>{step === 0 && selectedRecipients.length === 0 ? <span className="validation-note">Select at least one recipient.</span> : step === 1 && !composeReady ? <span className="validation-note">{templateRequired && !selectedTemplate ? "Pick a template to continue." : manualPlaceholders.length > 0 ? "Replace every bracketed template note before continuing." : "Complete all fields to continue."}</span> : null}</div>
        <div className="footer-actions">
          {step > 0 && <button type="button" className="back-button" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={16} /> Back</button>}
          {step < 3 && <button type="button" className="next-button" disabled={!canContinue} onClick={goNext}>Continue to {CAMPAIGN_STEPS[step + 1]} <ArrowRight size={16} /></button>}
        </div>
      </div>
      </>)}

    </div>
  );
}


function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

// Draggable merge-field chips. Each chip can be dragged into any field wired
// with allowMergeFieldDrop/insertMergeFieldOnDrop, or clicked to insert at the
// last-focused field's cursor (onInsert). Shared by the composer and the admin
// template editor so both stay in sync as the token set grows.
function MergeFieldPalette({ disabled, onInsert }: { disabled?: boolean; onInsert: (token: string) => void }) {
  return (
    <div className="variable-list">
      {OUTREACH_MERGE_VARIABLES.map((variable) => (
        <button
          type="button"
          key={variable}
          disabled={disabled}
          draggable={!disabled}
          onDragStart={(e) => {
            e.dataTransfer.setData(MERGE_FIELD_DND, variable);
            e.dataTransfer.setData("text/plain", variable);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onInsert(variable)}
          title={`${MERGE_FIELD_LABELS[variable] ?? variable} — drag into a field or click to insert`}
        >
          {variable}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warning" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function StagePill({ stage }: { stage: string }) {
  const tone = stage === "Finalist" ? C.gold : stage === "Applied" ? C.orange : stage === "Contacted" ? C.navy2 : C.muted;
  return <span className="stage-pill" style={{ "--stage-tone": tone } as CSSProperties}>{stage}</span>;
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="review-card"><h3>{title}</h3>{children}</div>;
}

function ReviewValue({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "wide" : ""}><span>{label}</span><strong>{value}</strong></div>;
}

function ResultMetric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "warning" }) {
  return <div className={tone}><span>{label}</span><strong>{value}</strong></div>;
}

const styles = `
  .email-campaigns-page { max-width: 1240px; margin: 0 auto; padding: 30px 28px 80px; color: ${C.gray}; }
  .sent-screen { max-width: 640px; margin: 8px auto 0; display: flex; flex-direction: column; gap: 20px; }
  .sent-hero { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .sent-badge { display: grid; place-items: center; width: 68px; height: 68px; border-radius: 20px; }
  .sent-badge.good { color: ${C.good}; background: #E6F3EC; }
  .sent-badge.partial { color: ${C.orange}; background: #FBE7DF; }
  .sent-badge.sending { color: ${C.navy2}; background: #EAF0FA; }
  .send-progress { height: 10px; border-radius: 99px; background: ${C.line}; overflow: hidden; }
  .send-progress-bar { height: 100%; background: ${C.good}; border-radius: 99px; transition: width .4s ease; }
  .test-recipients-banner { border: 1px solid ${C.navy2}; background: #EAF0FA; border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; }
  .trb-head { display: flex; align-items: center; gap: 8px; font-family: ${HEAD}; font-weight: 700; font-size: 14px; color: ${C.navy}; margin-bottom: 10px; }
  .trb-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px 16px; }
  .trb-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: ${C.gray}; padding: 4px 0; }
  .trb-num { flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; background: #fff; border: 1px solid ${C.line}; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: ${C.navy2}; }
  .trb-addr { flex: 1; min-width: 0; overflow-wrap: anywhere; font-family: ${MONO}; font-size: 12px; }
  .trb-note { margin-top: 10px; font-size: 12px; color: ${C.muted}; line-height: 1.5; }
  .sent-hero h2 { color: ${C.navy}; font-family: ${HEAD}; font-size: 25px; margin: 4px 0 0; }
  .sent-hero p { color: ${C.muted}; font-size: 13.5px; line-height: 1.55; margin: 0; max-width: 480px; }
  .sent-actions { display: flex; justify-content: center; }
  .sent-actions .primary-action { width: auto; padding: 11px 22px; }
  .campaign-heading, .section-title, .heading-line, .previewing-note, .wizard-footer, .footer-actions, .recipient-switcher, .recipient-title-actions { display: flex; align-items: center; }
  .campaign-heading { justify-content: space-between; gap: 24px; margin-bottom: 22px; }
  .gmail-notice { display: flex; align-items: center; gap: 8px; margin: -8px 0 16px; padding: 10px 13px; border-radius: 10px; font-size: 12.5px; font-weight: 600; }
  .gmail-notice.success { color: ${C.good}; background: #E8F5EE; border: 1px solid #C7E7D6; } .gmail-notice.error { color: ${C.orange}; background: #FBE7DF; border: 1px solid #F1C2B4; }
  .gmail-connection-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; margin-bottom: 18px; padding: 15px 16px; background: #fff; border: 1px solid ${C.line}; border-radius: 14px; box-shadow: 0 5px 18px rgba(17,18,62,.04); }
  .gmail-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; color: ${C.orange}; background: #FBE7DF; } .gmail-mark.connected { color: ${C.good}; background: #E8F5EE; }
  .gmail-connection-copy { min-width: 0; } .gmail-connection-title { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; } .gmail-connection-title h2 { margin: 0; color: ${C.navy}; font-size: 16px; } .gmail-connection-copy p { margin: 4px 0 0; color: ${C.muted}; font-size: 12px; line-height: 1.5; } .gmail-connection-copy p strong { color: ${C.gray}; }
  .gmail-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid ${C.navy}; border-radius: 9px; padding: 9px 12px; color: #fff; background: ${C.navy}; font-size: 12px; font-weight: 700; text-decoration: none; white-space: nowrap; cursor: pointer; } .gmail-action.secondary { color: ${C.navy}; background: #fff; border-color: ${C.line}; }
  .heading-line { gap: 12px; flex-wrap: wrap; }
  .heading-line h1 { font-size: 30px; color: ${C.navy}; margin: 0; }
  .campaign-heading p, .section-title p { color: ${C.muted}; margin: 5px 0 0; font-size: 14px; }
  .demo-badge { display: inline-flex; align-items: center; width: fit-content; font: 700 10.5px ${MONO}; text-transform: uppercase; letter-spacing: .7px; color: ${C.orange}; background: #FBE7DF; border: 1px solid #F1C2B4; padding: 4px 8px; border-radius: 999px; }
  .previewing-note { gap: 8px; flex: 0 0 auto; color: ${C.navy2}; background: #fff; border: 1px solid ${C.line}; border-radius: 11px; padding: 10px 13px; font-size: 12.5px; }
  .stepper { display: grid; grid-template-columns: repeat(4, 1fr); background: #fff; border: 1px solid ${C.line}; border-radius: 14px; padding: 8px; margin-bottom: 24px; box-shadow: 0 5px 18px rgba(17,18,62,.04); }
  .step { position: relative; border: 0; background: transparent; color: #9296A3; display: flex; align-items: center; justify-content: center; gap: 9px; padding: 10px 8px; font: 700 13px var(--font-body); border-radius: 9px; cursor: pointer; }
  .step:disabled { cursor: default; } .step.active { background: #FBE7DF; color: ${C.navy}; } .step.complete { color: ${C.good}; }
  .step-number { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid #D8DAE2; border-radius: 50%; font: 700 11px ${MONO}; }
  .step.active .step-number { color: #fff; background: ${C.orange}; border-color: ${C.orange}; } .step.complete .step-number { color: #fff; background: ${C.good}; border-color: ${C.good}; }
  .section-title { justify-content: space-between; gap: 18px; margin-bottom: 18px; } .section-title h2 { font-size: 23px; color: ${C.navy}; margin: 0; }
  .recipient-title-actions { gap: 9px; flex-wrap: wrap; justify-content: flex-end; }
  .scope-pill { display: inline-flex; align-items: center; gap: 7px; color: ${C.navy2}; background: #EEF2F8; border-radius: 999px; padding: 7px 11px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .metrics-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
  .metric { background: #fff; border: 1px solid ${C.line}; border-radius: 12px; padding: 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .metric>div { display: flex; flex-direction: column; gap: 4px; min-width: 0; } .metric div span { color: ${C.muted}; font-size: 11.5px; white-space: nowrap; } .metric strong { color: ${C.navy}; font: 700 24px ${HEAD}; }
  .metric-icon { display: grid; place-items: center; width: 34px; height: 34px; color: ${C.navy2}; background: #EEF2F8; border-radius: 9px; flex: 0 0 auto; } .metric.good .metric-icon { color: ${C.good}; background: #E8F5EE; } .metric.warning .metric-icon { color: ${C.orange}; background: #FBE7DF; }
  .audience-card, .form-card, .variables-card, .preview-context, .email-preview, .review-card, .send-card { background: #fff; border: 1px solid ${C.line}; border-radius: 14px; }
  .audience-card { overflow: hidden; } .audience-summary { display: flex; justify-content: space-between; align-items: center; padding: 13px 18px; border-bottom: 1px solid ${C.line}; background: #FAFBFE; font-size: 13px; } .audience-summary strong { color: ${C.navy}; } .audience-summary span { color: ${C.muted}; }
  .audience-switch { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .aud-tab { display: inline-flex; align-items: center; gap: 6px; border: 1px solid ${C.line}; background: #fff; color: ${C.gray}; font-weight: 700; font-size: 13px; padding: 8px 14px; border-radius: 10px; cursor: pointer; }
  .aud-tab small { color: ${C.muted}; font-weight: 600; }
  .aud-tab.active { border-color: ${C.navy}; background: ${C.navy}; color: #fff; } .aud-tab.active small { color: rgba(255,255,255,.7); }
  .audience-toolbar { display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid ${C.line}; flex-wrap: wrap; }
  .aud-search { flex: 1; min-width: 180px; padding: 8px 12px; border: 1px solid ${C.line}; border-radius: 9px; font-size: 13px; }
  .audience-toolbar select { padding: 8px 12px; border: 1px solid ${C.line}; border-radius: 9px; font-size: 13px; background: #fff; color: ${C.gray}; }
  .aud-action { border: 1px solid ${C.navy2}; background: #fff; color: ${C.navy2}; font-weight: 700; font-size: 12.5px; padding: 8px 13px; border-radius: 9px; cursor: pointer; white-space: nowrap; }
  .aud-action.ghost { border-color: ${C.line}; color: ${C.muted}; } .aud-action:disabled { opacity: .45; cursor: not-allowed; }
  .candidate-empty { padding: 26px 18px; text-align: center; color: ${C.muted}; font-size: 13px; }
  .compose-warn { display: flex; align-items: flex-start; gap: 9px; background: #FBE7DF; border: 1px solid ${C.orange}; color: #8A3A1E; border-radius: 10px; padding: 11px 13px; font-size: 12.5px; margin-top: 4px; }
  .compose-warn>svg { flex: 0 0 auto; margin-top: 2px; }
  .compose-warn.placeholder-warn { background: #FDE7E4; border-color: #B42318; color: #7A1D12; }
  .compose-warn-body { min-width: 0; display: grid; gap: 3px; line-height: 1.4; }
  .compose-warn-body strong { color: #7A1D12; font-size: 12.5px; }
  .compose-warn-body>span { color: #9B3A2C; font-size: 11.5px; }
  .compose-warn-body details { margin-top: 3px; }
  .compose-warn-body summary { width: fit-content; color: #8E2D20; font-size: 11.5px; font-weight: 700; cursor: pointer; }
  .placeholder-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .placeholder-list code { max-width: 100%; overflow-wrap: anywhere; color: #7A1D12; background: rgba(255,255,255,.6); border: 1px solid rgba(180,35,24,.2); border-radius: 6px; padding: 3px 6px; font: 600 10.5px ${MONO}; }
  .attachment-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .attachment-chip { display: inline-flex; align-items: center; gap: 6px; background: #EEF1F7; border: 1px solid ${C.line}; border-radius: 999px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; color: ${C.navy}; }
  .attachment-chip small { color: ${C.muted}; font-weight: 400; }
  .email-attachments { padding: 12px 18px 16px; border-top: 1px solid ${C.line}; }
  .tpl-manager { border: 1px solid ${C.line}; border-radius: 14px; background: #fff; margin-bottom: 18px; overflow: hidden; }
  .tpl-manager-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 13px 18px; border: none; background: #FAFBFE; cursor: pointer; text-align: left; font: 700 14px var(--font-head); color: ${C.navy}; }
  .tpl-manager-body { padding: 16px 18px; border-top: 1px solid ${C.line}; display: grid; gap: 14px; }
  .tpl-row { display: flex; align-items: center; gap: 10px; border: 1px solid ${C.line}; border-radius: 10px; padding: 10px 14px; flex-wrap: wrap; }
  .tpl-row strong { color: ${C.navy}; font-size: 13.5px; }
  .tpl-row .muted-note { color: ${C.muted}; font-size: 12px; }
  .tpl-row-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
  .tpl-btn { border: 1px solid ${C.line}; background: #fff; color: ${C.navy}; font-weight: 600; font-size: 12px; padding: 6px 11px; border-radius: 8px; cursor: pointer; }
  .tpl-btn.primary { background: ${C.navy}; border-color: ${C.navy}; color: #fff; font-weight: 700; }
  .tpl-btn.danger { color: ${C.orange}; border-color: ${C.orange}; }
  .tpl-form { display: grid; gap: 10px; border: 1px dashed ${C.line}; border-radius: 10px; padding: 14px; }
  .tpl-form input, .tpl-form textarea { width: 100%; border: 1px solid ${C.line}; border-radius: 8px; padding: 8px 11px; font: 13px var(--font-body); color: ${C.gray}; box-sizing: border-box; }
  .tpl-fields { border: 1px dashed ${C.line}; border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; background: #FAFBFE; }
  .tpl-fields-head { display: flex; align-items: baseline; gap: 8px; color: ${C.navy}; font: 700 12.5px ${HEAD}; } .tpl-fields-head small { color: ${C.muted}; font-weight: 600; font-size: 11px; }
  .tpl-note { font-size: 12.5px; color: ${C.muted}; }
  .reconnect-hint { color: ${C.orange}; font-weight: 600; }
  .history-card { border: 1px solid ${C.line}; border-radius: 14px; background: #fff; overflow: hidden; margin-bottom: 18px; }
  .history-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid ${C.line}; background: ${C.canvas}; font-family: ${HEAD}; font-weight: 700; font-size: 13.5px; color: ${C.navy}; }
  .history-head small { color: ${C.muted}; font-weight: 500; margin-left: auto; }
  .history-list { display: flex; flex-direction: column; }
  .history-row { display: flex; align-items: center; gap: 12px; padding: 11px 16px; border: none; border-top: 1px solid ${C.line}; background: #fff; cursor: pointer; text-align: left; width: 100%; }
  .history-row:first-child { border-top: none; } .history-row:hover { background: ${C.canvas}; }
  .history-main { flex: 1; min-width: 0; } .history-main strong { display: block; color: ${C.gray}; font-size: 13.5px; } .history-main small { color: ${C.muted}; font-size: 11.5px; }
  .history-stats { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .history-tag { font-size: 12px; font-weight: 700; } .history-tag.good { color: ${C.good}; } .history-tag.warn { color: ${C.orange}; }
  .candidate-table { display: grid; grid-template-columns: 56px 1.35fr 1.15fr .75fr 1.1fr .8fr; gap: 12px; align-items: center; min-width: 860px; }
  .candidate-table-wrap { overflow-x: auto; } .candidate-head { padding: 10px 18px; border-bottom: 1px solid ${C.line}; color: ${C.muted}; background: #FAFBFE; font: 600 10.5px ${HEAD}; text-transform: uppercase; letter-spacing: .25px; }
  .candidate-row { padding: 12px 18px; border-bottom: 1px solid ${C.line}; font-size: 12.5px; } .candidate-row:last-child { border-bottom: 0; } .candidate-row.excluded { background: #FBFBFC; color: #8E919B; }
  .candidate-row strong { display: block; color: ${C.gray}; font-size: 13.5px; } .candidate-row small { display: block; color: ${C.muted}; margin-top: 2px; font-size: 11px; } .candidate-row input { width: 17px; height: 17px; accent-color: ${C.orange}; cursor: pointer; } .candidate-row input:disabled { cursor: not-allowed; }
  .muted { color: ${C.muted}; }
  .status-pill, .stage-pill { display: inline-flex; align-items: center; width: fit-content; border-radius: 999px; padding: 4px 8px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
  .status-pill { color: ${C.navy2}; background: #EEF2F8; } .status-pill.good { color: ${C.good}; background: #E8F5EE; } .status-pill.warning { color: ${C.orange}; background: #FBE7DF; }
  .stage-pill { color: var(--stage-tone); background: color-mix(in srgb, var(--stage-tone) 13%, white); text-transform: uppercase; letter-spacing: .2px; }
  .compose-layout { display: grid; grid-template-columns: minmax(0, 1fr) 285px; gap: 16px; align-items: start; } .form-card { padding: 20px; }
  .field { display: block; margin-bottom: 16px; } .field:last-child { margin-bottom: 0; } .field>span { display: flex; justify-content: space-between; color: ${C.navy}; font: 700 12.5px ${HEAD}; margin-bottom: 7px; } .field>span small { color: ${C.muted}; font: 400 10.5px var(--font-body); }
  .field input, .field textarea { width: 100%; border: 1px solid #DADDE6; border-radius: 9px; background: #fff; color: ${C.gray}; padding: 10px 12px; font: 13.5px var(--font-body); outline: none; } .field textarea { resize: vertical; line-height: 1.6; min-height: 250px; }
  .field input:focus, .field textarea:focus { border-color: ${C.navy2}; box-shadow: 0 0 0 3px rgba(72,95,146,.1); }
  .variables-card { padding: 18px; position: sticky; top: 16px; } .variables-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: ${C.navy}; font: 700 15px ${HEAD}; } .variables-heading small { color: ${C.orange}; background: #FBE7DF; padding: 3px 7px; border-radius: 999px; font: 700 9.5px ${MONO}; }
  .variables-card>p { color: ${C.muted}; font-size: 12px; line-height: 1.5; } .variable-list { display: flex; flex-wrap: wrap; gap: 7px; } .variable-list button { border: 1px solid ${C.line}; background: #FAFBFE; color: ${C.navy2}; padding: 6px 8px; border-radius: 7px; font: 600 10.5px ${MONO}; cursor: pointer; } .variable-list button:hover { border-color: ${C.orange}; color: ${C.orange}; }
  .tip, .personalization-note, .safety-note { display: flex; align-items: flex-start; gap: 7px; color: ${C.muted}; font-size: 11px; line-height: 1.45; } .tip { border-top: 1px solid ${C.line}; margin-top: 16px; padding-top: 13px; } .tip svg, .personalization-note svg, .safety-note svg { flex: 0 0 auto; }
  .preview-title { align-items: flex-end; } .recipient-switcher { gap: 6px; } .recipient-switcher button { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid ${C.line}; background: #fff; color: ${C.navy}; border-radius: 8px; cursor: pointer; } .recipient-switcher select { height: 34px; min-width: 190px; border: 1px solid ${C.line}; background: #fff; color: ${C.navy}; border-radius: 8px; padding: 0 10px; font-weight: 700; }
  .preview-layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 16px; align-items: start; } .preview-context { padding: 18px; } .preview-count { color: ${C.orange}; font: 700 10px ${MONO}; text-transform: uppercase; } .preview-context h3 { color: ${C.navy}; font-size: 20px; margin: 8px 0 2px; } .preview-context>p { color: ${C.muted}; font-size: 12px; margin: 0; word-break: break-all; }
  .preview-context dl { margin: 18px 0; } .preview-context dl>div { border-top: 1px solid ${C.line}; padding: 9px 0; } .preview-context dt { color: ${C.muted}; font-size: 10px; text-transform: uppercase; } .preview-context dd { color: ${C.gray}; font-size: 12px; font-weight: 700; margin: 3px 0 0; }
  .personalization-note { color: ${C.good}; background: #E8F5EE; border-radius: 9px; padding: 10px; }
  .email-preview { overflow: hidden; box-shadow: 0 8px 28px rgba(17,18,62,.06); } .email-toolbar { display: flex; align-items: center; gap: 6px; background: ${C.navy}; padding: 10px 14px; } .email-toolbar>span { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.35); } .email-toolbar>div { color: rgba(255,255,255,.75); font: 500 10px ${MONO}; margin-left: 5px; }
  .email-meta { padding: 14px 22px; border-bottom: 1px solid ${C.line}; background: #FAFBFE; } .email-meta>div { display: grid; grid-template-columns: 72px 1fr; gap: 10px; padding: 3px 0; font-size: 12px; } .email-meta span { color: ${C.muted}; } .email-meta strong { color: ${C.gray}; overflow-wrap: anywhere; }
  .email-body { min-height: 340px; padding: 28px 34px 40px; color: #34343C; font-family: Arial, sans-serif; font-size: 14px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .merge-value { color: inherit; background: #FFE9B8; border-radius: 4px; padding: 1px 3px; margin: 0 -1px; box-decoration-break: clone; -webkit-box-decoration-break: clone; box-shadow: inset 0 -1px 0 rgba(201,162,39,.42); }
  .manual-placeholder { color: #B42318; background: #FDE7E4; font-weight: 700; border-radius: 4px; padding: 1px 3px; margin: 0 -1px; box-decoration-break: clone; -webkit-box-decoration-break: clone; box-shadow: inset 0 -1px 0 rgba(180,35,24,.45); }
  .preview-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 12px 22px 16px; border-top: 1px solid ${C.line}; font-size: 11.5px; color: ${C.muted}; } .preview-legend .lg { display: inline-flex; align-items: center; gap: 6px; } .preview-legend mark { font: 700 10px ${MONO}; }
  .review-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; } .review-main { display: grid; gap: 12px; } .review-card { padding: 18px; } .review-card>h3 { color: ${C.navy}; font-size: 15px; margin: 0 0 14px; }
  .review-details { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; } .review-details>div { display: flex; flex-direction: column; gap: 3px; } .review-details .wide { grid-column: 1 / -1; } .review-details span { color: ${C.muted}; font-size: 10.5px; text-transform: uppercase; } .review-details strong { color: ${C.gray}; font-size: 13px; overflow-wrap: anywhere; }
  .recipient-list, .exclusion-list { display: grid; gap: 0; } .recipient-list>div, .exclusion-list>div { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid ${C.line}; } .recipient-list>div:first-child, .exclusion-list>div:first-child { border-top: 0; padding-top: 0; } .recipient-list>div:last-child, .exclusion-list>div:last-child { padding-bottom: 0; } .recipient-list>div>div, .exclusion-list>div>div { flex: 1; min-width: 0; } .recipient-list strong, .exclusion-list strong { display: block; color: ${C.gray}; font-size: 12.5px; } .recipient-list small, .exclusion-list small { display: block; color: ${C.muted}; font-size: 10.5px; margin-top: 2px; overflow-wrap: anywhere; } .recipient-list>div>svg { color: ${C.good}; }
  .avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; color: ${C.navy2}; background: #EEF2F8; font: 700 10px ${MONO}; flex: 0 0 auto; }
  .send-card { position: sticky; top: 16px; padding: 22px; text-align: center; } .send-icon { display: grid; place-items: center; width: 46px; height: 46px; margin: 0 auto 12px; border-radius: 13px; color: ${C.orange}; background: #FBE7DF; } .send-card h3 { color: ${C.navy}; font-size: 19px; margin: 0; } .send-card>p { color: ${C.muted}; font-size: 12px; line-height: 1.55; }
  .primary-action { width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px; border-radius: 9px; padding: 10px 14px; color: #fff; background: ${C.navy}; border: 1px solid ${C.navy}; font-weight: 700; cursor: pointer; } .primary-action:disabled { opacity: .42; cursor: not-allowed; }
  .send-warning { display: flex; align-items: flex-start; gap: 7px; margin: 14px 0; padding: 10px; color: #7A5A0A; background: #FFF7DC; border-radius: 9px; font-size: 11px; line-height: 1.45; text-align: left; } .send-warning svg { flex: 0 0 auto; }
  .campaign-confirmation { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; color: ${C.gray}; font-size: 11px; line-height: 1.45; text-align: left; } .campaign-confirmation input { width: 16px; height: 16px; flex: 0 0 auto; accent-color: ${C.navy}; }
  .review-connect { width: 100%; margin-top: 9px; }
  .safety-note { justify-content: center; color: ${C.orange}; margin-top: 14px; }
  .campaign-send-error { display: flex; align-items: flex-start; gap: 7px; margin-top: 11px; padding: 9px; color: ${C.orange}; background: #FBE7DF; border-radius: 8px; font-size: 11px; line-height: 1.4; text-align: left; }
  .result-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; } .result-metrics>div { display: grid; gap: 2px; padding: 10px; background: #F7F8FB; border-radius: 9px; } .result-metrics span { color: ${C.muted}; font-size: 10px; text-transform: uppercase; } .result-metrics strong { color: ${C.navy}; font: 700 20px ${HEAD}; } .result-metrics .good strong { color: ${C.good}; } .result-metrics .warning strong { color: ${C.orange}; }
  .campaign-results { display: grid; } .campaign-results>div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-top: 1px solid ${C.line}; } .campaign-results>div>div:first-child { min-width: 0; } .campaign-results strong { display: block; color: ${C.gray}; font-size: 12.5px; } .campaign-results small { display: block; margin-top: 3px; color: ${C.muted}; font-size: 10.5px; overflow-wrap: anywhere; } .campaign-results code { font: 600 10px ${MONO}; } .result-status { display: flex; flex-direction: column; align-items: flex-end; max-width: 55%; text-align: right; }
  .wizard-footer { justify-content: space-between; gap: 16px; min-height: 44px; margin-top: 20px; } .footer-actions { gap: 9px; margin-left: auto; } .back-button, .next-button { display: inline-flex; align-items: center; gap: 8px; border-radius: 9px; padding: 10px 15px; font-weight: 700; cursor: pointer; } .back-button { color: ${C.navy}; background: #fff; border: 1px solid ${C.line}; } .next-button { color: #fff; background: ${C.navy}; border: 1px solid ${C.navy}; } .next-button:disabled { opacity: .45; cursor: not-allowed; } .validation-note { color: ${C.orange}; font-size: 12px; }
  @media (max-width: 980px) { .metrics-grid { grid-template-columns: repeat(3, 1fr); } .compose-layout, .review-grid { grid-template-columns: 1fr; } .variables-card, .send-card { position: static; } .preview-layout { grid-template-columns: 210px minmax(0, 1fr); } }
  @media (max-width: 720px) { .email-campaigns-page { padding: 20px 14px 60px; } .campaign-heading, .section-title { align-items: flex-start; flex-direction: column; } .recipient-title-actions { width: 100%; justify-content: space-between; } .previewing-note { width: 100%; } .gmail-connection-card { grid-template-columns: auto minmax(0, 1fr); align-items: start; } .gmail-connection-card form, .gmail-connection-card>.gmail-action { grid-column: 1 / -1; width: 100%; } .stepper { grid-template-columns: repeat(4, minmax(48px, 1fr)); } .step { flex-direction: column; gap: 4px; font-size: 10px; padding: 7px 2px; } .metrics-grid { grid-template-columns: repeat(2, 1fr); } .compose-layout, .preview-layout, .review-grid { grid-template-columns: 1fr; } .review-details { grid-template-columns: 1fr; } .preview-title { align-items: stretch; } .recipient-switcher select { flex: 1; min-width: 0; } .email-meta { padding: 12px 14px; } .email-meta>div { grid-template-columns: 58px 1fr; } .email-body { min-height: 300px; padding: 22px 18px 30px; } .wizard-footer { align-items: flex-start; flex-direction: column; } .footer-actions { width: 100%; } .footer-actions button { flex: 1; justify-content: center; } .result-metrics { grid-template-columns: repeat(2, 1fr); } .campaign-results>div { flex-direction: column; } .result-status { align-items: flex-start; max-width: none; text-align: left; } }
  @media (max-width: 430px) { .metrics-grid { grid-template-columns: 1fr; } .metric div span { white-space: normal; } .step>span:last-child { display: none; } }
`;

// ============================================================================
// Admin-only template manager (phase 23). Create/edit templates and manage
// their attachments — the content fellows are locked to. Server actions do the
// real permission checks; this UI simply isn't rendered for non-admins.
// ============================================================================
export function OutreachTemplateManager({ templates }: { templates: OutreachTemplateView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; name: string; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Which editor field a click-to-insert lands in (drag targets the field
  // directly). Tracks the last-focused of subject/body.
  const [activeField, setActiveField] = useState<"subject" | "body">("body");
  const tplSubjectRef = useRef<HTMLInputElement | null>(null);
  const tplBodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Click-to-insert a token at the cursor of the last-focused editor field.
  const insertField = (token: string) => {
    setEditing((cur) => {
      if (!cur) return cur;
      const which = activeField;
      const el = which === "subject" ? tplSubjectRef.current : tplBodyRef.current;
      const value = cur[which];
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? start;
      const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
      const caret = start + token.length;
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret); });
      return { ...cur, [which]: next };
    });
  };

  const act = async (fn: () => Promise<{ error?: string; ok?: unknown; id?: unknown }>) => {
    setBusy(true); setError(null);
    const res = await fn().catch(() => ({ error: "Something went wrong — try again." }));
    setBusy(false);
    if ("error" in res && res.error) { setError(res.error); return false; }
    router.refresh();
    return true;
  };

  const save = async () => {
    if (!editing) return;
    if (await act(() => saveOutreachTemplate({ id: editing.id, name: editing.name, subject: editing.subject, body: editing.body }))) setEditing(null);
  };
  const archive = async (id: string) => {
    await act(() => setOutreachTemplateArchived(id, true));
  };
  const upload = async (templateId: string, file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("templateId", templateId);
    fd.set("file", file);
    await act(() => uploadOutreachTemplateAttachment(fd));
  };
  const removeAttachment = async (attachmentId: string) => {
    await act(() => deleteOutreachTemplateAttachment(attachmentId));
  };

  return (
    <div className="tpl-manager">
      <button type="button" className="tpl-manager-head" onClick={() => setOpen((v) => !v)}>
        <span style={{ flex: 1 }}>Templates <small style={{ color: C.muted, fontWeight: 600 }}>· {templates.length} active · what fellows send from</small></span>
        <span style={{ color: C.muted }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="tpl-manager-body">
          {error && <div className="compose-warn"><CircleAlert size={15} /> {error}</div>}
          {templates.map((t) => (
            <div className="tpl-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <div className="muted-note">{t.subject}</div>
                {t.attachments.length > 0 && (
                  <div className="attachment-chips">
                    {t.attachments.map((a) => (
                      <span className="attachment-chip" key={a.id}>
                        📎 {a.fileName} <small>{fmtBytes(a.sizeBytes)}</small>
                        <button type="button" className="tpl-btn danger" style={{ padding: "1px 7px", marginLeft: 4 }} disabled={busy} onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.fileName}`}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="tpl-row-actions">
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.pptx" style={{ display: "none" }}
                  ref={(el) => { fileRefs.current[t.id] = el; }}
                  onChange={(e) => { upload(t.id, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                <button type="button" className="tpl-btn" disabled={busy} onClick={() => fileRefs.current[t.id]?.click()}>📎 Attach file</button>
                <button type="button" className="tpl-btn" disabled={busy} onClick={() => setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body })}>Edit</button>
                <button type="button" className="tpl-btn danger" disabled={busy} onClick={() => archive(t.id)}>Archive</button>
              </div>
            </div>
          ))}
          {templates.length === 0 && !editing && <div className="tpl-note">No templates yet — fellows can&apos;t send outreach until you create one.</div>}
          {editing ? (
            <div className="tpl-form">
              <input value={editing.name} maxLength={120} placeholder="Template name (e.g. Fall intro — first touch)" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <input ref={tplSubjectRef} value={editing.subject} maxLength={200} placeholder="Subject — merge fields like {{candidate_first_name}} work here"
                onFocus={() => setActiveField("subject")}
                onDragOver={allowMergeFieldDrop} onDrop={(e) => insertMergeFieldOnDrop(e, editing.subject, (v) => setEditing((cur) => cur && { ...cur, subject: v }))}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
              <textarea ref={tplBodyRef} value={editing.body} rows={8} placeholder="Message body"
                onFocus={() => setActiveField("body")}
                onDragOver={allowMergeFieldDrop} onDrop={(e) => insertMergeFieldOnDrop(e, editing.body, (v) => setEditing((cur) => cur && { ...cur, body: v }))}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              <div className="tpl-fields">
                <div className="tpl-fields-head">Merge fields <small>drag into the subject or message, or click to insert</small></div>
                <MergeFieldPalette onInsert={insertField} />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="tpl-btn" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                <button type="button" className="tpl-btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : editing.id ? "Save changes" : "Create template"}</button>
              </div>
              <div className="tpl-note">Attachments: PDF, PNG, JPG, DOCX, PPTX · 5 MB per file · 10 MB and 5 files per template. Fellows always send the template exactly as written here.</div>
            </div>
          ) : (
            <button type="button" className="tpl-btn primary" style={{ justifySelf: "start" }} disabled={busy}
              onClick={() => setEditing({ id: null, name: "", subject: INITIAL_CAMPAIGN_SUBJECT, body: INITIAL_CAMPAIGN_BODY })}>
              + New template
            </button>
          )}
        </div>
      )}
    </div>
  );
}
