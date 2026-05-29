import { listRepositoryReleases, listStarredRepositories } from "./github.js";
import { buildOverviewMessage, buildRepoUpdateMessage } from "./format.js";
import { loadState, saveState, statePath } from "./state.js";
import { sendTelegramMessage } from "./telegram.js";
import { getAppConfig } from "./config.js";
import { enrichOverview, enrichRepoUpdate } from "./ai/service.js";

function isPublishedAfter(value, cutoff) {
  return new Date(value).getTime() > new Date(cutoff).getTime();
}

function getNewestRelease(releases) {
  return releases.reduce((latest, current) => {
    if (!latest) {
      return current;
    }

    return new Date(current.publishedAt) > new Date(latest.publishedAt) ? current : latest;
  }, null);
}

function sortRepoUpdates(updates) {
  return [...updates].sort((left, right) => {
    const leftNewest = getNewestRelease(left.releases);
    const rightNewest = getNewestRelease(right.releases);

    return new Date(rightNewest.publishedAt) - new Date(leftNewest.publishedAt);
  });
}

async function collectUpdates({ githubToken, state, nowIso }) {
  const starredRepositories = await listStarredRepositories(githubToken);
  const currentStarredSet = new Set(starredRepositories.map((repo) => repo.fullName));
  const newTrackedRepos = [];
  const removedTrackedRepos = [];

  for (const fullName of Object.keys(state.repos)) {
    if (!currentStarredSet.has(fullName)) {
      delete state.repos[fullName];
      removedTrackedRepos.push(fullName);
    }
  }

  for (const repository of starredRepositories) {
    if (!state.repos[repository.fullName]) {
      state.repos[repository.fullName] = {
        full_name: repository.fullName,
        tracked_since: nowIso,
        last_notified_release_id: null,
        last_notified_release_published_at: null
      };
      newTrackedRepos.push(repository.fullName);
    }
  }

  const updates = [];

  for (const repository of starredRepositories) {
    const repoState = state.repos[repository.fullName];
    const cutoff = repoState.last_notified_release_published_at ?? repoState.tracked_since ?? nowIso;
    const releases = await listRepositoryReleases(githubToken, repository.fullName);
    const newReleases = releases.filter((release) => isPublishedAfter(release.publishedAt, cutoff));

    if (newReleases.length > 0) {
      updates.push({
        fullName: repository.fullName,
        htmlUrl: repository.htmlUrl,
        releases: newReleases
      });
    }
  }

  return {
    updates: sortRepoUpdates(updates),
    newTrackedRepos,
    removedTrackedRepos,
    starredRepositories
  };
}

async function run() {
  const config = getAppConfig();
  const nowIso = new Date().toISOString();
  const state = await loadState();

  console.log(`状态文件: ${statePath}`);

  const { updates, newTrackedRepos, removedTrackedRepos, starredRepositories } = await collectUpdates({
    githubToken: config.githubToken,
    state,
    nowIso
  });

  const totalReleaseCount = updates.reduce((sum, update) => sum + update.releases.length, 0);
  console.log(`当前星标仓库: ${starredRepositories.length}`);
  console.log(`新增纳入跟踪: ${newTrackedRepos.length}`);
  console.log(`取消跟踪仓库: ${removedTrackedRepos.length}`);
  console.log(`今日有更新的仓库: ${updates.length}`);
  console.log(`今日新 Release 数: ${totalReleaseCount}`);

  if (updates.length > 0) {
    const overviewInsight = await enrichOverview({
      llmConfig: config.llm,
      generatedAt: nowIso,
      updates
    });
    console.log(
      `[AI][overview] final mode: ${overviewInsight ? "enhanced" : "fallback"}`
    );
    const overviewMessage = buildOverviewMessage({
      generatedAt: nowIso,
      updatedRepoCount: updates.length,
      totalReleaseCount,
      newTrackedCount: newTrackedRepos.length,
      repoNames: updates.map((item) => item.fullName),
      insight: overviewInsight
    });

    await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId,
      text: overviewMessage
    });

    for (const update of updates) {
      const repoInsight = await enrichRepoUpdate({
        llmConfig: config.llm,
        update
      });
      console.log(
        `[AI][repo:${update.fullName}] final mode: ${repoInsight ? "enhanced" : "fallback"}`
      );
      const detailMessage = buildRepoUpdateMessage(update, repoInsight);
      await sendTelegramMessage({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        text: detailMessage
      });
    }

    for (const update of updates) {
      const latestRelease = getNewestRelease(update.releases);
      state.repos[update.fullName].last_notified_release_id = latestRelease.id;
      state.repos[update.fullName].last_notified_release_published_at =
        latestRelease.publishedAt;
    }
  } else if (config.sendEmptySummary) {
    const overviewMessage = buildOverviewMessage({
      generatedAt: nowIso,
      updatedRepoCount: 0,
      totalReleaseCount: 0,
      newTrackedCount: newTrackedRepos.length,
      repoNames: [],
      insight: null
    });

    await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId,
      text: overviewMessage
    });
  }

  state.global.last_success_at = nowIso;
  await saveState(state);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
