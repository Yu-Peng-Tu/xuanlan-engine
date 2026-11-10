import { CHAPTERS, ACTIONS, VIEW, FOCUS, MODE, deriveRenderState, getSnapshot } from '../state/machine.js';

/**
 * 交互控制层：把 DOM 事件翻译成状态机 action，再把派生渲染状态广播出去。
 * 所有控件都是真实 <button> / <a>，键盘可达，状态与 aria-* 双向同步。
 */
export class Controls {
  constructor({ root, store, onChange }) {
    this.root = root;
    this.store = store;
    this.onChange = onChange;
    this._cleanups = [];
    // 直接跳转章节后，平滑滚动途中 IntersectionObserver 会连续上报途经区块，
    // 若不设保护窗口会把用户刚点的章节覆盖掉（真实浏览器实测发现的回归）。
    this._chapterLockUntil = 0;
    this._reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }

  init() {
    this._bindReducedMotion();
    this._bindChapterNav();
    this._bindScrollChapters();
    this._bindViewActions();
    this._bindFocusActions();
    this._bindDeconstruct();
    this._bindPointer();
    this._bindKeyboard();
    this._bindLinks();
    this.emit();
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  _bindReducedMotion() {
    const apply = () => {
      this.store.dispatch({ type: ACTIONS.SET_REDUCED_MOTION, value: this._reducedQuery.matches });
      this.root.dataset.reducedMotion = this._reducedQuery.matches ? 'true' : 'false';
      this.emit();
    };
    // Safari <14 用 addListener
    if (this._reducedQuery.addEventListener) this._on(this._reducedQuery, 'change', apply);
    else this._reducedQuery.addListener(apply);
    this.store.dispatch({ type: ACTIONS.SET_REDUCED_MOTION, value: this._reducedQuery.matches });
    this.root.dataset.reducedMotion = this._reducedQuery.matches ? 'true' : 'false';
  }

  _bindChapterNav() {
    const buttons = this.root.querySelectorAll('[data-chapter-jump]');
    buttons.forEach((btn) => {
      this._on(btn, 'click', () => {
        const index = Number(btn.dataset.chapterJump);
        // 先锁住滚动联动，再设置章节；锁窗口覆盖平滑滚动全过程
        this._chapterLockUntil = Date.now() + (this._reducedQuery.matches ? 250 : 1600);
        this.store.dispatch({ type: ACTIONS.SET_CHAPTER, index });
        // 直接跳转到对应章节区块（正常滚动，不劫持）
        const section = this.root.querySelector(`[data-chapter-section="${index}"]`);
        if (section && !this._reducedQuery.matches) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (section) {
          section.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
        this.emit();
      });
    });
  }

  _bindScrollChapters() {
    const sections = this.root.querySelectorAll('[data-chapter-section]');
    if (!('IntersectionObserver' in window) || sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // 直接跳转后的平滑滚动期间忽略联动，避免覆盖用户选择
        if (Date.now() < this._chapterLockUntil) return;
        // 取可见比例最高的一节作为当前章节；不锁滚动、不改 body overflow
        let best = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
        }
        if (!best) return;
        const index = Number(best.target.dataset.chapterSection);
        if (Number.isInteger(index) && index !== this.store.getState().chapterIndex) {
          this.store.dispatch({ type: ACTIONS.SET_CHAPTER, index });
          this.emit();
        }
      },
      { threshold: [0.25, 0.5, 0.75], rootMargin: '-20% 0px -35% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    this._cleanups.push(() => observer.disconnect());
  }

  _bindViewActions() {
    this.root.querySelectorAll('[data-action="enter-near"]').forEach((el) => {
      this._on(el, 'click', () => {
        this.store.dispatch({ type: ACTIONS.SET_VIEW, view: VIEW.NEAR });
        this.emit();
      });
    });
    this.root.querySelectorAll('[data-action="back-panorama"]').forEach((el) => {
      this._on(el, 'click', () => {
        this.store.dispatch({ type: ACTIONS.SET_VIEW, view: VIEW.PANORAMA });
        this.emit();
      });
    });
    // 画布本身也可点击人物进入近景（键盘 Enter/Space 同样有效）
    const canvas = this.root.querySelector('#scene-canvas');
    if (canvas) {
      this._on(canvas, 'click', () => {
        this.store.dispatch({ type: ACTIONS.SET_VIEW, view: VIEW.NEAR });
        this.emit();
      });
      this._on(canvas, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.store.dispatch({ type: ACTIONS.SET_VIEW, view: VIEW.NEAR });
          this.emit();
        }
      });
    }
  }

