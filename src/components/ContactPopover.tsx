"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const C = { navy: "#11123E", navy2: "#485F92", gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B" };

export default function ContactPopover({ name, email, className }: { name: string; email: string | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 280;
      setPosition({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
    };
    const close = (event: MouseEvent) => {
      const node = event.target as Node;
      if (!triggerRef.current?.contains(node) && !popoverRef.current?.contains(node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    place();
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const copy = async () => {
    if (!email) return;
    await navigator.clipboard.writeText(email);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <>
      <button ref={triggerRef} type="button" className={className} aria-expanded={open} aria-controls={open ? popoverId : undefined}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
        style={{ border: "none", background: "transparent", padding: 0, color: "inherit", font: "inherit", fontWeight: "inherit", textAlign: "left", cursor: email ? "pointer" : "default", textDecoration: email ? "underline dotted" : "none", textUnderlineOffset: 3 }}>
        {name}
      </button>
      {open && createPortal(
        <div ref={popoverRef} id={popoverId} role="dialog" aria-label={`${name} contact information`}
          onClick={(event) => event.stopPropagation()}
          style={{ position: "fixed", top: position.top, left: position.left, zIndex: 200, width: 280, boxSizing: "border-box", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 11, boxShadow: "0 10px 30px rgba(11,12,42,.18)", padding: 13 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: C.navy }}>{name}</div>
          <div style={{ marginTop: 3, color: email ? C.gray : C.grayMute, fontSize: 13, overflowWrap: "anywhere" }}>{email || "No email available"}</div>
          {email && <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
            <button type="button" onClick={copy} style={{ flex: 1, border: `1px solid ${C.line}`, background: C.canvas, color: copied ? C.good : C.navy2, borderRadius: 8, padding: "7px 10px", fontWeight: 700, cursor: "pointer" }}>{copied ? "Copied" : "Copy email"}</button>
            <a href={`mailto:${email}`} style={{ flex: 1, border: "none", background: C.navy, color: "#fff", borderRadius: 8, padding: "8px 10px", fontWeight: 700, textAlign: "center", textDecoration: "none", fontSize: 13 }}>Compose</a>
          </div>}
        </div>,
        document.body,
      )}
    </>
  );
}
