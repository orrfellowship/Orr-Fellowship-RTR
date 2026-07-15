"use client";

import { useRef, useState, type FormEvent } from "react";
import { Beaker, CheckCircle2, CircleAlert, Send } from "lucide-react";
import { GMAIL_TEST_SEND_LIMITS, type GmailConnectionStatus } from "@/lib/gmail/types";

type ApiResult =
  | { success: true; messageId: string; threadId: string | null }
  | { success: false; error: { code: string; message: string } };

export default function GmailTestSendPanel({ connection }: { connection: GmailConnectionStatus }) {
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const inFlight = useRef(false);

  const ready = connection.connected
    && confirmed
    && recipient.trim().length > 0
    && subject.trim().length > 0
    && body.trim().length > 0
    && !sending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setResult(null);
    try {
      const response = await fetch("/api/google/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient, subject, body }),
      });
      const payload = await response.json() as ApiResult;
      if (!response.ok || payload.success !== true) {
        setResult(payload.success === false
          ? payload
          : { success: false, error: { code: "send_failed", message: "The Gmail test message could not be sent." } });
        return;
      }
      setResult(payload);
      setConfirmed(false);
    } catch {
      setResult({ success: false, error: { code: "network_error", message: "The Gmail test message could not be sent." } });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <section className="gmail-test-panel" aria-labelledby="gmail-test-title">
      <style>{styles}</style>
      <div className="gmail-test-heading">
        <span className="gmail-test-icon"><Beaker size={20} /></span>
        <div>
          <div className="gmail-test-title-line">
            <h2 id="gmail-test-title">Developer Gmail test</h2>
            <span>Local only · real email</span>
          </div>
          <p>Send exactly one real plain-text email through the connected Gmail account. This does not use campaign or candidate data.</p>
        </div>
      </div>

      <div className="gmail-test-sender">
        <span>Connected sender</span>
        <strong>{connection.connectedEmail ?? "No Gmail account connected"}</strong>
      </div>

      <form onSubmit={handleSubmit}>
        <label>
          <span>Test recipient</span>
          <input
            type="email"
            autoComplete="email"
            value={recipient}
            maxLength={GMAIL_TEST_SEND_LIMITS.recipient}
            disabled={!connection.connected || sending}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="recipient@example.com"
            required
          />
        </label>
        <label>
          <span>Subject</span>
          <input
            value={subject}
            maxLength={GMAIL_TEST_SEND_LIMITS.subject}
            disabled={!connection.connected || sending}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Gmail API test"
            required
          />
        </label>
        <label className="gmail-test-message">
          <span>Plain-text message</span>
          <textarea
            value={body}
            maxLength={GMAIL_TEST_SEND_LIMITS.body}
            disabled={!connection.connected || sending}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            placeholder="Enter one test message."
            required
          />
        </label>
        <label className="gmail-test-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!connection.connected || sending}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I understand this will send one real email.</span>
        </label>
        <button type="submit" disabled={!ready}>
          <Send size={16} /> {sending ? "Sending one email…" : "Send one Gmail test"}
        </button>
      </form>

      {!connection.connected && (
        <div className="gmail-test-result error" role="status"><CircleAlert size={16} /> Connect Gmail before using this test.</div>
      )}
      {result?.success === true && (
        <div className="gmail-test-result success" role="status"><CheckCircle2 size={16} /> Sent one real email. Gmail message ID: <code>{result.messageId}</code></div>
      )}
      {result?.success === false && (
        <div className="gmail-test-result error" role="alert"><CircleAlert size={16} /> {result.error.message}</div>
      )}
    </section>
  );
}

const styles = `
  .gmail-test-panel { margin: 0 0 18px; padding: 18px; background: #FFFCF5; border: 1px solid #E8D7A5; border-radius: 14px; color: #303333; }
  .gmail-test-heading { display: flex; align-items: flex-start; gap: 12px; }
  .gmail-test-icon { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 auto; color: #8A6816; background: #F8EECF; border-radius: 10px; }
  .gmail-test-title-line { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .gmail-test-title-line h2 { margin: 0; color: #11123E; font-size: 17px; }
  .gmail-test-title-line>span { padding: 3px 7px; color: #8A6816; background: #F8EECF; border-radius: 999px; font: 700 9.5px 'JetBrains Mono', ui-monospace, monospace; text-transform: uppercase; letter-spacing: .3px; }
  .gmail-test-heading p { margin: 4px 0 0; color: #6E7385; font-size: 12px; line-height: 1.5; }
  .gmail-test-sender { display: flex; align-items: center; gap: 9px; margin: 14px 0; padding: 9px 11px; background: #fff; border: 1px solid #ECE3CA; border-radius: 9px; font-size: 12px; }
  .gmail-test-sender span { color: #6E7385; } .gmail-test-sender strong { color: #11123E; overflow-wrap: anywhere; }
  .gmail-test-panel form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .gmail-test-panel form>label:not(.gmail-test-confirmation) { display: grid; gap: 6px; color: #11123E; font-size: 12px; font-weight: 700; }
  .gmail-test-panel input:not([type='checkbox']), .gmail-test-panel textarea { width: 100%; border: 1px solid #DADDE6; border-radius: 9px; background: #fff; color: #303333; padding: 10px 12px; font: 13px 'Open Sans', sans-serif; outline: none; }
  .gmail-test-panel input:focus, .gmail-test-panel textarea:focus { border-color: #8A6816; box-shadow: 0 0 0 3px rgba(138,104,22,.1); }
  .gmail-test-panel input:disabled, .gmail-test-panel textarea:disabled { background: #F5F5F5; cursor: not-allowed; }
  .gmail-test-message { grid-column: 1 / -1; } .gmail-test-message textarea { resize: vertical; }
  .gmail-test-confirmation { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; color: #6B5315; font-size: 12px; font-weight: 700; }
  .gmail-test-confirmation input { width: 16px; height: 16px; accent-color: #8A6816; }
  .gmail-test-panel form>button { grid-column: 1 / -1; display: inline-flex; justify-content: center; align-items: center; gap: 8px; width: fit-content; border: 1px solid #8A6816; border-radius: 9px; padding: 9px 14px; color: #fff; background: #8A6816; font-weight: 700; cursor: pointer; }
  .gmail-test-panel form>button:disabled { opacity: .45; cursor: not-allowed; }
  .gmail-test-result { display: flex; align-items: center; gap: 7px; margin-top: 12px; padding: 9px 11px; border-radius: 9px; font-size: 12px; font-weight: 600; }
  .gmail-test-result svg { flex: 0 0 auto; } .gmail-test-result.success { color: #2F8F6B; background: #E8F5EE; } .gmail-test-result.error { color: #B7432A; background: #FBE7DF; }
  .gmail-test-result code { font: 600 11px 'JetBrains Mono', ui-monospace, monospace; overflow-wrap: anywhere; }
  @media (max-width: 720px) { .gmail-test-panel form { grid-template-columns: 1fr; } .gmail-test-panel form>* { grid-column: 1 !important; } .gmail-test-panel form>button { width: 100%; } }
`;
