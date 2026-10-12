import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const VERSION = '1.1.1';
export const SCHEMA_VERSION = '1.0';
export const TECHNICAL_MODEL_VERSION = '3.1';
export const DEFAULT_BASE_URL = 'https://meridian-us-equity-research.merliniky.chatgpt.site';
export class CliError extends Error {
  constructor(code, message, exitCode = 3, details = null) { super(message); Object.assign(this, { code, exitCode, details }); }
}
export function baseUrl(value = DEFAULT_BASE_URL) {
  let url; try { url = new URL(value); } catch { throw new CliError('INVALID_BASE_URL', 'base-url 必须是完整网址', 2); }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new CliError('INVALID_BASE_URL', 'base-url 不允许凭据、查询参数或片段', 2);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new CliError('INVALID_BASE_URL', '远程服务必须使用 HTTPS', 2);
  if (url.hostname === 'merliniky.github.io') throw new CliError('STATIC_MIRROR', 'GitHub Pages 是静态界面；请使用原站 API 地址或省略 base-url', 2);
  return url.href.replace(/\/$/, '');
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  signal?.addEventListener('abort', stop, { once: true });
});
export const digest = (payload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const pointerId = (s) => JSON.stringify([s.date, s.updatedAt, s.calculationVersion, s.stockKey, s.macroKey]);
export function validatePayload(p) {
  const { status, stocks, research } = p ?? {};
  if (!status?.date || !status.updatedAt || !Array.isArray(stocks?.stocks) || !stocks.stocks.length || !stocks.meta || !research?.macro?.latest || !Array.isArray(research.macro.history) || !Array.isArray(research.macro.indicators) || !Array.isArray(research.benchmark?.history)) throw new CliError('INVALID_SNAPSHOT', '研究结果缺少必需字段', 6);
  if (stocks.meta.priceAsOf !== status.date || research.priceAsOf !== status.date || stocks.meta.priceRefreshedAt !== status.updatedAt || research.refreshedAt !== status.updatedAt) throw new CliError('SNAPSHOT_CHANGED', '读取期间数据版本不一致，请重试', 6);
  if (research.benchmark.cutoff !== research.macro.informationCutoffAt?.slice(0, 10) || research.macro.latest.asOf > research.macro.informationCutoffAt?.slice(0, 10)) throw new CliError('INVALID_SNAPSHOT', '宏观与基准截止日不一致', 6);
  if (research.macro.informationCutoffAt.slice(0,10) > status.date) throw new CliError('INVALID_SNAPSHOT', '宏观资料晚于行情截止日', 6);
  for (const point of [research.macro.latest, ...research.macro.history]) {
    if (point.score != null && (!Number.isFinite(point.score) || point.score < 0 || point.score > 10)) throw new CliError('INVALID_SNAPSHOT', '宏观相对分超出 0–10', 6);
    if (point.raw != null && (!Number.isFinite(point.raw) || point.raw < 0 || point.raw > 100)) throw new CliError('INVALID_SNAPSHOT', '宏观原始分超出 0–100', 6);
  }
  const symbols = new Set();
  for (const s of stocks.stocks) {
    if (typeof s.symbol !== 'string' || !s.symbol || symbols.has(s.symbol) || !Array.isArray(s.bars) || !s.technical || !s.ranks) throw new CliError('INVALID_SNAPSHOT', '股票标识重复或结构不完整', 6);
    symbols.add(s.symbol);
    const bar = s.bars.at(-1);
    if (!bar || !Number.isFinite(bar.close) || bar.close <= 0 || typeof bar.date !== 'string' || bar.date > status.date) throw new CliError('INVALID_SNAPSHOT', `股票 ${s.symbol} 的收盘数据无效`, 6);
    for (const rank of Object.values(s.ranks)) {
      if (rank == null) continue;
      if (!Number.isFinite(rank.score) || rank.score < 0 || rank.score > 100 || (!Number.isFinite(rank.rank) || !Number.isInteger(rank.rank * 2)) || !Number.isInteger(rank.total) || rank.rank < 1 || rank.rank > rank.total) throw new CliError('INVALID_SNAPSHOT', `股票 ${s.symbol} 的排名字段无效`, 6);
    }
    for (const period of ['short', 'medium', 'long']) {
      const entry = s.technical[period]?.entry;
      if (entry?.modelVersion !== TECHNICAL_MODEL_VERSION) continue; // Read legacy archives, but views explicitly block their old scores.
      const scores = ['score', 'trendStrength', 'positionQuality', 'confirmationQuality', 'riskQuality', 'scoreCap'];
      if (!scores.every(k => Number.isFinite(entry[k]) && entry[k] >= 0 && entry[k] <= 100) ||
          !['distanceAtr', 'distancePct', 'riskDistanceAtr'].every(k => Number.isFinite(entry[k])) ||
          !(entry.referenceInvalidation === null || (Number.isFinite(entry.referenceInvalidation) && entry.referenceInvalidation > 0)) ||
          !Array.isArray(entry.reasons) || !entry.reasons.every(x => typeof x === 'string') ||
          !['pullback_ready', 'breakout_ready', 'overextended', 'trend_broken', 'waiting_confirmation', 'waiting_setup', 'excessive_risk'].includes(entry.status) || !['pullback', 'breakout', 'none'].includes(entry.setup) ||
          entry.score > entry.scoreCap + 1e-8 ||
          (s.ranks[period] && Math.abs(s.ranks[period].score - entry.score) > 1e-8)) {
        throw new CliError('INVALID_SNAPSHOT', `股票 ${s.symbol} 的 ${period} 买点模型字段无效或与排名分不一致`, 6);
      }
    }
  }
  return p;
}
export function makeArchive(payload, url, retrievedAt = new Date().toISOString()) {
  validatePayload(payload);
  return { schemaVersion: SCHEMA_VERSION, kind: 'meridian.snapshot', baseUrl: url, retrievedAt, sha256: digest(payload), payload };
}
export async function readArchive(file) {
  let a; try { a = JSON.parse(await readFile(file, 'utf8')); } catch { throw new CliError('SNAPSHOT_FILE_ERROR', '无法读取快照 JSON 文件', 6); }
  if (a.schemaVersion !== SCHEMA_VERSION || a.kind !== 'meridian.snapshot' || !a.payload || a.sha256 !== digest(a.payload)) throw new CliError('SNAPSHOT_INTEGRITY_ERROR', '快照版本或 SHA-256 校验失败', 6);
  validatePayload(a.payload);
  baseUrl(a.baseUrl);
  return a;
}
export async function saveArchive(file, archive) {
  const output = path.resolve(file), temp = output + `.tmp-${process.pid}-${Date.now()}`;
  try { await writeFile(temp, JSON.stringify(archive) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temp, output); }
  catch (e) { await unlink(temp).catch(() => {}); throw new CliError('OUTPUT_ERROR', `无法保存快照：${e.code ?? '写入失败'}`, 3); }
  return output;
}
export class MeridianClient {
  constructor({ url, timeoutMs = 180000, retries = 2, signal, fetchImpl = fetch } = {}) {
    Object.assign(this, { url: baseUrl(url), timeoutMs, retries, signal, fetchImpl });
  }
  async request(resource = 'status', body) {
    const url = this.url + '/api/refresh' + (body ? '' : '?resource=' + encodeURIComponent(resource));
    for (let attempt = 0; ; attempt++) {
      let response, text;
      try {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        response = await this.fetchImpl(url, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
          headers: { Accept: 'application/json', 'User-Agent': `MeridianCLI/${VERSION}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        text = await response.text();
      } catch (e) {
        if (this.signal?.aborted) throw new CliError('CANCELLED', '操作已取消；未完成的刷新可重新执行', 130);
        if (attempt < this.retries) { await sleep(500 * 2 ** attempt, this.signal); continue; }
        throw new CliError('NETWORK_ERROR', `请求失败或超时：${e.name ?? '网络错误'}`, 3);
      }
      if ([429, 502, 503, 504].includes(response.status) && attempt < this.retries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 500 * 2 ** attempt, this.signal); continue;
      }
      let value; try { value = JSON.parse(text); } catch { throw new CliError('NON_JSON_RESPONSE', `接口没有返回 JSON（HTTP ${response.status}）`, 3); }
      if (!response.ok || value?.error) throw new CliError('API_ERROR', typeof value?.error === 'string' ? value.error : `HTTP ${response.status}`, 3, { httpStatus: response.status });
      return value;
    }
  }
  async snapshot() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.request();
      if (!before.date) throw new CliError('NOT_PUBLISHED', '服务器还没有完成一次正式更新，请先执行 refresh', 3);
      const [stocks, research] = await Promise.all([this.request('stocks'), this.request('research')]);
      const after = await this.request();
      if (pointerId(before) !== pointerId(after)) continue;
      try { return makeArchive({ status: after, stocks, research }, this.url); }
      catch (e) { if (e.code !== 'SNAPSHOT_CHANGED' || attempt === 2) throw e; }
    }
    throw new CliError('SNAPSHOT_CHANGED', '更新频繁，无法取得一致版本；未返回混合数据', 6);
  }
  async refresh(progress = () => {}) {
    progress({ stage: 'start', message: '确认最近完整收盘日' });
    const job = await this.request('', { action: 'start' });
    if (typeof job.targetClose !== 'string' || typeof job.jobId !== 'string') throw new CliError('INVALID_RESPONSE', '刷新任务缺少标识', 6);
    let result;
    if (!job.alreadyCurrent) {
      if (!Number.isInteger(job.batches) || job.batches < 1 || job.batches > 1000 || !Number.isInteger(job.companyCount) || job.companyCount < 1) throw new CliError('INVALID_RESPONSE', '刷新任务批次信息无效', 6);
      let index = 0, completed = 0, failure;
      const work = async () => {
        while (index < job.batches && !failure) {
          const i = index++;
          try {
            const batch = await this.request('', { action: 'batch', jobId: job.jobId, index: i });
            if (!Number.isInteger(batch.completed) || batch.completed < 1) throw new CliError('INVALID_RESPONSE', '刷新批次未确认完成', 6);
            completed += batch.completed;
            progress({ stage: 'batch', index: i, completed, total: job.companyCount, warnings: batch.warnings ?? [] });
          } catch (e) { failure = e; }
        }
      };
      await Promise.all([work(), work()]);
      if (failure) throw failure;
      if (completed !== job.companyCount) throw new CliError('INCOMPLETE_REFRESH', '批次数量不完整；未请求发布', 6);
      progress({ stage: 'macro', message: '核验宏观数据' });
      await this.request('', { action: 'macro', jobId: job.jobId });
      progress({ stage: 'finish', message: '重算排名并发布结果' });
      result = await this.request('', { action: 'finish', jobId: job.jobId });
      if (!result.completed) throw new CliError('INCOMPLETE_REFRESH', '服务端没有确认完成', 6);
    }
    const archive = await this.snapshot();
    if (archive.payload.status.date < job.targetClose) throw new CliError('INCOMPLETE_REFRESH', '已发布数据未达到本次目标收盘日', 6);
    return { archive, targetClose: job.targetClose, alreadyCurrent: Boolean(job.alreadyCurrent), result };
  }
}
