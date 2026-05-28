const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

function buildHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "github-star-release-telegram-monitor",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };
}

function parseNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") {
      return match[1];
    }
  }

  return null;
}

async function githubFetchJson(url, token) {
  const response = await fetch(url, {
    headers: buildHeaders(token)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `GitHub API 请求失败 (${response.status} ${response.statusText}): ${errorText}`
    );
  }

  const data = await response.json();
  return {
    data,
    nextUrl: parseNextLink(response.headers.get("link"))
  };
}

export async function listStarredRepositories(token) {
  const repositories = [];
  let nextUrl = `${GITHUB_API_BASE_URL}/user/starred?per_page=100&sort=created&direction=desc`;

  while (nextUrl) {
    const { data, nextUrl: parsedNextUrl } = await githubFetchJson(nextUrl, token);

    for (const repository of data) {
      repositories.push({
        fullName: repository.full_name,
        htmlUrl: repository.html_url,
        description: repository.description ?? "",
        ownerLogin: repository.owner?.login ?? "",
        isPrivate: Boolean(repository.private)
      });
    }

    nextUrl = parsedNextUrl;
  }

  return repositories;
}

export async function listRepositoryReleases(token, fullName) {
  const [owner, repo] = fullName.split("/");

  if (!owner || !repo) {
    throw new Error(`仓库名格式不正确: ${fullName}`);
  }

  const url = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100`;
  const { data } = await githubFetchJson(url, token);

  return data
    .filter((release) => release.published_at)
    .map((release) => ({
      id: release.id,
      name: release.name || release.tag_name,
      tagName: release.tag_name,
      htmlUrl: release.html_url,
      body: release.body ?? "",
      publishedAt: release.published_at,
      isPrerelease: Boolean(release.prerelease)
    }))
    .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
}
