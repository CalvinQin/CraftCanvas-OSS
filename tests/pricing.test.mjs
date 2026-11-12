import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const load = async file => { const out = await build({ entryPoints:[file], bundle:true, format:'esm', platform:'browser', write:false }); return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`); };
const { calculateTokenCost } = await load('server/tokenCost.ts');
const { parseOfficialPrice, INITIAL_PRICES, priceAt } = await load('server/pricing.ts');
const at = Date.UTC(2026,9,6);

test('Gemini text cost includes thinking and bills cache once, with USD micro precision', () => {
 const r=calculateTokenCost('gemini','gemini-3.8-flash',{usageMetadata:{promptTokenCount:20,candidatesTokenCount:10,thoughtsTokenCount:5,cachedContentTokenCount:4,totalTokenCount:35}},INITIAL_PRICES,at);
 assert.equal(r.costStatus,'priced'); assert.equal(r.costMicros,69); assert.equal(r.usage.output,15); assert.equal(r.usage.total,35); assert.equal(r.usage.inputText,null);
 assert.equal(priceAt(INITIAL_PRICES,'gemini-3.8-flash',Date.UTC(2027,0,1)).rates.inputText,1.5);
 assert.equal(r.price.rates.inputText,.75);
});
test('Gemini mixed image and text output uses separate official rates, thinking is text', () => {
 const r=calculateTokenCost('gemini','gemini-3.1-flash-image',{usageMetadata:{promptTokenCount:100,candidatesTokenCount:1140,thoughtsTokenCount:10,totalTokenCount:1250,candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120},{modality:'TEXT',tokenCount:20}]}},INITIAL_PRICES,at);
 assert.equal(r.costStatus,'priced');assert.equal(r.costMicros,67340);assert.equal(r.usage.outputImage,1120);assert.equal(r.usage.outputText,30);
});
test('Gemini live lowercase standard tier is priced, while unknown tiers retain usage without an assumed price', () => {
 const data={usageMetadata:{promptTokenCount:5,candidatesTokenCount:1,totalTokenCount:6,serviceTier:'standard'}};
 const r=calculateTokenCost('gemini','gemini-3.8-flash',data,INITIAL_PRICES,at);assert.equal(r.costStatus,'priced');assert.equal(r.costMicros,8);
 data.usageMetadata.serviceTier='priority';const unsupported=calculateTokenCost('gemini','gemini-3.8-flash',data,INITIAL_PRICES,at);assert.equal(unsupported.costStatus,'unpriced');assert.equal(unsupported.usage.total,6);assert.equal(unsupported.costMicros,null);
});
test('missing and ambiguous usage never appears as zero cost', () => {
 assert.equal(calculateTokenCost('gemini','gemini-3.8-flash',{},INITIAL_PRICES,at).costMicros,null);
 const data={candidates:[{content:{parts:[{text:'caption'},{inlineData:{data:'image'}}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:1200,totalTokenCount:1300}};
 const r=calculateTokenCost('gemini','gemini-3.1-flash-image',data,INITIAL_PRICES,at);assert.equal(r.costStatus,'incomplete_usage');assert.equal(r.costMicros,null);assert.equal(r.usage.total,1300);
 assert.equal(calculateTokenCost('gemini','gemini-3.8-flash',{usageMetadata:{promptTokenCount:-1}},INITIAL_PRICES,at).usage,null);
});
test('OpenAI text/image and cached modalities are billed without double counting', () => {
 const data={usage:{input_tokens:600,output_tokens:1200,total_tokens:1800,input_tokens_details:{text_tokens:100,image_tokens:500,cached_tokens:120,cached_tokens_details:{text_tokens:20,image_tokens:100}}}};
 const r=calculateTokenCost('openai','gpt-image-2.5-sunburst:high',data,INITIAL_PRICES,at);assert.equal(r.costStatus,'priced');assert.equal(r.costMicros,39825);
 data.usage.input_tokens_details.cached_tokens_details=undefined;
 assert.equal(calculateTokenCost('openai','gpt-image-2.5-sunburst:high',data,INITIAL_PRICES,at).costStatus,'incomplete_usage');
});
const geminiHTML=(input='.75',out='3.75')=>`<h2>Gemini 3.8 Flash</h2><code>gemini-3.8-flash</code><h3>Standard</h3><table><tr><td>Input price</td><td>Free</td><td>$${input} through December 31, 2026.<br>$1.50 starting January 1, 2027.</td></tr><tr><td>Output price (including thinking tokens)</td><td>Free</td><td>$${out} through December 31, 2026.<br>$7.50 starting January 1, 2027.</td></tr><tr><td>Context caching price</td><td>Free</td><td>$0.075 through December 31, 2026.<br>$0.15 starting January 1, 2027.<br>$0.50 / 1M per hour</td></tr></table><h3>Batch</h3><table><td>$999</td></table>`;
test('official parser targets Standard and preserves announced future effective dates',()=>{
 const parsed=parseOfficialPrice(geminiHTML('0.75'),'gemini-3.8-flash');assert.equal(parsed[0].rates.inputText,.75);assert.equal(parsed[1].from,Date.UTC(2027,0,1));assert.equal(parsed[1].rates.outputText,7.5);
 assert.throws(()=>parseOfficialPrice('<h2>Gemini 3.7 Flash</h2><code>gemini-3.7-flash</code>','gemini-3.8-flash'));
 assert.throws(()=>parseOfficialPrice(geminiHTML('9999'),'gemini-3.8-flash'));
 const openai='<div>gpt-image-2.5-flare Text tokens Per 1M tokens Input $5.00 Cached input $1.25 Image tokens Per 1M tokens Input $8.00 Cached input $2.00 Output $30.00 Text output is not billed Modalities</div>';
 assert.equal(parseOfficialPrice(openai,'gpt-image-2.5-flare')[0].rates.outputImage,30);
 assert.throws(()=>parseOfficialPrice(openai.replace('Cached input $2.00','Missing'),'gpt-image-2.5-flare'));
});
