// Checks the wiring map's parsers against small copies of the files they
// read, and the page's helpers against a small map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { pinStatus, redact, short, vendorSource } from "./wiring.ts";
import { edgeOf, merge, summary } from "./wiring-edges.ts";
import type { Wiring } from "./wiring-model.ts";
import {
  agentsFile,
  agentsTargets,
  cargoDeps,
  flakeInputs,
  githubRepo,
  gitmodules,
  gradleCoordinates,
  gradlePublication,
  mavenLatest,
  properties,
  repeatedRows,
  repoTable,
  syncMatrix,
  versionCatalog,
  workflowCheckouts,
  workflowUses,
} from "./wiring-parse.ts";
import {
  DEFAULT_KINDS,
  LAYOUT,
  ROW,
  badge,
  bow,
  boxSize,
  direction,
  fallbackLane,
  lines,
  mark,
  matches,
  places,
  stacked,
  statusText,
  visibleEdges,
  wrap,
  type Place,
} from "../site/wiring.ts";

test("gitmodules reads path, url and branch", () => {
  const text = `[submodule "anki"]
\tpath = anki
\turl = https://github.com/AnkiQuest/AnkiQuest-Anki
\tbranch = master
[submodule "nixos/hosts/aws"]
\tpath = nixos/hosts/aws
\turl = ssh://git@github.com/AnkiQuest/AnkiQuest-Hosting.git
`;
  assert.deepEqual(gitmodules(text), [
    { name: "anki", path: "anki", url: "https://github.com/AnkiQuest/AnkiQuest-Anki", branch: "master" },
    { name: "nixos/hosts/aws", path: "nixos/hosts/aws", url: "ssh://git@github.com/AnkiQuest/AnkiQuest-Hosting.git" },
  ]);
});

test("githubRepo accepts https, ssh and scp forms", () => {
  assert.equal(githubRepo("https://github.com/ankitects/anki.git"), "ankitects/anki");
  assert.equal(githubRepo("ssh://git@github.com/AnkiQuest/AnkiQuest-Hosting.git"), "AnkiQuest/AnkiQuest-Hosting");
  assert.equal(githubRepo("git@github.com:float3/nixos"), "float3/nixos");
  assert.equal(githubRepo("https://gitlab.com/a/b"), undefined);
});

test("flakeInputs reads the root's github and git inputs, not follows", () => {
  const lock = {
    root: "root",
    version: 7,
    nodes: {
      root: { inputs: { "ankiquest-dev": "ankiquest-dev", nixpkgs: "nixpkgs", wsl: ["ankiquest-dev", "nixos-wsl"] } },
      "ankiquest-dev": { locked: { type: "github", owner: "AnkiQuest", repo: "AnkiQuest-Dev", rev: "a".repeat(40) }, original: { type: "github", owner: "AnkiQuest", repo: "AnkiQuest-Dev" } },
      nixpkgs: { locked: { type: "git", url: "https://github.com/nixos/nixpkgs?shallow=1", rev: "b".repeat(40) }, original: { ref: "nixos-unstable" } },
    },
  };
  assert.deepEqual(flakeInputs(JSON.stringify(lock)), [
    { input: "ankiquest-dev", repo: "AnkiQuest/AnkiQuest-Dev", rev: "a".repeat(40), ref: undefined },
    { input: "nixpkgs", repo: "nixos/nixpkgs", rev: "b".repeat(40), ref: "nixos-unstable", url: "https://github.com/nixos/nixpkgs?shallow=1" },
  ]);
});

test("workflowUses finds reusable workflows and actions, skipping comments and local ones", () => {
  const text = `jobs:
  labels:
    uses: AnkiQuest/AnkiQuest-Dev/.github/workflows/labels.yml@master
  # uses: AnkiQuest/AnkiQuest-Dev/.github/workflows/banner.yml@master
  scan:
    steps:
      - uses: AnkiQuest/AnkiQuest-Dev/.github/actions/conflict-scan@master
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: ./.github/actions/robolectric-sdk-cache
`;
  assert.deepEqual(
    workflowUses(text).filter((use) => use.repo.startsWith("AnkiQuest/")),
    [
      { repo: "AnkiQuest/AnkiQuest-Dev", path: ".github/workflows/labels.yml", ref: "master", line: 3 },
      { repo: "AnkiQuest/AnkiQuest-Dev", path: ".github/actions/conflict-scan", ref: "master", line: 7 },
    ],
  );
  assert.equal(workflowUses(text).length, 2);
});

