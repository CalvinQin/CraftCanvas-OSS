import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Play, Square, Plus, Upload, Download, Copy, Trash2, X, GitBranch, Loader2, Check, RefreshCw, Settings2 } from 'lucide-react';
import { LogoMark } from './Logo';
import { Select, Switch } from './ui/Controls';
import WorkflowCanvas, { WORKFLOW_ICONS } from './WorkflowCanvas';
import { NODE_META, newWorkflowNode, type WorkflowDocument, type WorkflowGraph, type WorkflowKind, type WorkflowNode, type WorkflowSummary } from '../workflow/types';
import { connectNodes, executionErrors, executionScope, graphShapeError, invalidateNodes, recoverInterrupted } from '../workflow/graph';
import { WORKFLOW_TEMPLATES, workflowTemplate } from '../workflow/templates';
import { runWorkflow } from '../workflow/runner';
import { createWorkflowClient, WorkflowConflictError } from '../services/workflowClient';
import { ENGINES, generateWithEngine, type EngineId } from '../services/engine';
import { setCloudKeys, setSessionPricing, creationPrice } from '../services/keys';
import { cutoutToTransparentPng, transformImageDataUrl, downloadBlob, downloadDataUrl } from '../services/imageTools';
import { generationErrorMessage } from '../workflow/safeError';
import '../workflow.css';

const explain = (e: unknown) => e instanceof TypeError ? '网络连接失败，请检查网络后重试；当前内容仍在页面中' : e instanceof Error ? e.message : '操作暂时失败，请重试';

