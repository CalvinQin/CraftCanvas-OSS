import type { EngineId } from '../services/engine';

export type WorkflowKind = 'image' | 'prompt' | 'generate' | 'cutout' | 'transform' | 'output';
export type PortKind = 'image' | 'text';
export type WorkflowStatus = 'idle' | 'running' | 'success' | 'error' | 'blocked';
export interface WorkflowValue { kind: PortKind; value: string }
export interface WorkflowNode {
  id: string;
  kind: WorkflowKind;
  label: string;
  x: number;
  y: number;
  config: {
    image?: string;
    prompt?: string;
    engine?: EngineId;
    quality?: 'low' | 'medium' | 'high';
    wide?: boolean;
    operation?: 'rot90' | 'flipH' | 'flipV';
  };
  status: WorkflowStatus;
  output?: WorkflowValue;
  error?: string;
}
export interface WorkflowEdge { id: string; source: string; target: string; port: PortKind }
export interface WorkflowGraph { version: 1; nodes: WorkflowNode[]; edges: WorkflowEdge[] }
export interface WorkflowDocument { id: string; title: string; graph: WorkflowGraph; updatedAt: number }
export interface WorkflowSummary { id: string; title: string; updatedAt: number; nodeCount: number }

export const NODE_META: Record<WorkflowKind, { label: string; detail: string; output: PortKind | null; inputs: PortKind[]; color: string }> = {
  image: { label: '图片输入', detail: '上传产品图或参考素材', output: 'image', inputs: [], color: 'blue' },
  prompt: { label: '提示词', detail: '描述场景、风格与要求', output: 'text', inputs: [], color: 'amber' },
  generate: { label: '模型生图', detail: '组合提示词与参考图', output: 'image', inputs: ['text', 'image'], color: 'violet' },
  cutout: { label: '白底去背景', detail: '本地处理，保留透明主体', output: 'image', inputs: ['image'], color: 'green' },
  transform: { label: '旋转与翻转', detail: '本地处理，不消耗生图额度', output: 'image', inputs: ['image'], color: 'green' },
  output: { label: '图片输出', detail: '预览并下载最终图片', output: null, inputs: ['image'], color: 'rose' },
};

export function newWorkflowNode(kind: WorkflowKind, x = 80, y = 100): WorkflowNode {
  return { id: crypto.randomUUID(), kind, label: NODE_META[kind].label, x, y, status: 'idle', config: kind === 'generate' ? { engine: 'gemini-flash', quality: 'low' } : kind === 'transform' ? { operation: 'rot90' } : {} };
}
