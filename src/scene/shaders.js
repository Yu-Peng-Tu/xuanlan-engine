/**
 * 三层刚性合成 Shader —— 本版为重新实现的可读源码，不是线上 minified bundle。
 *
 * 设计要点（与旧仓库单图 + 连续深度的实现不同）：
 *  1. 远景 / 中景披风 / 近景人物是三张【独立】纹理，各自做整体平移。
 *     轮廓不会被逐像素深度拉伸（RIGID SUBJECT）。
 *  2. 深度分段图是伪彩色分段编码：R 通道 = 粗略深度分层，B 通道 = 披风自由度。
 *     它【不】用于逐像素 UV 位移，只用于把披风根部锚定在人物上、外缘自由飘动。
 *     这样既利用了现成图层，又不会引入非刚性形变。
 *  3. uPlate 是完整成片。近景放大时按 uPlateMix 混入，保证不露出抠图接缝；
 *     焦点切换不靠混入成片来实现（成片是全清晰的，混得越多焦点差异越看不出来）。
 *     解构模式不使用本 shader，改用 DOM 真实图层。
 *  4. 色彩空间约定：所有纹理以 NoColorSpace 上传，renderer 输出设为
 *     LinearSRGBColorSpace，即原样直通，不做隐式 gamma 变换。采样与合成
 *     全程在同一编码空间，避免「一处 sRGB 一处 linear」的不一致。
 */

