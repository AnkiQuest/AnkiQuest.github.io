// Parsers for the files the wiring map reads: .gitmodules, flake.lock,
// Gradle version catalogs and build files, Cargo.toml, GitHub workflows,
// Maven metadata, AnkiQuest-Sync's workflows and AnkiQuest-Agents' table.
// Pure functions of the file text, so the tests need no network.

/** One `[submodule]` entry of a .gitmodules file. */
export interface Submodule {
  name: string;
  path: string;
  url: string;
  branch?: string;
}

/** Parses a .gitmodules file. */
export function gitmodules(text: string): Submodule[] {
  const list: Submodule[] = [];
  let current: Partial<Submodule> | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = /^\[submodule "(.+)"\]$/.exec(line);
    if (head) {
      current = { name: head[1] };
      list.push(current as Submodule);
      continue;
    }
    const pair = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (current === undefined || !pair) {
      continue;
    }
    const [, key, value] = pair;
    if (key === "path" || key === "url" || key === "branch") {
      current[key] = value;
    }
  }
  return list.filter((entry) => entry.path && entry.url);
}

/** `owner/repo` of a GitHub URL in any form git accepts, or undefined. */
export function githubRepo(url: string): string | undefined {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** One direct input of a flake, as flake.lock locks it. */
export interface FlakeInput {
  input: string;
  repo?: string;
  rev?: string;
  ref?: string;
  url?: string;
}

/** The root inputs of a flake.lock; inputs that follow another are left out. */
export function flakeInputs(text: string): FlakeInput[] {
  const lock = JSON.parse(text) as {
    root: string;
    nodes: Record<string, { inputs?: Record<string, string | string[]>; locked?: Record<string, string>; original?: Record<string, string> }>;
  };
  const root = lock.nodes[lock.root]?.inputs ?? {};
  const list: FlakeInput[] = [];
  for (const [input, key] of Object.entries(root)) {
    if (typeof key !== "string") {
      continue;
    }
    const locked = lock.nodes[key]?.locked ?? {};
    const original = lock.nodes[key]?.original ?? {};
    const entry: FlakeInput = { input, rev: locked.rev, ref: original.ref };
    if (locked.type === "github") {
      entry.repo = `${locked.owner}/${locked.repo}`;
    } else if (locked.url) {
      entry.url = locked.url;
      entry.repo = githubRepo(locked.url.replace(/\?.*$/, ""));
    }
    list.push(entry);
  }
  return list;
}

/** Strips a line's comment: a `#` at the start or after whitespace. */
function uncomment(line: string): string {
  return line.replace(/(^|\s)#.*$/, "");
}

/** A reusable workflow or action of another repository that a workflow uses. */
export interface Uses {
  repo: string;
  path: string;
  ref: string;
  line: number;
}

/** The `uses:` of a workflow or action file that point into another repository. */
export function workflowUses(text: string): Uses[] {
  const list: Uses[] = [];
  text.split("\n").forEach((raw, index) => {
    const match = /^\s*(?:-\s*)?uses:\s*["']?([^\s"']+)/.exec(uncomment(raw));
    if (!match) {
      return;
    }
    const target = /^([\w.-]+\/[\w.-]+)\/([^@]+)@(.+)$/.exec(match[1]);
    if (target) {
      list.push({ repo: target[1], path: target[2], ref: target[3], line: index + 1 });
    }
  });
  return list;
}

/** A repository an `actions/checkout` step checks out, with its line. */
export interface Checkout {
  repo: string;
  ref?: string;
  line: number;
}

/** The `repository:` inputs of a workflow's checkout steps. */
export function workflowCheckouts(text: string): Checkout[] {
  const lines = text.split("\n");
  const list: Checkout[] = [];
  lines.forEach((raw, index) => {
    const match = /^(\s*)repository:\s*["']?([\w.-]+\/[\w.-]+)["']?\s*$/.exec(uncomment(raw));
    if (!match) {
      return;
    }

    // The ref: a sibling key of the same `with:` block, if any.
    const indent = match[1].length;
    let ref: string | undefined;
    for (let at = index - 3; at <= index + 6; at++) {
      const sibling = /^(\s*)ref:\s*(.+?)\s*$/.exec(uncomment(lines[at] ?? ""));
      if (sibling && sibling[1].length === indent) {
        ref = sibling[2];
      }
    }
    list.push({ repo: match[2], ref, line: index + 1 });
  });
  return list;
}

/** `key=value` lines of a .properties file. */
export function properties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    const match = /^([\w.-]+)\s*[=:]\s*(.*)$/.exec(line);
    if (match) {
      map.set(match[1], match[2].trim());
    }
  }
  return map;
}

/** A Maven dependency: group, artifact and version, with its line. */
export interface MavenDep {
  group: string;
  artifact: string;
  version?: string;
  line: number;
}

/** A TOML string value with either quote, without a trailing comment. */
function tomlString(value: string): string | undefined {
  return /^\s*["']([^"']*)["']/.exec(value)?.[1];
}

/** The libraries of a Gradle version catalog, versions resolved. */
export function versionCatalog(text: string): MavenDep[] {
  const versions = new Map<string, string>();
  const list: MavenDep[] = [];
  let section = "";
  text.split("\n").forEach((raw, index) => {
    const line = uncomment(raw).trim();
    const head = /^\[([\w-]+)\]$/.exec(line);
    if (head) {
      section = head[1];
      return;
    }
    const pair = /^([\w.-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) {
      return;
    }
    const [, key, value] = pair;
    if (section === "versions") {
      const version = tomlString(value);
      if (version !== undefined) {
        versions.set(key, version);
      }
      return;
    }
    if (section !== "libraries") {
      return;
    }

    // "g:a:v", { module = "g:a", version... } or { group = "g", name = "a", version... }
    const plain = tomlString(value);
    if (plain !== undefined) {
      const [group, artifact, version] = plain.split(":");
      list.push({ group, artifact, version, line: index + 1 });
      return;
    }
    const field = (name: string): string | undefined => new RegExp(`(?:^|[{,\\s])${name.replace(".", "\\.")}\\s*=\\s*["']([^"']+)["']`).exec(value)?.[1];
    const module = field("module");
    const [group, artifact] = module ? module.split(":") : [field("group"), field("name")];
    if (!group || !artifact) {
      return;
    }
    const ref = field("version.ref");
    const version = ref !== undefined ? versions.get(ref) : field("version");
    list.push({ group, artifact, version, line: index + 1 });
  });
  return list;
}

/** Literal `group:artifact:version` coordinates in a Gradle build file. */
export function gradleCoordinates(text: string): MavenDep[] {
  const list: MavenDep[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, "");
    for (const match of line.matchAll(/["']([\w.-]+):([\w.-]+):([\w.+-]+)["']/g)) {
      list.push({ group: match[1], artifact: match[2], version: match[3], line: index + 1 });
    }
  });
  return list;
}

/** A Gradle project's published coordinates: `group = "..."` and `version = "..."`. */
export function gradlePublication(text: string): { group?: string; version?: string } {
  const value = (key: string): string | undefined => new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m").exec(text)?.[1];
  return { group: value("group"), version: value("version") };
}

/** A Cargo dependency from git or from a path. */
export interface CargoDep {
  name: string;
  git?: string;
  rev?: string;
  branch?: string;
  tag?: string;
  path?: string;
  line: number;
}

/** The git and path dependencies of a Cargo.toml, inline or as tables. */
export function cargoDeps(text: string): CargoDep[] {
  const list: CargoDep[] = [];
  let table: CargoDep | undefined;
  text.split("\n").forEach((raw, index) => {
    const line = uncomment(raw).trim();

    // [dependencies.name] or [workspace.dependencies.name]: a dependency table.
    const head = /^\[(?:[\w-]+\.)*(?:dependencies|build-dependencies|dev-dependencies)\.([\w-]+)\]$/.exec(line);
    if (head) {
      table = { name: head[1], line: index + 1 };
      list.push(table);
      return;
    }
    if (line.startsWith("[")) {
      table = undefined;
      return;
    }
    const pair = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) {
      return;
    }
    const [, key, value] = pair;
    if (table !== undefined) {
      if (key === "git" || key === "rev" || key === "branch" || key === "tag" || key === "path") {
        table[key] = tomlString(value);
      }
      return;
    }
    if (!value.startsWith("{")) {
      return;
    }
    const field = (name: string): string | undefined => new RegExp(`(?:^|[{,\\s])${name}\\s*=\\s*["']([^"']+)["']`).exec(value)?.[1];
    const dep: CargoDep = { name: key, git: field("git"), rev: field("rev"), branch: field("branch"), tag: field("tag"), path: field("path"), line: index + 1 };
    list.push(dep);
  });
  return list.filter((dep) => dep.git !== undefined || dep.path !== undefined);
}

/** The newest release in a maven-metadata.xml, or undefined. */
export function mavenLatest(xml: string): string | undefined {
  return /<release>([^<]+)<\/release>/.exec(xml)?.[1] ?? /<latest>([^<]+)<\/latest>/.exec(xml)?.[1];
}

/** One fork the sync job keeps up to date, from sync.yml's matrix. */
export interface ForkSync {
  fork: string;
  upstream: string;
  branch: string;
}

/** The `{ fork, upstream, upstream_branch }` rows of AnkiQuest-Sync's sync.yml. */
export function syncMatrix(text: string): ForkSync[] {
  const list: ForkSync[] = [];
  for (const raw of text.split("\n")) {
    const line = uncomment(raw);
    const fork = /fork:\s*([\w.-]+\/[\w.-]+)/.exec(line)?.[1];
    const upstream = /upstream:\s*([\w.-]+\/[\w.-]+)/.exec(line)?.[1];
    const branch = /upstream_branch:\s*([\w.\/-]+)/.exec(line)?.[1];
    if (fork && upstream && branch) {
      list.push({ fork, upstream, branch });
    }
  }
  return list;
}

/** The repositories in the TARGETS list of AnkiQuest-Sync's agents.yml. */
export function agentsTargets(text: string): string[] {
  const block = /TARGETS:\s*\|\s*\n(\s*\[[\s\S]*?\])/.exec(text);
  return block ? (JSON.parse(block[1]) as string[]) : [];
}

/** A source watched.json lists: a branch or a version of another repository. */
export interface Watched {
  source: string;
  ref: string;
  kind: "branch" | "version";
  target: string;
  why: string;
  reviewed: string;
  file?: string;
  key?: string;
}

/** Parses AnkiQuest-Sync's watched.json. */
export function watched(text: string): Watched[] {
  return JSON.parse(text) as Watched[];
}

/** A row of the "Repositories" table in AnkiQuest-Agents' shared.md. */
export interface RepoRow {
  repo: string;
  upstream?: string;
  purpose: string;
}

/** The rows of the "Repositories" table, in order, each repository once. */
export function repoTable(markdown: string): RepoRow[] {
  const section = /## Repositories\n([\s\S]*?)(?:\n## |$)/.exec(markdown)?.[1] ?? "";
  const rows: RepoRow[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || cells[1] === "Repository" || cells[1].startsWith("---")) {
      continue;
    }
    const [, name, upstream, purpose] = cells;
    if (rows.some((row) => row.repo === `AnkiQuest/${name}`)) {
      continue;
    }
    rows.push({ repo: `AnkiQuest/${name}`, upstream: upstream === "none" ? undefined : upstream, purpose });
  }
  return rows;
}

/** Repositories the table lists more than once. */
export function repeatedRows(markdown: string): string[] {
  const section = /## Repositories\n([\s\S]*?)(?:\n## |$)/.exec(markdown)?.[1] ?? "";
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const line of section.split("\n")) {
    const name = /^\|\s*([\w.-]+)\s*\|/.exec(line)?.[1];
    if (!name || name === "Repository") {
      continue;
    }
    if (seen.has(name)) {
      repeated.add(name);
    }
    seen.add(name);
  }
  return [...repeated];
}

/** The AGENTS.md AnkiQuest-Sync writes: shared.md, a blank line, the section. */
export function agentsFile(shared: string, section: string): string {
  return `${shared}\n${section}`;
}
