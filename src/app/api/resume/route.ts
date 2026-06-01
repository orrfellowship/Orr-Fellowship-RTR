import { type NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getResumeDocument } from "@/lib/jazzhr-documents";
import { fetchJazzResume, JazzAuthExpiredError } from "@/lib/jazzhr-resume";

const JAZZ_BASE = "https://api.resumatorapi.com/v1";
const BUCKET = "resumes";
const SIGNED_URL_TTL = 60 * 10; // 10 minutes

// Resume fetch for a JazzHR applicant.
//
// Preferred path (when JAZZHR_SANDCASTLE_TICKET is set): look up the candidate's
// resume documentId via the authenticated documentList endpoint, download the
// PDF, cache it in the private Supabase `resumes` bucket, and return a short-
// lived signed URL as JSON { url, filename }. Caching means the ticket is only
// exercised on the FIRST view of each candidate.
//
// Fallback path (no ticket, ticket expired, or no document found): stream the
// legacy resumator resume_link, which still works for pre-signed links. This
// keeps the feature degraded-but-working until the ticket flow is configured.
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jazzId = request.nextUrl.searchParams.get("jazzId");
  if (!jazzId) {
    return NextResponse.json({ error: "jazzId param required" }, { status: 400 });
  }
  const jobId = request.nextUrl.searchParams.get("jobId") ?? "";

  // --- Preferred path: authenticated download + Supabase cache + signed URL ---
  const ticket = process.env.JAZZHR_SANDCASTLE_TICKET;
  if (ticket) {
    try {
      const doc = await getResumeDocument(jazzId, jobId, ticket);
      if (doc) {
        const db = createServiceClient();
        const path = `${jazzId}/${doc.documentId}.pdf`;

        const { data: existing } = await db.storage
          .from(BUCKET)
          .list(jazzId, { search: `${doc.documentId}.pdf` });

        if (!existing?.length) {
          const { buffer, contentType } = await fetchJazzResume(doc.documentId, ticket);
          const { error } = await db.storage
            .from(BUCKET)
            .upload(path, buffer, { contentType, upsert: true });
          if (error) throw error;
        }

        const { data: signed, error: signErr } = await db.storage
          .from(BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL);
        if (signErr) throw signErr;

        return NextResponse.json({ url: signed.signedUrl, filename: doc.name });
      }
      // No resume document found via the ticket path → fall through to legacy.
    } catch (e: any) {
      if (e instanceof JazzAuthExpiredError) {
        return NextResponse.json({ error: e.message, needsRefresh: true }, { status: 401 });
      }
      // Any other error (bad URL template, bucket missing, etc.) → try legacy.
    }
  }

  // --- Legacy fallback: stream the resumator resume_link --------------------
  const apiKey = process.env.JAZZHR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "JAZZHR_API_KEY not configured" }, { status: 500 });
  }

  const applicantRes = await fetch(`${JAZZ_BASE}/applicants/${jazzId}?apikey=${apiKey}`);
  if (!applicantRes.ok) {
    return NextResponse.json(
      { error: `JazzHR applicant fetch failed: ${applicantRes.status}` },
      { status: 502 }
    );
  }
  const applicant = await applicantRes.json();
  const resumeUrl: string | null = applicant?.resume_link ?? null;
  if (!resumeUrl) {
    return NextResponse.json({ error: "No resume on file for this applicant" }, { status: 404 });
  }

  let fileRes = await fetch(resumeUrl);
  if (fileRes.status === 401 || fileRes.status === 403) {
    const sep = resumeUrl.includes("?") ? "&" : "?";
    fileRes = await fetch(`${resumeUrl}${sep}apikey=${apiKey}`);
  }

  if (!fileRes.ok) {
    return NextResponse.json(
      { unavailable: true, error: "Resume file is private — view this candidate directly in JazzHR." },
      { status: 422 }
    );
  }

  const contentType = fileRes.headers.get("content-type") ?? "application/octet-stream";
  const ext = contentType.includes("pdf") ? "pdf" : contentType.includes("word") ? "docx" : "pdf";

  return new NextResponse(fileRes.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="resume.${ext}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
