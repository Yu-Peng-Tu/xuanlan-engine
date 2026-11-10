import * as THREE from 'three';

/** 与 public/textures 下的派生资产一一对应，顺序即渲染层次（远 → 近）。 */
export const TEXTURE_FILES = Object.freeze({
  far: 'textures/xuanlan-background-clean.webp',
  cape: 'textures/xuanlan-cape.webp',
  figure: 'textures/xuanlan-body.webp',
  depth: 'textures/xuanlan-background-depth.png',
  plate: 'textures/xuanlan-cinematic-clean.jpg',
});

export const POSTER_FILE = 'textures/xuanlan-cinematic-clean.jpg';

/**
 * 加载全部纹理。任一失败即 reject，由调用方切换到静态降级。
 * 不做「静默用占位图顶替」，因为那会让 check 通过但画面是假的。
 */
export async function loadTextures(base = './') {
  const loader = new THREE.TextureLoader();
  const entries = Object.entries(TEXTURE_FILES);
  const loaded = await Promise.all(
    entries.map(async ([key, rel]) => {
      // 显式探针：先确认文件可达，避免 TextureLoader 把 404 当成解析失败以外的情况
      const url = new URL(rel, new URL(base, window.location.href)).href;
      const texture = await loader.loadAsync(url);
      // 统一色彩空间约定：原样直通，不做隐式 gamma 变换
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.name = key;
      return [key, texture];
    }),
  );
  return Object.fromEntries(loaded);
}

export function disposeTextures(textures) {
  if (!textures) return;
  for (const t of Object.values(textures)) {
    if (t && typeof t.dispose === 'function') t.dispose();
  }
}
