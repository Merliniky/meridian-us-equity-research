// Node.js: read once, then derive several views from exactly the same payload.
import { MeridianClient } from '../src/client.mjs';
import { metadata, macroView, stockView, rankView, findStock } from '../src/views.mjs';
const client = new MeridianClient({ url: process.env.MERIDIAN_BASE_URL });
const archive = await client.snapshot(); // No refresh, no broker access.
const payload = archive.payload;
const company = findStock(payload.stocks.stocks, process.argv[2] ?? 'NVDA');
const stock = stockView(company, payload, { period: 'medium' });
const macro = macroView(payload);
const ranking = rankView(payload, { period: 'medium', limit: 20 });
const issues = [...macro.issues, ...stock.issues, ...ranking.issues];
console.log(JSON.stringify({meta:metadata(archive),issues,macro:macro.data,stock:stock.data,ranking:ranking.data}));
if (issues.some(x => x.blocking)) process.exitCode = 5;
