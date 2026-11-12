// 云端项目为主，IndexedDB 保留本地备份；图片独立存 R2，D1 定位项目快照。

import type { CanvasNodeData, GenRun, ChatMessage, ProductImage } from '../types';
import type { Annotation } from '../components/CanvasBoard';
import { setCloudKeys, setSessionPricing } from './keys';

const DB_NAME = 'craftcanvas';
const STORE = 'project';
let localKey = 'current';
const VERSION = 1;

export interface ProjectSnapshot {
  nodes: CanvasNodeData[];
  runs: GenRun[];
  messages: ChatMessage[];
  refImages: ProductImage[];
  nextY: number;
  assetsY: number;
  savedAt: number;
  view?: { x: number; y: number; k: number }; // 画布视图（缩放与平移）
  layersOpen?: boolean; // 打开中的面板（刷新恢复）
  canvasBg?: string; // 画布背景色（缺省=默认灰）
  annotations?: Annotation[]; // 画布标注层（形状/画笔/文字/引线，刷新恢复）
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveLocalProject(snapshot: ProjectSnapshot): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snapshot, localKey);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadLocalProject(): Promise<ProjectSnapshot | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(localKey);
      req.onsuccess = () => { db.close(); resolve((req.result as ProjectSnapshot) ?? null); };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

const uploadedAssets = new Map<string, string>();
const hydratedAssets = new Map<string, string>();
let saveQueue: Promise<void> = Promise.resolve();
let projectRevision: string | null = null;
let projectAccount = '';
let conflict = false;

export class ProjectConflictError extends Error {}

function cloudFetch(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 401) throw new Error('请登录 CraftCanvas 账号，读取或保存你的个人云端画板');
  if ([409, 412, 428].includes(response.status)) {
    conflict = true;
    throw new ProjectConflictError('云端版本或登录账号已改变，请先导出本地备份，再刷新读取最新画板');
  }
  if (response.status === 413) throw new Error('画板或图片过大，请导出备份后减少内容再保存');
  throw new Error('云端读取或保存失败，本地备份已保留，请稍后重试');
}

async function mapStrings(value: any, transform: (value: string) => Promise<string>): Promise<any> {
  const assets = new Set<string>();
  const collect = (item: any): void => {
    if (typeof item === 'string' && /^(data:image\/|\/api\/assets\/)/.test(item)) assets.add(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === 'object') Object.values(item).forEach(collect);
  };
  collect(value);
  const queue = [...assets];
  const mapped = new Map<string, string>();
  let next = 0;
  // 每张图片只处理一次，最多三个并发；失败时等待其余传输结束，避免污染下次保存。
  const results = await Promise.allSettled(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (next < queue.length) {
      const item = queue[next++];
      mapped.set(item, await transform(item));
    }
  }));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const replace = (item: any): any => {
    if (typeof item === 'string') return mapped.get(item) ?? item;
    if (Array.isArray(item)) return item.map(replace);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, replace(child)]));
    return item;
  };
  return replace(value);
}

async function uploadAsset(dataUrl: string): Promise<string> {
  if (!/^data:image\/(png|jpeg|webp|gif|avif);base64,/.test(dataUrl)) return dataUrl;
  const cached = uploadedAssets.get(dataUrl);
  if (cached) return cached;
  const blob = await (await fetch(dataUrl)).blob();
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const url = `/api/assets/${hash}`;
  await checked(await cloudFetch(url, { method: 'PUT', headers: { 'Content-Type': blob.type, 'X-Project-Account': projectAccount }, body: blob }));
  uploadedAssets.set(dataUrl, url);
  hydratedAssets.set(url, dataUrl);
  return url;
}

async function hydrateAsset(url: string): Promise<string> {
  if (!/^\/api\/assets\/[a-f0-9]{64}$/.test(url)) return url;
  const cached = hydratedAssets.get(url);
  if (cached) return cached;
  const blob = await (await checked(await cloudFetch(url, { headers: { 'X-Project-Account': projectAccount } }))).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  hydratedAssets.set(url, dataUrl);
  uploadedAssets.set(dataUrl, url);
  return dataUrl;
}

export function saveProject(snapshot: ProjectSnapshot): Promise<void> {
  const account = projectAccount;
  // 串行写入，避免慢请求在新请求之后覆盖画板。
  const operation = saveQueue.catch(() => {}).then(async () => {
    if (!account || account !== projectAccount || !projectRevision) throw new Error('请先读取云端画板再保存');
    try { await saveLocalProject(snapshot); } catch { /* 浏览器配额不足时仍保存云端 */ }
    if (conflict) throw new ProjectConflictError('云端版本或登录账号已改变，请先导出本地备份，再刷新读取最新画板');
    const cloudSnapshot = await mapStrings(snapshot, uploadAsset);
    const response = await checked(await cloudFetch('/api/project', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': projectRevision, 'X-Project-Account': account }, body: JSON.stringify(cloudSnapshot),
    }));
    projectRevision = response.headers.get('ETag');
    if (!projectRevision) throw new Error('保存确认不完整，请导出备份后刷新页面');
  });
  saveQueue = operation;
  return operation;
}

export async function loadProject(): Promise<ProjectSnapshot | null> {
  const session = await (await checked(await cloudFetch('/api/session', { cache: 'no-store' }))).json();
  if (!session.userId) throw new Error('请登录 CraftCanvas 账号，读取或保存你的个人云端画板；无需 ChatGPT 账号');
  setCloudKeys(session.providers);
  setSessionPricing(session);
  uploadedAssets.clear();
  hydratedAssets.clear();
  projectAccount = session.userId;
  projectRevision = null;
  conflict = false;
  localKey = `current:${session.userId}`;
  const response = await checked(await cloudFetch('/api/project', { cache: 'no-store', headers: { 'X-Project-Account': projectAccount } }));
  projectRevision = response.headers.get('ETag');
  if (!projectRevision) throw new Error('画板版本暂时不可用，请刷新后重试');
  const cloud = await response.json();
  if (cloud) {
    const snapshot = await mapStrings(cloud, hydrateAsset) as ProjectSnapshot;
    try { await saveLocalProject(snapshot); } catch { /* 云端已有权威副本 */ }
    return snapshot;
  }
  // 只在明确查到云端为空时迁移同域旧备份，网络错误不能被当作空画板。
  const local = await loadLocalProject();
  if (local) await saveProject(local);
  return local;
}
