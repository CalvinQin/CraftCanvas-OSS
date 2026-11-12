// 客户端图像工具：白底抠图（透明主体）与分层 PSD 导出
// 白底产品图专用：从边缘泛洪标记近白色连通区域为背景，产品内部的白色高光不受影响

import type { Annotation } from '../components/CanvasBoard';

const WHITE_TOLERANCE = 22; // 与纯白的最大通道差

// 标注坐标已归一化到图片区域 [0,1]（由 CanvasBoard 换算）。烧图时乘以原生像素。
const ANN_RED = '#EF4444';

/**
 * 把画布标注（形状/画笔/文字/引线）烧进源图，供 AI 作为"改哪里/怎么改"的视觉指引
 * （Set-of-Mark 式）。annotations 坐标为图片区域内归一化 [0,1]。返回 PNG dataURL。
 * 描边宽度按图片尺寸缩放，保证在原生分辨率下清晰可见但不过粗。
 */
export async function burnAnnotationsOntoImage(dataUrl: string, annotations: Annotation[]): Promise<string> {
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const diag = Math.hypot(W, H);
  const lw = Math.max(2, Math.round(diag / 400)); // 描边宽度
  const fontPx = Math.max(14, Math.round(H * 0.035)); // 标注文字字号
  ctx.strokeStyle = ANN_RED;
  ctx.fillStyle = ANN_RED;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const X = (nx: number) => nx * W;
  const Y = (ny: number) => ny * H;

  for (const a of annotations) {
    if (a.kind === 'draw') {
      ctx.beginPath();
      a.points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
      ctx.stroke();
    } else if (a.kind === 'rect') {
      ctx.strokeRect(X(Math.min(a.x, a.x + a.w)), Y(Math.min(a.y, a.y + a.h)), Math.abs(a.w) * W, Math.abs(a.h) * H);
    } else if (a.kind === 'ellipse') {
      const cx = X(a.x + a.w / 2), cy = Y(a.y + a.h / 2);
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(a.w) * W / 2, Math.abs(a.h) * H / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (a.kind === 'polygon' || a.kind === 'star') {
      const rx = Math.min(a.x, a.x + a.w) * W, ry = Math.min(a.y, a.y + a.h) * H;
      const rw = Math.abs(a.w) * W, rh = Math.abs(a.h) * H;
      const pts = a.kind === 'star' ? starPointsPx(rx, ry, rw, rh) : trianglePointsPx(rx, ry, rw, rh);
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.stroke();
    } else if (a.kind === 'line' || a.kind === 'arrow') {
      const x1 = X(a.x), y1 = Y(a.y), x2 = X(a.x + a.w), y2 = Y(a.y + a.h);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (a.kind === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const ah = Math.max(lw * 4, Math.hypot(x2 - x1, y2 - y1) * 0.18);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - ah * Math.cos(ang - 0.5), y2 - ah * Math.sin(ang - 0.5));
        ctx.lineTo(x2 - ah * Math.cos(ang + 0.5), y2 - ah * Math.sin(ang + 0.5));
        ctx.closePath(); ctx.fill();
      }
    } else if (a.kind === 'label') {
      const tx = X(a.tx), ty = Y(a.ty), px = X(a.x), py = Y(a.y);
      ctx.save();
      ctx.setLineDash([lw * 3, lw * 2]);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, py); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(px, py, lw * 2, 0, Math.PI * 2); ctx.fill();
      ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(a.text, tx, ty - lw);
    } else if (a.kind === 'text') {
      ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(a.text, X(a.x), Y(a.y));
    }
  }
  return c.toDataURL('image/png');
}

// 像素坐标下的三角/五角星顶点（与 CanvasBoard 的 polygonPoints/starPoints 一致的形状）
function trianglePointsPx(x: number, y: number, w: number, h: number): [number, number][] {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, pts: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    pts.push([cx + Math.cos(ang) * rx, cy + Math.sin(ang) * ry]);
  }
  return pts;
}
function starPointsPx(x: number, y: number, w: number, h: number): [number, number][] {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.42;
    pts.push([cx + Math.cos(ang) * rx * r, cy + Math.sin(ang) * ry * r]);
  }
  return pts;
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图像解码失败'));
    img.src = dataUrl;
  });
}

const drawToCanvas = (img: HTMLImageElement): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
};

/**
 * 边缘泛洪白底抠图。返回主体透明图层画布；若背景占比异常（<2% 或 >98%）视为非白底图，返回 null。
 */
