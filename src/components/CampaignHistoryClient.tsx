"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  Mail,
  MessageCircleReply,
  Search,
  Send,
  X,
} from "lucide-react";
import type {
  CampaignHistoryData,
  CampaignHistoryFilters,
  CampaignHistoryRow,
} from "@/lib/gmail/campaign-history";

type RecipientDetail = {
  candidateName: string;
  status: "sent" | "failed" | "excluded" | "pending";
  failureReason?: string;
  exclusionReason?: string;
  replied?: boolean;
  bounced?: boolean;
};

type DetailResponse = {
  success: boolean;
  recipients?: RecipientDetail[];
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  partial: "Partial",
  failed: "Failed",
  canceled: "Canceled",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "sent") return { color: "#1D7A57", background: "#EAF6F0" };
  if (status === "partial" || status === "sending") return { color: "#946A09", background: "#FBF3D9" };
  if (status === "failed") return { color: "#B53B2D", background: "#FBE9E6" };
  return { color: "#6E7385", background: "#F0F1F5" };
}

export default function CampaignHistoryClient({
  data,
  filters,
}: {
  data: CampaignHistoryData;
  filters: CampaignHistoryFilters;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q ?? "");
  const [selected, setSelected] = useState<CampaignHistoryRow | null>(null);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const navigate = (changes: Partial<CampaignHistoryFilters>) => {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    if (next.q?.trim()) params.set("q", next.q.trim());
    if (next.senderId) params.set("sender", next.senderId);
    if (next.schoolId) params.set("school", next.schoolId);
    if (next.status) params.set("status", next.status);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.page && next.page > 0) params.set("page", String(next.page + 1));
    startTransition(() => router.replace(`/console/campaign-history${params.size ? `?${params}` : ""}`));
  };

  const clearFilters = () => {
    setQuery("");
    startTransition(() => router.replace("/console/campaign-history"));
  };

  const first = data.total === 0 ? 0 : data.page * data.pageSize + 1;
  const last = Math.min((data.page + 1) * data.pageSize, data.total);
  const pageSent = data.rows.reduce((sum, row) => sum + row.sent, 0);
  const pageReplies = data.rows.reduce((sum, row) => sum + row.replied, 0);
  const pageIssues = data.rows.reduce((sum, row) => sum + row.failed + row.bounced, 0);
  const hasFilters = !!(filters.q || filters.senderId || filters.schoolId || filters.status || filters.from || filters.to);

  return (
    <div className={`campaign-history-page${pending ? " is-loading" : ""}`}>
      <style>{styles}</style>

      <div className="history-heading">
        <div>
          <h1>Campaign History</h1>
          <p>Review candidate outreach sent across every school and recruiting team.</p>
        </div>
        <div className="history-count"><Mail size={17} /> {data.total.toLocaleString()} campaign{data.total === 1 ? "" : "s"}</div>
      </div>

      <div className="history-summary">
        <Summary icon={<Send size={18} />} label="Sent on this page" value={pageSent} tone="#315D9A" />
        <Summary icon={<MessageCircleReply size={18} />} label="Replies on this page" value={pageReplies} tone="#1D7A57" />
        <Summary icon={<AlertCircle size={18} />} label="Issues on this page" value={pageIssues} tone="#B53B2D" />
      </div>

      <section className="history-card">
        <form
          className="history-filters"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ q: query, page: 0 });
          }}
        >
          <label className="history-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search campaign name…" />
          </label>
          <select aria-label="Filter by sender" value={filters.senderId ?? ""} onChange={(event) => navigate({ senderId: event.target.value || undefined, page: 0 })}>
            <option value="">All senders</option>
            {data.senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.name}</option>)}
          </select>
          <select aria-label="Filter by school" value={filters.schoolId ?? ""} onChange={(event) => navigate({ schoolId: event.target.value || undefined, page: 0 })}>
            <option value="">All schools</option>
            {data.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <select aria-label="Filter by status" value={filters.status ?? ""} onChange={(event) => navigate({ status: event.target.value || undefined, page: 0 })}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input aria-label="From date" title="From date" type="date" value={filters.from ?? ""} onChange={(event) => navigate({ from: event.target.value || undefined, page: 0 })} />
          <input aria-label="To date" title="To date" type="date" value={filters.to ?? ""} onChange={(event) => navigate({ to: event.target.value || undefined, page: 0 })} />
          {hasFilters && <button className="clear-filters" type="button" onClick={clearFilters}>Clear</button>}
        </form>

        <div className="history-table-wrap">
          <div className="history-table history-table-head">
            <span>Campaign</span>
            <span>Sender</span>
            <span>Recipients</span>
            <span>Sent</span>
            <span>Replies</span>
            <span>Issues</span>
            <span>Status</span>
            <span aria-hidden />
          </div>
          {data.rows.map((campaign) => (
            <button className="history-table history-row" type="button" key={campaign.id} onClick={() => setSelected(campaign)}>
              <span className="campaign-cell">
                <strong>{campaign.name}</strong>
                <small>{formatDate(campaign.createdAt)}</small>
              </span>
              <span className="sender-cell">
                <strong>{campaign.sender.name}</strong>
                <small>{campaign.sender.schoolName ?? "Orr Fellowship"}</small>
              </span>
              <span>{campaign.total.toLocaleString()}</span>
              <span className="metric-good">{campaign.sent.toLocaleString()}</span>
              <span>{campaign.replied.toLocaleString()}</span>
              <span className={campaign.failed + campaign.bounced ? "metric-bad" : ""}>{(campaign.failed + campaign.bounced).toLocaleString()}</span>
              <span><StatusBadge status={campaign.status} /></span>
              <span className="view-icon"><Eye size={17} /></span>
            </button>
          ))}
          {data.rows.length === 0 && (
            <div className="history-empty">
              <Mail size={28} />
              <strong>No campaigns found</strong>
              <span>{hasFilters ? "Try clearing or changing the filters." : "Sent campaigns will appear here."}</span>
            </div>
          )}
        </div>

        <div className="history-pagination">
          <span>{first.toLocaleString()}–{last.toLocaleString()} of {data.total.toLocaleString()}</span>
          <div>
            <button type="button" disabled={data.page === 0 || pending} onClick={() => navigate({ page: data.page - 1 })}><ArrowLeft size={15} /> Prev</button>
            <span>Page {data.page + 1} of {pages}</span>
            <button type="button" disabled={data.page >= pages - 1 || pending} onClick={() => navigate({ page: data.page + 1 })}>Next <ArrowRight size={15} /></button>
          </div>
        </div>
      </section>

      {selected && <CampaignDetail campaign={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Summary({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="summary-card">
      <span className="summary-icon" style={{ color: tone, background: `${tone}14` }}>{icon}</span>
      <span><small>{label}</small><strong>{value.toLocaleString()}</strong></span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return <span className="status-badge" style={tone}>{STATUS_LABELS[status] ?? status}</span>;
}

function CampaignDetail({ campaign, onClose }: { campaign: CampaignHistoryRow; onClose: () => void }) {
  const [recipients, setRecipients] = useState<RecipientDetail[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/google/campaign-status?id=${encodeURIComponent(campaign.id)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: DetailResponse) => {
        if (!active) return;
        if (!payload.success) setFailed(true);
        else setRecipients(payload.recipients ?? []);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [campaign.id]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="detail-panel" role="dialog" aria-modal="true" aria-label={`${campaign.name} campaign details`}>
        <div className="detail-header">
          <div>
            <span className="eyebrow">Campaign details</span>
            <h2>{campaign.name}</h2>
            <p>{formatDate(campaign.createdAt)} · {campaign.sender.name}</p>
          </div>
          <button type="button" aria-label="Close campaign details" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="detail-scroll">
          <div className="detail-stats">
            <span><small>Recipients</small><strong>{campaign.total}</strong></span>
            <span><small>Sent</small><strong>{campaign.sent}</strong></span>
            <span><small>Replies</small><strong>{campaign.replied}</strong></span>
            <span><small>Failed</small><strong>{campaign.failed}</strong></span>
          </div>

          <section className="detail-section">
            <div className="detail-section-title"><h3>Email preview</h3><StatusBadge status={campaign.status} /></div>
            <div className="email-preview">
              <div><small>Subject</small><strong>{campaign.subject}</strong></div>
              <div className="email-body">{campaign.body}</div>
            </div>
          </section>

          <section className="detail-section">
            <h3>Recipient results</h3>
            {failed && <div className="detail-message">Recipient details could not be loaded.</div>}
            {!failed && !recipients && <div className="detail-message">Loading recipient results…</div>}
            {recipients && recipients.length === 0 && <div className="detail-message">No recipient results.</div>}
            {recipients && recipients.length > 0 && (
              <div className="recipient-list">
                {recipients.map((recipient, index) => (
                  <div className="recipient-row" key={`${recipient.candidateName}-${index}`}>
                    <span className={`recipient-icon ${recipient.status}`}>
                      {recipient.status === "sent" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    </span>
                    <span className="recipient-name">
                      <strong>{recipient.candidateName}</strong>
                      {(recipient.failureReason || recipient.exclusionReason) && <small>{recipient.failureReason ?? recipient.exclusionReason}</small>}
                    </span>
                    <span className="recipient-flags">
                      {recipient.replied && <em>Replied</em>}
                      {recipient.bounced && <em className="bounced">Bounced</em>}
                      {!recipient.replied && !recipient.bounced && <small>{recipient.status}</small>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

const styles = `
  .campaign-history-page{max-width:1420px;margin:0 auto;padding:30px 28px 80px;color:#211d44;transition:opacity .15s}
  .campaign-history-page.is-loading{opacity:.68}
  .history-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
  .history-heading h1{font-family:var(--font-heading);font-size:30px;line-height:1.1;margin:0 0 7px;color:#11123e}
  .history-heading p{margin:0;color:#6e7385;font-size:15px}
  .history-count{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e4e7ee;border-radius:12px;padding:10px 14px;color:#5c5878;font-size:13px;font-weight:700;white-space:nowrap}
  .history-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}
  .summary-card{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e4e7ee;border-radius:14px;padding:15px 17px}
  .summary-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none}
  .summary-card>span:last-child{display:flex;flex-direction:column;gap:2px}
  .summary-card small{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#938fad;font-weight:700}
  .summary-card strong{font-size:20px;color:#11123e}
  .history-card{background:#fff;border:1px solid #e4e7ee;border-radius:16px;overflow:hidden}
  .history-filters{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:14px;border-bottom:1px solid #e4e7ee}
  .history-filters select,.history-filters input{box-sizing:border-box;border:1px solid #e4e7ee;border-radius:9px;background:#fff;color:#303333;font:600 12.5px var(--font-body);height:38px;padding:0 10px}
  .history-search{display:flex;align-items:center;gap:8px;flex:1 1 210px;min-width:190px;height:38px;padding:0 11px;border:1px solid #e4e7ee;border-radius:9px;color:#938fad}
  .history-search input{height:auto;padding:0;border:0;outline:0;width:100%;font-weight:500}
  .clear-filters{height:38px;border:0;background:transparent;color:#d94b31;font-weight:700;cursor:pointer;padding:0 8px}
  .history-table-wrap{overflow-x:auto}
  .history-table{display:grid;grid-template-columns:minmax(220px,1.65fr) minmax(180px,1.25fr) 86px 70px 75px 70px 92px 32px;gap:12px;align-items:center;min-width:940px;text-align:left}
  .history-table-head{padding:11px 18px;background:#fafbfe;color:#7d7992;font-family:var(--font-heading);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.035em;border-bottom:1px solid #e4e7ee}
  .history-row{width:100%;padding:13px 18px;border:0;border-bottom:1px solid #eceef3;background:#fff;color:#303333;font:500 13px var(--font-body);cursor:pointer}
  .history-row:last-child{border-bottom:0}
  .history-row:hover{background:#fbfbfe}
  .campaign-cell,.sender-cell{display:flex;flex-direction:column;min-width:0;gap:3px}
  .campaign-cell strong,.sender-cell strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#211d44;font-size:13.5px}
  .campaign-cell small,.sender-cell small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b879d;font-size:11.5px}
  .metric-good{color:#1d7a57;font-weight:700}.metric-bad{color:#b53b2d;font-weight:700}
  .status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.025em}
  .view-icon{color:#938fad;display:grid;place-items:center}
  .history-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:230px;color:#938fad}
  .history-empty strong{color:#211d44}.history-empty span{font-size:13px}
  .history-pagination{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border-top:1px solid #e4e7ee;color:#7d7992;font-size:12.5px}
  .history-pagination>div{display:flex;align-items:center;gap:10px}
  .history-pagination button{display:flex;align-items:center;gap:5px;border:1px solid #e4e7ee;background:#fff;color:#211d44;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer}
  .history-pagination button:disabled{opacity:.45;cursor:default}
  .detail-overlay{position:fixed;inset:0;z-index:100;background:rgba(17,18,62,.28);display:flex;justify-content:flex-end;animation:historyFade .15s ease}
  .detail-panel{width:min(620px,100%);height:100%;background:#f7f8fb;box-shadow:-18px 0 50px rgba(17,18,62,.17);display:flex;flex-direction:column;animation:historySlide .2s ease}
  .detail-header{display:flex;justify-content:space-between;gap:16px;padding:22px 24px;background:#fff;border-bottom:1px solid #e4e7ee}
  .detail-header h2{margin:4px 0 5px;font:700 23px var(--font-heading);color:#11123e}
  .detail-header p{margin:0;color:#7d7992;font-size:12.5px}
  .detail-header button{width:36px;height:36px;display:grid;place-items:center;border:1px solid #e4e7ee;background:#fff;color:#5c5878;border-radius:9px;cursor:pointer}
  .eyebrow{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:#d94b31}
  .detail-scroll{padding:18px 22px 40px;overflow-y:auto}
  .detail-stats{display:grid;grid-template-columns:repeat(4,1fr);background:#fff;border:1px solid #e4e7ee;border-radius:13px;margin-bottom:16px}
  .detail-stats span{display:flex;flex-direction:column;gap:4px;padding:13px 15px;border-right:1px solid #e4e7ee}
  .detail-stats span:last-child{border-right:0}.detail-stats small{color:#8b879d;font-size:10.5px;text-transform:uppercase;font-weight:700}.detail-stats strong{font-size:19px;color:#11123e}
  .detail-section{margin-top:16px}.detail-section h3{margin:0 0 10px;font:700 15px var(--font-heading);color:#211d44}
  .detail-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .email-preview{background:#fff;border:1px solid #e4e7ee;border-radius:13px;overflow:hidden}
  .email-preview>div:first-child{display:flex;flex-direction:column;gap:4px;padding:13px 15px;border-bottom:1px solid #e4e7ee}
  .email-preview small{color:#8b879d;font-size:10.5px;text-transform:uppercase;font-weight:700}
  .email-preview strong{font-size:13.5px;color:#303333}
  .email-body{padding:17px 15px;white-space:pre-wrap;line-height:1.55;color:#454653;font-size:13.5px;max-height:310px;overflow-y:auto}
  .detail-message{padding:18px;background:#fff;border:1px solid #e4e7ee;border-radius:12px;color:#8b879d;font-size:13px;text-align:center}
  .recipient-list{background:#fff;border:1px solid #e4e7ee;border-radius:12px;overflow:hidden}
  .recipient-row{display:flex;align-items:center;gap:10px;padding:11px 13px;border-bottom:1px solid #eceef3}.recipient-row:last-child{border:0}
  .recipient-icon{display:grid;place-items:center;color:#946a09}.recipient-icon.sent{color:#1d7a57}.recipient-icon.failed{color:#b53b2d}
  .recipient-name{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}.recipient-name strong{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recipient-name small{font-size:11px;color:#b53b2d}
  .recipient-flags{display:flex;gap:5px;align-items:center}.recipient-flags em{font-style:normal;font-size:10px;font-weight:800;color:#1d7a57;background:#eaf6f0;border-radius:99px;padding:3px 7px}.recipient-flags em.bounced{color:#b53b2d;background:#fbe9e6}.recipient-flags small{text-transform:capitalize;color:#8b879d}
  @keyframes historyFade{from{opacity:0}to{opacity:1}}@keyframes historySlide{from{transform:translateX(24px)}to{transform:none}}
  @media(max-width:760px){.campaign-history-page{padding:20px 14px 60px}.history-heading{flex-direction:column}.history-summary{grid-template-columns:1fr}.history-filters>*{flex:1 1 140px}.history-search{flex-basis:100%}.history-pagination{align-items:flex-start;flex-direction:column}.detail-stats{grid-template-columns:repeat(2,1fr)}.detail-stats span:nth-child(2){border-right:0}.detail-stats span:nth-child(-n+2){border-bottom:1px solid #e4e7ee}}
`;