test("workflowCheckouts finds the repository and its ref", () => {
  const text = `      - uses: actions/checkout@v4
        with:
          repository: AnkiQuest/AnkiQuest-Server
          ref: \${{ steps.server-ref.outputs.ref }}
          path: server
`;
  assert.deepEqual(workflowCheckouts(text), [{ repo: "AnkiQuest/AnkiQuest-Server", ref: "${{ steps.server-ref.outputs.ref }}", line: 3 }]);
});

test("versionCatalog resolves version refs and the three library forms", () => {
  const text = `[versions]
ankiBackend = '0.1.77-anki26.09.4' # Also update expectedPolicy
kotlin = "2.2.0"

[libraries]
ankiBackend-backend = { module = "io.github.david-allison:anki-backend-android", version.ref = "ankiBackend" }
kotlin-stdlib = { group = "org.jetbrains.kotlin", name = "kotlin-stdlib", version.ref = "kotlin" }
junit = "junit:junit:4.13.2"

[plugins]
android = { id = "com.android.application", version = "8.13.0" }
`;
  assert.deepEqual(versionCatalog(text), [
    { group: "io.github.david-allison", artifact: "anki-backend-android", version: "0.1.77-anki26.09.4", line: 6 },
    { group: "org.jetbrains.kotlin", artifact: "kotlin-stdlib", version: "2.2.0", line: 7 },
    { group: "junit", artifact: "junit", version: "4.13.2", line: 8 },
  ]);
});

test("gradleCoordinates reads literal coordinates, not comments", () => {
  const text = `dependencies {
    implementation 'com.github.ankidroid:Anki-Android:2.17alpha14'
    // implementation 'com.example:old:1.0'
}`;
  assert.deepEqual(gradleCoordinates(text), [{ group: "com.github.ankidroid", artifact: "Anki-Android", version: "2.17alpha14", line: 2 }]);
});

test("gradlePublication reads group and version", () => {
  assert.deepEqual(gradlePublication(`plugins { id("maven-publish") }\ngroup = "com.ichi2.anki"\nversion = "2.0.0"\n`), { group: "com.ichi2.anki", version: "2.0.0" });
});

test("cargoDeps reads git and path dependencies, inline and as tables", () => {
  const text = `[workspace.dependencies.fsrs]
git = "https://github.com/JSchoreels/fsrs-rs.git"
rev = "bd8932bb33d68bf0ac0e4367b154eec837f7fad2"

[dependencies]
anki = { path = "../anki/rslib", features = ["rustls"] }
serde = "1"
`;
  assert.deepEqual(cargoDeps(text), [
    { name: "fsrs", git: "https://github.com/JSchoreels/fsrs-rs.git", rev: "bd8932bb33d68bf0ac0e4367b154eec837f7fad2", line: 1 },
    { name: "anki", git: undefined, rev: undefined, branch: undefined, tag: undefined, path: "../anki/rslib", line: 6 },
  ]);
});

test("properties and mavenLatest", () => {
  assert.equal(properties("# c\nGROUP=org.ankiquest\nVERSION_NAME=0.1.77-ankiquest.3\n").get("VERSION_NAME"), "0.1.77-ankiquest.3");
  assert.equal(mavenLatest("<metadata><versioning><latest>2</latest><release>1.9</release></versioning></metadata>"), "1.9");
  assert.equal(mavenLatest("<metadata/>"), undefined);
});

test("syncMatrix and agentsTargets read AnkiQuest-Sync's workflows", () => {
  const sync = `        include:
          - { fork: AnkiQuest/AnkiQuest-Anki, upstream: ankitects/anki, upstream_branch: main }
          # - { fork: AnkiQuest/Old, upstream: a/b, upstream_branch: main }
`;
  assert.deepEqual(syncMatrix(sync), [{ fork: "AnkiQuest/AnkiQuest-Anki", upstream: "ankitects/anki", branch: "main" }]);
  const agents = `env:
  TARGETS: |
    [
      "AnkiQuest/AnkiQuest-Server",
      "AnkiQuest/AnkiQuest-Desktop"
    ]

jobs:
`;
  assert.deepEqual(agentsTargets(agents), ["AnkiQuest/AnkiQuest-Server", "AnkiQuest/AnkiQuest-Desktop"]);
});

