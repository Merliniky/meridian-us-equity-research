import { CliError, SCHEMA_VERSION, VERSION, TECHNICAL_MODEL_VERSION } from './client.mjs';
export const PERIODS = ['short', 'medium', 'long'];
const horizons = { short: { horizon: '5–8 days', frequency: 'day' }, medium: { horizon: '5–8 weeks', frequency: 'week' }, long: { horizon: '5–8 months', frequency: 'month' } };
export const issue = (code, message, extra = {}) => ({ code, message, blocking: true, ...extra });
const entryOf = t => t?.entry?.modelVersion === TECHNICAL_MODEL_VERSION ? t.entry : null;
const technicalSemantics = { expectedModelVersion: TECHNICAL_MODEL_VERSION, scoreMeaning: 'entry_quality', scoreScale: 'absolute_0_100', calibratedProbability: false, returnCalibration: 'not_calibrated', experimental: true, actionable: false, profitabilityValidated: false };
const normalize = (s) => String(s).normalize('NFKC').trim().toLocaleLowerCase('en-US');
export function findStock(stocks, query) {
  const q = normalize(query);
  const exact = stocks.filter(s => [s.symbol, s.name, ...(s.aliases ?? []), s.reportedFundamentals?.entityName].some(x => x && normalize(x) === q));
  const matches = exact.length ? exact : stocks.filter(s => [s.symbol, s.name, ...(s.aliases ?? []), s.reportedFundamentals?.entityName].some(x => x && normalize(x).includes(q)));
  if (!matches.length) throw new CliError('STOCK_NOT_FOUND', '研究样本中没有匹配的公司；不会自动扩展为样本外股票', 4);
  if (matches.length > 1) throw new CliError('AMBIGUOUS_STOCK', '匹配到多家公司，请使用明确的代码', 4, { candidates: matches.slice(0, 30).map(({ symbol, name }) => ({ symbol, name })) });
  return matches[0];
}
export function metadata(archive, offline = false) {
  const { status, stocks, research } = archive.payload;
  const meta = stocks.meta;
  return {
    baseUrl: archive.baseUrl, readMode: offline ? 'snapshot_file' : 'published_api', retrievedAt: archive.retrievedAt,
    snapshotId: `${status.date}@${status.updatedAt}`, contentSha256: archive.sha256,
    publishedAt: status.updatedAt, priceAsOf: meta.priceAsOf, macroAsOf: research.macro.informationCutoffAt.slice(0, 10),
    macroModelVersion: research.macro.modelVersion, calculationVersion: status.calculationVersion ?? null,
    scoreScales: { macro: [0, 10], stockRank: [0, 100], stockEntry: [0, 100] },
    technicalModelVersion: meta.technicalModelVersion ?? (stocks.stocks.some(s => PERIODS.some(p => entryOf(s.technical[p]))) ? TECHNICAL_MODEL_VERSION : null),
    technicalModel: meta.technicalModel ?? null,
    technicalScoreMeaning: technicalSemantics.scoreMeaning, returnCalibration: technicalSemantics.returnCalibration,
    experimental: true, actionable: false, profitabilityValidated: false,
    informationCutoffAt: meta.informationCutoffAt, universeAsOf: meta.universeAsOf,
    companyCount: stocks.stocks.length, securityCount: meta.securityCount ?? null,
    coverage: meta.coverage ?? null, technicalPeriodEnds: meta.technicalPeriodEnds ?? null,
    reportedFundamentals: meta.reportedFundamentals ?? null,
    staleSymbols: meta.staleSymbols ?? [], sourceWarnings: status.warnings ?? [],
    invalidTechnicalSymbols: meta.invalidTechnicalSymbols ?? [], technicalDataIssues: meta.technicalDataIssues ?? [], dataQualityIssues: meta.dataQualityIssues ?? [],
    marketFreshnessVerified: false, quality: { issues: [], requiresReview: false },
  };
}
export function envelope(command, data, meta = {}, issues = [], options = {}) {
  const checks = [...issues];
  if (options.minDate && options.dateChecks) {
    for (const [field, date] of Object.entries(options.dateChecks)) if (!date || date < options.minDate) checks.push(issue('MIN_DATE_NOT_MET', `${field} 未达到要求日期 ${options.minDate}`, { field, actual: date ?? null, expected: options.minDate }));
  }
  const blocking = checks.some(x => x.blocking);
  const failed = (options.strict && blocking) || checks.some(x => x.code === 'MIN_DATE_NOT_MET');
  return { schemaVersion: SCHEMA_VERSION, cliVersion: VERSION, ok: !failed, command,
    meta: { ...meta, quality: { issues: checks, requiresReview: blocking } }, data,
    error: failed ? { code: 'DATA_QUALITY', message: '数据未满足本次质量要求；结果仍附在 data 中，请勿当作已通过校验', details: checks.filter(x => x.blocking) } : null };
}
export function stockView(stock, snapshot, options = {}) {
  const meta = snapshot.stocks.meta, last = stock.bars.at(-1), issues = [];
  const priceCurrent = last.date === meta.priceAsOf && !(meta.staleSymbols ?? []).includes(stock.symbol);
  const invalidHistory = Boolean(stock.technicalExclusionReason) || (meta.invalidTechnicalSymbols ?? []).includes(stock.symbol);
  if (invalidHistory) issues.push(issue('INVALID_PRICE_HISTORY', stock.technicalExclusionReason ?? '历史行情范围异常，全部技术周期已隔离；等待来源修复', { symbol: stock.symbol }));
  if (!priceCurrent) issues.push(issue('STALE_PRICE', '该公司没有本期收盘数据，技术排名不可用', { symbol: stock.symbol, actual: last.date, expected: meta.priceAsOf }));
  const technical = {};
  for (const period of options.period ? [options.period] : PERIODS) {
    const t = stock.technical[period], entry = entryOf(t), rank = priceCurrent && !invalidHistory && entry ? stock.ranks[period] ?? null : null;
    const available = Boolean(t && entry && rank);
    const outdated = Boolean(t && !entry);
    if (outdated) issues.push(issue('TECHNICAL_MODEL_OUTDATED', '该周期不是 3.1 买点模型（包括旧 3.0），请刷新；旧分不可沿用', { symbol: stock.symbol, period }));
    else if (!available) issues.push(issue('TECHNICAL_SCORE_UNAVAILABLE', '该周期缺少有效买点排名，可能为历史不足或行情未更新', { symbol: stock.symbol, period }));
    const { bars, entry: _entry, ...indicators } = t ?? {};
    technical[period] = { ...horizons[period], available, score: available ? rank.score : null, rank: available ? rank.rank : null, total: available ? rank.total : null,
      ...technicalSemantics, modelVersion: entry?.modelVersion ?? null, entry, trendStrength: entry?.trendStrength ?? null,
      unavailableReason: available ? null : !priceCurrent ? 'stale_price' : invalidHistory ? 'invalid_price_history' : outdated ? 'technical_model_outdated' : 'score_unavailable',
      periodEnd: t?.bars.at(-1)?.date ?? null, indicators: t ? indicators : null, ...(options.history ? { history: bars ?? [] } : {}) };
  }
  const forward = stock.fundamental ?? null, forwardRank = stock.ranks.fundamental ?? null;
  return { data: { symbol: stock.symbol, name: stock.name, aliases: stock.aliases ?? [], sector: stock.sector,
    technicalExclusionReason: stock.technicalExclusionReason ?? null,
    experimental: true, actionable: false, profitabilityValidated: false,
    price: { ...last, currency: 'USD', basis: 'provider_adjusted', currentWithinSnapshot: priceCurrent }, technical,
    reportedFundamentals: stock.reportedFundamentals ?? null,
    forwardFundamentals: { available: Boolean(forward && forwardRank), values: forward, rank: forwardRank,
      unavailableReason: forward && forwardRank ? null : '未取得统一 NTM 预测及完整护城河证据；已披露 SEC 财报不等于远期基本面评分' } }, issues };
}
export function macroView(snapshot, options = {}) {
  const { macro, benchmark } = snapshot.research;
  const { history, ...summary } = macro;
  const issues = [];
  if (macro.informationCutoffAt.slice(0,10) < snapshot.stocks.meta.priceAsOf) issues.push(issue('MACRO_BEHIND_PRICE', '宏观资料截止日早于行情日期'));
  if (!Number.isFinite(macro.latest.score)) issues.push(issue('MACRO_SCORE_UNAVAILABLE', '最新宏观评分不可用'));
  const prices = new Map(benchmark.history.map(x => [x.date, x]));
  const joined = history.filter(x => (!options.from || x.asOf >= options.from) && (!options.to || x.asOf <= options.to)).map(x => ({ date: x.date, asOf: x.asOf,
    score: x.score ?? null, raw: x.raw ?? null, factors: { inflation: x.inflation ?? null, employment: x.employment ?? null, growth: x.growth ?? null, policy: x.policy ?? null },
    issues: x.issues ?? [], benchmark: prices.get(x.date) ?? null }));
  return { data: { ...summary, benchmark: { name: benchmark.name, unit: benchmark.unit, sourceUrl: benchmark.sourceUrl, dividendsIncluded: benchmark.dividendsIncluded, cutoff: benchmark.cutoff, latest: benchmark.history.at(-1) },
    ...(options.history ? { history: joined } : {}) }, issues };
}
export function rankView(snapshot, options = {}) {
  const period = options.period ?? 'short';
  let candidates = snapshot.stocks.stocks;
  if (options.symbols) { const wanted = new Set(options.symbols.split(',').map(q => findStock(candidates, q).symbol)); candidates = candidates.filter(s => wanted.has(s.symbol)); }
  if (options.sector) {
    const sectors = [...new Set(snapshot.stocks.stocks.map(s => s.sector))];
    if (!sectors.includes(options.sector)) throw new CliError('SECTOR_NOT_FOUND', '行业名称未匹配，请使用返回的行业名称', 4, { sectors });
    candidates = candidates.filter(s => s.sector === options.sector);
  }
  const outdated = period === 'fundamental' ? [] : candidates.filter(s => s.technical[period] && !entryOf(s.technical[period]) && s.bars.at(-1).date === snapshot.stocks.meta.priceAsOf && !(snapshot.stocks.meta.staleSymbols ?? []).includes(s.symbol));
  const rows = candidates.map(s => {
    const current = s.bars.at(-1).date === snapshot.stocks.meta.priceAsOf && !(snapshot.stocks.meta.staleSymbols ?? []).includes(s.symbol);
    const entry = period === 'fundamental' ? null : entryOf(s.technical[period]);
    const invalidHistory = period !== 'fundamental' && (Boolean(s.technicalExclusionReason) || (snapshot.stocks.meta.invalidTechnicalSymbols ?? []).includes(s.symbol));
    const legacy = period !== 'fundamental' && s.technical[period] && !entry;
    const rank = current && !invalidHistory && (period === 'fundamental' || entry) ? s.ranks[period] ?? null : null;
    return { symbol: s.symbol, name: s.name, sector: s.sector, available: Boolean(rank), score: rank?.score ?? null,
      technicalExclusionReason: s.technicalExclusionReason ?? null,
      rank: rank?.rank ?? null, total: rank?.total ?? null, priceAsOf: s.bars.at(-1).date,
      ...(period === 'fundamental' ? {} : { entry, trendStrength: entry?.trendStrength ?? null, modelVersion: entry?.modelVersion ?? null, ...technicalSemantics }),
      periodEnd: period === 'fundamental' ? s.fundamental?.asOf ?? null : s.technical[period]?.bars.at(-1)?.date ?? null,
      unavailableReason: rank ? null : !current ? 'stale_price' : invalidHistory ? 'invalid_price_history' : legacy ? 'technical_model_outdated' : 'score_unavailable' };
  }).filter(s => options.includeUnranked || s.available).sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.symbol.localeCompare(b.symbol));
  const eligibleCount = rows.filter(x => x.available).length;
  const offset = options.offset ?? 0, limit = options.limit ?? 20;
  const issues = eligibleCount ? [] : [issue(period === 'fundamental' ? 'FORWARD_RANK_UNAVAILABLE' : 'NO_ELIGIBLE_STOCKS', '当前筛选没有可用排名；缺失值不是 0 分')];
  if (outdated.length) issues.push(issue('TECHNICAL_MODEL_OUTDATED', '部分股票使用旧技术模型（包括 3.0），已排除；请刷新为 3.1 买点模型', { symbols: outdated.map(s => s.symbol) }));
  return { data: { period, rankScope: 'published_full_universe', sector: options.sector ?? null, eligibleCount,
    experimental: true, actionable: false, profitabilityValidated: false,
    ...(period === 'fundamental' ? { scoreMeaning: 'cross_sectional_percentile' } : technicalSemantics),
    excludedCount: candidates.length - eligibleCount, matchedCount: rows.length, offset, limit, items: rows.slice(offset, offset + limit) }, issues };
}
export function financialView(stock, snapshot) {
  const reported = stock.reportedFundamentals ?? null, issues = [];
  if (!reported || !Object.values(reported.metrics ?? {}).some(Boolean)) issues.push(issue('FINANCIALS_UNAVAILABLE', '没有可用已披露财务数据', { symbol: stock.symbol }));
  if (reported && reported.cutoff < snapshot.stocks.meta.priceAsOf) issues.push(issue('FINANCIALS_NOT_REVERIFIED', '财报核验截止日早于本期行情', { symbol: stock.symbol, actual: reported.cutoff }));
  return { data: { symbol: stock.symbol, name: stock.name, reported,
    missingMetrics: Object.entries(reported?.metrics ?? {}).filter(([,v]) => v == null).map(([k]) => k),
    staleMetrics: Object.entries(reported?.metrics ?? {}).filter(([,v]) => v?.stale).map(([k]) => k),
    forward: { available: Boolean(stock.fundamental && stock.ranks.fundamental), values: stock.fundamental ?? null, rank: stock.ranks.fundamental ?? null } }, issues };
}
export function calendarView(snapshot, options = {}) {
  const from = options.from ?? snapshot.stocks.meta.priceAsOf, unknown = [];
  const items = snapshot.research.macro.indicators.flatMap(i => {
    if (!i.nextReleaseAt) { unknown.push({ id: i.id, name: i.name, nextPeriod: i.nextPeriod ?? null, reason: 'next_release_not_verified' }); return []; }
    const date = i.nextReleaseAt.slice(0,10);
    if (date < from || (options.to && date > options.to)) return [];
    return [{ id: i.id, name: i.name, period: i.nextPeriod ?? null, releaseAt: i.nextReleaseAt, beijingLabel: i.nextBeijing ?? null,
      consensus: i.consensus ?? null, consensusDisplay: i.consensusDisplay ?? null, consensusSource: i.consensusSource ?? null,
      consensusMissingReason: i.consensusMissingReason ?? null, conditionalImpact: i.conditionalImpact ?? null,
      sourceUrl: i.sourceUrl ?? null, verifiedAt: i.verifiedAt ?? null }];
  }).sort((a,b) => Date.parse(a.releaseAt) - Date.parse(b.releaseAt));
  return { data: { from, to: options.to ?? null, items, unverified: unknown }, issues: unknown.length ? [issue('CALENDAR_INCOMPLETE', '部分指标的下一发布时间未核验，详见 unverified')] : [] };
}
