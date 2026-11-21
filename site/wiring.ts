// The wiring page: draws wiring.json as a graph with Cytoscape.js, with
// filters by edge kind, a search box, details of the selected node or edge
// and a table of every edge shown. build.ts strips the types into wiring.js.
// The helpers above main() are pure, so the tests import this file in Node.
//
// The map has a fixed layout: lanes by role, left to right in the order code
// flows (upstreams, core, clients, server), and shared infrastructure as a
// band along the bottom. Every node's place is in LAYOUT, so the picture is
// the same after each regeneration; a node missing there gets a place in its
// lane by a fixed rule. Fan-out kinds (flake inputs, reusable workflows,
// AGENTS.md) are off by default and shown as badges on the repositories.

import type { EdgeKind, Status, Wiring, WiringEdge, WiringFact, WiringNode } from "../src/wiring-model.ts";

/** Each edge kind's name in the filters, legend and table, in order. */
export const KIND_NAMES: Record<EdgeKind, string> = {
  upstream: "Upstream merges",
  watched: "Watched sources",
  submodule: "Git submodules",
  flake: "Nix flake inputs",
  cargo: "Cargo crates",
  maven: "Maven artifacts",
  publishes: "Publishes",
  vendored: "Vendored code",
  workflow: "Reusable workflows",
  checkout: "CI checkouts",
  data: "Pinned Server data",
  agents: "AGENTS.md",
  runtime: "Runtime links",
};

/**
 * The kinds drawn as lines by default: how code and packages flow. The
 * others fan out from one repository to most of the rest; they start off
 * and show as badges on the repositories instead.
 */
export const DEFAULT_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["upstream", "watched", "submodule", "cargo", "maven", "publishes", "data", "runtime"]);

/** A line style, so kinds differ by more than colour. */
type LineStyle = "solid" | "dashed" | "dotted";

/** Each kind's line style; its colour is the `--kind-<kind>` token in wiring.css. */
export const KIND_LINES: Record<EdgeKind, LineStyle> = {
  upstream: "solid",
  watched: "dashed",
  submodule: "solid",
  flake: "dashed",
  cargo: "solid",
  maven: "solid",
  publishes: "dashed",
  vendored: "dotted",
  workflow: "dotted",
  checkout: "dotted",
  data: "dashed",
  agents: "dashed",
  runtime: "dotted",
};

/** Each kind in a badge, singular and plural. */
const KIND_NOUNS: Record<EdgeKind, [string, string]> = {
  upstream: ["upstream", "upstreams"],
  watched: ["watched", "watched"],
  submodule: ["submodule", "submodules"],
  flake: ["flake", "flakes"],
  cargo: ["crate", "crates"],
  maven: ["artifact", "artifacts"],
  publishes: ["publishes", "publishes"],
  vendored: ["vendored", "vendored"],
  workflow: ["workflow", "workflows"],
  checkout: ["checkout", "checkouts"],
  data: ["pinned data", "pinned data"],
  agents: ["AGENTS.md", "AGENTS.md"],
  runtime: ["runtime link", "runtime links"],
};

/** Each status in words; out of date also gets a mark, so colour is never the only sign. */
const STATUS_NAMES: Record<Status, string> = {
  current: "up to date",
  behind: "out of date",
  unknown: "unknown",
  none: "no version",
  planned: "planned",
};

/** The mark of a status on lines, badges and nodes. */
const STATUS_MARKS: Record<Status, string> = {
  current: "",
  behind: "!",
  unknown: "?",
  none: "",
  planned: "~",
};

/** What the filters let through. */
export interface Filter {
  kinds: Set<EdgeKind>;
  outdated: boolean;
  search: string;
}

/** An edge's or a fact's status in words, with the commit count when there is one. */
export function statusText(edge: Pick<WiringFact, "status" | "behind">): string {
  const name = STATUS_NAMES[edge.status];
  if (edge.status === "behind" && edge.behind !== undefined) {
    return `${name}: ${edge.behind} commit${edge.behind === 1 ? "" : "s"} behind`;
  }
  return name;
}

/** Whether a node's name or purpose contains the search text. */
export function matches(node: WiringNode, search: string): boolean {
  const text = `${node.id} ${node.label} ${node.purpose ?? ""}`.toLowerCase();
  return text.includes(search.trim().toLowerCase());
}

/** Whether any of an edge's kinds is shown. */
export function shownEdge(edge: WiringEdge, kinds: Set<EdgeKind>): boolean {
  return edge.kinds.some((kind) => kinds.has(kind));
}

/**
 * The edges the filters let through: those with any shown kind; a search
 * keeps edges touching a matching node or with a matching label.
 */
export function visibleEdges(map: Wiring, filter: Filter): WiringEdge[] {
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const search = filter.search.trim().toLowerCase();
  return map.edges.filter((edge) => {
    if (!shownEdge(edge, filter.kinds)) {
      return false;
    }
    if (filter.outdated && edge.status !== "behind") {
      return false;
    }
    if (!search) {
      return true;
    }
    const ends = [byId.get(edge.from), byId.get(edge.to)].filter((node): node is WiringNode => node !== undefined);
    return ends.some((node) => matches(node, search)) || [edge.label, ...edge.facts.map((fact) => fact.label)].some((label) => label.toLowerCase().includes(search));
  });
}

