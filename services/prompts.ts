// 所有生成模式的提示词定义（引擎无关，Gemini 与 GPT Image 共用）

export type ProductAngle = 'FRONT' | 'PERSPECTIVE_3D' | 'SIDE' | 'BACK' | 'TOP' | 'DETAIL';
export type LayoutType = 'LAYOUT_1' | 'LAYOUT_2' | 'LAYOUT_3' | 'LAYOUT_4' | 'LAYOUT_5' | 'LAYOUT_6';
export type NineGridSlot =
  | 'DETAIL_1' | 'DETAIL_2' | 'DETAIL_3'
  | 'SCENE_1' | 'SCENE_2' | 'SCENE_3'
  | 'PARAM_1' | 'PARAM_2' | 'PARAM_3';

export const ANGLE_LABELS: Record<ProductAngle, string> = {
  FRONT: '正视主图',
  PERSPECTIVE_3D: '3D透视视角',
  SIDE: '侧视角度',
  BACK: '背视图',
  TOP: '俯视角度',
  DETAIL: '底视·细节图',
};

export const LAYOUT_LABELS: Record<LayoutType, string> = {
  LAYOUT_1: '排版 1 · 居中环绕',
  LAYOUT_2: '排版 2 · 左右分布',
  LAYOUT_3: '排版 3 · 右左分布',
  LAYOUT_4: '排版 4 · 上下分布',
  LAYOUT_5: '排版 5 · 对角线',
  LAYOUT_6: '排版 6 · 紧凑簇拥',
};

export const NINE_GRID_LABELS: Record<NineGridSlot, string> = {
  DETAIL_1: '细节 · 材质纹理',
  DETAIL_2: '细节 · 工艺做工',
  DETAIL_3: '细节 · 核心功能',
  SCENE_1: '场景 · 居家使用',
  SCENE_2: '场景 · 户外/工作',
  SCENE_3: '场景 · 手部交互',
  PARAM_1: '参数 · 尺寸标注',
  PARAM_2: '参数 · 功能标注',
  PARAM_3: '参数 · 规格总览',
};

const ANGLE_PROMPTS: Record<ProductAngle, string> = {
  FRONT: 'Strict Front View (0 degrees), eye-level camera angle, perfectly centered.',
  PERSPECTIVE_3D: 'Standard 3D Perspective (45 degrees isometric view).',
  SIDE: 'Profile View (90 degrees side angle).',
  BACK: 'Rear View (180 degrees back angle).',
  TOP: 'Plan View (Top-down flat angle, 90 degrees from above).',
  DETAIL: 'Macro Detail View (Close-up shot focusing on intricate details).',
};

const LAYOUT_PROMPTS: Record<LayoutType, string> = {
  LAYOUT_1: 'Flatlay photography, knolling style. The main largest product is exactly in the center, with all smaller accessories arranged in a perfect circle around it. Completely different layout from the original.',
  LAYOUT_2: 'Flatlay photography, knolling style. The main largest product is placed on the far left side. All smaller accessories are neatly aligned and organized on the right side. Completely different layout from the original.',
  LAYOUT_3: 'Flatlay photography, knolling style. The main largest product is placed on the far right side. All smaller accessories are neatly aligned and organized on the left side. Completely different layout from the original.',
  LAYOUT_4: 'Flatlay photography, knolling style. The main largest product is placed at the top. All smaller accessories are arranged in a neat, organized grid pattern below it. Completely different layout from the original.',
  LAYOUT_5: 'Flatlay photography. All items (main product and accessories) are arranged along a diagonal line from top-left to bottom-right. Completely different layout from the original.',
  LAYOUT_6: 'A tight, compact cluster arrangement. All accessories are closely packed and touching the main product, leaving no empty gaps between them. Completely different layout from the original.',
};

const CORE_FIDELITY_PROMPT = `
### CRITICAL CONSTRAINTS (Strict Fidelity Protocol) ###
1. ZERO HALLUCINATION: Do NOT add any new items, textures, buttons, interfaces, logos, labels, or scratches that are not present in the reference image. Do NOT omit any accessories.
2. 100% FIDELITY: The shape, proportions, material reflectivity, and color values of the product and all accessories MUST exactly match the reference image.
3. NO BEAUTIFICATION: Do not attempt to make the product look "better" or "more advanced". Restore its true physical appearance.
4. PURE WHITE BACKGROUND: The background must be solid #FFFFFF with no shadows cast on the background.
5. COMPOSITION: Center the main subject with 10%-15% white space around the edges.`;