test("repoTable reads each repository once and repeatedRows reports repeats", () => {
  const md = `## Repositories

| Repository | Upstream | Purpose |
|---|---|---|
| AnkiQuest-Server | none | The server. |
| AnkiQuest-Anki | ankitects/anki | Anki's core. |
| AnkiQuest-Server | none | Again. |

## People
`;
  assert.deepEqual(repoTable(md), [
    { repo: "AnkiQuest/AnkiQuest-Server", upstream: undefined, purpose: "The server." },
    { repo: "AnkiQuest/AnkiQuest-Anki", upstream: "ankitects/anki", purpose: "Anki's core." },
  ]);
  assert.deepEqual(repeatedRows(md), ["AnkiQuest-Server"]);
});

test("agentsFile is shared.md, a blank line and the section", () => {
  assert.equal(agentsFile("# A\n", "## This repository\n"), "# A\n\n## This repository\n");
});

test("pinStatus and short", () => {
  assert.equal(pinStatus("a", "a", undefined), "current");
  assert.equal(pinStatus("a", "b", 0), "current");
  assert.equal(pinStatus("a", "b", 3), "behind");
  assert.equal(pinStatus("a", "b", undefined), "behind");
  assert.equal(pinStatus(undefined, "b", undefined), "unknown");
  assert.equal(short("0123456789".repeat(4)), "0123456789");
  assert.equal(short("0.1.77"), "0.1.77");
});

test("redact keeps only bare links between private and AnkiQuest repositories", () => {
  const map: Wiring = {
    generated: "2026-11-21T00:00:00Z",
    notes: ["cannot clone float3/nixos: denied", "other note"],
    nodes: [
      { id: "float3/nixos", kind: "repo", label: "nixos", readable: true, head: "a".repeat(40), purpose: "details", private: true },
      { id: "AnkiQuest/AnkiQuest-Server", kind: "repo", label: "AnkiQuest-Server", readable: true, head: "b".repeat(40) },
      { id: "nixos/nixpkgs", kind: "external", label: "nixos/nixpkgs", readable: true },
    ],
    edges: merge([
      { kind: "flake", from: "AnkiQuest/AnkiQuest-Server", to: "float3/nixos", label: "ankiquest", pinned: "c".repeat(40), latest: "b".repeat(40), behind: 12, status: "behind", detail: "x", source: "https://github.com/float3/nixos/blob/HEAD/flake.lock" },
      { kind: "flake", from: "nixos/nixpkgs", to: "float3/nixos", label: "nixpkgs", pinned: "d".repeat(40), status: "current" },
      { kind: "data", from: "AnkiQuest/AnkiQuest-Server", to: "AnkiQuest/AnkiQuest-Android", label: "fixtures", pinned: "e".repeat(40), behind: 3, status: "behind" },
    ]),
  };
  const out = redact(map, new Set(["float3/nixos"]));
  assert.deepEqual(out.edges[0], {
    from: "AnkiQuest/AnkiQuest-Server",
    to: "float3/nixos",
    kinds: ["flake"],
    label: "flake input: ankiquest",
    status: "none",
    facts: [{ kind: "flake", label: "ankiquest", status: "none" }],
  });
  assert.equal(out.edges.length, 2, "the edge to a non-AnkiQuest repository is dropped");
  assert.deepEqual(out.edges[1], map.edges[2], "public edges are unchanged");
  const nixos = out.nodes[0];
  assert.equal(nixos.head, undefined);
  assert.equal(nixos.purpose, undefined);
  assert.equal(nixos.private, true);
  assert.deepEqual(out.nodes[1], map.nodes[1]);
  assert.deepEqual(out.notes, ["other note"]);
  assert.ok(!JSON.stringify(out).includes("c".repeat(40)));
});

