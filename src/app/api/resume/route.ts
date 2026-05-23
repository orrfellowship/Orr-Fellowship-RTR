import { type NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

const JAZZ_BASE = "https://api.resumatorapi.com/v1";

// Proxy a resume for a JazzHR applicant.
// Fetches a fresh applicant record at click-time so the URL is never stale/expired,
// then streams the file with ?apikey= (what JazzHR CDN actually accepts).
// Usage: GET /api/resume?jazzId=<jazz_applicant_id>
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jazzId = request.nextUrl.searchParams.get("jazzId");
  if (!jazzId) {
    return NextResponse.json({ error: "jazzId param required" }, { status: 400 });
  }

  const apiKey = process.env.JAZZHR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "JAZZHR_API_KEY not configured" }, { status: 500 });
  }

  // Step 1: fetch fresh applicant record — avoids stale/pre-signed URL expiry
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

  // Step 2: fetch the file — JazzHR CDN accepts ?apikey= (not Basic Auth)
  const sep = resumeUrl.includes("?") ? "&" : "?";
  const fileRes = await fetch(`${resumeUrl}${sep}apikey=${apiKey}`);
  if (!fileRes.ok) {
    return NextResponse.json(
      { error: `Resume file fetch failed: ${fileRes.status}` },
      { status: fileRes.status }
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
