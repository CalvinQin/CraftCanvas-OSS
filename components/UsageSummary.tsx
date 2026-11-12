import React, { useEffect, useState } from 'react';
export default function UsageSummary({ refresh }: { refresh: boolean }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (refresh) return;
    const controller = new AbortController();
    const load = () => fetch('/api/account', { cache: 'no-store', signal: controller.signal }).then(r => r.ok ? r.json() : null).then(setData).catch(() => {});
    void load(); window.addEventListener('focus', load);
    return () => { controller.abort(); window.removeEventListener('focus', load); };
  }, [refresh]);
  if (!data?.account) return null;
  return <a href="/account" className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-5 py-2.5 text-[11px] text-ink-500 hover:bg-accent-50">
    <span className="font-semibold text-ink-700">{data.account.plan === 'studio' ? 'Studio' : data.account.plan === 'pro' ? 'Pro' : 'Free'} 会员</span>
    <span>今日剩余 {Math.max(0, data.dailyLimit - data.usedToday)} / {data.dailyLimit} 次{data.creditBillingEnabled ? ` · ${data.account.credits} 积分` : ''}</span>
  </a>;
}
