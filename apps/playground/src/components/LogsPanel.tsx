import { createEffect, createSignal, For, on, Show } from 'solid-js';

export interface LogEntry {
  level: 'info' | 'debug' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

interface LogsPanelProps {
  logs: () => LogEntry[];
  onClear: () => void;
  debugEnabled: () => boolean;
  onDebugToggle: (enabled: boolean) => void;
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

        {/* Header Controls */}
        <div class="flex items-center gap-2">
          {/* Debug Toggle */}
          <Show when={!collapsed()}>
            <div
              class="tooltip tooltip-left"
              data-tip="Enable verbose per-node logging for transforms"
            >
              <button
                class={`btn btn-xs gap-1.5 transition-all duration-200 ${
                  props.debugEnabled()
                    ? 'btn-warning text-warning-content shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                    : 'btn-ghost text-base-content/50 hover:text-base-content'
                }`}
                onClick={() => props.onDebugToggle(!props.debugEnabled())}
              >
                {/* Bug Icon */}
                <svg
                  class={`w-3.5 h-3.5 transition-transform duration-200 ${
                    props.debugEnabled() ? 'scale-110' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152 6.06M12 12.75c-2.883 0-5.647.508-8.208 1.44.125 2.104.52 4.136 1.153 6.06M12 12.75a2.25 2.25 0 002.248-2.354M12 12.75a2.25 2.25 0 01-2.248-2.354M12 8.25c.995 0 1.971-.08 2.922-.236.403-.066.74-.358.795-.762a3.778 3.778 0 00-.399-2.25M12 8.25c-.995 0-1.97-.08-2.922-.236-.402-.066-.74-.358-.795-.762a3.734 3.734 0 01.4-2.253M12 8.25a2.25 2.25 0 00-2.248 2.146M12 8.25a2.25 2.25 0 012.248 2.146M8.683 5a6.032 6.032 0 01-1.155-1.002c.07-.63.27-1.222.574-1.747m.581 2.749A3.75 3.75 0 0112 3.75a3.75 3.75 0 013.317 1.998m.581-2.748a3.75 3.75 0 01.574 1.746c-.426.427-.84.882-1.155 1.002"
                  />
                </svg>
                <span class="text-[11px] font-semibold tracking-wide uppercase">
                  Debug
                </span>
              </button>
            </div>
          </Show>

          {/* Clear Button */}
          <Show when={props.logs().length > 0 && !collapsed()}>
            <button
              class="btn btn-ghost btn-xs text-base-content/50 hover:text-base-content"
              onClick={props.onClear}
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
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