  _bindFocusActions() {
    this.root.querySelectorAll('[data-focus]').forEach((btn) => {
      this._on(btn, 'click', () => {
        const focus = btn.dataset.focus === FOCUS.ARMY ? FOCUS.ARMY : FOCUS.FIGURE;
        this.store.dispatch({ type: ACTIONS.SET_FOCUS, focus });
        this.emit();
      });
    });
  }

  _bindDeconstruct() {
    this.root.querySelectorAll('[data-action="toggle-deconstruct"]').forEach((btn) => {
      this._on(btn, 'click', () => {
        const cur = this.store.getState().mode;
        const next = cur === MODE.DECONSTRUCT ? MODE.COMPOSED : MODE.DECONSTRUCT;
        this.store.dispatch({ type: ACTIONS.SET_MODE, mode: next });
        this.emit();
        // 首屏 / 章节区上的同名按钮离解构区很远，只切状态等于「点了没反应」。
        // 这里把用户带到真正发生变化的地方；解构区内的按钮原地切换，不滚动。
        if (next === MODE.DECONSTRUCT && !btn.closest('#layers')) {
          const target = this.root.querySelector('#layers');
          if (target) {
            this._chapterLockUntil = Date.now() + (this._reducedQuery.matches ? 250 : 1600);
            target.scrollIntoView({
              behavior: this._reducedQuery.matches ? 'auto' : 'smooth',
              block: 'start',
            });
          }
        }
      });
    });
    this.root.querySelectorAll('[data-solo]').forEach((btn) => {
      this._on(btn, 'click', () => {
        const cur = this.store.getState().soloLayer;
        const val = btn.dataset.solo === 'all' ? null : btn.dataset.solo;
        // 单层查看只在解构模式有可见效果，因此自动切入解构，避免「点了没反应」
        if (val !== null && this.store.getState().mode !== MODE.DECONSTRUCT) {
          this.store.dispatch({ type: ACTIONS.SET_MODE, mode: MODE.DECONSTRUCT });
        }
        this.store.dispatch({ type: ACTIONS.SET_SOLO, layer: cur === val ? null : val });
        this.emit();
      });
    });
    this.root.querySelectorAll('[data-action="toggle-depth"]').forEach((btn) => {
      this._on(btn, 'click', () => {
        const cur = this.store.getState().depthOverlay;
        // 深度分段图同样只在解构模式可见
        if (!cur && this.store.getState().mode !== MODE.DECONSTRUCT) {
          this.store.dispatch({ type: ACTIONS.SET_MODE, mode: MODE.DECONSTRUCT });
        }
        this.store.dispatch({ type: ACTIONS.SET_DEPTH_OVERLAY, value: !cur });
        this.emit();
      });
    });
  }

  _bindPointer() {
    const stage = this.root.querySelector('[data-stage]');
    if (!stage) return;
    const onMove = (e) => {
      const rect = stage.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      this.store.dispatch({ type: ACTIONS.SET_POINTER, x, y });
      this.emit({ silent: true });
    };
    const onLeave = () => {
      this.store.dispatch({ type: ACTIONS.SET_POINTER, x: 0, y: 0 });
      this.emit({ silent: true });
    };
    // 指针反馈平滑；触屏没有 hover 也能通过按钮完成全部功能
    this._on(stage, 'pointermove', onMove);
    this._on(stage, 'pointerleave', onLeave);
  }

