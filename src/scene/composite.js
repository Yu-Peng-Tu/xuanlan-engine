import * as THREE from 'three';
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders.js';
import { loadTextures, disposeTextures } from './textures.js';

const MAX_DPR = 1.75;

/**
 * WebGL 三层合成场景。渐进增强：构造/加载任一步失败都会抛出，
 * 由 main.js 切到静态首帧；页面正文与 DOM 解构图层不依赖本类。
 */
export class CompositeScene {
  constructor(canvas, { onReady, onLost, onRestored } = {}) {
    this.canvas = canvas;
    this.onReady = onReady || (() => {});
    this.onLost = onLost || (() => {});
    this.onRestored = onRestored || (() => {});

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.textures = null;
    this.uniforms = null;

    this._raf = 0;
    this._disposed = false;
    this._visible = true;
    this._contextLost = false;
    this._clock = 0;
    this._lastFrame = 0;
    this._renderState = null;
    this._resizeObserver = null;

    this._onVisibility = () => {
      this._visible = document.visibilityState === 'visible';
      if (this._visible) this._schedule();
      else this._stop();
    };
    this._onContextLost = (e) => {
      e.preventDefault();
      this._contextLost = true;
      this._stop();
      this.onLost();
    };
    this._onContextRestored = () => {
      this._contextLost = false;
      this.onRestored();
      this._schedule();
    };
  }

  async init() {
    // 显式能力探测，避免 WebGL 不可用时抛到全局
    const probe = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
    if (!probe) throw new Error('WEBGL_UNAVAILABLE');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

    this.textures = await loadTextures();
    if (this._disposed) {
      disposeTextures(this.textures);
      this.textures = null;
      return;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.uniforms = {
      uFar: { value: this.textures.far },
      uCape: { value: this.textures.cape },
      uFigure: { value: this.textures.figure },
      uDepth: { value: this.textures.depth },
      uPlate: { value: this.textures.plate },
      uAspect: { value: 16 / 9 },
      uZoom: { value: 1.0 },
      uPan: { value: new THREE.Vector2(0, 0) },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uParallax: { value: 1.0 },
      uFocusPlane: { value: 0.34 },
      uFarBlur: { value: 0.0090 },
      uNearBlur: { value: 0.0004 },
      uFigureDim: { value: 1.0 },
      uFarBoost: { value: 1.0 },
      uFarSat: { value: 0.92 },
      uFarHaze: { value: 0.12 },
      uPlateMix: { value: 0.0 },
      uTime: { value: 0 },
      uActive: { value: 1 },
      uReducedMotion: { value: 0 },
      uMobileNudge: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);

    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
    document.addEventListener('visibilitychange', this._onVisibility);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.canvas.parentElement || this.canvas);
    this._resize();
    this._visible = document.visibilityState === 'visible';
    this._schedule();
    this.onReady();
  }

  _resize() {
    if (!this.renderer || this._disposed) return;
    const parent = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    this.renderer.setSize(w, h, false);
    this.uniforms.uAspect.value = w / h;
    // 竖屏构图微调，避免主体被裁到画面外
    this.uniforms.uMobileNudge.value = w / h < 1 ? 0.045 : 0;
  }

  /** 状态机派生的可观测渲染状态，逐帧写入 uniform。 */
  apply(r) {
    this._renderState = r;
    if (!this.uniforms) return;
    this.uniforms.uZoom.value = r.zoom;
    this.uniforms.uPan.value.set(r.panX, r.panY);
    this.uniforms.uPointer.value.set(r.pointer.x, r.pointer.y);
    this.uniforms.uParallax.value = r.chapter.parallax;
    this.uniforms.uFocusPlane.value = r.focusPlane;
    this.uniforms.uFarBlur.value = r.farBlur;
    this.uniforms.uNearBlur.value = r.nearBlur;
    this.uniforms.uFigureDim.value = r.figureDim;
    this.uniforms.uFarBoost.value = r.farBoost;
    this.uniforms.uFarSat.value = r.farSat;
    this.uniforms.uFarHaze.value = r.farHaze;
    this.uniforms.uReducedMotion.value = r.reducedMotion ? 1 : 0;
    // 成片混合只用于「近景放大时盖住抠图边界」，比例必须压低：
    // 成片本身是完全清晰的，混得越多，焦点切换的散焦差异被冲得越干净
    // （上一版聚焦远景混 0.45、近景混 0.86，实测焦点差异被压到与动画噪声同量级）。
    const plateMix = r.near ? 0.55 : 0.0;
    this.uniforms.uPlateMix.value = plateMix;
    this.uniforms.uActive.value = this._visible && !r.reducedMotion ? 1 : 0;
  }

  _schedule() {
    if (this._disposed || this._contextLost || this._raf) return;
    this._lastFrame = performance.now();
    const loop = (now) => {
      this._raf = 0;
      if (this._disposed || this._contextLost || !this._visible) return;
      const dt = Math.min((now - this._lastFrame) / 1000, 0.05);
      this._lastFrame = now;
      this._clock = (this._clock + dt) % 4;
      this.uniforms.uTime.value = this._clock;
      this.renderer.render(this.scene, this.camera);
      this._schedule();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._stop();
    this._resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    this.scene?.remove(this.mesh);
    this.geometry?.dispose();
    this.material?.dispose();
    disposeTextures(this.textures);
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.mesh = null;
    this.textures = null;
    this.uniforms = null;
    this._renderState = null;
  }
}
