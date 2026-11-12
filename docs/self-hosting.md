# 自托管指南

## 本地运行

需要 Node.js ≥22.13（推荐 24）。执行 README 的安装步骤。`.dev.vars` 是 Wrangler 读取的本地服务端配置；不要复制旧实例的文件。

生成独立的 `SETTINGS_ENCRYPTION_KEY`（`openssl rand -base64 32`），手动填入 `.dev.vars`。模型密钥可暂时留空。`npm run db:local` 应用已有迁移，`npm run dev:api` 使用 8787 端口，`npm run dev` 使用 3000 并代理 API。

首次在 `/account` 注册本地账号。通过自己的 `/api/account` 响应查看 `account.id`，把精确 ID 加入 `ADMIN_ACCOUNT_IDS`，重启 Worker。账号创建不会自动授权管理员。不要把账号 ID 或真实响应贴到公共 Issue。

## 部署到自己的 Cloudflare

1. 使用自己的 Cloudflare 账号创建 D1 和 R2 资源。
2. 更新 `wrangler.jsonc` 的 `name`、数据库名/ID、桶名；保持绑定名 `DB` 和 `BUCKET`。
3. 为 Worker 配置独立加密主密钥、模型密钥和精确管理员名单。`TRUST_SITES_IDENTITY` 保持 false。
4. 使用自己的 D1 数据库名执行 `npx wrangler d1 migrations apply <database-name> --remote`。发布迁移前备份既有数据；不要修改已应用的迁移。
5. 设置正式域名并构建、验证、部署：

```sh
CRAFTCANVAS_PUBLIC_SITE_URL=https://your-domain.example npm run build
npm run verify:seo
npx wrangler deploy
```

公开 URL 是构建时环境变量，需要在运行构建的 shell/CI 中设置；不是运行时密钥。不要只修改 `.env` 后假设生成器会读取它。未设置时构建输出 noindex。

## 部署到自己的 Sites

使用 Sites 创建自己的项目、数据库和对象存储。开源的 `.openai/hosting.json` 仅声明 D1/R2 绑定，不包含任何运营实例的项目 ID。部署时由 Sites 把自己的 project_id 写入独立部署副本。

在 Sites 的可信入口后，设置 `TRUST_SITES_IDENTITY=true` 以接受平台提供的 ChatGPT 身份。不要在直接暴露的 Worker 上开启这个选项；入口必须可信地覆盖外部身份头并阻止绕过。

设置 `SITE_ORIGIN`、独立加密主密钥和需要的服务端模型密钥。管理员使用精确账号 ID；环境变量更新后重新部署。使用 Sites 源码与构建发布流程，发布 `dist/` 中的前端、Worker 和迁移。

## 可选 Google 登录

配置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 与准确的 `SITE_ORIGIN`，回调地址是 `<origin>/auth/google/callback`。邮箱和 Google 是不同身份，不会按邮箱自动合并账号。

## 上线边界

- 源码公开与站点公开是不同操作。私有站点不会被搜索引擎正常读取。
- `robots.txt`、noindex 和隐藏链接都不是授权控制；API 必须继续检查身份和数据归属。
- 监控配额、存储和供应商账单，设置备份策略，先验证受控用户流程。
- 当前没有邮箱验证、自助找回密码、后台工作流、支付接入和历史快照自动清理。
- 首次出图使用新密钥单独验证；单元测试通过不代表供应商账号可用。
