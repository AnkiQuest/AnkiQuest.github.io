// Writes the wiring map as Mermaid, for agents and for a static picture on
// the wiring page:
//   node src/wiring-mermaid.ts [dir]
// reads <dir>/wiring.json (written by src/wiring.ts; default: the
// repository root) and writes wiring.mmd, then renders it with mermaid-cli
// to wiring.svg and wiring-dark.svg (light and dark theme). Each SVG starts
// with a comment holding the SHA-256 of the wiring.mmd it was rendered from,
// so the tests can tell a stale picture without rendering it again.
//
// The diagram uses the page's lanes (site/wiring.ts) as subgraphs and draws
// the kinds the page draws by default; the fan-out kinds (flake inputs,
// reusable workflows, CI checkouts, vendored code, AGENTS.md) are listed at
// the end as comments. Private repositories are already redacted in
// wiring.json and appear the same way here. Upstream and watched edges are
// routed through the AnkiQuest-Sync node, which opens the pull requests that
// carry them, and the upstream lane groups its sources by owner.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { abbrev, state } from "./wiring-edges.ts";
import { EDGE_KINDS, type Wiring, type WiringEdge, type WiringNode } from "./wiring-model.ts";
import { DEFAULT_KINDS, LANES, groupsOf, places, type Lane } from "../site/wiring.ts";

/** Where the page lives, named in the header. */
export const PAGE = "https://ankiquest.github.io/wiring.html";

/** The organisation whose prefix node ids drop. */
const ORG = "AnkiQuest/";

/** Out of date: orange, readable on the light and the dark theme. */
const BEHIND_COLOUR = "#ea580c";

/** Words Mermaid's flowchart grammar reserves; an id equal to one gets a trailing underscore. */
const RESERVED = new Set(["end", "graph", "flowchart", "subgraph", "style", "class", "classDef", "click", "linkStyle", "direction", "default", "call", "href"]);

/** The SVG comment that names the wiring.mmd an SVG was rendered from. */
const STAMP = /^<!-- wiring\.mmd sha256:([0-9a-f]{64}) -->\n/;