const inventoryBlock = (itemsDesc?: string) =>
  itemsDesc ? `\nInventory List of items present in the reference image:\n---\n${itemsDesc}\n---\n` : '';

const customBlock = (custom?: string) =>
  custom?.trim() ? `\nAdditional Instruction from the merchant: ${custom.trim()}\n` : '';

export function buildAnglePrompt(angle: ProductAngle, itemsDesc?: string, custom?: string): string {
  return `You are an expert product photographer and retoucher for e-commerce (Alibaba.com listing standards).
Task: Generate a product image from a specific angle based on the reference image(s).

Target Angle: ${ANGLE_PROMPTS[angle]}
${inventoryBlock(itemsDesc)}${customBlock(custom)}
${CORE_FIDELITY_PROMPT}

Output the final image.`;
}

export function buildLayoutPrompt(layout: LayoutType, itemsDesc?: string, custom?: string): string {
  return `You are an expert product photographer and retoucher.
Task: You are provided with reference image(s) containing a main product and several accessories.
${inventoryBlock(itemsDesc) || '\nExtract the main product and every accessory visible in the reference image.\n'}
You must extract EVERY SINGLE ITEM from the reference image, and create a completely NEW composition.

Target Layout: ${LAYOUT_PROMPTS[layout]}
${customBlock(custom)}
CRITICAL CONSTRAINTS (STRICT ANTI-DUPLICATION & ZERO HALLUCINATION):
1. ZERO CLONING PROTOCOL: You are strictly forbidden from duplicating, cloning, or multiplying any object. If the reference image has EXACTLY ONE stand/tripod, you must draw EXACTLY ONE stand/tripod. Do NOT generate a second one to fill empty space.
2. EXACT QUANTITY MATCH: The final image MUST contain the exact same number of items as the reference. Missing an item is a failure, and adding an extra item is a CRITICAL FAILURE.
3. NO HALLUCINATIONS: Do NOT invent new cables, extra batteries, remotes, stands, or carrying cases that are not explicitly present in the reference image.
4. REARRANGE ONLY: You must physically move the items into the new Target Layout described. Do NOT copy the original layout pattern.
5. 100% FIDELITY: The shape, color, material, texture, and proportions of every single item must remain exactly the same as the reference image.
6. PURE WHITE BACKGROUND: The background must be solid #FFFFFF with absolutely no shadows cast on the background.

Output the final image.`;
}

// ---------- 一键九图 ----------

const DETAIL_FOCUS: Record<string, string> = {
  DETAIL_1: 'Extreme macro close-up of the product\'s PRIMARY SURFACE MATERIAL and texture (fabric weave, metal brushing, plastic grain, leather pores, coating finish). Fill the frame with the material. Shallow depth of field, crisp focus on the texture.',
  DETAIL_2: 'Macro close-up of the product\'s CONSTRUCTION AND CRAFTSMANSHIP: seams, stitching, joints, welds, buttons, zippers, ports, connectors or edges — pick the most convincing quality cue actually visible in the reference.',
  DETAIL_3: 'Hero close-up of the product\'s SINGLE MOST IMPORTANT FUNCTIONAL FEATURE (the part a buyer cares about most: interface, mechanism, blade, lens, sole, valve, control panel...). Slight dramatic angle.',
};

const SCENE_FOCUS: Record<string, string> = {
  SCENE_1: 'A real person naturally USING the product in a bright, modern HOME / INDOOR environment appropriate to this product category. Candid lifestyle commercial photography, warm natural window light.',
  SCENE_2: 'A real person USING the product in an OUTDOOR or WORK / PROFESSIONAL environment appropriate to this product category (street, park, gym, office, workshop...). Editorial commercial photography, natural daylight.',
  SCENE_3: 'Tight close-up of a real person\'s HANDS interacting with the product (holding, pressing, adjusting, wearing). Skin texture realistic, natural manicure, soft studio light.',
};

const SCENE_CONSTRAINTS = `
### SCENE CONSTRAINTS ###
1. The product itself must remain 100% IDENTICAL to the reference image — same shape, color, proportions, materials, logos. Do not redesign it.
2. The person must look like a natural, believable real human (photorealistic, NOT a celebrity, NOT an illustration). Vary ethnicity naturally across shots.
3. Composition follows professional e-commerce lifestyle photography: product is the clear hero, person supports the story.
4. NO text, NO watermarks, NO brand logos other than those already on the product.`;

