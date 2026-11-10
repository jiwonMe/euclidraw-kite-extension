import rawConfig from '../extension.json';
import type { PackageManifest, SymbolId } from './types.ts';

export const EXTENSION_ID = rawConfig.id;
export const EXTENSION_SUMMARY = rawConfig.summary;
export const EXTENSION_VERSION = rawConfig.version;
export const SCOPE_ASPECT_ID = 'kite.scope';
export const MEMBER_ASPECT_ID = 'kite.member';
export const SCOPE_ASPECT_IDS = Object.freeze([SCOPE_ASPECT_ID, MEMBER_ASPECT_ID]);

export const PANEL_IDS = Object.freeze({
  triEditor: 'kite.panel.tri-editor' as const,
  diagnostics: 'kite.panel.diagnostics' as const,
});

export const COMMAND_NAMES: readonly string[] = Object.freeze([...(rawConfig.commands ?? [])]);

const id = (name: string): SymbolId => `${EXTENSION_ID}:${name}` as SymbolId;

export const COMMANDS = Object.freeze({
  insert: id('insert-diagram'),
  apply: id('apply-dsl'),
  reset: id('reset-example'),
  addPoint: id('add-point'),
  addConstraint: id('add-constraint'),
  onCircle: id('constrain-on-circle'),
  midpoint: id('constrain-midpoint'),
  perpendicular: id('constrain-perpendicular'),
  equalLength: id('constrain-equal-length'),
  horizontal: id('constrain-horizontal'),
  vertical: id('constrain-vertical'),
  tangent: id('constrain-tangent'),
  distance: id('set-distance'),
  freeze: id('freeze-geometry'),
  repair: id('repair-bindings'),
  reproject: id('reproject'),
});

/** Shared by the bundle and build script; keep the reviewed and executed contracts identical. */
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
      aspects: [...SCOPE_ASPECT_IDS],
      hsmSlots: [...metadata.provides.hsmSlots],
    },
  };
}

export const EXTENSION_MANIFEST = Object.freeze(createPackageManifest());

export const COMMAND_IDS: readonly SymbolId[] = Object.freeze(COMMAND_NAMES.map(name => id(name)));
