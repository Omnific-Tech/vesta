import type { Watcher, ControlConfiguration, WatcherState } from './policy.ts';

export type PromptOrigin = { kind: string; name?: string };
export type ActiveTurnMetadata = {
  source: 'user' | 'other' | 'warm';
  sessionId: string;
  turnId: string;
  submittedAt: number;
  controlRevision: number;
  signature: string;
};
export type PersistedStatus = Partial<WatcherState & ControlConfiguration> & {
  pluginId?: string;
  transcriptPath?: string;
  warmTurnIds?: string[];
  committedMessage?: string;
  configurationUnavailable?: boolean;
  controlSignature?: unknown;
  consent?: unknown;
  activeTurn?: ActiveTurnMetadata;
  activeUserTurn?: ActiveTurnMetadata;
};
export type ClaudeEvent = {
  origin?: PromptOrigin;
  sessionId?: string;
  session_id?: string;
  transcriptPath?: string;
  transcript_path?: string;
  isSidechain?: boolean;
  is_sidechain?: boolean;
  agentId?: string;
  agent_id?: string;
  source?: string;
  reason?: string;
  command?: string;
  text?: string;
  turnId: string;
};
export type ClaudeTimer = { cancel(): void };
export type ClaudeHost = {
  env: { get(name: string): Promise<string | undefined> };
  fs: { read(path: string): Promise<string> };
  session: { id(): Promise<string>; usage(): Promise<unknown> };
  store: {
    get(key: string): Promise<PersistedStatus | undefined>;
    set(key: string, value: unknown): Promise<unknown>;
  };
  clock: {
    now(): Promise<number>;
    sleep(milliseconds: number): Promise<unknown>;
    every(milliseconds: number, callback: () => Promise<void>): ClaudeTimer;
  };
  prompt: { submit(value: { text: string }): Promise<unknown> };
  command: { register(value: { name: string; description: string }): Promise<unknown> };
};
export type ClaudeNext = (event: ClaudeEvent) => Promise<unknown>;
export type ClaudeHandler = (
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) => Promise<unknown>;
export type ClaudeOn = (name: string, handler: ClaudeHandler) => void;
export type ClaudeSession = {
  configuredOptions: unknown;
  watcher?: Watcher;
  sessionId: string;
  timer?: ClaudeTimer;
  config: ControlConfiguration;
  configPath: string;
  signature: string;
  configError: string;
  errorAt: number;
  nativeEnabled: boolean;
  lastAction: string;
  resetReason: string;
  nextReset: string;
  committedMessage?: string;
  pendingPromptOrigin?: PromptOrigin;
  pendingUserSubmittedAt?: number;
  turnSource: string;
  activeTurnMetadata?: ActiveTurnMetadata;
  transcriptPath?: string;
  attributedWarmTurns: Set<string>;
  polling: Promise<void>;
  timerTickInProgress: boolean;
};
