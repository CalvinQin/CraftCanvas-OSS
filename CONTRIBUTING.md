# 参与 CraftCanvas

欢迎提交可复现的问题、界面改进和文档修正。请先阅读 README 的功能边界。较大功能先开 Issue 讨论范围，避免重复工作。

## 开发流程

1. Fork 并安装 Node.js 24，按 README 启动本地服务。
2. 从 `main` 新建分支；保留其他人的现有改动。
3. 修改代码并为权限、数据保存或流程调度的行为变化添加回归测试。文案和布局调整可使用人工验证。
4. 运行 `npm run check`、`npm test`、`npm run build`、`npm run verify:seo`。
5. 提交 PR：描述问题、改后的行为、验证结果与限制。界面改动附不含个人信息的截图。

## 项目约定

- 服务端决定账号、管理员权限、额度与数据范围。浏览器状态不能作为授权证据。
- 已发布数据库迁移只追加，不修改旧文件。
- 不提交真实密钥、账号资料、云端快照、私人图片或 `.dev.vars`。
- 不在测试中默认访问真实模型；实际调用必须由部署者自行授权与控制费用。
- 修改用户行为时同步文档；版本发布同步 `package.json`、`package-lock.json`、`site/content.ts` 和 `CHANGELOG.md`。
- 公共路由、SEO 文案与 Markdown 由 `site/content.ts` 和 `scripts/prerender.mjs` 维护，不编辑构建产物。

提交贡献即表示你有权贡献这些内容，并同意按项目 MIT 许可证分发；第三方内容需注明原始许可。安全问题请使用 [安全报告流程](SECURITY.md)，不要公开发布可利用细节或凭据。

## 依赖维护

`@esbuild-kit/core-utils` 的传递 esbuild 通过 overrides 复用项目的修补版本，避免旧版开发服务器漏洞。更新后验证 `npm run db:generate` 不生成无意迁移，并重新检查构建和测试。不要使用 `npm audit fix --force` 将 Drizzle 降级到不兼容版本。
