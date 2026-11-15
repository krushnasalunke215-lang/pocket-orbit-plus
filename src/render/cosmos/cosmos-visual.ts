import {
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { COSMOS_QUALITY } from '../../config.js';
import { noRaycast, setMotionTime } from '../shaders/common.js';
import { createSkyMaterial } from '../shaders/sky.js';
import type { CosmosVisual } from '../visual-types.js';
import { createAsteroidBelt } from './asteroids.js';
import { createConstellation } from './constellation.js';
import { createCosmosPlanets, PULSE_SCALE } from './planets.js';
import { createShootingStars } from './shooting-stars.js';
import { bakeSkyPixels } from './sky-pixels.js';
import { createStars } from './stars.js';

export { COSMOS_UNIFORMS } from '../shaders/sky.js';

/*
 * The surrounding cosmos, in world meters under one root named 'Cosmos'
 * (CosmosSystem keeps it at the board center with the board's turn): the
 * baked nebula sky dome (12 m), the star layers, the giant ringed planet and
 * the orbiting planets, the asteroid belt, the shooting stars and the chapter
 * constellation (L4). Out of
 * reach (1.5-12 m), never raycast, never occluded by real surfaces.
 */

const SKY_RADIUS = 12;
const SKY_SEED = 0x5eed;

export function createCosmosVisual(): CosmosVisual {
  const root = new Group();
  root.name = 'Cosmos';

  const [w, h] = COSMOS_QUALITY.skyTexture;
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

  const stars = createStars(COSMOS_QUALITY.starLayers);
  const planets = createCosmosPlanets(COSMOS_QUALITY.cosmosInk);
  const belt = createAsteroidBelt(COSMOS_QUALITY.asteroids, COSMOS_QUALITY.cosmosInk);
  const shooting = COSMOS_QUALITY.shootingStars ? createShootingStars() : null;
  const constellation = createConstellation();
  root.add(dome, stars, planets.root, belt.root, constellation.root);
  if (shooting) root.add(shooting.mesh);

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
  };
}
