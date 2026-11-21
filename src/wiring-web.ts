// HTTP access for the wiring map: the GitHub REST API (repository
// visibility, open pull requests) and Maven Central's metadata. A token in
// WIRING_GITHUB_TOKEN is sent to the GitHub API when set. Failures return
// undefined; the caller marks the result unknown.

import { mavenLatest } from "./wiring-parse.ts";

/** GitHub's REST API. */
const API = "https://api.github.com";

/** Maven Central's repository. */
const CENTRAL = "https://repo1.maven.org/maven2";

/** HTTP 429: rate limited, worth one retry. */
const TOO_MANY_REQUESTS = 429;

/** Wait before retrying a rate-limited request, in milliseconds. */
const RETRY_DELAY = 3000;

/** HTTP 404. */
const NOT_FOUND = 404;

/** A GET request, retried once when rate limited. */
async function get(url: string, headers: Record<string, string> = {}): Promise<Response | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (response.status !== TOO_MANY_REQUESTS) {
        return response;
      }
    } catch {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
  }
  return undefined;
}

/** A GitHub API request's JSON, or undefined. */
async function api<T>(path: string): Promise<T | undefined> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "ankiquest-wiring" };
  if (process.env.WIRING_GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.WIRING_GITHUB_TOKEN}`;
  }
  const response = await get(`${API}${path}`, headers);
  return response?.ok ? ((await response.json()) as T) : undefined;
}

/** A repository's visibility and default branch, or undefined when unreadable. */
export async function repoInfo(repo: string): Promise<{ private: boolean; branch: string } | undefined> {
  const info = await api<{ private: boolean; default_branch: string }>(`/repos/${repo}`);
  return info ? { private: info.private, branch: info.default_branch } : undefined;
}

/** An open pull request: number, title and link. */
export interface Pull {
  number: number;
  title: string;
  url: string;
}

/** Open pull requests into `repo` from `head` (`owner:branch`), or undefined. */
export async function openPulls(repo: string, head: string): Promise<Pull[] | undefined> {
  const list = await api<{ number: number; title: string; html_url: string }[]>(`/repos/${repo}/pulls?state=open&head=${encodeURIComponent(head)}`);
  return list?.map((pull) => ({ number: pull.number, title: pull.title, url: pull.html_url }));
}

/** What Maven Central has of an artifact. */
export type Central = { state: "published"; latest: string } | { state: "absent" } | { state: "unknown" };

/** The newest version of `group:artifact` on Maven Central. */
export async function central(group: string, artifact: string): Promise<Central> {
  const response = await get(`${CENTRAL}/${group.replaceAll(".", "/")}/${artifact}/maven-metadata.xml`);
  if (response?.status === NOT_FOUND) {
    return { state: "absent" };
  }
  const latest = response?.ok ? mavenLatest(await response.text()) : undefined;
  return latest ? { state: "published", latest } : { state: "unknown" };
}
