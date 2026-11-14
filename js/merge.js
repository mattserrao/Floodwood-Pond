// v0.14.0: merge the static props (docks, campsites, the island's bits, the creek's rocks and logs...) into a few big
// meshes. They were ~730 separate meshes, each a draw call in the main view, again in the water's reflection and
// again in the shadow pass. Opaque, non-instanced meshes with the same look and in the same 400 m cell become one
// mesh; anything transparent, instanced, skinned, a sprite, a light or a custom shader is left alone.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js?v=0.14.0';

const sig = (m) => [m.type, m.color ? m.color.getHexString() : '', m.emissive ? m.emissive.getHexString() : '', m.flatShading, m.vertexColors, m.roughness, m.metalness,
  m.side, m.map ? m.map.uuid : '', m.fog, m.toneMapped, m.onBeforeCompile ? m.onBeforeCompile.toString().length : 0].join('|');

/** roots: objects whose subtrees are static; returns { before, after } mesh counts */
export function mergeStatic(scene, roots, cell = 400) {
  scene.updateMatrixWorld(true);
  const groups = new Map(); let before = 0;
  for (const root of roots) root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || o.userData.keep) return;
    const m = o.material; if (Array.isArray(m) || !m || m.transparent || m.isShaderMaterial || m.isRawShaderMaterial || m.alphaTest > 0 || m.colorWrite === false) return;
    let p = o.parent, hidden = false; while (p) { if (!p.visible) hidden = true; p = p.parent; } if (hidden) return;
    const c = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const key = sig(m) + '#' + Math.floor(c.x / cell) + ',' + Math.floor(c.z / cell);
    if (!groups.has(key)) groups.set(key, { m, list: [] }); groups.get(key).list.push(o); before++;
  });
  let after = 0;
  for (const { m, list } of groups.values()) {
    if (list.length < 2) { after += list.length; continue; }
    const geos = [];
    for (const o of list) {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      const keep = ['position', 'normal']; if (m.vertexColors) keep.push('color'); if (m.map) keep.push('uv');
      if (!g.attributes.normal) g.computeVertexNormals();
      if (m.vertexColors && !g.attributes.color) { const n = g.attributes.position.count; g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
      if (m.map && !g.attributes.uv) { g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
      g.applyMatrix4(o.matrixWorld); geos.push(g);
    }
    const merged = mergeGeometries(geos, false); if (!merged) { after += list.length; continue; }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, m); mesh.castShadow = list.some((o) => o.castShadow); mesh.receiveShadow = list.some((o) => o.receiveShadow);
    mesh.matrixAutoUpdate = false; mesh.userData.merged = list.length; scene.add(mesh); after++;
    for (const o of list) o.removeFromParent();
  }
  // empty groups left behind are dropped too (fewer objects for three.js to walk every frame)
  const empty = []; scene.traverse((o) => { if (o.isGroup && o.children.length === 0) empty.push(o); }); empty.forEach((o) => o.removeFromParent());
  return { before, after };
}
