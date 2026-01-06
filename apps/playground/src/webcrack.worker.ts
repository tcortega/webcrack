import type { Options, Sandbox } from 'webcrack';
import { webcrack } from 'webcrack';

export type WorkerRequest =
  | {
      type: 'deobfuscate';
      code: string;
      options: Options & { mangleRegex: RegExp | null; deobfuscator?: string };
    }
  | { type: 'sandbox'; result: unknown };

export type LogLevel = 'info' | 'debug' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
}

export type WorkerResponse =
  | { type: 'sandbox'; code: string }
  | ({ type: 'result' } & DeobfuscateResult)
  | { type: 'progress'; value: number }
  | { type: 'log'; entry: LogEntry }
  | { type: 'error'; error: Error };

export interface DeobfuscateResult {
  code: string;
  files: { code: string; path: string }[];
}

const postMessage = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type !== 'deobfuscate') return;

  // worker->window->sandybox because it accesses the DOM, which is not available in workers
  const sandbox: Sandbox = (code) => {
    return new Promise((resolve) => {
      self.addEventListener('message', onSandboxResponse);
      postMessage({ type: 'sandbox', code });

      function onSandboxResponse({ data }: MessageEvent<WorkerRequest>) {
        if (data.type === 'sandbox') {
          self.removeEventListener('message', onSandboxResponse);
          resolve(data.result);
        }
      }
    });
  };

  function onProgress(value: number) {
    postMessage({ type: 'progress', value });
  }

  function onLog(level: LogLevel, message: string) {
    postMessage({
      type: 'log',
      entry: { level, message, timestamp: Date.now() },
    });
  }

  try {
    const { mangleRegex, deobfuscate, deobfuscator, ...restOptions } =
      data.options;

    // Convert deobfuscate (boolean) + deobfuscator (string) to the API format
    const deobfuscateOption = deobfuscate ? deobfuscator || 'auto' : false;

    onLog('info', 'Starting deobfuscation...');

    const result = await webcrack(data.code, {
      sandbox,
      onProgress,
      onLog,
      ...restOptions,
      deobfuscate: deobfuscateOption,
      mangle: mangleRegex ? (id) => mangleRegex.test(id) : undefined,
    });
    const files = Array.from(result.bundle?.modules ?? [], ([, module]) => ({
      code: module.code,
      path: module.path.replace(/\.?\/?/, ''),
    }));

    onLog('info', `Completed! Generated ${files.length} files.`);
    postMessage({ type: 'result', code: result.code, files });
  } catch (error) {
    onLog('error', `Error: ${(error as Error).message}`);
    // Babel SyntaxError dynamically sets `error.message`, has to be
    // accessed/logged before postMessage to be properly cloned.
    console.error(error);
    postMessage({ type: 'error', error: error as Error });
  }
};
