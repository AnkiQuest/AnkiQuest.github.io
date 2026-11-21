// Checks the wiring map's parsers against small copies of the files they
// read, and the page's helpers against a small map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { pinStatus, short } from "./wiring.ts";
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
import { boxSize, matches, pairs, statusText, visibleEdges } from "../site/wiring.ts";

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

/** A small map for the page's helpers. */
const MAP: Wiring = {
  generated: "2026-11-21T00:00:00Z",
  notes: [],
  nodes: [
    { id: "AnkiQuest/AnkiQuest-Dev", kind: "repo", label: "AnkiQuest-Dev", readable: true },
    { id: "AnkiQuest/AnkiQuest-Server", kind: "repo", label: "AnkiQuest-Server", readable: true },
    { id: "AnkiQuest/AnkiQuest-Art", kind: "repo", label: "AnkiQuest-Art", readable: true, planned: true },
  ],
  edges: [
    { kind: "flake", from: "AnkiQuest/AnkiQuest-Dev", to: "AnkiQuest/AnkiQuest-Server", label: "ankiquest-dev", behind: 4, status: "behind" },
    { kind: "workflow", from: "AnkiQuest/AnkiQuest-Dev", to: "AnkiQuest/AnkiQuest-Server", label: "labels.yml@master", status: "current" },
    { kind: "submodule", from: "AnkiQuest/AnkiQuest-Art", to: "AnkiQuest/AnkiQuest-Server", label: "art (planned)", status: "planned" },
  ],
};

test("statusText names the status in words, with the count", () => {
  assert.equal(statusText(MAP.edges[0]), "out of date: 4 commits behind");
  assert.equal(statusText(MAP.edges[1]), "up to date");
  assert.equal(statusText(MAP.edges[2]), "planned");
  assert.equal(statusText({ ...MAP.edges[0], behind: undefined }), "out of date");
});

test("visibleEdges filters by kind, status and search text", () => {
  assert.equal(visibleEdges(MAP, { kinds: new Set(["flake", "workflow", "submodule"]), outdated: false, search: "" }).length, 3);
  assert.equal(visibleEdges(MAP, { kinds: new Set(["workflow"]), outdated: false, search: "" }).length, 1);
  assert.deepEqual(
    visibleEdges(MAP, { kinds: new Set(["flake", "workflow"]), outdated: true, search: "" }).map((edge) => edge.kind),
    ["flake"],
  );
  assert.equal(visibleEdges(MAP, { kinds: new Set(["flake", "workflow", "submodule"]), outdated: false, search: "art" }).length, 1);
  assert.ok(matches(MAP.nodes[1], "server"));
  assert.ok(!matches(MAP.nodes[1], "android"));
});

test("pairs draws one line per pair of nodes, with its worst status", () => {
  const lines = pairs(MAP.edges);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].edges.length, 2);
  assert.equal(lines[0].status, "behind");
  assert.equal(lines[0].mark, "! 4");
  assert.equal(lines[1].status, "planned");
});

test("boxSize grows with lines and caps the width", () => {
  const [width, height] = boxSize("AnkiQuest-Server\n[! out of date]");
  const [, oneLine] = boxSize("AnkiQuest-Server");
  assert.ok(width <= 148 && height > oneLine);
});

test("the committed wiring.json has edges between known nodes", () => {
  const map = JSON.parse(readFileSync(new URL("../wiring.json", import.meta.url), "utf8")) as Wiring;
  const ids = new Set(map.nodes.map((node) => node.id));
  assert.ok(map.edges.length > 0);
  for (const edge of map.edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to), `${edge.from} -> ${edge.to}`);
  }
});
