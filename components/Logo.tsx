import React from 'react';

// 透明的折角 C 标识；SVG 在小尺寸和高像素密度屏幕上保持清晰。
export const LogoMark: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <img src="/brand/craftcanvas-icon.svg?v=0.2.0" alt="CraftCanvas" width={size} height={size}
    draggable={false} className="shrink-0 select-none" />
);

// 字标已转为轮廓，无需远程字体；中文字说明与品牌名称分开。
export const BrandWordmark: React.FC = () => (
  <span className="inline-flex shrink-0 flex-col gap-1.5 leading-none">
    <img src="/brand/craftcanvas-wordmark.svg?v=0.2.0" alt="CraftCanvas" width={105} height={14}
      draggable={false} className="h-[14px] w-auto select-none" />
    <span className="text-[8px] font-medium tracking-[0.035em] text-ink-500">跨境商品图 AI 工作台</span>
  </span>
);
