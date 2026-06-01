// Build the string→numeric prospect bridge (jazz_prospect_map).
// Our candidates.jazz_id is the STRING prospect id; the document endpoints
// need the NUMERIC prospect id. The ?prospectId=/?email= filters are ignored
// by the API, so we page through /prospect and upsert the mapping.

import type { SupabaseClient } from "@supabase/supabase-js";
import { JazzAuthExpiredError, jazzHeaders } from "./jazzhr-client";

interface RawProspect {
  id: number;
  prospectId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export async function syncProspectMap(
  ticket: string,
  supabase: SupabaseClient,
  { perPage = 100, maxPages = 500 }: { perPage?: number; maxPages?: number } = {}, // JazzHR caps per_page at 100
): Promise<{ synced: number; pages: number }> {
  let synced = 0;
  let page = 1;
  for (; page <= maxPages; page++) {
    const res = await fetch(
      `https://api.jazz.co/prospect?per_page=${perPage}&page=${page}`,
      { headers: jazzHeaders(ticket) },
    );
    if (res.status === 401 || res.status === 403)
      throw new JazzAuthExpiredError("sandcastle_ticket rejected — refresh it.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`/prospect page ${page}: ${res.status} ${body.slice(0, 300)}`);
    }

    const batch = (await res.json()) as RawProspect[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    const rows = batch.map((p) => ({
      jazz_id: p.prospectId,
      prospect_numeric_id: p.id,
      email: p.email,
      full_name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("jazz_prospect_map")
      .upsert(rows, { onConflict: "jazz_id" });
    if (error) throw error;

    synced += rows.length;
    if (batch.length < perPage) break; // last page
  }
  return { synced, pages: page };
}
