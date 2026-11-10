/**
 * In-process engine for Node tests. The production bundle uses the Blob
 * worker; this module is imported only by the test harness, so `@penrose/core`
 * never enters `dist/plugin.js` through it.
 */
import type { EngineClient } from './protocol.ts';
import { compileSession, convergeSession, dragSession, layoutOf, resampleSession, type CoreSession } from './core.ts';
import type { CompileInput } from './core.ts';
import type { WireCompiled, WireLayout } from '../wire.ts';

export function createInlineEngine(): EngineClient {
  const sessions = new Map<string, CoreSession>();
  const require = (key: string): CoreSession => {
    const session = sessions.get(key);
    if (!session) throw new Error(`Unknown Penrose session: ${key}`);
    return session;
  };
  return {
    async compile(key: string, input: CompileInput): Promise<WireCompiled> {
      const session = await compileSession(input);
      session.key = key;
      sessions.set(key, session);
      return session.compiled;
    },
    async layout(key: string, varyingValues?: readonly number[]): Promise<WireLayout> {
      return layoutOf(require(key), varyingValues);
    },
    async drag(key: string, targets, steps: number): Promise<WireLayout> {
      return dragSession(require(key), targets, steps);
    },
    async converge(key: string, maxSteps?: number): Promise<WireCompiled> {
      return convergeSession(require(key), maxSteps);
    },
    async resample(key: string): Promise<WireCompiled> {
      return resampleSession(require(key));
    },
    async dispose(key: string): Promise<void> {
      sessions.delete(key);
    },
    close(): void {
      sessions.clear();
    },
  };
}