  _bindKeyboard() {
    this._on(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        const s = this.store.getState();
        if (s.view === VIEW.NEAR || s.mode === MODE.DECONSTRUCT || s.soloLayer) {
          this.store.dispatch({ type: ACTIONS.SET_VIEW, view: VIEW.PANORAMA });
          this.store.dispatch({ type: ACTIONS.SET_MODE, mode: MODE.COMPOSED });
          this.emit();
          e.preventDefault();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        // 仅在焦点不在输入控件时推进章节
        if (document.activeElement?.tagName === 'INPUT') return;
        this.store.dispatch({ type: ACTIONS.NEXT_CHAPTER });
        this.emit();
      }
    });
  }

  _bindLinks() {
    // 顶部导航 / 页脚返回顶部：原生锚点，保证无 JS 时也有效
    this.root.querySelectorAll('a[href^="#"]').forEach((a) => {
      this._on(a, 'click', () => {
        const id = a.getAttribute('href').slice(1);
        if (id === 'top') {
          this.store.dispatch({ type: ACTIONS.RESET });
          this.emit();
        }
      });
    });
  }

  /** 把状态同步到所有 aria / 文案 / 视图 class，并广播派生渲染状态。 */
  emit(opts = {}) {
    const state = this.store.getState();
    const r = deriveRenderState(state);
    const snap = getSnapshot(state);

    this.root.dataset.chapter = r.chapterId;
    this.root.dataset.view = state.view;
    this.root.dataset.mode = state.mode;
    this.root.dataset.focus = state.focus;

    // 章节指示器
    this.root.querySelectorAll('[data-chapter-jump]').forEach((btn) => {
      const active = Number(btn.dataset.chapterJump) === state.chapterIndex;
      btn.setAttribute('aria-current', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
    this.root.querySelectorAll('[data-chapter-panel]').forEach((panel) => {
      const active = Number(panel.dataset.chapterPanel) === state.chapterIndex;
      panel.classList.toggle('is-active', active);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });

    // 焦点按钮
    this.root.querySelectorAll('[data-focus]').forEach((btn) => {
      const active = btn.dataset.focus === state.focus;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
    });
    // 解构 / solo / 深度
    this.root.querySelectorAll('[data-action="toggle-deconstruct"]').forEach((btn) => {
      const active = state.mode === MODE.DECONSTRUCT;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
      const label = btn.querySelector('[data-mode-label]');
      if (label) label.textContent = active ? '返回成片' : '图层解构';
    });
    this.root.querySelectorAll('[data-solo]').forEach((btn) => {
      const val = btn.dataset.solo === 'all' ? null : btn.dataset.solo;
      const active = state.soloLayer === val && state.mode === MODE.DECONSTRUCT;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
    });
    this.root.querySelectorAll('[data-action="toggle-depth"]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(state.depthOverlay));
      btn.classList.toggle('is-active', state.depthOverlay);
    });

    // 近景面板可见性（hidden 属性，读屏与键盘都不会进入隐藏控件）
    const nearPanel = this.root.querySelector('[data-near-panel]');
    if (nearPanel) nearPanel.hidden = state.view !== VIEW.NEAR;
    const deconstructPanel = this.root.querySelector('[data-deconstruct-panel]');
    if (deconstructPanel) deconstructPanel.hidden = state.mode !== MODE.DECONSTRUCT;

    // 章节文案（aria-live，切换时可被读屏播报）
    const live = this.root.querySelector('[data-chapter-live]');
    if (live && !opts.silent) {
      const c = CHAPTERS[state.chapterIndex];
      live.textContent = `当前章节 ${c.numeral} · ${c.label}：${c.title.replace(/\n/g, '')}`;
    }

    this.onChange(state, r, snap, opts);
  }

  dispose() {
    this._cleanups.forEach((fn) => fn());
    this._cleanups = [];
  }
}