export const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uFar;      // 干净背景底板（不透明，含原作者修补痕迹）
  uniform sampler2D uCape;     // 披风 RGBA
  uniform sampler2D uFigure;   // 人物 RGBA
  uniform sampler2D uDepth;    // 深度分段着色图（R=depth, B=capeFreedom）
  uniform sampler2D uPlate;    // 完整成片（近景保真）

  uniform float uAspect;       // 视口宽高比
  uniform float uZoom;         // 镜头推进
  uniform vec2  uPan;          // 镜头平移
  uniform vec2  uPointer;      // -1..1 指针
  uniform float uParallax;     // 章节视差倍率
  uniform float uFocusPlane;   // 0..1 焦点面
  uniform float uFarBlur;      // 远景散焦半径
  uniform float uNearBlur;     // 近景（人物 + 披风）散焦半径
  uniform float uFigureDim;    // 人物层亮度（聚焦远景时后退压暗）
  uniform float uFarBoost;     // 远景亮度（聚焦远景时天光更通透）
  uniform float uFarSat;       // 远景饱和度（焦外去饱和 / 合焦增饱和）
  uniform float uFarHaze;      // 远景焦外雾化（低对比、发灰）
  uniform float uPlateMix;     // 成片混合权重
  uniform float uTime;
  uniform float uActive;       // 页面可见 && 未开启减少动态
  uniform float uReducedMotion;
  uniform float uMobileNudge;  // 竖屏构图微调

  const float IMAGE_ASPECT = 1.7777778; // 2048 / 1152

  vec2 safeUv(vec2 uv) { return clamp(uv, vec2(0.001), vec2(0.999)); }

  // 九点柔化（中心 + 轴向 4 + 对角 4），RGB 加权但 alpha 取最强采样，
  // 避免细结构（巨剑、手臂边缘）被 alpha 模糊侵蚀后露出背景。
  vec4 readLayer(sampler2D layer, vec2 uv, float radius) {
    vec2 c = safeUv(uv);
    vec2 d = vec2(radius * 0.72, radius * 0.72);
    vec4 p0 = texture2D(layer, c);
    vec4 p1 = texture2D(layer, safeUv(c + vec2(radius, 0.0)));
    vec4 p2 = texture2D(layer, safeUv(c - vec2(radius, 0.0)));
    vec4 p3 = texture2D(layer, safeUv(c + vec2(0.0, radius)));
    vec4 p4 = texture2D(layer, safeUv(c - vec2(0.0, radius)));
    vec4 p5 = texture2D(layer, safeUv(c + d));
    vec4 p6 = texture2D(layer, safeUv(c + vec2(d.x, -d.y)));
    vec4 p7 = texture2D(layer, safeUv(c + vec2(-d.x, d.y)));
    vec4 p8 = texture2D(layer, safeUv(c - d));
    vec3 rgb = p0.rgb * 0.22 + (p1.rgb + p2.rgb + p3.rgb + p4.rgb) * 0.11
             + (p5.rgb + p6.rgb + p7.rgb + p8.rgb) * 0.085;
    // alpha 不能只取最大值：模糊半径一大，轮廓会整块外扩，人物变成一团吞掉画面的灰雾。
    // 取「中心 alpha 与九点均值」的加权，虚化时边缘自然半透，轮廓仍在。
    float aMax = max(p0.a, max(max(p1.a, p2.a), max(max(p3.a, p4.a),
                 max(max(p5.a, p6.a), max(p7.a, p8.a)))));
    float aAvg = (p0.a + p1.a + p2.a + p3.a + p4.a + p5.a + p6.a + p7.a + p8.a) * 0.111111;
    float a = mix(aAvg, aMax, 0.55);
    return vec4(rgb, a);
  }

  // 十三点近似高斯：内环 / 中环 / 外环三层半径，环间距小于半径本身。
  // 上一版只有五点、中心权重 0.40，半径一大就出现离散重影、半径小时又等于没变，
  // 这是「聚焦人物 / 聚焦远景看不出区别」的直接原因。
  vec3 readSoft(sampler2D tex, vec2 uv, float radius) {
    vec2 c = safeUv(uv);
    vec2 ix = vec2(radius * 0.55, 0.0);
    vec2 iy = vec2(0.0, radius * 0.55);
    vec2 md = vec2(radius * 0.72, radius * 0.72);
    vec2 ox = vec2(radius, 0.0);
    vec2 oy = vec2(0.0, radius);
    vec3 rgb = texture2D(tex, c).rgb * 0.18;
    rgb += (texture2D(tex, safeUv(c + ix)).rgb + texture2D(tex, safeUv(c - ix)).rgb
          + texture2D(tex, safeUv(c + iy)).rgb + texture2D(tex, safeUv(c - iy)).rgb) * 0.09;
    rgb += (texture2D(tex, safeUv(c + md)).rgb + texture2D(tex, safeUv(c + vec2(md.x, -md.y))).rgb
          + texture2D(tex, safeUv(c + vec2(-md.x, md.y))).rgb + texture2D(tex, safeUv(c - md)).rgb) * 0.07;
    rgb += (texture2D(tex, safeUv(c + ox)).rgb + texture2D(tex, safeUv(c - ox)).rgb
          + texture2D(tex, safeUv(c + oy)).rgb + texture2D(tex, safeUv(c - oy)).rgb) * 0.045;
    return rgb;
  }

  void main() {
    // cover：按 16:9 原图比例裁切，长边优先
    vec2 uv = vUv;
    if (uAspect > IMAGE_ASPECT) {
      uv.y = (uv.y - 0.5) * (IMAGE_ASPECT / uAspect) + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * (uAspect / IMAGE_ASPECT) + 0.5;
      uv.x += uMobileNudge;
    }
    // 镜头：缩放 + 平移（章节状态驱动，真实改变构图）
    uv = (uv - 0.5) / max(uZoom, 0.001) + 0.5 + uPan;

    // 四秒一循环的克制呼吸感；减少动态或页面隐藏时完全静止
    float breath = (1.0 - uReducedMotion) * uActive;
    float phase = uTime * 1.5707963;
    vec2 drift = vec2(sin(phase), cos(phase) - 1.0) * breath;

    vec2 pointer = uPointer * uParallax;
    vec2 bodyMotion  = pointer * 0.0030 + drift * 0.00024;
    vec2 capeMotion  = pointer * 0.0014 + drift * 0.00014;

    // 深度分段图的 B 通道决定披风每个区域跟随人物还是自由飘动。
    // 这是分段权重，不是逐像素深度位移：轮廓保持刚性。
    vec3 field = texture2D(uDepth, safeUv(uv)).rgb;
    float capeFreedom = field.b;
    vec2 anchoredCape = mix(bodyMotion, capeMotion, capeFreedom);

    // R 通道只用于微调远景幅度（常量式分层，不做连续形变）
    float depthBand = floor(field.r * 3.0) / 3.0;
    vec2 farMotion = pointer * (-0.0004 + 0.0005 * depthBand) + drift * 0.00020;

    // 焦点：远景散焦半径与近景散焦半径互斥变化，人物亮度随焦点后退。
    // 披风面积大且本身就是飘动的软材质，不做大半径散焦（否则糊成一片灰雾盖住画面），
    // 只跟随人物做轻度压暗，避免「人暗、披风亮」的割裂感。
    //
    // 远景一侧同时给出三个真实可辨的焦外特征：模糊、去饱和、发灰（低对比）。
    // 只靠模糊是不够的——云海本身是低频大色块，小半径模糊肉眼几乎看不出。
    vec3 farC = readSoft(uFar, uv + farMotion, uFarBlur);
    float farLum = dot(farC, vec3(0.299, 0.587, 0.114));
    farC = mix(vec3(farLum), farC, uFarSat) * uFarBoost;
    farC = mix(farC, vec3(farLum * 1.12), clamp(uFarHaze, 0.0, 1.0));
    vec3 color = farC;
    vec4 cape = readLayer(uCape, uv + anchoredCape, 0.0006);
    vec4 body = readLayer(uFigure, uv + bodyMotion, uNearBlur);
    color = mix(color, cape.rgb * mix(1.0, uFigureDim, 0.45), cape.a);
    color = mix(color, body.rgb * uFigureDim, body.a);

    // 近景 / 聚焦远景时混入完整成片，避免放大后露出抠图边界
    vec3 plate = readSoft(uPlate, uv + pointer * 0.0010, 0.00012);
    color = mix(color, plate, clamp(uPlateMix, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;
