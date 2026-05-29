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
      release_notes_status: release.releaseNotesStatus,
      release_notes_excerpt: release.body
    }))
  }));

  return [
    "你是一个负责整理 GitHub Release 日报的中文助手。",
    "请只输出 JSON，不要输出 Markdown，不要输出解释，不要输出代码块。",
    '请基于输入内容，总结今天这些更新主要在做什么。JSON 结构必须严格为：{"summary_zh":"..."}',
    "summary_zh 用简体中文，控制在 1 到 3 句，强调主题，不要逐条复述。",
    "如果 release_notes_status 为 empty，表示作者未提供 Release Notes；不得根据标题、tag_name 或版本号编造更新内容。",
    "如果 release_notes_status 为 truncated，表示 Release Notes 已被裁剪；总结时不要声称覆盖了完整原文。",
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
      release_notes_status: release.releaseNotesStatus,
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
    "如果某个 release_notes_status 为 empty，summary_zh 必须明确写“作者未提供 Release Notes”，highlights_zh 必须返回空数组，不要根据 title、tag_name 或版本号编造更新内容。",
    "如果某个 release_notes_status 为 truncated，表示 Release Notes 已被裁剪；只能基于 release_notes_excerpt 总结，不要声称覆盖了完整原文。",
    "输入数据：",
    serializeJson(payload)
  ].join("\n");
}
