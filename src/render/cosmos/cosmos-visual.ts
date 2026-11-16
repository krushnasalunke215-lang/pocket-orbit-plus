import {
  DataTexture,
  Group,
  type InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  type Points,
  Vector3,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import type { CosmosQuality } from '../../config.js';
import { noRaycast, setMotionTime } from '../shaders/common.js';
import { createSkyMaterial } from '../shaders/sky.js';
import type { CosmosVisual } from '../visual-types.js';
import { createAsteroidBelt } from './asteroids.js';
import { createConstellation } from './constellation.js';
import { createDust } from './dust.js';
import { createCosmosPlanets, PULSE_SCALE } from './planets.js';
import { createShootingStars } from './shooting-stars.js';
import { bakeSkyPixels, GALAXY_CORE, GALAXY_NORMAL } from './sky-pixels.js';
import { createStars } from './stars.js';
import { createSun } from './sun.js';

export { COSMOS_UNIFORMS } from '../shaders/sky.js';

/*
 * The surrounding cosmos, in world meters under one root named 'Cosmos'
 * (CosmosSystem keeps it at the board center with the board's turn), in
 * depth layers for stereo parallax: the sky dome (60 m: the Milky Way
 * panorama over its procedural fallback, turned so the band crosses the sky
 * diagonally away from the sun), the star field and glints (55 m), the sun
 * (45 m), the chapter constellation (about 32 m, L4), the giant ringed
 * planet (12.4 m) and the orbiting planets (3.2-14 m), the asteroid belt
 * (2.5-4 m), the near dust motes (0.3-1.5 m around the eyes) and the
 * shooting stars (off by default). Out of reach, never raycast, never occluded by real
 * surfaces.
 */

const SKY_RADIUS = 60;
const SKY_SEED = 0x5eed;

export function createCosmosVisual(quality: CosmosQuality): CosmosVisual {
  const root = new Group();
  root.name = 'Cosmos';

  const [w, h] = quality.skyTexture;
  const sky = new DataTexture(bakeSkyPixels(w, h, SKY_SEED), w, h);
  sky.colorSpace = SRGBColorSpace;
  sky.wrapS = RepeatWrapping;
  sky.magFilter = LinearFilter;
  sky.minFilter = LinearMipmapLinearFilter;
  sky.generateMipmaps = true;
  sky.needsUpdate = true;
  const dome = new Mesh(new SphereGeometry(SKY_RADIUS, 48, 24), createSkyMaterial(sky));
  dome.name = 'CosmosSky';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.raycast = noRaycast;
  // Dome local +Y (the bake's and the panorama's band normal) to GALAXY_NORMAL, local +X (their core) to GALAXY_CORE.
  const core = new Vector3(...GALAXY_CORE);
  const normal = new Vector3(...GALAXY_NORMAL);
  dome.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(core, normal, new Vector3().crossVectors(core, normal)));

  const stars = createStars(quality.starCount, quality.glints);
  const sun = createSun();
  const planets = createCosmosPlanets();
  const belt = createAsteroidBelt(quality.asteroids);
  const dust = quality.dustMotes > 0 ? createDust(quality.dustMotes) : null;
  const shooting = quality.shootingStars ? createShootingStars() : null;
  const constellation = createConstellation();
  root.add(dome, stars, sun, planets.root, belt.root, constellation.root);
  if (shooting) root.add(shooting.mesh);
  if (dust) root.add(dust);

  const probe = new Matrix4();
  return {
    root,
    constellation,
    motionProbe() {
      planets.smallMesh.getMatrixAt(0, probe);
      const e = probe.elements;
      return [e[12], e[13], e[14], belt.yaw()];
    },
    update(motionT, realT, dt, reducedMotion) {
      setMotionTime(motionT);
      PULSE_SCALE.value = reducedMotion ? 0 : 0.15;
      planets.update(motionT, dt);
      belt.update(motionT);
      shooting?.update(realT, reducedMotion);
      constellation.update(dt, reducedMotion);
    },
    setEyeHeight(height) {
      belt.setEyeHeight(height);
    },
    pulse(index, strength) {
      planets.pulse(index, strength);
    },
    pulseLevel(index) {
      return planets.pulseLevel(index);
    },
    activeShootingStars(realT) {
      return shooting ? shooting.active(realT) : 0;
    },
    applyQuality(q) {
      const glints = stars.getObjectByName('CosmosGlints');
      if (glints && !q.glints) glints.visible = false;
      if (dust && q.dustMotes === 0) dust.visible = false;
      const field = stars.getObjectByName('CosmosStarField') as Points | undefined;
      if (field) field.geometry.setDrawRange(0, Math.min(q.starCount, field.geometry.getAttribute('position').count));
      const rocks = belt.root.getObjectByName('AsteroidRocks') as InstancedMesh | undefined;
      if (rocks) rocks.count = Math.min(q.asteroids, rocks.count);
    },
  };
}