const PARAM_STYLES: Record<string, string> = {
  PARAM_1: 'A DIMENSION DIAGRAM: the product rendered cleanly on pure white background with thin, precise measurement lines and arrows marking width / height / depth (and other key dimensions). Engineering-catalog aesthetic.',
  PARAM_2: 'A FEATURE CALLOUT infographic: the product centered on pure white background with 3-5 thin leader lines pointing to its key features, each ending in a short text label. Clean minimal e-commerce listing style.',
  PARAM_3: 'A SPECIFICATION OVERVIEW card: the product on the left of a pure white canvas, and on the right a neat, minimal specification table/panel listing the key parameters. Premium listing-page aesthetic.',
};

export function buildNineGridPrompt(slot: NineGridSlot, itemsDesc?: string, custom?: string, specText?: string): string {
  if (slot.startsWith('DETAIL')) {
    return `You are an expert e-commerce product photographer.
Task: Shoot a professional PRODUCT DETAIL photo of the product in the reference image(s).

Shot brief: ${DETAIL_FOCUS[slot]}
${inventoryBlock(itemsDesc)}${customBlock(custom)}
### CONSTRAINTS ###
1. 100% FIDELITY: material, color and construction must exactly match the reference product. ZERO redesign, ZERO hallucinated parts.
2. Background: clean pure white or very light neutral studio backdrop.
3. Lighting: soft professional studio lighting that flatters the real material.
4. NO text, NO watermarks.

Output the final image.`;
  }

  if (slot.startsWith('SCENE')) {
    return `You are an expert commercial lifestyle photographer for e-commerce (Alibaba.com listing standards).
Task: Shoot a photorealistic LIFESTYLE photo showing the product from the reference image(s) IN USE by a real person.

Shot brief: ${SCENE_FOCUS[slot]}
${inventoryBlock(itemsDesc)}${customBlock(custom)}${SCENE_CONSTRAINTS}

Output the final image.`;
  }

  // PARAM 参数图
  const specBlock = specText?.trim()
    ? `### EXACT SPECIFICATION DATA (provided by the merchant — use ONLY these values, verbatim) ###\n${specText.trim()}\n### END SPECIFICATION DATA ###\nRender the relevant values from the data above. Do NOT invent numbers that are not listed.`
    : `No exact specification data was provided. Only annotate features that are clearly VISIBLE in the reference image, using qualitative labels (e.g. "Aluminum body", "Non-slip base"). Do NOT invent any specific numbers, dimensions or capacities.`;

  return `You are an expert e-commerce infographic designer for Alibaba.com international listings.
Task: Design a SPECIFICATION INFOGRAPHIC image for the product in the reference image(s).

Style brief: ${PARAM_STYLES[slot]}
${inventoryBlock(itemsDesc)}${customBlock(custom)}
${specBlock}

### DESIGN CONSTRAINTS ###
1. The product render must be 100% faithful to the reference image.
2. ALL text must be in ENGLISH, spelled correctly, crisp and legible (Alibaba.com international compliance — no Chinese characters).
3. Flat, minimal design language: thin lines, one accent color at most, generous white space, pure white background.
4. Typography small and neat; text must never overlap the product.

Output the final image.`;
}

// 内置提示词库（Lovart 式模板）：点击即填入输入框
export interface PromptPreset { label: string; text: string }

