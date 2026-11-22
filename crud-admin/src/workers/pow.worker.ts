/// <reference lib="webworker" />

function leadingZeroBits(hex: string): number {
  let count = 0;
  for (const c of hex) {
    const n = parseInt(c, 16);
    if (n === 0) { count += 4; continue; }
    if (n < 8) count += 1;
    if (n < 4) count += 1;
    if (n < 2) count += 1;
    break;
  }
  return count;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async (e: MessageEvent) => {
  const { challenge, difficulty } = e.data || {};
  if (typeof challenge !== 'string' || !Number.isFinite(difficulty)) {
    self.postMessage({ error: 'bad pow params' });
    return;
  }

  const encoder = new TextEncoder();
  try {
    for (let i = 0; ; i++) {
      const nonce = String(i);
      const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${challenge}.${nonce}`));
      if (leadingZeroBits(toHex(digest)) >= difficulty) {
        self.postMessage({ nonce });
        return;
      }
    }
  } catch (err: any) {
    self.postMessage({ error: err?.message || 'pow failed' });
  }
};
