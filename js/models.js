import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';

// v0.6.1: hand-built Blender models (models/*.glb). Each is exported in metres, origin on the ground,
// facing +Y in Blender = -Z in three.js (glTF export is Y-up); `front` says which way the model's bow/face points.
const loader = new GLTFLoader();
const cache = {};
export const MODELS = {
  tent: { file: 'tent.glb' }, paddler: { file: 'paddler.glb' }, kayaker: { file: 'kayaker.glb' }, boyStand: { file: 'boystand.glb' }, boyLeap: { file: 'boyleap.glb' },
  kayak1: { file: 'kayak1.glb' }, kayak2: { file: 'kayak2.glb' }, canoe: { file: 'canoe.glb' }, paddleDouble: { file: 'paddledouble.glb' }, paddleSingle: { file: 'paddlesingle.glb' },
  picnicTable: { file: 'picnictable.glb' }, cantaloupe: { file: 'cantaloupe.glb' }, rowboat: { file: 'rowboat.glb' }, dock: { file: 'dock.glb' }, launchDock: { file: 'launchdock.glb' }, rower: { file: 'rower.glb' }, canoeAlu: { file: 'canoealu.glb' }, deer: { file: 'deer.glb' }, fisher: { file: 'fisher.glb' },
};
/** load one model (cached); resolves to a fresh clone of the scene group, flat-shaded, with Blender +Y mapped to game +Z */
export function loadModel(name) {
  if (!cache[name]) cache[name] = new Promise((res, rej) => loader.load('models/' + MODELS[name].file, (g) => {
    const s = g.scene; s.traverse((o) => { if (o.isMesh) { o.material.flatShading = true; o.material.needsUpdate = true; o.castShadow = o.receiveShadow = false; } });
    // Blender +Y (model "forward") exports as -Z in three.js; the game's boats face +Z, so turn them round
    s.rotation.y = Math.PI; s.updateMatrixWorld(true);
    res(s);
  }, undefined, rej));
  return cache[name].then((s) => s.clone(true));
}
/** load several; returns { name: group } (missing files resolve to null so the game keeps working) */
export async function loadModels(names) {
  const out = {};
  await Promise.all(names.map((n) => loadModel(n).then((g) => (out[n] = g)).catch((e) => { console.warn('model', n, e); out[n] = null; })));
  return out;
}
/** replace every material in a loaded model with one shared material (silhouette / ghost); keeps geometry */
export function recolor(group, mat) { group.traverse((o) => { if (o.isMesh) o.material = mat; }); return group; }
/** wrap in a group so the caller can position/rotate without touching the model's own Y-up fix */
export function wrap(group) { const g = new THREE.Group(); g.add(group); return g; }
