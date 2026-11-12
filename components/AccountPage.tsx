import { SiteForm } from './ui/Controls';
import { useDialogFocus } from '../services/useDialogFocus';
import React, { useEffect, useState, useRef } from 'react';
import { Check, ChevronLeft, LogOut, ShieldCheck, Sparkles, X } from 'lucide-react';
import { LogoMark } from './Logo';
import { ProductHeader, ProductFooter } from './ProductShell';

interface AccountData {
  account: { id: string; display_name: string; email: string; username?: string; provider: string; plan: string; credits: number; created_at: number; status: string } | null;
  googleConfigured: boolean;
  paymentsEnabled: boolean;
  isAdmin?: boolean; creditBillingEnabled?: boolean; limits?: Record<string, number>; supportText?: string;
  usedToday?: number;
  dailyLimit?: number;
  activity?: { id: string; provider: string; model: string; status: string; charged_credits: number; created_at: number }[];
  project?: { saved_at: number; node_count: number }; libraryCount?: number;
  ledger?: { amount: number; reason: string; created_at: number }[];
}

const plans = [
  { id: 'free', name: 'Free', description: '开始探索你的创作工作流', monthly: 0, yearly: 0, features: ['每天 20 次模型请求', '个人云端画板', '图片上传与项目备份', 'PNG、ZIP 与可编辑导出'] },
  { id: 'pro', name: 'Pro', description: '为持续创作留出更多余量', monthly: 99, yearly: 79, features: ['计划每月 500 创作积分', '更充足的批量生成额度', '多角度与九图工作流', '个人云端画板与备份'] },
  { id: 'studio', name: 'Studio', description: '为高频商品图生产而设计', monthly: 299, yearly: 239, features: ['计划每月 2,000 创作积分', '更充足的批量生成额度', '多引擎与可编辑交付', '个人云端画板与备份'] },
];
const packs = [
  { credits: 100, price: 19, caption: '轻量补充' },
  { credits: 500, price: 79, caption: '持续创作' },
  { credits: 1500, price: 199, caption: '批量生产' },
];

