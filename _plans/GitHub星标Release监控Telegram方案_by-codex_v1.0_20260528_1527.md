# GitHub 星标 Release 监控 Telegram 方案实施计划

> 标题：GitHub 星标 Release 监控 Telegram 方案实施计划
>
> 生成时间：2026-05-28 15:27
>
> 生成者：Codex
>
> 版本：v1.0
>
> 用途：为 GitHub Actions 自动监控星标仓库 Release 并推送 Telegram 消息提供最小可用实现计划

# GitHub Star Release Telegram Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Actions based daily monitor that checks the user's starred repositories, starts tracking newly starred repositories from first seen time, and sends one Telegram overview message plus one message per updated repository release.

**Architecture:** Use a small Node.js script as the workflow entrypoint. The script reads a committed JSON state file, fetches starred repositories and releases from GitHub, computes newly tracked and updated repositories, sends Telegram messages, then writes the updated state back to the repository so the next run can continue incrementally.

**Tech Stack:** GitHub Actions, Node.js 20, GitHub REST API, Telegram Bot API, JSON state file

---

### Task 1: Scaffold project files

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `src/main.js`
- Create: `src/github.js`
- Create: `src/state.js`
- Create: `src/telegram.js`
- Create: `src/format.js`
- Create: `data/state.json`
- Create: `.github/workflows/daily-release-watch.yml`
- Create: `README.md`

- [ ] **Step 1: Create the base folders and package metadata**

```json
{
  "name": "github-star-release-telegram-monitor",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/main.js",
    "check": "node --check src/main.js && node --check src/github.js && node --check src/state.js && node --check src/telegram.js && node --check src/format.js"
  }
}
```

- [ ] **Step 2: Add a checked-in JSON state file with an empty initial shape**

```json
{
  "global": {
    "last_success_at": null
  },
  "repos": {}
}
```

- [ ] **Step 3: Add a workflow that supports schedule plus manual trigger**

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "0 1 * * *"
```

### Task 2: Implement state persistence and GitHub API access

**Files:**
- Modify: `src/state.js`
- Modify: `src/github.js`
- Test: local dry run via `node src/main.js`

- [ ] **Step 1: Implement state reader and writer**

```js
export async function loadState() {}
export async function saveState(state) {}
```

- [ ] **Step 2: Implement starred repository pagination**

```js
export async function listStarredRepositories(token) {}
```

- [ ] **Step 3: Implement per-repository release fetch**

```js
export async function listRepositoryReleases(token, fullName) {}
```

- [ ] **Step 4: Normalize GitHub API results into fields the monitor needs**

```js
{
  fullName,
  htmlUrl,
  releases: [
    {
      id,
      name,
      tagName,
      htmlUrl,
      body,
      publishedAt,
      isPrerelease
    }
  ]
}
```

### Task 3: Implement Telegram message formatting and sending

**Files:**
- Modify: `src/format.js`
- Modify: `src/telegram.js`

- [ ] **Step 1: Create overview message formatter**

```js
export function buildOverviewMessage(payload) {}
```

- [ ] **Step 2: Create per-release message formatter with dual truncation**

```js
export function buildReleaseMessage(releaseEntry) {}
```

- [ ] **Step 3: Implement Telegram sendMessage wrapper**

```js
export async function sendTelegramMessage({ botToken, chatId, text }) {}
```

- [ ] **Step 4: Ensure Markdown-safe output by escaping risky characters or falling back to plain text**

```js
const parseMode = "HTML";
```

### Task 4: Implement monitor flow

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Read required environment variables**

```js
const requiredEnvNames = [
  "GH_STAR_MONITOR_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID"
];
```

- [ ] **Step 2: Load state and fetch current starred repositories**

```js
const state = await loadState();
const starredRepos = await listStarredRepositories(token);
```

- [ ] **Step 3: Register newly starred repositories with tracked_since = now and no backfill**

```js
if (!state.repos[fullName]) {
  state.repos[fullName] = {
    full_name: fullName,
    tracked_since: nowIso,
    last_notified_release_id: null,
    last_notified_release_published_at: null
  };
}
```

- [ ] **Step 4: Remove repositories no longer starred**

```js
for (const fullName of Object.keys(state.repos)) {
  if (!currentStarredSet.has(fullName)) {
    delete state.repos[fullName];
  }
}
```

- [ ] **Step 5: Collect new releases after tracked_since or last_notified_release_published_at**

```js
const cutoff = repoState.last_notified_release_published_at ?? repoState.tracked_since;
```

- [ ] **Step 6: Send one overview message then one message per updated release**

```js
await sendTelegramMessage(...overview);
for (const item of updates) {
  await sendTelegramMessage(...detail);
}
```

- [ ] **Step 7: Update state only after successful Telegram delivery**

```js
state.global.last_success_at = nowIso;
await saveState(state);
```

### Task 5: Make the workflow persist state back to the repository

**Files:**
- Modify: `.github/workflows/daily-release-watch.yml`

- [ ] **Step 1: Check out the repository with write capability**

```yaml
- uses: actions/checkout@v4
  with:
    persist-credentials: true
```

- [ ] **Step 2: Set up Node and install dependencies**

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "20"
```

- [ ] **Step 3: Run the monitor with repository secrets**

```yaml
env:
  GH_STAR_MONITOR_TOKEN: ${{ secrets.GH_STAR_MONITOR_TOKEN }}
  TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
  TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

- [ ] **Step 4: Commit updated data/state.json when it changed**

```yaml
- name: Commit state
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add data/state.json
    git diff --cached --quiet || git commit -m "chore: update monitor state"
    git push
```

### Task 6: Document setup and manual testing

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document required GitHub and Telegram secrets**

```md
- `GH_STAR_MONITOR_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
```

- [ ] **Step 2: Document how to create the Telegram bot and obtain chat_id**

```md
1. Talk to `@BotFather`
2. Create a bot and copy the token
3. Send one message to your bot
4. Call `getUpdates` and copy the numeric `chat.id`
```

- [ ] **Step 3: Document first-run behavior for newly starred repositories**

```md
Newly starred repositories are tracked from first seen time. Historical releases are not backfilled.
```

- [ ] **Step 4: Document local dry-run and GitHub Actions manual run**

```bash
npm run check
npm start
```
