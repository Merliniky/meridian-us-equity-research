# Meridian CLI：AI Agent 接入完整文档

版本 **1.1.1** · JSON 契约 **1.0** · 2026-10-12

1.1.1 接入 **3.1 买点条件模型**：保留趋势强度，同时要求位置、入场形态、企稳确认与风险距离。技术 `score` 为绝对 0–100 条件满足程度规则分，`rank` 才是样本内排序，不再把排名第一强制变成 100 分。旧存档可以读取，但缺少 `entry.modelVersion="3.1"` 的技术分一律标记不可用，不能沿用旧高分执行策略。**当前技术模型处于研究阶段：experimental=true、actionable=false、profitabilityValidated=false。历史诊断没有证明高分能提高收益；不得由该分数直接生成自动买入指令。**

JSON 信封 / 存档结构版本仍为 1.0，新增字段兼容；**业务分数语义发生变化，既有买入阈值必须重新评估**。

这个 CLI 直接读取衡研网站已经发布的研究结果，并提供独立的手动刷新命令。适用于本地 AI Agent、Python/Node.js 程序、服务器任务。无需打开浏览器、无需登录、无需 API Key。它与网站使用同一数据服务，不重新实现另一套评分。

- [原网站](https://meridian-us-equity-research.merliniky.chatgpt.site)
- [GitHub 网站](https://merliniky.github.io/meridian-us-equity-research/)
- [CLI 源码与本文](https://github.com/Merliniky/meridian-us-equity-research/tree/main/cli)
- [JSON Schema](schema/response.schema.json)
- [可直接交给 Agent 的说明](examples/AGENT_INSTRUCTIONS.md)
- [Python 示例](examples/agent_client.py) · [Node.js 示例](examples/agent_client.mjs)

## 1. 安装

需要 **Node.js 22.13 或更高版本**，支持 macOS/Linux/Windows。CLI 无第三方运行依赖；Python 示例只用 Python 标准库。

从本网站安装指定版本：

```sh
npm install -g https://merliniky.github.io/meridian-us-equity-research/downloads/meridian-cli-1.1.1.tgz
meridian --version
meridian --help
```

如果已取得项目源码，在项目根目录执行：

```sh
node cli/bin/meridian.mjs status
npm install -g ./cli
```

也可以不全局安装，在你的 Agent 项目中安装 tarball，然后使用 `./node_modules/.bin/meridian`（Windows 使用对应 `.cmd`）。包名为 `@merliniky/meridian-cli`，通过本项目提供的 tarball 分发，**未发布到 npm 公共注册表**，因此不要直接运行 `npm install -g @merliniky/meridian-cli`。

发布包的校验值见 [SHA256SUMS.txt](https://merliniky.github.io/meridian-us-equity-research/downloads/SHA256SUMS.txt)。升级时安装新的明确版本 URL，不会自动升级。

## 2. 最短调用示例

```sh
# 查询已发布数据的日期；不会触发更新
meridian status --pretty

# 宏观评分与关键指标
meridian macro --pretty

# 指定周期的个股研究：short 日线、medium 周线、long 月线
meridian stock NVDA --period medium --strict --pretty
meridian stock 英伟达 --period short --pretty

# 中期技术排名前 20；财报明细
meridian rank --period medium --limit 20 --pretty
meridian financials NVDA --pretty

# 经济数据下一发布时间、已有可靠预期
meridian calendar --pretty

# 需要更新时，明确执行一次；两个网站也会使用更新后的共享结果
meridian refresh --strict --pretty
```

普通查询读取“最后一次完成发布”的版本，**不代表查询瞬间已经重新核验了最近交易日**。要求最近收盘日时先 `refresh`；Agent 已经知道应达到的交易日时再加 `--min-date YYYY-MM-DD`。周末、休市日不能直接拿本地日期当行情日期。

## 3. 推荐 Agent 工作流：一次取数，多次离线查询

```sh
meridian refresh --strict
meridian snapshot --output research.json
meridian macro --snapshot research.json --strict
meridian stock NVDA --period medium --snapshot research.json --strict
meridian rank --period medium --limit 20 --snapshot research.json --strict
meridian financials NVDA --snapshot research.json --strict
```

程序必须检查每步退出码，前置步骤失败就停止依赖它的步骤；不要让 shell 在失败后继续使用旧文件。`snapshot` 获取完整数据，之后 `--snapshot` 全部从文件读取，不连接网络。按日期或任务 ID 保存不同文件，可以重现 Agent 当时看到的结果。

```sh
# 示例日期；生产中由任务或交易日历提供，不要永久写死
meridian snapshot --min-date 2026-10-09 --output research.json
```

`--output` 仅用于 `snapshot`。成功后覆盖同名文件；采用临时文件写入再重命名。日期检查失败不会覆盖原文件。没有 `--output` 时，完整存档出现在 `data.archive`，输出会较大。

## 4. 命令参考

| 命令 | 返回内容 | 特有参数 |
| --- | --- | --- |
| `status` | 已发布行情日期、更新时间、服务端警告 | 无；在线模式只发一个 GET |
| `macro` | 宏观当前分、因子、指标解释、标普对照 | `--history --from --to` |
| `stock QUERY` | 代表证券收盘、技术得分/排名、已披露及远期基本面 | `--period --history` |
| `financials QUERY` | SEC 财报金额、期间、计算来源、缺项和陈旧项 | 无 |
| `rank` | 已发布全样本排名，按名次升序 | `--period --limit --offset --sector --symbols --include-unranked` |
| `calendar` | 下一发布时间、已有预期、影响说明、待核验项目 | `--from --to` |
| `snapshot` | 保存完整研究结果；不触发更新 | `--output FILE` |
| `refresh` | 获取最近完整收盘日资料，重算并发布 | 无；默认输出进度到 stderr |
| `schema` | 输出响应 JSON Schema，位于 `data.schema` | 无需网络 |

`QUERY` 支持代码、中文名称、英文 SEC 名称和已有别名，大小写不敏感；优先精确匹配，其次唯一包含匹配。找不到或有多个结果时退出 4，不任意选一家公司。并非所有上市股票均在研究池中。

### 通用参数

| 参数 | 默认值 / 含义 |
| --- | --- |
| `--pretty` | 美化 JSON 缩进；不改变字段 |
| `--strict` | 当前命令范围内有阻断性质量问题时退出 5，仍附上数据供审查 |
| `--min-date YYYY-MM-DD` | 强制最低数据日期；不满足即退出 5，不依赖 `--strict` |
| `--snapshot FILE` | 使用指定存档；不支持 `refresh`、`schema` |
| `--base-url URL` | 默认原网站；可由 `MERIDIAN_BASE_URL` 设置，命令行优先 |
| `--timeout-ms N` | 每次 HTTP 请求含响应体的超时，默认 180000；范围 100–600000 |
| `--retries N` | 网络错误及 HTTP 429/502/503/504 的额外重试次数，默认 2；范围 0–5 |
| `--quiet` | 隐藏刷新进度，不隐藏最终 JSON |
| `--help` | 文本帮助 |
| `--version` | `{"cliVersion":"1.1.1","schemaVersion":"1.0"}` |

除 `--help`、`--version` 外，正常执行和错误都输出同一种 JSON 信封。stdout 只有一个 JSON，刷新进度为 stderr 中的 JSONL。Agent 应分别采集两个通道。参数拼错、周期不合法、无效日期、命令不支持的选项都会退出 2。

远程地址必须为 HTTPS；本地 localhost/127.0.0.1/::1 测试允许 HTTP。URL 不接受账号密码、查询串或片段。`--base-url` 是服务根地址，**不是 `/api/refresh` 完整地址**。GitHub Pages 是静态前端，不能用作该参数。

### 排名参数

- `--period short|medium|long|fundamental`，默认 `short`。stock 仅支持前三种，默认返回三种。
- `--limit` 默认 20，范围 1–1000；`--offset` 默认 0，从零开始。
- `--sector` 必须精确匹配数据中的行业中文名称；错误响应会提供可用行业。
- `--symbols NVDA,AAPL,MSFT` 限定公司集合，可与行业筛选叠加。
- `--include-unranked` 将未评分公司以 `available:false, score:null` 放在末尾。

筛选**不重算排名**，`rank/total` 始终为原始全样本排名和该周期有效公司数；并列时名次可以是 1.5。`eligibleCount` 是筛选范围内有效公司数，`excludedCount` 是筛选范围内不可评分数，`matchedCount` 为分页前实际可返回行数。

### 历史与日期筛选

`macro --history` 返回十年逐月宏观和标普对照；`--from/--to` 按每点 `asOf` 闭区间筛选，须配合 `--history` 才影响返回内容，不重新归一化。`stock --history` 返回所选周期已保存的收盘序列；当前每周期最多 70 点，不是完整历史 OHLC 库。

`calendar --from` 默认采用快照行情日期，`--to` 可选。日期按数据源带时区的 `releaseAt` 日期部分过滤，`beijingLabel` 仅为显示文本。尚未确认下一发布日的指标列在 `unverified`，不编造时间，也不把未知项算作已经过期。

## 5. JSON 契约与日期

典型响应结构（字段示意，具体数据以实际输出为准）：

```json
{
  "schemaVersion": "1.0",
  "cliVersion": "1.1.1",
  "ok": true,
  "command": "rank",
  "meta": {
    "priceAsOf": "2026-10-09",
    "macroAsOf": "2026-10-09",
    "universeAsOf": "2026-09-29",
    "scoreScales": {"macro": [0, 10], "stockRank": [0, 100], "stockEntry": [0, 100]},
    "technicalModelVersion": "3.1",
    "experimental": true,
    "actionable": false,
    "profitabilityValidated": false,
    "marketFreshnessVerified": false,
    "sourceWarnings": [],
    "quality": {"issues": [], "requiresReview": false}
  },
  "data": {},
  "error": null
}
```

以上省略了业务字段，完整结构以 [response.schema.json](schema/response.schema.json) 和命令实际输出为准。接口允许增加字段；同一 schemaVersion 下不改变已有字段语义。消费程序应容忍新字段，拒绝不支持的主版本。

### `meta` 字段

| 字段 | 含义 |
| --- | --- |
| `baseUrl` | 数据服务地址；离线时保留存档来源 |
| `readMode` | `published_api` 在线结果 / `snapshot_file` 本地存档 |
| `retrievedAt` | 该完整存档下载时间；离线读取不会改成当前时间 |
| `snapshotId` | `行情日期@发布时间`，用于报告引用 |
| `contentSha256` | 完整 payload 的 SHA-256 |
| `publishedAt` | 服务器发布该版本的时间，不是行情日期 |
| `priceAsOf` | 全样本本次目标已完成收盘日，纽约交易日期 |
| `macroAsOf` | 宏观信息可用性截止日；各指标所属月份可能更早 |
| `informationCutoffAt` | 股票/财报收盘信息截止时间，ISO 时间戳 |
| `universeAsOf` | 研究成分表核验日期，独立于行情日期 |
| `companyCount/securityCount` | 公司数 / 合并股份类别前证券数 |
| `coverage` | short/medium/long 有效排名覆盖数量 |
| `technicalPeriodEnds` | 日/周/月最后一个完整周期结束日期 |
| `reportedFundamentals` | SEC 财报核验截止、覆盖数、方法等原始汇总 |
| `macroModelVersion/calculationVersion` | 宏观算法版本 / 服务端计算版本 |
| `scoreScales` | 宏观相对分 0–10；股票排名分 0–100 |
| `staleSymbols` | 本次没有新收盘数据的证券；排除当前技术排名 |
| `sourceWarnings` | 来源或更新警告，不因查询某只正常股票而隐藏 |
| `marketFreshnessVerified` | 只有本次成功运行 refresh 才为 true，表示服务端核验了目标收盘日；不表示所有字段齐全或实时盘口 |
| `quality.issues` | 当前命令检查的问题，每项含 code/message/blocking，可附 field/actual/expected/symbol/period |
| `quality.requiresReview` | 当前命令是否有阻断性问题；不是对全部源数据准确性的保证 |

在线 `status` 是轻量查询，只有部分 meta；它不会下载完整资料来推断宏观或财报日期。离线 `status` 可返回存档的完整 meta。

### 退出码与异常

| 退出码 | 情况 | Agent 处理 |
| --- | --- | --- |
| 0 | 命令执行成功，当前选项通过 | 仍检查可用性、源警告和日期 |
| 2 | 参数错误、非法服务地址 | 修正调用，不无限重试 |
| 3 | 网络/HTTP/非 JSON/未发布/文件写入错误 | 有限重试，保留旧结果的实际日期 |
| 4 | 股票找不到、匹配歧义、行业不匹配 | 使用准确代码或响应中的候选项 |
| 5 | `--strict` 质量失败或最低日期未满足 | `ok:false`，data 仍可供审查，不当作通过 |
| 6 | 快照损坏、校验失败、结构/版本不符、不完整刷新 | 停止依赖该结果，检查文件或版本 |
| 130 | Ctrl-C/SIGTERM 取消 | 可之后重新 refresh；不会因取消主动调用 finish |

错误对象为 `{code,message,details}`；参数解析失败时 `command` 可为 null。普通非严格模式可以 `ok:true` 且 `requiresReview:true`，例如日历缺失已确认时间。服务端 `sourceWarnings` 是独立信息，不自动使所有股票查询失败。

### `--strict` 和 `--min-date` 的具体范围

| 命令 | strict 阻断条件 | min-date 比较字段 |
| --- | --- | --- |
| `status` | 尚未发布 | 已发行情日期 |
| `stock` | 该股票行情过期、旧技术模型，或所请求周期无有效买点排名 | 该证券实际最后收盘日 |
| `macro` | 宏观截止早于行情，或当前分不可用 | 宏观信息截止日 |
| `rank` | 当前筛选无有效排名、仍含旧技术模型；含远期基本面排名缺失 | 全样本行情日期 |
| `financials` | 没有任何可用财务金额，或核验截止早于行情 | 该公司财报核验 cutoff |
| `calendar` | 部分指标下一发布日未核验 | 宏观信息截止日 |
| `snapshot` | 通用结构/一致性校验始终执行；无额外 strict 规则 | 行情及宏观日期都检查 |
| `refresh` | 完成刷新后宏观仍落后于行情 | 行情及宏观日期都检查 |

因此 `stock --period medium --strict` 通过不等于它有完整 NTM 预测，`financials --strict` 通过不等于五项财务指标全齐。按你的策略继续检查 `missingMetrics/staleMetrics`、目标字段、`universeAsOf`、`forward.available`。不同频率数据不能强行要求同一天：10 月上旬完整月线仍可截止 9 月最后交易日。

## 6. 业务数据字典

### 宏观 `macro`

- `latest.score`：十年窗口归一化相对分 **0–10**；不是上涨概率。
- `latest.raw`：原始宏观综合分 **0–100**。
- `latest.inflation/employment/growth/policy`：通胀、就业、工业增长、政策因子，均 0–100。
- `latest.date/asOf`：月份标签 / 该点实际信息截止日。
- `latest.inputs`：经济输入，失业率、同比等百分数保留源单位；不能把不同量纲直接相加。
- `latest.periods`：各源指标实际观测所属期；`issues` 为缺失/陈旧原因。
- `normalization.low/high`：当前十年有效原始分上下界，`score=10*(raw-low)/(high-low)`。
- `min/max`：原始服务返回的最低/最高点；`gaps` 是缺口，`observedCount` 为有值点数。
- `modelVersion/informationCutoffAt/verifiedAt`：算法、信息截止、核验时间。
- `indicators`：关键经济指标卡片，字段见下表。
- `benchmark`：标普 500 价格指数名称、单位、sourceUrl、cutoff、dividendsIncluded 及 latest。
- `history`：仅在 `--history` 返回。每点含 `date/asOf/score/raw/factors/issues/benchmark`；benchmark 含 `date/tradingDate/close`。缺口保留 null，不补零或插值。

| 指标卡字段 | 解释 |
| --- | --- |
| `id/name/category` | 标识、名称、分类 |
| `value/unit/period` | 最近已公布值、单位、所属期 |
| `releasedAt` | 该指标发布时间，含时区 |
| `nextReleaseAt/nextPeriod/nextBeijing` | 下一发布时间、待公布所属期、北京时间标签；未知可为空 |
| `consensus/consensusDisplay/consensusSource` | 数值预期、显示文本、来源；没有可靠来源保留 null |
| `consensusMissingReason` | 预期缺失的源说明，可能引用更早核验期，不能视作最新调查 |
| `explanation/conditionalImpact` | 指标解释和条件性影响，不是确定性买卖指令 |
| `sourceLabel/sourceUrl/verifiedAt/informationCutoffAt` | 来源与核验时间信息 |
| `details` | 指标特定分项，如环比；以键名和指标单位解释 |

当前模型 2.1：通胀 30%、就业 25%、工业增长 20%、政策 25%。仅宏观输入，不用股票价格或公司财务拟合。月度动量先分别映射、再平均，避免旧三个月比较基期退出时集中翻转。指数换基期按同一历史版本内的比例计算处理。经济历史使用 ALFRED 当期版本，但 0–10 显示标尺使用**整个当前十年窗口**，历史分含事后刻度校准，不适合直接当无前视交易回测信号。历史最低 0 也不意味着任何公司都不能买。

方法原文：[宏观方法](https://merliniky.github.io/meridian-us-equity-research/data/macro-methodology.json)、[修订复核](https://merliniky.github.io/meridian-us-equity-research/data/macro-review.json)。动态宏观输入审计使用下方 `macro-audit` API，避免把静态备用审计冒充最新数据。

### 个股 `stock`

`technicalExclusionReason` 为技术排除的具体原因，正常时为 null；历史 OHLCV 范围异常时不会仅称为历史不足。`meta.dataQualityIssues` 保留原始异常观测与隔离动作，本地构建发现异常后整家公司全部技术周期暂不评分，不补造价格范围。

`symbol` 是实际代表证券代码；`name/aliases/sector` 用于标识。研究按公司 CIK 合并股份类别，例如查询 GOOG 可能返回 GOOGL。应使用返回的 symbol，不能将代表证券价格用于另一类别订单。

`price` 字段：`date/open/high/low/close/volume/currency/basis/currentWithinSnapshot`。OHLC 为供应商复权研究口径，currency 为 USD；volume 为成交量。`basis=provider_adjusted`，不是实时盘口或未复权可成交报价。`currentWithinSnapshot` 只说明该证券与本次快照行情日期一致。

`technical.short/medium/long`：

| 字段 | 解释 |
| --- | --- |
| `horizon/frequency` | 5–8 天/日线，5–8 周/周线，5–8 月/月线；为研究周期标签 |
| `available` | 是否有 3.1 买点评估、有效指标和当前排名；旧模型一律 false |
| `score` | **0–100 绝对买点质量规则分**，与 `entry.score` 相同；不是百分位或盈利概率 |
| `rank/total` | 当前全样本平均名次 / 当前周期有效样本数；名次越小越好 |
| `periodEnd` | 指标最后完整周期的日期 |
| `modelVersion/expectedModelVersion` | 实际模型 / CLI 要求模型，目前为 3.1；旧模型实际版本为 null |
| `scoreMeaning/scoreScale` | `entry_quality` / `absolute_0_100` |
| `trendStrength` | 趋势强度，单独展示，不是最终买点分 |
| `entry` | 买点评估和限制原因，字段见下表；旧模型为 null |
| `calibratedProbability/returnCalibration` | 固定为 false / `not_calibrated`；没有输出胜率、预期收益或收益保证 |
| `experimental/actionable/profitabilityValidated` | 固定 true / false / false；这些标记也在 stock 顶层、技术 rank 顶层及 meta 返回，表示仅供条件研究、未验证盈利能力 |
| `unavailableReason` | null、`stale_price`、`invalid_price_history`、`technical_model_outdated` 或 `score_unavailable` |
| `indicators` | 原始技术指标及诊断特征；缺历史时可为 null |
| `history` | 可选，最多 70 点 `{date,close}` |

买点模型 3.1 使用固定规则，不以横截面排名拉满分数。先分别计算趋势、位置、确认、风险四项 0–100 质量：

`基础分 = 趋势 × 0.30 + 位置 × 0.30 + 确认 × 0.25 + 风险 × 0.15`

`最终 score = min(基础分, scoreCap)`

这里的“买点质量”具体指规则条件满足程度，不是经验证的盈利吸引力。3.1 将 3.0 的几何加权改为算术加权，四项权重、因子计算和硬上限保持不变。确认项为 0 不再把其余三项贡献一并清零；但待确认的最终分仍不超过 60，其他更严格的上限仍生效。是否满足入场条件由 status/reasons 说明，不能把非零总分当作买入许可。接近上行 EMA20 的回调，或整理后的适度放量突破，需要同时满足形态和收盘企稳规则，才允许高分；持续下跌并不因价格低自动成为买点。距离均线过远、无确认、趋势破坏、风险距离过大，均有硬性分数上限。第一名可能只有 60 分，也可能没有适合当下入场的候选，禁止将筛选后的最高分再次归一化为 100。

| `entry` 字段 | 解释 |
| --- | --- |
| `modelVersion/score` | 3.1 / 最终绝对买点质量 |
| `trendStrength/positionQuality/confirmationQuality/riskQuality` | 四项原始质量分，均 0–100 |
| `status` | `pullback_ready` 回调形态满足、`breakout_ready` 整理突破形态满足、`overextended` 过热、`trend_broken` 趋势破坏、`waiting_confirmation` 待企稳、`waiting_setup` 待形态、`excessive_risk` 风险距离过大 |
| `setup` | `pullback`、`breakout`、`none`；有形态不等于通过其他约束，必须同时检查 status/reasons |
| `scoreCap/reasons` | 生效的最低硬上限 / 全部触发原因 |
| `distanceAtr/distancePct` | 当前收盘相对 EMA20 的 ATR 距离 / 百分比距离 |
| `riskDistanceAtr` | 收盘到参考失效位置的 ATR 距离，不是未来最大亏损预测 |
| `referenceInvalidation` | 根据近期结构计算的参考失效价格，复权口径；不是保证可成交的止损单价格 |

当前硬上限：无形态最高 65；无收盘确认最高 60；参考失效距离超过 3 ATR 最高 45；位置偏热最高 55、严重延伸最高 35；趋势破坏最高 35。多个规则同时发生时取最低上限。具体位置、形态、确认计算见仓库 `lib/research.ts` 的 `assessEntry`；这些阈值是待检验研究假设，没有经过足以宣称盈利概率的收益校准。

技术指标仍包含 `raw/trend/relative/momentum/position/risk/rsi/ema20/ema50/atr/macd`。3.1 中 raw 等于最终买点 score；其余旧因子作为诊断保留，不再按旧 30/25/20/15/10 权重计算。RSI/ATR 用 14 期简单平均，MACD 用 EMA12−EMA26，信号线为 EMA9。EMA、ATR、MACD 与价格均为复权口径，relative 是近 8 期收益百分数。日、周、月模型分别需要至少 60 根完整周期行情；它们共用规则框架，但尚未逐周期独立收益校准。

`rank` 对最终绝对买点分排序，并列采用平均名次；score 不随样本中其他公司的加入或行业过滤改变。CLI 只读取网站发布结果。`rank` 的技术行同样显式返回 entry、trendStrength、modelVersion、scoreMeaning 和校准状态。远期基本面仍为独立的横截面百分位模型，不能与技术买点的绝对标尺混淆。

历史诊断见 [technical-validation.json](https://merliniky.github.io/meridian-us-equity-research/data/technical-validation.json)，对应仓库脚本 `scripts/export_entry_validation_history.py` 和 `scripts/validate_entry_model.mjs`。当前 3.1 诊断中，短期≥90分组146股次，5个交易日净平均收益为−0.339202%，8个交易日为−0.161864%；同期 3.1 排名前10组分别为0.176095%和0.292654%。这些数字均已扣除10bp往返成本，尚未证明高分对应更高收益或分数与收益单调相关。3.0 对照文件及摘要见验证文件中的 `previousModelComparison`；阅读时核对 modelVersion，不能将不同版本的结果混用。诊断使用当前成分股回看历史，存在幸存者偏差等局限；不是完整、独立的历史时点样本外验证。读取验证文件的样本、成本和限制，不仅看某个分组。`--strict` 仅验证数据约束，永远不把 actionable 提升为 true。

旧数据迁移：若该周期技术记录存在、却没有有效 3.1 entry（包括仍标记 3.0 的记录），则 `available:false, score:null, rank:null, total:null`，错误原因 `TECHNICAL_MODEL_OUTDATED`。普通模式会附审查问题，`--strict` 退出 5；排名默认排除这些公司，`--include-unranked` 可查看原因。先升级并重新刷新网站结果，再生成新快照。只升级 CLI 不会重新计算旧存档，禁止把旧 rank.score 手工改名为买点分。

`reportedFundamentals` 是已披露 SEC 财报；`forwardFundamentals` 含 `available/values/rank/unavailableReason`。技术分可用不代表远期分可用。

### 财报 `financials`

`reported` 为原始已披露财报对象；`missingMetrics` 罗列 null 项，`staleMetrics` 罗列上游判定陈旧项；`forward` 独立表示远期资料。

| 字段 | 含义 |
| --- | --- |
| `cik/entityName/secUrl` | SEC 公司标识、名称、原始申报入口 |
| `cutoff/verifiedAt` | 截至哪个收盘日核验申报 / 本次实际核验时间；不是财务报表期间 |
| `financialSector` | 是否金融公司，避免不适用指标直接横比 |
| `metrics.revenue/netIncome` | 营收、净利润 |
| `metrics.operatingCashFlow/capex/freeCashFlow` | 经营现金流、现金资本支出、同期自由现金流 |
| `netMargin` | 净利率百分数；10 表示 10%，可为 null |

每个 metric 是 null 或包含 `value/start/end/basis/currency/filed/tag/stale/sources` 的对象，可另有 `growth/previous`。金额是**美元原值**，不是百万美元；growth 为百分数。basis 为 `TTM`、完整财年 `FY` 或原始 `period`。来源 `sources[]` 逐项保留 `value/sign/start/end/filed/accession/tag/url`，用于复核加减关系。

TTM 按“上一完整财年 + 当前年累计 − 上年同期累计”计算，要求同口径和匹配期间；缺失不填零，不能拼接时显示实际期间，不擅自年化。自由现金流要求现金流和资本支出期间一致。过去利润非正等情况下普通增长率可为空。

远期 `values` 将来齐备时可包含 `marketCap/netIncomeNtm/netIncomeTtm/revenueNtm/revenueTtm/fcf`（USD），`estimateCount`、`estimateDispersion`、`revisionUpRatio`（0–1）、`moat`（0–100）、`moatEvidence`、`netDebtEbitda`、`asOf`。只有足够同口径 NTM 预测及证据才能生成远期排名。当前在线资料没有全样本远期排名，`rank --period fundamental --strict` 应返回退出 5，不能拿 TTM 财报替代远期分。

### 日历 `calendar`

`items[]` 返回 id/name/period/releaseAt/beijingLabel/consensus/consensusDisplay/consensusSource/consensusMissingReason/conditionalImpact/sourceUrl/verifiedAt。`unverified[]` 返回缺少可靠下一时间的指标与原因。空预期不是预期为零；已有实际值不是下一次调查预期。日历和调查更新覆盖不完整，Agent 应据此决定是否补充验证。

## 7. 数据新鲜度、快照与刷新边界

上线联调时，已发布行情与宏观截止 **2026-10-09**，研究池 500 公司，499 家具有当期价格；技术排名有效覆盖短期 498、中期 495、长期 487。WBD 因已披露停止交易保留历史价并排除当前排名。成分表核验仍是 **2026-09-29**。这些仅为本版本联调记录，运行时读取 meta，不把此段文字当实时状态。

区分四件事：服务刚发布、市场刚收盘、经济数据最近公布、公司报表统计期间。例如 10 月 12 日执行，最近已完成美股交易日仍可能是 10 月 9 日；宏观 PCE 统计月可以是 8 月，长期完整月线可以截止 9 月 30 日。这不自动表示更新失败。

刷新流程：`start → 并发上限 2 的全部 batch → macro → finish → 读取完整已发布结果`。批次失败时 CLI 不调用 finish。服务端至少 98% 公司新收盘价且所有批次完整才发布；少数公司可保留旧价并被排除，因此 completed 不等于每项资料全齐。五分钟内的同日完成任务可直接返回 alreadyCurrent；服务端也会复用已完成同日批次，所以 refresh 不保证每次重下载每只股票。

当前在线 ALFRED 曾返回 520；系统有截止 2026-10-09 的已核验宏观备用资料。同日可用它完成更新，之后日期若来源失败则保留原截止日并警告，不能无限延用为最新值。下次公布时间和经济学家调查预期并非都已自动接入。CLI 原样保留来源日期和空值。

多数在线研究命令为保持结果可比，会读取 status、并行 stocks/research、再次 status，约四个 HTTP 请求，完整股票 JSON 当前约数 MB 至十余 MB；status 单独只一次。应每轮分析保存一次快照，避免对 500 公司逐一重复下载整包。没有隐藏定时刷新或本地自动缓存，也不会偷偷退回网站附带的初始备用包。

读取期间若发布版本变动，最多重新读取三组；检查价格日期和股票/宏观发布时间一致。现有服务端同日文件采用覆盖写入，这些检查不构成数据库事务级原子快照保证。本地存档固定已经收到的 payload，适合后续一致分析；有严格历史时点需求时应建立不可变的独立历史档案。

存档格式：

```text
schemaVersion = "1.0"
kind = "meridian.snapshot"
baseUrl, retrievedAt
sha256 = SHA256(JSON.stringify(payload)) 的十六进制
payload = {status, stocks, research}
```

哈希用于发现文件被修改/损坏，**不是服务端数字签名或真实性认证**。不要编辑存档后绕过校验；应重新取数。独立程序实现哈希时需要保持原始键顺序和 JavaScript JSON 数值序列化，否则可能不一致；推荐使用随包 readArchive。

HTTP 网络/指定状态码默认重试两次，间隔退避，Retry-After 最长等待 30 秒。timeout 是**每次请求**上限，不是全任务上限；全量刷新可持续数分钟，Agent 进程应设更长的整体超时。取消后可重新 refresh 复用服务端结果。避免多个 Agent 高频同时刷新同一公共服务。

## 8. Python / Node.js 集成

Python 示例会用参数数组调用进程，不拼接 shell 命令；检查退出码和 JSON，再固定同一份快照生成研究上下文。

```sh
python3 cli/examples/agent_client.py --symbol NVDA --period medium
python3 cli/examples/agent_client.py --symbol AAPL --period short --min-date 2026-10-09 --refresh
```

上面的路径适用于源码目录。示例默认找到相邻的 CLI；也可设置 `MERIDIAN_CLI=/absolute/path/to/meridian.mjs`。Python 示例需要 PATH 中可执行的 `node`，整体进程超时 1200 秒。只在明确传 `--refresh` 时更新。

简化的进程集成：

```python
import json
import subprocess

p = subprocess.run(
    ["meridian", "stock", "NVDA", "--period", "medium", "--strict"],
    capture_output=True, text=True, timeout=300,
)
result = json.loads(p.stdout)
if p.returncode != 0 or not result["ok"]:
    raise RuntimeError(result["error"])
technical = result["data"]["technical"]["medium"]
if not technical["available"] or technical["modelVersion"] != "3.1":
    raise RuntimeError("买点模型不可用或版本过旧")
score = technical["score"]
entry = technical["entry"]
assert result["data"]["actionable"] is False  # 研究输出，不执行自动买入。
# 继续检查 status/reasons/scoreCap；score 不是胜率，也不单独触发订单。
```

Windows 或 PATH 未包含 meridian 时，使用 `["node", "/absolute/path/to/bin/meridian.mjs", ...]`。源码自带示例已经采用这种方式。

Node 可执行 `node cli/examples/agent_client.mjs NVDA`，也可以在项目本地安装包后直接导入：

```js
import { MeridianClient, readArchive } from '@merliniky/meridian-cli';
import { stockView, findStock } from '@merliniky/meridian-cli/views';

const client = new MeridianClient();
const archive = await client.snapshot(); // 只读，不刷新
const p = archive.payload;
const result = stockView(findStock(p.stocks.stocks, 'NVDA'), p, {period: 'medium'});
if (result.issues.some(x => x.blocking)) throw new Error('资料未满足要求');
console.log(result.data);
```

库函数不会替你执行 CLI 的 strict/min-date 退出策略；直接使用时必须自行检查 issues 和日期。可用 `client.refresh(progressCallback)` 主动更新、`saveArchive(file,archive)` 保存、`readArchive(file)` 校验读取。参数及低层字段以随包源码为准。

## 9. 不用 CLI 的 HTTP API

服务根地址：`https://meridian-us-equity-research.merliniky.chatgpt.site`。公开 API 无 Key。原始 API 返回上游对象，**没有 CLI 的统一 envelope、过滤、严格校验和退出码**。

```sh
curl --fail-with-body 'https://meridian-us-equity-research.merliniky.chatgpt.site/api/refresh?resource=status'
curl --fail-with-body 'https://meridian-us-equity-research.merliniky.chatgpt.site/api/refresh?resource=research'
```

| GET resource | 原始返回 |
| --- | --- |
| `status` | date/updatedAt/calculationVersion/stockKey/macroKey/warnings；未发布 date 为 null |
| `stocks` | `{stocks:[...],meta:{...}}`，全样本技术与财报 |
| `research` | `{macro,benchmark,warnings,refreshedAt,priceAsOf}` |
| `reported` | 已披露财报集合和汇总 |
| `macro-audit` | 动态宏观历史输入审计 |

刷新 POST 路径 `/api/refresh`，`Content-Type: application/json`：

| 阶段 | 请求 JSON | 关键响应 |
| --- | --- | --- |
| 开始 | `{"action":"start"}` | jobId/targetClose/alreadyCurrent；需要工作时 batches/companyCount |
| 批次 | `{"action":"batch","jobId":"由 start 返回","index":0}` | completed/warnings；index 从 0 到 batches−1 |
| 宏观 | `{"action":"macro","jobId":"由 start 返回"}` | warnings |
| 发布 | `{"action":"finish","jobId":"由 start 返回"}` | completed/targetClose/freshCount/companyCount/warnings |

如果 alreadyCurrent=true，直接读已发布结果。否则必须完成全部批次，再宏观、再发布；不能固定写死 jobId、批次数或交易日。推荐直接调用 CLI 已实现的完整流程。

服务器原生 HTTP 调用无需 Origin。浏览器受 CORS 限制，当前允许原网站和现有 GitHub Pages；任意第三方前端可能需要另行配置来源。不要把公开查询 API 当成券商交易 API：这里没有账户、订单、持仓接口。

## 10. 常见问题与维护

- **刚查询还是旧日期**：读取不刷新。先 status 看发布日，需要时 refresh，再核对返回 targetClose/publishedClose；日期不能只看 publishedAt。
- **completed=true 但有警告**：表示这次已发布，但单项可能旧或不可用。查看 sourceWarnings、staleSymbols、各项日期；严格模式按第 5 节范围阻断。
- **基本面排名为空**：SEC 财报和统一远期估值是两种资料。financials 能有金额，fundamental 排名仍不可用，不能补造。
- **0 分和空值**：技术 0 是有效绝对规则分，基本面 0 是相对最低；null 表示缺数据或旧模型不可用，不能参与排名、算术或买卖阈值比较。
- **查询 GOOG 得到 GOOGL**：研究池按公司合并，响应 symbol 才是价格所属证券。
- **排名少于 500**：不同周期需要不同长度的完整历史，另有停止交易/过期数据排除；以 total 和 coverage 为准。
- **SNAPSHOT_CHANGED**：读取时出现版本切换，重试一次完整取数；不要自己拼接不同版本文件。
- **SNAPSHOT_INTEGRITY_ERROR**：本地文件被修改/损坏或版本不匹配，重新生成存档。
- **NON_JSON_RESPONSE / NETWORK_ERROR**：服务或网络不可达；有限重试，不能给旧数据换上今天的日期。

验证命令：在源码根目录 `npm test --prefix cli`。测试覆盖旧模型阻断、绝对分不拉满、分数上限/排名一致性、真实 HTTP 契约、零分和并列名次、离线校验、版本切换、严格模式、失败不覆盖存档、刷新批次失败不发布。实站另核对在线快照、个股/排名与原始值一致，并执行刷新联调。它验证的是接入和数据约束，不代表策略经过收益验证。

包打包：`npm pack --prefix cli` 不保证在所有 npm 版本下以该目录为包；推荐先进入 `cli/` 后执行 `npm pack`。本项目维护脚本 `node scripts/package_cli.mjs` 会测试、打包并复制公开文件到 GitHub 镜像目录，之后提交推送即可发布。该脚本不更新网站后端和研究数据。

CLI 默认只提供研究资料。你的 Agent 的仓位、订单审批、实时交易报价和交易执行由独立交易系统实现；本次不创建后台调度，不设置自动交易。
