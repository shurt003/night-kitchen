"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A name you can tap to rename — for saved meals. Commits on Enter or when
 * the field loses focus; Escape (or an empty field) puts the old name back.
 */
export function EditableTitle({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim().slice(0, 120);
    if (next && next !== value) onChange(next);
    else setDraft(value);
  }

  if (editing) {
    return (
      <input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label="Meal name"
        // text-base keeps iOS from zooming the page on focus.
        className={`${className} w-full rounded-lg border border-flame bg-surface px-2 py-1 text-base outline-none`}
      />
    );
  }
  return (
    <button onClick={() => setEditing(true)} className={`${className} group text-left`} aria-label={`Rename ${value}`}>
      {value}
      {/* A pencil rather than a hint line: it says "this is editable" without
          adding a sentence to read. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="ml-1.5 inline-block h-[0.7em] w-[0.7em] align-baseline opacity-35"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}
