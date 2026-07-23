"use client";

import { useEffect } from "react";

export default function ActionToast({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: 380,
        padding: "12px 14px",
        color: "#7A1D12",
        background: "#FFF4F1",
        border: "1px solid #E8A092",
        borderRadius: 11,
        boxShadow: "0 12px 34px rgba(17,18,62,.18)",
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden="true" style={{ color: "#B42318", fontSize: 16 }}>ⓘ</span>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        aria-label="Dismiss message"
        onClick={onClose}
        style={{
          border: 0,
          background: "transparent",
          color: "#7A1D12",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}
