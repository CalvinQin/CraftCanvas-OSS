import { executionErrors, executionScope, graphShapeError, topologicalOrder } from './graph';
import type { WorkflowGraph, WorkflowNode, WorkflowValue } from './types';

export interface WorkflowExecutor {
  generate(node: WorkflowNode, prompt: string, images: string[]): Promise<string>;
  cutout(image: string): Promise<string | null>;
  transform(image: string, operation: 'rot90' | 'flipH' | 'flipV'): Promise<string>;
}

// Browser-owned orchestration. A stop prevents new steps; an already submitted model call is allowed to finish.
export async function runWorkflow(input: WorkflowGraph, executor: WorkflowExecutor, options: { target?: string; signal?: AbortSignal; onChange: (graph: WorkflowGraph) => void }): Promise<WorkflowGraph> {
  const shapeError = graphShapeError(input); if (shapeError) throw new Error(shapeError);
  const errors = executionErrors(input, options.target); if (errors.length) throw new Error(errors[0].message);
  let graph = structuredClone(input);
  const scope = executionScope(graph, options.target);
  const order = topologicalOrder(graph);
  const pending = new Set(order.filter(id => scope.has(id) && !(graph.nodes.find(n => n.id === id)?.status === 'success' && graph.nodes.find(n => n.id === id)?.output)));
  const active = new Map<string, Promise<void>>();
  const update = (id: string, patch: Partial<WorkflowNode>) => { graph = { ...graph, nodes: graph.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }; options.onChange(graph); };
  const execute = async (id: string) => {
    const node = graph.nodes.find(n => n.id === id)!;
    const values = graph.edges.filter(e => e.target === id).map(e => graph.nodes.find(n => n.id === e.source)!.output!);
    update(id, { status: 'running', error: undefined, output: undefined });
    try {
      let output: WorkflowValue;
      if (node.kind === 'image') output = { kind: 'image', value: node.config.image! };
      else if (node.kind === 'prompt') output = { kind: 'text', value: node.config.prompt!.trim() };
      else if (node.kind === 'generate') {
        const prompt = [...values.filter(v => v.kind === 'text').map(v => v.value), node.config.prompt || ''].filter(Boolean).join('\n\n');
        if (prompt.length > 32000) throw new Error('合并后的提示词超过 32000 字符，请精简');
        output = { kind: 'image', value: await executor.generate(node, prompt, values.filter(v => v.kind === 'image').map(v => v.value)) };
      } else {
        const image = values.find(v => v.kind === 'image')!.value;
        const value = node.kind === 'cutout' ? await executor.cutout(image) : node.kind === 'transform' ? await executor.transform(image, node.config.operation || 'rot90') : image;
        if (!value) throw new Error('未检测到可去除的连通白底，请使用白底产品图');
        output = { kind: 'image', value };
      }
      if (!output.value) throw new Error('这一步没有返回有效结果');
      update(id, { status: 'success', output });
    } catch (error) { update(id, { status: 'error', error: (error instanceof Error ? error.message : '这一步执行失败，请重试').slice(0, 500) }); }
  };
  while (pending.size || active.size) {
    for (const id of [...pending]) {
      const parents = graph.edges.filter(e => e.target === id).map(e => graph.nodes.find(n => n.id === e.source)!);
      if (parents.some(n => ['error', 'blocked'].includes(n.status)) && parents.every(n => !pending.has(n.id) && !active.has(n.id))) {
        pending.delete(id); update(id, { status: 'blocked', output: undefined, error: '等待上游失败步骤修复后重试' });
      } else if (!options.signal?.aborted && active.size < 2 && parents.every(n => n.status === 'success' && n.output)) {
        pending.delete(id);
        const task = execute(id).finally(() => active.delete(id)); active.set(id, task);
      }
    }
    if (active.size) await Promise.race(active.values());
    else if (options.signal?.aborted) break;
    else if (pending.size) throw new Error('工作流依赖未就绪，请检查连线');
  }
  return graph;
}
