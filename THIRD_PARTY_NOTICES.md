# Third-party notices

This extension bundles the following packages into `dist/plugin.js` (the engine
is embedded inside the worker source). Versions are pinned in `package.json`
and `pnpm-lock.yaml`.

## @penrose/core 3.3.1 — MIT

<https://github.com/penrose/penrose>

Runtime dependencies of `@penrose/core` (transitively bundled):

| Package | License |
| --- | --- |
| `moo` | MIT |
| `rose` | MIT |
| `lodash` | MIT |
| `consola` | MIT |
| `nearley` | MIT |
| `immutable` | MIT |
| `ml-matrix` | MIT |
| `true-myth` | MIT |
| `seedrandom` | MIT |
| `pandemonium` | MIT |
| `mathjax-full` | **Apache-2.0** |
| `poly-partition` | MIT |
| `recursive-diff` | MIT |
| `@datastructures-js/queue` | MIT |

## MathJax 3.2.2 — Apache-2.0

<https://www.mathjax.org/>

The worker uses `mathjax-full` with the `liteAdaptor`, the TeX input jax
(`AllPackages`) and the SVG output jax (`fontCache: 'none'`). MathJax renders
equations to SVG paths; no MathJax web fonts or external assets are shipped.

## License texts

Full license texts are available from each package's repository and from
`node_modules/<package>/LICENSE` after `pnpm install`. If a package is added or
upgraded, update this file in the same change.
