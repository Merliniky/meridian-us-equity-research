#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { MeridianClient, CliError, SCHEMA_VERSION, VERSION, DEFAULT_BASE_URL, baseUrl, readArchive, saveArchive } from '../src/client.mjs';
import { PERIODS, envelope, metadata, stockView, macroView, rankView, financialView, calendarView, findStock, issue } from '../src/views.mjs';
const help = `Meridian CLI ${VERSION} — 衡研美股研究台

用法：meridian <命令> [参数]
  status                     已发布日期与更新提示（不触发取数）
  macro [--history]          宏观评分、指标；可附十年宏观/标普历史
  stock <代码或名称>          个股收盘数据、技术排名、基本面
  financials <代码或名称>     已披露财报、计算来源与远期资料可用性
  rank [--period short]      全样本原排名，支持行业和代码筛选
  calendar                   下一次公布时间及已核验预期
  snapshot --output FILE     保存可供多次研究共用的完整快照
  refresh                    获取最近完整收盘日资料并重新计算（影响共享网站数据）
  schema                     输出 JSON Schema

通用：--base-url URL --snapshot FILE --pretty --strict --min-date YYYY-MM-DD
      --timeout-ms 180000 --retries 2 --quiet --help --version
排名：--period short|medium|long|fundamental --limit 20 --offset 0
      --sector 信息技术 --symbols NVDA,AAPL --include-unranked
个股：--period short|medium|long --history
宏观/日历：--from YYYY-MM-DD --to YYYY-MM-DD

默认 stdout 只输出一个 JSON；refresh 进度为 stderr JSONL。
读取命令不自动刷新，不连接券商。完整文档见包内 README.md。
`;
const booleanOptions = new Set(['pretty','strict','quiet','history','include-unranked','help','version']);
const valueOptions = new Set(['base-url','snapshot','min-date','timeout-ms','retries','output','period','limit','offset','sector','symbols','from','to']);
const commands = new Set(['status','macro','stock','financials','rank','calendar','snapshot','refresh','schema']);
function parse(argv) {
  const o = {}, positional = [];
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const equal=arg.indexOf('='), key=arg.slice(2,equal<0?undefined:equal);
    if (booleanOptions.has(key)) { if(equal>=0)throw new CliError('USAGE',`--${key} 不接受值`,2); o[key]=true; }
    else if(valueOptions.has(key)) {
      const value=equal<0?argv[++i]:arg.slice(equal+1);
      if(!value||value.startsWith('--'))throw new CliError('USAGE',`--${key} 缺少值`,2);
      o[key]=value;
    } else throw new CliError('USAGE',`未知参数 --${key}`,2);
  }
  if(o.help||!positional.length&&!o.version)return {help:true};
  if(o.version)return {version:true};
  const [command,...args]=positional;
  if(!commands.has(command))throw new CliError('USAGE','未知命令；运行 meridian --help',2);
  const query=args.join(' ');
  if(['stock','financials'].includes(command)?!query:args.length)throw new CliError('USAGE','命令参数数量不正确',2);
  const allowed={status:[],macro:['history','from','to'],stock:['period','history'],financials:[],rank:['period','limit','offset','sector','symbols','include-unranked'],calendar:['from','to'],snapshot:['output'],refresh:[],schema:[]};
  for(const key of ['history','from','to','period','limit','offset','sector','symbols','include-unranked','output'])if(o[key]!==undefined&&!allowed[command].includes(key))throw new CliError('USAGE',`当前命令不支持 --${key}`,2);
  if(o.snapshot&&['refresh','schema'].includes(command))throw new CliError('USAGE','该命令不支持离线快照',2);
  if(o.period&&!([...PERIODS,...(command==='rank'?['fundamental']:[])].includes(o.period)))throw new CliError('USAGE','period 必须为受支持周期',2);
  for(const key of ['min-date','from','to'])if(o[key]&&(!/^\d{4}-\d\d-\d\d$/.test(o[key])||Number.isNaN(Date.parse(o[key]))||new Date(o[key]).toISOString().slice(0,10)!==o[key]))throw new CliError('USAGE',`--${key} 需要有效 YYYY-MM-DD`,2);
  if(o.from&&o.to&&o.from>o.to)throw new CliError('USAGE','from 不能晚于 to',2);
  for(const [key,def,min,max] of [['limit',20,1,1000],['offset',0,0,100000],['timeout-ms',180000,100,600000],['retries',2,0,5]]){
    const n=o[key]===undefined?def:Number(o[key]);if(!Number.isInteger(n)||n<min||n>max)throw new CliError('USAGE',`--${key} 需要 ${min}–${max} 的整数`,2);o[key]=n;
  }
  return {...o,command,query,minDate:o['min-date'],includeUnranked:o['include-unranked']};
}
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());
process.once('SIGTERM',()=>controller.abort());
let options, command=null;
try {
  options=parse(process.argv.slice(2));
  if(options.help){process.stdout.write(help);}
  else if(options.version){process.stdout.write(JSON.stringify({cliVersion:VERSION,schemaVersion:SCHEMA_VERSION})+'\n');}
  else {
    command=options.command;
    const url=baseUrl(options['base-url']??process.env.MERIDIAN_BASE_URL??DEFAULT_BASE_URL);
    const client=new MeridianClient({url,timeoutMs:options['timeout-ms'],retries:options.retries,signal:controller.signal});
    let response;
    if(command==='schema')response=envelope(command,{schema:JSON.parse(await readFile(new URL('../schema/response.schema.json',import.meta.url),'utf8'))});
    else if(command==='status'&&!options.snapshot){
      const status=await client.request();
      response=envelope(command,{published:Boolean(status.date),...status},{baseUrl:url,readMode:'published_api',retrievedAt:new Date().toISOString(),priceAsOf:status.date??null,marketFreshnessVerified:false,sourceWarnings:status.warnings??[]},status.date?[]:[issue('NOT_PUBLISHED','尚未发布正式数据')],{...options,dateChecks:{priceAsOf:status.date}});
    } else {
      const refresh=command==='refresh'?await client.refresh(p=>{if(!options.quiet)process.stderr.write(JSON.stringify({event:'progress',...p})+'\n');}):null;
      const archive=refresh?.archive??(options.snapshot?await readArchive(options.snapshot):await client.snapshot());
      const p=archive.payload,meta=metadata(archive,Boolean(options.snapshot));
      if(refresh)meta.marketFreshnessVerified=true;
      let view,dateChecks={priceAsOf:meta.priceAsOf};
      if(command==='status')view={data:{published:true,...p.status},issues:[]};
      if(command==='macro'){view=macroView(p,options);dateChecks={macroAsOf:meta.macroAsOf};}
      if(command==='stock'){const s=findStock(p.stocks.stocks,options.query);view=stockView(s,p,options);dateChecks={priceAsOf:s.bars.at(-1).date};}
      if(command==='financials'){const s=findStock(p.stocks.stocks,options.query);view=financialView(s,p);dateChecks={financialsVerifiedThrough:s.reportedFundamentals?.cutoff};}
      if(command==='rank')view=rankView(p,options);
      if(command==='calendar'){view=calendarView(p,options);dateChecks={macroAsOf:meta.macroAsOf};}
      if(command==='snapshot'){
        view={data:options.output?{sha256:archive.sha256,companyCount:p.stocks.stocks.length,saved:false}:{archive},issues:[]};
        dateChecks={priceAsOf:meta.priceAsOf,macroAsOf:meta.macroAsOf};
      }
      if(command==='refresh'){
        const missing=p.stocks.stocks.filter(s=>s.bars.at(-1).date!==meta.priceAsOf).map(s=>s.symbol);
        view={data:{completed:true,targetClose:refresh.targetClose,publishedClose:meta.priceAsOf,alreadyCurrent:refresh.alreadyCurrent,companyCount:p.stocks.stocks.length,freshPriceCount:p.stocks.stocks.length-missing.length,excludedSymbols:missing,macroAsOf:meta.macroAsOf},
          issues:meta.macroAsOf<meta.priceAsOf?[issue('MACRO_BEHIND_PRICE','行情更新完成，宏观仍保留上一截止日')]:[]};
        dateChecks={priceAsOf:meta.priceAsOf,macroAsOf:meta.macroAsOf};
      }
      response=envelope(command,view.data,meta,view.issues,{...options,dateChecks});
      if(command==='snapshot'&&options.output&&response.ok)response.data={...response.data,path:await saveArchive(options.output,archive),saved:true};
    }
    process.stdout.write(JSON.stringify(response,null,options.pretty?2:undefined)+'\n');
    if(!response.ok)process.exitCode=5;
  }
} catch(error) {
  const e=controller.signal.aborted?new CliError('CANCELLED','操作已取消；可重新运行 refresh 继续',130):error instanceof CliError?error:new CliError('INTERNAL_ERROR','CLI 执行失败，请检查参数、文件权限或接口结构',6);
  process.stdout.write(JSON.stringify({schemaVersion:SCHEMA_VERSION,cliVersion:VERSION,ok:false,command,meta:{},data:null,error:{code:e.code,message:e.message,details:e.details}},null,options?.pretty?2:undefined)+'\n');
  process.exitCode=e.exitCode;
}
