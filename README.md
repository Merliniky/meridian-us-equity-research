# 衡研 Meridian · 美股研究台

GitHub Pages 副本。原网站继续保留，两处使用相同界面，并从原网站的更新服务读取最新结果。

- 原网站：https://meridian-us-equity-research.merliniky.chatgpt.site
- 随页面附带的备用快照截止：2026-09-29T16:00:00-04:00（美东收盘）
- 股票池：500 家公司
- 宏观模型：2.1，仅使用宏观数据，叠加标普 500 供对照
- 财报逐项提供统计期间、计算来源及 SEC 原文链接；远期资料不足时不生成虚构排名

网页不自动刷新。点击刷新按钮后，通过原网站的公开更新接口获取最近已完成交易日行情、核验财报及宏观数据，并重算全市场排名。两处网站共用更新结果，失败项保留实际日期。备用快照只在服务不可用时使用。

此仓库包含网站发布文件、公开研究快照及 CLI 源码和文档，不包含原始本地量化目录或账户凭据。GitHub Pages 从 main 分支根目录发布，.nojekyll 禁用 Jekyll 转换。

<!-- meridian-cli:start -->
## AI Agent CLI

无需登录的 Node.js CLI，默认 JSON 输出，支持宏观、个股、排名、SEC 财报、经济日历、离线快照及手动刷新。

`npm install -g https://merliniky.github.io/meridian-us-equity-research/downloads/meridian-cli-1.0.0.tgz`

[完整接入文档](cli/README.md) · [Agent 说明](cli/examples/AGENT_INSTRUCTIONS.md) · [Python 示例](cli/examples/agent_client.py) · [JSON Schema](cli/schema/response.schema.json) · [安装包](downloads/meridian-cli-1.0.0.tgz)

宏观分为 0–10，个股排名分为 0–100。查询不自动刷新；远期基本面排名缺失时保留空值。CLI 源码与测试也在本仓库中。
<!-- meridian-cli:end -->
