const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_SAFE_LIMIT = 3500;
const DEFAULT_SUMMARY_MAX_LINES = 8;
const DEFAULT_SUMMARY_MAX_CHARS = 900;
const DEFAULT_AI_SUMMARY_MAX_CHARS = 260;
const DEFAULT_AI_TITLE_MAX_CHARS = 120;
const DEFAULT_AI_HIGHLIGHT_MAX_CHARS = 90;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toBeijingDateTime(isoString) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(new Date(isoString));
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function truncatePlainText(text, maxChars) {
  return truncateText(text, maxChars);
}

function summarizeReleaseNotes(body, maxLines = DEFAULT_SUMMARY_MAX_LINES, maxChars = DEFAULT_SUMMARY_MAX_CHARS) {
  const normalized = String(body ?? "")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return "（无 Release Notes）";
  }

  const slicedLines = normalized.slice(0, maxLines);
  const joined = slicedLines.join("\n");
  return truncateText(joined, maxChars);
}

function formatPrereleaseFlag(isPrerelease) {
  return isPrerelease ? "是" : "否";
}

function formatHighlightedLines(lines) {
  return lines.map((line) => `- ${line}`);
}

function buildReleaseSection(release) {
  const summary = escapeHtml(summarizeReleaseNotes(release.body));
  const title = escapeHtml(
    truncatePlainText(release.name || release.tagName || "未命名 Release", 200)
  );
  const tagName = escapeHtml(truncatePlainText(release.tagName || "无 tag", 120));
  const publishedAt = escapeHtml(toBeijingDateTime(release.publishedAt));
  const releaseUrl = escapeHtml(release.htmlUrl);

  return [
    `• <b>${title}</b>`,
    `Tag：<code>${tagName}</code>`,
    `发布时间：${publishedAt}`,
    `Pre-release：${formatPrereleaseFlag(release.isPrerelease)}`,
    `链接：<a href="${releaseUrl}">打开 Release</a>`,
    "摘要：",
    summary
  ].join("\n");
}

function buildAiReleaseSection(release, enhancedRelease) {
  const originalTitle = escapeHtml(
    truncatePlainText(release.name || release.tagName || "未命名 Release", 200)
  );
  const titleZh = escapeHtml(
    truncatePlainText(enhancedRelease.title_zh || "（无中文标题）", DEFAULT_AI_TITLE_MAX_CHARS)
  );
  const publishedAt = escapeHtml(toBeijingDateTime(release.publishedAt));
  const releaseUrl = escapeHtml(release.htmlUrl);
  const summaryZh = escapeHtml(
    truncatePlainText(enhancedRelease.summary_zh || "（无中文摘要）", DEFAULT_AI_SUMMARY_MAX_CHARS)
  );
  const highlights = Array.isArray(enhancedRelease.highlights_zh)
    ? enhancedRelease.highlights_zh
        .map((item) => escapeHtml(truncatePlainText(item, DEFAULT_AI_HIGHLIGHT_MAX_CHARS)))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const lines = [
    `• <b>原始标题：</b>${originalTitle}`,
    `• <b>中文标题：</b>${titleZh}`,
    `发布时间：${publishedAt}`,
    `Pre-release：${formatPrereleaseFlag(release.isPrerelease)}`,
    `链接：<a href="${releaseUrl}">打开 Release</a>`,
    "中文摘要：",
    summaryZh
  ];

  if (highlights.length > 0) {
    lines.push("关键点：", ...formatHighlightedLines(highlights));
  }

  return lines.join("\n");
}

export function buildOverviewMessage({
  generatedAt,
  updatedRepoCount,
  totalReleaseCount,
  newTrackedCount,
  repoNames,
  insight = null
}) {
  const generatedAtText = escapeHtml(toBeijingDateTime(generatedAt));
  const baseLines = [
    "<b>📣 GitHub 星标 Release 日报</b>",
    `生成时间：${generatedAtText}`,
    `更新仓库数：${updatedRepoCount}`,
    `新 Release 数：${totalReleaseCount}`,
    `新增纳入跟踪：${newTrackedCount}`
  ];

  if (insight?.summary_zh) {
    baseLines.push(
      "",
      "<b>今日更新概括</b>",
      escapeHtml(truncatePlainText(insight.summary_zh, 300))
    );
  }

  baseLines.push("", "<b>今日有更新的仓库</b>");

  if (repoNames.length === 0) {
    return [...baseLines, "• 无"].join("\n");
  }

  const repoLines = [];
  let omittedCount = 0;

  for (let index = 0; index < repoNames.length; index += 1) {
    const line = `• <code>${escapeHtml(truncatePlainText(repoNames[index], 200))}</code>`;
    const candidate = [...baseLines, ...repoLines, line].join("\n");

    if (candidate.length > TELEGRAM_SAFE_LIMIT) {
      omittedCount = repoNames.length - index;
      break;
    }

    repoLines.push(line);
  }

  if (omittedCount > 0) {
    repoLines.push(`……还有 ${omittedCount} 个仓库未展开。`);
  }

  return [...baseLines, ...repoLines].join("\n");
}

export function buildRepoUpdateMessage(update, insight = null) {
  const repoName = escapeHtml(truncatePlainText(update.fullName, 200));
  const repoUrl = escapeHtml(update.htmlUrl);
  const headerLines = [
    `<b>🚀 ${repoName}</b>`,
    `仓库链接：<a href="${repoUrl}">${repoName}</a>`,
    `本次新增 Release：${update.releases.length}`
  ];

  if (insight?.repo_summary_zh) {
    headerLines.push(
      `本仓库更新概括：${escapeHtml(truncatePlainText(insight.repo_summary_zh, 180))}`
    );
  }

  headerLines.push("");

  const sections = [];
  let currentLength = headerLines.join("\n").length;
  let omittedCount = 0;

  for (let index = 0; index < update.releases.length; index += 1) {
    const release = update.releases[index];
    const enhancedRelease = insight?.releases?.find((item) => item.release_id === release.id);
    const section = enhancedRelease
      ? buildAiReleaseSection(release, enhancedRelease)
      : buildReleaseSection(release);
    const separator = sections.length > 0 ? "\n\n──────────\n\n" : "";
    const nextChunk = `${separator}${section}`;

    if (currentLength + nextChunk.length > TELEGRAM_SAFE_LIMIT) {
      omittedCount = update.releases.length - index;
      break;
    }

    sections.push(nextChunk);
    currentLength += nextChunk.length;
  }

  let message = `${headerLines.join("\n")}${sections.join("")}`;

  if (omittedCount > 0) {
    message += `\n\n……还有 ${omittedCount} 个 Release 未展开，查看仓库 Releases 页面获取完整信息。`;
  }

  if (message.length > TELEGRAM_MESSAGE_LIMIT) {
    return `${message.slice(0, TELEGRAM_SAFE_LIMIT)}\n\n……消息过长，剩余内容请查看仓库 Releases 页面。`;
  }

  return message;
}