export default function WorkflowPage() {
  const [gate, setGate] = useState<'loading' | 'signin' | 'ready' | 'error'>('loading');
  const [documents, setDocuments] = useState<WorkflowSummary[]>([]);
  const [doc, setDoc] = useState<WorkflowDocument | null>(null); const docRef = useRef(doc); docRef.current = doc;
  const client = useRef<ReturnType<typeof createWorkflowClient> | null>(null);
  const [selected, setSelected] = useState<string | null>(null); const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [running, setRunning] = useState(false); const [stopping, setStopping] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState(''); const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [edit, setEdit] = useState(0); const [fitKey, setFitKey] = useState(0); const [showTemplates, setShowTemplates] = useState(false);
  const runController = useRef<AbortController | null>(null); const imported = useRef<HTMLInputElement>(null); const imageInput = useRef<HTMLInputElement>(null);
  const selectedNode = doc?.graph.nodes.find(n => n.id === selected);
  const locked = running || busy;
  const changed = (graph: WorkflowGraph) => { if (!docRef.current) return; const next = { ...docRef.current, graph }; docRef.current = next; setDoc(next); setEdit(v => v + 1); setSaveState('saving'); };
  const install = (next: WorkflowDocument) => { docRef.current = next; setDoc(next); setSelected(null); setSettingsOpen(false); setEdit(0); setSaveState('saved'); setSaveError(''); setConflict(false); setError(''); setNotice(''); setFitKey(v => v + 1); setShowTemplates(false); };
  const upsertSummary = (item: WorkflowSummary) => setDocuments(rows => [item, ...rows.filter(row => row.id !== item.id)]);
  useEffect(() => {
    document.title = '节点工作流 · CraftCanvas'; let active = true;
    (async () => {
      const response = await fetch('/api/session', { cache: 'no-store' }); if (!response.ok) throw new Error('暂时无法读取账号');
      const session = await response.json(); if (!active) return;
      if (!session.userId) { setGate('signin'); return; }
      setCloudKeys(session.providers); setSessionPricing(session); const service = createWorkflowClient(session.userId); client.current = service;
      const rows = await service.list(); if (!active) return; setDocuments(rows);
      if (rows.length) { const next = await service.load(rows[0].id); if (!active) return; install(next); }
      setGate('ready');
    })().catch(e => { if (active) { setError(explain(e)); setGate('error'); } });
    return () => { active = false; runController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!edit || !doc || !client.current) return;
    let active = true; setSaveState('saving');
    const timer = setTimeout(() => {
      client.current!.save(doc).then(summary => { upsertSummary(summary); if (active) { setSaveState('saved'); setSaveError(''); } }).catch(e => { if (active) { setSaveState('error'); setSaveError(explain(e)); setConflict(e instanceof WorkflowConflictError); } });
    }, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [edit, doc]);
  useEffect(() => {
    const close = (e: BeforeUnloadEvent) => { if (running || saveState !== 'saved') { e.preventDefault(); e.returnValue = ''; } };
    const online = () => { if (saveState === 'error' && !conflict) setEdit(v => v + 1); };
    window.addEventListener('beforeunload', close); window.addEventListener('online', online);
    return () => { window.removeEventListener('beforeunload', close); window.removeEventListener('online', online); };
  }, [running, saveState, conflict]);
  const create = async (title: string, graph: WorkflowGraph) => {
    if (!client.current || locked) return;
    if (saveState !== 'saved') { setError('请先保存当前工作流，或导出备份后重新打开'); return; }
    setBusy(true); setError('');
    try { const next = await client.current.create(title, graph); install(next); upsertSummary({ id: next.id, title: next.title, updatedAt: next.updatedAt, nodeCount: graph.nodes.length }); }
    catch (e) { setError(explain(e)); } finally { setBusy(false); }
  };
  const open = async (id: string, afterBackup = false) => {
    if (!client.current || locked || (!afterBackup && saveState !== 'saved')) return;
    setBusy(true); setError('');
    try { install(await client.current.load(id)); } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  };
  const exportJson = () => {
    if (!doc) return;
    downloadBlob(new Blob([JSON.stringify({ app: 'CraftCanvasWorkflow', version: 1, title: doc.title, graph: doc.graph }, null, 2)], { type: 'application/json' }), `CraftCanvas_工作流_${Date.now()}.json`);
    setNotice('工作流 JSON 已导出，包含图片与已完成结果');
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('工作流文件不能超过 80 MB');
      const value = JSON.parse(await file.text()); const problem = graphShapeError(value.graph); if (problem) throw new Error(problem);
      if (value.graph.nodes.some((n: WorkflowNode) => n.config.image?.startsWith('/api/') || n.output?.value.startsWith('/api/'))) throw new Error('请从原工作流导出包含完整图片的 JSON 文件');
      await create(typeof value.title === 'string' ? value.title.slice(0, 75) + ' · 导入' : '导入的工作流', recoverInterrupted(value.graph));
    } catch (e) { setError(e instanceof SyntaxError ? '文件无法解析，请选择导出的工作流 JSON' : explain(e)); }
  };
  const patchNode = (id: string, patch: Partial<WorkflowNode>, invalidate = true) => {
    if (!docRef.current || locked) return;
    const graph = { ...docRef.current.graph, nodes: docRef.current.graph.nodes.map(n => n.id === id ? { ...n, ...patch } : n) };
    changed(invalidate ? invalidateNodes(graph, [id]) : graph);
  };
  const addNode = (kind: WorkflowKind, x = 100 + (doc?.graph.nodes.length || 0) * 35, y = 100) => {
    if (!doc || locked) return; if (doc.graph.nodes.length >= 60) { setError('每条工作流最多 60 个节点'); return; }
    const node = newWorkflowNode(kind, x, y); changed({ ...doc.graph, nodes: [...doc.graph.nodes, node] }); setSelected(node.id);
  };
  const connect = (source: string, target: string, port: 'image' | 'text') => {
    if (!doc || locked) return;
    try { changed(connectNodes(doc.graph, source, target, port)); setError(''); setNotice('已连接，下游结果会在下次运行时更新'); } catch (e) { setError(explain(e)); }
  };
  const removeNode = (node: WorkflowNode) => {
    if (!doc || locked) return;
    const graph = invalidateNodes(doc.graph, [node.id]); changed({ ...graph, nodes: graph.nodes.filter(n => n.id !== node.id), edges: graph.edges.filter(e => e.source !== node.id && e.target !== node.id) }); setSelected(null);
  };
  const uploadImage = async (file?: File) => {
    if (!file || !selectedNode || locked) return;
    try {
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) throw new Error('请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片');
      if (file.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB');
      const id = selectedNode.id;
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
      const decoded = new Image(); decoded.src = image; await decoded.decode();
      if (decoded.naturalWidth * decoded.naturalHeight > 40_000_000) throw new Error('图片像素过大，请缩小到 4000 万像素以内');
      patchNode(id, { config: { ...selectedNode.config, image } }); setError('');
    } catch (e) { setError(explain(e)); }
  };
  const run = async (target?: string) => {
    if (!doc || !client.current || locked || saveState !== 'saved') return;
    setError(''); setNotice('');
    const problems = executionErrors(doc.graph, target);
    if (problems.length) { setSelected(problems[0].id); setError(`${doc.graph.nodes.find(n => n.id === problems[0].id)?.label}：${problems[0].message}`); return; }
    const scope = executionScope(doc.graph, target);
    const unavailable = doc.graph.nodes.find(n => scope.has(n.id) && n.kind === 'generate' && !(n.status === 'success' && n.output) && !ENGINES[n.config.engine || 'gemini-flash'].available());
    if (unavailable) { setSelected(unavailable.id); setError('所选模型尚未开放，请配置服务端密钥后重新打开工作流，或选择已开放模型'); return; }
    const controller = new AbortController(); runController.current = controller; setRunning(true); setStopping(false);
    try {
      const result = await runWorkflow(doc.graph, {
        generate: async (node, prompt, images) => {
          try { return await generateWithEngine(node.config.engine || 'gemini-flash', images, prompt, undefined, { quality: node.config.quality || 'low', wide: node.config.wide, retryOnQuota: false, expectedAccount: client.current!.accountId }); }
          catch (e) { throw new Error(generationErrorMessage(e)); }
        },
        cutout: cutoutToTransparentPng, transform: transformImageDataUrl,
      }, { target, signal: controller.signal, onChange: changed });
      const errors = result.nodes.filter(n => scope.has(n.id) && n.status === 'error');
      setNotice(controller.signal.aborted ? '已停止后续步骤；已提交的步骤已结束，结果已保留' : errors.length ? `${errors.length} 个步骤失败，已完成结果保留，可修复后继续运行` : '运行完成，结果已保留。再次运行会复用未修改步骤的结果。');
      if (errors.length) setSelected(errors[0].id);
    } catch (e) { setError(explain(e)); } finally { setRunning(false); setStopping(false); runController.current = null; }
  };
  const pendingModels = doc?.graph.nodes.filter(n => n.kind === 'generate' && !(n.status === 'success' && n.output)) || [];
  const plannedCredits = pendingModels.reduce((sum, n) => sum + creationPrice(n.config.engine || 'gemini-flash', n.config.quality || 'low'), 0);
  const statusText = running ? stopping ? '等待已提交步骤结束' : '工作流执行中' : saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : '已保存到云端';
  return <div className="wf-app">
    <input hidden ref={imported} type="file" accept="application/json,.json" onChange={e => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
    <input hidden ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={e => { void uploadImage(e.target.files?.[0]); e.target.value = ''; }} />
    <header className="wf-header"><a href="/" className="wf-brand" aria-label="CraftCanvas 首页"><LogoMark size={27} /><strong>CraftCanvas</strong></a><span className="wf-header-divider" /><a href="/workspace" className="wf-back"><ArrowLeft size={15} />创作画布</a><h1><GitBranch size={18} />节点工作流<span className="wf-beta">Beta</span></h1><a className="wf-account" href="/account">个人中心<ArrowUpRight size={15} /></a></header>
    {gate !== 'ready' ? <main className="wf-gate"><GitBranch size={34} /><h2>{gate === 'loading' ? '正在打开工作流…' : gate === 'signin' ? '把创作步骤连成自己的流程' : '暂时无法读取工作流'}</h2><p>{gate === 'error' ? error : '连接素材、提示词和模型，让一套创作方法可以反复使用。'}</p>{gate === 'signin' && <a className="btn-primary" href="/account?login=1&next=workflow">登录并打开工作流<ArrowUpRight size={16} /></a>}{gate === 'error' && <button className="btn-primary" onClick={() => window.location.reload()}>重试读取</button>}</main> : <>
      <div className="wf-toolbar"><div className="wf-document-picker"><Select label="选择工作流" value={doc?.id || ''} disabled={locked || saveState !== 'saved'} options={documents.length ? documents.map(d => ({ value: d.id, label: d.title })) : [{ value: '', label: '还没有保存的工作流' }]} onChange={id => void open(id)} /></div><button className="wf-button" disabled={locked || saveState !== 'saved'} onClick={() => setShowTemplates(v => !v)}><Plus size={16} />新建</button><button className="wf-button wf-optional" disabled={locked || saveState !== 'saved'} onClick={() => imported.current?.click()}><Upload size={16} />导入</button>{doc && <button className="wf-button wf-optional" onClick={exportJson}><Download size={16} />备份</button>}{doc && <button className="wf-button" aria-label="工作流设置" onClick={() => { setSelected(null); setSettingsOpen(true); }}><Settings2 size={16} /></button>}<span className={`wf-save ${saveState}`} role="status">{(running || saveState === 'saving') ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{doc ? statusText : '从一个模板开始'}</span>{doc && (running ? <button className="wf-button stop" disabled={stopping} onClick={() => { runController.current?.abort(); setStopping(true); }}><Square size={14} />停止后续步骤</button> : <button className="wf-run" disabled={busy || saveState !== 'saved' || !doc.graph.nodes.length} onClick={() => void run()}><Play size={15} fill="currentColor" />运行工作流</button>)}</div>
      {(error || saveError) && <div className="wf-alert" role="alert"><span>{saveError || error}</span>{saveError && !conflict && <button onClick={() => setEdit(v => v + 1)}>重试保存</button>}{doc && <button onClick={exportJson}>导出备份</button>}{conflict && doc && <button onClick={() => { exportJson(); void open(doc.id, true); }}>备份后读取云端</button>}{!saveError && <button aria-label="关闭提示" onClick={() => setError('')}><X size={16} /></button>}</div>}
      {notice && <div className="wf-notice" role="status"><span>{notice}</span><button aria-label="关闭运行通知" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {(!doc || showTemplates) ? <main className="wf-start"><p className="wf-eyebrow">YOUR CREATIVE PROCESS</p><h2>把好方法，连成工作流。</h2><p>从图片到提示词，再到模型与处理步骤。每一步都可调整，每个结果都能复用。</p><div className="wf-template-list">{WORKFLOW_TEMPLATES.map((template, i) => <button key={template.id} disabled={busy} className="wf-template" onClick={() => void create(template.title, workflowTemplate(template.id))}><div className={`wf-template-art art-${i}`}><span><Upload size={21} /></span><i /><span>{i === 2 ? <RefreshCw size={22} /> : <SparklesIcon />}</span><i /><span><Download size={21} /></span></div><span className="wf-template-count">{template.count}</span><h3>{template.title}</h3><p>{template.description}</p><span className="wf-template-link">使用这个模板 <ArrowUpRight size={17} /></span></button>)}</div><div className="wf-start-actions"><button className="wf-button" disabled={busy} onClick={() => void create('未命名工作流', { version: 1, nodes: [], edges: [] })}><Plus size={16} />从空白开始</button><button className="wf-button" disabled={busy} onClick={() => imported.current?.click()}><Upload size={16} />导入工作流 JSON</button>{doc && <button className="wf-button" onClick={() => setShowTemplates(false)}>返回当前工作流</button>}</div></main> : <div className="wf-editor">
        <aside className="wf-palette" aria-label="工作流节点库"><div className="wf-palette-title"><span>添加节点</span><small>点击或拖入画布</small></div>{(Object.keys(NODE_META) as WorkflowKind[]).map(kind => { const meta = NODE_META[kind]; const Icon = WORKFLOW_ICONS[kind]; return <button key={kind} disabled={locked} draggable={!locked} onDragStart={e => e.dataTransfer.setData('application/craftcanvas-node', kind)} onClick={() => addNode(kind)} className="wf-palette-item"><span className={`wf-icon ${meta.color}`}><Icon size={18} /></span><span><strong>{meta.label}</strong><small>{meta.detail}</small></span><Plus size={13} /></button>; })}<div className="wf-palette-note"><GitBranch size={18} /><p>点击节点右侧输出，再点击下游的同色输入，即可连接。</p><span>紫色 · 图片<br />橙色 · 提示词</span></div></aside>
        <WorkflowCanvas graph={doc.graph} selected={selected} onSelect={setSelected} onMove={(id, x, y) => patchNode(id, { x, y }, false)} onConnect={connect} onAdd={addNode} onRemoveEdge={id => { const edge = doc.graph.edges.find(e => e.id === id); if (edge) changed(invalidateNodes({ ...doc.graph, edges: doc.graph.edges.filter(e => e.id !== id) }, [edge.target])); }} disabled={locked} fitKey={fitKey} />
        <aside className={`wf-inspector ${selectedNode || settingsOpen ? 'has-selection' : ''}`} aria-label="节点设置"><div className="wf-inspector-heading"><h2>{selectedNode ? '节点设置' : '工作流设置'}</h2>{(selectedNode || settingsOpen) && <button aria-label="关闭节点设置" onClick={() => { setSelected(null); setSettingsOpen(false); }}><X size={17} /></button>}</div>
          {selectedNode ? <><div className="wf-selected-kind"><span className={`wf-icon ${NODE_META[selectedNode.kind].color}`}>{React.createElement(WORKFLOW_ICONS[selectedNode.kind], { size: 20 })}</span><div><strong>{NODE_META[selectedNode.kind].label}</strong><small>{NODE_META[selectedNode.kind].detail}</small></div></div><label className="wf-field">节点名称<input disabled={locked} value={selectedNode.label} maxLength={80} onChange={e => patchNode(selectedNode.id, { label: e.target.value }, false)} /></label>
            {selectedNode.kind === 'image' && <div className="wf-field"><span>产品图片</span><button className="wf-upload" disabled={locked} onClick={() => imageInput.current?.click()}>{selectedNode.config.image ? <img src={selectedNode.config.image} alt="输入图片预览" /> : <Upload size={26} />}<span>{selectedNode.config.image ? '更换图片' : '选择图片'}</span></button><small>PNG / JPEG / WebP / GIF / AVIF，最大 20 MB。</small></div>}
            {['prompt', 'generate'].includes(selectedNode.kind) && <label className="wf-field">{selectedNode.kind === 'prompt' ? '创作提示词' : '补充要求（可选）'}<textarea disabled={locked} rows={selectedNode.kind === 'prompt' ? 9 : 4} maxLength={32000} value={selectedNode.config.prompt || ''} placeholder="描述场景、光线与需要保留的商品特征…" onChange={e => patchNode(selectedNode.id, { config: { ...selectedNode.config, prompt: e.target.value } })} /><small>{selectedNode.kind === 'generate' ? '与连接的提示词合并后发送给模型。' : '可连接到多个生图节点，复用同一组要求。'}</small></label>}
            {selectedNode.kind === 'generate' && <><div className="wf-field"><span>生成模型</span><Select label="生成模型" disabled={locked} value={selectedNode.config.engine || 'gemini-flash'} options={Object.entries(ENGINES).map(([value, meta]) => ({ value, label: `${meta.label}${meta.available() ? '' : ' · 未开放'}` }))} onChange={engine => patchNode(selectedNode.id, { config: { ...selectedNode.config, engine: engine as EngineId } })} /></div>{selectedNode.config.engine?.startsWith('gpt-') && <div className="wf-field"><span>出图质量</span><Select label="出图质量" disabled={locked} value={selectedNode.config.quality || 'low'} options={[{ value: 'low', label: '低 · 快速探索' }, { value: 'medium', label: '中 · 平衡质量' }, { value: 'high', label: '高 · 精细交付' }]} onChange={quality => patchNode(selectedNode.id, { config: { ...selectedNode.config, quality: quality as 'low' | 'medium' | 'high' } })} /></div>}<Switch disabled={locked} checked={!!selectedNode.config.wide} label="横向画面" onChange={wide => patchNode(selectedNode.id, { config: { ...selectedNode.config, wide } })} /></>}
            {selectedNode.kind === 'transform' && <div className="wf-field"><span>处理方式</span><Select label="处理方式" disabled={locked} value={selectedNode.config.operation || 'rot90'} options={[{ value: 'rot90', label: '顺时针旋转 90°' }, { value: 'flipH', label: '水平翻转' }, { value: 'flipV', label: '垂直翻转' }]} onChange={operation => patchNode(selectedNode.id, { config: { ...selectedNode.config, operation: operation as 'rot90' | 'flipH' | 'flipV' } })} /></div>}
            {selectedNode.kind === 'cutout' && <p className="wf-help">适用于白底产品图。从边缘去除相连白色背景，保留产品内部高光；复杂背景请先用生图节点处理。</p>}
            {selectedNode.error && <p className="wf-node-error" role="alert">{selectedNode.error}</p>}
            {NODE_META[selectedNode.kind].output && <div className="wf-field"><span>连接到下游节点</span><Select label="连接到下游节点" disabled={locked} value="" options={[{ value: '', label: '选择目标节点…' }, ...doc.graph.nodes.filter(n => n.id !== selectedNode.id && NODE_META[n.kind].inputs.includes(NODE_META[selectedNode.kind].output!)).map(n => ({ value: n.id, label: n.label }))]} onChange={target => { if (target) connect(selectedNode.id, target, NODE_META[selectedNode.kind].output!); }} /></div>}
            <div className="wf-node-actions"><button className="wf-button" disabled={locked || saveState !== 'saved'} onClick={() => void run(selectedNode.id)}><Play size={14} />运行到此节点</button>{selectedNode.status === 'success' && <button className="wf-button" disabled={locked} onClick={() => { changed(invalidateNodes(doc.graph, [selectedNode.id])); setNotice('此节点与下游结果已重置，下次运行会重新执行；生图步骤将重新计入用量'); }}><RefreshCw size={14} />重置此节点与下游</button>}{selectedNode.output?.kind === 'image' && <button className="wf-button" onClick={() => downloadDataUrl(selectedNode.output!.value, `CraftCanvas_工作流_${Date.now()}.${selectedNode.output!.value.match(/^data:image\/(\w+)/)?.[1]?.replace('jpeg', 'jpg') || 'png'}`)}><Download size={14} />下载结果</button>}<button className="wf-button" disabled={locked || doc.graph.nodes.length >= 60} onClick={() => { const copy = { ...selectedNode, id: crypto.randomUUID(), label: selectedNode.label.slice(0, 72) + ' · 副本', x: selectedNode.x + 45, y: selectedNode.y + 300, status: 'idle' as const, output: undefined, error: undefined }; changed({ ...doc.graph, nodes: [...doc.graph.nodes, copy] }); setSelected(copy.id); }}><Copy size={14} />复制节点</button><button className="wf-button danger" disabled={locked} onClick={() => removeNode(selectedNode)}><Trash2 size={14} />移除节点与连线</button></div>
          </> : <><label className="wf-field">工作流名称<input disabled={locked} maxLength={80} value={doc.title} onChange={e => { const next = { ...doc, title: e.target.value }; docRef.current = next; setDoc(next); setEdit(v => v + 1); setSaveState('saving'); }} /></label><div className="wf-stats"><div><strong>{doc.graph.nodes.length}</strong><span>步骤</span></div><div><strong>{doc.graph.edges.length}</strong><span>连接</span></div><div><strong>{doc.graph.nodes.filter(n => n.status === 'success').length}</strong><span>已完成</span></div></div><p className="wf-help">选择节点调整内容，拖动节点安排流程。修改内容后，只会重置它和下游步骤；移动位置不会影响已有结果。</p><button className="wf-button" disabled={locked || saveState !== 'saved'} onClick={() => void create(doc.title.slice(0, 72) + ' · 副本', doc.graph)}><Copy size={15} />另存一份工作流</button><button className="wf-button" onClick={exportJson}><Download size={15} />导出完整备份</button></>}
          <div className="wf-run-info"><strong>{pendingModels.length ? `待执行 ${pendingModels.length} 个生图步骤` : '本次没有待执行的生图步骤'}</strong><p>{plannedCredits > 0 ? `按当前方案预计 ${plannedCredits} 积分，最终由服务端校验。` : '本地图片处理不消耗生图额度。模型请求按账号方案计入用量。'}</p><small>执行时请保持页面打开。停止后续步骤不会撤销已提交的模型请求；重试失败步骤可能再次产生用量。</small></div>
        </aside>
      </div>}
    </>}
  </div>;
}

function SparklesIcon() { const Icon = WORKFLOW_ICONS.generate; return <Icon size={22} />; }
