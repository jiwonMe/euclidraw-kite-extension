import rawConfig from '../extension.json';
import type { PackageManifest, SymbolId } from './host.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT } from './schema.ts';

export const EXTENSION_ID = rawConfig.id;
export const EXTENSION_VERSION = rawConfig.version;
export const EXTENSION_SUMMARY = rawConfig.summary;
export const ASPECT_IDS: readonly string[] = Object.freeze([SCOPE_ASPECT, MEMBER_ASPECT]);

export const PANELS = Object.freeze({
  triEditor: 'kite.panel.tri-editor' as const,
  diagnostics: 'kite.panel.diagnostics' as const,
});

export const COMPUTED = Object.freeze({
  compiledVm: 'computed.kite.compiledVm' as const,
  solvedGeometry: 'computed.kite.solvedGeometry' as const,
  member: 'computed.kite.member' as const,
  scope: 'computed.kite.scope' as const,
});

export const COMMAND_NAMES: readonly string[] = Object.freeze([...rawConfig.commands]);
const command = (name: string): SymbolId => {
  if (!COMMAND_NAMES.includes(name)) throw new Error(`Undeclared Kite command: ${name}`);
  return `${EXTENSION_ID}:${name}` as SymbolId;
};

export const COMMANDS = Object.freeze({
  insert: command('insert-scope'),
  addPoint: command('add-point'),
  addSegment: command('add-segment'),
  addCircle: command('add-circle'),
  addLabel: command('add-label'),
  apply: command('apply-dsl'),
  reset: command('reset-example'),
  constrain: command('constrain'),
  constrainTangent: command('constrain-tangent'),
  constrainPerpendicular: command('constrain-perpendicular'),
  constrainParallel: command('constrain-parallel'),
  constrainOnCircle: command('constrain-on-circle'),
  constrainMidpoint: command('constrain-midpoint'),
  constrainEqualLength: command('constrain-equal-length'),
  constrainDistance: command('constrain-distance'),
  relaxConstraint: command('relax-constraint'),
  removeConstraint: command('remove-constraint'),
  pin: command('toggle-pin'),
  reproject: command('reproject'),
  bake: command('bake-to-vector'),
  extract: command('extract-subgraph'),
  setParam: command('set-param'),
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
