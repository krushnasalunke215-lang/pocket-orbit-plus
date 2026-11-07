# Vendored WebXR input profile hand models

These files come unmodified from the npm package
[`@webxr-input-profiles/assets`](https://www.npmjs.com/package/@webxr-input-profiles/assets)
version **1.0.20**, the version jsDelivr serves for the `@1.0` path that
IWSDK uses by default.

| File | Package path | Bytes |
| --- | --- | --- |
| `generic-hand/left.glb` | `dist/profiles/generic-hand/left.glb` | 94,572 |
| `generic-hand/right.glb` | `dist/profiles/generic-hand/right.glb` | 94,004 |

They are served from this site's own origin so hand tracking never fetches
from a CDN (see `src/xr/hand-visuals.ts`). Controller models still use the
IWSDK default CDN path.

License: MIT, Copyright (c) 2019 Amazon. See `LICENSE.md` (copied from the
package; its `package.json` license field is empty).
