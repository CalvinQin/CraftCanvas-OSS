export const PROJECT = {
  name: 'CraftCanvas', version: '0.7.1', updated: '2026-11-13',
  repository: 'https://github.com/CalvinQin/CraftCanvas-OSS',
  description: '开源 AI 商品图创作工作台：无限画布、可视化节点工作流、参考图生图与可编辑交付。',
};
export const PUBLIC_PAGES: Record<string, { title: string; description: string; section?: string }> = {
  '/': { title: 'CraftCanvas｜开源 AI 商品图与可视化工作流', description: PROJECT.description },
  '/docs': { title: '项目文档与功能边界｜CraftCanvas', description: '了解 CraftCanvas 的无限画布、六类工作流节点、账号隔离、图片交付和自托管架构。' },
  '/docs/workflows': { title: '可视化节点工作流指南｜CraftCanvas', description: '连接图片、提示词与模型，创建可复用的商品图流程。了解分支执行、结果缓存、失败重试与 JSON 备份。', section: '工作流' },
  '/docs/self-hosting': { title: '自托管部署与本地开发指南｜CraftCanvas', description: '使用 React、Cloudflare Workers、D1 与 R2 运行 CraftCanvas。配置服务端模型密钥与管理员，保留自己的数据。', section: '自托管' },
  '/help': { title: 'AI 商品图创作使用指南｜CraftCanvas', description: '从准备参考图、编写提示词，到画布编辑、节点工作流与图片导出，逐步完成商品视觉创作。' },
  '/pricing': { title: '开源许可、模型用量与费用｜CraftCanvas', description: 'CraftCanvas 源码采用 MIT 许可。模型 API 与托管可能产生费用，站点会员与充值尚未开放真实收款。' },
  '/privacy': { title: '隐私说明与数据处理｜CraftCanvas', description: '了解账号、私人素材、模型供应商请求、使用记录和浏览器本地备份的数据处理方式。' },
  '/terms': { title: '使用条款与服务范围｜CraftCanvas', description: '了解 CraftCanvas 的服务范围、素材使用、AI 输出核对要求、额度与服务可用性。' },
};
export const FAQ = [
  ['CraftCanvas 是什么？', 'CraftCanvas 是面向商品视觉创作的开源 Web 应用。它把产品参考图、自然语言图像生成、无限画布、可视化节点工作流与导出放在同一工作台。'],
  ['开源是否意味着模型和托管都免费？', '不是。项目源码采用 MIT 许可证；模型 API、Cloudflare 或其他托管服务可能按各自规则收费。本站会员和充值目前只作预览，不接收真实付款。'],
  ['支持哪些工作流节点？', '支持图片输入、提示词、模型生图、白底去背景、旋转与翻转、图片输出六类节点。可以连接多个分支，复用未修改步骤的成功结果。'],
  ['关闭页面后，工作流会继续执行吗？', '当前工作流由浏览器调度，执行时需要保持页面打开。停止只阻止后续步骤，已经提交的模型请求不会被撤销；手动重试可能再次计入用量。'],
  ['如何登录，谁能进入后台？', 'Sites 托管版本支持平台提供的 ChatGPT 登录身份；应用也支持邮箱密码登录，Google 登录需要部署者另行配置。管理员由服务端精确账号名单授权，普通登录不会自动获得后台权限。'],
  ['图片会发送给谁？', '私人素材与画板按账号隔离。发起模型生成或分析时，相关图片与提示词会发给所选模型供应商。旋转、翻转和白底去背景在浏览器本地处理。'],
  ['没有模型密钥可以体验吗？', '可以使用上传、画布编辑、旋转、翻转、白底去背景和本地交付功能。AI 生图需要部署者配置有效的服务端密钥，模型可用性以实际账号和供应商为准。'],
];
export const DOCS: Record<string, { eyebrow: string; heading: string; intro: string; sections: { id: string; title: string; text: string[]; code?: string }[] }> = {
  '/docs': { eyebrow: 'OPEN SOURCE / DOCUMENTATION', heading: '把创作方法，也交给你。', intro: 'CraftCanvas 是可自托管的商品视觉工作台。源码、使用方法与功能边界都在这里，方便你从一张参考图开始，也方便你继续构建。', sections: [
    { id: 'overview', title: '项目概览', text: ['CraftCanvas 适合电商商品图、品牌场景探索和多版本视觉迭代。它提供无限画布、可视化节点工作流、个人素材库与图片导出。项目由 Calvin Qin 维护，源码使用 MIT 许可证。', 'React 与 TypeScript 构建交互界面，Cloudflare Worker 承载应用接口，D1 保存账号和元数据，R2 保存按账号隔离的图片与不可变快照。'] },
    { id: 'capabilities', title: '已经实现的能力', text: ['画布支持平移缩放、图片组织、批注与多版本比较。节点工作流支持六类节点、输入类型校验、循环检查、分支调度、失败恢复与完整 JSON 导入导出。', '云端保存采用版本校验防止多个页面覆盖，重复图片按内容散列去重。生成请求通过服务端代理，模型密钥不进入浏览器。'] },
    { id: 'limits', title: '开始前要知道的边界', text: ['节点工作流需要保持页面打开，不是后台任务队列。工作流未保存的改动不能保证关闭浏览器后恢复，请查看保存状态或导出备份。', 'AI 生成可能改变文字、产品结构或细节，商业发布前需自行核对。模型开放情况与出图质量需要用部署者自己的供应商账号验证。', '会员与充值为预览；邮箱验证、自助密码找回、账号合并、后台任务队列和自动清理历史快照尚未实现。'] },
    { id: 'contribute', title: '参与项目', text: ['可以通过 GitHub Issues 提交可复现的问题或功能建议，也欢迎通过 Pull Request 改进代码和文档。贡献前请阅读贡献指南和安全说明，截图与日志中不要包含密钥或私人素材。'] },
  ] },
  '/docs/workflows': { eyebrow: 'GUIDE / VISUAL WORKFLOWS', heading: '把每一步，连接起来。', intro: '从产品图、提示词到模型与处理步骤，搭建一套能保存、复用和继续修改的创作流程。', sections: [
    { id: 'start', title: '1. 选择模板，准备输入', text: ['在「节点工作流」中选择商品场景、三种场景并行或图片处理与交付模板，也可以从空白开始。先用本地图片处理模板体验完整流程，无需模型密钥。', '点击图片节点上传产品参考图。支持 PNG、JPEG、WebP、GIF、AVIF，单张最大 20 MB；像素超过 4000 万的输入图需要先缩小。'] },
    { id: 'connect', title: '2. 连接相同类型的端口', text: ['点击节点右侧输出，再点击下游同类型输入；也可以在属性面板选择下游节点。紫色端口传递图片，橙色端口传递提示词。', '最多 60 个节点和 120 条连线。生图节点最多连接 16 张参考图，其余处理节点接受一张图片。循环连接、重复连接与不匹配端口会被拒绝。'] },
    { id: 'run', title: '3. 执行、观察与复用', text: ['运行整个工作流，或只运行到选中的节点。依赖完成后才开始下游，最多两步并行；没有修改的成功步骤会复用结果。', '修改内容会重置该节点及后代结果，改名称或拖动位置不会重置。某一步失败只阻塞依赖它的分支，修复后可以手动继续。'] },
    { id: 'cost', title: '4. 了解停止和重试的用量', text: ['执行时保持页面打开。停止只阻止新的步骤开始，已提交的模型请求仍可能完成并产生用量；超时不等于供应商未处理请求。', '工作流不自动重试额度错误。重试前请确认账户用量；旋转、翻转和白底去背景不发起模型请求。'] },
    { id: 'save', title: '5. 保存、备份与交付', text: ['每个账号最多保存 30 条工作流。等待状态显示「已保存到云端」再关闭页面。保存冲突时，先导出当前 JSON，再读取云端新版本。', '完整 JSON 包含节点配置、连线、输入图片和成功结果。可重新导入继续编辑，或下载输出节点的图片；不要公开包含私人素材的备份。'] },
  ] },
  '/docs/self-hosting': { eyebrow: 'GUIDE / SELF HOSTING', heading: '在自己的环境中运行。', intro: '从一个干净的本地环境开始。图片处理可先行体验，AI 生成在服务端配置有效密钥后开放。', sections: [
    { id: 'requirements', title: '运行要求', text: ['使用 Node.js 22.13 或更高版本、npm，以及本地 Cloudflare Wrangler 运行时。推荐 Node.js 24。生产环境需要 Cloudflare Workers、D1 与 R2，或支持这些绑定的 Sites 托管。', '克隆仓库后运行 npm ci。将 .dev.vars.example 复制为 .dev.vars，生成独立的加密主密钥；真实配置文件已加入忽略规则，不能提交。'], code: 'npm ci\ncp .dev.vars.example .dev.vars\nnpm run build\nnpm run db:local\nnpm run dev:api\n# 另一个终端\nnpm run dev' },
    { id: 'secrets', title: '服务端密钥与管理员', text: ['SETTINGS_ENCRYPTION_KEY 用来保护后台保存的敏感配置，必须由部署者单独生成并妥善保存。GEMINI_API_KEY 和 OPENAI_API_KEY 仅在服务端配置；不要创建 VITE_ 前缀的模型密钥。', '自托管默认不信任外部请求中的 ChatGPT 身份头。仅在 Sites 受保护入口后设置 TRUST_SITES_IDENTITY=true；直接部署到 Workers 时保持关闭。', '登录并在自己的部署中取得当前账号 ID 后，将精确 ID 配入 ADMIN_ACCOUNT_IDS。Sites 环境变量变更需要重新部署才能生效；不要将管理员权限按邮箱后缀或注册顺序自动授予。'] },
    { id: 'storage', title: '数据库与素材存储', text: ['本地执行 db:local 应用已提交的追加式迁移。只有修改 schema 时才需要 db:generate；不要在每次安装时生成迁移，也不要改写已经发布的旧迁移。', 'D1 绑定名为 DB，R2 绑定名为 BUCKET。生产部署前创建自己的资源并更新部署配置；开源仓库不包含运营实例的数据、账号、密钥或 Sites 项目身份。'] },
    { id: 'origin', title: '公开域名与搜索信息', text: ['构建时设置 CRAFTCANVAS_PUBLIC_SITE_URL 为自己的 HTTPS 正式域名，用于 canonical、Open Graph 与 sitemap；不配置时，本地开发使用 localhost 并输出 noindex。', '产品文档预渲染成 HTML 和 Markdown，登录页面与私人工作区保持 noindex。公开站点仍须依靠服务端授权保护素材，robots.txt 不能替代权限控制。'] },
    { id: 'checks', title: '发布前验证', text: ['运行类型检查、自动测试与生产构建，再核对公开页面和登录后的操作。测试默认使用替身模型，不会消耗供应商额度。', '将模型与托管成本、邮件找回缺失、浏览器工作流运行限制和备份策略告知部署用户。首次部署仅面向受控用户验证，再决定是否开放访问。'], code: 'npm run check\nnpm test\nnpm run build\nnpm run verify:seo' },
  ] },
};
