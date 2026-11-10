/**
 * 纯逻辑交互状态机（无 DOM / 无 Three.js 依赖）。
 *
 * 这一层是整个作品页的唯一真相来源：章节、近景、焦点、解构、单层 solo、
 * 深度查看都由这里派生。它同时被浏览器入口与 `npm run check` 的交互断言
 * 复用，因此「自动交互断言」检查的是真实运行逻辑，而不是字符串匹配。
 *
 * 各状态量均为可观测渲染状态的输入：
 *  - chapterIndex  → 镜头构图 / 相机推进 / 文案 / 图层视差幅度
 *  - view          → 全景 or 人物近景（相机缩放 + 焦点面）
 *  - focus         → 聚焦人物 or 聚焦远景（远景清晰度反向变化）
 *  - deconstruct   → 成片 or 图层解构（三层真实分离位移）
 *  - soloLayer     → 解构模式下单独显示某一真实图层
 *  - depthOverlay  → 显示深度分段图（诚实标注为分段深度着色图）
 */

export const CHAPTERS = Object.freeze([
  {
    id: 'approach',
    numeral: '壹',
    label: '压境',
    en: 'THE HOST',
    kicker: '01 / SCALE',
    title: '云海翻涌，\n光自天来。',
    body: '全景铺开，先看规模与空间。远景云海使用最小的视差幅度，视线自然落在断崖残台一人身上。',
    // 镜头：几乎不推进，完整构图
    camera: { zoom: 1.0, panX: 0.0, panY: 0.0 },
    parallax: 1.0,
    focusPlane: 0.34,
  },
  {
    id: 'cape',
    numeral: '贰',
    label: '披风',
    en: 'THE WIND',
    kicker: '02 / DIRECTION',
    title: '一袭银白，\n指出风向。',
    body: '中景推进，解释披风层与遮挡关系。披风独立成层，只做刚性整体平移，幅度介于人物与云海之间。',
    camera: { zoom: 1.22, panX: 0.10, panY: -0.02 },
    parallax: 1.35,
    focusPlane: 0.52,
  },
  {
    id: 'guard',
    numeral: '叁',
    label: '当关',
    en: 'THE ONE',
    kicker: '03 / FOCUS',
    title: '一人当关，\n万夫莫开。',
    body: '镜头推到人物近景，主体与焦点成为全部。远景柔化退后，动态降到最低，只留下一个瞬间。',
    camera: { zoom: 1.52, panX: 0.02, panY: -0.06 },
    parallax: 1.6,
    focusPlane: 0.78,
  },
]);

export const VIEW = Object.freeze({ PANORAMA: 'panorama', NEAR: 'near' });
export const FOCUS = Object.freeze({ FIGURE: 'figure', ARMY: 'army' });
export const MODE = Object.freeze({ COMPOSED: 'composed', DECONSTRUCT: 'deconstruct' });

/** 真实存在的三个渲染图层 id，与 public/textures 下的资产一一对应 */
export const LAYERS = Object.freeze([
  { id: 'far', label: '远景 · 破云楼阁', en: 'FAR / HOST', asset: 'xuanlan-background-clean.webp' },
  { id: 'cape', label: '中景 · 银白披风', en: 'MID / CAPE', asset: 'xuanlan-cape.webp' },
  { id: 'figure', label: '近景 · 青衣剑客', en: 'NEAR / FIGURE', asset: 'xuanlan-body.webp' },
]);

export const ACTIONS = Object.freeze({
  SET_CHAPTER: 'SET_CHAPTER',
  NEXT_CHAPTER: 'NEXT_CHAPTER',
  SET_VIEW: 'SET_VIEW',
  SET_FOCUS: 'SET_FOCUS',
  SET_MODE: 'SET_MODE',
  SET_SOLO: 'SET_SOLO',
  SET_DEPTH_OVERLAY: 'SET_DEPTH_OVERLAY',
  SET_REDUCED_MOTION: 'SET_REDUCED_MOTION',
  SET_WEBGL: 'SET_WEBGL',
  SET_POINTER: 'SET_POINTER',
  RESET: 'RESET',
});

export function createInitialState() {
  return {
    chapterIndex: 0,
    view: VIEW.PANORAMA,
    focus: FOCUS.FIGURE,
    mode: MODE.COMPOSED,
    soloLayer: null,
    depthOverlay: false,
    reducedMotion: false,
    webglAvailable: false,
    pointer: { x: 0, y: 0 },
  };
}

