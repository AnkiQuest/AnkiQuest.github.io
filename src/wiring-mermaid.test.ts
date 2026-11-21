// Checks the Mermaid form of the wiring map: ids, lanes, labels, redaction,
// that the committed wiring.mmd and SVGs match the committed wiring.json,
// and that mermaid-cli parses the source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wiringPage } from "./build.ts";
import { merge } from "./wiring-edges.ts";
import { RENDERINGS, compact, digest, escape, mermaid, mermaidIds, render, stampOf } from "./wiring-mermaid.ts";
import type { Wiring } from "./wiring-model.ts";
import { redact } from "./wiring.ts";

/** A file at the repository root. */
function root(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

/** A small map: an upstream, a fork, a planned repository, a private one and a fan-out edge. */
const MAP: Wiring = redact(
  {
    generated: "2026-11-21T04:41:00.000Z",
    notes: [],
    nodes: [
      { id: "ankitects/anki", kind: "external", label: "ankitects/anki", readable: true },
      { id: "AnkiQuest/AnkiQuest-Anki", kind: "fork", label: "AnkiQuest-Anki", readable: true },
      { id: "AnkiQuest/AnkiQuest-Android-Backend", kind: "fork", label: "AnkiQuest-Android-Backend", readable: true },
      { id: "AnkiQuest/AnkiQuest-Art", kind: "repo", label: "AnkiQuest-Art", readable: true, planned: true },
      { id: "AnkiQuest/AnkiQuest-Server", kind: "repo", label: "AnkiQuest-Server", readable: true },
      { id: "AnkiQuest/AnkiQuest-Dev", kind: "repo", label: "AnkiQuest-Dev", readable: true },
      { id: "AnkiQuest/AnkiQuest-Hosting", kind: "repo", label: "AnkiQuest-Hosting", readable: true, head: "f".repeat(40) },
      { id: "maven:org.ankiquest", kind: "package", label: "org.ankiquest", readable: true },
    ],
    edges: merge([
      { kind: "upstream", from: "ankitects/anki", to: "AnkiQuest/AnkiQuest-Anki", label: "main merged by the sync job", pinned: "1".repeat(40), behind: 0, status: "current" },
      { kind: "submodule", from: "AnkiQuest/AnkiQuest-Anki", to: "AnkiQuest/AnkiQuest-Android-Backend", label: "anki", pinned: "acf9fe3".padEnd(40, "0"), behind: 20, status: "behind" },
      { kind: "cargo", from: "AnkiQuest/AnkiQuest-Anki", to: "AnkiQuest/AnkiQuest-Android-Backend", label: "crates anki", pinned: "acf9fe3".padEnd(40, "0"), behind: 20, status: "behind" },
      { kind: "publishes", from: "AnkiQuest/AnkiQuest-Android-Backend", to: "maven:org.ankiquest", label: 'a "quoted" <b>#1</b>', pinned: "0.1.0", status: "current" },
      { kind: "submodule", from: "AnkiQuest/AnkiQuest-Art", to: "AnkiQuest/AnkiQuest-Server", label: "art (planned)", status: "planned" },
      { kind: "flake", from: "AnkiQuest/AnkiQuest-Dev", to: "AnkiQuest/AnkiQuest-Server", label: "ankiquest-dev", pinned: "2".repeat(40), behind: 3, status: "behind" },
      { kind: "workflow", from: "AnkiQuest/AnkiQuest-Dev", to: "AnkiQuest/AnkiQuest-Hosting", label: "hosting.yml@master", pinned: "9".repeat(40), status: "current", source: "https://github.com/AnkiQuest/AnkiQuest-Hosting/blob/HEAD/secret.yml" },
    ]),
  },
  new Set(["AnkiQuest/AnkiQuest-Hosting"]),
);

test("mermaidIds are readable, stable and unique", () => {
  const ids = mermaidIds([
    { id: "AnkiQuest/AnkiQuest-Anki", kind: "fork", label: "", readable: true },
    { id: "AnkiQuest/AnkiQuest.github.io", kind: "repo", label: "", readable: true },
    { id: "maven:org.ankiquest", kind: "package", label: "", readable: true },
    { id: "someone/end", kind: "external", label: "", readable: true },
    { id: "someone-end", kind: "external", label: "", readable: true },
    { id: "AnkiQuest/end", kind: "repo", label: "", readable: true },
    { id: "3d/x", kind: "external", label: "", readable: true },
  ]);
  assert.equal(ids.get("AnkiQuest/AnkiQuest-Anki"), "AnkiQuest_Anki");
  assert.equal(ids.get("AnkiQuest/AnkiQuest.github.io"), "AnkiQuest_github_io");
  assert.equal(ids.get("maven:org.ankiquest"), "maven_org_ankiquest");
  assert.equal(ids.get("AnkiQuest/end"), "end_", "a reserved word gets an underscore");
  assert.equal(ids.get("someone-end"), "someone_end");
  assert.equal(ids.get("someone/end"), "someone_end_2", "a clash gets a suffix, in order of id");
  assert.equal(ids.get("3d/x"), "n_3d_x");
});

test("escape turns the characters the grammar reads into entity codes", () => {
  assert.equal(escape('a "b" <c> #1 `d`\nline'), "a #quot;b#quot; #lt;c#gt; #35;1 #96;d#96; line");
});

test("mermaid draws lanes, merged edges, out-of-date and planned edges, and lists the fan-out kinds", () => {
  const text = mermaid(MAP);
  assert.equal(mermaid(MAP), text, "the same map gives the same text");
  assert.match(text, /^%% AnkiQuest wiring/);
  assert.match(text, /%% Data of 2026-11-21 /);
  assert.match(text, /https:\/\/ankiquest\.github\.io\/wiring\.html/);
  assert.match(text, /\nflowchart LR\n/);

  // Lanes as subgraphs, in the page's order, with each node's shape.
  const lanes = [...text.matchAll(/subgraph (lane_\w+)/g)].map((match) => match[1]);
  assert.deepEqual(lanes, ["lane_upstream", "lane_core", "lane_server", "lane_infra"]);
  assert.match(text, /subgraph lane_upstream\["Upstreams and watched sources"\]\n {4}ankitects_anki\(\["ankitects\/anki"\]\)\n {2}end/);
  assert.match(text, /AnkiQuest_Anki\[\["AnkiQuest-Anki"\]\]/);
  assert.match(text, /maven_org_ankiquest\{\{"org\.ankiquest \(Maven\)"\}\}/);
  assert.match(text, /AnkiQuest_Art\["AnkiQuest-Art \(planned\)"\]/);
  assert.match(text, /AnkiQuest_Hosting\["AnkiQuest-Hosting \(private\)"\]/);

  // Edges: merged, labelled with kinds, pin and commits behind; escaped; planned dotted.
  assert.match(text, /AnkiQuest_Anki -->\|"submodule \+ Cargo pin, acf9fe3, 20 behind"\| AnkiQuest_Android_Backend/);
  assert.match(text, /\|"publishes: a #quot;quoted#quot; #lt;b#gt;#35;1#lt;\/b#gt;, 0\.1\.0"\|/);
  assert.match(text, /AnkiQuest_Art -\.->\|"submodule: art \(planned\)"\| AnkiQuest_Server/);
  const drawn = [...text.matchAll(/^ {2}\w+ -\.?->\|"([^"]*)"\|/gm)].map((match) => match[1]);
  const behind = drawn.flatMap((label, index) => (label.includes("behind") ? [index] : []));
  assert.match(text, new RegExp(`linkStyle ${behind.join(",")} stroke:`));
  assert.match(text, /class AnkiQuest_Android_Backend behind/);

  // Fan-out kinds are comments, not edges; the private repository's facts are bare.
  assert.ok(!drawn.some((label) => label.includes("flake")));
  assert.match(text, /%% {3}flake \| AnkiQuest\/AnkiQuest-Dev -> AnkiQuest\/AnkiQuest-Server \| ankiquest-dev \| 2222222, 3 behind/);
  assert.match(text, /%% {3}workflow \| AnkiQuest\/AnkiQuest-Dev -> AnkiQuest\/AnkiQuest-Hosting \| hosting\.yml@master \| -\n/);
  assert.ok(!text.includes("9999999") && !text.includes("fffffff") && !text.includes("secret.yml"), "nothing of the private repository but its links");
});

test("the committed wiring.mmd is what mermaid makes of the committed wiring.json", () => {
  const map = JSON.parse(root("wiring.json")) as Wiring;
  assert.equal(root("wiring.mmd"), mermaid(map), "run: node src/wiring-mermaid.ts");
});

test("the committed SVGs were rendered from the committed wiring.mmd", () => {
  const source = root("wiring.mmd");
  for (const [file] of RENDERINGS) {
    assert.equal(stampOf(root(file)), digest(source), `${file} is stale; run: node src/wiring-mermaid.ts`);
  }
});

test("compact rounds path coordinates and drops the point copies", () => {
  assert.equal(compact('<path d="M1.23456 -7.891e-5 L3 4.95" data-points="W3t9"/>'), '<path d="M1.2 0 L3 5"/>');
});

test("mermaid-cli parses the committed source and rejects a broken one", () => {
  const svg = render(root("wiring.mmd"), "default");
  assert.equal(stampOf(svg), digest(root("wiring.mmd")));
  assert.match(svg, /<svg /);
  assert.throws(() => render("flowchart LR\n  A -->|\"x| \n", "default"));
});

test("the wiring page gets the Mermaid source, escaped", () => {
  const page = wiringPage("<pre><code><!-- wiring.mmd --></code></pre>", 'A -->|"a <b> & $&"| B\n');
  assert.equal(page, "<pre><code>A --&#62;|&#34;a &#60;b&#62; &#38; $&#38;&#34;| B</code></pre>");
  assert.throws(() => wiringPage("<p></p>", "x"));
});