export async function whiteKeyCutout(dataUrl: string): Promise<HTMLCanvasElement | null> {
  const img = await loadImage(dataUrl);
  const canvas = drawToCanvas(img);
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  const isWhite = (i: number) =>
    255 - d[i] <= WHITE_TOLERANCE && 255 - d[i + 1] <= WHITE_TOLERANCE && 255 - d[i + 2] <= WHITE_TOLERANCE;

  // BFS：从四边所有近白像素开始泛洪
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (!visited[p] && isWhite(p * 4)) {
      visited[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  while (head < tail) {
    const p = queue[head++];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  const bgRatio = tail / (w * h);
  if (bgRatio < 0.02 || bgRatio > 0.98) return null;

  // 背景像素透明化 + 边缘 1px 软化
  for (let p = 0; p < w * h; p++) {
    if (visited[p]) d[p * 4 + 3] = 0;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!visited[p] && (visited[p - 1] || visited[p + 1] || visited[p - w] || visited[p + w])) {
        d[p * 4 + 3] = Math.min(d[p * 4 + 3], 160);
      }
    }
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.putImageData(imageData, 0, 0);
  return out;
}

/** 抠图 → 透明 PNG dataURL（非白底图返回 null） */
export async function cutoutToTransparentPng(dataUrl: string): Promise<string | null> {
  const cutout = await whiteKeyCutout(dataUrl);
  return cutout ? cutout.toDataURL('image/png') : null;
}

/**
 * 快速分层 PSD（无 AI）：背景图层（原图）+ 产品主体图层（白键透明抠图，若为白底图）。
 */
export async function exportLayeredPsd(dataUrl: string): Promise<{ blob: Blob; hasSubject: boolean }> {
  const { writePsd } = await import('ag-psd');
  const img = await loadImage(dataUrl);
  const base = drawToCanvas(img);
  const cutout = await whiteKeyCutout(dataUrl);

  const children: any[] = [
    { name: '背景 Background', canvas: base },
  ];
  if (cutout) {
    children.push({ name: '产品主体 Subject', canvas: cutout });
  }

  const buffer = writePsd(
    { width: base.width, height: base.height, children },
    { generateThumbnail: true },
  );
  return {
    blob: new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }),
    hasSubject: Boolean(cutout),
  };
}

export interface PsdLayerInput {
  name: string;
  dataUrl: string;
  /** true 时对该层做白键抠透明（主体/文字层用） */
  keyOutWhite?: boolean;
  hidden?: boolean;
}

/** 判断画布是否几乎全透明（文字层为空时跳过该层） */
const isMostlyTransparent = (canvas: HTMLCanvasElement): boolean => {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  let opaque = 0;
  const total = w * h;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 24) opaque++;
  }
  return opaque / total < 0.002;
};

/**
 * Lovart 式多图层 PSD 组装：按传入顺序自下而上组装图层（背景→主体→文字…），
 * keyOutWhite 层会先做白键透明抠图；抠完近乎全透明的层自动丢弃。
 * 所有图层统一缩放到第一层（底层）的尺寸。
 */
export async function assembleMultiLayerPsd(layers: PsdLayerInput[]): Promise<{ blob: Blob; layerNames: string[] }> {
  if (layers.length === 0) throw new Error('没有可组装的图层');
  const { writePsd } = await import('ag-psd');
  const baseImg = await loadImage(layers[0].dataUrl);
  const W = baseImg.naturalWidth;
  const H = baseImg.naturalHeight;

  const children: any[] = [];
  const layerNames: string[] = [];

  for (const layer of layers) {
    let canvas: HTMLCanvasElement;
    if (layer.keyOutWhite) {
      const keyed = await whiteKeyCutout(layer.dataUrl);
      if (!keyed) continue; // 非白底无法抠，丢弃该层
      canvas = keyed;
    } else {
      canvas = drawToCanvas(await loadImage(layer.dataUrl));
    }
    // 统一到底层尺寸
    if (canvas.width !== W || canvas.height !== H) {
      const scaled = document.createElement('canvas');
      scaled.width = W;
      scaled.height = H;
      scaled.getContext('2d')!.drawImage(canvas, 0, 0, W, H);
      canvas = scaled;
    }
    if (layer.keyOutWhite && isMostlyTransparent(canvas)) continue;
    children.push({ name: layer.name, canvas, hidden: layer.hidden });
    layerNames.push(layer.name);
  }

  if (children.length === 0) throw new Error('所有图层均为空');
  const buffer = writePsd({ width: W, height: H, children }, { generateThumbnail: true });
  return {
    blob: new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }),
    layerNames,
  };
}

/**
 * SVG 矢量导出：imagetracerjs 真实矢量描摹（颜色量化 + 路径追踪）。
 * 平面设计/白底商品图效果最佳；照片会呈海报化（矢量化固有特性）。
 */
export async function exportSvgVector(dataUrl: string): Promise<Blob> {
  const { default: ImageTracer } = await import('imagetracerjs');
  const img = await loadImage(dataUrl);
  const MAX = 1024; // 描摹分辨率上限，兼顾精度与耗时
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const svgString: string = ImageTracer.imagedataToSVG(imageData, {
    numberofcolors: 16,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    roundcoords: 1,
    strokewidth: 0,
    blurradius: 0,
    viewbox: true,
  });
  return new Blob([svgString], { type: 'image/svg+xml' });
}

/** dataURL 转 JPG（白底铺底，质量 0.92） */
export async function dataUrlToJpg(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}

/** 图片几何变换（顺时针旋转 90° / 水平翻转 / 垂直翻转），PNG 输出保透明 */
export async function transformImageDataUrl(dataUrl: string, op: 'rot90' | 'flipH' | 'flipV'): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = op === 'rot90' ? h : w;
  c.height = op === 'rot90' ? w : h;
  const ctx = c.getContext('2d')!;
  if (op === 'rot90') {
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
  } else if (op === 'flipH') {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

/** 单图导出 PDF（页面尺寸 = 图片比例，A 系无裁切） */
export async function exportPdf(dataUrl: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf'); // 动态加载，不进主包
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth, h = img.naturalHeight;
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
  pdf.addImage(dataUrl, 'PNG', 0, 0, w, h);
  return pdf.output('blob');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
