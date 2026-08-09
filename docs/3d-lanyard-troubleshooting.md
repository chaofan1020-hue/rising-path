# 3D Lanyard Troubleshooting

## Scope

Use this guide when the registration-success Lanyard animation on `/login` is slow, flashes briefly, becomes blank, or fails to appear. The current implementation is in `src/components/Lanyard.tsx` and is displayed by `src/components/RegistrationSuccess.tsx`.

Do not reduce model, texture, lighting, or physics quality as the first response. Identify which layer failed first: build, dynamic module loading, WebGL, assets, or scene state.

## Fast Classification

| Symptom | Most likely layer | First check |
| --- | --- | --- |
| Success modal opens but there is no `<canvas>` | Dynamic Three/Rapier module did not load or compile | Browser Network and `.next/dev/logs/next-development.log` |
| Card appears briefly, then the canvas becomes blank | WebGL context was released | `canvas.getContext('webgl2').isContextLost()` |
| Canvas remains valid but card is outside the viewport | Physics, camera, or scene positions | Rigid body positions, gravity, camera, and model bounds |
| First click takes a long time and server memory/CPU spikes | Compiler is transforming large 3D dependencies | Check for a root Babel config that disables SWC |
| `card.glb` or `lanyard.png` returns 404 | Static assets are missing or incorrectly referenced | Confirm `public/card.glb` and `public/lanyard.png` |

## Known Root Causes And Fixes

### 1. React Strict Mode releases the active WebGL context

**Observed behavior**: the card renders once, then disappears. Browser console includes `THREE.WebGLRenderer: Context Lost`; `isContextLost()` returns `true`.

**Cause**: React Strict Mode replays mount effects in development. In this project, `@react-three/fiber` releases the WebGL context during that replay. Its delayed cleanup can then release the context belonging to the remounted Lanyard canvas.

**Required configuration**: keep the following in `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  turbopack: {},
  reactStrictMode: false,
};
```

Restart `pnpm dev` after changing this configuration. A hot reload is not enough.

### 2. A root `.babelrc` disables SWC and breaks heavy 3D dependencies

**Observed behavior**: the modal opens but no canvas is inserted, loading is extremely slow, or Next logs parser errors from `@react-three/drei`, `three`, `rapier`, or `troika-three-text`. The development server can consume several GB of memory while compiling.

**Cause**: any root Babel configuration makes Next use Babel instead of SWC. Babel then transforms large modern ESM packages used by this scene and can fail on their syntax.

**Required configuration**: do not add a root `.babelrc` or `babel.config.*` unless a concrete requirement has been evaluated against this scene. The obsolete inspector Babel plugin must not be restored through a root Babel config.

When this reappears, inspect the dev log for either of these messages:

```text
Disabled SWC as replacement for Babel because of custom Babel configuration
Using external babel configuration
```

Remove the Babel configuration, restart `pnpm dev`, and retest before changing the 3D component.

## Diagnostic Procedure

1. Start the project with `pnpm dev`, then open `http://localhost:5000/login`.
2. Click `测试卡片展示` in development or complete a real registration flow.
3. In browser DevTools Console, run:

```js
[...document.querySelectorAll('canvas')].map((canvas) => ({
  width: canvas.width,
  height: canvas.height,
  contextLost:
    canvas.getContext('webgl2')?.isContextLost?.() ??
    canvas.getContext('webgl')?.isContextLost?.() ??
    null,
}));
```

4. Interpret the result:

| Result | Next action |
| --- | --- |
| No canvas | Inspect failed or pending dynamic chunk requests and the Next dev log. Check for a restored Babel config first. |
| `contextLost: true` | Check `next.config.ts`; restore `reactStrictMode: false`, restart the development server, and retest. |
| `contextLost: false` but no visible card | Verify `/card.glb` and `/lanyard.png` return HTTP 200, then inspect camera and Rapier body state. |
| Canvas and card both visible | Do not change rendering quality. Investigate only remaining interaction or performance concerns. |

5. Verify the static resources directly:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5000/card.glb
Invoke-WebRequest -UseBasicParsing http://localhost:5000/lanyard.png
```

Both requests must return `200`.

6. Read the active development log when loading or module failures occur:

```powershell
Get-Content .next\dev\logs\next-development.log -Tail 100
```

## Validation Standard

A fix is complete only when all of the following are true:

- The registration-success modal opens.
- The page contains one Lanyard canvas.
- After at least 8 seconds, the canvas reports `contextLost: false`.
- The card remains visible and interactive in the viewport.
- Browser console has no errors. The existing Three deprecation and shader precision warnings are non-blocking warnings, not render failures.
- `pnpm run ts-check` passes.

## Component Contract

- `public/card.glb` and `public/lanyard.png` are required runtime assets.
- `Lanyard.tsx` must remain client-only; `RegistrationSuccess.tsx` loads it with `next/dynamic` and `ssr: false`.
- Use one Canvas per shown success modal. Multiple hidden or stale test canvases can compete for browser WebGL contexts during debugging.
- Preserve the current model, physical material, environment lights, Rapier constraints, and drag behavior unless the diagnostic result identifies that layer as the failure.

## Information To Provide For A Future Report

Provide these details with the symptom so the issue can be classified quickly:

- Exact page and action that trigger the issue.
- Whether the modal appears, whether a card appears briefly, and whether it later disappears.
- Browser console errors and the `contextLost` result above.
- Last 100 lines of `.next/dev/logs/next-development.log`.
- Whether `.babelrc` or another Babel configuration exists at the repository root.
- Whether `/card.glb` and `/lanyard.png` return HTTP 200.
