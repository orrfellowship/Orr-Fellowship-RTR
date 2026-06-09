import { createServiceClient } from "@/lib/supabase/server";
import ImportClient from "./ImportClient";

export default async function ImportPage() {
  const db = createServiceClient();
  const [{ data: schools }, { data: candidates }] = await Promise.all([
    db.from("schools").select("id, name").order("name"),
    db.from("candidates").select("email").not("email", "is", null),
  ]);

  const existingEmails = new Set(
    (candidates ?? []).map((c: any) => (c.email as string).toLowerCase())
  );

  return <ImportClient schools={schools ?? []} existingEmails={existingEmails} />;
}
