"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, ArrowRight, Ban, CalendarClock, Check, CheckCircle2, ChevronLeft,
  ChevronRight, CircleAlert, Clock3, Link2, Mail, Send, Unplug, UserRoundCheck, UsersRound, X,
} from "lucide-react";
import type { GmailConnectionStatus } from "@/lib/gmail/types";

type DemoCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  schoolName: string;
  graduationYear: number;
  major: string;
  stage: string;
  lastContactedAt: string | null;
  unsubscribed: boolean;
  doNotContact: boolean;
};

export const MOCK_PRIMARY_CONTACT = {
  name: "Sam Brumley",
  firstName: "Sam",
  email: "sam@example.com",
  schoolName: "Purdue University",
};

export const DEMO_CANDIDATES: DemoCandidate[] = [
  { id: "ava-patel", firstName: "Ava", lastName: "Patel", email: "ava.patel@example.com", schoolName: "Purdue University", graduationYear: 2027, major: "Industrial Engineering", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "malik-johnson", firstName: "Malik", lastName: "Johnson", email: "malik.johnson@example.com", schoolName: "Indiana University", graduationYear: 2027, major: "Finance", stage: "Contacted", lastContactedAt: "2026-07-08", unsubscribed: false, doNotContact: false },
  { id: "elena-garcia", firstName: "Elena", lastName: "Garcia", email: "elena.garcia@example.com", schoolName: "Butler University", graduationYear: 2028, major: "Marketing", stage: "Applied", lastContactedAt: "2026-06-24", unsubscribed: false, doNotContact: false },
  { id: "noah-kim", firstName: "Noah", lastName: "Kim", email: "noah.kim@example.com", schoolName: "Purdue University", graduationYear: 2027, major: "Computer Science", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "maya-thompson", firstName: "Maya", lastName: "Thompson", email: "maya.thompson@example.com", schoolName: "DePauw University", graduationYear: 2028, major: "Economics", stage: "Contacted", lastContactedAt: "2026-07-02", unsubscribed: false, doNotContact: false },
  { id: "liam-obrien", firstName: "Liam", lastName: "O'Brien", email: "liam.obrien@example.com", schoolName: "Wabash College", graduationYear: 2027, major: "Political Science", stage: "Applied", lastContactedAt: "2026-06-18", unsubscribed: false, doNotContact: false },
  { id: "zoe-williams", firstName: "Zoe", lastName: "Williams", email: "zoe.williams@example.com", schoolName: "Indiana University", graduationYear: 2028, major: "Information Systems", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: true },
  { id: "ethan-nguyen", firstName: "Ethan", lastName: "Nguyen", email: "ethan.nguyen@example.com", schoolName: "Purdue University", graduationYear: 2027, major: "Supply Chain Management", stage: "Finalist", lastContactedAt: "2026-07-10", unsubscribed: false, doNotContact: false },
  { id: "isabella-reed", firstName: "Isabella", lastName: "Reed", email: null, schoolName: "Butler University", graduationYear: 2028, major: "Strategic Communication", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "caleb-brooks", firstName: "Caleb", lastName: "Brooks", email: "caleb.brooks@example.com", schoolName: "Indiana University", graduationYear: 2027, major: "Accounting", stage: "Contacted", lastContactedAt: "2026-06-30", unsubscribed: true, doNotContact: false },
];

const MERGE_VARIABLES = [
  "{{first_name}}", "{{full_name}}", "{{school_name}}", "{{graduation_year}}",
  "{{major}}", "{{primary_contact_name}}", "{{primary_contact_email}}", "{{application_link}}",
] as const;