export const PROMPT_PRESETS: { category: string; items: PromptPreset[] }[] = [
  {
    category: '主图 & 白底',
    items: [
      { label: '合规白底主图', text: '生成阿里国际站合规白底主图：纯白背景，产品居中占画面 85%，柔和棚拍打光，无阴影无文字' },
      { label: '悬浮动感主图', text: '产品悬浮在纯白背景中，轻微倾斜的动感角度，底部一层柔和倒影，高级棚拍质感' },
      { label: '三角度拼版', text: '在一张白底图中整齐展示产品的正面、侧面、背面三个角度，间距均匀，专业目录风' },
    ],
  },
  {
    category: '场景 & 生活方式',
    items: [
      { label: '居家使用场景', text: '把产品放进明亮的现代居家场景，一位真实的人正在自然地使用它，窗边自然光，生活感强' },
      { label: '户外使用场景', text: '产品在户外真实环境中被人使用（根据产品类别选择露营/街头/公园），日光充足，商业摄影质感' },
      { label: '桌面静物搭配', text: '产品摆放在质感木桌上，搭配两三件相关小物件做氛围陪衬，浅景深，杂志静物风' },
    ],
  },
  {
    category: '营销 & 海报',
    items: [
      { label: '促销海报', text: '为产品设计简约电商促销海报：大面积留白，醒目的英文标题区域，现代无衬线排版，仅用一个点缀色' },
      { label: '店铺横幅 Banner', text: '生成 16:9 店铺横幅：产品居右，左侧留出文案空间，浅色渐变背景，高级简约风' },
      { label: '节日主题图', text: '为产品打造节日主题场景图，节日元素做点缀但产品仍是绝对主角，配英文氛围文案' },
    ],
  },
  {
    category: '细节 & 参数',
    items: [
      { label: '材质微距特写', text: '拍摄产品核心材质的微距特写，展现做工与质感，浅景深，专业商业摄影' },
      { label: '尺寸标注图', text: '生成产品尺寸标注图：白底，细线箭头标注长宽高，工程目录风格，英文标注，数字仅标注可见比例不虚构' },
      { label: '功能爆炸图', text: '生成产品功能分解示意图：主要部件适度分离展示，细引导线连接英文功能标签，纯白背景' },
    ],
  },
];

// 自由创作：自然语言直接生图（有参考图时保持产品保真）
export function buildChatPrompt(text: string, hasRefs: boolean, itemsDesc?: string): string {
  if (!hasRefs) {
    return `${text.trim()}

(High-quality professional e-commerce photography / design output. NO watermarks.)`;
  }
  return `You are an expert e-commerce visual designer.
Task from the merchant (execute it on the provided reference image(s)):
${text.trim()}
${inventoryBlock(itemsDesc)}
### CONSTRAINTS ###
1. The product's shape, colors, materials and proportions must stay 100% faithful to the reference image(s) unless the task explicitly asks to change them.
2. Professional commercial quality. NO watermarks.

Output the final image.`;
}

// 批注队列：一次执行多条图钉标注
export function buildAnnotationsPrompt(pins: { xPct: number; yPct: number; text: string }[], itemsDesc?: string): string {
  const list = pins
    .map((p, i) => `${i + 1}. At approximately (${Math.round(p.xPct)}% from left, ${Math.round(p.yPct)}% from top): ${p.text}`)
    .join('\n');
  return `You are an expert product photo retoucher.
Task: Apply ALL of the following localized edits to the LAST image (the current result). Each edit is pinned to a location given as percentages of the image dimensions.

### PINNED EDITS (apply every single one) ###
${list}
${inventoryBlock(itemsDesc)}
### CONSTRAINTS ###
1. Modify ONLY the pinned regions as instructed. Everything else must stay PIXEL-IDENTICAL to the current image.
2. Blend each edit seamlessly with surrounding pixels (lighting, grain, perspective).
3. The product's overall physical accuracy must be preserved.

Output the final image.`;
}

// Lovart 式智能分层：三层分解提示词
export type LayerKind = 'background' | 'subject' | 'typography';

export function buildLayerPrompt(kind: LayerKind): string {
  // 注意：措辞需保证模型「必然输出一张图」——“输出空背景/空白图”类指令易被拒绝出图
  switch (kind) {
    case 'background':
      return `You MUST output an image. Task: Recreate the LAST image's backdrop as a standalone background plate. Remove the main product(s) and all text, then seamlessly fill those areas by extending the surrounding backdrop (same colors, lighting, surface, gradients). If the backdrop is plain, simply output that plain backdrop filling the whole canvas. Never refuse: always render the resulting background image.`;
    case 'subject':
      return `You MUST output an image. Task: Extract ONLY the main product(s)/subject from the LAST image. Render them at the EXACT same position, scale, angle and lighting as the original, on a PURE WHITE #FFFFFF background. No text, no annotations, no background shadows. 100% fidelity to the original product pixels.`;
    case 'typography':
      return `You MUST output an image. Task: Render a white canvas the same size as the LAST image, containing ONLY the text, annotation lines, callout arrows and measurement marks copied from it at their EXACT positions and sizes. NO product, NO other objects. If there is no text at all, still render the plain white canvas image (do not refuse).`;
  }
}

