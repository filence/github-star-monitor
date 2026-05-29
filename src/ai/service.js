import { buildOverviewPrompt, buildRepoPrompt } from "../prompts.js";
import { createAiProvider } from "./provider.js";

const MAX_RELEASE_BODY_CHARS = 3500;
const DEBUG_TEXT_PREVIEW_CHARS = 220;
const RELEASE_NOTES_STATUS = {
  EMPTY: "empty",
  PROVIDED: "provided",
  TRUNCATED: "truncated"
};
const PRIORITY_RELEASE_SECTION_PATTERNS = [
  /\bbreaking\s+changes?\b/i,
  /\bfeatures?\b/i,
  /\bbug\s+fixes?\b/i,
  /\bfixes?\b/i,
  /\bmigration\b/i,
  /\bsecurity\b/i,
  /\bimportant\s+notes?\b/i
];

function previewText(text, maxChars = DEBUG_TEXT_PREVIEW_CHARS) {
  return truncateText(String(text ?? "").replaceAll("\n", "\\n"), maxChars);
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeReleaseBody(body) {
  return String(body ?? "").replaceAll("\r\n", "\n").trim();
}

function getReleaseNotesStatus(body) {
  return normalizeReleaseBody(body)
    ? RELEASE_NOTES_STATUS.PROVIDED
    : RELEASE_NOTES_STATUS.EMPTY;
}

function parseMarkdownSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = { title: "", lines: [] };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (headingMatch) {
      if (current.lines.length > 0) {
        sections.push(current);
      }

      current = {
        title: headingMatch[2].trim(),
        lines: [line]
      };
      continue;
    }

    current.lines.push(line);
  }

  if (current.lines.length > 0) {
    sections.push(current);
  }

  return sections.map((section) => ({
    ...section,
    text: section.lines.join("\n").trim()
  })).filter((section) => section.text);
}

function appendWithinLimit(parts, text, maxChars) {
  const normalizedText = String(text ?? "").trim();

  if (!normalizedText || maxChars <= 0) {
    return false;
  }

  const currentText = parts.join("\n\n");
  const separatorLength = currentText ? 2 : 0;
  const remaining = maxChars - currentText.length - separatorLength;

  if (remaining <= 0) {
    return false;
  }

  parts.push(truncateText(normalizedText, remaining));
  return true;
}

function trimReleaseBodyWithPriority(body, maxChars) {
  const normalized = normalizeReleaseBody(body);

  if (!normalized || maxChars <= 0) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const sections = parseMarkdownSections(normalized);
  const selectedSections = [];
  const selectedIndexes = new Set();

  for (const pattern of PRIORITY_RELEASE_SECTION_PATTERNS) {
    sections.forEach((section, index) => {
      if (!selectedIndexes.has(index) && pattern.test(section.title)) {
        selectedSections.push(section.text);
        selectedIndexes.add(index);
      }
    });
  }

  if (selectedSections.length === 0) {
    return truncateText(normalized, maxChars);
  }

  const parts = [];
  selectedSections.forEach((sectionText) => appendWithinLimit(parts, sectionText, maxChars));

  sections.forEach((section, index) => {
    if (!selectedIndexes.has(index)) {
      appendWithinLimit(parts, section.text, maxChars);
    }
  });

  return parts.join("\n\n") || truncateText(normalized, maxChars);
}

function prepareReleaseBodyForPrompt(body, maxChars) {
  const normalized = normalizeReleaseBody(body);

  if (!normalized) {
    return {
      body: "",
      releaseNotesStatus: RELEASE_NOTES_STATUS.EMPTY
    };
  }

  const trimmedBody = trimReleaseBodyWithPriority(normalized, maxChars);

  return {
    body: trimmedBody,
    releaseNotesStatus:
      trimmedBody.length < normalized.length
        ? RELEASE_NOTES_STATUS.TRUNCATED
        : RELEASE_NOTES_STATUS.PROVIDED
  };
}

function buildTrimmedUpdate(update, maxCharsPerRelease) {
  return {
    ...update,
    releases: update.releases.map((release) => {
      const preparedBody = prepareReleaseBodyForPrompt(release.body, maxCharsPerRelease);

      return {
        ...release,
        ...preparedBody
      };
    })
  };
}

function buildTrimmedOverviewUpdates(updates, maxCharsPerRelease, maxNotesChars) {
  let consumed = 0;

  return updates.map((update) => ({
    ...update,
    releases: update.releases.map((release) => {
      const remaining = Math.max(0, maxNotesChars - consumed);
      const releaseLimit = Math.min(maxCharsPerRelease, remaining);
      const preparedBody =
        releaseLimit > 0
          ? prepareReleaseBodyForPrompt(release.body, releaseLimit)
          : {
              body: "",
              releaseNotesStatus: getReleaseNotesStatus(release.body) === RELEASE_NOTES_STATUS.EMPTY
                ? RELEASE_NOTES_STATUS.EMPTY
                : RELEASE_NOTES_STATUS.TRUNCATED
            };

      consumed += preparedBody.body.length;

      return {
        ...release,
        ...preparedBody
      };
    })
  }));
}

