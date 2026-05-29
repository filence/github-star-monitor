import { buildOverviewPrompt, buildRepoPrompt } from "../prompts.js";
import { createAiProvider } from "./provider.js";

const MAX_RELEASE_BODY_CHARS = 3500;
const DEBUG_TEXT_PREVIEW_CHARS = 220;

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

function trimReleaseBody(body, maxChars) {
  return truncateText(normalizeReleaseBody(body), maxChars);
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

function buildTrimmedOverviewUpdates(updates, maxCharsPerRelease, maxNotesChars) {
  let consumed = 0;

  return updates.map((update) => ({
    ...update,
    releases: update.releases.map((release) => {
      const remaining = Math.max(0, maxNotesChars - consumed);
      const releaseLimit = Math.min(maxCharsPerRelease, remaining);
      const body = releaseLimit > 0 ? trimReleaseBody(release.body, releaseLimit) : "";
      consumed += body.length;

      return {
        ...release,
        body
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
        summary_zh: matched.summary_zh.trim(),
        highlights_zh: Array.isArray(matched.highlights_zh)
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