const STEPS = ["My Candidates", "Compose", "Preview", "Review"] as const;
const C = { navy: "#11123E", navy2: "#485F92", orange: "#DD5434", gray: "#303333", muted: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B", gold: "#C9A227" };
const HEAD = "'Cabin', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const initialBody = `Hi {{first_name}},

I hope your summer is going well! I wanted to reach out because your experience at {{school_name}} stood out to our recruiting team.

The Orr Fellowship connects ambitious graduating seniors with high-growth companies in Indianapolis, along with a two-year professional development experience and a close-knit peer community. I would love to tell you more and learn what you are looking for after graduation.

You can explore the Fellowship and start an application here: {{application_link}}

Best,
{{primary_contact_name}}`;

export function isEligible(candidate: DemoCandidate) {
  return getAutomaticExclusionReason(candidate) === null;
}

export function getAutomaticExclusionReason(candidate: DemoCandidate) {
  if (!candidate.email) return "Missing email address";
  if (candidate.unsubscribed) return "Unsubscribed from email";
  if (candidate.doNotContact) return "Marked Do Not Contact";
  return null;
}

function fullName(candidate: DemoCandidate) {
  return `${candidate.firstName} ${candidate.lastName}`;
}

export function renderTemplate(template: string, candidate: DemoCandidate) {
  const values: Record<string, string> = {
    first_name: candidate.firstName,
    full_name: fullName(candidate),
    school_name: candidate.schoolName,
    graduation_year: String(candidate.graduationYear),
    major: candidate.major,
    primary_contact_name: MOCK_PRIMARY_CONTACT.name,
    primary_contact_email: MOCK_PRIMARY_CONTACT.email,
    application_link: "https://example.com/apply",
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

type GmailNotice = { result?: string; error?: string };

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

export default function EmailCampaignsClient({
  gmailConnection = DEFAULT_GMAIL_STATUS,
  gmailNotice = {},
}: {
  gmailConnection?: GmailConnectionStatus;
  gmailNotice?: GmailNotice;
}) {
  const eligibleIds = useMemo(() => DEMO_CANDIDATES.filter(isEligible).map((candidate) => candidate.id), []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(eligibleIds));
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [campaignName, setCampaignName] = useState("Fall 2026 Fellowship Introduction");
  const [subject, setSubject] = useState("{{first_name}}, explore Orr Fellowship opportunities");
  const [body, setBody] = useState(initialBody);
  const [senderName, setSenderName] = useState(MOCK_PRIMARY_CONTACT.name);
  const [replyTo, setReplyTo] = useState(MOCK_PRIMARY_CONTACT.email);
  const [activeField, setActiveField] = useState<"subject" | "body">("body");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [demoAction, setDemoAction] = useState<"sent" | "scheduled">("sent");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const selectedCandidates = useMemo(
    () => DEMO_CANDIDATES.filter((candidate) => selectedIds.has(candidate.id) && isEligible(candidate)),
    [selectedIds],
  );
  const currentPreview = selectedCandidates[Math.min(previewIndex, Math.max(0, selectedCandidates.length - 1))];
  const excludedCandidates = DEMO_CANDIDATES.filter((candidate) => !selectedIds.has(candidate.id) || !isEligible(candidate));
  const composeReady = campaignName.trim() && subject.trim() && body.trim() && senderName.trim() && replyTo.trim();
  const canContinue = step === 0 ? selectedCandidates.length > 0 : step === 1 ? !!composeReady : true;
  const connectionNotice = gmailNoticeText(gmailNotice);

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

  function toggleCandidate(candidate: DemoCandidate) {
    if (!isEligible(candidate)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
    setPreviewIndex(0);
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

  function handleDemoSend(action: "sent" | "scheduled") {
    setDemoAction(action);
    setDemoModalOpen(true);
  }

  return (
    <div className="email-campaigns-page">
      <style>{styles}</style>

      <div className="campaign-heading">
        <div>
          <div className="heading-line">
            <h1>Email Campaigns</h1>
            <span className="demo-badge">Demo mode</span>
          </div>
          <p>This local prototype uses fictional candidate data and simulates the future fellow experience. Email delivery is disabled.</p>
        </div>
        <div className="previewing-note"><UserRoundCheck size={17} /> <span>Previewing as: <strong>{MOCK_PRIMARY_CONTACT.name}</strong>, Primary Contact</span></div>
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
            <p><strong>{gmailConnection.connectedEmail}</strong> is connected for future campaign delivery. Sending remains disabled in Phase 1.</p>
          ) : (
            <p>Connect your Orr Fellowship account so campaign emails can eventually be sent from your own Gmail address. Sending remains disabled in Phase 1.</p>
          )}
        </div>
        {gmailConnection.connected ? (
          <form method="post" action="/api/google/disconnect">
            <button type="submit" className="gmail-action secondary"><Unplug size={15} /> Disconnect Gmail</button>
          </form>
        ) : (
          <a className="gmail-action" href="/api/google/connect"><Link2 size={15} /> Connect Gmail</a>
        )}
      </section>

      <div className="stepper" aria-label="Campaign steps">
        {STEPS.map((label, index) => {
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

      {step === 0 && (
        <section>
          <div className="section-title">
            <div><h2>My Assigned Candidates</h2><p>You are the primary recruiting contact for these candidates.</p></div>
            <span className="scope-pill"><UsersRound size={15} /> My assignments only</span>
          </div>

          <div className="metrics-grid">
            <Metric label="Total assigned" value={DEMO_CANDIDATES.length} icon={<UsersRound size={18} />} />
            <Metric label="Eligible to email" value={eligibleIds.length} tone="good" icon={<Mail size={18} />} />
            <Metric label="Missing email" value={DEMO_CANDIDATES.filter((candidate) => !candidate.email).length} tone="warning" icon={<CircleAlert size={18} />} />
            <Metric label="Unsubscribed" value={DEMO_CANDIDATES.filter((candidate) => candidate.unsubscribed).length} tone="warning" icon={<X size={18} />} />
            <Metric label="Do Not Contact" value={DEMO_CANDIDATES.filter((candidate) => candidate.doNotContact).length} tone="warning" icon={<Ban size={18} />} />
            <Metric label="Previously contacted" value={DEMO_CANDIDATES.filter((candidate) => candidate.lastContactedAt).length} icon={<Clock3 size={18} />} />
          </div>

          <div className="audience-card">
            <div className="audience-summary">
              <div><strong>{selectedCandidates.length} of your {DEMO_CANDIDATES.length} assigned candidates</strong> will receive this email.</div>
              <span>{excludedCandidates.length} excluded</span>
            </div>
            <div className="candidate-table-wrap">
              <div className="candidate-table candidate-head">
                <div>Include</div><div>Candidate</div><div>School</div><div>Stage</div><div>Email status</div><div>Last contact</div>
              </div>
              {DEMO_CANDIDATES.map((candidate) => {
                const eligible = isEligible(candidate);
                const included = selectedIds.has(candidate.id) && eligible;
                return (
                  <div className={`candidate-table candidate-row ${eligible ? "" : "excluded"}`} key={candidate.id}>
                    <div><input type="checkbox" aria-label={`Include ${fullName(candidate)}`} checked={included} disabled={!eligible} onChange={() => toggleCandidate(candidate)} /></div>
                    <div><strong>{fullName(candidate)}</strong><small>{candidate.email ?? "No email on file"}</small></div>
                    <div>{candidate.schoolName}<small>Class of {candidate.graduationYear}</small></div>
                    <div><StagePill stage={candidate.stage} /></div>
                    <div>{!candidate.email ? <StatusPill tone="warning">Missing email · excluded</StatusPill> : candidate.unsubscribed ? <StatusPill tone="warning">Unsubscribed · excluded</StatusPill> : candidate.doNotContact ? <StatusPill tone="warning">Do not contact · excluded</StatusPill> : included ? <StatusPill tone="good">Eligible · included</StatusPill> : <StatusPill>Manually excluded</StatusPill>}</div>
                    <div className={candidate.lastContactedAt ? "" : "muted"}>{formatDate(candidate.lastContactedAt)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <div className="section-title"><div><h2>Compose your email</h2><p>Create one template that will be personalized for each selected candidate.</p></div></div>
          <div className="compose-layout">
            <div className="form-card">
              <Field label="Campaign name" hint="Only visible to your recruiting team">
                <input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Campaign name" />
              </Field>
              <Field label="Subject line">
                <input ref={subjectRef} value={subject} onFocus={() => setActiveField("subject")} onChange={(event) => setSubject(event.target.value)} placeholder="Email subject" />
              </Field>
              <Field label="Email body">
                <textarea ref={bodyRef} value={body} onFocus={() => setActiveField("body")} onChange={(event) => setBody(event.target.value)} rows={14} />
              </Field>
              <div className="two-col">
                <Field label="Sender name"><input value={senderName} onChange={(event) => setSenderName(event.target.value)} /></Field>
                <Field label="Reply-to email"><input type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} /></Field>
              </div>
            </div>
            <aside className="variables-card">
              <div className="variables-heading"><span>Merge variables</span><small>Insert into {activeField}</small></div>
              <p>Personalize the template using candidate and primary-contact details.</p>
              <div className="variable-list">
                {MERGE_VARIABLES.map((variable) => <button type="button" key={variable} onClick={() => insertVariable(variable)}>{variable}</button>)}
              </div>
              <div className="tip"><CircleAlert size={15} /><span>Click a variable to insert it at the cursor in the last-focused subject or body field.</span></div>
            </aside>
          </div>
        </section>
      )}

      {step === 2 && currentPreview && (
        <section>
          <div className="section-title preview-title">
            <div><h2>Preview personalized emails</h2><p>Switch recipients to see how the same template adapts for each candidate.</p></div>
            <div className="recipient-switcher">
              <button type="button" aria-label="Previous recipient" onClick={() => setPreviewIndex((index) => (index - 1 + selectedCandidates.length) % selectedCandidates.length)}><ChevronLeft size={18} /></button>
              <select value={currentPreview.id} onChange={(event) => setPreviewIndex(selectedCandidates.findIndex((candidate) => candidate.id === event.target.value))}>
                {selectedCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{fullName(candidate)}</option>)}
              </select>
              <button type="button" aria-label="Next recipient" onClick={() => setPreviewIndex((index) => (index + 1) % selectedCandidates.length)}><ChevronRight size={18} /></button>
            </div>
          </div>
          <div className="preview-layout">
            <div className="preview-context">
              <span className="preview-count">Recipient {previewIndex + 1} of {selectedCandidates.length}</span>
              <h3>{fullName(currentPreview)}</h3>
              <p>{currentPreview.email}</p>
              <dl>
                <div><dt>School</dt><dd>{currentPreview.schoolName}</dd></div>
                <div><dt>Major</dt><dd>{currentPreview.major}</dd></div>
                <div><dt>Graduation</dt><dd>{currentPreview.graduationYear}</dd></div>
              </dl>
              <div className="personalization-note"><CheckCircle2 size={16} /><span>Merge variables are rendered with this candidate&apos;s fictional details.</span></div>
            </div>
            <article className="email-preview">
              <div className="email-toolbar"><span></span><span></span><span></span><div>Email preview</div></div>
              <div className="email-meta">
                <div><span>From</span><strong>{senderName}</strong></div>
                <div><span>Reply-to</span><strong>{replyTo}</strong></div>
                <div><span>To</span><strong>{fullName(currentPreview)} &lt;{currentPreview.email}&gt;</strong></div>
                <div><span>Subject</span><strong>{renderTemplate(subject, currentPreview)}</strong></div>
              </div>
              <div className="email-body">{renderTemplate(body, currentPreview)}</div>
            </article>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <div className="section-title"><div><h2>Review campaign</h2><p>Confirm your audience and content before attempting this demo send.</p></div><StatusPill tone="good">Ready for demo</StatusPill></div>
          <div className="review-grid">
            <div className="review-main">
              <ReviewCard title="Campaign details">
                <div className="review-details">
                  <ReviewValue label="Campaign name" value={campaignName} />
                  <ReviewValue label="Recipients" value={`${selectedCandidates.length} assigned candidates`} />
                  <ReviewValue label="Sender" value={senderName} />
                  <ReviewValue label="Reply-to" value={replyTo} />
                  <ReviewValue label="Subject" value={subject} wide />
                </div>
              </ReviewCard>
              <ReviewCard title={`Recipients (${selectedCandidates.length})`}>
                <div className="recipient-list">
                  {selectedCandidates.map((candidate) => <div key={candidate.id}><span className="avatar">{candidate.firstName[0]}{candidate.lastName[0]}</span><div><strong>{fullName(candidate)}</strong><small>{candidate.email} · {candidate.schoolName}</small></div><CheckCircle2 size={17} /></div>)}
                </div>
              </ReviewCard>
              <ReviewCard title={`Excluded (${excludedCandidates.length})`}>
                <div className="exclusion-list">
                  {excludedCandidates.map((candidate) => <div key={candidate.id}><div><strong>{fullName(candidate)}</strong><small>{getAutomaticExclusionReason(candidate) ?? "Excluded from this campaign"}</small></div><StatusPill tone="warning">Excluded</StatusPill></div>)}
                </div>
              </ReviewCard>
            </div>
            <aside className="send-card">
              <div className="send-icon"><Send size={22} /></div>
              <h3>Ready to reach out?</h3>
              <p>This campaign is limited to candidates assigned to {MOCK_PRIMARY_CONTACT.firstName}. Delivery remains disabled in this local prototype.</p>
              <button type="button" className="primary-action" onClick={() => handleDemoSend("sent")}><Send size={16} /> Demo send only</button>
              <button type="button" className="secondary-action" onClick={() => handleDemoSend("scheduled")}><CalendarClock size={16} /> Demo schedule only</button>
              <div className="safety-note"><CircleAlert size={15} /> No network or email action will occur.</div>
            </aside>
          </div>
        </section>
      )}

      <div className="wizard-footer">
        <div>{step === 0 && selectedCandidates.length === 0 ? <span className="validation-note">Select at least one eligible candidate.</span> : step === 1 && !composeReady ? <span className="validation-note">Complete all fields to continue.</span> : null}</div>
        <div className="footer-actions">
          {step > 0 && <button type="button" className="back-button" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={16} /> Back</button>}
          {step < 3 && <button type="button" className="next-button" disabled={!canContinue} onClick={goNext}>Continue to {STEPS[step + 1]} <ArrowRight size={16} /></button>}
        </div>
      </div>

      {demoModalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDemoModalOpen(false); }}>
          <div className="demo-modal" role="dialog" aria-modal="true" aria-labelledby="demo-modal-title">
            <div className="modal-icon"><Mail size={24} /></div>
            <span className="demo-badge">Demo mode</span>
            <h2 id="demo-modal-title">No emails were {demoAction}</h2>
            <p>Email delivery is not connected yet. No messages were sent or scheduled.</p>
            <button type="button" onClick={() => setDemoModalOpen(false)}>Close and return to review</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon, tone = "default" }: { label: string; value: number; icon: React.ReactNode; tone?: "default" | "good" | "warning" }) {
  return <div className={`metric ${tone}`}><div><span>{label}</span><strong>{value}</strong></div><span className="metric-icon">{icon}</span></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
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

const styles = `
  .email-campaigns-page { max-width: 1240px; margin: 0 auto; padding: 30px 28px 80px; color: ${C.gray}; }
  .campaign-heading, .section-title, .heading-line, .previewing-note, .wizard-footer, .footer-actions, .recipient-switcher { display: flex; align-items: center; }
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
  .step { position: relative; border: 0; background: transparent; color: #9296A3; display: flex; align-items: center; justify-content: center; gap: 9px; padding: 10px 8px; font: 700 13px 'Open Sans', sans-serif; border-radius: 9px; cursor: pointer; }
  .step:disabled { cursor: default; } .step.active { background: #FBE7DF; color: ${C.navy}; } .step.complete { color: ${C.good}; }
  .step-number { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid #D8DAE2; border-radius: 50%; font: 700 11px ${MONO}; }
  .step.active .step-number { color: #fff; background: ${C.orange}; border-color: ${C.orange}; } .step.complete .step-number { color: #fff; background: ${C.good}; border-color: ${C.good}; }
  .section-title { justify-content: space-between; gap: 18px; margin-bottom: 18px; } .section-title h2 { font-size: 23px; color: ${C.navy}; margin: 0; }
  .scope-pill { display: inline-flex; align-items: center; gap: 7px; color: ${C.navy2}; background: #EEF2F8; border-radius: 999px; padding: 7px 11px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .metrics-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
  .metric { background: #fff; border: 1px solid ${C.line}; border-radius: 12px; padding: 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .metric>div { display: flex; flex-direction: column; gap: 4px; min-width: 0; } .metric div span { color: ${C.muted}; font-size: 11.5px; white-space: nowrap; } .metric strong { color: ${C.navy}; font: 700 24px ${HEAD}; }
  .metric-icon { display: grid; place-items: center; width: 34px; height: 34px; color: ${C.navy2}; background: #EEF2F8; border-radius: 9px; flex: 0 0 auto; } .metric.good .metric-icon { color: ${C.good}; background: #E8F5EE; } .metric.warning .metric-icon { color: ${C.orange}; background: #FBE7DF; }
  .audience-card, .form-card, .variables-card, .preview-context, .email-preview, .review-card, .send-card { background: #fff; border: 1px solid ${C.line}; border-radius: 14px; }
  .audience-card { overflow: hidden; } .audience-summary { display: flex; justify-content: space-between; align-items: center; padding: 13px 18px; border-bottom: 1px solid ${C.line}; background: #FAFBFE; font-size: 13px; } .audience-summary strong { color: ${C.navy}; } .audience-summary span { color: ${C.muted}; }
  .candidate-table { display: grid; grid-template-columns: 56px 1.35fr 1.15fr .75fr 1.1fr .8fr; gap: 12px; align-items: center; min-width: 860px; }
  .candidate-table-wrap { overflow-x: auto; } .candidate-head { padding: 10px 18px; border-bottom: 1px solid ${C.line}; color: ${C.muted}; background: #FAFBFE; font: 600 10.5px ${HEAD}; text-transform: uppercase; letter-spacing: .25px; }
  .candidate-row { padding: 12px 18px; border-bottom: 1px solid ${C.line}; font-size: 12.5px; } .candidate-row:last-child { border-bottom: 0; } .candidate-row.excluded { background: #FBFBFC; color: #8E919B; }
  .candidate-row strong { display: block; color: ${C.gray}; font-size: 13.5px; } .candidate-row small { display: block; color: ${C.muted}; margin-top: 2px; font-size: 11px; } .candidate-row input { width: 17px; height: 17px; accent-color: ${C.orange}; cursor: pointer; } .candidate-row input:disabled { cursor: not-allowed; }
  .muted { color: ${C.muted}; }
  .status-pill, .stage-pill { display: inline-flex; align-items: center; width: fit-content; border-radius: 999px; padding: 4px 8px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
  .status-pill { color: ${C.navy2}; background: #EEF2F8; } .status-pill.good { color: ${C.good}; background: #E8F5EE; } .status-pill.warning { color: ${C.orange}; background: #FBE7DF; }
  .stage-pill { color: var(--stage-tone); background: color-mix(in srgb, var(--stage-tone) 13%, white); text-transform: uppercase; letter-spacing: .2px; }
  .compose-layout { display: grid; grid-template-columns: minmax(0, 1fr) 285px; gap: 16px; align-items: start; } .form-card { padding: 20px; }
  .field { display: block; margin-bottom: 16px; } .field:last-child { margin-bottom: 0; } .field>span { display: flex; justify-content: space-between; color: ${C.navy}; font: 700 12.5px ${HEAD}; margin-bottom: 7px; } .field>span small { color: ${C.muted}; font: 400 10.5px 'Open Sans', sans-serif; }
  .field input, .field textarea { width: 100%; border: 1px solid #DADDE6; border-radius: 9px; background: #fff; color: ${C.gray}; padding: 10px 12px; font: 13.5px 'Open Sans', sans-serif; outline: none; } .field textarea { resize: vertical; line-height: 1.6; min-height: 250px; }
  .field input:focus, .field textarea:focus { border-color: ${C.navy2}; box-shadow: 0 0 0 3px rgba(72,95,146,.1); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } .two-col .field { margin-bottom: 0; }
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
  .review-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; } .review-main { display: grid; gap: 12px; } .review-card { padding: 18px; } .review-card>h3 { color: ${C.navy}; font-size: 15px; margin: 0 0 14px; }
  .review-details { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; } .review-details>div { display: flex; flex-direction: column; gap: 3px; } .review-details .wide { grid-column: 1 / -1; } .review-details span { color: ${C.muted}; font-size: 10.5px; text-transform: uppercase; } .review-details strong { color: ${C.gray}; font-size: 13px; overflow-wrap: anywhere; }
  .recipient-list, .exclusion-list { display: grid; gap: 0; } .recipient-list>div, .exclusion-list>div { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid ${C.line}; } .recipient-list>div:first-child, .exclusion-list>div:first-child { border-top: 0; padding-top: 0; } .recipient-list>div:last-child, .exclusion-list>div:last-child { padding-bottom: 0; } .recipient-list>div>div, .exclusion-list>div>div { flex: 1; min-width: 0; } .recipient-list strong, .exclusion-list strong { display: block; color: ${C.gray}; font-size: 12.5px; } .recipient-list small, .exclusion-list small { display: block; color: ${C.muted}; font-size: 10.5px; margin-top: 2px; overflow-wrap: anywhere; } .recipient-list>div>svg { color: ${C.good}; }
  .avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; color: ${C.navy2}; background: #EEF2F8; font: 700 10px ${MONO}; flex: 0 0 auto; }
  .send-card { position: sticky; top: 16px; padding: 22px; text-align: center; } .send-icon { display: grid; place-items: center; width: 46px; height: 46px; margin: 0 auto 12px; border-radius: 13px; color: ${C.orange}; background: #FBE7DF; } .send-card h3 { color: ${C.navy}; font-size: 19px; margin: 0; } .send-card>p { color: ${C.muted}; font-size: 12px; line-height: 1.55; }
  .primary-action, .secondary-action { width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px; border-radius: 9px; padding: 10px 14px; font-weight: 700; cursor: pointer; } .primary-action { color: #fff; background: ${C.navy}; border: 1px solid ${C.navy}; } .secondary-action { color: ${C.navy}; background: #fff; border: 1px solid ${C.line}; margin-top: 8px; }
  .safety-note { justify-content: center; color: ${C.orange}; margin-top: 14px; }
  .wizard-footer { justify-content: space-between; gap: 16px; min-height: 44px; margin-top: 20px; } .footer-actions { gap: 9px; margin-left: auto; } .back-button, .next-button { display: inline-flex; align-items: center; gap: 8px; border-radius: 9px; padding: 10px 15px; font-weight: 700; cursor: pointer; } .back-button { color: ${C.navy}; background: #fff; border: 1px solid ${C.line}; } .next-button { color: #fff; background: ${C.navy}; border: 1px solid ${C.navy}; } .next-button:disabled { opacity: .45; cursor: not-allowed; } .validation-note { color: ${C.orange}; font-size: 12px; }
  .modal-backdrop { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(17,18,62,.48); backdrop-filter: blur(3px); animation: demoFade .16s ease; } .demo-modal { width: min(430px, 100%); background: #fff; border-radius: 17px; padding: 28px; box-shadow: 0 24px 70px rgba(17,18,62,.25); text-align: center; animation: demoPop .18s ease; } .modal-icon { display: grid; place-items: center; width: 50px; height: 50px; margin: 0 auto 13px; color: ${C.orange}; background: #FBE7DF; border-radius: 14px; } .demo-modal .demo-badge { margin: 0 auto; } .demo-modal h2 { color: ${C.navy}; font-size: 23px; margin: 12px 0 7px; } .demo-modal p { color: ${C.muted}; font-size: 13px; line-height: 1.55; margin: 0 0 20px; } .demo-modal button { width: 100%; color: #fff; background: ${C.navy}; border: 0; border-radius: 9px; padding: 11px; font-weight: 700; cursor: pointer; }
  @keyframes demoFade { from { opacity: 0; } } @keyframes demoPop { from { opacity: 0; transform: translateY(8px) scale(.98); } }
  @media (max-width: 980px) { .metrics-grid { grid-template-columns: repeat(3, 1fr); } .compose-layout, .review-grid { grid-template-columns: 1fr; } .variables-card, .send-card { position: static; } .preview-layout { grid-template-columns: 210px minmax(0, 1fr); } }
  @media (max-width: 720px) { .email-campaigns-page { padding: 20px 14px 60px; } .campaign-heading, .section-title { align-items: flex-start; flex-direction: column; } .previewing-note { width: 100%; } .gmail-connection-card { grid-template-columns: auto minmax(0, 1fr); align-items: start; } .gmail-connection-card form, .gmail-connection-card>.gmail-action { grid-column: 1 / -1; width: 100%; } .stepper { grid-template-columns: repeat(4, minmax(48px, 1fr)); } .step { flex-direction: column; gap: 4px; font-size: 10px; padding: 7px 2px; } .metrics-grid { grid-template-columns: repeat(2, 1fr); } .compose-layout, .preview-layout, .review-grid { grid-template-columns: 1fr; } .two-col, .review-details { grid-template-columns: 1fr; } .preview-title { align-items: stretch; } .recipient-switcher select { flex: 1; min-width: 0; } .email-meta { padding: 12px 14px; } .email-meta>div { grid-template-columns: 58px 1fr; } .email-body { min-height: 300px; padding: 22px 18px 30px; } .wizard-footer { align-items: flex-start; flex-direction: column; } .footer-actions { width: 100%; } .footer-actions button { flex: 1; justify-content: center; } }
  @media (max-width: 430px) { .metrics-grid { grid-template-columns: 1fr; } .metric div span { white-space: normal; } .step>span:last-child { display: none; } }
`;