// --- Layout ----------------------------------------------------------------------------

/** The map's lanes, by role. */
export type Lane = "upstream" | "core" | "clients" | "forks" | "server" | "infra";

/** Each lane's heading, in the order lanes stack on a phone. */
export const LANES: Record<Lane, string> = {
  upstream: "Upstreams and watched sources",
  core: "Core",
  clients: "Clients",
  forks: "Third-party app forks",
  server: "Server and web",
  infra: "Shared infrastructure",
};

/** A node's place: its lane, the x of its centre in pixels and its row. */
export interface Place {
  lane: Lane;
  x: number;
  row: number;
}

/** Height of a row, in pixels. */
export const ROW = 60;

/** Columns of the desktop map, in pixels: x of the node centres. */
const X = {
  upstream: 0,
  core: 420,
  coreSide: 570,
  clients: 760,
  clientsSide: 950,
  server: 1150,
  serverSide: 1320,
};

/** Row of the shared infrastructure band. */
const INFRA_ROW = 18.4;

/**
 * Every node's place on the desktop map, chosen by hand so lines cross as
 * little as possible: upstreams in one column, grouped by the repository
 * they feed and level with it; packages next to the repository that
 * publishes them.
 */
export const LAYOUT: Record<string, Place> = {
  // Upstreams of AnkiQuest-Anki: submodules, the upstream merge, crates, then watched sources.
  "ankitects/anki-core-i18n": { lane: "upstream", x: X.upstream, row: 0 },
  "ankitects/anki-desktop-ftl": { lane: "upstream", x: X.upstream, row: 0.75 },
  "ankitects/briefcase-macOS-app-template": { lane: "upstream", x: X.upstream, row: 1.6 },
  "ankitects/briefcase-windows-VisualStudio-template": { lane: "upstream", x: X.upstream, row: 2.6 },
  "ankitects/anki": { lane: "upstream", x: X.upstream, row: 3.5 },
  "ankitects/rust-url": { lane: "upstream", x: X.upstream, row: 4.25 },
  "ankitects/linkcheck": { lane: "upstream", x: X.upstream, row: 5 },
  "JSchoreels/fsrs-rs": { lane: "upstream", x: X.upstream, row: 5.75 },
  "JSchoreels/anki": { lane: "upstream", x: X.upstream, row: 6.5 },
  "open-spaced-repetition/fsrs-rs": { lane: "upstream", x: X.upstream, row: 7.25 },
  "Pedrubik2000/kuma3-anki-core": { lane: "upstream", x: X.upstream, row: 8 },

  // Upstreams of the backend and of AnkiQuest-Android, and upstream's artifact the third-party apps use.
  "ankidroid/Anki-Android-Backend": { lane: "upstream", x: X.upstream, row: 8.9 },
  "Pedrubik2000/kuma3-anki-backend": { lane: "upstream", x: X.upstream, row: 9.75 },
  "Pedrubik2000/kuma3-anki-app": { lane: "upstream", x: X.upstream, row: 11.3 },
  "ankidroid/Anki-Android": { lane: "upstream", x: X.upstream, row: 12.3 },
  "maven:com.github.ankidroid": { lane: "upstream", x: X.upstream, row: 13.1 },

  // Upstreams of the third-party app forks, level with each fork.
  "KamWithK/AnkiconnectAndroid": { lane: "upstream", x: X.upstream, row: 14.4 },
  "sypianski/garmanki": { lane: "upstream", x: X.upstream, row: 15.6 },
  "ankimcp/ankidroid-mcp": { lane: "upstream", x: X.upstream, row: 16.8 },

  // Core: Anki's core, the backend built from it, and the backend artifacts.
  "AnkiQuest/AnkiQuest-Anki": { lane: "core", x: X.core, row: 4.2 },
  "AnkiQuest/AnkiQuest-Android-Backend": { lane: "core", x: X.core, row: 9.4 },
  "maven:org.ankiquest": { lane: "core", x: X.coreSide, row: 10.4 },
  "maven:io.github.david-allison": { lane: "core", x: X.core, row: 11.3 },

  // Clients, and the api module AnkiQuest-Android publishes.
  "AnkiQuest/AnkiQuest-Desktop": { lane: "clients", x: X.clients, row: 7 },
  "AnkiQuest/AnkiQuest-Android": { lane: "clients", x: X.clients, row: 12.3 },
  "maven:com.ichi2.anki": { lane: "clients", x: X.clientsSide, row: 12.3 },

  // Third-party app forks, in a staircase so the content provider lines from AnkiQuest-Android never cross a fork.
  "AnkiQuest/AnkiQuest-AnkiConnectAndroid": { lane: "forks", x: 720, row: 14.4 },
  "AnkiQuest/AnkiQuest-GarmAnki": { lane: "forks", x: 910, row: 15.6 },
  "AnkiQuest/AnkiQuest-Android-MCP": { lane: "forks", x: 1100, row: 16.8 },

  // Server and web.
  "AnkiQuest/AnkiQuest-Art": { lane: "server", x: X.server, row: 3.5 },
  "AnkiQuest/AnkiQuest-Server": { lane: "server", x: X.server, row: 7 },
  "AnkiQuest/AnkiQuest.github.io": { lane: "server", x: X.serverSide, row: 5.2 },

  // Shared infrastructure, along the bottom.
  "AnkiQuest/AnkiQuest-Dev": { lane: "infra", x: X.upstream, row: INFRA_ROW },
  "AnkiQuest/AnkiQuest-Agents": { lane: "infra", x: X.core, row: INFRA_ROW },
  "AnkiQuest/AnkiQuest-Sync": { lane: "infra", x: X.clients, row: INFRA_ROW },
  "AnkiQuest/AnkiQuest-Hosting": { lane: "infra", x: X.clientsSide + 30, row: INFRA_ROW },
  "float3/nixos": { lane: "infra", x: X.server + 30, row: INFRA_ROW },
};

