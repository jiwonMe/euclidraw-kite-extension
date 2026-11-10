import type { ActivationContext, CanvasFrameScheduler, CanvasToolSurface, CanvasToolSurfaceProvider, EntityId } from '../host.ts';
import type { CompiledScope } from '../dsl/compile.ts';
import { COMPUTED } from '../manifest.ts';
import { MEMBER_ASPECT, type KiteMemberAspect } from '../schema.ts';
import { actionsFor, type ConstraintAction } from '../workbench/constraint-catalog.ts';
import type { MemberDerived } from '../aspect-specs.ts';

/**
 * Space 2B (untransformed screen HUD): a node-anchored action bar over a
 * selection of 1–3 Kite members, offering the constraints that selection
 * admits as one-click buttons. Positioned from the host frame latch; the
 * camera never enters UI state. Buttons are marked `data-canvas-ui` so the
 * selection tool leaves them to the browser.
 */

export interface PopoverOptions {
  run(scopeId: EntityId, action: ConstraintAction): void;
}

export class Space2BPopover {
  private surface?: CanvasToolSurface;
  private root?: HTMLDivElement;
  private key = '';
  private readonly disposers: (() => void)[] = [];
  private actions: readonly ConstraintAction[] = [];
  private scopeId?: EntityId;
  hidden = false;

  constructor(private readonly context: ActivationContext, private readonly options: PopoverOptions) {
    const provider = context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface');
    if (provider) { this.bind(provider.get()); this.disposers.push(provider.subscribe(() => this.bind(provider.get()))); }
    const frames = context.services.get<CanvasFrameScheduler>('canvas.frames');
    if (frames) this.disposers.push(frames.subscribe(() => this.paint()));
  }

  private bind(surface: CanvasToolSurface | undefined): void {
    if (surface === this.surface) return;
    this.root?.remove();
    this.surface = surface;
    this.root = undefined;
    this.key = '';
    if (!surface) return;
    const doc = surface.surface.element.ownerDocument;
    const root = doc.createElement('div');
    root.dataset.role = 'kite-space2b';
    root.dataset.canvasUi = '';
    root.setAttribute('role', 'toolbar');
    root.setAttribute('aria-label', 'Kite 구속 조건');
    root.style.cssText = 'position:absolute;left:0;top:0;display:none;gap:4px;padding:4px;border-radius:9px;background:var(--alid-bg-elevated,#fff);box-shadow:0 6px 24px rgba(15,23,42,.18),0 0 0 1px rgba(15,23,42,.08);pointer-events:auto;z-index:6;white-space:nowrap;font:600 11.5px/1 var(--alid-font,system-ui,sans-serif);transform:translate3d(-9999px,-9999px,0)';
    root.addEventListener('pointerdown', event => event.stopPropagation());
    surface.surface.hud.append(root);
    this.root = root;
  }

  /** Selected members of a single scope, with their primitive kinds. */
  private picked(): { scopeId: EntityId; compiled: CompiledScope; items: { id: string; kind: KiteMemberAspect['primitiveKind']; entity: EntityId }[] } | undefined {
    const world = this.context.world;
    const items: { id: string; kind: KiteMemberAspect['primitiveKind']; entity: EntityId }[] = [];
    let scopeId: EntityId | undefined;
    for (const id of this.surface?.selection.getSelection() ?? []) {
      const member = world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
      if (!member) return undefined;
      if (scopeId && member.scopeId !== scopeId) return undefined;
      scopeId = member.scopeId;
      items.push({ id: member.substanceId, kind: member.primitiveKind, entity: id });
    }
    if (!scopeId || !items.length || items.length > 3) return undefined;
    const compiled = world.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm);
    return compiled?.ok ? { scopeId, compiled, items } : undefined;
  }

  paint(): void {
    const root = this.root, surface = this.surface;
    if (!root || !surface) return;
    const picked = this.hidden ? undefined : this.picked();
    const actions = picked ? actionsFor(picked.compiled, picked.items) : [];
    if (!picked || !actions.length || this.context.world.isEntityReadOnly(picked.scopeId)) { root.style.display = 'none'; this.key = ''; return; }
    const key = `${picked.scopeId}|${actions.map(action => action.id).join(',')}`;
    if (key !== this.key) {
      this.key = key;
      this.actions = actions;
      this.scopeId = picked.scopeId;
      const doc = root.ownerDocument;
      root.replaceChildren(...actions.slice(0, 6).map(action => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.title = action.statement;
        button.dataset.kiteAction = action.id;
        button.style.cssText = 'appearance:none;border:0;border-radius:6px;padding:6px 9px;background:transparent;color:var(--alid-text,#18181b);cursor:pointer;font:inherit';
        button.addEventListener('mouseenter', () => { button.style.background = 'var(--alid-bg-muted,#f4f4f5)'; });
        button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          const chosen = this.actions.find(item => item.id === action.id);
          if (chosen && this.scopeId) this.options.run(this.scopeId, chosen);
        });
        return button;
      }));
      root.style.display = 'flex';
    }
    // Anchor above the union of the selected members' boxes.
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const item of picked.items) {
      const derived = this.context.world.getPreviewView().getComputed<MemberDerived>(item.entity, COMPUTED.member);
      if (!derived || 'error' in derived) continue;
      minX = Math.min(minX, derived.x); maxX = Math.max(maxX, derived.x + derived.width); minY = Math.min(minY, derived.y);
    }
    if (!Number.isFinite(minX)) { root.style.display = 'none'; return; }
    const out = { x: 0, y: 0 };
    surface.host.worldToScreen((minX + maxX) / 2, minY, out);
    const rect = surface.surface.hud.getBoundingClientRect();
    const x = out.x - rect.left, y = out.y - rect.top - 14;
    root.style.transform = `translate3d(${Math.round(x)}px,${Math.round(Math.max(8, y))}px,0) translate(-50%,-100%)`;
  }

  dispose(): void {
    for (const off of this.disposers.splice(0).reverse()) off();
    this.root?.remove();
    this.root = undefined;
  }
}
