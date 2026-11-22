/**
 * 在 Web Worker 中求解 PoW：找 nonce 使 sha256(challenge + '.' + nonce) 前导 0 位 >= difficulty。
 * 依赖安全上下文（HTTPS 或 localhost）的 crypto.subtle。
 */
export function solveChallenge(challenge: string, difficulty: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!globalThis.crypto?.subtle) {
      reject(new Error('当前环境不支持 Web Crypto（需要 HTTPS 或 localhost）'));
      return;
    }

    const worker = new Worker(new URL('../workers/pow.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e: MessageEvent) => {
      worker.terminate();
      if (e.data?.error) reject(new Error(e.data.error));
      else resolve(String(e.data?.nonce ?? ''));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'PoW worker error'));
    };

    worker.postMessage({ challenge, difficulty });
  });
}
