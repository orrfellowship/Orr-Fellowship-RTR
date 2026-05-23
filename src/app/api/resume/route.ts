import { type NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
// Proxy a JazzHR resume URL through the server so the API key stays secret
// and the browser gets a direct, openable file response.
// Usage: GET /api/resume?url=<encoded-jazzhr-resume-url>
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const resumeUrl = request.nextUrl.searchParams.get("url");
  if (!resumeUrl) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  const apiKey = process.env.JAZZHR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "JAZZHR_API_KEY not configured" }, { status: 500 });
  }

  const sep = resumeUrl.includes("?") ? "&" : "?";
  const upstream = await fetch(`${resumeUrl}${sep}apikey=${apiKey}`);
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `JazzHR returned ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const ext = contentType.includes("pdf") ? "pdf" : contentType.includes("word") ? "docx" : "pdf";

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="resume.${ext}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
