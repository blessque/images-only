import { useEffect, useRef } from 'react';
import type { CompressRequest, CompressResponse, VariantResult } from './compressWorker';

export interface CompressOutcome {
  aspect: number;
  sourceBytes: number;
  variants: VariantResult[];
  colorSpace: string;
}

type Pending = {
  resolve: (outcome: CompressOutcome) => void;
  reject: (error: Error) => void;
  onProgress: (rung: number) => void;
};

/**
 * One long-lived Web Worker, shared by every job.
 *
 * Spawning a worker per file would be simpler to write and much worse to use: each spawn
 * re-parses the module, and twenty concurrent decodes of 10MB photographs is how a
 * "responsive" upload tray runs the machine out of memory. Jobs are correlated by id and
 * driven one at a time by the caller.
 */
export function useCompressor() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, Pending>());

  useEffect(() => {
    const worker = new Worker(new URL('./compressWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<CompressResponse>) => {
      const message = event.data;
      const pending = pendingRef.current.get(message.jobId);
      if (!pending) return;

      if (message.type === 'progress') {
        pending.onProgress(message.rung);
        return;
      }
      pendingRef.current.delete(message.jobId);
      if (message.type === 'done') {
        pending.resolve({
          aspect: message.aspect,
          sourceBytes: message.sourceBytes,
          variants: message.variants,
          colorSpace: message.colorSpace,
        });
      } else {
        pending.reject(new Error(message.message));
      }
    };

    worker.onerror = (event) => {
      const error = new Error(event.message || 'Compression worker failed');
      for (const pending of pendingRef.current.values()) pending.reject(error);
      pendingRef.current.clear();
    };

    workerRef.current = worker;
    const pendingAtMount = pendingRef.current;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingAtMount.clear();
    };
  }, []);

  return function compress(
    jobId: string,
    file: File,
    highFidelity: boolean,
    onProgress: (rung: number) => void,
  ): Promise<CompressOutcome> {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('Compressor not ready'));

    return new Promise<CompressOutcome>((resolve, reject) => {
      pendingRef.current.set(jobId, { resolve, reject, onProgress });
      worker.postMessage({ jobId, file, highFidelity } satisfies CompressRequest);
    });
  };
}
