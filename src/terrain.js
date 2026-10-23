import * as THREE from 'three';
import { naturalHeight, forestDensity, fbm2, noise2, smoothstep, lerp } from './util.js';

const C = (hex) => new THREE.Color(hex);
const STRAW = C('#ebc86e');
const GOLD = C('#d8a648');
const OLIVE = C('#b5a650');
const RUST = C('#a65e2e');
const LITTER = C('#8e5a2c');
const VERGE = C('#c4a35a');

export class Terrain {
  constructor(track, { size, segments }) {
    this.size = size;
    this.seg = segments;
    this.cell = size / segments;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const count = pos.count;
    this.heights = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const col = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const nat = naturalHeight(x, z);
      let h = nat;
      let roadDist = 1e9;
      const q = track.nearest(x, z, 70);
      if (q) {
        roadDist = q.dist;
        // flat verge right next to the road, blending into the natural terrain
        h = lerp(q.h - 0.45, nat, smoothstep(13, 58, q.dist));
      }
      this.heights[i] = h;
      pos.setY(i, h);

      // field colors
      const n1 = fbm2(x / 240, z / 240, 2);
      const n2 = fbm2(x / 650 + 5.2, z / 650 - 3.1, 2);
      col.copy(GOLD).lerp(STRAW, smoothstep(-0.25, 0.25, n1));
      col.lerp(OLIVE, smoothstep(0.08, 0.3, n2) * 0.55);
      const rust = smoothstep(0.12, 0.3, fbm2(x / 180 - 9.1, z / 180 + 2.4, 2));
      col.lerp(RUST, rust * 0.25);
      const forest = forestDensity(x, z);
      col.lerp(LITTER, forest * 0.6);
      if (roadDist < 20) col.lerp(VERGE, (1 - roadDist / 20) * 0.5);
      const b = 0.94 + noise2(x / 23, z / 23) * 0.12;
      colors[i * 3] = col.r * b;
      colors[i * 3 + 1] = col.g * b;
      colors[i * 3 + 2] = col.b * b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.geometry = geo;
  }

  // exact height of the rendered triangle mesh
  heightAt(x, z) {
    const n = this.seg;
    let fx = (x + this.size / 2) / this.cell;
    let fz = (z + this.size / 2) / this.cell;
    fx = Math.min(Math.max(fx, 0), n - 1e-4);
    fz = Math.min(Math.max(fz, 0), n - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const w = n + 1;
    const ha = this.heights[iz * w + ix];
    const hb = this.heights[(iz + 1) * w + ix];
    const hc = this.heights[(iz + 1) * w + ix + 1];
    const hd = this.heights[iz * w + ix + 1];
    if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
    return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  }

  // split into tiles so frustum culling can skip most of the terrain
  createMesh(detailTexture, tileCells = 60) {
    detailTexture.wrapS = detailTexture.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec4 sampledDiffuseColor = texture2D( map, vMapUv ) * mix( vec4( 1.0 ), texture2D( map, vMapUv * 0.111 + 0.37 ), 0.7 ) * 1.12;
        diffuseColor *= sampledDiffuseColor;`,
      );
    };
    const group = new THREE.Group();
    group.name = 'terrain';
    const src = this.geometry.attributes;
    const w = this.seg + 1;
    for (let tz = 0; tz < this.seg; tz += tileCells) {
      for (let tx = 0; tx < this.seg; tx += tileCells) {
        const nx = Math.min(tileCells, this.seg - tx) + 1;
        const nz = Math.min(tileCells, this.seg - tz) + 1;
        const pos = new Float32Array(nx * nz * 3);
        const nor = new Float32Array(nx * nz * 3);
        const col = new Float32Array(nx * nz * 3);
        const uv = new Float32Array(nx * nz * 2);
        for (let z = 0; z < nz; z++) {
          for (let x = 0; x < nx; x++) {
            const si = (tz + z) * w + tx + x;
            const di = z * nx + x;
            for (let a = 0; a < 3; a++) {
              pos[di * 3 + a] = src.position.array[si * 3 + a];
              nor[di * 3 + a] = src.normal.array[si * 3 + a];
              col[di * 3 + a] = src.color.array[si * 3 + a];
            }
            uv[di * 2] = pos[di * 3] / 9;
            uv[di * 2 + 1] = pos[di * 3 + 2] / 9;
          }
        }
        const index = [];
        for (let z = 0; z < nz - 1; z++) {
          for (let x = 0; x < nx - 1; x++) {
            const a = z * nx + x, b = (z + 1) * nx + x, c = (z + 1) * nx + x + 1, d = z * nx + x + 1;
            index.push(a, b, d, b, c, d);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(index);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, mat);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    this.geometry.dispose();
    return group;
  }
}
