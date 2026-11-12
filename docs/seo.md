# 搜索与 AI 可读性

公开页面共享 `site/content.ts` 事实来源。构建输出八个预渲染 HTML 页面，包括产品、文档、工作流、自托管、使用指南、费用、隐私与条款；正文无需 JavaScript 即可读取。

每页都有唯一标题、描述、canonical、Open Graph/Twitter 分享信息，以及与可见内容一致的 WebPage、WebSite、SoftwareSourceCode 和面包屑结构化数据。没有虚构评价、评分或索引承诺。

`sitemap.xml` 只列公开页面。私人工作区与账号页面输出 noindex，未知路径返回 404。生产构建必须设置 `CRAFTCANVAS_PUBLIC_SITE_URL`；本地构建默认不索引。

Markdown 镜像和 `llms.txt` 提供另一种读取文档的方式。它们是辅助入口，不是获得排名或 AI 引用的保证。更新功能时同时更新事实与修改日期；可见 FAQ 应直接回答真实用户问题。

部署者可在拥有域名的前提下使用 Search Console 提交 sitemap，随后观察实际抓取和收录。当前仓库不包含站点所有权验证，也不声称已收录。

参考：
- [Google：AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Google：JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [llms.txt proposal](https://llmstxt.org/)
