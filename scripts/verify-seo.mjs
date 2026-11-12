import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const pages = ['/', '/docs', '/docs/workflows', '/docs/self-hosting', '/help', '/pricing', '/privacy', '/terms'];
const titles = new Set(); const canonicals = new Set();
const sitemap = await readFile('dist/client/sitemap.xml', 'utf8');
const robots = await readFile('dist/client/robots.txt', 'utf8');
const llms = await readFile('dist/client/llms.txt', 'utf8');
let indexable;
for (const path of pages) {
  const html = await readFile(`dist/client${path === '/' ? '' : path}/index.html`, 'utf8');
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1]; assert.ok(title, path+' has a title'); assert.ok(!titles.has(title), 'unique title'); titles.add(title);
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1]; assert.ok(canonical); assert.ok(!canonicals.has(canonical)); canonicals.add(canonical);
  const url = new URL(canonical); assert.equal(url.pathname, path === '/' ? '/' : path + '/'); assert.ok(!url.search && !url.hash);
  indexable = !html.includes('content="noindex, nofollow"');
  assert.equal(indexable, url.protocol === 'https:');
  assert.match(html, /data-prerendered="true"/); assert.match(html, /<main[^>]*id="main-content"/);
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, path+' has one h1');
  assert.match(html, /<meta name="description" content="[^"]{15,}"/);
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]);
  assert.equal(data['@graph'].find(x => x['@type'] === 'WebPage').url, canonical);
  assert.equal(data['@graph'].find(x => x['@type'] === 'SoftwareSourceCode').license, 'https://opensource.org/license/mit');
  assert.match(html, /property="og:image"/); assert.match(html, /name="twitter:card" content="summary_large_image"/);
  const markdownPath = path === '/' ? '/index.md' : path+'.md';
  const md = await readFile('dist/client'+markdownPath, 'utf8'); assert.ok(md.length > 400); assert.ok(md.includes(canonical)); assert.ok(llms.includes(markdownPath));
  assert.equal(sitemap.includes('<loc>'+canonical+'</loc>'), indexable);
  for (const match of html.matchAll(/(?:src|href)="(\/(?:assets|images|brand)\/[^"#?]+)"/g)) await access('dist/client'+match[1]);
  const internal = path==='/'?'home':path.slice(1).replaceAll('/','-');
  assert.equal(await readFile(`dist/client/__pages/${internal}.page`, 'utf8'), html);
}
for (const path of ['/account','/admin','/workspace','/workflow','/library']) {
  assert.ok(!sitemap.includes('<loc>'+[...canonicals][0].replace(/\/$/,'')+path+'</loc>'));
  if (indexable) assert.ok(robots.includes('Disallow: '+path));
}
const shell = await readFile('dist/client/__pages/app.page','utf8');
assert.match(shell, /content="noindex, nofollow"/); assert.ok(!shell.includes('data-prerendered'));
assert.equal((sitemap.match(/<loc>/g)||[]).length, indexable ? pages.length : 0);
if(!indexable) assert.match(robots, /Disallow: \/\n/);
const png=await readFile('dist/client/images/craftcanvas-social.png');
assert.equal(png.readUInt32BE(16),1200); assert.equal(png.readUInt32BE(20),630);
console.log(`SEO verification passed: ${pages.length} HTML pages, Markdown mirrors, metadata, assets and private-route exclusions. Indexing ${indexable?'enabled':'disabled'}.`);
