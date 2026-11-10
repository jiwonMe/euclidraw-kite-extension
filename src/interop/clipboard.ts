import { sourceLines, splitTopLevel } from '../dsl/lexer.ts';
import type { CompiledScope } from '../dsl/compile.ts';
import type { KiteScopeAspect } from '../schema.ts';

/**
 * PRD §7.3 clipboard.
 *
 *  • Whole scope: core.clipboard copies the scope with its members as one
 *    induced subgraph (`kite.member.scopeId` is a cascade-hide entity ref) and
 *    remaps every id atomically. The scope's `entityBindings`/`convergedSeeds`
 *    still name the copied ids; `computed.kite.compiledVm` resolves live
 *    bindings from the members' own `scopeId` and the seeds through the old
 *    keys, so a pasted scope renders identically with zero extra writes. The
 *    next Kite commit stores the remapped maps.
 *  • Partial subgraph: `inducedSubgraph` keeps the selected substance ids,
 *    their defining points and only the statements closed over them, for
 *    `kite: extract-subgraph` (a new independent scope).
 */

/** Statements (by Substance line) that only mention ids inside `keep`. */
export function inducedSubgraph(compiled: CompiledScope, scope: KiteScopeAspect, picked: readonly string[]): { substanceDsl: string; kept: Set<string> } {
  const kept = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id || kept.has(id) || !compiled.instances[id]) return;
    kept.add(id);
    const instance = compiled.instances[id]!;
    // A shape needs its defining points to exist at all.
    for (const ref of [instance.a, instance.b, instance.center, instance.through, ...(instance.vertices ?? []), ...(instance.angle ?? [])]) add(ref);
    if (instance.anchor) add(instance.anchor.target);
  };
  for (const id of picked) add(id);
  const declared = new Set(compiled.order);
  const out: string[] = [];
  for (const line of sourceLines(scope.substanceDsl)) {
    const text = line.text;
    if (/^canvas\s/.test(text)) { out.push(text); continue; }
    const pin = /^(pin|unpin)\s+([A-Za-z_]\w*)$/.exec(text);
    if (pin) { if (kept.has(pin[2]!)) out.push(text); continue; }
    const call = /^(soft\s+)?([A-Za-z_]\w*)\s*\((.*)\)$/.exec(text);
    if (call) {
      const refs = splitTopLevel(call[3]!).filter(arg => declared.has(arg));
      if (refs.every(ref => kept.has(ref))) out.push(text);
      continue;
    }
    const declaration = /^[A-Za-z_]\w*\s+([A-Za-z_]\w*)/.exec(text);
    if (declaration && kept.has(declaration[1]!)) {
      // A constructed point keeps its constructor only if its inputs survive.
      const ctor = /=\s*([A-Za-z_]\w*)\s*\((.*)\)/.exec(text);
      if (ctor && compiled.constructors[ctor[1]!] && !splitTopLevel(ctor[2]!).every(arg => kept.has(arg))) {
        out.push(text.replace(/=\s*[A-Za-z_]\w*\s*\(.*\)/, ''));
        continue;
      }
      out.push(text);
    }
  }
  return { substanceDsl: `${out.join('\n')}\n`, kept };
}
