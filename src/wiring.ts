// Collects how the AnkiQuest repositories are wired together and writes
// wiring.json for the wiring page:
//   node src/wiring.ts [out-file] [--cache <dir>]
// It reads each repository's default branch with git (see wiring-git.ts):
// submodules, flake inputs, Cargo and Gradle dependencies, published
// artifacts, workflows used from other repositories, pinned AnkiQuest-Server
// commits, AGENTS.md against AnkiQuest-Agents, forks against their
// upstreams (AnkiQuest-Sync's sync.yml) and watched sources (watched.json).
// What it cannot read is marked unknown and listed in `notes`.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { Clones } from "./wiring-git.ts";
import type { EdgeKind, Status, Wiring, WiringEdge, WiringNode } from "./wiring-model.ts";
import {
  agentsFile,
  agentsTargets,
  cargoDeps,
  flakeInputs,
  githubRepo,
  gitmodules,
  gradleCoordinates,
  gradlePublication,
  properties,
  repeatedRows,
  repoTable,
  syncMatrix,
  versionCatalog,
  watched,
  workflowCheckouts,
  workflowUses,
  type MavenDep,
  type RepoRow,
} from "./wiring-parse.ts";
import { central, openPulls, repoInfo } from "./wiring-web.ts";

/** The organisation every AnkiQuest repository lives in. */
const ORG = "AnkiQuest";

const AGENTS = `${ORG}/AnkiQuest-Agents`;
const SYNC = `${ORG}/AnkiQuest-Sync`;
const SERVER = `${ORG}/AnkiQuest-Server`;
const ANDROID = `${ORG}/AnkiQuest-Android`;
const DESKTOP = `${ORG}/AnkiQuest-Desktop`;

/** Repositories outside the organisation that are part of AnkiQuest's wiring. */
const EXTRA_REPOS: RepoRow[] = [{ repo: "float3/nixos", purpose: "" }];

/**
 * Private repositories (hill, 2026-11-21): the public map shows them only as
 * nodes with their links to AnkiQuest repositories, without commits, pins,
 * counts, paths or other details. The generator never reads them, so the
 * daily run needs no token for them; their links are declared here. A
 * repository the GitHub API reports as private is redacted the same way.
 */
const PRIVATE_REPOS = ["float3/nixos", `${ORG}/AnkiQuest-Hosting`];

/** The links of the private repositories to AnkiQuest repositories. */
const PRIVATE_LINKS: { kind: EdgeKind; from: string; to: string; label: string }[] = [
  { kind: "submodule", from: `${ORG}/AnkiQuest-Hosting`, to: "float3/nixos", label: "submodule" },
  { kind: "flake", from: SERVER, to: "float3/nixos", label: "flake input" },
  { kind: "flake", from: `${ORG}/AnkiQuest-Dev`, to: "float3/nixos", label: "flake input" },
  { kind: "workflow", from: `${ORG}/AnkiQuest-Dev`, to: `${ORG}/AnkiQuest-Hosting`, label: "reusable workflow" },
];

/** What the page says about a private repository. */
const PRIVATE_NOTE = "Private repository: only its links to AnkiQuest repositories are shown.";

/**
 * Strips a map to what may be public about `hidden` repositories: each
 * becomes a bare node, and of its edges only those to AnkiQuest repositories
 * (or another hidden one) stay, with kind, ends and label and nothing else.
 */
export function redact(map: Wiring, hidden: Set<string>): Wiring {
  const touches = (edge: WiringEdge): boolean => hidden.has(edge.from) || hidden.has(edge.to);
  const allowed = (id: string): boolean => hidden.has(id) || id.startsWith(`${ORG}/`);
  const edges = map.edges
    .filter((edge) => !touches(edge) || (allowed(edge.from) && allowed(edge.to)))
    .map((edge): WiringEdge => (touches(edge) ? { kind: edge.kind, from: edge.from, to: edge.to, label: edge.kind === "agents" ? "AGENTS.md" : edge.label, status: "none" } : edge));
  const nodes = map.nodes.map((node): WiringNode =>
    hidden.has(node.id) ? { id: node.id, kind: node.kind, label: node.label, url: node.url, private: true, readable: false, note: PRIVATE_NOTE } : node,
  );
  const notes = map.notes.filter((note) => ![...hidden].some((id) => note.includes(id)));
  return { ...map, nodes, edges, notes };
}

