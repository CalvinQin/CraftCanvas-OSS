import type { GenerationMode } from '../types';
export const templates: { id: string; title: string; category: string; description: string; prompt: string; mode: GenerationMode; tone: string }[] = [
  { id: 'clean', title: '干净的白底主图', category: '电商主图', description: '让材质、轮廓与细节成为主角。', prompt: '以参考产品为主体，生成干净的电商白底主图。完整保留产品形状、颜色、材质和品牌文字，居中构图，柔和的接触阴影，专业棚拍质感，不增加额外文字。', mode: 'chat', tone: 'ivory' },
  { id: 'editorial', title: '品牌感场景图', category: '品牌场景', description: '柔和光线，克制的道具与叙事。', prompt: '为参考产品设计高级品牌场景图。使用暖米白背景、自然侧光与少量协调的道具，保留产品原始细节，以商业杂志摄影的方式呈现，不添加文字或虚构产品功能。', mode: 'chat', tone: 'lavender' },
  { id: 'detail', title: '放大材质细节', category: '细节展示', description: '把值得关注的工艺呈现清楚。', prompt: '生成参考产品的微距材质细节特写，突出真实纹理与工艺，浅景深，自然光，保持材质、颜色和结构一致，不虚构原图没有的零件和标签。', mode: 'chat', tone: 'clay' },
  { id: 'social', title: '社交媒体创意', category: '品牌场景', description: '适合新产品发布的轻盈构图。', prompt: '围绕参考产品生成社交媒体发布图片。轻盈的留白构图，淡紫色与奶油色的协调背景，有清晰视觉焦点，保留产品细节，不生成文字，留出可后期添加标题的空间。', mode: 'chat', tone: 'lavender' },
  { id: 'angles', title: '一次看清六个角度', category: '商品系列', description: '正面、侧面、背面与细节。', prompt: '保持产品形状、材质、配色一致，使用统一的中性棚拍环境。请先核对参考图能确认的产品结构，无法确认的部分保持克制。', mode: 'angle', tone: 'ivory' },
  { id: 'nine', title: '整套商品九图', category: '商品系列', description: '从细节到场景的完整视觉叙事。', prompt: '以简洁、高级、真实的视觉语言制作一整套商品图。保持产品与品牌一致，不虚构产品参数或认证。', mode: 'nine', tone: 'clay' },
];
export const selectedTemplate = () => templates.find(item => item.id === new URLSearchParams(window.location.search).get('template'));