/** 纯函数 reducer：所有转移都返回新对象，绝不修改入参。 */
export function reduce(state, action) {
  switch (action.type) {
    case ACTIONS.SET_CHAPTER: {
      const i = Number(action.index);
      if (!Number.isInteger(i) || i < 0 || i >= CHAPTERS.length) return state;
      return { ...state, chapterIndex: i };
    }
    case ACTIONS.NEXT_CHAPTER:
      return { ...state, chapterIndex: (state.chapterIndex + 1) % CHAPTERS.length };
    case ACTIONS.SET_VIEW:
      if (action.view !== VIEW.PANORAMA && action.view !== VIEW.NEAR) return state;
      return { ...state, view: action.view };
    case ACTIONS.SET_FOCUS:
      if (action.focus !== FOCUS.FIGURE && action.focus !== FOCUS.ARMY) return state;
      return { ...state, focus: action.focus };
    case ACTIONS.SET_MODE:
      if (action.mode !== MODE.COMPOSED && action.mode !== MODE.DECONSTRUCT) return state;
      // 退出解构时清除 solo 与深度叠加，避免状态残留
      return action.mode === MODE.COMPOSED
        ? { ...state, mode: action.mode, soloLayer: null, depthOverlay: false }
        : { ...state, mode: action.mode };
    case ACTIONS.SET_SOLO: {
      const valid = action.layer === null || LAYERS.some((l) => l.id === action.layer);
      if (!valid) return state;
      return { ...state, soloLayer: action.layer };
    }
    case ACTIONS.SET_DEPTH_OVERLAY:
      return { ...state, depthOverlay: Boolean(action.value) };
    case ACTIONS.SET_REDUCED_MOTION:
      return { ...state, reducedMotion: Boolean(action.value) };
    case ACTIONS.SET_WEBGL:
      return { ...state, webglAvailable: Boolean(action.value) };
    case ACTIONS.SET_POINTER: {
      const x = clamp(Number(action.x) || 0, -1, 1);
      const y = clamp(Number(action.y) || 0, -1, 1);
      return { ...state, pointer: { x, y } };
    }
    case ACTIONS.RESET:
      return createInitialState();
    default:
      return state;
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 把状态派生为「可观测的渲染状态」。
 * 浏览器渲染层与自动断言都读取这里：章节切换、焦点切换、近景进入、
 * 解构、solo 都会改变其中的具体数值，而不是只改文案。
 */
export function deriveRenderState(state) {
  const chapter = CHAPTERS[state.chapterIndex] || CHAPTERS[0];
  const near = state.view === VIEW.NEAR;
  const focusArmy = state.focus === FOCUS.ARMY;
  const deconstruct = state.mode === MODE.DECONSTRUCT;
  const reduced = state.reducedMotion;

  // 焦点面：聚焦远景时把焦点推向远景；聚焦人物时推向近景
  const focusPlane = clamp(
    chapter.focusPlane + (focusArmy ? -0.34 : 0.16) + (near ? 0.10 : 0.0),
    0.0,
    1.0,
  );

  // 焦点必须「肉眼可辨」，否则两个按钮看起来一样。
  // 上一版把半径给到 0.0006 / 0.0032 这一量级（2048 宽纹理上仅 1~6 像素），
  // 叠加五点采样的中心权重 0.4 后几乎无视觉差异，实测同状态重复截图的
  // 动画噪声（2.20）就淹没了焦点差异（2.76）。
  //
  // 但也不能靠「压暗人物」制造差异：人物是首屏唯一主体，压暗/大半径散焦
  // 会让画面变成空景。焦点差异因此落在远景上——柔化程度、色彩饱和度、
  // 天光亮度三者一起变，人物只做几乎不动的轻微退让。
  const farBlur = focusArmy ? 0.0004 : 0.0085 + (near ? 0.0025 : 0.0);
  const nearBlur = focusArmy ? 0.0016 + (near ? 0.0008 : 0.0) : 0.0003;
  // 聚焦远景：人物几乎不动（0.97），只做极轻微的退让
  const figureDim = focusArmy ? 0.97 : 1.0;
  // 聚焦远景时远景提亮增饱和，读作「天光通透、层次清楚」
  const farBoost = focusArmy ? 1.06 : 1.0;
  const farSat = focusArmy ? 1.10 : 0.92;
  // 聚焦人物时远景带一点焦外的雾化（低对比、发灰），幅度克制以免污染首屏
  const farHaze = focusArmy ? 0.0 : 0.12;
  // 镜头呼吸：聚焦远景轻微拉远，让「后退一步看全局」可被感知
  const focusZoom = focusArmy ? 0.968 : 1.0;

  // 近景在章节镜头基础上再推进一层；聚焦远景时轻微拉远。
  // 首屏是宽扁的横幅（约 1440×420），cover 已把垂直方向裁到原图的 0.52，
  // 再乘 1.25 只剩 0.42 的可见高度 —— 全身怎么都装不下，所以近景对的是上半身（肖像）。
  // 纹理 v 轴朝上，panY 取正值才是把镜头往上抬到头部（负值会一路落到靴子上）。
  // panX 必须是负值：采样 uv = (uv-0.5)/zoom + 0.5 + pan，正值会把主体继续往左推出画外。
  const zoom = chapter.camera.zoom * (near ? 1.25 : 1.0) * focusZoom;
  const panX = chapter.camera.panX + (near ? -0.16 : 0.0);
  const panY = chapter.camera.panY + (near ? 0.30 : 0.0);

  // 视差幅度：三层各自刚性平移（不同幅度，避免非刚性形变）
  const amp = reduced ? 0 : chapter.parallax;
  const px = reduced ? 0 : state.pointer.x;
  const py = reduced ? 0 : state.pointer.y;
  const parallax = {
    far: { x: px * 0.0016 * amp, y: py * 0.0010 * amp },
    cape: { x: px * 0.0038 * amp, y: py * 0.0022 * amp },
    figure: { x: px * 0.0062 * amp, y: py * 0.0036 * amp },
  };

  // 解构分离：三层沿 x/z 真实拉开（DOM 层用 translate，WebGL 层用 uniform）
  const separation = deconstruct ? 1 : 0;
  const layerOffset = {
    far: { x: -0.055 * separation, y: -0.030 * separation, z: -0.30 * separation },
    cape: { x: 0.075 * separation, y: 0.010 * separation, z: 0.05 * separation },
    figure: { x: 0.135 * separation, y: 0.040 * separation, z: 0.40 * separation },
  };

  // solo：只显示一个真实图层；成片模式下三层全部可见
  const layerOpacity = {};
  for (const layer of LAYERS) {
    layerOpacity[layer.id] = deconstruct && state.soloLayer && state.soloLayer !== layer.id ? 0.12 : 1.0;
  }

  return {
    chapterId: chapter.id,
    chapterIndex: state.chapterIndex,
    chapter: chapter,
    zoom,
    panX,
    panY,
    focusPlane,
    farBlur,
    nearBlur,
    figureDim,
    farBoost,
    farSat,
    farHaze,
    focusZoom,
    parallax,
    separation,
    layerOffset,
    layerOpacity,
    depthOverlay: state.depthOverlay && deconstruct,
    deconstruct,
    near,
    reducedMotion: reduced,
    view: state.view,
    focus: state.focus,
    mode: state.mode,
    soloLayer: state.soloLayer,
    pointer: state.pointer,
  };
}

/** 供 UI 生成章节指示器的可序列化快照 */
export function getSnapshot(state) {
  const r = deriveRenderState(state);
  return {
    chapterIndex: state.chapterIndex,
    chapterId: r.chapterId,
    chapterLabel: r.chapter.label,
    view: state.view,
    focus: state.focus,
    mode: state.mode,
    soloLayer: state.soloLayer,
    depthOverlay: state.depthOverlay,
    reducedMotion: state.reducedMotion,
    webglAvailable: state.webglAvailable,
    zoom: Number(r.zoom.toFixed(4)),
    focusPlane: Number(r.focusPlane.toFixed(4)),
    farBlur: Number(r.farBlur.toFixed(6)),
    nearBlur: Number(r.nearBlur.toFixed(6)),
    figureDim: r.figureDim,
    farBoost: r.farBoost,
    farSat: r.farSat,
    farHaze: r.farHaze,
    separation: r.separation,
    layerOpacity: r.layerOpacity,
  };
}
