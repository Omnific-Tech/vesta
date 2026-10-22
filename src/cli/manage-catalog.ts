import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { directory, readJson, saveJson, sha256, version } from './assets.ts';
import { present } from './manage-links.ts';
import type { MarketplaceAsset } from './manage-types.ts';

const pluginPrefix = 'app/src/claude/vesta-claude/';
function validAsset(plugin: string, file: string, asset: MarketplaceAsset) {
  return (
    existsSync(file) &&
    !lstatSync(file).isSymbolicLink() &&
    lstatSync(file).isFile() &&
    realpathSync(file).startsWith(realpathSync(plugin) + '/') &&
    sha256(readFileSync(file)) === asset.sha256
  );
}
function validate(plugin: string, expected: MarketplaceAsset[]) {
  directory(plugin);
  for (const asset of expected) {
    const file = join(plugin, asset.path.slice(pluginPrefix.length));
    if (!validAsset(plugin, file, asset))
      throw new Error('Immutable marketplace plugin integrity failure: ' + asset.path);
  }
}
function stagePlugin(
  assets: string,
  plugins: string,
  destination: string,
  expected: MarketplaceAsset[],
) {
  const staged = mkdtempSync(join(plugins, '.stage-'));
  try {
    cpSync(join(assets, 'app/src/claude/vesta-claude'), staged, { recursive: true });
    validate(staged, expected);
    renameSync(staged, destination);
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    throw error;
  }
}
export function catalog(root: string, assets: string) {
  const path = join(root, 'marketplace');
  directory(path);
  directory(join(path, '.claude-plugin'));
  const plugins = join(path, 'plugins');
  directory(plugins);
  const destination = join(plugins, version);
  const expected = (readJson(join(assets, 'manifest.json')).assets as MarketplaceAsset[]).filter(
    asset => asset.path.startsWith(pluginPrefix),
  );
  if (present(destination)) validate(destination, expected);
  else stagePlugin(assets, plugins, destination, expected);
  const metadata = readJson(join(assets, 'app/.claude-plugin/marketplace.json'));
  metadata.plugins[0].source = './plugins/' + version;
  saveJson(join(path, '.claude-plugin/marketplace.json'), metadata);
  return path;
}
