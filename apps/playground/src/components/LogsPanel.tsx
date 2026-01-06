import { createEffect, createSignal, For, on, Show } from 'solid-js';

export interface LogEntry {
  level: 'info' | 'debug' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

interface LogsPanelProps {
  logs: () => LogEntry[];
  onClear: () => void;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

const levelConfig = {
  info: {
    color: 'text-info',
    bg: 'bg-info/10',
    label: 'INFO',
  },
  debug: {
    color: 'text-base-content/50',
    bg: 'bg-base-content/5',
    label: 'DEBUG',
  },
  warn: {
    color: 'text-warning',
    bg: 'bg-warning/10',
    label: 'WARN',
  },
  error: {
    color: 'text-error',
    bg: 'bg-error/10',
    label: 'ERROR',
  },
};

export default function LogsPanel(props: LogsPanelProps) {
  const [collapsed, setCollapsed] = createSignal(false);
  let logsContainerRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom when new logs arrive
  createEffect(
    on(
      () => props.logs().length,
      () => {
        if (logsContainerRef && !collapsed()) {
          requestAnimationFrame(() => {
            logsContainerRef!.scrollTop = logsContainerRef!.scrollHeight;
          });
        }
      },
    ),
  );

  return (
    <div
      class="border-t border-base-content/10 bg-base-300 flex flex-col transition-all duration-200 ease-out"
      style={{
        height: collapsed() ? '40px' : '200px',
      }}
    >
      {/* Header */}
      <div class="flex items-center justify-between px-3 h-10 shrink-0 border-b border-base-content/5">
        <button
          class="flex items-center gap-2 text-sm font-medium text-base-content/70 hover:text-base-content transition-colors"
          onClick={() => setCollapsed((c) => !c)}
        >
          {/* Chevron */}
          <svg
            class="w-4 h-4 transition-transform duration-200"
            style={{
              transform: collapsed() ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
          <span>Logs</span>
          <Show when={props.logs().length > 0}>
            <span class="badge badge-sm badge-ghost font-mono">
              {props.logs().length}
            </span>
          </Show>
        </button>

        <Show when={props.logs().length > 0 && !collapsed()}>
          <button
            class="btn btn-ghost btn-xs text-base-content/50 hover:text-base-content"
            onClick={props.onClear}
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Clear
          </button>
        </Show>
      </div>

      {/* Logs Container */}
      <div
        ref={logsContainerRef}
        class="flex-1 overflow-y-auto overflow-x-hidden min-h-0 font-mono text-xs"
      >
        <Show
          when={props.logs().length > 0}
          fallback={
            <div class="h-full flex items-center justify-center text-base-content/30 text-sm">
              No logs yet
            </div>
          }
        >
          <div class="p-1">
            <For each={props.logs()}>
              {(entry, index) => {
                const config = levelConfig[entry.level];
                return (
                  <div
                    class={`flex gap-2 px-2 py-0.5 rounded ${
                      index() % 2 === 0 ? 'bg-base-content/[0.02]' : ''
                    } hover:bg-base-content/5 transition-colors`}
                  >
                    <span class="text-base-content/40 shrink-0 tabular-nums">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    <span
                      class={`shrink-0 w-12 ${config.color} font-semibold`}
                    >
                      {config.label}
                    </span>
                    <span class="text-base-content/80 break-all">
                      {entry.message}
                    </span>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
