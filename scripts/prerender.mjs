import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const cache = resolve('node_modules/.cache/craftcanvas'); await mkdir(cache, { recursive: true });
const bundle = resolve(cache, 'public-render.mjs');
await build({ entryPoints: ['site/render.tsx'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { renderPage, PUBLIC_PAGES, PROJECT, DOCS, FAQ } = await import(pathToFileURL(bundle).href + '?t=' + Date.now());
const configured = process.env.CRAFTCANVAS_PUBLIC_SITE_URL;
const origin = new URL(configured || 'http://localhost:3000');
if (configured && (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)) throw new Error('CRAFTCANVAS_PUBLIC_SITE_URL must be an HTTPS origin without a path or credentials.');
const base = origin.origin;
const indexable = !!configured;
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const template = await readFile('dist/client/index.html','utf8');
await mkdir('dist/client/__pages', { recursive: true });
await writeFile('dist/client/__pages/app.page', template);
const schema = path => ({ '@context':'https://schema.org', '@graph':[
  { '@type':'WebSite', '@id':`${base}/#website`, name:PROJECT.name, url:base+'/', inLanguage:'zh-CN', description:PROJECT.description },
  { '@type':'SoftwareSourceCode', '@id':`${base}/#source`, name:PROJECT.name, description:PROJECT.description, codeRepository:PROJECT.repository, programmingLanguage:['TypeScript','JavaScript'], runtimePlatform:'Cloudflare Workers', license:'https://opensource.org/license/mit', version:PROJECT.version, author:{'@type':'Person',name:'Calvin Qin',url:'https://github.com/CalvinQin'} },
  { '@type':'WebPage', '@id':base+path, url:base+path, name:PUBLIC_PAGES[path].title, description:PUBLIC_PAGES[path].description, inLanguage:'zh-CN', isPartOf:{'@id':`${base}/#website`}, about:{'@id':`${base}/#source`}, dateModified:PROJECT.updated },
  ...(path==='/'?[]:[{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'CraftCanvas',item:base+'/'},{'@type':'ListItem',position:2,name:PUBLIC_PAGES[path].title.split('｜')[0],item:base+path}]}]),
] });
for (const [path,page] of Object.entries(PUBLIC_PAGES)) {
  const canonical=base+path;
  const markdown = path==='/' ? '/index.md' : path+'.md';
  const head = `<title>${escape(page.title)}</title>\n<meta name="description" content="${escape(page.description)}">\n<meta name="robots" content="${indexable?'index, follow, max-image-preview:large':'noindex, nofollow'}">\n<link rel="canonical" href="${canonical}">\n<meta property="og:type" content="website">\n<meta property="og:site_name" content="CraftCanvas">\n<meta property="og:locale" content="zh_CN">\n<meta property="og:title" content="${escape(page.title)}">\n<meta property="og:description" content="${escape(page.description)}">\n<meta property="og:url" content="${canonical}">\n<meta property="og:image" content="${base}/images/craftcanvas-social.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="CraftCanvas：开源商品图画布与可视化节点工作流">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${escape(page.title)}">\n<meta name="twitter:description" content="${escape(page.description)}">\n<meta name="twitter:image" content="${base}/images/craftcanvas-social.png">\n<link rel="alternate" type="text/markdown" href="${markdown}">\n<link rel="describedby" href="/llms.txt">\n<script type="application/ld+json">${JSON.stringify(schema(path)).replaceAll('<','\\u003c')}</script>`;
  let html=template.replace(/<title>[\s\S]*?<\/title>/,'').replace(/<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/g,'').replace('</head>',head+'\n</head>').replace('<div id="root"></div>',`<div id="root" data-prerendered="true">${renderPage(path)}</div>`);
  const directory=path==='/'?'dist/client':`dist/client${path}`;await mkdir(directory,{recursive:true});await writeFile(directory+'/index.html',html);
  await writeFile(`dist/client/__pages/${path==='/'?'home':path.slice(1).replaceAll('/','-')}.page`,html);
  let content=`# ${page.title}\n\n${page.description}\n\nSource: ${canonical}\nUpdated: ${PROJECT.updated}\n\n`;
  if(DOCS[path]) for(const section of DOCS[path].sections) content+=`## ${section.title}\n\n${section.text.join('\n\n')}\n\n${section.code?'```sh\n'+section.code+'\n```\n\n':''}`;
  else if(path==='/') content+=FAQ.map(([q,a])=>`## ${q}\n\n${a}\n`).join('\n');
  else { const body=renderPage(path); content+=body.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<\/(?:p|h[1-6]|section|li)>/g,'\n\n').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').replace(/[ \t]+/g,' ').trim(); }
  await writeFile(`dist/client${markdown}`,content+'\n');
}
await writeFile('dist/client/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable?Object.keys(PUBLIC_PAGES).map(path=>`  <url><loc>${base}${path}</loc><lastmod>${PROJECT.updated}</lastmod></url>`).join('\n'):''}\n</urlset>\n`);
await writeFile('dist/client/robots.txt',`User-agent: *\n${indexable?['/api/','/auth/','/admin','/account','/workspace','/workflow','/library'].map(path=>'Disallow: '+path).join('\n'):'Disallow: /'}\n${indexable?'Sitemap: '+base+'/sitemap.xml\n':''}`);
await writeFile('dist/client/llms.txt',`# CraftCanvas\n\n> ${PROJECT.description}\n\nVersion: ${PROJECT.version}. Maintainer: Calvin Qin. License: MIT.\n\nThe source code is open source; model API and hosting services may incur charges. Workflows require an open browser tab. No live model quality guarantee is implied by tests. Private account, admin, canvas and asset routes are not public documentation.\n\n## Documentation\n\n${Object.entries(PUBLIC_PAGES).map(([path,page])=>`- [${page.title}](${base}${path==='/'?'/index.md':path+'.md'}): ${page.description}`).join('\n')}\n\n## Source\n\n- [Source repository](${PROJECT.repository})\n- [License](${PROJECT.repository}/blob/main/LICENSE)\n- [Security policy](${PROJECT.repository}/blob/main/SECURITY.md)\n`);
console.log(`Pre-rendered ${Object.keys(PUBLIC_PAGES).length} public pages. Indexing: ${indexable?'enabled':'disabled (set CRAFTCANVAS_PUBLIC_SITE_URL for production)'}.`);