function extractJsonString(text) {
  const normalized = String(text ?? "").trim();

  if (!normalized) {
    throw new Error("模型返回为空");
  }

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return normalized.slice(firstBrace, lastBrace + 1);
  }

  return normalized;
}

function parseJsonOrThrow(text) {
  return JSON.parse(extractJsonString(text));
}

function validateOverviewResult(value) {
  return Boolean(value && typeof value.summary_zh === "string" && value.summary_zh.trim());
}

function validateRepoResult(value, update) {
  if (
    !value ||
    value.full_name !== update.fullName ||
    typeof value.repo_summary_zh !== "string" ||
    !Array.isArray(value.releases)
  ) {
    return false;
  }

  return update.releases.every((release) =>
    value.releases.some((item) => {
      if (item.release_id !== release.id) {
        return false;
      }

      if (typeof item.title_zh !== "string" || !item.title_zh.trim()) {
        return false;
      }

      if (typeof item.summary_zh !== "string" || !item.summary_zh.trim()) {
        return false;
      }

      return item.highlights_zh == null || Array.isArray(item.highlights_zh);
    })
  );
}

function findEnhancedRelease(insight, releaseId) {
  return insight?.releases?.find((item) => item.release_id === releaseId) ?? null;
}

function normalizeRepoInsight(parsed, update) {
  return {
    full_name: parsed.full_name,
    repo_summary_zh: parsed.repo_summary_zh.trim(),
    releases: update.releases.map((release) => {
      const matched = findEnhancedRelease(parsed, release.id);

      return {
        release_id: release.id,
        title_zh: matched.title_zh.trim(),
        summary_zh:
          getReleaseNotesStatus(release.body) === RELEASE_NOTES_STATUS.EMPTY
            ? "作者未提供 Release Notes"
            : matched.summary_zh.trim(),
        highlights_zh:
          getReleaseNotesStatus(release.body) === RELEASE_NOTES_STATUS.EMPTY
            ? []
            : Array.isArray(matched.highlights_zh)
              ? matched.highlights_zh
                  .map((item) => String(item).trim())
                  .filter(Boolean)
                  .slice(0, 3)
              : []
      };
    })
  };
}

export async function enrichOverview({ llmConfig, generatedAt, updates }) {
  if (!llmConfig.enabled || updates.length === 0) {
    if (!llmConfig.enabled) {
      console.log("[AI][overview] skipped: llm disabled");
    }
    return null;
  }

  try {
    const provider = createAiProvider(llmConfig);
    const trimmedUpdates = buildTrimmedOverviewUpdates(
      updates,
      MAX_RELEASE_BODY_CHARS,
      llmConfig.maxNotesChars
    );
    const prompt = buildOverviewPrompt({
      generatedAt,
      updates: trimmedUpdates
    });
    console.log(
      `[AI][overview] request start: provider=${llmConfig.provider}, repos=${updates.length}, releases=${updates.reduce((sum, update) => sum + update.releases.length, 0)}`
    );
    const rawText = await provider.generateText(prompt);
    console.log(
      `[AI][overview] raw response preview: ${previewText(rawText)}`
    );
    const parsed = parseJsonOrThrow(rawText);

    if (!validateOverviewResult(parsed)) {
      console.warn(
        `[AI][overview] validation failed: ${previewText(JSON.stringify(parsed))}`
      );
      return null;
    }

    console.log("[AI][overview] success");
    return {
      summary_zh: parsed.summary_zh.trim()
    };
  } catch (error) {
    console.warn(`[AI][overview] failed, fallback to phase1: ${error.message}`);
    return null;
  }
}

export async function enrichRepoUpdate({ llmConfig, update }) {
  if (!llmConfig.enabled) {
    console.log(`[AI][repo:${update.fullName}] skipped: llm disabled`);
    return null;
  }

  try {
    const provider = createAiProvider(llmConfig);
    const maxCharsPerRelease = Math.min(MAX_RELEASE_BODY_CHARS, llmConfig.maxNotesChars);
    const trimmedUpdate = buildTrimmedUpdate(update, maxCharsPerRelease);
    const prompt = buildRepoPrompt(trimmedUpdate);
    console.log(
      `[AI][repo:${update.fullName}] request start: releases=${update.releases.length}`
    );
    const rawText = await provider.generateText(prompt);
    console.log(
      `[AI][repo:${update.fullName}] raw response preview: ${previewText(rawText)}`
    );
    const parsed = parseJsonOrThrow(rawText);

    if (!validateRepoResult(parsed, update)) {
      console.warn(
        `[AI][repo:${update.fullName}] validation failed: ${previewText(JSON.stringify(parsed))}`
      );
      return null;
    }

    console.log(`[AI][repo:${update.fullName}] success`);
    return normalizeRepoInsight(parsed, update);
  } catch (error) {
    console.warn(
      `[AI][repo:${update.fullName}] failed, fallback to phase1: ${error.message}`
    );
    return null;
  }
}
