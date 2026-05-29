# GitHub Release Telegram 第二期智能化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏第一期稳定流程的前提下，为 GitHub Release Telegram 监控接入 DeepSeek 智能增强，支持中文标题翻译、中文摘要、总览中文概括，并在失败时自动降级回第一期发送逻辑。

**Architecture:** 在现有 `collectUpdates -> build message -> send telegram` 主链路中插入独立 AI 服务层。AI 服务通过 provider 抽象调用 DeepSeek，并把结构化增强结果交给格式化层；当 AI 调用或解析失败时，格式化层继续使用第一期原始数据渲染消息。

**Tech Stack:** Node.js ESM、原生 `fetch`、GitHub REST API、Telegram Bot API、DeepSeek Chat API

---

### Task 1: 统一配置入口

**Files:**
- Create: `src/config.js`
- Modify: `src/main.js`
- Test: `src/config.js`（通过 `node --check` 和本地运行验证）

- [ ] **Step 1: 编写配置模块骨架**

```js
function parseBoolean(value, defaultValue = false) {
  if (value == null || value === "") {
    return defaultValue;
  }

  return value === "true";
}

function parseInteger(value, fieldName, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} 必须是整数`);
  }

  return parsed;
}

function getRequired(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必要环境变量: ${name}`);
  }

  return value;
}

export function getAppConfig() {
  const llmEnabled = parseBoolean(process.env.LLM_ENABLED, false);
  const provider = process.env.LLM_PROVIDER ?? "deepseek";

  if (llmEnabled && provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("启用 LLM 时必须提供 DEEPSEEK_API_KEY");
  }

  return {
    githubToken: getRequired("GH_STAR_MONITOR_TOKEN"),
    telegramBotToken: getRequired("TELEGRAM_BOT_TOKEN"),
    telegramChatId: getRequired("TELEGRAM_CHAT_ID"),
    sendEmptySummary: parseBoolean(process.env.SEND_EMPTY_SUMMARY, false),
    llm: {
      enabled: llmEnabled,
      provider,
      timeoutMs: parseInteger(process.env.LLM_TIMEOUT_MS, "LLM_TIMEOUT_MS", 20000),
      temperature: Number(process.env.LLM_TEMPERATURE ?? "0.2"),
      maxNotesChars: parseInteger(
        process.env.LLM_MAX_NOTES_CHARS,
        "LLM_MAX_NOTES_CHARS",
        12000
      ),
      deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY ?? "",
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
        model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat"
      }
    }
  };
}
```

- [ ] **Step 2: 在 `src/main.js` 中切换到统一配置读取**

```js
import { getAppConfig } from "./config.js";

async function run() {
  const config = getAppConfig();
  const nowIso = new Date().toISOString();
  const state = await loadState();

  const { updates, newTrackedRepos, removedTrackedRepos, starredRepositories } =
    await collectUpdates({
      githubToken: config.githubToken,
      state,
      nowIso
    });
}
```

- [ ] **Step 3: 运行语法检查**

Run: `npm run check`
Expected: 所有 `src/*.js` 文件语法检查通过

- [ ] **Step 4: 本地验证缺少配置时报错**

Run: `node -e "import('./src/config.js').then(m => { try { m.getAppConfig(); } catch (error) { console.log(error.message); } })"`
Expected: 输出类似“缺少必要环境变量”的明确信息

### Task 2: 建立提示词与 provider 抽象

**Files:**
- Create: `src/prompts.js`
- Create: `src/ai/provider.js`
- Test: `src/prompts.js`, `src/ai/provider.js`

- [ ] **Step 1: 编写总览提示词构造函数**

```js
export function buildOverviewPrompt({ generatedAt, updates }) {
  const payload = updates.map((update) => ({
    full_name: update.fullName,
    release_count: update.releases.length,
    releases: update.releases.map((release) => ({
      release_id: release.id,
      title: release.name,
      body: release.body
    }))
  }));

  return [
    "你是一个负责整理 GitHub Release 日报的中文助手。",
    "请只输出 JSON，不要输出 Markdown，不要输出解释。",
    "请基于输入内容总结今天这些更新主要在做什么。",
    "JSON 结构必须为：{\"summary_zh\":\"...\"}",
    "summary_zh 用简体中文，控制在 1 到 3 句。",
    `生成时间: ${generatedAt}`,
    JSON.stringify(payload)
  ].join("\n");
}
```

- [ ] **Step 2: 编写仓库详情提示词构造函数**

```js
export function buildRepoPrompt(update) {
  const payload = {
    full_name: update.fullName,
    releases: update.releases.map((release) => ({
      release_id: release.id,
      title: release.name,
      tag_name: release.tagName,
      body: release.body
    }))
  };

  return [
    "你是一个负责整理 GitHub Release 中文摘要的助手。",
    "请只输出 JSON，不要输出 Markdown，不要输出解释。",
    "请返回仓库概括、每个 Release 的中文标题、中文摘要和 2 到 3 个关键点。",
    "JSON 结构必须为：",
    "{\"full_name\":\"...\",\"repo_summary_zh\":\"...\",\"releases\":[{\"release_id\":1,\"title_zh\":\"...\",\"summary_zh\":\"...\",\"highlights_zh\":[\"...\",\"...\"]}]}",
    JSON.stringify(payload)
  ].join("\n");
}
```

- [ ] **Step 3: 编写 provider 工厂**

```js
import { createDeepSeekProvider } from "./deepseek.js";

export function createAiProvider(llmConfig) {
  if (llmConfig.provider === "deepseek") {
    return createDeepSeekProvider(llmConfig);
  }

  throw new Error(`不支持的 LLM_PROVIDER: ${llmConfig.provider}`);
}
```

- [ ] **Step 4: 运行语法检查**

Run: `npm run check`
Expected: 新增文件通过语法检查

### Task 3: 实现 DeepSeek provider

**Files:**
- Create: `src/ai/deepseek.js`
- Modify: `src/ai/provider.js`
- Test: `src/ai/deepseek.js`

- [ ] **Step 1: 编写超时请求辅助函数**

```js
function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    }
  };
}
```

- [ ] **Step 2: 编写单次 DeepSeek 调用**

```js
async function requestDeepSeek({ baseUrl, apiKey, model, timeoutMs, temperature, prompt }) {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`DeepSeek 请求失败 (${response.status}): ${text}`);
      error.status = response.status;
      throw error;
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content ?? "";
  } finally {
    cleanup();
  }
}
```

- [ ] **Step 3: 编写重试包装和 provider 接口**

```js
function shouldRetry(error) {
  return error.name === "AbortError" || error.status === 429 || error.status >= 500;
}

export function createDeepSeekProvider(llmConfig) {
  const config = llmConfig.deepseek;

  return {
    async generateText(prompt) {
      let attempt = 0;
      let lastError;

      while (attempt < 2) {
        try {
          return await requestDeepSeek({
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            timeoutMs: llmConfig.timeoutMs,
            temperature: llmConfig.temperature,
            prompt
          });
        } catch (error) {
          lastError = error;
          if (!shouldRetry(error) || attempt === 1) {
            throw lastError;
          }
        }

        attempt += 1;
      }

      throw lastError;
    }
  };
}
```

- [ ] **Step 4: 运行语法检查**

Run: `npm run check`
Expected: `src/ai/deepseek.js` 通过语法检查

### Task 4: 实现 AI service 与降级逻辑

**Files:**
- Create: `src/ai/service.js`
- Modify: `src/prompts.js`
- Test: `src/ai/service.js`

- [ ] **Step 1: 编写输入裁剪函数**

```js
function trimReleaseBody(body, maxChars) {
  const normalized = String(body ?? "").replaceAll("\r\n", "\n").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}…`;
}

