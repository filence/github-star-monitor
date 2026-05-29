function serializeJson(value) {
  return JSON.stringify(value, null, 2);
}

export function buildOverviewPrompt({ generatedAt, updates }) {
  const payload = updates.map((update) => ({
    full_name: update.fullName,
    release_count: update.releases.length,
    releases: update.releases.map((release) => ({
      release_id: release.id,
      title: release.name,
      tag_name: release.tagName,
      published_at: release.publishedAt,
      is_prerelease: release.isPrerelease,
      release_notes_excerpt: release.body
    }))
  }));

  return [
    "你是一个负责整理 GitHub Release 日报的中文助手。",
    "请只输出 JSON，不要输出 Markdown，不要输出解释，不要输出代码块。",
    '请基于输入内容，总结今天这些更新主要在做什么。JSON 结构必须严格为：{"summary_zh":"..."}',
    "summary_zh 用简体中文，控制在 1 到 3 句，强调主题，不要逐条复述。",
    `生成时间（UTC ISO）：${generatedAt}`,
    "输入数据：",
    serializeJson(payload)
  ].join("\n");
}

export function buildRepoPrompt(update) {
  const payload = {
    full_name: update.fullName,
    releases: update.releases.map((release) => ({
      release_id: release.id,
      title: release.name,
      tag_name: release.tagName,
      published_at: release.publishedAt,
      is_prerelease: release.isPrerelease,
      release_notes_excerpt: release.body
    }))
  };

  return [
    "你是一个负责整理 GitHub Release 中文摘要的助手。",
    "请只输出 JSON，不要输出 Markdown，不要输出解释，不要输出代码块。",
    "请返回仓库级概括，以及每个 Release 的中文标题、中文摘要和关键点。",
    "JSON 结构必须严格为：",
    '{"full_name":"owner/repo","repo_summary_zh":"...","releases":[{"release_id":123,"title_zh":"...","summary_zh":"...","highlights_zh":["...","..."]}]}',
    "要求：title_zh 保持简洁；summary_zh 用简体中文，控制在 80 到 140 字；highlights_zh 最多 3 条，每条简短。",
    "输入数据：",
    serializeJson(payload)
  ].join("\n");
}