/** Where a lane's column is, for nodes LAYOUT does not place. */
const LANE_X: Record<Lane, number> = {
  upstream: X.upstream,
  core: X.core,
  clients: X.clients,
  forks: X.clientsSide,
  server: X.server,
  infra: X.upstream,
};

/** Space between a node placed by the fallback and the one before it: in pixels across, in rows down. */
const FALLBACK_STEP = 210;
const FALLBACK_ROWS = 1.25;

/**
 * The lane of a node LAYOUT does not place: an upstream's is the upstream
 * lane, a package's its publisher's, a fork's the app forks and any other
 * repository's the shared infrastructure.
 */
export function fallbackLane(map: Wiring, node: WiringNode): Lane {
  switch (node.kind) {
    case "external":
      return "upstream";
    case "fork":
      return "forks";
    case "repo":
      return "infra";
    case "package": {
      const publisher = map.edges.find((edge) => edge.kinds.includes("publishes") && edge.to === node.id)?.from;
      const owner = map.nodes.find((candidate) => candidate.id === publisher);
      if (!owner || owner.kind === "package") {
        return "core";
      }
      return LAYOUT[owner.id]?.lane ?? fallbackLane(map, owner);
    }
  }
}

/**
 * Every node's place: LAYOUT's, or for a node it lacks, a row below the
 * lowest node of its lane, in the lane's column (in the infrastructure
 * band, the next column to the right), in order of id so the result never
 * changes.
 */
export function places(map: Wiring): Map<string, Place> {
  const result = new Map<string, Place>();
  for (const node of map.nodes) {
    const place = LAYOUT[node.id];
    if (place) {
      result.set(node.id, place);
    }
  }
  const missing = map.nodes.filter((node) => !result.has(node.id)).sort((a, b) => a.id.localeCompare(b.id));
  for (const node of missing) {
    const lane = fallbackLane(map, node);
    const taken = [...result.values()].filter((place) => place.lane === lane);
    if (lane === "infra") {
      const x = Math.max(LANE_X.infra - FALLBACK_STEP, ...taken.map((place) => place.x)) + FALLBACK_STEP;
      result.set(node.id, { lane, x, row: INFRA_ROW });
      continue;
    }
    const lowest = Math.max(-1, ...taken.map((place) => place.row));
    result.set(node.id, { lane, x: LANE_X[lane], row: lowest + FALLBACK_ROWS });
  }
  return result;
}

/** The phone's two columns: upstreams on the left, the other lanes stacked on the right. */
const PHONE_RIGHT = 235;

/** Lanes stacked in the phone's right column, top to bottom: the server sits above the clients it feeds. */
const PHONE_STACK: Lane[] = ["core", "server", "clients", "forks"];

/** Rows between two nodes, and between two lanes (for the gap and the heading), on a phone. */
const PHONE_ROW_STEP = 1.3;
const PHONE_LANE_GAP = 0.9;

/**
 * The phone layout: the upstreams keep their desktop rows in the left
 * column, so each stays level with what it feeds; the other lanes stack
 * in the right column in their desktop order (top to bottom, then left to
 * right); the shared infrastructure flows into both columns below.
 */
export function stacked(desktop: Map<string, Place>): Map<string, Place> {
  const result = new Map<string, Place>();
  const inLane = (lane: Lane): string[] =>
    [...desktop.entries()]
      .filter(([, place]) => place.lane === lane)
      .sort(([, a], [, b]) => a.row - b.row || a.x - b.x)
      .map(([id]) => id);

  // Upstreams: the left column, as on the desktop.
  for (const id of inLane("upstream")) {
    result.set(id, { ...desktop.get(id)!, x: 0 });
  }

  // The other lanes, one under the other in the right column.
  let row = 0;
  for (const lane of PHONE_STACK) {
    const ids = inLane(lane);
    for (const id of ids) {
      result.set(id, { lane, x: PHONE_RIGHT, row });
      row += PHONE_ROW_STEP;
    }
    if (ids.length > 0) {
      row += PHONE_LANE_GAP;
    }
  }

  // Shared infrastructure: two columns under everything else.
  const top = Math.max(row, ...[...result.values()].map((place) => place.row + PHONE_ROW_STEP)) + PHONE_LANE_GAP;
  inLane("infra").forEach((id, index) => {
    result.set(id, { lane: "infra", x: (index % 2) * PHONE_RIGHT, row: top + Math.floor(index / 2) * PHONE_ROW_STEP });
  });
  return result;
}

