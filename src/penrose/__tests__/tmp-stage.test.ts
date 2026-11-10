import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileSession } from '../engine/core.ts';
import { evalEnergy, start, step, stepTimes } from '@penrose/core';

describe('stage probe', () => {
  it('steps', async () => {
    const session = await compileSession({
      digest: 'g',
      domain: readFileSync('src/__tests__/fixtures/graph.domain', 'utf8'),
      substance: readFileSync('src/__tests__/fixtures/graph.substance', 'utf8'),
      style: readFileSync('src/__tests__/fixtures/graph.style', 'utf8'),
      variation: '0',
    });
    const state = session.state as any;
    console.log('optStages', state.optStages, 'current', state.currentStageIndex, 'weight', state.params.weight, 'status', state.params.optStatus);
    for (const [stage, masks] of state.constraintSets) {
      const m = masks as any;
      console.log('stage', JSON.stringify(stage), 'inputs', m.inputMask.filter(Boolean).length, '/', m.inputMask.length, 'constr', m.constrMask.filter(Boolean).length, '/', m.constrMask.length, 'obj', m.objMask.filter(Boolean).length, '/', m.objMask.length);
    }
    console.log('constrFns', state.constrFns.length, 'objFns', state.objFns.length);
    console.log('energy before', evalEnergy(state));
    const textInput = session.compiled.interactivity.translatable.find(i => i.path.includes('Chicago`.text'))!;
    const dotInput = session.compiled.interactivity.translatable.find(i => i.path.includes('Chicago`.dot'))!;
    console.log('text center idx', textInput.center, 'dot idx', dotInput.center);
    for (const stage of ['dots', 'text']) {
      const m: any = state.constraintSets.get(stage);
      console.log('mask', stage, 'textIdx', textInput.center!.map(i => m.inputMask[i]), 'dotIdx', dotInput.center!.map(i => m.inputMask[i]));
    }
    const labelOf = () => {
      const shapes = state.computeShapes(state.varyingValues) as any[];
      const text = shapes.find(s => s.name?.contents === '`Chicago`.text');
      return text.center.contents;
    };
    console.log('label before', labelOf());
    const values = [...state.varyingValues];
    values[dotInput.center![0]] += 20;
    const restarted = { ...state, varyingValues: values, params: { ...start(values.length), weight: state.params.weight } };
    console.log('energy after dot move', evalEnergy(restarted as any));
    const t = performance.now();
    const out = step(restarted as any, { until: () => performance.now() - t > 20 });
    console.log('step ok', out.isOk(), 'status', out.isOk() ? out.value.params.optStatus : out.error, 'energy', out.isOk() ? evalEnergy(out.value) : '');
    const long = stepTimes(restarted as any, 2000);
    if (long.isOk()) {
      const shapes = long.value.computeShapes(long.value.varyingValues) as any[];
      const text = shapes.find((s: any) => s.name?.contents === '`Chicago`.text');
      console.log('long label', text.center.contents, 'energy', evalEnergy(long.value), 'status', long.value.params.optStatus, 'stage', long.value.currentStageIndex);
    const masks: any = state.constraintSets.get('text');
    const xs = new Float64Array(state.varyingValues);
    const grad = new Float64Array(xs.length);
    const g = (state as any).gradient(masks, xs, state.params.weight, grad);
    console.log('gradient text center', grad[textInput.center![0]], grad[textInput.center![1]], 'phi', g?.phi);
    for (const w of [1e4, 1e5, 1e6, 1e7, 1e8]) {
      const mv = [...state.varyingValues];
      mv[textInput.center![0]] += 20;
      const out = step({ ...state, varyingValues: mv, params: { ...start(mv.length), weight: w } as any } as any, { until: () => false });
      if (out.isOk()) {
        const shapes = out.value.computeShapes(out.value.varyingValues) as any[];
        const t = shapes.find((s: any) => s.name?.contents === '`Chicago`.text');
        console.log('weight', w, 'label x', t.center.contents[0].toFixed(2), 'UO', out.value.params.UOround, 'status', out.value.params.optStatus);
      }
    }
    // Variant: reset params but keep the initial weight.
    const moved3 = [...state.varyingValues];
    moved3[textInput.center![0]] += 20;
    const p3 = { ...start(moved3.length), weight: 1e3 } as any;
    const v3 = step({ ...state, varyingValues: moved3, params: p3 } as any, { until: () => false });
    if (v3.isOk()) {
      const shapes = v3.value.computeShapes(v3.value.varyingValues) as any[];
      const t = shapes.find((s: any) => s.name?.contents === '`Chicago`.text');
      console.log('variant weight1e3 label', t.center.contents, 'status', v3.value.params.optStatus, 'UO', v3.value.params.UOround, 'weight', v3.value.params.weight);
    }
    // Variant: keep original optimizer fields, only flip the status.
    const moved2 = [...state.varyingValues];
    moved2[textInput.center![0]] += 20;
    const p2 = { ...state.params, optStatus: 'UnconstrainedRunning' };
    const v2 = step({ ...state, varyingValues: moved2, params: p2 } as any, { until: () => false });
    if (v2.isOk()) {
      const shapes = v2.value.computeShapes(v2.value.varyingValues) as any[];
      const t = shapes.find((s: any) => s.name?.contents === '`Chicago`.text');
      console.log('variant status-only label', t.center.contents, 'status', v2.value.params.optStatus, 'UO', v2.value.params.UOround, 'weight', v2.value.params.weight);
    }
    // Perturb the label itself: does the text stage pull it back?
    const base = state.varyingValues;
    const moved = [...base];
    moved[textInput.center![0]] += 20;
    const textRestart = { ...state, varyingValues: moved, params: { ...start(moved.length), weight: state.params.weight } };
    const textStep = stepTimes(textRestart as any, 2000);
    if (textStep.isOk()) {
      const shapes = textStep.value.computeShapes(textStep.value.varyingValues) as any[];
      const t2 = shapes.find((s: any) => s.name?.contents === '`Chicago`.text');
      console.log('label after own perturbation', t2.center.contents, 'energy', evalEnergy(textStep.value), 'status', textStep.value.params.optStatus);
    }
    }
    if (out.isOk()) {
      const shapes = out.value.computeShapes(out.value.varyingValues) as any[];
      const text = shapes.find(s => s.name?.contents === '`Chicago`.text');
      console.log('label after', text.center.contents, 'weight', out.value.params.weight);
    }
  });
});