export default function AccountPage() {
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'plans' | 'credits' | 'account' | 'activity'>(window.location.pathname.startsWith('/pricing') ? 'plans' : new URLSearchParams(window.location.search).get('tab') === 'credits' ? 'credits' : 'account');
  const [annual, setAnnual] = useState(false);
  const [pack, setPack] = useState(500);
  const [loginOpen, setLoginOpen] = useState(new URLSearchParams(window.location.search).has('login'));
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(loginOpen, dialogRef);
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginName, setLoginName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(() => {
    const result = new URLSearchParams(window.location.search).get('login');
    return result === 'signup-closed' ? '新账号注册暂时关闭，请使用已有账号登录。' : result === 'failed' ? 'Google 登录未完成，请重新尝试。' : result === 'unconfigured' ? 'Google 登录正在等待配置，请先使用邮箱登录。' : '';
  });
  const user = data?.account;

  const load = async () => {
    setError('');
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      if (!response.ok) throw new Error('账号信息暂时无法读取');
      const accountData = await response.json();
      setData(accountData);
      setName(accountData.account?.display_name || '');
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败，请重试'); }
  };
  useEffect(() => { document.title = window.location.pathname.startsWith('/pricing') ? '会员计划 · CraftCanvas' : '个人中心 · CraftCanvas'; void load(); }, []);
  useEffect(() => {
    if (!loginOpen) return;
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') setLoginOpen(false); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [loginOpen]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) });
      if (!response.ok) throw new Error('名称保存失败，请检查输入后重试');
      setData(await response.json()); setNotice('账号名称已保存');
    } catch (e) { setNotice(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const signout = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/signout', { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请重试');
      const result = await response.json();
      window.location.assign(result.signoutUrl);
    } catch (e) { setNotice(e instanceof Error ? e.message : '退出失败'); setBusy(false); }
  };
  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault(); setLoginError('');
    if (loginMode === 'register' && loginPassword !== confirmPassword) {
      setLoginError('两次输入的密码不一致'); return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${loginMode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, identifier: loginEmail, password: loginPassword, displayName: loginName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || '暂时无法登录，请重试');
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next'); const destination = next === 'admin' ? '/admin' : next === 'library' ? '/library' : next === 'workflow' ? '/workflow' : '/workspace';
      const resume = new URLSearchParams((params.get('resume') || '').slice(0, 500)); const allowed = new URLSearchParams();
      for (const key of ['template', 'asset']) if (resume.get(key)) allowed.set(key, resume.get(key)!);
      window.location.assign(destination + (destination === '/workspace' && allowed.size ? `?${allowed}` : ''));
    } catch (e) { setLoginError(e instanceof Error ? e.message : '暂时无法登录，请重试'); setBusy(false); }
  };
  const selectedPack = packs.find(item => item.credits === pack)!;

  return (
    <div className="min-h-screen bg-white text-ink-900">
      <ProductHeader active={window.location.pathname.startsWith('/pricing') ? '/pricing' : ''} />
      <main id="main-content" className="mx-auto max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
          <div><p className="mb-2 text-sm font-semibold text-accent-700">CraftCanvas 个人中心</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{tab === 'plans' ? '选择适合你的创作计划' : tab === 'credits' ? '为下一次创作补充积分' : tab === 'activity' ? '你的创作记录' : user ? `你好，${user.display_name}` : '你的个人创作空间'}</h1></div>
          {user && <span className="rounded-full border border-ink-200 px-3 py-1.5 text-sm">当前计划：{plans.find(plan => plan.id === user.plan)?.name || user.plan}</span>}
        </div>
        <div role="tablist" aria-label="个人中心" className="mb-8 flex flex-wrap gap-6 border-b border-ink-200">
          {([['plans', '订阅方案'], ['credits', '积分充值'], ['account', '个人资料'], ['activity', '使用记录']] as const).map(([id, label]) =>
            <button key={id} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} id={`tab-${id}`} onClick={() => { setTab(id); setNotice(''); }}
              className={`border-b-2 pb-3 text-sm font-semibold transition-colors ${tab === id ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>{label}</button>)}
        </div>
        {error && <div role="alert" className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error} <button onClick={() => void load()} className="ml-3 underline">重试</button></div>}
        {notice && <p role="status" className="mb-6 rounded-xl bg-ink-100 p-4 text-sm">{notice}</p>}

        {tab === 'plans' && <section role="tabpanel" id="panel-plans" aria-labelledby="tab-plans">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-ink-500">所有计划都围绕你的商品图创作流程。</p>
            <div className="flex rounded-full bg-ink-100 p-1" aria-label="计费周期">
              <button onClick={() => setAnnual(false)} aria-pressed={!annual} className={`rounded-full px-4 py-2 text-sm ${!annual ? 'bg-white font-semibold shadow-sm' : 'text-ink-500'}`}>月付</button>
              <button onClick={() => setAnnual(true)} aria-pressed={annual} className={`rounded-full px-4 py-2 text-sm ${annual ? 'bg-white font-semibold shadow-sm' : 'text-ink-500'}`}>年付 <span className="ml-1 text-accent-700">约省 20%</span></button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map(plan => <article key={plan.id} className={`relative flex flex-col rounded-2xl border p-7 ${plan.id === 'pro' ? 'border-accent-600 bg-accent-50/40' : 'border-ink-200 bg-white'}`}>
              {plan.id === 'pro' && <span className="absolute right-5 top-5 flex items-center gap-1 text-xs font-semibold text-accent-700"><Sparkles size={14} />推荐方案</span>}
              <h2 className="mb-2 text-2xl font-semibold">{plan.name}</h2><p className="mb-7 text-sm text-ink-500">{plan.description}</p>
              <div className="mb-1 flex items-baseline gap-1"><span className="text-4xl font-semibold tracking-tight">¥{annual ? plan.yearly : plan.monthly}</span><span className="text-sm text-ink-500">/ 月</span></div>
              <p className="mb-6 min-h-5 text-xs text-ink-500">{plan.id === 'free' ? '免费使用，无需付款' : annual ? `参考价 ¥${plan.yearly * 12} / 年，按年支付` : '参考价格，按月订阅'}</p>
              <button onClick={() => user ? window.location.assign('/workspace') : setLoginOpen(true)} disabled={plan.id !== 'free'}
                className={`mb-7 w-full rounded-full px-4 py-3 text-sm font-semibold ${plan.id === 'free' ? 'border border-ink-300 hover:bg-ink-100' : 'cursor-not-allowed bg-ink-200 text-ink-500'}`}>{plan.id === 'free' ? user ? '进入创作工作台' : '免费开始' : '订阅即将开放'}</button>
              <ul className="space-y-4 text-sm">{plan.features.map((feature, index) => <li key={feature} className="flex items-start gap-2.5"><Check size={16} className="mt-0.5 shrink-0" /><span>{index === 0 && plan.id === 'free' ? `每天 ${data?.limits?.free ?? 20} 次模型请求` : feature}</span></li>)}</ul>
              {plan.id !== 'free' && <p className="mt-7 text-xs leading-relaxed text-ink-500">付费权益为方案预览，尚未启用。</p>}
            </article>)}
          </div>
          <p className="mt-6 text-center text-sm text-ink-500">付费方案的金额和权益待确认。当前不会扣费或自动续订。全站模型请求另有每日总量限制。</p>
        </section>}

        {tab === 'credits' && <section role="tabpanel" id="panel-credits" aria-labelledby="tab-credits" className="grid gap-10 lg:grid-cols-[1fr_320px]">
          <div><p className="mb-6 text-sm leading-relaxed text-ink-500">积分充值独立于订阅计划。以下为套餐预览，充值服务暂未开放。</p>
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="积分套餐">{packs.map(item => <button key={item.credits} role="radio" aria-checked={pack === item.credits} onClick={() => setPack(item.credits)} className={`rounded-2xl border p-6 text-left transition-colors ${pack === item.credits ? 'border-accent-600 bg-accent-50' : 'border-ink-200 hover:border-ink-400'}`}>
              <div className="mb-4 text-sm text-ink-500">{item.caption}</div><div className="text-3xl font-semibold">{item.credits.toLocaleString()}</div><div className="mb-6 mt-1 text-sm text-ink-500">创作积分</div><div className="font-semibold">¥{item.price}<span className="ml-1 text-xs font-normal text-ink-500">参考价</span></div>
            </button>)}</div>
            <h2 className="mb-3 mt-10 text-lg font-semibold">积分流水</h2>
            {(data?.ledger?.length || 0) > 0 ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-ink-200"><th className="py-3">时间</th><th>事项</th><th>积分</th></tr></thead><tbody>{data!.ledger!.map((entry, index) => <tr key={index} className="border-b border-ink-100"><td className="py-3">{new Date(entry.created_at).toLocaleDateString('zh-CN')}</td><td>{entry.reason}</td><td>{entry.amount}</td></tr>)}</tbody></table></div> : <div className="border-t border-ink-200 py-8 text-sm text-ink-500">{user ? '还没有积分变动。' : '登录后查看你的积分余额和记录。'}</div>}
          </div>
          <aside className="h-fit rounded-2xl bg-ink-100 p-7"><h2 className="mb-6 text-lg font-semibold">充值预览</h2>
            <dl className="space-y-4 text-sm"><div className="flex justify-between"><dt className="text-ink-500">当前余额</dt><dd>{user ? user.credits : '—'} 积分</dd></div><div className="flex justify-between"><dt className="text-ink-500">本次积分</dt><dd>{selectedPack.credits} 积分</dd></div><div className="flex justify-between border-t border-ink-200 pt-4"><dt>参考金额</dt><dd className="text-xl font-semibold">¥{selectedPack.price}</dd></div></dl>
            <button disabled className="mt-7 w-full cursor-not-allowed rounded-full bg-ink-200 py-3 text-sm font-semibold text-ink-500">充值暂未开放</button><p className="mt-4 text-xs leading-relaxed text-ink-500">不会创建支付订单，也不会增加余额。正式开放时，到账以后才记入积分。</p>
          </aside>
        </section>}

        {tab === 'account' && <section role="tabpanel" id="panel-account" aria-labelledby="tab-account" className="max-w-4xl">
          {!data && !error ? <p className="py-10 text-sm text-ink-500">正在读取账号…</p> : !user ? <div className="py-10"><h2 className="mb-3 text-xl font-semibold">让作品跟着你的账号走</h2><p className="mb-6 text-sm text-ink-500">登录后保存个人画板，查看模型用量与会员状态。</p><button onClick={() => setLoginOpen(true)} className="rounded-full bg-ink-900 px-6 py-3 text-sm font-semibold text-white">登录 / 创建账号</button></div> : <>
            <div className="account-summary"><a href="/workspace"><span>今日剩余请求</span><strong>{Math.max(0, (data?.dailyLimit ?? 20) - (data?.usedToday || 0))}<small> / {data?.dailyLimit ?? 20}</small></strong><p>进入创作工作台 ↗</p></a><a href="/library"><span>个人素材</span><strong>{data?.libraryCount || 0}<small> 张</small></strong><p>管理云端资料库 ↗</p></a><a href="/workspace"><span>云端画板</span><strong>{data?.project?.node_count || 0}<small> 个节点</small></strong><p>{data?.project ? `最近保存 ${new Date(data.project.saved_at).toLocaleDateString('zh-CN')}` : '还没有保存的画板'}</p></a></div>
            <div className="mb-8 flex items-center gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-100 text-xl font-semibold text-accent-800">{user.display_name.slice(0, 1).toUpperCase()}</div><div><h2 className="text-xl font-semibold">{user.display_name}</h2><p className="mt-1 break-all text-sm text-ink-500">{user.email || user.username}</p></div></div>
            <SiteForm onSubmit={saveName} className="mb-8 flex flex-wrap items-end gap-3"><label className="flex-1 text-sm font-semibold">显示名称<input value={name} maxLength={60} onChange={event => setName(event.target.value)} required className="ui-field" /></label><button disabled={busy} className="ui-button ui-button-secondary">{busy ? '处理中…' : '保存'}</button></SiteForm>
            <dl className="space-y-5 border-t border-ink-200 pt-6 text-sm"><div className="flex justify-between"><dt className="text-ink-500">登录方式</dt><dd>{user.provider === 'google' ? 'Google' : user.provider === 'email' ? '邮箱与密码' : user.provider === 'username' ? '用户名与密码' : 'ChatGPT（原有账号）'}</dd></div><div className="flex justify-between"><dt className="text-ink-500">会员计划</dt><dd>{plans.find(plan => plan.id === user.plan)?.name || user.plan}</dd></div><div className="flex justify-between"><dt className="text-ink-500">积分余额</dt><dd>{user.credits} 积分</dd></div><div className="flex justify-between"><dt className="text-ink-500">今日模型请求</dt><dd>{data?.usedToday || 0} / {data?.dailyLimit ?? 20}</dd></div></dl>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink-100"><div className="h-full bg-accent-600" style={{ width: `${Math.min(100, ((data?.usedToday || 0) / Math.max(1, data?.dailyLimit ?? 20)) * 100)}%` }} /></div><p className="mt-2 text-xs text-ink-500">每日北京时间 00:00 重置；失败的模型请求也占用次数。</p>
            {user.status === 'suspended' && <p role="alert" className="mt-4 text-sm text-red-600">此账号已停用，请联系网站管理员。</p>}
            <p className="mt-3 text-xs text-ink-500">{data?.creditBillingEnabled ? '创作按积分计费，失败请求退回积分。' : '当前按每日额度使用，创作不扣积分。'}</p>
            <p className="mt-3 text-xs text-ink-500">{data?.supportText}</p>
            {['email', 'username'].includes(user.provider) && <details className="password-settings"><summary>账号安全 · 修改密码</summary><p>修改后会退出其他设备的登录。新密码至少 8 个字符，包含大小写字母和数字。</p><SiteForm onSubmit={async e => { e.preventDefault(); setPasswordNotice(''); if (newPassword !== passwordConfirm) { setPasswordNotice('两次新密码不一致'); return; } setPasswordBusy(true); try { const r = await fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) }); const value = await r.json(); if (!r.ok) throw new Error(value.error?.message || '修改失败'); setCurrentPassword(''); setNewPassword(''); setPasswordConfirm(''); setPasswordNotice('密码已更新，其他设备已退出登录'); } catch (err) { setPasswordNotice((err as Error).message); } finally { setPasswordBusy(false); } }}><label>当前密码<input aria-label="当前密码" type="password" required autoComplete="current-password" maxLength={128} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label>新密码<input aria-label="新密码" type="password" required autoComplete="new-password" minLength={8} maxLength={128} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,128}" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><label>确认新密码<input aria-label="确认新密码" type="password" required autoComplete="new-password" minLength={8} maxLength={128} value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} /></label><button className="btn-secondary" disabled={passwordBusy}>{passwordBusy ? '正在更新…' : '更新密码'}</button></SiteForm>{passwordNotice && <p role="status">{passwordNotice}</p>}</details>}
            <button onClick={() => void signout()} disabled={busy} className="mt-9 flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900"><LogOut size={16} />退出登录</button>
          </>}
        </section>}
        {tab === 'activity' && <section role="tabpanel" id="panel-activity" aria-labelledby="tab-activity">{!user ? <div className="library-empty"><h2>登录后查看你的创作记录</h2><p>了解每次请求的状态与积分使用情况。</p><button className="btn-primary" onClick={() => setLoginOpen(true)}>登录账号</button></div> : <><p className="mb-5 text-sm text-ink-500">最近 20 次模型请求。失败仍占日次数；积分计费启用时，失败请求退回已扣积分。</p><div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead><tr className="border-b border-ink-200">{['时间', '模型', '状态', '使用积分'].map(h => <th className="px-3 py-4" key={h}>{h}</th>)}</tr></thead><tbody>{data?.activity?.map(row => <tr className="border-b border-ink-100" key={row.id}><td className="px-3 py-4">{row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '历史请求'}</td><td className="px-3 py-4">{row.model}</td><td className="px-3 py-4">{{ succeeded: '已完成', failed: '失败', pending: '处理中', legacy: '历史记录' }[row.status] || row.status}</td><td className="px-3 py-4">{row.charged_credits}{row.status === 'failed' && row.charged_credits > 0 ? '（已退回）' : ''}</td></tr>)}</tbody></table></div>{!data?.activity?.length && <div className="library-empty"><h2>你的第一件作品，还在前方。</h2><p>开始创作后，这里会显示使用记录。</p><a href="/workspace" className="btn-primary">开始创作</a></div>}</>}</section>}
      </main>
      <ProductFooter />

      {loginOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 p-5" onClick={() => setLoginOpen(false)}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="login-title" className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-7 shadow-xl sm:p-8" onClick={event => event.stopPropagation()}>
          <button aria-label="关闭登录" onClick={() => setLoginOpen(false)} className="absolute right-5 top-5 rounded-full p-2 text-ink-500 hover:bg-ink-100"><X size={18} /></button>
          <LogoMark size={40} /><h2 id="login-title" className="mb-2 mt-5 text-2xl font-semibold">{loginMode === 'register' ? '创建 CraftCanvas 账号' : '登录 CraftCanvas'}</h2><p className="mb-5 text-sm leading-relaxed text-ink-500">使用 CraftCanvas 账号继续创作。</p>
          <SiteForm onSubmit={submitLogin} className="space-y-4">
            {loginMode === 'register' && <label className="block text-sm font-medium">显示名称<input required value={loginName} maxLength={60} autoComplete="nickname" onChange={event => setLoginName(event.target.value)} className="ui-field" /></label>}
            <label className="block text-sm font-medium">{loginMode === 'register' ? '邮箱' : '邮箱或用户名'}<input type={loginMode === 'register' ? 'email' : 'text'} required autoComplete="username" maxLength={254} value={loginEmail} onChange={event => setLoginEmail(event.target.value)} className="ui-field" /></label>
            <label className="block text-sm font-medium">密码<input aria-label="密码" type="password" required minLength={8} pattern={loginMode === 'register' ? '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,128}' : undefined} maxLength={128} autoComplete={loginMode === 'register' ? 'new-password' : 'current-password'} value={loginPassword} onChange={event => setLoginPassword(event.target.value)} className="ui-field" />{loginMode === 'register' && <span className="mt-1.5 block text-xs font-normal text-ink-500">至少 8 个字符，包含大写字母、小写字母和数字。</span>}</label>
            {loginMode === 'register' && <label className="block text-sm font-medium">确认密码<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="ui-field" /></label>}
            {loginError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loginError}</p>}
            <button disabled={busy} className="ui-button w-full">{busy ? '正在处理…' : loginMode === 'register' ? '创建账号并进入工作台' : '登录并进入工作台'}</button>
          </SiteForm>
          <p className="my-4 text-center text-sm text-ink-500">{loginMode === 'login' ? '还没有账号？' : '已经有账号？'}<button disabled={busy} onClick={() => { setLoginMode(loginMode === 'login' ? 'register' : 'login'); setLoginError(''); }} className="ml-2 font-semibold text-ink-900 underline underline-offset-4">{loginMode === 'login' ? '免费注册' : '立即登录'}</button></p>
          {data?.googleConfigured ? <a href="/auth/google" target="_top" className="ui-button ui-button-secondary w-full">使用 Google 继续</a> : <button disabled className="ui-button ui-button-secondary w-full">Google 登录 · 等待配置</button>}
          <p className="mt-3 text-xs leading-relaxed text-ink-500">Google 登录配置完成后开放。当前尚未提供邮箱验证与密码找回，请妥善保存密码。</p>
          <p className="mt-5 flex items-center gap-2 border-t border-ink-100 pt-4 text-xs text-ink-500"><ShieldCheck size={15} />你的画板和素材仅对当前账号可见。</p>
        </div>
      </div>}
    </div>
  );
}
