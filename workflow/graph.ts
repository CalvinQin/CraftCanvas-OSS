import { NODE_META, type WorkflowGraph, type WorkflowNode, type PortKind } from './types';

const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const imagePattern = /^(?:\/api\/assets\/[a-f0-9]{64}|data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+=*)$/;

export function graphShapeError(value: any, cloud = false): string | null {
  if (!value || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return '请选择有效的 CraftCanvas 工作流文件';
  if (value.nodes.length > 60 || value.edges.length > 120) return '每个工作流最多 60 个节点、120 条连线';
  const ids = new Set<string>();
  for (const node of value.nodes) {
    if (!node || typeof node.id !== 'string' || !idPattern.test(node.id) || ids.has(node.id) || !Object.hasOwn(NODE_META, node.kind)) return '节点类型或编号无效';
    ids.add(node.id);
    if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > 80 || !Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 20000 || Math.abs(node.y) > 20000) return '节点名称或位置无效';
    const c = node.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return '节点配置无效';
    if (c.prompt !== undefined && (typeof c.prompt !== 'string' || c.prompt.length > 32000)) return '提示词不能超过 32000 字符';
    if (c.image !== undefined && (typeof c.image !== 'string' || (c.image && (!imagePattern.test(c.image) || (cloud && !c.image.startsWith('/api/assets/')))))) return '图片必须先上传到当前账号的素材存储';
    if (c.engine !== undefined && !['gemini-flash', 'gemini-pro', 'gpt-image', 'gpt-image-sunburst'].includes(c.engine)) return '模型选择无效';
    if (c.quality !== undefined && !['low', 'medium', 'high'].includes(c.quality)) return '出图质量无效';
    if (c.operation !== undefined && !['rot90', 'flipH', 'flipV'].includes(c.operation)) return '图片处理方式无效';
    if (c.wide !== undefined && typeof c.wide !== 'boolean') return '图片比例无效';
    if (!['idle', 'running', 'success', 'error', 'blocked'].includes(node.status) || (node.error !== undefined && (typeof node.error !== 'string' || node.error.length > 1000))) return '节点状态无效';
    if (node.output) {
      const o = node.output;
      const kind = NODE_META[node.kind as WorkflowNode['kind']].output || 'image';
      if (o.kind !== kind || typeof o.value !== 'string' || (o.kind === 'text' && o.value.length > 32000) || (o.kind === 'image' && (!imagePattern.test(o.value) || (cloud && !o.value.startsWith('/api/assets/'))))) return '节点结果无效';
    }
  }
  const edgeIds = new Set<string>(); const seen = new Set<string>();
  for (const edge of value.edges) {
    if (!edge || typeof edge.id !== 'string' || !idPattern.test(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target) || !['image', 'text'].includes(edge.port)) return '连线无效或存在未找到的节点';
    edgeIds.add(edge.id);
    const source = value.nodes.find((n: WorkflowNode) => n.id === edge.source);
    const target = value.nodes.find((n: WorkflowNode) => n.id === edge.target);
    if (source.id === target.id || NODE_META[source.kind as WorkflowNode['kind']].output !== edge.port || !NODE_META[target.kind as WorkflowNode['kind']].inputs.includes(edge.port)) return '请连接相同类型的输入与输出';
    const pair = `${edge.source}:${edge.target}:${edge.port}`;
    if (seen.has(pair)) return '两个节点之间已有这条连线';
    seen.add(pair);
    if (target.kind !== 'generate' && value.edges.filter((e: any) => e.target === target.id).length > 1) return '该节点只能连接一张输入图片';
    if (target.kind === 'generate' && value.edges.filter((e: any) => e.target === target.id && e.port === 'image').length > 16) return '生图节点最多连接 16 张参考图';
  }
  try { topologicalOrder(value); } catch { return '工作流不能形成循环，请移除回到上游的连线'; }
  return null;
}

export function topologicalOrder(graph: WorkflowGraph): string[] {
  const incoming = new Map(graph.nodes.map(n => [n.id, 0]));
  for (const edge of graph.edges) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  const queue = graph.nodes.filter(n => incoming.get(n.id) === 0).map(n => n.id); const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; order.push(id);
    for (const edge of graph.edges.filter(e => e.source === id)) { incoming.set(edge.target, incoming.get(edge.target)! - 1); if (incoming.get(edge.target) === 0) queue.push(edge.target); }
  }
  if (order.length !== graph.nodes.length) throw new Error('工作流不能包含循环');
  return order;
}

export function connectNodes(graph: WorkflowGraph, source: string, target: string, port: PortKind): WorkflowGraph {
  const result = { ...graph, edges: [...graph.edges, { id: crypto.randomUUID(), source, target, port }] };
  const error = graphShapeError(result); if (error) throw new Error(error);
  return invalidateNodes(result, [target]);
}

export function invalidateNodes(graph: WorkflowGraph, changed: string[]): WorkflowGraph {
  const affected = new Set(changed);
  for (let expanded = true; expanded;) { expanded = false; for (const edge of graph.edges) if (affected.has(edge.source) && !affected.has(edge.target)) { affected.add(edge.target); expanded = true; } }
  return { ...graph, nodes: graph.nodes.map(node => affected.has(node.id) ? { ...node, status: 'idle', output: undefined, error: undefined } : node) };
}

export function executionScope(graph: WorkflowGraph, target?: string): Set<string> {
  if (!target) return new Set(graph.nodes.map(n => n.id));
  const scope = new Set([target]);
  for (let expanded = true; expanded;) { expanded = false; for (const edge of graph.edges) if (scope.has(edge.target) && !scope.has(edge.source)) { scope.add(edge.source); expanded = true; } }
  return scope;
}

export function executionErrors(graph: WorkflowGraph, target?: string): { id: string; message: string }[] {
  const scope = executionScope(graph, target);
  return graph.nodes.filter(n => scope.has(n.id)).flatMap(n => {
    let message = '';
    if (n.kind === 'image' && !n.config.image) message = '请上传一张图片';
    if (n.kind === 'prompt' && !n.config.prompt?.trim()) message = '请填写提示词';
    if (n.kind === 'generate' && !n.config.prompt?.trim() && !graph.edges.some(e => e.target === n.id && e.port === 'text')) message = '请连接提示词，或填写补充要求';
    if (['cutout', 'transform', 'output'].includes(n.kind) && !graph.edges.some(e => e.target === n.id && e.port === 'image')) message = '请连接上游图片';
    return message ? [{ id: n.id, message }] : [];
  });
}

export function recoverInterrupted(graph: WorkflowGraph): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map(n => n.status === 'running' ? { ...n, status: 'error', output: undefined, error: '上次执行被中断，请确认用量后手动重试' } : n) };
}
