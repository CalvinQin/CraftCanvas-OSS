import { newWorkflowNode, type WorkflowGraph, type WorkflowKind, type WorkflowNode, type WorkflowEdge } from './types';

export const WORKFLOW_TEMPLATES = [
  { id: 'scene', title: '商品场景图', description: '一张实拍图，一段描述，生成新的商品场景。', count: '4 个节点' },
  { id: 'branches', title: '三种场景并行', description: '共用一张产品图，分别生成棚拍、生活与户外场景。', count: '10 个节点' },
  { id: 'local', title: '图片处理与交付', description: '旋转、预览、下载。不调用模型，可立即体验流程。', count: '3 个节点' },
] as const;

export function workflowTemplate(template: string): WorkflowGraph {
  const nodes: WorkflowNode[] = []; const edges: WorkflowEdge[] = [];
  const add = (kind: WorkflowKind, x: number, y: number, config = {}, label?: string) => { const node = newWorkflowNode(kind, x, y); node.config = { ...node.config, ...config }; if (label) node.label = label; nodes.push(node); return node; };
  const edge = (source: WorkflowNode, target: WorkflowNode, port: 'image' | 'text') => edges.push({ id: crypto.randomUUID(), source: source.id, target: target.id, port });
  const image = add('image', 60, 100);
  if (template === 'local') { const transform = add('transform', 370, 100); const output = add('output', 680, 100); edge(image, transform, 'image'); edge(transform, output, 'image'); }
  else if (template === 'branches') {
    ['极简棚拍：中性背景，柔和侧光，突出真实材质。', '生活场景：温暖室内，自然窗光，保持产品比例与细节。', '户外场景：自然环境，清晨光线，产品清晰突出。'].forEach((prompt, index) => {
      const text = add('prompt', 60, 410 + index * 300, { prompt: `保持参考图中的产品外观、颜色与品牌文字不变。${prompt}` }, ['极简棚拍', '生活方式', '户外氛围'][index]);
      const model = add('generate', 390, 100 + index * 300); const output = add('output', 720, 100 + index * 300);
      edge(image, model, 'image'); edge(text, model, 'text'); edge(model, output, 'image');
    });
  } else {
    const prompt = add('prompt', 60, 400, { prompt: '保持产品的形状、颜色、标识与材质不变。将产品置于干净的现代室内场景，自然窗光，商业摄影质感。不要添加未提供的文字或参数。' });
    const model = add('generate', 390, 170); const output = add('output', 720, 170);
    edge(image, model, 'image'); edge(prompt, model, 'text'); edge(model, output, 'image');
  }
  return { version: 1, nodes, edges };
}
