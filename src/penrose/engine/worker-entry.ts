/**
 * Web Worker entry, bundled to a single ES module and embedded in the
 * extension as a string (see `scripts/build-worker.mjs`). Requests are tagged
 * with a scope key; sessions keep the compiled `State` (which holds functions,
 * so it cannot cross the postMessage boundary).
 */
import { compileSession, convergeSession, dragPointSession, dragSession, layoutOf, polishSession, resampleSession, type CoreSession } from './core.ts';
import type { EngineRequest, EngineResponse } from './protocol.ts';

const sessions = new Map<string, CoreSession>();

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse): void;
};

function reply(message: EngineResponse) {
  scope.postMessage(message);
}

scope.onmessage = (event) => {
  const request = event.data;
  void handle(request);
};

async function handle(request: EngineRequest) {
  try {
    switch (request.type) {
      case 'compile': {
        const session = await compileSession(request.input);
        session.key = request.key;
        sessions.delete(request.key);
        sessions.set(request.key, session);
        reply({ id: request.id, ok: true, compiled: session.compiled });
        return;
      }
      case 'layout': {
        const session = requireSession(request.key);
        reply({ id: request.id, ok: true, layout: layoutOf(session, request.varyingValues) });
        return;
      }
      case 'drag': {
        const session = requireSession(request.key);
        reply({ id: request.id, ok: true, layout: dragSession(session, request.targets, request.steps, request.budgetMs) });
        return;
      }
      case 'point-drag': {
        const session = requireSession(request.key);
        reply({ id: request.id, ok: true, layout: dragPointSession(session, request.handleId, request.target, request.steps, request.budgetMs) });
        return;
      }
      case 'converge': {
        const session = requireSession(request.key);
        reply({ id: request.id, ok: true, compiled: convergeSession(session, request.maxSteps) });
        return;
      }
      case 'polish': {
        const session = requireSession(request.key);
        reply({ id: request.id, ok: true, layout: polishSession(session, request.maxSteps) });
        return;
      }
      case 'resample': {
        const session = requireSession(request.key);
        reply({ id: request.id, ok: true, compiled: resampleSession(session) });
        return;
      }
      case 'dispose': {
        sessions.delete(request.key);
        reply({ id: request.id, ok: true });
        return;
      }
    }
  } catch (error) {
    const details = error as { message?: string; penroseDiagnostics?: readonly import('../wire.ts').WireDiagnostic[] };
    reply({
      id: request.id,
      ok: false,
      message: details.message ?? String(error),
      ...(details.penroseDiagnostics ? { diagnostics: details.penroseDiagnostics } : {}),
    });
  }
}

function requireSession(key: string): CoreSession {
  const session = sessions.get(key);
  if (!session) throw new Error(`Unknown Penrose session: ${key}`);
  return session;
}