/**
 * Repositories that are decided but may not exist yet, and the repositories
 * that will take them as a submodule (hill, 2026-11-21: the art moves to
 * AnkiQuest-Art). Until a repository has commits it shows as planned; each
 * submodule edge shows as planned until the consumer's .gitmodules has it.
 */
const PLANNED: { row: RepoRow; consumers: string[] }[] = [
  {
    row: { repo: `${ORG}/AnkiQuest-Art`, purpose: "The pose masters and every other companion picture, taken as a submodule by the repositories that need art." },
    consumers: [SERVER, ANDROID, DESKTOP, `${ORG}/AnkiQuest.github.io`],
  },
];

/** Maven groups that belong to Anki or AnkiQuest, and who publishes the ones we don't. */
const MAVEN_GROUPS: Record<string, string | undefined> = {
  "org.ankiquest": undefined,
  "io.github.david-allison": "ankidroid/Anki-Android-Backend",
  "com.ichi2.anki": "ankidroid/Anki-Android",
  "com.github.ankidroid": "ankidroid/Anki-Android",
};

/** JitPack builds GitHub repositories on demand; it has no index to compare with. */
const JITPACK_GROUP = "com.github.";

/** Git file mode of a symbolic link. */
const SYMLINK = "120000";

/** The pinned Server commit files of the clients. */
const SERVER_PIN = "ankiquest-server.sha";

/**
 * Edges the files show only indirectly: the clients talk to the server over
 * HTTPS, and the Android apps read AnkiQuest's content provider. Each names
 * the file that shows it and a text it must contain.
 */
const RUNTIME: { from: string; to: string; label: string; file: string; needle: RegExp }[] = [
  { from: SERVER, to: ANDROID, label: "HTTPS API", file: "AnkiDroid/src/main/java/com/ichi2/anki/ankiquest/AnkiquestAccount.kt", needle: /DEFAULT_SERVER/ },
  { from: SERVER, to: DESKTOP, label: "HTTPS API", file: "addon/client.py", needle: /DEFAULT_SERVER/ },
  { from: ANDROID, to: `${ORG}/AnkiQuest-Android-MCP`, label: "content provider", file: "app/src/main/java/ai/ankimcp/ankidroid/anki/FlashcardApp.kt", needle: /ankiquest/i },
  {
    from: ANDROID,
    to: `${ORG}/AnkiQuest-AnkiConnectAndroid`,
    label: "content provider",
    file: "app/src/main/java/com/kamwithk/ankiconnectandroid/flashcard_app/FlashcardApp.java",
    needle: /ankiquest/i,
  },
  { from: ANDROID, to: `${ORG}/AnkiQuest-GarmAnki`, label: "content provider", file: "android/app/src/main/kotlin/app/sypianski/garmanki/anki/FlashcardApp.kt", needle: /ankiquest/i },
];

/** A link to a file on a repository's default branch. */
function blob(repo: string, file: string, line?: number): string {
  return `https://github.com/${repo}/blob/HEAD/${file}${line ? `#L${line}` : ""}`;
}

/** A pin's status from the commits it lacks, or from comparing it with the latest. */
export function pinStatus(pinned: string | undefined, latest: string | undefined, behind: number | undefined): Status {
  if (pinned === undefined || latest === undefined) {
    return "unknown";
  }
  if (pinned === latest || behind === 0) {
    return "current";
  }
  return "behind";
}

/** Short form of a commit hash; versions pass unchanged. */
export function short(value: string | undefined): string | undefined {
  return value !== undefined && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 10) : value;
}

/** Builds the map. */
class Collector {
  private readonly clones: Clones;
  private readonly nodes = new Map<string, WiringNode>();
  private readonly edges: WiringEdge[] = [];
  private readonly notes: string[] = [];
  private readonly ours: RepoRow[] = [];
  private readonly readable = new Set<string>();
  private readonly hidden = new Set<string>(PRIVATE_REPOS);

  constructor(cache: string) {
    this.clones = new Clones(cache);
  }