// --- Labels and badges -------------------------------------------------------------------

/** Characters on one line of a node, and their width and height in pixels at 11px. */
const LINE_CHARS = 30;
const CHAR_WIDTH = 6.2;
const LINE_HEIGHT = 15;

/** Wraps text into lines of at most `max` characters, breaking after spaces, slashes and hyphens. */
export function wrap(text: string, max = LINE_CHARS): string[] {
  const words = text.match(/[^\s/-]+[\s/-]*|[\s/-]+/g) ?? [text];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + word).trimEnd().length > max) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += word;
  }
  lines.push(line.trimEnd());
  return lines;
}

/** A node's box for its label lines, plus padding. */
export function boxSize(lines: string[]): [number, number] {
  const longest = Math.max(...lines.map((line) => line.length));
  return [longest * CHAR_WIDTH + 20, lines.length * LINE_HEIGHT + 14];
}

/** A repository's short name in a badge: AnkiQuest-Dev is "Dev". */
function shortName(id: string): string {
  return (id.split("/").pop() ?? id).replace(/^AnkiQuest-/, "");
}

/** Statuses from worst to best: a group of edges shows its worst. */
const SEVERITY: Status[] = ["behind", "unknown", "planned", "current", "none"];

/** The worst status of some facts. */
function worst(facts: Pick<WiringFact, "status">[]): Status {
  return SEVERITY.find((name) => facts.some((fact) => fact.status === name)) ?? "none";
}

/** A count and a noun: "flake", "4 workflows". */
function counted(kind: EdgeKind, count: number): string {
  const [one, many] = KIND_NOUNS[kind];
  return count === 1 ? one : `${count} ${many}`;
}

/** A badge piece's status mark, after a space, or nothing. */
function marked(edges: WiringFact[]): string {
  const mark = STATUS_MARKS[worst(edges)];
  return mark ? ` ${mark}` : "";
}

/** Groups items by a key, keeping first-seen order. */
function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return [...groups.values()];
}

/**
 * The badge of a node: what the hidden edge kinds would draw, in words. In:
 * "Dev: flake !, 4 workflows", "AGENTS.md !". Out, for a kind that fans
 * out to two or more nodes: "AGENTS.md → 13 (12 !)".
 */
export function badge(map: Wiring, id: string, shown: Set<EdgeKind>): string[] {
  const hidden = map.edges
    .filter((edge) => !shownEdge(edge, shown) && edge.from !== edge.to)
    .flatMap((edge) => edge.facts.map((fact) => ({ ...fact, from: edge.from, to: edge.to })));
  const pieces: string[] = [];

  // What the node takes, by source: AGENTS.md alone, as it always comes from AnkiQuest-Agents.
  const into = hidden.filter((edge) => edge.to === id);
  for (const group of groupBy(into, (edge) => (edge.kind === "agents" ? "" : edge.from))) {
    const parts = groupBy(group, (edge) => edge.kind).map((edges) => `${counted(edges[0].kind, edges.length)}${marked(edges)}`);
    pieces.push(group[0].kind === "agents" ? parts.join(", ") : `${shortName(group[0].from)}: ${parts.join(", ")}`);
  }

  // What the node feeds, for kinds that fan out.
  const out = hidden.filter((edge) => edge.from === id);
  for (const edges of groupBy(out, (edge) => edge.kind)) {
    const targets = new Set(edges.map((edge) => edge.to)).size;
    if (targets < 2) {
      continue;
    }
    const behind = new Set(edges.filter((edge) => edge.status === "behind").map((edge) => edge.to)).size;
    pieces.push(`${KIND_NOUNS[edges[0].kind][1]} → ${targets}${behind ? ` (${behind} !)` : ""}`);
  }

  // Pieces joined into lines, breaking only between pieces.
  const lines: string[] = [];
  for (const piece of pieces) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} · ${piece}`.length <= LINE_CHARS + 4) {
      lines[last] = `${lines[last]} · ${piece}`;
    } else {
      lines.push(piece);
    }
  }
  return lines;
}

/** One edge drawn as a line, in the colour and style of its first shown kind. */
export interface Line {
  from: string;
  to: string;
  kind: EdgeKind;
  edge: WiringEdge;
  status: Status;
  mark: string;
}

/**
 * The mark on an edge's line: its status mark, and when out of date the
 * commits behind; one number when its facts agree, else each ("! 14, 3").
 */
export function mark(edge: WiringEdge): string {
  if (edge.status !== "behind") {
    return STATUS_MARKS[edge.status];
  }
  const counts = [...new Set(edge.facts.filter((fact) => fact.status === "behind" && typeof fact.behind === "number").map((fact) => fact.behind))];
  return `! ${counts.join(", ")}`.trim();
}

/** A line per edge; its kind is the first of the edge's kinds that is shown. */
export function lines(edges: WiringEdge[], shown: Set<EdgeKind>): Line[] {
  return edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kinds.find((kind) => shown.has(kind)) ?? edge.kinds[0], edge, status: edge.status, mark: mark(edge) }));
}

// --- Details and table -------------------------------------------------------------------

/** A commit hash shortened; versions unchanged. */
function short(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 10) : value;
}

/** Escapes text for HTML. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A link, or the plain text when there is no URL. */
function link(text: string, url: string | undefined): string {
  return url ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text);
}

/** Linkifies the URLs in a detail text. */
function linked(text: string): string {
  return esc(text).replace(/https:\/\/[^\s;,]+/g, (url) => `<a href="${url}">${url.replace(/^https:\/\/github\.com\//, "")}</a>`);
}

/** The status badge: a mark and the words, coloured by status. */
function statusBadge(edge: Pick<WiringFact, "status" | "behind">): string {
  const mark = STATUS_MARKS[edge.status];
  return `<span class="status ${edge.status}">${mark ? `${mark} ` : ""}${esc(statusText(edge))}</span>`;
}

/** A small line in a kind's colour and style, for the filters. */
function swatch(kind: EdgeKind): string {
  return `<span class="swatch kind ${KIND_LINES[kind]}" style="--kind: var(--kind-${kind})"></span>`;
}

/** The details of a node: what it is and every edge into and out of it. */
function nodeDetails(map: Wiring, id: string): string {
  const node = map.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    return "";
  }
  const facts = [
    node.purpose ? `<p>${esc(node.purpose)}</p>` : "",
    node.head ? `<p>Default branch at <code>${esc(short(node.head))}</code>${node.private ? " (private repository)" : ""}</p>` : "",
    node.note ? `<p class="muted">${esc(node.note)}</p>` : "",
  ].join("");
  const list = (edges: WiringEdge[], other: (edge: WiringEdge) => string): string =>
    edges.length === 0
      ? "<p class=\"muted\">None.</p>"
      : `<ul>${edges.map((edge) => `<li><b>${esc(other(edge))}</b>: ${esc(edge.label)} ${statusBadge(edge)}${files(edge)}</li>`).join("")}</ul>`;
  const into = map.edges.filter((edge) => edge.to === id);
  const out = map.edges.filter((edge) => edge.from === id);
  return `<h2>${link(node.label, node.url)}</h2>${facts}<h3>Takes from</h3>${list(into, (edge) => edge.from)}<h3>Feeds</h3>${list(out, (edge) => edge.to)}`;
}

