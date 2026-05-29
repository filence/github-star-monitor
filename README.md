# GitHub 星标仓库 Release Telegram 监控

这个项目会通过 `GitHub Actions` 每天定时检查你的 GitHub 星标仓库，只监控 `Release`，并将结果发送到 Telegram。

当前行为如下：

- 每天自动运行一次，也支持手动触发
- 每次都会重新拉取你当前的全部星标仓库
- 新标星仓库从“首次被任务看到的时间”开始跟踪
- 不补发历史 Release
- 第 1 条消息发送总览
- 后续每个有更新的仓库发送 1 条详情消息
- 默认没有更新时不发消息

## 目录结构

```text
.github/workflows/daily-release-watch.yml
data/state.json
src/
  format.js
  github.js
  main.js
  state.js
  telegram.js
```

## 前置准备

### 1. 创建 Telegram Bot

1. 在 Telegram 中找到 `@BotFather`
2. 发送 `/newbot`
3. 按提示创建 bot
4. 保存返回的 `bot token`
5. 给你的 bot 先发送一条任意消息

### 2. 获取 Telegram chat_id

给 bot 发过消息后，打开下面这个链接：

```text
https://api.telegram.org/bot<你的BOT_TOKEN>/getUpdates
```

在返回 JSON 里找到：

```json
{
  "message": {
    "chat": {
      "id": 123456789
    }
  }
}
```

这里的 `id` 就是 `TELEGRAM_CHAT_ID`。

### 3. 创建 GitHub Token

建议使用 `Fine-grained personal access token`。

这个项目至少需要下面这些权限：

- `Starring` user permissions: `Read`
- `Metadata` repository permissions: `Read`
- `Contents` repository permissions: `Read`

如果你只监控公开仓库的 Release，`List releases` 接口对公开资源本身可匿名访问；但因为本项目还要读取你“当前用户的星标列表”，所以仍然建议使用一个专用 token。

## GitHub Secrets 配置

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 里新增以下 secrets：

- `GH_STAR_MONITOR_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `DEEPSEEK_API_KEY`（第二期启用智能增强时必填）

可选变量：

- `SEND_EMPTY_SUMMARY`
  - 设为 `true` 时，即使当天没有更新，也会发送一条总览消息
  - 默认不设置或设为 `false`
- `LLM_ENABLED`
  - 设为 `true` 时启用第二期智能增强
  - 默认不设置或设为 `false`
- `LLM_PROVIDER`
  - 当前填 `deepseek`
  - 默认值为 `deepseek`
- `DEEPSEEK_BASE_URL`
  - 默认值为 `https://api.deepseek.com`
- `DEEPSEEK_MODEL`
  - 默认值为 `deepseek-chat`
- `LLM_TIMEOUT_MS`
  - 单次模型调用超时，默认 `20000`
- `LLM_TEMPERATURE`
  - 默认 `0.2`
- `LLM_MAX_NOTES_CHARS`
  - 单次输入的 Release Notes 总字符保护上限，默认 `12000`

## 首次运行行为

首次运行时：

- 当前所有已星标仓库都会被写入 `data/state.json`
- 它们的 `tracked_since` 会被设置为首次运行时间
- 不会补发旧 Release

后续如果你又星标了新仓库：

- 下次运行会自动发现它
- 从首次发现时间开始跟踪
- 同样不会补发历史 Release

如果你取消星标某个仓库：

- 下次运行会自动把它从跟踪列表中移除

## 本地运行

先在 PowerShell 中设置环境变量：

```powershell
$env:GH_STAR_MONITOR_TOKEN="你的GitHubToken"
$env:TELEGRAM_BOT_TOKEN="你的TelegramBotToken"
$env:TELEGRAM_CHAT_ID="你的ChatId"
$env:LLM_ENABLED="true"
$env:DEEPSEEK_API_KEY="你的DeepSeekKey"
```

然后执行：

```powershell
npm run check
npm start
```

## GitHub Actions 运行时间

当前 workflow 里写的是：

```yaml
cron: "0 1 * * *"
```

GitHub Actions 的 `schedule` 使用 `UTC`。  
这表示它会在每天 `01:00 UTC` 运行，也就是北京时间每天 `09:00` 运行。

## 消息格式

### 总览消息

- 生成时间
- 更新仓库数
- 新 Release 数
- 新增纳入跟踪数
- 今日更新中文概括（第二期启用时）
- 今日有更新的仓库列表

### 每仓库详情消息

- 仓库名
- 仓库级中文概括（第二期启用时）
- 本次新增 Release 数
- 每个 Release 的标题
- 每个 Release 的中文标题（第二期启用时）
- Tag
- 发布时间
- 是否为 pre-release
- Release 链接
- 中文摘要与关键点（第二期启用时）
- 回退时仍使用第一期的 Release Notes 摘要

摘要使用：

- 前几行限制
- 最大字符数限制

这样可以尽量避免 Telegram 单条消息过长。

## 第二期智能增强说明

当 `LLM_ENABLED=true` 时，程序会：

- 先对“今日总览”调用一次 DeepSeek，总结今天这些更新主要在做什么
- 再按仓库逐个调用 DeepSeek，生成仓库概括、中文标题、中文摘要和关键点
- 在 Telegram 消息里加入 `📣` 和 `🚀` 图标头部，方便和其他 bot 区分

当 DeepSeek 调用失败、超时、限流、返回非法 JSON 或字段不完整时：

- 总览消息自动退回第一期格式
- 单个仓库详情自动退回第一期格式
- Telegram 发送继续执行，优先保证日报能发出去

## 状态文件说明

`data/state.json` 是任务的持久化状态，GitHub Actions 每次成功运行后会自动提交它的变化。

主要字段：

- `global.last_success_at`
- `repos.<owner/repo>.tracked_since`
- `repos.<owner/repo>.last_notified_release_id`
- `repos.<owner/repo>.last_notified_release_published_at`

## 注意事项

- 如果 Telegram 消息发送到一半失败，本次 workflow 会失败，下一次重跑时可能重复发送本次部分消息
- 目前只监控 GitHub Release，不监控 commit、issue、pull request
- 目前每个仓库只发 1 条详情消息；如果同一个仓库在一次检查周期内有多个新 Release，会合并到同一条消息里

## 当前部署记录

- 仓库地址：`https://github.com/filence/github-star-monitor`
- 已配置 Secrets：`GH_STAR_MONITOR_TOKEN`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`
- 当前通知策略：`SEND_EMPTY_SUMMARY=true`，即使当天没有更新也会发送总览消息
- 首次成功运行时间：北京时间 `2026-05-28 16:33:31`，对应 UTC `2026-05-28T08:33:31.974Z`