  /** Runs every step and returns the map. */
  async collect(): Promise<Wiring> {
    await this.repos();
    for (const row of this.ours) {
      if (!this.readable.has(row.repo)) {
        continue;
      }
      this.step(`submodules of ${row.repo}`, () => this.submodules(row.repo));
      this.step(`flake inputs of ${row.repo}`, () => this.flake(row.repo));
      this.step(`workflows of ${row.repo}`, () => this.workflows(row.repo));
      this.step(`Cargo dependencies of ${row.repo}`, () => this.cargo(row.repo));
      this.step(`pinned Server commits of ${row.repo}`, () => this.serverPins(row.repo));
      this.step(`vendored files of ${row.repo}`, () => this.vendored(row.repo));
      await this.stepAsync(`Gradle dependencies of ${row.repo}`, () => this.gradle(row.repo));
    }
    await this.stepAsync("forks and upstreams", () => this.upstreams());
    this.step("watched sources", () => this.watchedSources());
    await this.stepAsync("AGENTS.md", () => this.agents());
    this.step("runtime links", () => this.runtime());
    this.planned();
    for (const link of PRIVATE_LINKS) {
      this.edge({ ...link, status: "none" });
    }

    const used = new Set(this.edges.flatMap((edge) => [edge.from, edge.to]));
    const map = {
      generated: new Date().toISOString(),
      nodes: [...this.nodes.values()].filter((node) => node.kind === "repo" || node.kind === "fork" || used.has(node.id)),
      edges: this.edges,
      notes: this.notes,
    };
    return redact(map, this.hidden);
  }

