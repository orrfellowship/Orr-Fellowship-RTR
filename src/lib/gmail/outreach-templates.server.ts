import { createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus, type AppRole } from "@/lib/types";
import {
  findManualPlaceholders,
  findUnsupportedOutreachVariables,
  normalizeOutreachMergeVariables,
  materializeTemplateBundle,
  type TemplateReplacements,
} from "./candidate-tokens";
import { GmailTestSendError } from "./test-send.server";

// ============================================================================
// Admin-curated outreach templates (phase 23).
//
// The product rule: fellows and team leads may only send outreach from a
// template an admin/super-admin created. resolveCampaignContent() is the
// server-side enforcement point. Non-admins may edit the template's prefilled
// subject/body for their campaign, while admins may also free-compose without
// selecting a template.
//
// Attachments belong to templates (admin-managed). At enqueue the current
// attachment list is snapshotted onto the campaign, so later template edits
// never change an in-flight send.
// ============================================================================

export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 5 * 1024 * 1024,      // 5 MB per file
  maxTotalBytes: 10 * 1024 * 1024,    // 10 MB per template (Gmail raw cap is ~35 MB)
} as const;

// File types admins may attach — outreach collateral, not arbitrary uploads.
export const ATTACHMENT_MIME_ALLOWLIST = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
]);

export const ATTACHMENTS_BUCKET = "outreach-attachments";

export type TemplateAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

export type OutreachTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  isArchived: boolean;
  updatedAt: string;
  attachments: TemplateAttachment[];
};