// Touch Edit 触点编辑：针对已识别元素的直改（改字/换色/移除/自由指令）
export function buildTouchEditPrompt(elementDesc: string, instruction: string, xPct: number, yPct: number): string {
  return `You are an expert product photo retoucher performing a precise TOUCH EDIT on the LAST image.

Target element: ${elementDesc}
Location: approximately ${Math.round(xPct)}% from the left edge, ${Math.round(yPct)}% from the top edge of the image.

Edit to perform on the target element:
${instruction}

### CONSTRAINTS ###
1. Modify ONLY the target element. Every other pixel must stay IDENTICAL to the current image.
2. If the edit involves text: keep the SAME font style, size, weight, color and alignment as the original text unless the instruction says otherwise. Spell the new text EXACTLY as given.
3. Blend the edit seamlessly (lighting, texture, grain, perspective).

Output the final image.`;
}

// 图钉局部修改：只改指定坐标附近的区域
export function buildPinRefinePrompt(instruction: string, xPct: number, yPct: number, itemsDesc?: string): string {
  return `You are an expert product photo retoucher.
Task: Perform a LOCALIZED edit on the LAST image (the current result). The user has pinned a specific point on the image.

Pinned location: approximately ${Math.round(xPct)}% from the left edge, ${Math.round(yPct)}% from the top edge of the image.

Edit instruction for the pinned region:
${instruction}
${inventoryBlock(itemsDesc)}
### CONSTRAINTS ###
1. Modify ONLY the localized region around the pinned point. Everything else must stay PIXEL-IDENTICAL to the current image.
2. Blend the edit seamlessly with the surrounding pixels (lighting, grain, perspective).
3. The product's overall physical accuracy must be preserved.

Output the final image.`;
}

// 生成变体：同一任务的另一种合理演绎
export function buildVariationPrompt(originalPrompt: string): string {
  return `${originalPrompt}

### VARIATION DIRECTIVE ###
Produce an ALTERNATIVE take on the same brief: keep the product 100% identical and all constraints above in force, but vary the composition/camera angle/arrangement noticeably from the previous result.`;
}

// 高清放大：内容不变，重渲更高分辨率
export function buildUpscalePrompt(): string {
  return `Reproduce the LAST image EXACTLY — identical content, composition, colors, lighting and background — at ultra-high resolution. Sharpen fine textures and edges naturally. Do NOT add, remove, move or restyle anything. Output the final image.`;
}

// 扩图：横向扩展画布
export function buildOutpaintPrompt(): string {
  return `Outpaint the LAST image to a wide 16:9 banner. Keep the existing content PIXEL-IDENTICAL and centered; only extend the background naturally to the left and right (seamless continuation of the same backdrop, lighting and floor/surface). Do NOT add new objects or text. Output the final image.`;
}

// 标注烧图重绘（Set-of-Mark）：图上已画有红色标注（框/圈/箭头/画笔/文字），作为改哪里+怎么改的指引
export function buildAnnotatedRefinePrompt(instruction: string, itemsDesc?: string): string {
  return `You are an expert product photographer and retoucher for e-commerce.
The LAST image has RED ANNOTATION MARKS drawn on it by the merchant — rectangles, circles/ellipses, arrows, freehand strokes, and short red text labels. These marks are EDITING DIRECTIONS, not part of the product:
- A shape or freehand circle marks the AREA to change.
- An arrow points FROM a note TO the target, or indicates a direction/movement.
- Red text is a short instruction or label for the marked area.

Task: Interpret every red annotation together with the merchant's written instruction below, and produce the edited image accordingly.

Merchant's written instruction:
${instruction || '(No extra text — follow the on-image annotations.)'}
${inventoryBlock(itemsDesc)}
### CRITICAL CONSTRAINTS ###
1. The RED annotation marks are guidance ONLY. They MUST NOT appear in the output image — remove them entirely and render a clean final result.
2. Apply changes only where the annotations indicate; everything else stays IDENTICAL to the current image.
3. Preserve product physical accuracy against the reference image(s).

Output the final clean image with the requested edits and NO annotation marks.`;
}

export function buildRefinePrompt(instruction: string, itemsDesc?: string): string {
  return `You are an expert product photographer and retoucher for e-commerce.
Task: Refine and modify the LAST image (the current generated result) based on the user's instruction, keeping the earlier reference image(s) in mind for product fidelity.

Refinement Instruction:
${instruction}
${inventoryBlock(itemsDesc)}
### CONSTRAINTS ###
1. Execute the user's refinement instruction precisely.
2. Everything not mentioned in the instruction must stay IDENTICAL to the current image.
3. Product physical accuracy must match the reference image(s).

Output the final image.`;
}
