import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const statePath = path.join(process.cwd(), "data", "state.json");

function createDefaultState() {
  return {
    global: {
      last_success_at: null
    },
    repos: {}
  };
}

function normalizeRepoState(fullName, value = {}) {
  return {
    full_name: value.full_name ?? fullName,
    tracked_since: value.tracked_since ?? null,
    last_notified_release_id: value.last_notified_release_id ?? null,
    last_notified_release_published_at:
      value.last_notified_release_published_at ?? null
  };
}

function normalizeState(raw) {
  const base = createDefaultState();
  const repos = {};

  if (raw && typeof raw === "object" && raw.repos && typeof raw.repos === "object") {
    for (const [fullName, repoState] of Object.entries(raw.repos)) {
      repos[fullName] = normalizeRepoState(fullName, repoState);
    }
  }

  return {
    global: {
      last_success_at: raw?.global?.last_success_at ?? base.global.last_success_at
    },
    repos
  };
}

export async function loadState() {
  try {
    const rawText = await readFile(statePath, "utf8");
    return normalizeState(JSON.parse(rawText));
  } catch (error) {
    if (error.code === "ENOENT") {
      return createDefaultState();
    }

    throw new Error(`读取状态文件失败: ${error.message}`);
  }
}

export async function saveState(state) {
  const normalized = normalizeState(state);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export { statePath };