// The snapshot stored on outreach_campaigns.attachments.
export type CampaignAttachment = {
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

export function toCampaignAttachments(attachments: TemplateAttachment[]): CampaignAttachment[] {
  return attachments.map((a) => ({
    storage_path: a.storagePath, file_name: a.fileName, mime_type: a.mimeType, size_bytes: a.sizeBytes,
  }));
}

export async function listOutreachTemplates(opts: { includeArchived?: boolean } = {}): Promise<OutreachTemplate[]> {
  const db = createServiceClient();
  let q = db.from("outreach_templates")
    .select("id, name, subject, body, is_archived, updated_at, outreach_template_attachments(id, file_name, mime_type, size_bytes, storage_path)")
    .order("updated_at", { ascending: false });
  if (!opts.includeArchived) q = q.eq("is_archived", false);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load outreach templates: ${error.message}`);
  return (data ?? []).map((t: any) => ({
    id: t.id, name: t.name,
    subject: normalizeOutreachMergeVariables(t.subject),
    body: normalizeOutreachMergeVariables(t.body),
    isArchived: t.is_archived, updatedAt: t.updated_at,
    attachments: (t.outreach_template_attachments ?? []).map((a: any) => ({
      id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: Number(a.size_bytes), storagePath: a.storage_path,
    })),
  }));
}

export type ResolvedCampaignContent = {
  subject: string;
  body: string;
  templateId: string | null;
  attachments: CampaignAttachment[];
};

export function validateResolvedCampaignText(content: { subject: string; body: string }): void {
  if (
    !content.subject.trim()
    || !content.body.trim()
    || content.subject.length > 200
    || content.body.length > 20_000
    || /[\r\n]/.test(content.subject)
  ) {
    throw new GmailTestSendError("invalid_campaign", "The completed template subject or message is invalid or too long.", 400);
  }
}

// Pure decision core (unit-tested): who gets to send what.
export function resolveContentForSender(
  role: AppRole,
  client: { subject: string; body: string },
  template: OutreachTemplate | null,
  replacements: TemplateReplacements = {},
): ResolvedCampaignContent {
  if (!isAdminPlus(role)) {
    // Fellows/leads: a live admin template is REQUIRED, and the ONLY thing they
    // can change is the [blank] values. The subject/body are re-materialized
    // from the stored template around those values — never trusted from the
    // browser — so the fixed copy can't be altered. Attachments come only from
    // the server-loaded template.
    if (!template || template.isArchived) {
      throw new GmailTestSendError("template_required", "Pick one of the templates provided by your admins before sending.", 400);
    }
    const materialized = materializeTemplateBundle([template.subject, template.body], replacements);
    if (!materialized.ok) {
      const message = materialized.reason === "unfilled_placeholder"
        ? "Fill in every blank in the template before sending."
        : materialized.reason === "replacement_keys_changed"
          ? "The template changed — reopen it and fill the blanks again."
          : "One of the values you filled in isn't allowed (it can't contain a merge field or another blank).";
      throw new GmailTestSendError("invalid_replacement", message, 400);
    }
    const [subject, body] = materialized.values;
    return { subject, body, templateId: template.id, attachments: toCampaignAttachments(template.attachments) };
  }
  // Admins: template optional and free-composed. When one is picked its
  // attachments ride along, but the (possibly edited) client copy is what sends.
  const clientContent = {
    subject: normalizeOutreachMergeVariables(client.subject),
    body: normalizeOutreachMergeVariables(client.body),
  };
  if (template && !template.isArchived) {
    return { ...clientContent, templateId: template.id, attachments: toCampaignAttachments(template.attachments) };
  }
  return { ...clientContent, templateId: null, attachments: [] };
}

export async function resolveCampaignContent(
  role: AppRole,
  client: { subject: string; body: string },
  templateId: string | null,
  replacements: TemplateReplacements = {},
): Promise<ResolvedCampaignContent> {
  let template: OutreachTemplate | null = null;
  if (templateId) {
    const db = createServiceClient();
    const { data, error } = await db.from("outreach_templates")
      .select("id, name, subject, body, is_archived, updated_at, outreach_template_attachments(id, file_name, mime_type, size_bytes, storage_path)")
      .eq("id", templateId).maybeSingle();
    if (error) throw new GmailTestSendError("template_unavailable", "The selected template could not be loaded.", 502);
    if (data) {
      template = {
        id: (data as any).id, name: (data as any).name, subject: (data as any).subject, body: (data as any).body,
        isArchived: (data as any).is_archived, updatedAt: (data as any).updated_at,
        attachments: ((data as any).outreach_template_attachments ?? []).map((a: any) => ({
          id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: Number(a.size_bytes), storagePath: a.storage_path,
        })),
      };
    }
  }
  const resolved = resolveContentForSender(role, client, template, replacements);
  // Re-check limits on the resolved content at the server boundary.
  validateResolvedCampaignText(resolved);
  // Templates are validated at save, but re-check here so a template edited
  // directly in the database can't ship an unresolved {{token}}.
  const unsupported = [
    ...findUnsupportedOutreachVariables(resolved.subject),
    ...findUnsupportedOutreachVariables(resolved.body),
  ];
  if (unsupported.length) {
    throw new GmailTestSendError("unsupported_merge_variable", `The template contains unknown merge field(s): ${unsupported.join(", ")}. Ask an admin to fix it.`, 400);
  }
  // Single-bracket [placeholders] must be filled in before anything goes out —
  // they never auto-fill, so a live send would email the literal "[text]".
  const placeholders = [
    ...findManualPlaceholders(resolved.subject),
    ...findManualPlaceholders(resolved.body),
  ];
  if (placeholders.length) {
    const noun = isAdminPlus(role) ? "Fill in" : "The template still has";
    throw new GmailTestSendError("unfilled_placeholder", `${noun} the placeholder(s) ${[...new Set(placeholders)].join(", ")} before sending.${isAdminPlus(role) ? "" : " Ask an admin to finish the template."}`, 400);
  }
  return resolved;
}

// Download one stored attachment as plain base64 (drain-time). Throws on any
// storage failure — the queue treats that as retryable.
export async function loadAttachmentBase64(storagePath: string): Promise<string> {
  const db = createServiceClient();
  const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`Attachment unavailable: ${storagePath}`);
  return Buffer.from(await data.arrayBuffer()).toString("base64");
}

// ============================================================================
// Per-send (sender-owned) attachments — files a fellow/admin attaches to their
// own campaign, tracked in outreach_campaign_uploads so the send never trusts a
// raw client storage path. Stored in the same private bucket under a per-user
// prefix.
// ============================================================================

const CAMPAIGN_UPLOADS_PREFIX = "campaign-uploads";
// A sender may attach at most this many of their own files to one campaign.
export const MAX_CAMPAIGN_UPLOADS = 5;

export type CampaignUploadView = { id: string; fileName: string; mimeType: string; sizeBytes: number };

// Validate + store one uploaded file for a user, returning a client-safe view
// (no storage path). Reuses the template attachment type/size allowlist.
export async function saveCampaignUpload(userId: string, file: File): Promise<CampaignUploadView | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to attach." };
  if (!ATTACHMENT_MIME_ALLOWLIST.has(file.type)) return { error: "Allowed types: PDF, PNG, JPG, DOCX, PPTX." };
  if (file.size > ATTACHMENT_LIMITS.maxFileBytes) return { error: `Files must be ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB or smaller.` };

  const db = createServiceClient();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "attachment";
  const storagePath = `${CAMPAIGN_UPLOADS_PREFIX}/${userId}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await db.storage.from(ATTACHMENTS_BUCKET)
    .upload(storagePath, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) return { error: "Upload failed — try again." };

  const { data, error } = await db.from("outreach_campaign_uploads")
    .insert({ user_id: userId, file_name: safeName, mime_type: file.type, size_bytes: file.size, storage_path: storagePath })
    .select("id").single();
  if (error || !data) {
    await db.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]); // don't orphan the object
    return { error: "Upload could not be saved." };
  }
  return { id: (data as any).id as string, fileName: safeName, mimeType: file.type, sizeBytes: file.size };
}

// Load the sender's uploads for the given ids — scoped to user_id so a client
// can never attach another user's file. Returns campaign-attachment snapshots.
export async function loadCampaignUploads(userId: string, ids: string[]): Promise<CampaignAttachment[]> {
  if (!ids.length) return [];
  const db = createServiceClient();
  const { data, error } = await db.from("outreach_campaign_uploads")
    .select("id, file_name, mime_type, size_bytes, storage_path")
    .eq("user_id", userId)
    .in("id", ids.slice(0, MAX_CAMPAIGN_UPLOADS));
  if (error) throw new GmailTestSendError("attachment_unavailable", "Your attachment could not be loaded.", 502);
  return (data ?? []).map((r: any) => ({
    storage_path: r.storage_path, file_name: r.file_name, mime_type: r.mime_type, size_bytes: Number(r.size_bytes),
  }));
}
