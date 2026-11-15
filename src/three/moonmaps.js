// The real Moon for the globe: NASA's LRO Camera colour mosaic and a relief map made from LOLA
// laser altimeter elevation. Both come from NASA's CGI Moon Kit (NASA's Scientific Visualization
// Studio, https://svs.gsfc.nasa.gov/4720/) and are built by tools/build_moon_maps.py.
// Both maps are centred on 0 degrees longitude, which is what geo.js expects.
// Written with an AI tool (Claude).
import * as THREE from 'three';
import colorUrl from './moon/moon-color.webp?url';
import reliefUrl from './moon/moon-relief.webp?url';

/**
 * @param {THREE.WebGLRenderer} renderer
 * @returns {Promise<{map: THREE.Texture, normalMap: THREE.Texture}>}
 */
export async function loadMoonMaps(renderer) {
  const loader = new THREE.TextureLoader();
  const [map, normalMap] = await Promise.all([loader.loadAsync(colorUrl), loader.loadAsync(reliefUrl)]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  return { map, normalMap };
}
