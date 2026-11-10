// 交互状态机（纯函数、无 DOM 依赖）。
// 之所以独立成无浏览器依赖的模块，是为了让 `npm run check` 能在 Node 里
// 真实断言每一次交互转换；若状态机被改坏，检查会返回非 0。

export const CHAPTERS = Object.freeze([
  { id: 'approach', name: '压境', zoom: 1.0, panX: 0.0, panY: 0.0, farBlur: 0.0, focusPlane: 1.0 },
  { id: 'cape', name: '披风', zoom: 1.28, panX: 0.085, panY: 0.0, farBlur: 0.35, focusPlane: 0.6 },
  { id: 'stand', name: '当关', zoom: 1.72, panX: -0.035, panY: 0.02, farBlur: 0.7, focusPlane: 0.15 },
]);

export const DEFAULT_STATE = Object.freeze({
  chapter: 0,
  near: false,
  focus: 'figure', // 'figure' | 'army'
  deconstruct: false,
  solo: 'all', // 'all' | 'far' | 'cape' | 'figure'
  depthView: false,
  reducedMotion: false,
  renderMode: 'poster', // 'poster' | 'webgl'
});

const CHAPTER_ACTIONS = new Set(['SET_CHAPTER', 'CHAPTER', 'chapter']);
const FOCUS_ACTIONS = new Set(['SET_FOCUS', 'FOCUS', 'focus']);
const SOLO_ACTIONS = new Set(['SET_SOLO', 'SOLO', 'solo']);

function clampChapter(n) {
  const i = Number(n);
  if (!Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(CHAPTERS.length - 1, Math.trunc(i)));
}

export function createState(overrides = {}) {
  return { ...DEFAULT_STATE, ...overrides };
}

/**
 * 唯一的状态变更入口。所有控件、键盘、滚动、URL 都走这里。
 * 返回全新对象；非法输入被收敛到合法值，绝不产生越界状态。
 */
export function reduce(state, action) {
  if (!action || typeof action !== 'object') return state;
  const type = action.type;

  if (CHAPTER_ACTIONS.has(type)) {
    const chapter = clampChapter(action.value ?? action.chapter);
    // 切章节必然退出近景，避免镜头叠加导致用户被困在放大态
    return { ...state, chapter, near: false };
  }
  if (type === 'SET_NEAR' || type === 'NEAR') {
    return { ...state, near: Boolean(action.value), ...(action.value ? {} : { deconstruct: false }) };
  }
  if (FOCUS_ACTIONS.has(type)) {
    const focus = action.value === 'army' ? 'army' : 'figure';
    return { ...state, focus };
  }
  if (type === 'TOGGLE_DECONSTRUCT' || type === 'SET_DECONSTRUCT') {
    const next = type === 'SET_DECONSTRUCT' ? Boolean(action.value) : !state.deconstruct;
    return { ...state, deconstruct: next, ...(next ? {} : { solo: 'all', depthView: false }) };
  }
  if (SOLO_ACTIONS.has(type)) {
    const allowed = ['all', 'far', 'cape', 'figure'];
    const solo = allowed.includes(action.value) ? action.value : 'all';
    return { ...state, solo, deconstruct: solo !== 'all' || state.deconstruct };
  }
  if (type === 'TOGGLE_DEPTH' || type === 'SET_DEPTH') {
    const next = type === 'SET_DEPTH' ? Boolean(action.value) : !state.depthView;
    return { ...state, depthView: next };
  }
  if (type === 'SET_REDUCED_MOTION') {
    return { ...state, reducedMotion: Boolean(action.value) };
  }
  if (type === 'SET_RENDER_MODE') {
    return { ...state, renderMode: action.value === 'webgl' ? 'webgl' : 'poster' };
  }
  if (type === 'ESC' || type === 'RESET_VIEW') {
    // ESC 返回全景：退出近景、关解构、回第一章节，焦点保留用户上次选择
    return { ...state, near: false, deconstruct: false, solo: 'all', depthView: false, chapter: 0 };
  }
  return state;
}

/**
 * 把交互状态映射为 shader 的真实 uniform 值。
 * 章节 / 焦点 / 解构 / 近景都会改变这里的数值 —— 即「改变可观测渲染状态」，
 * 而不是只改文案。check.mjs 直接断言这些数值差异。
 */
export function deriveRenderParams(state) {
  const c = CHAPTERS[clampChapter(state.chapter)];
  const zoom = c.zoom * (state.near ? 1.22 : 1);
  const panX = c.panX + (state.near ? -0.045 : 0);
  const panY = c.panY + (state.near ? 0.012 : 0);

  // 焦点：聚焦人物 → 远景柔化；聚焦远景 → 远景锐利、近景柔化
  const focusPlane = state.focus === 'army' ? 0.95 : c.focusPlane;
  const farBlur = state.focus === 'army' ? Math.max(0, c.farBlur - 0.55) : c.farBlur + 0.45;
  const nearSoft = state.focus === 'army' ? 0.55 : 0.0;

  // 三层可见性（solo）。解构模式下把非选中层压到极低但保留轮廓，便于比较
  const opacity = { far: 1, cape: 1, figure: 1 };
  let separation = 0;
  if (state.deconstruct) {
    separation = 1;
    if (state.solo !== 'all') {
      for (const k of Object.keys(opacity)) opacity[k] = k === state.solo ? 1 : 0.06;
    }
  }

  return {
    zoom,
    panX,
    panY,
    focusPlane,
    farBlur,
    nearSoft,
    layerOpacity: [opacity.far, opacity.cape, opacity.figure],
    separation,
    depthMix: state.depthView ? 1 : 0,
    motion: state.reducedMotion ? 0 : 1,
    chapterId: c.id,
  };
}

/** 供 UI 与无障碍层使用的可读文案，和内部状态同源。 */
export function describeState(state) {
  const c = CHAPTERS[clampChapter(state.chapter)];
  if (state.depthView) return '层编码视图 · 绿＝远景 / 红＝人物 / 紫＝披风（层分割编码，非物理深度）。';
  if (state.deconstruct && state.solo !== 'all') {
    const names = { far: '远景底板', cape: '披风层', figure: '人物层' };
    return `解构模式 · 单独查看${names[state.solo]}，其余层压暗保留轮廓。`;
  }
  if (state.deconstruct) return '解构模式 · 三层沿不同方向轻微分离，可见各自的覆盖边界。';
  if (state.near) {
    return state.focus === 'army'
      ? '近景 · 聚焦远景，远景恢复清晰，人物柔化。'
      : '近景 · 聚焦人物，远景云海柔化退后。';
  }
  return `${c.name} · ${state.focus === 'army' ? '聚焦远景' : '聚焦人物'}，成片模式三层正常合成。`;
}
