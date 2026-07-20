"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addResource, updateResource, deleteResource } from "@/app/(app)/console/actions";
import type { Resource } from "@/lib/types";

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB",
};
const HEAD = "var(--font-head)";

// Shared Resources tab — read-only for everyone, full CRUD for admin/super-admin.
export default function ResourcesPanel({ resources, canManage, accent = C.orange }: {
  resources: Resource[];
  canManage: boolean;
  accent?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Resource | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blank: Resource = { id: "", name: "", description: "", link: "", created_by: null, created_at: null };

  const save = (draft: Resource) => {
    if (!draft.name.trim()) { setError("Resource name is required."); return; }
    setError(null);
    startTransition(async () => {
      const res = draft.id
        ? await updateResource(draft.id, draft.name, draft.description, draft.link)
        : await addResource(draft.name, draft.description, draft.link);
      if ("error" in res && res.error) { setError(res.error); return; }
      setEditing(null); setAdding(false);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this resource?")) return;
    startTransition(async () => {
      const res = await deleteResource(id);
      if ("error" in res && res.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <div style={{ opacity: pending ? 0.7 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Resources</h1>
          <p style={{ color: C.grayMute, margin: "4px 0 0" }}>
            {resources.length} resource{resources.length !== 1 ? "s" : ""}
            {canManage ? " · add and edit links the whole team can use." : "."}
          </p>
        </div>
        {canManage && !adding && (
          <button onClick={() => { setAdding(true); setEditing(null); setError(null); }}
            style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13.5 }}>+ Add resource</button>
        )}
      </div>

      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E", marginTop: 14 }}>{error}</div>}

      {adding && <ResourceForm initial={blank} accent={accent} onCancel={() => setAdding(false)} onSave={save} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: 18 }}>
        {resources.map((r) => editing?.id === r.id ? (
          <ResourceForm key={r.id} initial={r} accent={accent} onCancel={() => setEditing(null)} onSave={save} />
        ) : (
          <div key={r.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: C.navy }}>{r.name}</div>
            {r.description && <div style={{ fontSize: 13.5, color: C.gray, lineHeight: 1.45 }}>{r.description}</div>}
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 6 }}>
              {r.link ? (
                <a href={r.link} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, fontWeight: 700, color: accent, textDecoration: "none" }}>Open link ↗</a>
              ) : <span style={{ fontSize: 12.5, color: C.grayMute, fontStyle: "italic" }}>No link</span>}
              {canManage && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { setEditing(r); setAdding(false); setError(null); }}
                    style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy2, fontWeight: 600, fontSize: 12, padding: "4px 10px", borderRadius: 7, cursor: "pointer" }}>Edit</button>
                  <button onClick={() => remove(r.id)}
                    style={{ border: "none", background: "none", color: C.grayMute, fontWeight: 600, fontSize: 12, padding: "4px 6px", borderRadius: 7, cursor: "pointer" }}>Delete</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {resources.length === 0 && !adding && (
        <div style={{ padding: 40, textAlign: "center", color: C.grayMute, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, marginTop: 18 }}>
          {canManage ? "No resources yet — add the first one above." : "No resources have been added yet."}
        </div>
      )}
    </div>
  );
}

function ResourceForm({ initial, accent, onCancel, onSave }: {
  initial: Resource; accent: string;
  onCancel: () => void; onSave: (draft: Resource) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [link, setLink] = useState(initial.link ?? "");
  const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, boxSizing: "border-box" as const };

  return (
    <div style={{ background: "#fff", border: `1px solid ${accent}`, borderRadius: 14, padding: 18, marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Resource name" style={inputStyle} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" style={inputStyle} />
      <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (https://…)" style={inputStyle} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontSize: 13 }}>Cancel</button>
        <button onClick={() => onSave({ ...initial, name, description, link })}
          style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontSize: 13 }}>Save</button>
      </div>
    </div>
  );
}
