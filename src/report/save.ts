// Hand a generated file to the viewer. Inside the Claude artifact viewer this uses the
// "downloads" capability (the viewer confirms the save); anywhere else a normal browser download.
type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<{ status: string }> };
type ClaudeWin = { claude?: { use?: (name: string) => Promise<unknown> } };

export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

async function viewerDownloads(): Promise<Downloads | null> {
  const c = (window as unknown as ClaudeWin).claude;
  if (!c?.use) return null;
  try { return (await c.use('downloads')) as Downloads | null; } catch { return null; }
}

function browserDownload(filename: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function saveFile(filename: string, data: Blob): Promise<SaveOutcome> {
  const d = await viewerDownloads();
  if (d) {
    try { await d.save({ filename, data }); return 'saved'; }
    catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') throw new Error('Another save prompt is already open. Close it and try again.');
      if (code === 'too_large' || code === 'bad_request') throw new Error(`The file could not be saved (${code}).`);
      // other codes: viewer cannot save here, fall back to a plain browser download
    }
  }
  try { browserDownload(filename, data); return 'saved'; } catch { return 'unavailable'; }
}
