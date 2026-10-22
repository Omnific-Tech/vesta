import type { Provider } from './providers.ts';
import type { preserveClaudeCaches, snapshotIntegrations } from './integration-state.ts';

export type InstallationRecord = {
  schema: number;
  version: string;
  providers: Provider[];
  binLink: string;
};
export type SavedIntegrations = Awaited<ReturnType<typeof snapshotIntegrations>>;
export type ClaudeCaches = ReturnType<typeof preserveClaudeCaches>;
// One locked operation owns these snapshots and cache backups until compensation
// or activation completes. Native refresh marks its compensation obligation first.
export type InstallOperation = {
  root: string;
  args: string[];
  repairing: boolean;
  selected: Provider[];
  previous: InstallationRecord | null;
  assets: string;
  cliLink: string;
  saved: SavedIntegrations;
  oldCurrent?: string;
  claudeChanged: boolean;
  caches: ClaudeCaches;
};
export type MarketplaceAsset = { path: string; sha256: string };
export type NativeClaudePlugin = {
  id: string;
  scope: string;
  version: string;
  errors?: unknown[];
  errorDetails?: unknown[];
  installPath?: string;
};
