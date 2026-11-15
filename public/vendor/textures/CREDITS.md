# Texture credits

All textures in this folder are by **Solar System Scope** (https://www.solarsystemscope.com/textures/),
distributed under the **Creative Commons Attribution 4.0 International** licence (CC BY 4.0,
https://creativecommons.org/licenses/by/4.0/). The source page says the textures are "Distributed under
Attribution 4.0 International license" and that they "are based on NASA elevation and imagery data",
with colours tuned to true-colour photos from the Messenger, Viking and Cassini spacecraft and the Hubble
Space Telescope (checked Nov 15 2026).

Source files: `https://www.solarsystemscope.com/textures/download/<name>` (2k versions).
Regenerate with `node scripts/vendor-textures.mjs`.

| File | Source files | Changes |
| --- | --- | --- |
| `milky-way-2k.webp` (2048x1024) | `2k_stars_milky_way.jpg` | re-encoded to WebP |
| `milky-way-1k.webp` (1024x512) | `2k_stars_milky_way.jpg` | resized, re-encoded to WebP |
| `saturn-2k.webp` (2048x1024) | `2k_saturn.jpg` | re-encoded to WebP |
| `saturn-1k.webp` (1024x512) | `2k_saturn.jpg` | resized, re-encoded to WebP |
| `saturn-ring.webp` (1024x64) | `2k_saturn_ring_alpha.png` | resized, re-encoded to WebP with alpha |
| `planets-2k.webp` (2048x2048) | `2k_earth_daymap.jpg`, `2k_uranus.jpg`, `2k_moon.jpg`, `2k_mercury.jpg`, `2k_jupiter.jpg`, `2k_neptune.jpg`, `2k_mars.jpg` | resized, packed into a 2x4 atlas (earth, uranus, moon, mercury, jupiter, neptune, mars, ice), the ice tile is the moon desaturated, lifted and tinted pale blue, re-encoded to WebP |
| `planets-1k.webp` (1024x1024) | as `planets-2k.webp` | as `planets-2k.webp`, at half size |

Textures by Solar System Scope, https://www.solarsystemscope.com/textures/, CC BY 4.0.