/** Links to the files that make an edge's facts, after a space, or nothing. */
function files(edge: WiringEdge): string {
  const sources = [...new Set(edge.facts.flatMap((fact) => (fact.source ? [fact.source] : [])))];
  return sources.map((source, index) => ` ${link(sources.length === 1 ? "file" : `file ${index + 1}`, source)}`).join("");
}

/** What a watched source is watched for, or why a fact is the way it is, as table text. */
function explained(fact: WiringFact): string {
  return [fact.purpose ? `Watched for: ${esc(fact.purpose)}` : "", fact.detail ? linked(fact.detail) : ""].filter(Boolean).join("<br>");
}

/** The details of one edge: its summary, then each fact with its kind, pin and file. */
function edgeDetails(edge: WiringEdge): string {
  const fact = (one: WiringFact): string => {
    const rows = [
      ["Kind", esc(KIND_NAMES[one.kind])],
      ["What", esc(one.label)],
      ["Watched for", one.purpose ? esc(one.purpose) : ""],
      [one.kind === "watched" ? "Reviewed" : "Pinned", one.pinned ? `<code>${esc(short(one.pinned))}</code>` : ""],
      ["Latest", one.latest ? `<code>${esc(short(one.latest))}</code>` : ""],
      ["Status", statusBadge(one)],
      ["Detail", one.detail ? linked(one.detail) : ""],
      ["File", one.source ? link(one.source.replace(/^https:\/\/github\.com\//, ""), one.source) : ""],
    ].filter(([, value]) => value);
    return `<dl>${rows.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join("")}</dl>`;
  };
  return `<h2>${esc(edge.from)} → ${esc(edge.to)}</h2><p>${esc(edge.label)} ${statusBadge(edge)}</p>${edge.facts.map(fact).join("")}`;
}

/** The table of the edges shown: a row per fact, so merged edges keep each kind's pin and file. */
function table(edges: WiringEdge[]): string {
  const body = edges
    .flatMap((edge) => edge.facts.map((fact) => ({ edge, fact })))
    .map(
      ({ edge, fact }) =>
        `<tr><td>${esc(KIND_NAMES[fact.kind])}</td><td>${esc(edge.from)}</td><td>${esc(edge.to)}</td><td>${esc(fact.label)}</td><td><code>${esc(short(fact.pinned))}</code></td><td><code>${esc(short(fact.latest))}</code></td><td>${statusBadge(fact)}${fact.purpose || fact.detail ? `<br><small>${explained(fact)}</small>` : ""}</td><td>${fact.source ? link("file", fact.source) : ""}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Kind</th><th>From</th><th>To</th><th>What</th><th>Pinned</th><th>Latest</th><th>Status</th><th>Source</th></tr></thead><tbody>${body}</tbody></table>`;
}

// --- The page in the browser ---------------------------------------------------------

/** The Cytoscape.js global the page loads from cdnjs; only what is used here. */
interface CyCollection {
  addClass(name: string): CyCollection;
  removeClass(name: string): CyCollection;
  not(other: CyCollection | string): CyCollection;
  union(other: CyCollection): CyCollection;
  unselect(): CyCollection;
  remove(): CyCollection;
  boundingBox(): { x1: number; y1: number; w: number; h: number };
}
interface CyElement extends CyCollection {
  id(): string;
  data(key: string): unknown;
  isNode(): boolean;
  closedNeighborhood(): CyCollection;
  connectedNodes(): CyCollection;
}
interface Cy {
  on(event: string, selector: string, handler: (event: { target: CyElement }) => void): void;
  on(event: string, handler: (event: { target: unknown }) => void): void;
  elements(selector?: string): CyCollection;
  add(elements: unknown[]): void;
  layout(options: Record<string, unknown>): { run(): void };
  style(sheet: unknown[]): void;
  resize(): void;
  fit(elements?: CyCollection, padding?: number): void;
  zoom(level: number): void;
  pan(position: { x: number; y: number }): void;
  width(): number;
}
declare const cytoscape: (options: Record<string, unknown>) => Cy;

/** Below this page width the lanes stack, as on a phone. */
const NARROW = 700;

/** Padding around the map in the graph box, in pixels. */
const PADDING = 16;

/** The tallest the graph box grows on a wide screen, as a share of the window. */
const MAX_HEIGHT = 0.88;

/** The graph box's height on a narrow screen, as a share of the window; the map pans inside. */
const NARROW_HEIGHT = 0.8;

/** Reads a colour token from the stylesheet. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The Cytoscape style, from the page's colour tokens (light or dark). */
function graphStyle(): unknown[] {
  const kinds = Object.keys(KIND_NAMES) as EdgeKind[];
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-wrap": "wrap",
        "text-max-width": "400px",
        "font-size": "11px",
        "line-height": 1.3,
        color: token("--ink"),
        "text-valign": "center",
        "text-halign": "center",
        "background-color": token("--card"),
        "border-width": 1.5,
        "border-color": token("--line-strong"),
        shape: "round-rectangle",
      },
    },
    { selector: "node[width]", style: { width: "data(width)", height: "data(height)" } },
    { selector: "node[kind = 'fork']", style: { "border-width": 4, "border-style": "double", "border-color": token("--accent") } },
    { selector: "node[kind = 'external']", style: { "corner-radius": 14, "background-color": token("--tile"), color: token("--muted"), "border-color": token("--line") } },
    { selector: "node[kind = 'package']", style: { shape: "cut-rectangle", "background-color": token("--tile") } },
    { selector: "node[?planned]", style: { "border-style": "dashed", color: token("--muted") } },
    { selector: "node[?outdated]", style: { "border-color": token("--status-behind"), "border-width": 3 } },
    { selector: "node[kind = 'fork'][?outdated]", style: { "border-width": 5 } },
    {
      selector: "node.lane",
      style: {
        shape: "round-rectangle",
        "corner-radius": 16,
        "background-color": token("--lane"),
        "background-opacity": 1,
        "border-width": 0,
        padding: 14,
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -6,
        "font-size": "13px",
        "font-weight": 600,
        color: token("--muted"),
        events: "no",
      },
    },
    { selector: "node.idle", style: { opacity: 0.35 } },
    { selector: "node.match", style: { "underlay-color": token("--accent"), "underlay-opacity": 0.25, "underlay-padding": 6 } },
    { selector: "node:selected", style: { "overlay-color": token("--accent"), "overlay-opacity": 0.2 } },
    {
      selector: "edge",
      style: {
        width: 1.8,
        "curve-style": "bezier",
        "control-point-step-size": 30,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        opacity: 0.9,
        "font-size": "10px",
        "font-weight": 700,
        "text-background-color": token("--card"),
        "text-background-opacity": 1,
        "text-background-padding": 2,
        "text-rotation": "none",
      },
    },
    ...kinds.map((kind) => ({
      selector: `edge[kind = '${kind}']`,
      style: { "line-color": token(`--kind-${kind}`), "target-arrow-color": token(`--kind-${kind}`), "line-style": KIND_LINES[kind] },
    })),
    { selector: "edge.bow", style: { "curve-style": "unbundled-bezier", "control-point-distances": "data(bow)", "control-point-weights": 0.5 } },
    { selector: "edge.rightward", style: { "source-endpoint": "50% 0%", "target-endpoint": "-50% 0%" } },
    { selector: "edge.leftward", style: { "source-endpoint": "-50% 0%", "target-endpoint": "50% 0%" } },
    { selector: "edge[status = 'behind']", style: { width: 3.2, label: "data(mark)", color: token("--status-behind") } },
    { selector: "edge[status = 'unknown']", style: { label: "data(mark)", color: token("--muted") } },
    { selector: "edge[status = 'planned']", style: { label: "data(mark)", color: token("--status-planned"), opacity: 0.6 } },
    { selector: "edge:selected", style: { width: 4.5, opacity: 1 } },

    // Focus: what is not next to the focused node or edge fades.
    { selector: ".faded", style: { opacity: 0.12, "text-opacity": 0.25 } },
    { selector: "edge.faded", style: { opacity: 0.06, "text-opacity": 0 } },
  ];
}

/** How much wider than tall, and how wide in pixels, a line must run to leave and enter its nodes at their sides. */
const SIDEWAYS = 1.3;
const SIDEWAYS_MIN = 250;

/**
 * A line running mostly sideways leaves its source's side and enters its
 * target's facing side ("rightward" or "leftward"), so lines out of a
 * column of upstreams do not cut through the neighbours of their source.
 */
export function direction(from: Place, to: Place): string {
  const dx = to.x - from.x;
  const dy = (to.row - from.row) * ROW;
  if (Math.abs(dx) < SIDEWAYS_MIN || Math.abs(dx) < SIDEWAYS * Math.abs(dy)) {
    return "";
  }
  return dx > 0 ? "rightward" : "leftward";
}

/** How close two x values must be for nodes to share a column, in pixels. */
const SAME_COLUMN = 40;

/** How far a line bows out per row it spans, and at most, in pixels. */
const BOW_PER_ROW = 22;
const BOW_MAX = 110;

/**
 * How far a line must bow to the right to pass the nodes between its ends
 * in the same column, or 0 when nothing is in the way. The sign follows
 * Cytoscape's control point distance, which is measured to the right of
 * the line's direction.
 */
export function bow(from: Place, to: Place, all: Iterable<Place>): number {
  if (Math.abs(to.x - from.x) > SAME_COLUMN) {
    return 0;
  }
  const [low, high] = from.row < to.row ? [from.row, to.row] : [to.row, from.row];
  const between = [...all].some((place) => place !== from && place !== to && Math.abs(place.x - from.x) <= SAME_COLUMN && place.row > low && place.row < high);
  if (!between) {
    return 0;
  }
  const size = Math.min(BOW_MAX, BOW_PER_ROW * (high - low));
  return from.row < to.row ? -size : size;
}

/** Cytoscape elements: the lanes, every node in its place and one line per kind and pair of nodes shown. */
function elements(map: Wiring, edges: WiringEdge[], filter: Filter, at: Map<string, Place>): unknown[] {
  const used = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const outdated = new Set(edges.filter((edge) => edge.status === "behind").map((edge) => edge.to));
  const search = filter.search.trim();
  const lanes = new Set([...at.values()].map((place) => place.lane));
  const laneElements = (Object.keys(LANES) as Lane[])
    .filter((lane) => lanes.has(lane))
    .map((lane) => ({ group: "nodes", classes: "lane", data: { id: `lane:${lane}`, label: LANES[lane] } }));

  // Nodes stay in place whatever the filters; one without a line shown fades.
  const nodeElements = map.nodes.map((node) => {
    const place = at.get(node.id)!;
    const name = `${outdated.has(node.id) ? "! " : ""}${node.label}`;
    const label = [...wrap(name), ...(node.planned ? ["(planned)"] : []), ...badge(map, node.id, filter.kinds)];
    const [width, height] = boxSize(label);
    const own = node.kind === "repo" || node.kind === "fork";
    const idle = !used.has(node.id) && !(own && (!search || matches(node, search)));
    const classes = [idle ? "idle" : "", search && matches(node, search) ? "match" : ""].join(" ").trim();
    return {
      group: "nodes",
      classes,
      data: { id: node.id, parent: `lane:${place.lane}`, label: label.join("\n"), width, height, kind: node.kind, planned: node.planned === true, outdated: outdated.has(node.id) },
      position: { x: place.x, y: place.row * ROW },
    };
  });

  // A self-loop (AnkiQuest-Agents' own AGENTS.md) is in the table only.
  const edgeElements = lines(
    edges.filter((edge) => edge.from !== edge.to),
    filter.kinds,
  ).map((line, index) => {
    const [from, to] = [at.get(line.from)!, at.get(line.to)!];
    const bend = bow(from, to, at.values());
    return {
      group: "edges",
      classes: [direction(from, to), bend ? "bow" : ""].join(" ").trim(),
      data: { id: `e${index}`, source: line.from, target: line.to, kind: line.kind, status: line.status, mark: line.mark, bow: bend, index: map.edges.indexOf(line.edge) },
    };
  });
  return [...laneElements, ...nodeElements, ...edgeElements];
}

/** Builds the page from wiring.json. */
async function main(): Promise<void> {
  const map = (await (await fetch("wiring.json")).json()) as Wiring;
  const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T;
  const kinds = Object.keys(KIND_NAMES) as EdgeKind[];
  const desktop = places(map);
  const phone = stacked(desktop);

  // Summary and notes.
  const behind = map.edges.filter((edge) => edge.status === "behind").length;
  const unknown = map.edges.filter((edge) => edge.status === "unknown").length;
  $("#summary").innerHTML = `${map.nodes.length} nodes, ${map.edges.length} edges (${map.edges.reduce((sum, edge) => sum + edge.facts.length, 0)} facts): <span class="status behind">! ${behind} out of date</span>, <span class="status unknown">${unknown} unknown</span>. Generated ${esc(map.generated.slice(0, 16).replace("T", " "))} UTC.`;
  $("#notes").innerHTML = map.notes.map((note) => `<li>${linked(note)}</li>`).join("");

  // One checkbox per edge kind present, with its line and count; the fan-out kinds start off.
  const present = kinds.filter((kind) => map.edges.some((edge) => edge.kinds.includes(kind)));
  $("#kinds").innerHTML = present
    .map(
      (kind) =>
        `<label><input type="checkbox" value="${kind}"${DEFAULT_KINDS.has(kind) ? " checked" : ""}> ${swatch(kind)} ${esc(KIND_NAMES[kind])} <span class="muted">${map.edges.filter((edge) => edge.kinds.includes(kind)).length}</span></label>`,
    )
    .join("");

  const graph = $("#graph");
  const cy = cytoscape({ container: graph, style: graphStyle(), minZoom: 0.2, maxZoom: 3, boxSelectionEnabled: false, autoungrabify: true });
  const details = $("#details");
  const empty = details.innerHTML;

  const filter = (): Filter => ({
    kinds: new Set([...document.querySelectorAll<HTMLInputElement>("#kinds input:checked")].map((input) => input.value as EdgeKind)),
    outdated: $<HTMLInputElement>("#outdated").checked,
    search: $<HTMLInputElement>("#search").value,
  });

  // Focus: the hovered or chosen node or edge, its neighbours and their lines stay; the rest fades.
  let chosen: CyElement | undefined;
  const focus = (target: CyElement | undefined): void => {
    cy.elements().removeClass("faded");
    if (!target) {
      return;
    }
    const keep = target.isNode() ? target.closedNeighborhood() : target.union(target.connectedNodes());
    cy.elements().not(keep).not("node.lane").addClass("faded");
  };
  const reset = (): void => {
    chosen = undefined;
    cy.elements().unselect();
    focus(undefined);
    details.innerHTML = empty;
  };

  // Fit the map: on a wide screen the box takes the map's shape; on a narrow one the map fills its width and pans.
  const fit = (narrow: boolean): void => {
    const box = cy.elements().boundingBox();
    const width = graph.clientWidth;
    if (narrow) {
      graph.style.height = `${Math.round(innerHeight * NARROW_HEIGHT)}px`;
      cy.resize();
      const zoom = (width - 2 * PADDING) / box.w;
      cy.zoom(zoom);
      cy.pan({ x: PADDING - box.x1 * zoom, y: PADDING - box.y1 * zoom });
      return;
    }
    const height = ((width - 2 * PADDING) * box.h) / box.w + 2 * PADDING;
    graph.style.height = `${Math.round(Math.min(height, innerHeight * MAX_HEIGHT))}px`;
    cy.resize();
    cy.fit(undefined, PADDING);
  };

  // Redraw the graph and the table for the current filters.
  const render = (): void => {
    const current = filter();
    const edges = visibleEdges(map, current);
    const narrow = innerWidth < NARROW;
    chosen = undefined;
    cy.elements().remove();
    cy.add(elements(map, edges, current, narrow ? phone : desktop));
    cy.layout({ name: "preset", fit: false }).run();
    fit(narrow);
    details.innerHTML = empty;
    $("#table").innerHTML = table(edges);
    $("#count").textContent = `${edges.length} of ${map.edges.length} edges`;
  };

  cy.on("mouseover", "node, edge", (event) => focus(event.target));
  cy.on("mouseout", "node, edge", () => focus(chosen));
  cy.on("tap", "node", (event) => {
    chosen = event.target;
    focus(chosen);
    details.innerHTML = nodeDetails(map, event.target.id());
  });
  cy.on("tap", "edge", (event) => {
    chosen = event.target;
    focus(chosen);
    details.innerHTML = edgeDetails(map.edges[Number(event.target.data("index"))]);
  });
  cy.on("tap", (event) => {
    if (event.target === cy) {
      reset();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      reset();
    }
  });

  for (const input of document.querySelectorAll("#controls input")) {
    input.addEventListener(input.getAttribute("type") === "search" ? "input" : "change", render);
  }
  const setAll = (value: (kind: EdgeKind) => boolean): void => {
    for (const input of document.querySelectorAll<HTMLInputElement>("#kinds input")) {
      input.checked = value(input.value as EdgeKind);
    }
    render();
  };
  $("#all").addEventListener("click", () => setAll(() => true));
  $("#main").addEventListener("click", () => setAll((kind) => DEFAULT_KINDS.has(kind)));
  $("#none").addEventListener("click", () => setAll(() => false));

  // Colours follow the system's light or dark mode; the layout follows the window's width.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => cy.style(graphStyle()));
  let wasNarrow = innerWidth < NARROW;
  addEventListener("resize", () => {
    const narrow = innerWidth < NARROW;
    if (narrow !== wasNarrow) {
      wasNarrow = narrow;
      render();
      return;
    }
    fit(narrow);
  });
  render();
}

/** How long the copy button says it copied, in milliseconds. */
const COPIED_FOR = 1500;

/** The copy button of the Mermaid source; works without wiring.json. */
function copyButton(): void {
  const button = document.querySelector<HTMLButtonElement>("#copy");
  const code = document.querySelector("#mermaid-source");
  if (!button || !code) {
    return;
  }
  button.addEventListener("click", () => {
    navigator.clipboard.writeText(code.textContent ?? "").then(
      () => {
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = "Copy"), COPIED_FOR);
      },
      () => {
        button.textContent = "Copy failed";
      },
    );
  });
}

if (typeof document !== "undefined") {
  copyButton();
  main().catch((error: unknown) => {
    document.querySelector("#summary")!.textContent = `Could not load wiring.json: ${String(error)}`;
  });
}
