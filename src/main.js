import './styles/base.css';
import './styles/layout.css';
import './styles/scene.css';

import { createInitialState, reduce, ACTIONS, deriveRenderState } from './state/machine.js';

import { CompositeScene } from './scene/composite.js';
import { DeconstructView } from './layers/deconstruct.js';
import { Controls } from './ui/controls.js';

/** 极简 store：单一状态源，纯 reducer，订阅式广播。 */
function createStore() {
  let state = createInitialState();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next !== state) state = next;
      return state;
    },
  };
}

function boot() {
  const root = document.documentElement;
  const app = document.getElementById('app');
  const stage = app.querySelector('[data-stage]');
  const canvas = app.querySelector('#scene-canvas');
  const status = app.querySelector('[data-render-status]');
  const store = createStore();

  const deconstruct = new DeconstructView(app);
  deconstruct.build();
  deconstruct.onImageError((id) => {
    setFallback(`图层 ${id} 未能载入，已保留静态成片与正文`);
  });

  let scene = null;
  let controls = null;
  let fallbackReason = null;

  function setFallback(reason) {
    fallbackReason = reason;
    stage.classList.remove('is-webgl-ready');
    stage.classList.add('is-fallback');
    canvas.setAttribute('aria-hidden', 'true');
    if (status) {
      status.hidden = false;
      status.textContent = `静态成片模式 · ${reason}。作品正文、章节与图层解构仍可使用。`;
    }
    root.dataset.webgl = 'unavailable';
    // 状态机与 DOM 保持一致，避免「界面显示降级但内部状态仍称 WebGL 可用」
    store.dispatch({ type: ACTIONS.SET_WEBGL, value: false });
    controls?.emit();
  }

  /** 把派生渲染状态同步到 CSS 变量，保证无 WebGL 时章节/解构仍改变可观测构图。 */
  function syncCssVars(r, state) {
    // 挂在 #app 上，首屏海报与章节区背景共用同一组镜头变量
    app.style.setProperty('--camera-zoom', r.zoom.toFixed(4));
    app.style.setProperty('--camera-x', `${(r.panX * 100).toFixed(2)}%`);
    app.style.setProperty('--camera-y', `${(r.panY * 100).toFixed(2)}%`);
    app.style.setProperty('--far-op', String(r.layerOpacity.far));
    app.style.setProperty('--cape-op', String(r.layerOpacity.cape));
    app.style.setProperty('--figure-op', String(r.layerOpacity.figure));
    app.style.setProperty('--chapter-index', String(state.chapterIndex));
  }

  controls = new Controls({
    root: app,
    store,
    onChange(state, r, snap, opts) {
      syncCssVars(r, state);
      deconstruct.apply(r, state);
      scene?.apply(r);
      // 供自动检查读取的只读快照（有明确文档说明，生产环境同样只读、无副作用）
      if (!opts.silent) app.dataset.stateSnapshot = JSON.stringify(snap);
    },
  });
  controls.init();

  // WebGL 为渐进增强：失败不影响正文与静态成片
  scene = new CompositeScene(canvas, {
    onReady() {
      stage.classList.add('is-webgl-ready');
      stage.classList.remove('is-fallback');
      root.dataset.webgl = 'available';
      if (status) status.hidden = true;
      store.dispatch({ type: ACTIONS.SET_WEBGL, value: true });
      controls.emit();
    },
    onLost() {
      setFallback('WebGL 上下文已丢失');
    },
    onRestored() {
      fallbackReason = null;
      stage.classList.add('is-webgl-ready');
      stage.classList.remove('is-fallback');
      root.dataset.webgl = 'available';
      if (status) status.hidden = true;
      store.dispatch({ type: ACTIONS.SET_WEBGL, value: true });
      controls.emit();
    },
  });

  scene.init().catch((err) => {
    setFallback(err?.message || 'WebGL 不可用');
    scene.dispose();
    scene = null;
  });

  // 页面卸载时释放全部资源，避免监听器与 RAF 残留
  window.addEventListener('pagehide', () => {
    controls.dispose();
    scene?.dispose();
    scene = null;
  }, { once: true });

  // 开发模式下提供一个【有文档说明】的只读调试句柄，便于本地排查。
  // 生产构建（import.meta.env.PROD）不挂载任何全局调试变量。
  if (import.meta.env.DEV) {
    window.__YIREN_DANGGUAN_DEBUG__ = Object.freeze({
      getSnapshot: () => JSON.parse(app.dataset.stateSnapshot || '{}'),
      getFallbackReason: () => fallbackReason,
      version: '1.0.0',
      note: '只读调试句柄，仅开发模式存在；见 README「调试接口」一节。',
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