test("the committed wiring.json has no details of private repositories", () => {
  const map = JSON.parse(readFileSync(new URL("../wiring.json", import.meta.url), "utf8")) as Wiring;
  const hidden = new Set(map.nodes.filter((node) => node.private).map((node) => node.id));
  assert.ok(hidden.has("float3/nixos") && hidden.has("AnkiQuest/AnkiQuest-Hosting"));
  for (const node of map.nodes.filter((candidate) => hidden.has(candidate.id))) {
    assert.equal(node.head, undefined);
    assert.equal(node.purpose, undefined);
  }
  for (const edge of map.edges.filter((candidate) => hidden.has(candidate.from) || hidden.has(candidate.to))) {
    assert.deepEqual(Object.keys(edge).sort(), ["facts", "from", "kinds", "label", "status", "to"]);
    assert.equal(edge.status, "none");
    for (const fact of edge.facts) {
      assert.deepEqual(Object.keys(fact).sort(), ["kind", "label", "status"]);
    }
  }
  assert.ok(!map.notes.some((note) => [...hidden].some((id) => note.includes(id))));
});

/** A small map for the page's helpers. */
const MAP: Wiring = {
  generated: "2026-11-21T00:00:00Z",
  notes: [],
  nodes: [
    { id: "AnkiQuest/AnkiQuest-Dev", kind: "repo", label: "AnkiQuest-Dev", readable: true },
    { id: "AnkiQuest/AnkiQuest-Server", kind: "repo", label: "AnkiQuest-Server", readable: true },
    { id: "AnkiQuest/AnkiQuest-Art", kind: "repo", label: "AnkiQuest-Art", readable: true, planned: true },
  ],
  edges: merge([
    { kind: "flake", from: "AnkiQuest/AnkiQuest-Dev", to: "AnkiQuest/AnkiQuest-Server", label: "ankiquest-dev", behind: 4, status: "behind" },
    { kind: "workflow", from: "AnkiQuest/AnkiQuest-Dev", to: "AnkiQuest/AnkiQuest-Server", label: "labels.yml@master", status: "current" },
    { kind: "art", from: "AnkiQuest/AnkiQuest-Art", to: "AnkiQuest/AnkiQuest-Server", label: "planned", status: "planned" },
  ]),
};

test("statusText names the status in words, with the count", () => {
  const [flake, workflow] = MAP.edges[0].facts;
  assert.equal(statusText(flake), "out of date: 4 commits behind");
  assert.equal(statusText(workflow), "up to date");
  assert.equal(statusText(MAP.edges[1]), "planned");
  assert.equal(statusText({ ...flake, behind: undefined }), "out of date");
});

test("merge makes one edge per pair of nodes, keeping each fact", () => {
  // JSchoreels/fsrs-rs: a Cargo pin and a watched source at the same commit.
  const rev = "bd8932b".padEnd(40, "0");
  const [fsrs, other] = merge([
    { kind: "cargo", from: "JSchoreels/fsrs-rs", to: "AnkiQuest/AnkiQuest-Anki", label: "crate fsrs", pinned: rev, behind: 14, status: "behind", source: "Cargo.toml" },
    { kind: "upstream", from: "ankitects/anki", to: "AnkiQuest/AnkiQuest-Anki", label: "main merged by the sync job", status: "current" },
    { kind: "watched", from: "JSchoreels/fsrs-rs", to: "AnkiQuest/AnkiQuest-Anki", label: "main, ported by hand", pinned: rev, behind: 14, status: "behind", purpose: "the fork FSRS-7 depends on", source: "watched.json" },
  ]);
  assert.deepEqual(fsrs.kinds, ["watched", "cargo"]);
  assert.equal(fsrs.label, "watched + Cargo pin, bd8932b, 14 behind");
  assert.equal(fsrs.behind, 14);
  assert.equal(fsrs.status, "behind");
  assert.deepEqual(
    fsrs.facts.map((fact) => [fact.kind, fact.source, fact.purpose]),
    [
      ["watched", "watched.json", "the fork FSRS-7 depends on"],
      ["cargo", "Cargo.toml", undefined],
    ],
  );
  assert.equal(other.label, "upstream merge: main merged by the sync job");

  // Pins that differ are listed per kind, and the line shows each count.
  const split = edgeOf("a/b", "c/d", [
    { kind: "cargo", label: "crate x", pinned: "1".repeat(40), behind: 3, status: "behind" },
    { kind: "watched", label: "main", pinned: "2".repeat(40), behind: 14, status: "behind" },
  ]);
  assert.equal(split.label, "watched + Cargo pin, watched 2222222, 14 behind; Cargo pin 1111111, 3 behind");
  assert.equal(split.behind, undefined);
  assert.equal(mark(split), "! 14, 3");
  assert.equal(mark(fsrs), "! 14");

  // Several facts of one kind are counted; a pin only some facts have shows once.
  assert.equal(summary([{ kind: "workflow", label: "a@master", pinned: "master", status: "current" }, { kind: "workflow", label: "b@master", pinned: "master", status: "current" }]), "reusable workflow (2), master");
  assert.equal(summary([{ kind: "data", label: "fixtures", pinned: "e".repeat(40), behind: 2, status: "behind" }, { kind: "runtime", label: "HTTPS API", status: "none" }]), "Server data + runtime, eeeeeee, 2 behind");
});

