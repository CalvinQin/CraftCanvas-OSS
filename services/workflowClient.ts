import { graphShapeError, recoverInterrupted } from '../workflow/graph';
import type { WorkflowDocument, WorkflowGraph, WorkflowSummary } from '../workflow/types';

export class WorkflowConflictError extends Error {}

export function createWorkflowClient(accountId: string) {
  const revisions = new Map<string, string>(); const queues = new Map<string, Promise<unknown>>(); const conflicts = new Set<string>();
  const uploaded = new Map<string, string>(); const hydrated = new Map<string, string>();
  async function request(url: string, init: RequestInit = {}) {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(60_000), headers: { ...init.headers, 'X-Project-Account': accountId } });
    if (!response.ok) {
      let message = '连接失败，请保留本地内容后重试'; try { message = (await response.json()).error?.message || message; } catch { /* safe fallback */ }
      if ([412, 428].includes(response.status) || (response.status === 409 && url !== '/api/workflows')) throw new WorkflowConflictError(message);
      if (response.status === 401) throw new Error('登录已过期，请导出备份后重新登录');
      throw new Error(message);
    }
    return response;
  }
  async function imageTransfer(value: string, direction: 'upload' | 'download'): Promise<string> {
    if (direction === 'upload') {
      if (!value.startsWith('data:image/')) return value;
      if (uploaded.has(value)) return uploaded.get(value)!;
      const blob = await (await fetch(value)).blob();
      if (blob.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB');
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
      const path = `/api/assets/${hash}`;
      await request(path, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
      uploaded.set(value, path); hydrated.set(path, value); return path;
    }
    if (!value.startsWith('/api/assets/')) return value;
    if (hydrated.has(value)) return hydrated.get(value)!;
    const blob = await (await request(value)).blob();
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(blob); });
    hydrated.set(value, data); uploaded.set(data, value); return data;
  }
  async function transfer(graph: WorkflowGraph, direction: 'upload' | 'download') {
    const values = [...new Set(graph.nodes.flatMap(n => [n.config.image, n.output?.kind === 'image' ? n.output.value : undefined].filter(Boolean) as string[]))];
    const mapped = new Map<string, string>(); let next = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(3, values.length) }, async () => { while (next < values.length) { const value = values[next++]; mapped.set(value, await imageTransfer(value, direction)); } }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    return { ...graph, nodes: graph.nodes.map(n => ({ ...n, config: { ...n.config, ...(n.config.image ? { image: mapped.get(n.config.image)! } : {}) }, ...(n.output?.kind === 'image' ? { output: { ...n.output, value: mapped.get(n.output.value)! } } : {}) })) };
  }
  function remember(id: string, response: Response) { const revision = response.headers.get('ETag'); if (!revision) throw new Error('未收到保存版本，请导出备份后重新打开'); revisions.set(id, revision); }
  return {
    accountId,
    async list(): Promise<WorkflowSummary[]> { return (await (await request('/api/workflows')).json()).rows; },
    async load(id: string): Promise<WorkflowDocument> {
      const response = await request(`/api/workflows/${id}`); const doc = await response.json();
      const error = graphShapeError(doc.graph, true); if (error) throw new Error(error);
      const graph = await transfer(doc.graph, 'download'); remember(id, response); conflicts.delete(id);
      return { ...doc, graph: recoverInterrupted(graph) };
    },
    async create(title: string, graph: WorkflowGraph): Promise<WorkflowDocument> {
      const error = graphShapeError(graph); if (error) throw new Error(error);
      const response = await request('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, graph: await transfer(graph, 'upload') }) });
      const doc = await response.json(); remember(doc.id, response); return { ...doc, graph };
    },
    save(doc: WorkflowDocument): Promise<WorkflowSummary> {
      const operation = (queues.get(doc.id) || Promise.resolve()).catch(() => {}).then(async () => {
        if (conflicts.has(doc.id)) throw new WorkflowConflictError('云端已有新版本，请导出本地工作流，再重新打开');
        if (!revisions.has(doc.id)) throw new Error('请先读取工作流');
        const error = graphShapeError(doc.graph); if (error) throw new Error(error);
        try {
          const response = await request(`/api/workflows/${doc.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': revisions.get(doc.id)! }, body: JSON.stringify({ title: doc.title, graph: await transfer(doc.graph, 'upload') }) });
          remember(doc.id, response); return await response.json();
        } catch (error) { if (error instanceof WorkflowConflictError) conflicts.add(doc.id); throw error; }
      });
      queues.set(doc.id, operation); return operation;
    },
  };
}
