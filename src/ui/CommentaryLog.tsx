import { useEffect, useRef } from 'react';

export function CommentaryLog({ lines }: { lines: readonly string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      style={{
        background: 'var(--bg-panel)',
        border: '2px solid var(--border)',
        padding: 8,
        height: 180,
        overflowY: 'auto',
        fontSize: 11,
        lineHeight: 1.5,
        color: 'var(--text-dim)',
      }}
    >
      {lines.length === 0 ? (
        <div style={{ fontStyle: 'italic' }}>The bell rings and twelve wrestlers enter the ring...</div>
      ) : (
        lines.map((l, i) => (
          <div key={i} style={{ marginBottom: 2 }}>
            <span style={{ color: 'var(--accent)' }}>{'> '}</span>
            {l}
          </div>
        ))
      )}
    </div>
  );
}