test("visibleEdges shows a merged edge when any of its kinds is shown, and filters by status and search text", () => {
  assert.equal(visibleEdges(MAP, { kinds: new Set(["flake", "workflow", "art"]), outdated: false, search: "" }).length, 2);
  assert.equal(visibleEdges(MAP, { kinds: new Set(["workflow"]), outdated: false, search: "" }).length, 1, "the Dev edge shows for its workflow alone");
  assert.equal(visibleEdges(MAP, { kinds: new Set(["art"]), outdated: false, search: "" }).length, 1);
  assert.deepEqual(
    visibleEdges(MAP, { kinds: new Set(["flake", "workflow", "art"]), outdated: true, search: "" }).map((edge) => edge.kinds),
    [["flake", "workflow"]],
  );
  assert.equal(visibleEdges(MAP, { kinds: new Set(["flake", "workflow", "art"]), outdated: false, search: "art" }).length, 1);
  assert.equal(visibleEdges(MAP, { kinds: new Set(["flake", "workflow", "art"]), outdated: false, search: "labels.yml" }).length, 1, "fact labels are searched");
  assert.ok(matches(MAP.nodes[1], "server"));
  assert.ok(!matches(MAP.nodes[1], "android"));
});

test("lines draws one line per edge in its first shown kind, with its worst status", () => {
  const all = new Set(["flake", "workflow", "submodule"] as const);
  assert.deepEqual(
    lines(MAP.edges, new Set(all)).map((line) => [line.kind, line.status, line.mark]),
    [
      ["flake", "behind", "! 4"],
      ["art", "planned", "~"],
    ],
  );
  assert.equal(lines(MAP.edges, new Set(["workflow"]))[0].kind, "workflow");
  const uncounted = edgeOf("a/b", "c/d", [{ kind: "agents", label: "AGENTS.md", pinned: "differs", status: "behind" }]);
  assert.equal(mark(uncounted), "!");
});

test("wrap breaks after slashes and hyphens; boxSize grows with lines", () => {
  assert.deepEqual(wrap("ankitects/briefcase-windows-VisualStudio-template"), ["ankitects/briefcase-windows-", "VisualStudio-template"]);
  assert.deepEqual(wrap("AnkiQuest-Server"), ["AnkiQuest-Server"]);
  const [width, height] = boxSize(["AnkiQuest-Server", "AGENTS.md !"]);
  const [oneWidth, oneLine] = boxSize(["AnkiQuest-Server"]);
  assert.equal(width, oneWidth);
  assert.ok(height > oneLine);
});