  /** Runs one step; a failure becomes a note instead of stopping the run. */
  private step(name: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.notes.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async stepAsync(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.notes.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A node for `id`, made once; GitHub repositories outside ours are external. */
  private node(id: string, kind: WiringNode["kind"] = "external", label = id): WiringNode {
    const known = this.nodes.get(id);
    if (known) {
      return known;
    }
    const node: WiringNode = { id, kind, label, readable: true };
    if (kind !== "package") {
      node.url = `https://github.com/${id}`;
    }
    this.nodes.set(id, node);
    return node;
  }

  /** Adds an edge, making nodes for both ends. */
  private edge(edge: WiringEdge): void {
    this.node(edge.from);
    this.node(edge.to);
    this.edges.push(edge);
  }

  /** The repository nodes: AnkiQuest-Agents' table and the extra repositories. */
  private async repos(): Promise<void> {
    const shared = this.clones.read(AGENTS, "shared.md");
    if (shared === undefined) {
      throw new Error(`cannot read ${AGENTS} shared.md`);
    }
    for (const name of repeatedRows(shared)) {
      this.notes.push(`${AGENTS} shared.md lists ${name} more than once in "Repositories".`);
    }
    this.ours.push(...repoTable(shared), ...EXTRA_REPOS);
    for (const { row } of PLANNED) {
      if (!this.ours.some((known) => known.repo === row.repo)) {
        this.ours.push(row);
      }
    }

    for (const row of this.ours) {
      const node = this.node(row.repo, row.upstream ? "fork" : "repo", row.repo.split("/")[1]);
      node.purpose = row.purpose;
      // Private repositories are never read: they stay bare nodes.
      if (this.hidden.has(row.repo)) {
        continue;
      }
      const info = await repoInfo(row.repo);
      node.private = info?.private;
      if (info?.private) {
        this.hidden.add(row.repo);
        continue;
      }
      if (info === undefined) {
        this.notes.push(`${row.repo}: the GitHub API did not answer (private, or rate limited); its visibility and open pull requests are unknown.`);
      }
      try {
        node.head = this.clones.tipCommit(row.repo);
        this.readable.add(row.repo);
      } catch (error) {
        // A planned repository without commits yet is planned, not unreadable.
        if (PLANNED.some((plan) => plan.row.repo === row.repo)) {
          node.planned = true;
          node.note = "Planned: the repository has no commits yet, or cannot be read.";
          continue;
        }
        node.readable = false;
        node.note = "Not readable by the generator; its edges are missing or unknown.";
        this.notes.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  /** The latest commit of `repo`'s `branch` (default: its default branch) and the ref to count against. */
  private latest(repo: string, branch?: string): { ref: string; commit: string } {
    const ref = branch ? this.clones.fetch(repo, repo, branch) : "HEAD";
    return { ref, commit: this.clones.resolve(repo, ref) };
  }

  /** A pin of `target` at `pinned`: latest commit, commits behind and status. */
  private pin(target: string, pinned: string | undefined, branch?: string): Pick<WiringEdge, "pinned" | "latest" | "behind" | "status"> {
    try {
      const { ref, commit } = this.latest(target, branch);
      const behind = pinned ? this.clones.count(target, pinned, ref) : undefined;
      return { pinned, latest: commit, behind, status: pinStatus(pinned, commit, behind) };
    } catch {
      return { pinned, status: "unknown" };
    }
  }

  /** Git submodules and the commit each points to. */
  private submodules(repo: string): void {
    const text = this.clones.read(repo, ".gitmodules");
    if (text === undefined) {
      return;
    }
    for (const sub of gitmodules(text)) {
      const target = githubRepo(sub.url);
      if (target === undefined) {
        this.notes.push(`${repo}: submodule ${sub.path} is not on GitHub (${sub.url}).`);
        continue;
      }
      const pinned = this.clones.entry(repo, sub.path)?.object;
      this.edge({
        kind: "submodule",
        from: target,
        to: repo,
        label: sub.path,
        ...this.pin(target, pinned, sub.branch),
        detail: sub.branch ? `follows ${sub.branch}` : undefined,
        source: blob(repo, ".gitmodules"),
      });
    }
  }

  /** Flake inputs from AnkiQuest repositories, locked commit against the branch. */
  private flake(repo: string): void {
    const text = this.clones.read(repo, "flake.lock");
    if (text === undefined) {
      return;
    }
    for (const input of flakeInputs(text)) {
      if (!input.repo || input.repo.split("/")[0].toLowerCase() !== ORG.toLowerCase()) {
        continue;
      }
      const target = `${ORG}/${input.repo.split("/")[1]}`;
      this.edge({
        kind: "flake",
        from: target,
        to: repo,
        label: input.input,
        ...this.pin(target, input.rev, input.ref),
        source: blob(repo, "flake.lock"),
      });
    }
  }

  /** Reusable workflows, actions and checkouts from other AnkiQuest repositories. */
  private workflows(repo: string): void {
    const files = this.clones.files(repo).filter((file) => /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/.test(file));
    const seen = new Set<string>();
    const checkouts = new Map<string, { files: string[]; source: string }>();
    for (const file of files) {
      const text = this.clones.read(repo, file) ?? "";
      for (const use of workflowUses(text)) {
        if (use.repo.toLowerCase() === repo.toLowerCase() || use.repo.split("/")[0] !== ORG) {
          continue;
        }
        const key = `${use.repo} ${use.path}@${use.ref}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        this.edge({ kind: "workflow", from: use.repo, to: repo, label: `${use.path.replace(/^\.github\//, "")}@${use.ref}`, ...this.reusable(use.repo, use.path, use.ref), source: blob(repo, file, use.line) });
      }
      for (const checkout of workflowCheckouts(text)) {
        if (checkout.repo.toLowerCase() === repo.toLowerCase() || checkout.repo.split("/")[0] !== ORG) {
          continue;
        }
        // One edge per repository checked out, naming every workflow that does it.
        const entry = checkouts.get(checkout.repo) ?? { files: [], source: blob(repo, file, checkout.line) };
        if (!entry.files.includes(basename(file))) {
          entry.files.push(basename(file));
        }
        checkouts.set(checkout.repo, entry);
      }
    }
    for (const [target, entry] of checkouts) {
      this.edge({ kind: "checkout", from: target, to: repo, label: `checked out by ${entry.files.join(", ")}`, status: "none", source: entry.source });
    }
  }

  /** Whether a used workflow or action exists in its repository, and how its ref is pinned. */
  private reusable(target: string, path: string, ref: string): Pick<WiringEdge, "pinned" | "latest" | "status" | "detail"> {
    const files = this.readable.has(target) ? this.clones.files(target) : undefined;
    if (files === undefined) {
      return { pinned: ref, status: "unknown" };
    }
    const exists = files.includes(path) || files.some((file) => file.startsWith(`${path}/action.y`));
    if (!exists) {
      return { pinned: ref, status: "behind", detail: `${path} does not exist on ${target}'s default branch` };
    }
    if (/^[0-9a-f]{40}$/.test(ref)) {
      return { ...this.pin(target, ref), detail: "pinned to a commit" };
    }
    return { pinned: ref, status: "current", detail: `follows ${ref}` };
  }

  /** Cargo dependencies on other repositories: git dependencies and paths into submodules. */
  private cargo(repo: string): void {
    const files = this.clones.files(repo).filter((file) => basename(file) === "Cargo.toml");
    const submodules = gitmodules(this.clones.read(repo, ".gitmodules") ?? "");
    const viaSubmodule = new Map<string, { crates: Set<string>; file: string; line: number }>();

    for (const file of files) {
      for (const dep of cargoDeps(this.clones.read(repo, file) ?? "")) {
        // A git dependency: its rev against the branch it follows.
        if (dep.git) {
          const target = githubRepo(dep.git);
          if (!target) {
            continue;
          }
          const pin = dep.rev ? this.pin(target, this.full(target, dep.rev), dep.branch) : { pinned: dep.branch ?? dep.tag ?? "default branch", status: "none" as Status };
          this.edge({ kind: "cargo", from: target, to: repo, label: `crate ${dep.name}`, ...pin, source: blob(repo, file, dep.line) });
          continue;
        }

        // A path dependency into a submodule: the submodule's repository.
        const path = normalize(join(dirname(file), dep.path ?? ""));
        const sub = submodules.find((entry) => path === entry.path || path.startsWith(`${entry.path}/`));
        const target = sub ? githubRepo(sub.url) : undefined;
        if (!sub || !target) {
          continue;
        }
        const entry = viaSubmodule.get(target) ?? { crates: new Set<string>(), file, line: dep.line };
        entry.crates.add(dep.name);
        viaSubmodule.set(target, entry);
      }
    }

    for (const [target, entry] of viaSubmodule) {
      const sub = submodules.find((candidate) => githubRepo(candidate.url) === target);
      const pinned = sub ? this.clones.entry(repo, sub.path)?.object : undefined;
      this.edge({
        kind: "cargo",
        from: target,
        to: repo,
        label: `crates ${[...entry.crates].sort().join(", ")} (through the ${sub?.path} submodule)`,
        ...this.pin(target, pinned, sub?.branch),
        source: blob(repo, entry.file, entry.line),
      });
    }
  }

  /** A full commit hash for a possibly short `rev`, when the graph clone knows it. */
  private full(repo: string, rev: string): string {
    try {
      return this.clones.resolve(repo, `${rev}^{commit}`);
    } catch {
      return rev;
    }
  }

  /** Commits of AnkiQuest-Server pinned in `ankiquest-server.sha` files. */
  private serverPins(repo: string): void {
    for (const file of this.clones.files(repo).filter((path) => basename(path) === SERVER_PIN)) {
      const pinned = this.clones.read(repo, file)?.trim();
      this.edge({ kind: "data", from: SERVER, to: repo, label: "API examples and shared fixtures", ...this.pin(SERVER, pinned), source: blob(repo, file) });
    }
  }

  /** Copies of AnkiDroid's provider contract in other repositories. */
  private vendored(repo: string): void {
    if (repo === ANDROID) {
      return;
    }
    for (const file of this.clones.files(repo).filter((path) => /\/FlashCards(Contract)?\.(kt|java)$/.test(path))) {
      if (!/FlashCardsContract/.test(this.clones.read(repo, file) ?? "")) {
        continue;
      }
      this.edge({ kind: "vendored", from: "ankidroid/Anki-Android", to: repo, label: `provider contract copied as ${basename(file)}`, status: "none", source: blob(repo, file) });
    }
  }

  /** The package node of a Maven group. */
  private mavenNode(group: string): WiringNode {
    const node = this.node(`maven:${group}`, "package", group);
    node.url = group.startsWith(JITPACK_GROUP) ? `https://jitpack.io/#${group.slice(JITPACK_GROUP.length)}` : `https://central.sonatype.com/namespace/${group}`;
    return node;
  }

  /** The newest version of `group:artifact` and what to say about it. */
  private async newest(group: string, artifact: string): Promise<{ latest?: string; detail?: string }> {
    if (group.startsWith(JITPACK_GROUP)) {
      return { detail: "JitPack build; no index to compare with" };
    }
    const found = await central(group, artifact);
    if (found.state === "published") {
      return { latest: found.latest };
    }
    return { detail: found.state === "absent" ? `${group}:${artifact} is not on Maven Central` : "Maven Central did not answer" };
  }

  /** Gradle dependencies on Anki and AnkiQuest artifacts, and the artifacts a repository publishes. */
  private async gradle(repo: string): Promise<void> {
    const files = this.clones.files(repo);

    // Dependencies: version catalogs and literal coordinates in build files.
    const deps: { dep: MavenDep; file: string }[] = [];
    for (const file of files.filter((path) => path.endsWith(".versions.toml"))) {
      deps.push(...versionCatalog(this.clones.read(repo, file) ?? "").map((dep) => ({ dep, file })));
    }
    for (const file of files.filter((path) => /(^|\/)build\.gradle(\.kts)?$/.test(path))) {
      deps.push(...gradleCoordinates(this.clones.read(repo, file) ?? "").map((dep) => ({ dep, file })));
    }
    const byGroup = new Map<string, { artifacts: Set<string>; versions: Set<string>; first: MavenDep; file: string }>();
    for (const { dep, file } of deps) {
      if (!(dep.group in MAVEN_GROUPS)) {
        continue;
      }
      const entry = byGroup.get(dep.group) ?? { artifacts: new Set<string>(), versions: new Set<string>(), first: dep, file };
      entry.artifacts.add(dep.artifact);
      if (dep.version) {
        entry.versions.add(dep.version);
      }
      byGroup.set(dep.group, entry);
    }
    for (const [group, entry] of byGroup) {
      const node = this.mavenNode(group);
      const publisher = MAVEN_GROUPS[group];
      if (publisher) {
        this.publisher(publisher, node);
      }
      const pinned = [...entry.versions].join(", ") || undefined;
      const { latest, detail } = await this.newest(group, entry.first.artifact);
      this.edge({
        kind: "maven",
        from: node.id,
        to: repo,
        label: [...entry.artifacts].sort().join(", "),
        pinned,
        latest,
        status: latest === undefined ? (detail?.startsWith("JitPack") ? "none" : "unknown") : pinStatus(pinned, latest, undefined),
        detail,
        source: blob(repo, entry.file, entry.first.line),
      });
    }

    await this.publications(repo, files);
  }

  /** A declared publisher of an external Maven group. */
  private publisher(repo: string, node: WiringNode): void {
    if (this.edges.some((edge) => edge.kind === "publishes" && edge.to === node.id)) {
      return;
    }
    this.edge({ kind: "publishes", from: repo, to: node.id, label: `publishes ${node.label}`, status: "none" });
  }

  /** Artifacts a repository's Gradle build publishes, against what Maven Central has. */
  private async publications(repo: string, files: string[]): Promise<void> {
    // gradle-maven-publish-plugin: GROUP and VERSION_NAME at the root, POM_ARTIFACT_ID per module.
    const root = properties(this.clones.read(repo, "gradle.properties") ?? "");
    const group = root.get("GROUP");
    const version = root.get("VERSION_NAME");
    const artifacts = files
      .filter((file) => file.endsWith("/gradle.properties"))
      .map((file) => properties(this.clones.read(repo, file) ?? "").get("POM_ARTIFACT_ID"))
      .filter((id): id is string => id !== undefined);
    if (group && version && artifacts.length > 0) {
      await this.publish(repo, group, artifacts, version, blob(repo, "gradle.properties"));
    }

    // maven-publish with an artifactId in the module's build file.
    for (const file of files.filter((path) => path.endsWith("build.gradle.kts"))) {
      const text = this.clones.read(repo, file) ?? "";
      const artifact = /artifactId\s*=\s*"([^"]+)"/.exec(text)?.[1];
      const publication = gradlePublication(text);
      if (!artifact || !publication.group || !publication.version || !text.includes("maven-publish")) {
        continue;
      }
      await this.publish(repo, publication.group, [artifact], publication.version, blob(repo, file));
    }
  }

  /** One publishes edge: the version the build sets against Maven Central. */
  private async publish(repo: string, group: string, artifacts: string[], version: string, source: string): Promise<void> {
    const node = this.mavenNode(group);
    const { latest, detail } = await this.newest(group, artifacts[0]);
    const ours = group.startsWith("org.ankiquest");
    this.edge({
      kind: "publishes",
      from: repo,
      to: node.id,
      label: artifacts.join(", "),
      pinned: version,
      latest,
      status: !ours ? "none" : latest === undefined ? "behind" : pinStatus(version, latest, undefined),
      detail: ours ? detail : `${group} is upstream's group: AnkiQuest does not publish this module${detail ? `; ${detail}` : ""}`,
      source,
    });
  }

  /** Forks against their upstreams, from AnkiQuest-Sync's sync.yml. */
  private async upstreams(): Promise<void> {
    const forks = syncMatrix(this.clones.read(SYNC, ".github/workflows/sync.yml") ?? "");
    const table = this.ours.filter((row) => row.upstream);
    for (const row of table) {
      if (!forks.some((fork) => fork.fork === row.repo && fork.upstream === row.upstream)) {
        this.notes.push(`${row.repo}: shared.md names upstream ${row.upstream}, but sync.yml does not sync it.`);
      }
    }

    for (const fork of forks) {
      const owner = fork.upstream.split("/")[0];
      const pulls = await openPulls(fork.fork, `${owner}:${fork.branch}`);
      const pull = pulls?.[0];
      try {
        const ref = this.clones.fetch(fork.fork, fork.upstream, fork.branch);
        const latest = this.clones.resolve(fork.fork, ref);
        const behind = this.clones.count(fork.fork, "HEAD", ref);
        const ahead = this.clones.count(fork.fork, ref, "HEAD");
        this.edge({
          kind: "upstream",
          from: fork.upstream,
          to: fork.fork,
          label: `${fork.branch} merged by the sync job`,
          pinned: this.clones.mergeBase(fork.fork, "HEAD", ref),
          latest,
          behind,
          status: pinStatus("merge base", latest, behind),
          detail: [`${ahead ?? "?"} commits of ours on top`, pull ? `open: ${pull.url}` : undefined].filter(Boolean).join("; "),
          source: blob(SYNC, ".github/workflows/sync.yml"),
        });
        this.upstreamPins(fork.fork, fork.upstream, ref);
      } catch (error) {
        this.edge({ kind: "upstream", from: fork.upstream, to: fork.fork, label: `${fork.branch} merged by the sync job`, status: "unknown", detail: String(error), source: blob(SYNC, ".github/workflows/sync.yml") });
      }
    }
  }

  /**
   * An upstream's own submodule pins that our fork's submodule target must
   * contain: upstream AnkiDroid's backend pins an ankitects/anki commit, which
   * AnkiQuest-Anki needs before the backend can take upstream's changes.
   */
  private upstreamPins(fork: string, upstream: string, ref: string): void {
    for (const sub of gitmodules(this.clones.read(fork, ".gitmodules") ?? "")) {
      const target = githubRepo(sub.url);
      const theirs = this.clones.gitlinkAt(fork, ref, sub.path);
      if (!target || !theirs || !this.readable.has(target)) {
        continue;
      }
      const ours = this.clones.entry(fork, sub.path)?.object;
      const inTarget = this.clones.contains(target, theirs, "HEAD");
      const inPin = ours ? this.clones.contains(target, theirs, ours) : undefined;
      const status: Status = inTarget === undefined ? "unknown" : inTarget && inPin ? "current" : "behind";
      const where = inTarget === false ? `${target} does not contain it yet` : inPin === false ? `${target} has it, ${fork}'s ${sub.path} pin does not` : undefined;
      this.edge({
        kind: "upstream",
        from: upstream,
        to: target,
        label: `${upstream}'s ${sub.path} submodule pin`,
        pinned: theirs,
        status,
        detail: where,
        source: `https://github.com/${upstream}/tree/HEAD/${sub.path}`,
      });
    }
  }

  /** Sources watched.json lists: reviewed commit or version against the current one. */
  private watchedSources(): void {
    const list = watched(this.clones.read(SYNC, "watched.json") ?? "[]");
    for (const entry of list) {
      const source = blob(SYNC, "watched.json");
      try {
        const ref = this.clones.fetch(entry.target, entry.source, entry.ref);
        if (entry.kind === "version") {
          const current = properties(this.clones.readAt(entry.target, ref, entry.file ?? "") ?? "").get(entry.key ?? "");
          this.edge({ kind: "watched", from: entry.source, to: entry.target, label: `${entry.key} on ${entry.ref}`, pinned: entry.reviewed, latest: current, status: pinStatus(entry.reviewed, current, undefined), detail: entry.why, source });
          continue;
        }
        const latest = this.clones.resolve(entry.target, ref);
        const behind = this.clones.count(entry.target, entry.reviewed, ref);
        this.edge({ kind: "watched", from: entry.source, to: entry.target, label: `${entry.ref}, ported by hand`, pinned: entry.reviewed, latest, behind, status: pinStatus(entry.reviewed, latest, behind), detail: entry.why, source });
      } catch (error) {
        this.edge({ kind: "watched", from: entry.source, to: entry.target, label: `${entry.ref}, ported by hand`, pinned: entry.reviewed, status: "unknown", detail: String(error), source });
      }
    }
  }

  /** Each repository's AGENTS.md against the one AnkiQuest-Sync generates from AnkiQuest-Agents. */
  private async agents(): Promise<void> {
    const shared = this.clones.read(AGENTS, "shared.md") ?? "";
    const targets = agentsTargets(this.clones.read(SYNC, ".github/workflows/agents.yml") ?? "");
    const sections = new Set(this.clones.files(AGENTS).filter((file) => file.startsWith("repos/")));

    for (const row of this.ours) {
      const name = row.repo.split("/")[1];
      const section = `repos/${name}.md`;
      if (!sections.has(section)) {
        continue;
      }
      const listed = targets.includes(row.repo);
      const base = { kind: "agents" as EdgeKind, from: AGENTS, to: row.repo, label: "AGENTS.md", source: blob(AGENTS, section) };
      if (!this.readable.has(row.repo)) {
        this.edge({ ...base, status: "unknown", detail: listed ? "repository not readable" : "not in AnkiQuest-Sync's TARGETS" });
        continue;
      }

      const expected = agentsFile(shared, this.clones.read(AGENTS, section) ?? "");
      const entry = this.clones.entry(row.repo, "AGENTS.md");
      const actual = entry?.mode === SYMLINK ? undefined : this.clones.read(row.repo, "AGENTS.md");
      const pull = (await openPulls(row.repo, `${ORG}:agents-sync`))?.[0];
      const problems = [
        listed ? undefined : "not in AnkiQuest-Sync's TARGETS",
        entry === undefined ? "no AGENTS.md" : entry.mode === SYMLINK ? "AGENTS.md is a symlink" : actual === expected ? undefined : "differs from AnkiQuest-Agents",
        pull ? `open: ${pull.url}` : undefined,
      ].filter(Boolean);
      const current = listed && actual === expected;
      this.edge({ ...base, pinned: current ? "matches" : "differs", status: current ? "current" : "behind", detail: problems.join("; ") || undefined });
    }
  }

  /** Planned submodule edges the consumers do not have yet. */
  private planned(): void {
    for (const plan of PLANNED) {
      for (const consumer of plan.consumers) {
        const made = this.edges.some((edge) => edge.kind === "submodule" && edge.from === plan.row.repo && edge.to === consumer);
        if (made) {
          continue;
        }
        this.edge({ kind: "submodule", from: plan.row.repo, to: consumer, label: "art (planned)", status: "planned", detail: "decided, not in the repository's .gitmodules yet" });
      }
    }
  }

  /** Runtime links, each checked against the file that shows it. */
  private runtime(): void {
    for (const link of RUNTIME) {
      const holder = link.to;
      const text = this.readable.has(holder) ? this.clones.read(holder, link.file) : undefined;
      const shown = text !== undefined && link.needle.test(text);
      this.edge({
        kind: "runtime",
        from: link.from,
        to: link.to,
        label: link.label,
        status: shown ? "none" : "unknown",
        detail: shown ? undefined : `${link.file} not found or no longer shows it`,
        source: blob(holder, link.file),
      });
    }
  }
}

/** Collects the map, caching clones in `cache`. */
export async function collect(cache: string): Promise<Wiring> {
  return new Collector(cache).collect();
}

// Run when called as a script, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cacheAt = args.indexOf("--cache");
  const cache = cacheAt >= 0 ? args.splice(cacheAt, 2)[1] : join(tmpdir(), "ankiquest-wiring");
  const out = args[0] ?? "wiring.json";
  const wiring = await collect(cache);
  writeFileSync(out, `${JSON.stringify(wiring, null, 2)}\n`);
  const behind = wiring.edges.filter((edge) => edge.status === "behind").length;
  const unknown = wiring.edges.filter((edge) => edge.status === "unknown").length;
  console.log(`${wiring.nodes.length} nodes, ${wiring.edges.length} edges (${behind} behind, ${unknown} unknown), ${wiring.notes.length} notes, into ${out}`);
}
