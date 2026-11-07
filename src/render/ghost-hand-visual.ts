import {
  AdditiveBlending,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { KIND_DEFAULTS } from '../sim/bodies.js';
import { ROLE_COLORS } from './palette.js';
import { noRaycast } from './shaders/common.js';
import type { GhostHandVisual, XYZLike } from './visual-types.js';

/*
 * Onboarding ghost hand: a translucent right hand (palm, thumb, index, three
 * curled fingers and a wrist stub, all capsules or flattened spheres) that
 * shows the first move without text: it reaches over a planet, pinches,
 * carries a translucent copy of the planet along an arc, lets go, lifts away
 * and fades, every GHOST_HAND_PERIOD seconds. The real planet never moves.
 *
 * Built in a hand frame whose origin is the pinch point (x right, y up, +z
 * toward the player, fingers pointing -z), yawed by HAND_YAW so the pinch is
 * seen in profile from the player's seat. Thumb and index are two-bone
 * chains solved by a small analytic IK toward an open or a closed target, so
 * closing the pinch bends them naturally. Everything is in board units under
 * the board root. One fresnel "hologram" material for the hand and one for
 * the planet copy; about 1.1k triangles for the hand.
 */

/** Seconds per demonstration loop. */
export const GHOST_HAND_PERIOD = 5.2;
/** Hand size in board units per hand-frame unit. */
const HAND_SCALE = 1.8;
/**
 * Yaw of the hand frame (rad): the hand reaches in from the player's right,
 * fingers pointing left and away, thumb toward the player, so the pinch is
 * seen in profile and the wrist never hides it.
 */
const HAND_YAW = 1.2;
const PLANET_RADIUS = KIND_DEFAULTS.planet.radius;
/** Pinch point height above a resting planet's center (board units). */
const PINCH_HEIGHT = PLANET_RADIUS + 0.008;

// Timeline (seconds): approach, close, carry, open, lift + fade, then hidden.
const T_APPROACH = 1.0;
const T_CLOSE = 1.4;
const T_CARRY = 3.2;
const T_OPEN = 3.6;
const T_FADE = 4.4;
/** Height of the carry arc above the pinch height (board units). */
const ARC_LIFT = 0.18;

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/** GLSL fragment: faint body with a bright fresnel edge, so the shape reads as a hologram. */
const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBody;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
  float alpha = (uBody + (1.0 - uBody) * f) * uOpacity;
  gl_FragColor = vec4(uColor * (0.55 + 0.9 * f), alpha);
  #include <colorspace_fragment>
}
`;

function ghostMaterial(color: number, body: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'GhostHand',
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: 0 }, uBody: { value: body } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

const handMaterial = ghostMaterial(ROLE_COLORS.ghost, 0.16);
const planetMaterial = ghostMaterial(ROLE_COLORS.movablePlanet, 0.3);
const palmGeometry = new SphereGeometry(1, 12, 8);
const planetGeometry = new SphereGeometry(1, 16, 12);

type V3 = readonly [number, number, number];

/** A two-bone finger chain in the hand frame. */
interface Chain {
  readonly root: V3;
  readonly l1: number;
  readonly l2: number;
  readonly radius: number;
  /** Direction the middle joint bulges toward. */
  readonly pole: V3;
  readonly open: V3;
  readonly closed: V3;
}

const INDEX: Chain = {
  root: [-0.025, 0.11, 0.07],
  l1: 0.075,
  l2: 0.065,
  radius: 0.0125,
  pole: [0, 1, -1],
  open: [0.0, 0.04, -0.05],
  closed: [0.004, 0.004, 0],
};
const THUMB: Chain = {
  root: [-0.045, 0.06, 0.06],
  l1: 0.055,
  l2: 0.05,
  radius: 0.0135,
  pole: [-1, 0.3, 0],
  open: [-0.035, -0.02, 0.02],
  closed: [-0.004, -0.004, 0],
};
/** Middle, ring and little finger: static, curled under the palm (knuckle, tip, radius). */
const CURLED: readonly [V3, V3, number][] = [
  [[0.0, 0.115, 0.075], [0.004, 0.06, 0.035], 0.0125],
  [[0.022, 0.115, 0.08], [0.024, 0.065, 0.045], 0.012],
  [[0.042, 0.11, 0.09], [0.042, 0.07, 0.06], 0.0105],
];
const PALM = { center: [0.005, 0.12, 0.13] as V3, size: [0.052, 0.022, 0.066] as V3, pitch: -0.35 };
const WRIST: [V3, V3, number] = [[0.005, 0.13, 0.19], [0.01, 0.155, 0.245], 0.026];

const Y_AXIS = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpDir = new Vector3();
const tmpPole = new Vector3();
const tmpJoint = new Vector3();
const tmpTip = new Vector3();

function capsule(name: string, radius: number, length: number): Mesh {
  const mesh = new Mesh(new CapsuleGeometry(radius, Math.max(1e-4, length), 3, 8), handMaterial);
  mesh.name = name;
  mesh.raycast = noRaycast;
  return mesh;
}

/** Puts a Y-aligned capsule between hand-frame points a and b. */
function placeBetween(mesh: Mesh, a: Vector3, b: Vector3): void {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  tmpDir.copy(b).sub(a);
  const len = tmpDir.length();
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(Y_AXIS, tmpDir.multiplyScalar(1 / len));
}

function lerp3(a: V3, b: V3, t: number, out: Vector3): Vector3 {
  return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/**
 * Two-bone IK: the middle joint for a chain reaching toward `target`
 * (clamped to the reachable range), bulging toward the chain's pole.
 * Writes the joint and the tip.
 */
function solveChain(chain: Chain, target: Vector3, joint: Vector3, tip: Vector3): void {
  const root = tmpA.set(chain.root[0], chain.root[1], chain.root[2]);
  tmpDir.copy(target).sub(root);
  let d = tmpDir.length();
  tmpDir.multiplyScalar(1 / Math.max(d, 1e-6));
  d = Math.min(chain.l1 + chain.l2 - 1e-4, Math.max(Math.abs(chain.l1 - chain.l2) + 1e-4, d));
  const a = (chain.l1 * chain.l1 - chain.l2 * chain.l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, chain.l1 * chain.l1 - a * a));
  tmpPole.set(chain.pole[0], chain.pole[1], chain.pole[2]);
  tmpPole.addScaledVector(tmpDir, -tmpPole.dot(tmpDir)).normalize();
  joint.copy(root).addScaledVector(tmpDir, a).addScaledVector(tmpPole, h);
  tip.copy(root).addScaledVector(tmpDir, d);
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const easeOut = (x: number): number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/** One frame of the demonstration (board units). */
export interface GhostHandPose {
  /** Pinch point. */
  readonly pinch: [number, number, number];
  /** 0 open, 1 pinched. */
  grip: number;
  handAlpha: number;
  readonly planet: [number, number, number];
  planetAlpha: number;
}

/**
 * The demonstration at loop time `t` (wraps every GHOST_HAND_PERIOD),
 * carrying from board [x, z] `from` to `to`. Pure; writes `out`.
 */
export function ghostHandPose(t: number, from: XYZLike, to: XYZLike, out: GhostHandPose): GhostHandPose {
  let tau = t % GHOST_HAND_PERIOD;
  if (tau < 0) tau += GHOST_HAND_PERIOD;
  const fx = from[0];
  const fz = from[1];
  const tx = to[0];
  const tz = to[1];
  const p = out.pinch;
  const q = out.planet;
  if (tau < T_APPROACH) {
    const u = easeOut(tau / T_APPROACH);
    p[0] = fx + 0.3 * (1 - u);
    p[1] = PINCH_HEIGHT + 0.42 * (1 - u);
    p[2] = fz + 0.12 * (1 - u);
    out.grip = 0;
    out.handAlpha = smooth(tau / 0.35);
    q[0] = fx;
    q[1] = 0;
    q[2] = fz;
    out.planetAlpha = 0;
  } else if (tau < T_CLOSE) {
    const u = smooth((tau - T_APPROACH) / (T_CLOSE - T_APPROACH));
    p[0] = fx;
    p[1] = PINCH_HEIGHT;
    p[2] = fz;
    out.grip = u;
    out.handAlpha = 1;
    q[0] = fx;
    q[1] = 0;
    q[2] = fz;
    out.planetAlpha = u;
  } else if (tau < T_CARRY) {
    const u = smooth((tau - T_CLOSE) / (T_CARRY - T_CLOSE));
    const arc = ARC_LIFT * Math.sin(Math.PI * u);
    p[0] = fx + (tx - fx) * u;
    p[1] = PINCH_HEIGHT + arc;
    p[2] = fz + (tz - fz) * u;
    out.grip = 1;
    out.handAlpha = 1;
    q[0] = p[0];
    q[1] = arc;
    q[2] = p[2];
    out.planetAlpha = 1;
  } else if (tau < T_OPEN) {
    const u = smooth((tau - T_CARRY) / (T_OPEN - T_CARRY));
    p[0] = tx;
    p[1] = PINCH_HEIGHT + 0.01 * u;
    p[2] = tz;
    out.grip = 1 - u;
    out.handAlpha = 1;
    q[0] = tx;
    q[1] = 0;
    q[2] = tz;
    out.planetAlpha = 1;
  } else if (tau < T_FADE) {
    const u = (tau - T_OPEN) / (T_FADE - T_OPEN);
    p[0] = tx + 0.12 * u;
    p[1] = PINCH_HEIGHT + 0.01 + 0.3 * u * u;
    p[2] = tz;
    out.grip = 0;
    out.handAlpha = 1 - smooth(u);
    q[0] = tx;
    q[1] = 0;
    q[2] = tz;
    out.planetAlpha = 1 - smooth(u);
  } else {
    p[0] = tx + 0.12;
    p[1] = PINCH_HEIGHT + 0.31;
    p[2] = tz;
    out.grip = 0;
    out.handAlpha = 0;
    q[0] = tx;
    q[1] = 0;
    q[2] = tz;
    out.planetAlpha = 0;
  }
  return out;
}

export function createGhostHandVisual(): GhostHandVisual {
  const root = new Group();
  root.name = 'GhostHand';
  const hand = new Group();
  hand.name = 'GhostHand/Hand';
  hand.scale.setScalar(HAND_SCALE);
  hand.rotation.y = HAND_YAW;

  const palm = new Mesh(palmGeometry, handMaterial);
  palm.name = 'GhostHand/Palm';
  palm.position.set(PALM.center[0], PALM.center[1], PALM.center[2]);
  palm.scale.set(PALM.size[0], PALM.size[1], PALM.size[2]);
  palm.rotation.x = PALM.pitch;
  palm.raycast = noRaycast;
  hand.add(palm);

  const wa = tmpA.set(WRIST[0][0], WRIST[0][1], WRIST[0][2]);
  const wb = tmpB.set(WRIST[1][0], WRIST[1][1], WRIST[1][2]);
  const wrist = capsule('GhostHand/Wrist', WRIST[2], wa.distanceTo(wb));
  placeBetween(wrist, wa, wb);
  hand.add(wrist);

  CURLED.forEach(([knuckle, tip, radius], i) => {
    const a = tmpA.set(knuckle[0], knuckle[1], knuckle[2]);
    const b = tmpB.set(tip[0], tip[1], tip[2]);
    const finger = capsule(`GhostHand/Curled${i + 1}`, radius, a.distanceTo(b));
    placeBetween(finger, a, b);
    hand.add(finger);
  });

  const chainMeshes = (name: string, chain: Chain) => {
    const group = new Group();
    group.name = `GhostHand/${name}`;
    const proximal = capsule(`GhostHand/${name}/Proximal`, chain.radius, chain.l1);
    const distal = capsule(`GhostHand/${name}/Distal`, chain.radius * 0.9, chain.l2);
    group.add(proximal, distal);
    hand.add(group);
    return { chain, proximal, distal, root: new Vector3(chain.root[0], chain.root[1], chain.root[2]) };
  };
  const index = chainMeshes('Index', INDEX);
  const thumb = chainMeshes('Thumb', THUMB);

  const planet = new Mesh(planetGeometry, planetMaterial);
  planet.name = 'GhostHand/Planet';
  planet.scale.setScalar(PLANET_RADIUS);
  planet.raycast = noRaycast;
  planet.renderOrder = 5;
  root.add(planet, hand);
  root.visible = false;

  const pose: GhostHandPose = { pinch: [0, 0, 0], grip: 0, handAlpha: 0, planet: [0, 0, 0], planetAlpha: 0 };
  const target = new Vector3();

  const poseChain = (c: ReturnType<typeof chainMeshes>, grip: number) => {
    lerp3(c.chain.open, c.chain.closed, grip, target);
    solveChain(c.chain, target, tmpJoint, tmpTip);
    placeBetween(c.proximal, c.root, tmpJoint);
    placeBetween(c.distal, tmpJoint, tmpTip);
  };

  return {
    root,
    setVisible(visible) {
      root.visible = visible;
    },
    update(t, from, to) {
      ghostHandPose(t, from, to, pose);
      hand.position.set(pose.pinch[0], pose.pinch[1], pose.pinch[2]);
      poseChain(index, pose.grip);
      poseChain(thumb, pose.grip);
      planet.position.set(pose.planet[0], pose.planet[1], pose.planet[2]);
      handMaterial.uniforms.uOpacity.value = pose.handAlpha;
      planetMaterial.uniforms.uOpacity.value = pose.planetAlpha;
      hand.visible = pose.handAlpha > 0.001;
      planet.visible = pose.planetAlpha > 0.001;
    },
  };
}
