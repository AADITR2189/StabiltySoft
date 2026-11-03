// Image of one PDF page next to the imported table, for side-by-side checking.
import { useEffect, useRef, useState } from 'react';
import type { SourceDoc } from '../importer/sources';

export function PdfPage({ doc, page }: { doc: SourceDoc; page: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (ref.current && doc.renderPage) doc.renderPage(page, ref.current, 520).catch((e) => !cancelled && setErr(String(e)));
    return () => { cancelled = true; };
  }, [doc, page]);
  return (
    <div className="pdf-page">
      <div className="muted small">Source page {page} (for side-by-side comparison)</div>
      {err ? <div className="error-box">Page image could not be drawn: {err}</div> : <canvas ref={ref} aria-label={`PDF page ${page}`} />}
    </div>
  );
}
