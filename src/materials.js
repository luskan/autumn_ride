import * as THREE from 'three';
import { SUN_DIR } from './config.js';

export const shaderTime = { value: 0 };

const sunGlsl = `vec3(${SUN_DIR.map((v) => v.toFixed(5)).join(', ')})`;

// Foliage glows when the camera looks towards the sun (leaves are translucent),
// optionally sways in the wind (height taken from uv.y).
export function foliageMaterial(params, { glow = 0.5, sway = 0, ambient = 0 } = {}) {
  const mat = new THREE.MeshLambertMaterial(params);
  // the patch differs per option set, so the shader program must not be shared
  mat.customProgramCacheKey = () => `foliage-${glow}-${sway}-${ambient}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shaderTime;
    if (sway > 0) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 swayBase = instanceMatrix[3].xz;
          #else
            vec2 swayBase = vec2(0.0);
          #endif
          float swayAmt = sin(uTime * 1.6 + swayBase.x * 0.35 + swayBase.y * 0.21) * ${sway.toFixed(3)} * uv.y;
          transformed.x += swayAmt;
          transformed.z += swayAmt * 0.6;`,
        );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      vec3 glowSunV = normalize((viewMatrix * vec4(${sunGlsl}, 0.0)).xyz);
      float glowAmt = pow(max(dot(normalize(-vViewPosition), glowSunV), 0.0), 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * (glowAmt * ${glow.toFixed(3)} + ${ambient.toFixed(3)});`,
    );
  };
  return mat;
}
