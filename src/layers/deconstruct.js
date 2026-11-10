import { LAYERS } from '../state/machine.js';

/**
 * 图层解构视图：直接把【渲染时真正使用的三张派生图层纹理】叠成一个栈。
 * 不是静态假图 —— 每一层都是 public/textures 下的同一份资产，
 * 由状态机派生的 layerOffset / layerOpacity 真实驱动位移与 solo 高亮。
 * 该视图不依赖 WebGL，因此资源失败或 WebGL 不可用时依然可用。
 */
export class DeconstructView {
  constructor(root) {
    this.root = root;
    this.layers = new Map();
    this._built = false;
    this._imgErrors = new Set();
    this._onImgError = null;
  }

  build() {
    if (this._built) return;
    const stack = this.root.querySelector('[data-layer-stack]');
    if (!stack) return;
    for (const layer of LAYERS) {
      const figure = document.createElement('figure');
      figure.className = 'd-layer';
      figure.dataset.layer = layer.id;

      const img = document.createElement('img');
      img.src = `./textures/${layer.asset}`;
      img.alt = `${layer.label}（独立图层）`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        this._imgErrors.add(layer.id);
        figure.classList.add('is-missing');
        this._onImgError?.(layer.id);
      });

      const cap = document.createElement('figcaption');
      cap.innerHTML = `<span class="d-layer-no">${layer.en}</span><strong>${layer.label}</strong>`;

      figure.append(img, cap);
      stack.appendChild(figure);
      this.layers.set(layer.id, { figure, img });
    }
    this._built = true;
  }

  get missingLayers() {
    return [...this._imgErrors];
  }

  onImageError(fn) {
    this._onImgError = fn;
  }

  /** 应用状态机派生值：真实改变每层的 transform 与透明度。 */
  apply(r, state) {
    if (!this._built) this.build();
    const separated = r.separation > 0;
    this.root.dataset.mode = separated ? 'deconstruct' : 'composed';

    for (const layer of LAYERS) {
      const entry = this.layers.get(layer.id);
      if (!entry) continue;
      const off = r.layerOffset[layer.id];
      const px = r.parallax[layer.id];
      // 位移量：解构时按层顺序拉开，成片时归回 0；视差始终有轻微贡献
      const tx = (off.x * 100) + (px.x * 300);
      const ty = (off.y * 100) + (px.y * 300);
      const scale = 1 + off.z * 0.06;
      entry.figure.style.setProperty('--tx', `${tx.toFixed(3)}%`);
      entry.figure.style.setProperty('--ty', `${ty.toFixed(3)}%`);
      entry.figure.style.setProperty('--scale', scale.toFixed(4));
      entry.figure.style.setProperty('--layer-op', String(r.layerOpacity[layer.id]));
      entry.figure.classList.toggle('is-solo', state.soloLayer === layer.id);
      entry.figure.classList.toggle('is-dim', Boolean(state.soloLayer) && state.soloLayer !== layer.id);
    }

    const depth = this.root.querySelector('[data-depth-overlay]');
    if (depth) {
      depth.hidden = !r.depthOverlay;
      this.root.classList.toggle('show-depth', r.depthOverlay);
    }
  }
}
