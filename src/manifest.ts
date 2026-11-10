import rawConfig from '../extension.json';
import type { PackageManifest, SymbolId } from './host.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT } from './penrose/schema.ts';

export const EXTENSION_ID = rawConfig.id;
export const EXTENSION_VERSION = rawConfig.version;
export const EXTENSION_SUMMARY = rawConfig.summary;
export const ASPECT_IDS: readonly string[] = Object.freeze([SCOPE_ASPECT, MEMBER_ASPECT]);

export const PANELS = Object.freeze({
  triEditor: 'penrose.panel.tri-editor' as const,
  diagnostics: 'penrose.panel.diagnostics' as const,
});

export const HSM = Object.freeze({
  manipulate: `root.select.${EXTENSION_ID}:manipulate` as const,
  create: `root.select.${EXTENSION_ID}:create` as const,
});

export const COMPUTED = Object.freeze({
  compiled: 'computed.penrose.compiled' as const,
  layout: 'computed.penrose.layout' as const,
  member: 'computed.penrose.member' as const,
});

export const COMMAND_NAMES: readonly string[] = Object.freeze([...rawConfig.commands]);
const command = (name: string): SymbolId => {
  if (!COMMAND_NAMES.includes(name)) throw new Error(`Undeclared Penrose command: ${name}`);
  return `${EXTENSION_ID}:${name}` as SymbolId;
};

export const COMMANDS = Object.freeze({
  insert: command('insert-scope'),
  apply: command('apply-dsl'),
  reset: command('reset-example'),
  reproject: command('reproject'),
  resample: command('resample'),
  pin: command('toggle-pin'),
  bake: command('bake-to-vector'),
  openEditor: command('open-tri-editor'),
  openDiagnostics: command('open-diagnostics'),
});

export function createPackageManifest(metadata = rawConfig): PackageManifest {
  return {
    id: metadata.id,
    version: metadata.version,
    engine: metadata.engine,
    dependencies: { ...metadata.dependencies },
    optionalDependencies: { ...metadata.optionalDependencies },
    conflicts: [...metadata.conflicts],
    provides: {
      services: [...metadata.provides.services],
      aspects: [...ASPECT_IDS],
      hsmSlots: [...metadata.provides.hsmSlots],
    },
  };
}
