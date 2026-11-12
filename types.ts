import type { EngineId } from './services/engine';

export interface ProductImage {
  id: string;
  originalBase64: string;
  fileName: string;
}

// chat = 自由创作（自然语言直接生图，默认）
export type GenerationMode = 'chat' | 'angle' | 'layout' | 'nine';

export type NodeStatus = 'processing' | 'completed' | 'error';

// 图钉批注（世界内以图片百分比定位）
export interface NodePin {
  id: string;
  xPct: number;
  yPct: number;
  text: string;
}

// 图片内部图层（AI 语义分解产物：背景/主体/文字）
export interface NodeLayer {
  id: string;
  name: string;
  url: string; // 背景为不透明 PNG；主体/文字为抠透明 PNG
  hidden?: boolean;
}

// 画板上的一个图像节点（世界坐标）
export interface CanvasNodeData {
  id: string;
  runId: string;
  label: string;
  url: string | null;
  status: NodeStatus;
  errorMsg?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  engine: EngineId;
  prompt: string; // 生成该节点使用的完整提示词（重试用）
  baseImage?: string; // 追问重绘的底图（重试重绘节点时需要）
  refId?: string; // 上传素材节点对应的参考图 id（双向联动删除）
  pins?: NodePin[]; // 待执行的批注队列
  parentId?: string; // 衍生自哪个节点（追问/变体/编辑等），用于画关联连接线
  locked?: boolean; // 锁定：画布上不可拖动（图层面板可解锁）
  hidden?: boolean; // 隐藏：画布上不渲染
  opacity?: number; // 不透明度 0~1（缺省 1）
  layers?: NodeLayer[]; // 图片内部图层（分解后画板实时合成可见层）
  kind?: 'image' | 'text'; // 节点类型（缺省 image，兼容历史数据）
  groupId?: string; // 组合分组（⌘G）：点击组内任一成员选中整组
  text?: string;      // 文本元素内容
  fontSize?: number;  // 文本元素字号（世界坐标 px）
  textColor?: string; // 文本元素颜色
}

// 一次生成批次
export interface GenRun {
  id: string;
  mode: GenerationMode | 'refine' | 'assets';
  engine: EngineId;
  itemsDesc: string; // 素材清点结果（追问重绘复用）
  title: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thumbs?: { nodeId: string; url: string }[]; // 点击可飞到画板节点
  refImages?: string[]; // 用户消息附带的参考图
  pending?: boolean;
  runId?: string; // 所属框架（Frame 独立子对话过滤用）
  engine?: EngineId; // 结果消息展示的模型徽章
  ts?: number; // 时间戳（日期分隔线）
}