/** Escapes text for a quoted Mermaid label: entity codes for the characters the grammar or HTML would read. */
export function escape(text: string): string {
  return text
    .replaceAll("#", "#35;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll("`", "#96;")
    .replace(/\s+/g, " ");
}

/**
 * Readable, stable Mermaid ids for every node: the id without the
 * organisation prefix, anything but letters and digits as underscores
 * (AnkiQuest/AnkiQuest-Anki is AnkiQuest_Anki). Assigned in order of id, so
 * a clash gets the same suffix on every run.
 */
export function mermaidIds(nodes: WiringNode[]): Map<string, string> {
  const result = new Map<string, string>();
  const taken = new Set<string>();
  for (const id of nodes.map((node) => node.id).sort()) {
    let base = (id.startsWith(ORG) ? id.slice(ORG.length) : id).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (/^[0-9]/.test(base) || base === "") {
      base = `n_${base}`;
    }
    if (RESERVED.has(base)) {
      base = `${base}_`;
    }
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) {
      candidate = `${base}_${n}`;
    }
    taken.add(candidate);
    result.set(id, candidate);
  }
  return result;
}

/**
 * A node's shape and label: box for a repository, double box for a fork,
 * stadium upstream, hexagon package, rounded box module, flag release.
 */
function nodeLine(node: WiringNode, id: string): string {
  const marks = [node.private ? "private" : undefined, node.planned ? "planned" : undefined].filter(Boolean);
  const name = node.kind === "package" ? `${node.label} (Maven)` : node.label;
  const label = `"${escape(marks.length ? `${name} (${marks.join(", ")})` : name)}"`;
  switch (node.kind) {
    case "repo":
      return `${id}[${label}]`;
    case "fork":
      return `${id}[[${label}]]`;
    case "external":
      return `${id}([${label}])`;
    case "package":
      return `${id}{{${label}}}`;
    case "module":
      return `${id}(${label})`;
    case "release":
      return `${id}>${label}]`;
  }
}

/** Edges in a fixed order: by first kind as the page lists them, then ends. */
function sorted(edges: WiringEdge[]): WiringEdge[] {
  const rank = (edge: WiringEdge): number => EDGE_KINDS.indexOf(edge.kinds[0]);
  return [...edges].sort((a, b) => rank(a) - rank(b) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** Whether the diagram draws an edge: when any of its kinds is one the page draws by default. */
function drawnEdge(edge: WiringEdge): boolean {
  return edge.kinds.some((kind) => DEFAULT_KINDS.has(kind));
}

/** The comment table of the kinds the diagram leaves out. */
function factTable(edges: WiringEdge[]): string[] {
  if (edges.length === 0) {
    return [];
  }
  const rows = sorted(edges).flatMap((edge) =>
    edge.facts.map((fact) => `%%   ${fact.kind} | ${edge.from} -> ${edge.to} | ${fact.label} | ${[fact.pinned ? abbrev(fact.pinned) : "", state(fact)].filter(Boolean).join(", ") || "-"}`),
  );
  return ["", "%% Not drawn, as on the page: edges only of kinds that fan out from one repository to most others.", "%%   kind | from -> to | what | pin (status)", ...rows];
}

/** The map as a Mermaid flowchart, the same text for the same wiring.json. */
export function mermaid(map: Wiring): string {
  const ids = mermaidIds(map.nodes);
  const where = places(map);
  const drawn = sorted(map.edges.filter(drawnEdge));
  const listed = map.edges.filter((edge) => !drawnEdge(edge));
  const day = map.generated.slice(0, 10);

  // Header: what this is, where it comes from and how to read it.
  const out = [
    "%% AnkiQuest wiring: how every AnkiQuest repository, upstream and package feeds the others.",
    "%% Generated from wiring.json (written by src/wiring.ts) by src/wiring-mermaid.ts in",
    "%% AnkiQuest/AnkiQuest.github.io; regenerated daily. Do not edit.",
    `%% Data of ${day} (wiring.json generated ${map.generated}).`,
    `%% Interactive page: ${PAGE}`,
    "%% Arrows point the way code or data flows; one edge per pair of nodes, naming every kind of",
    "%% link between them (\"watched + Cargo pin\"), then the pinned commit or version and N behind,",
    "%% out of date or unknown. Out-of-date edges are thick orange, planned ones dotted. Private",
    "%% repositories show only their links. Edges of fan-out kinds alone are listed at the end.",
    "flowchart LR",
  ];

  // One subgraph per lane, nodes top to bottom as on the page. The upstream
  // lane groups its sources by owner in nested subgraphs.
  const lanes = Object.keys(LANES) as Lane[];
  for (const lane of lanes) {
    const members = map.nodes
      .filter((node) => where.get(node.id)?.lane === lane)
      .sort((a, b) => {
        const pa = where.get(a.id)!;
        const pb = where.get(b.id)!;
        return pa.row - pb.row || pa.x - pb.x || a.id.localeCompare(b.id);
      });
    if (members.length === 0) {
      continue;
    }
    out.push(`  subgraph lane_${lane}["${escape(LANES[lane])}"]`);
    if (lane === "upstream") {
      const owners = new Map<string, WiringNode[]>();
      const rest: WiringNode[] = [];
      for (const node of members) {
        if (node.kind === "external" && node.id.includes("/")) {
          const owner = node.id.split("/")[0];
          owners.set(owner, [...(owners.get(owner) ?? []), node]);
        } else {
          rest.push(node);
        }
      }
      const sorted = [...owners.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      if (members.some((node) => node.kind === "external" && !node.id.includes("/"))) {
        sorted.push(["other", members.filter((node) => node.kind === "external" && !node.id.includes("/"))]);
      }
      for (const [owner, group] of sorted) {
        out.push(`    subgraph src_${owner.replaceAll(/[^a-zA-Z0-9]/g, "_")}["${escape(owner)}"]`);
        for (const node of group) {
          out.push(`      ${nodeLine(node, ids.get(node.id)!)}`);
        }
        out.push("    end");
      }
      for (const node of rest) {
        out.push(`    ${nodeLine(node, ids.get(node.id)!)}`);
      }
    } else {
      // A repository with modules gets a nested subgraph with them, where it stands.
      const here = new Set(members.map((node) => node.id));
      const owners = new Set(groupsOf(map).filter((owner) => here.has(owner)));
      const inGroup = (node: WiringNode): boolean => owners.has(node.id) || (node.partOf !== undefined && owners.has(node.partOf));
      for (const node of members) {
        if (owners.has(node.id)) {
          out.push(`    subgraph group_${ids.get(node.id)}["${escape(node.label)}"]`);
          for (const member of members.filter((other) => other.id === node.id || other.partOf === node.id)) {
            out.push(`      ${nodeLine(member, ids.get(member.id)!)}`);
          }
          out.push("    end");
        } else if (!inGroup(node)) {
          out.push(`    ${nodeLine(node, ids.get(node.id)!)}`);
        }
      }
    }
    out.push("  end");
  }

  // The edges, then the styles that refer to them by position. Upstream and
  // watched edges go through the sync node: the sync job opens the pull
  // request, the fork merges it.
  const syncId = ids.get("AnkiQuest/AnkiQuest-Sync");
  out.push("");
  const lines: { text: string; behind: boolean }[] = [];
  for (const edge of drawn) {
    const arrow = edge.status === "planned" ? "-.->" : "-->";
    const routed = edge.kinds.includes("upstream") || edge.kinds.includes("watched");
    if (syncId && routed) {
      lines.push({ text: `  ${ids.get(edge.from)} -->|"sync job"| ${syncId}`, behind: false });
      lines.push({ text: `  ${syncId} ${arrow}|"${escape(edge.label)}"| ${ids.get(edge.to)}`, behind: edge.status === "behind" });
    } else {
      lines.push({ text: `  ${ids.get(edge.from)} ${arrow}|"${escape(edge.label)}"| ${ids.get(edge.to)}`, behind: edge.status === "behind" });
    }
  }
  out.push(...lines.map((line) => line.text));
  const behind = lines.flatMap((line, index) => (line.behind ? [index] : []));
  if (behind.length > 0) {
    out.push(`  linkStyle ${behind.join(",")} stroke:${BEHIND_COLOUR},stroke-width:3px`);
  }

  // Node classes: out of date (an out-of-date drawn edge into it), planned, private.
  const classes: [string, string, (node: WiringNode) => boolean][] = [
    ["behind", `stroke:${BEHIND_COLOUR},stroke-width:3px`, (node) => drawn.some((edge) => edge.to === node.id && edge.status === "behind")],
    ["planned", "stroke-dasharray:6 4", (node) => node.planned === true],
    ["private", "stroke-dasharray:2 3", (node) => node.private === true],
  ];
  for (const [name, style, test] of classes) {
    const members = map.nodes.filter(test).map((node) => ids.get(node.id)!).sort();
    if (members.length > 0) {
      out.push(`  classDef ${name} ${style}`);
      out.push(`  class ${members.join(",")} ${name}`);
    }
  }

  out.push(...factTable(listed));
  return `${out.join("\n")}\n`;
}

/** The SHA-256 of a wiring.mmd, as stamped on its SVGs. */
export function digest(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/** The wiring.mmd digest an SVG was rendered from, or undefined when unstamped. */
export function stampOf(svg: string): string | undefined {
  return STAMP.exec(svg)?.[1];
}

/**
 * Shrinks mermaid-cli's SVG: path coordinates rounded to a tenth of a pixel
 * (it writes 16 digits) and the base64 copies of each edge's points, which
 * only Mermaid's own scripts read, dropped. Cuts the file by about nine tenths.
 */
export function compact(svg: string): string {
  return svg
    .replace(/ data-points="[^"]*"/g, "")
    .replace(/ d="([^"]*)"/g, (_, path: string) => ` d="${path.replace(/-?\d+\.\d+(e-?\d+)?/g, (n) => String(Math.round(Number(n) * 10) / 10))}"`);
}

/** The two renderings: file name and mermaid-cli theme. */
export const RENDERINGS: [string, string][] = [
  ["wiring.svg", "default"],
  ["wiring-dark.svg", "dark"],
];

/**
 * Renders Mermaid source to SVG with mermaid-cli (node_modules/.bin/mmdc,
 * which drives a headless Chromium through Puppeteer). Text is drawn as
 * SVG text, not HTML, so the picture also works in an <img>. Throws when
 * the source does not parse.
 */
export function render(source: string, theme: string): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const work = mkdtempSync(join(tmpdir(), "wiring-mermaid-"));
  try {
    const input = join(work, "wiring.mmd");
    const output = join(work, "wiring.svg");
    const config = join(work, "config.json");
    // CI runners forbid Chromium's sandbox (no unprivileged user namespaces); the input is our own.
    const puppeteer = join(work, "puppeteer.json");
    writeFileSync(input, source);
    writeFileSync(config, JSON.stringify({ htmlLabels: false, flowchart: { htmlLabels: false, wrappingWidth: 420 } }));
    writeFileSync(puppeteer, JSON.stringify({ args: ["--no-sandbox"] }));
    execFileSync(join(root, "node_modules", ".bin", "mmdc"), ["-q", "-i", input, "-o", output, "-t", theme, "-b", "transparent", "-c", config, "-p", puppeteer], { stdio: ["ignore", "ignore", "pipe"] });
    return `<!-- wiring.mmd sha256:${digest(source)} -->\n${compact(readFileSync(output, "utf8"))}`;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Run when called as a script, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const map = JSON.parse(readFileSync(join(dir, "wiring.json"), "utf8")) as Wiring;
  const source = mermaid(map);
  writeFileSync(join(dir, "wiring.mmd"), source);
  for (const [file, theme] of RENDERINGS) {
    writeFileSync(join(dir, file), render(source, theme));
  }
  console.log(`wiring.mmd and ${RENDERINGS.map(([file]) => file).join(", ")} into ${dir}`);
}
