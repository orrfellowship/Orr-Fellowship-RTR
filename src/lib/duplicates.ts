// Pure duplicate-matching helpers shared by the client Duplicate Review, the
// bulk-import warning, and the server-side "delete all duplicates" action — so
// every place agrees on what counts as a duplicate. No React imports here.

export const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Name matching is scoped to a school: two different people who happen to share a
// name are only duplicates when they're at the SAME school. Email stays global.
export const nameSchoolKey = (name: string | null | undefined, schoolId: string | null | undefined) =>
  `${norm(name)}|${schoolId ?? ""}`;

export type DedupeCand = {
  id: string;
  name: string;
  email: string | null;
  school_id: string | null;
  jazz_id?: string | null;
};

export type DupCand = { id: string; name: string; email: string | null; school_id: string | null; university_raw?: string | null; stage: string | null; source: string | null };

// Groups of 2+ candidates that share `key`. Name groups whose members all share
// one email are dropped (already covered by the email group). Used by the
// Duplicate Review UI and the admin Weekly Snapshot count.
export function findDuplicateGroups(candidates: DupCand[]): { reason: "email" | "name"; key: string; members: DupCand[] }[] {
  const byEmail = new Map<string, DupCand[]>();
  const byName = new Map<string, DupCand[]>();
  for (const c of candidates) {
    if (c.email && norm(c.email)) (byEmail.get(norm(c.email)) ?? byEmail.set(norm(c.email), []).get(norm(c.email))!).push(c);
    // Match on the normalized name alone (not name+school) so the review also
    // surfaces same-name candidates filed under different schools — a common
    // duplicate when someone is sourced under one school but applies under
    // another. The admin sees each record's school and decides.
    if (norm(c.name)) {
      const k = norm(c.name);
      (byName.get(k) ?? byName.set(k, []).get(k)!).push(c);
    }
  }
  const groups: { reason: "email" | "name"; key: string; members: DupCand[] }[] = [];
  for (const [key, members] of byEmail) if (members.length > 1) groups.push({ reason: "email", key, members });
  for (const [key, members] of byName) {
    if (members.length <= 1) continue;
    const emails = new Set(members.map((m) => norm(m.email)).filter(Boolean));
    if (emails.size === 1 && members.every((m) => m.email)) continue; // already an email group
    groups.push({ reason: "name", key, members });
  }
  return groups;
}

// Decide which candidate ids to delete so every email/name duplicate cluster
// collapses to a single survivor. Candidates are linked when they share an email
// OR a name+school; transitively-linked records form one cluster (union-find).
// Survivor preference within a cluster: JazzHR-linked (jazz_id) > has email >
// first seen. Returns the ids to delete (survivors are never included).
export function planDuplicateDeletions(cands: DedupeCand[]): string[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const next = parent.get(x)!; parent.set(x, r); x = next; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const c of cands) parent.set(c.id, c.id);

  const byEmail = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const c of cands) {
    const e = norm(c.email);
    if (e) (byEmail.get(e) ?? byEmail.set(e, []).get(e)!).push(c.id);
    if (norm(c.name)) {
      const k = nameSchoolKey(c.name, c.school_id);
      (byName.get(k) ?? byName.set(k, []).get(k)!).push(c.id);
    }
  }
  for (const ids of byEmail.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  for (const ids of byName.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  const byId = new Map(cands.map((c) => [c.id, c]));
  const clusters = new Map<string, DedupeCand[]>();
  for (const c of cands) {
    const r = find(c.id);
    (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(byId.get(c.id)!);
  }

  const toDelete: string[] = [];
  for (const members of clusters.values()) {
    if (members.length <= 1) continue;
    const sorted = [...members].sort((a, b) => {
      if (!!a.jazz_id !== !!b.jazz_id) return a.jazz_id ? -1 : 1;
      if (!!a.email !== !!b.email) return a.email ? -1 : 1;
      return 0;
    });
    for (let i = 1; i < sorted.length; i++) toDelete.push(sorted[i].id);
  }
  return toDelete;
}