test("the fan-out kinds start off; badges name what they would draw", () => {
  for (const kind of ["flake", "workflow", "agents", "checkout", "vendored"] as const) {
    assert.ok(!DEFAULT_KINDS.has(kind), kind);
  }
  const shown = new Set(DEFAULT_KINDS);
  assert.deepEqual(badge(MAP, "AnkiQuest/AnkiQuest-Server", shown), ["Dev: flake !, workflow"]);
  assert.deepEqual(badge(MAP, "AnkiQuest/AnkiQuest-Server", new Set([...shown, "flake", "workflow"])), []);

  // A kind that fans out shows on its source, with the targets out of date.
  const fan: Wiring = {
    ...MAP,
    nodes: [...MAP.nodes, { id: "AnkiQuest/AnkiQuest-Agents", kind: "repo", label: "AnkiQuest-Agents", readable: true }],
    edges: merge([
      { kind: "agents", from: "AnkiQuest/AnkiQuest-Agents", to: "AnkiQuest/AnkiQuest-Server", label: "AGENTS.md", status: "behind" },
      { kind: "agents", from: "AnkiQuest/AnkiQuest-Agents", to: "AnkiQuest/AnkiQuest-Dev", label: "AGENTS.md", status: "current" },
      { kind: "agents", from: "AnkiQuest/AnkiQuest-Agents", to: "AnkiQuest/AnkiQuest-Agents", label: "AGENTS.md", status: "behind" },
    ]),
  };
  assert.deepEqual(badge(fan, "AnkiQuest/AnkiQuest-Agents", shown), ["AGENTS.md → 2 (1 !)"]);
  assert.deepEqual(badge(fan, "AnkiQuest/AnkiQuest-Server", shown), ["AGENTS.md !"]);
  assert.deepEqual(badge(fan, "AnkiQuest/AnkiQuest-Dev", shown), ["AGENTS.md"]);
});

/** Whether two placed nodes are closer than a row on the same column. */
function clash(a: Place, b: Place): boolean {
  return Math.abs(a.x - b.x) < 100 && Math.abs(a.row - b.row) < 0.7;
}

/** Every pair of places that clash, by id. */
function clashes(at: Map<string, Place>): string[] {
  const entries = [...at.entries()];
  return entries.flatMap(([id, place], index) => entries.slice(index + 1).filter(([, other]) => clash(place, other)).map(([other]) => `${id} / ${other}`));
}

test("places puts every node of the committed map in its lane, without overlaps, on desktop and phone", () => {
  const map = JSON.parse(readFileSync(new URL("../wiring.json", import.meta.url), "utf8")) as Wiring;
  const desktop = places(map);
  assert.equal(desktop.size, map.nodes.length);
  assert.deepEqual(clashes(desktop), []);
  const phone = stacked(desktop);
  assert.equal(phone.size, map.nodes.length);
  assert.deepEqual(clashes(phone), []);
  for (const [id, place] of desktop) {
    assert.equal(phone.get(id)!.lane, place.lane, id);
  }
});

test("places gives nodes missing from LAYOUT a fixed place at the bottom of their lane", () => {
  const map: Wiring = {
    generated: "2026-11-21T00:00:00Z",
    notes: [],
    nodes: [
      { id: "AnkiQuest/AnkiQuest-Anki", kind: "fork", label: "AnkiQuest-Anki", readable: true },
      { id: "AnkiQuest/AnkiQuest-New", kind: "repo", label: "AnkiQuest-New", readable: true },
      { id: "AnkiQuest/AnkiQuest-Newer", kind: "repo", label: "AnkiQuest-Newer", readable: true },
      { id: "AnkiQuest/AnkiQuest-Dev", kind: "repo", label: "AnkiQuest-Dev", readable: true },
      { id: "someone/upstream", kind: "external", label: "someone/upstream", readable: true },
      { id: "maven:org.example", kind: "package", label: "org.example", readable: true },
    ],
    edges: merge([{ kind: "publishes", from: "AnkiQuest/AnkiQuest-Anki", to: "maven:org.example", label: "publishes", status: "none" }]),
  };
  const at = places(map);
  assert.deepEqual(at.get("AnkiQuest/AnkiQuest-Anki"), LAYOUT["AnkiQuest/AnkiQuest-Anki"]);
  assert.equal(fallbackLane(map, map.nodes[4]), "upstream");
  assert.equal(fallbackLane(map, map.nodes[5]), "core");
  assert.equal(at.get("maven:org.example")!.lane, "core");
  assert.ok(at.get("maven:org.example")!.row > LAYOUT["AnkiQuest/AnkiQuest-Anki"].row);

  // New repositories join the infrastructure band in order of id, each to the right of the last.
  const [first, second] = [at.get("AnkiQuest/AnkiQuest-New")!, at.get("AnkiQuest/AnkiQuest-Newer")!];
  assert.equal(first.lane, "infra");
  assert.ok(first.x > LAYOUT["AnkiQuest/AnkiQuest-Dev"].x && second.x > first.x);
  assert.deepEqual(places(map), at);
  assert.deepEqual(clashes(at), []);
});

