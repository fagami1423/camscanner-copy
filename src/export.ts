function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function tryShare(files: File[], title: string): Promise<boolean> {
  if (!navigator.canShare?.({ files })) return false;
  try {
    await navigator.share({ files, title });
    return true;
  } catch (e) {
    // User cancelled: done, do not fall back to a download.
    if (e instanceof DOMException && e.name === 'AbortError') return true;
    return false;
  }
}

export async function exportPdf(bytes: Uint8Array, name: string): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const file = new File([blob], `${name}.pdf`, { type: 'application/pdf' });
  if (await tryShare([file], name)) return 'shared';
  download(blob, `${name}.pdf`);
  return 'downloaded';
}

export async function exportJpegs(blobs: Blob[], name: string): Promise<'shared' | 'downloaded'> {
  const names = blobs.map((_, i) => `${name}-${i + 1}.jpg`);
  const files = blobs.map((b, i) => new File([b], names[i], { type: 'image/jpeg' }));
  if (await tryShare(files, name)) return 'shared';
  blobs.forEach((b, i) => download(b, names[i]));
  return 'downloaded';
}