function buildTrimmedUpdate(update, maxCharsPerRelease) {
  return {
    ...update,
    releases: update.releases.map((release) => ({
      ...release,
      body: trimReleaseBody(release.body, maxCharsPerRelease)
    }))
  };
}
```

- [ ] **Step 2: 编写 JSON 解析与结构校验**

```js
function parseJsonOrThrow(text) {
  return JSON.parse(text);
}

function validateOverviewResult(value) {
  return Boolean(value && typeof value.summary_zh === "string" && value.summary_zh.trim());
}

function validateRepoResult(value, update) {
  if (!value || value.full_name !== update.fullName || !Array.isArray(value.releases)) {
    return false;
  }

  return update.releases.every((release) =>
    value.releases.some(
      (item) =>
        item.release_id === release.id &&
        typeof item.title_zh === "string" &&
        item.title_zh.trim() &&
        typeof item.summary_zh === "string" &&
        item.summary_zh.trim()
    )
  );
}
```

- [ ] **Step 3: 编写总览增强函数**

```js
import { buildOverviewPrompt, buildRepoPrompt } from "../prompts.js";
import { createAiProvider } from "./provider.js";

export async function enrichOverview({ llmConfig, generatedAt, updates }) {
  if (!llmConfig.enabled || updates.length === 0) {
    return null;
  }

  try {
    const provider = createAiProvider(llmConfig);
    const prompt = buildOverviewPrompt({ generatedAt, updates });
    const rawText = await provider.generateText(prompt);
    const parsed = parseJsonOrThrow(rawText);

    if (!validateOverviewResult(parsed)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn(`总览 AI 增强失败，将回退到第一期格式: ${error.message}`);
    return null;
  }
}
```

- [ ] **Step 4: 编写仓库增强函数**

```js
export async function enrichRepoUpdate({ llmConfig, update }) {
  if (!llmConfig.enabled) {
    return null;
  }

  try {
    const provider = createAiProvider(llmConfig);
    const trimmedUpdate = buildTrimmedUpdate(update, 3500);
    const prompt = buildRepoPrompt(trimmedUpdate);
    const rawText = await provider.generateText(prompt);
    const parsed = parseJsonOrThrow(rawText);

    if (!validateRepoResult(parsed, update)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn(`${update.fullName} AI 增强失败，将回退到第一期格式: ${error.message}`);
    return null;
  }
}
```

- [ ] **Step 5: 运行语法检查**

Run: `npm run check`
Expected: `src/ai/service.js` 通过语法检查

### Task 5: 升级消息格式化层

**Files:**
- Modify: `src/format.js`
- Test: `src/format.js`

- [ ] **Step 1: 扩展总览消息渲染**

```js
export function buildOverviewMessage({
  generatedAt,
  updatedRepoCount,
  totalReleaseCount,
  newTrackedCount,
  repoNames,
  insight
}) {
  const baseLines = [
    "<b>📣 GitHub 星标 Release 日报</b>",
    `生成时间：${escapeHtml(toBeijingDateTime(generatedAt))}`,
    `更新仓库数：${updatedRepoCount}`,
    `新 Release 数：${totalReleaseCount}`,
    `新增纳入跟踪：${newTrackedCount}`
  ];

  if (insight?.summary_zh) {
    baseLines.push("", "<b>今日更新概括</b>", escapeHtml(truncatePlainText(insight.summary_zh, 300)));
  }

  baseLines.push("", "<b>今日有更新的仓库</b>");

  if (repoNames.length === 0) {
    return [...baseLines, "• 无"].join("\n");
  }

  const repoLines = repoNames.map((name) => `• <code>${escapeHtml(truncatePlainText(name, 200))}</code>`);
  return [...baseLines, ...repoLines].join("\n");
}
```

- [ ] **Step 2: 扩展仓库详情消息渲染**

```js
function buildAiReleaseSection(release, enhancedRelease) {
  const originalTitle = escapeHtml(truncatePlainText(release.name || release.tagName || "未命名 Release", 200));
  const titleZh = escapeHtml(truncatePlainText(enhancedRelease.title_zh, 120));
  const summaryZh = escapeHtml(truncatePlainText(enhancedRelease.summary_zh, 220));
  const highlights = (enhancedRelease.highlights_zh ?? [])
    .slice(0, 3)
    .map((item) => `- ${escapeHtml(truncatePlainText(item, 80))}`);

  return [
    `• <b>原始标题：</b>${originalTitle}`,
    `• <b>中文标题：</b>${titleZh}`,
    `发布时间：${escapeHtml(toBeijingDateTime(release.publishedAt))}`,
    `Pre-release：${formatPrereleaseFlag(release.isPrerelease)}`,
    `链接：<a href="${escapeHtml(release.htmlUrl)}">打开 Release</a>`,
    "中文摘要：",
    summaryZh,
    ...(highlights.length > 0 ? ["关键点：", ...highlights] : [])
  ].join("\n");
}
```

- [ ] **Step 3: 在仓库详情主函数中优先使用增强结果**

```js
export function buildRepoUpdateMessage(update, insight = null) {
  const headerLines = [
    `<b>🚀 ${escapeHtml(truncatePlainText(update.fullName, 200))}</b>`,
    `仓库链接：<a href="${escapeHtml(update.htmlUrl)}">${escapeHtml(update.fullName)}</a>`,
    `本次新增 Release：${update.releases.length}`
  ];

  if (insight?.repo_summary_zh) {
    headerLines.push(`本仓库更新概括：${escapeHtml(truncatePlainText(insight.repo_summary_zh, 180))}`);
  }

  headerLines.push("");

  const releaseLines = update.releases.map((release) => {
    const enhancedRelease = insight?.releases?.find((item) => item.release_id === release.id);
    return enhancedRelease ? buildAiReleaseSection(release, enhancedRelease) : buildReleaseSection(release);
  });

  return `${headerLines.join("\n")}${releaseLines.join("\n\n──────────\n\n")}`;
}
```

- [ ] **Step 4: 运行语法检查**

Run: `npm run check`
Expected: `src/format.js` 通过语法检查

### Task 6: 接入主流程并保持 state 稳定

**Files:**
- Modify: `src/main.js`
- Test: `src/main.js`

- [ ] **Step 1: 在主流程中接入总览增强**

```js
import { enrichOverview, enrichRepoUpdate } from "./ai/service.js";

const overviewInsight = await enrichOverview({
  llmConfig: config.llm,
  generatedAt: nowIso,
  updates
});
```

- [ ] **Step 2: 在发送仓库消息前逐个接入仓库增强**

```js
for (const update of updates) {
  const repoInsight = await enrichRepoUpdate({
    llmConfig: config.llm,
    update
  });

  const detailMessage = buildRepoUpdateMessage(update, repoInsight);
  await sendTelegramMessage({
    botToken: config.telegramBotToken,
    chatId: config.telegramChatId,
    text: detailMessage
  });
}
```

- [ ] **Step 3: 保持 state 更新逻辑不依赖 AI 成功**

```js
for (const update of updates) {
  const latestRelease = getNewestRelease(update.releases);
  state.repos[update.fullName].last_notified_release_id = latestRelease.id;
  state.repos[update.fullName].last_notified_release_published_at = latestRelease.publishedAt;
}
```

- [ ] **Step 4: 运行语法检查**

Run: `npm run check`
Expected: 主流程改动后语法检查仍通过

### Task 7: 更新 README 与运行说明

**Files:**
- Modify: `README.md`
- Test: `README.md`（读回检查）

- [ ] **Step 1: 新增第二期环境变量说明**

```md
## 第二期智能增强配置

可选新增环境变量：

- `LLM_ENABLED=true`
- `LLM_PROVIDER=deepseek`
- `DEEPSEEK_API_KEY=你的DeepSeekKey`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-chat`
- `LLM_TIMEOUT_MS=20000`
- `LLM_TEMPERATURE=0.2`
- `LLM_MAX_NOTES_CHARS=12000`
```

- [ ] **Step 2: 新增失败降级说明**

```md
当 DeepSeek 调用失败、超时、限流或返回非法数据时：

- 总览消息会自动退回第一期格式
- 仓库详情会自动退回第一期格式
- Telegram 发送仍会继续执行
```

- [ ] **Step 3: 读回 README 关键章节**

Run: `Get-Content -Raw README.md`
Expected: 第二期配置和降级说明已出现在 README 中

### Task 8: 本地验证与上线前检查

**Files:**
- Modify: `package.json`
- Test: `package.json`, `src/*.js`

- [ ] **Step 1: 扩展 `npm run check` 覆盖新增文件**

```json
{
  "scripts": {
    "check": "node --check src/main.js && node --check src/github.js && node --check src/state.js && node --check src/telegram.js && node --check src/format.js && node --check src/config.js && node --check src/prompts.js && node --check src/ai/provider.js && node --check src/ai/deepseek.js && node --check src/ai/service.js"
  }
}
```

- [ ] **Step 2: 运行语法检查**

Run: `npm run check`
Expected: 所有脚本文件语法正确

- [ ] **Step 3: 模拟 AI 关闭场景**

Run: `[PowerShell] $env:LLM_ENABLED='false'; npm start`
Expected: 行为与第一期一致，不因 AI 关闭而报错

- [ ] **Step 4: 模拟 AI 开启但失败场景**

Run: `[PowerShell] $env:LLM_ENABLED='true'; $env:DEEPSEEK_API_KEY='invalid'; npm start`
Expected: 控制台出现“AI 增强失败，将回退到第一期格式”类似日志，同时流程继续发送 Telegram

- [ ] **Step 5: 手动触发 GitHub Actions 验证**

Run: 在 GitHub Actions 中手动触发 `daily-release-watch`
Expected: 日志中可看到 GitHub 抓取、AI 增强或降级、Telegram 发送、state 保存等阶段信息
