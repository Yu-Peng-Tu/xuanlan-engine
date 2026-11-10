// 资产清单：路径、来源、实际哈希、用途、许可状态。
// 五张资产由同一张 2048×1152 的原创生成成片程序化派生：远景底板的人物区域先用生成模型重绘一张同构图、
// 无人物的背景，再按人物蒙版替换进底板；披风 / 人物两层由互补轮廓蒙版从成片切出（RGB 与成片逐像素同源）；
// 深度分段图由两层 alpha 编码。
// 主视觉由本项目用图像生成工具产生，未使用第三方作品素材；生成平台对输出物的商用条款仍待确认，
// 因此仅用于个人技术演示，不作可商用或已获授权的表述。派生步骤见 evidence/VALIDATION.md。

export const TEXTURE_ASSETS = [
  {
    key: 'background',
    filename: 'xuanlan-background-clean.webp',
    url: 'textures/xuanlan-background-clean.webp',
    width: 2048,
    height: 1152,
    bytes: 424142,
    sha256: 'bcdbbd56829e473096bddc5d43eb710d047b70577a06f20b8203f14c8a2e2296',
    hasAlpha: false,
    role: '远景底板：破云天光、翻涌云海、悬浮东方楼阁与群山；人物所在区域由生成模型按同一构图重绘为连续云海后替换',
    source: '本包派生 · 源成片 xuanlan-cinematic-clean.jpg',
    license: '个人技术演示；平台商用条款待确认',
  },
  {
    key: 'cape',
    filename: 'xuanlan-cape.webp',
    url: 'textures/xuanlan-cape.webp',
    width: 2048,
    height: 1152,
    bytes: 100498,
    sha256: '6749034d03181c8df36af73be83adc2e1769000014737ba9d2d2e1581911d788',
    hasAlpha: true,
    role: '中景层：向右展开的银白半透明披风与飘带褶皱，透明通道勾出轮廓',
    source: '本包派生 · 源成片 xuanlan-cinematic-clean.jpg',
    license: '个人技术演示；平台商用条款待确认',
  },
  {
    key: 'body',
    filename: 'xuanlan-body.webp',
    url: 'textures/xuanlan-body.webp',
    width: 2048,
    height: 1152,
    bytes: 158002,
    sha256: '06401ba5d2cc9ac2d2c6ece0034ef25bead1b39d805b15220ebec957a24b5ca3',
    hasAlpha: true,
    role: '近景层：青衣剑客侧身、战甲、长发与斜持长剑',
    source: '本包派生 · 源成片 xuanlan-cinematic-clean.jpg',
    license: '个人技术演示；平台商用条款待确认',
  },
  {
    key: 'depth',
    filename: 'xuanlan-background-depth.png',
    url: 'textures/xuanlan-background-depth.png',
    width: 2048,
    height: 1152,
    bytes: 140436,
    sha256: 'c75da8c516cf37ebec50e697671ca61e980d3207c0a22aa128b358b0f913e96f',
    hasAlpha: false,
    role: '层分割编码图（绿=远景 / 红=人物 / 紫=披风）；R=粗略分层，B=披风自由度，非物理深度',
    source: '本包派生 · 源成片 xuanlan-cinematic-clean.jpg',
    license: '个人技术演示；平台商用条款待确认',
  },
  {
    key: 'poster',
    filename: 'xuanlan-cinematic-clean.jpg',
    url: 'textures/xuanlan-cinematic-clean.jpg',
    width: 2048,
    height: 1152,
    bytes: 894531,
    sha256: 'dba852fae80b57693866935ef3b2f4c02b43f1a1894328310d94d3c6390be095',
    hasAlpha: false,
    role: '生成成片：静态首帧 / WebGL 失败的降级画面，同时作为 uPlate 近景保真输入',
    source: '本包派生 · 源成片 xuanlan-cinematic-clean.jpg',
    license: '个人技术演示；平台商用条款待确认',
  },
];

export const RENDER_ASSETS = TEXTURE_ASSETS.filter((a) => a.key !== 'poster');

// 原图宽高比，shader 用它做 cover 映射
export const IMAGE_ASPECT = 2048 / 1152;

export function assetUrl(asset) {
  // 相对 document.baseURI，兼容任意静态托管子路径；不绑定域名与本机路径
  return new URL(asset.url, document.baseURI).href;
}