test("stacked keeps upstreams level with what they feed and stacks the other lanes on the right", () => {
  const desktop = new Map<string, Place>([
    ["up", { lane: "upstream", x: 0, row: 3 }],
    ["anki", { lane: "core", x: 420, row: 4 }],
    ["server", { lane: "server", x: 1150, row: 2 }],
    ["android", { lane: "clients", x: 760, row: 12 }],
    ["dev", { lane: "infra", x: 0, row: 18 }],
  ]);
  const phone = stacked(desktop);
  assert.deepEqual(phone.get("up"), { lane: "upstream", x: 0, row: 3 });
  const right = ["anki", "server", "android"].map((id) => phone.get(id)!);
  assert.ok(right.every((place) => place.x === right[0].x && place.x > 0));
  assert.ok(right[0].row < right[1].row && right[1].row < right[2].row);
  assert.ok(phone.get("dev")!.row > Math.max(...[...phone.values()].filter((place) => place.lane !== "infra").map((place) => place.row)));
});

test("direction and bow route lines around nodes", () => {
  const left: Place = { lane: "upstream", x: 0, row: 3 };
  const right: Place = { lane: "core", x: 420, row: 3.5 };
  assert.equal(direction(left, right), "rightward");
  assert.equal(direction(right, left), "leftward");
  assert.equal(direction(left, { ...right, row: 3 + (420 / ROW) * 2 }), "");

  // A line down a column bows only when a node is in the way.
  const top: Place = { lane: "clients", x: 235, row: 0 };
  const middle: Place = { lane: "clients", x: 235, row: 1.3 };
  const bottom: Place = { lane: "clients", x: 235, row: 2.6 };
  assert.equal(bow(top, middle, [top, middle, bottom]), 0);
  assert.ok(bow(top, bottom, [top, middle, bottom]) < 0);
  assert.equal(bow(bottom, top, [top, middle, bottom]), -bow(top, bottom, [top, middle, bottom]));
  assert.equal(bow(top, { ...bottom, x: 800 }, [top, middle, bottom]), 0);
});

test("the committed wiring.json has edges between known nodes", () => {
  const map = JSON.parse(readFileSync(new URL("../wiring.json", import.meta.url), "utf8")) as Wiring;
  const ids = new Set(map.nodes.map((node) => node.id));
  assert.ok(map.edges.length > 0);
  const pairs = new Set<string>();
  for (const edge of map.edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to), `${edge.from} -> ${edge.to}`);
    assert.ok(!pairs.has(`${edge.from} ${edge.to}`), `one edge per pair: ${edge.from} -> ${edge.to}`);
    pairs.add(`${edge.from} ${edge.to}`);
    assert.deepEqual(edge, edgeOf(edge.from, edge.to, edge.facts), "kinds, label and status follow the facts");
  }

  // Watched sources say what they are watched for.
  for (const fact of map.edges.flatMap((edge) => edge.facts).filter((candidate) => candidate.kind === "watched")) {
    assert.ok(fact.purpose, fact.label);
  }
});

test("vendorSource names the repository a copied provider contract links", () => {
  const ours = " * https://github.com/AnkiQuest/AnkiQuest-Android/blob/master/api/src/main/java/com/ichi2/anki/FlashCardsContract.kt";
  const theirs = " * https://github.com/ankidroid/Anki-Android/blob/main/api/src/main/java/com/ichi2/anki/FlashCardsContract.kt";
  assert.equal(vendorSource(ours), "AnkiQuest/AnkiQuest-Android");
  assert.equal(vendorSource(theirs), "ankidroid/Anki-Android");
  assert.equal(vendorSource("object FlashCardsContract"), "ankidroid/Anki-Android");
});
