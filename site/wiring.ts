// The wiring page: draws wiring.json as a graph with Cytoscape.js, with
// filters by edge kind, a search box, details of the selected node or edge
// and a table of every edge shown. build.ts strips the types into wiring.js.
// The helpers above main() are pure, so the tests import this file in Node.

import type { EdgeKind, Status, Wiring, WiringEdge, WiringNode } from "../src/wiring-model.ts";

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

/** Each status in words; out of date also gets a mark, so colour is never the only sign. */
const STATUS_NAMES: Record<Status, string> = {
  current: "up to date",
  behind: "out of date",
  unknown: "unknown",
  none: "no version",
  planned: "planned",
};

/** What the filters let through. */
export interface Filter {
  kinds: Set<EdgeKind>;
  outdated: boolean;
  search: string;
}

/** An edge's status in words, with the commit count when there is one. */
export function statusText(edge: WiringEdge): string {
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

/** The edges the filters let through; a search keeps edges touching a matching node or label. */
export function visibleEdges(map: Wiring, filter: Filter): WiringEdge[] {
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const search = filter.search.trim().toLowerCase();
  return map.edges.filter((edge) => {
    if (!filter.kinds.has(edge.kind)) {
      return false;
    }
    if (filter.outdated && edge.status !== "behind") {
      return false;
    }
    if (!search) {
      return true;
    }
    const ends = [byId.get(edge.from), byId.get(edge.to)].filter((node): node is WiringNode => node !== undefined);
    return ends.some((node) => matches(node, search)) || edge.label.toLowerCase().includes(search);
  });
}

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
function badge(edge: WiringEdge): string {
  const mark = edge.status === "behind" ? "! " : edge.status === "planned" ? "~ " : "";
  return `<span class="status ${edge.status}">${mark}${esc(statusText(edge))}</span>`;
}

// --- The page in the browser ---------------------------------------------------------

/** The Cytoscape.js global the page loads from cdnjs; only what is used here. */
interface CyElement {
  id(): string;
  data(key: string): unknown;
  style(name: string, value: string): void;
}
interface CyCollection {
  forEach(each: (element: CyElement) => void): void;
}
interface Cy {
  on(event: string, selector: string | ((event: { target: unknown }) => void), handler?: (event: { target: CyElement }) => void): void;
  elements(): { remove(): void };
  add(elements: unknown[]): void;
  layout(options: Record<string, unknown>): { run(): void };
  style(sheet: unknown[]): void;
  nodes(): CyCollection;
  resize(): void;
  fit(padding?: number): void;
}
declare const cytoscape: (options: Record<string, unknown>) => Cy;

/** Reads a colour token from the stylesheet. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The Cytoscape style, from the page's colour tokens (light or dark). */
function graphStyle(): unknown[] {
  const status = (name: Status): string => token(`--status-${name}`);
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-wrap": "wrap",
        "text-max-width": "130px",
        "font-size": "11px",
        color: token("--ink"),
        "text-valign": "center",
        "text-halign": "center",
        "background-color": token("--card"),
        "border-width": 1.5,
        "border-color": token("--line-strong"),
        shape: "round-rectangle",
        width: "data(width)",
        height: "data(height)",
      },
    },
    { selector: "node[kind = 'fork']", style: { "border-width": 3, "border-color": token("--accent") } },
    { selector: "node[kind = 'external']", style: { shape: "ellipse", "background-color": token("--tile"), color: token("--muted") } },
    { selector: "node[kind = 'package']", style: { shape: "hexagon", "background-color": token("--tile") } },
    { selector: "node[?planned]", style: { "border-style": "dashed", color: token("--muted") } },
    { selector: "node[?outdated]", style: { "border-color": status("behind"), "border-width": 3 } },
    { selector: "node:selected", style: { "overlay-color": token("--accent"), "overlay-opacity": 0.2 } },
    {
      selector: "edge",
      style: {
        width: 1.6,
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "line-color": status("none"),
        "target-arrow-color": status("none"),
        opacity: 0.85,
      },
    },
    ...(["current", "behind", "unknown", "planned"] as Status[]).map((name) => ({
      selector: `edge[status = '${name}']`,
      style: { "line-color": status(name), "target-arrow-color": status(name) },
    })),
    { selector: "edge[status = 'behind']", style: { width: 3, label: "data(mark)", "font-size": "10px", color: status("behind"), "text-background-color": token("--bg"), "text-background-opacity": 1 } },
    { selector: "edge[status = 'unknown']", style: { "line-style": "dashed" } },
    { selector: "edge[status = 'planned']", style: { "line-style": "dotted", width: 2.4 } },
    { selector: "edge:selected", style: { width: 4, opacity: 1 } },
  ];
}

/** Lane of a node, left to right: upstreams, our repositories, packages. */
function lane(node: WiringNode): number {
  switch (node.kind) {
    case "external":
      return 0;
    case "fork":
      return 1;
    case "repo":
      return 2;
    case "package":
      return 3;
  }
}

/** Width of a node label's character, and of a line, in pixels at 11px. */
const CHAR_WIDTH = 6.4;
const LINE_HEIGHT = 15;

/** A node's box for its label: the longest line (at most 130px wide) and the line count, plus padding. */
export function boxSize(label: string): [number, number] {
  const lines = label.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  const wrapped = lines.reduce((count, line) => count + Math.max(1, Math.ceil((line.length * CHAR_WIDTH) / 130)), 0);
  return [Math.min(130, longest * CHAR_WIDTH) + 18, wrapped * LINE_HEIGHT + 14];
}

/** Statuses from worst to best: a line between two nodes shows its worst edge. */
const SEVERITY: Status[] = ["behind", "unknown", "planned", "current", "none"];

/** The edges between one pair of nodes, drawn as one line. */
export interface Pair {
  from: string;
  to: string;
  edges: WiringEdge[];
  status: Status;
  mark: string;
}

/** Groups edges by their two ends; the line's status is its worst edge's, its mark counts what is out of date. */
export function pairs(edges: WiringEdge[]): Pair[] {
  const byEnds = new Map<string, WiringEdge[]>();
  for (const edge of edges) {
    const key = `${edge.from}\n${edge.to}`;
    byEnds.set(key, [...(byEnds.get(key) ?? []), edge]);
  }
  return [...byEnds.values()].map((group) => {
    const status = SEVERITY.find((name) => group.some((edge) => edge.status === name)) ?? "none";
    const behind = group.filter((edge) => edge.status === "behind");
    const mark = behind.length === 1 ? `! ${behind[0].behind ?? ""}`.trim() : `! ${behind.length}`;
    return { from: group[0].from, to: group[0].to, edges: group, status, mark };
  });
}

/** Cytoscape elements for the edges shown and the nodes they touch (all our repositories always). */
function elements(map: Wiring, edges: WiringEdge[], search: string): unknown[] {
  const used = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const outdated = new Set(map.edges.filter((edge) => edge.status === "behind").map((edge) => edge.to));
  const nodes = map.nodes.filter((node) => used.has(node.id) || ((node.kind === "repo" || node.kind === "fork") && (!search || matches(node, search))));
  // Starting positions: our repositories on an inner ring, upstreams and packages outside.
  const inner = nodes.filter((node) => lane(node) === 1 || lane(node) === 2);
  const outer = nodes.filter((node) => !inner.includes(node));
  const ring = (node: WiringNode): { x: number; y: number } => {
    const list = inner.includes(node) ? inner : outer;
    const radius = inner.includes(node) ? 320 : 720;
    const angle = (2 * Math.PI * list.indexOf(node)) / list.length;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  };
  const nodeElements = nodes.map((node) => {
    const mark = outdated.has(node.id) ? "\n[! out of date]" : node.planned ? "\n(planned)" : "";
    const label = `${node.label}${mark}`;
    const [width, height] = boxSize(label);
    return {
      group: "nodes",
      data: { id: node.id, label, width, height, kind: node.kind, planned: node.planned === true, outdated: outdated.has(node.id) },
      position: ring(node),
    };
  });
  // One line per pair of nodes; a self-loop (AnkiQuest-Agents' own AGENTS.md) is in the table only.
  const edgeElements = pairs(edges.filter((edge) => edge.from !== edge.to)).map((pair, index) => ({
    group: "edges",
    data: { id: `e${index}`, source: pair.from, target: pair.to, status: pair.status, indices: pair.edges.map((edge) => map.edges.indexOf(edge)).join(","), mark: pair.mark },
  }));
  return [...nodeElements, ...edgeElements];
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
      : `<ul>${edges.map((edge) => `<li>${esc(KIND_NAMES[edge.kind])}: <b>${esc(other(edge))}</b>, ${esc(edge.label)} ${badge(edge)}${edge.source ? ` ${link("file", edge.source)}` : ""}</li>`).join("")}</ul>`;
  const into = map.edges.filter((edge) => edge.to === id);
  const out = map.edges.filter((edge) => edge.from === id);
  return `<h2>${link(node.label, node.url)}</h2>${facts}<h3>Takes from</h3>${list(into, (edge) => edge.from)}<h3>Feeds</h3>${list(out, (edge) => edge.to)}`;
}

/** The details of one edge. */
function edgeDetails(edge: WiringEdge): string {
  const rows = [
    ["Kind", esc(KIND_NAMES[edge.kind])],
    ["From", esc(edge.from)],
    ["To", esc(edge.to)],
    ["What", esc(edge.label)],
    ["Pinned", edge.pinned ? `<code>${esc(short(edge.pinned))}</code>` : ""],
    ["Latest", edge.latest ? `<code>${esc(short(edge.latest))}</code>` : ""],
    ["Status", badge(edge)],
    ["Detail", edge.detail ? linked(edge.detail) : ""],
    ["File", edge.source ? link(edge.source.replace(/^https:\/\/github\.com\//, ""), edge.source) : ""],
  ].filter(([, value]) => value);
  return `<h2>${esc(edge.from)} → ${esc(edge.to)}</h2><dl>${rows.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

/** The table of the edges shown. */
function table(edges: WiringEdge[]): string {
  const body = edges
    .map(
      (edge) =>
        `<tr><td>${esc(KIND_NAMES[edge.kind])}</td><td>${esc(edge.from)}</td><td>${esc(edge.to)}</td><td>${esc(edge.label)}</td><td><code>${esc(short(edge.pinned))}</code></td><td><code>${esc(short(edge.latest))}</code></td><td>${badge(edge)}${edge.detail ? `<br><small>${linked(edge.detail)}</small>` : ""}</td><td>${edge.source ? link("file", edge.source) : ""}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Kind</th><th>From</th><th>To</th><th>What</th><th>Pinned</th><th>Latest</th><th>Status</th><th>Source</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** Builds the page from wiring.json. */
async function main(): Promise<void> {
  const map = (await (await fetch("wiring.json")).json()) as Wiring;
  const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T;
  const kinds = Object.keys(KIND_NAMES) as EdgeKind[];

  // Summary and notes.
  const behind = map.edges.filter((edge) => edge.status === "behind").length;
  const unknown = map.edges.filter((edge) => edge.status === "unknown").length;
  $("#summary").innerHTML = `${map.nodes.length} nodes, ${map.edges.length} edges: <span class="status behind">! ${behind} out of date</span>, <span class="status unknown">${unknown} unknown</span>. Generated ${esc(map.generated.slice(0, 16).replace("T", " "))} UTC.`;
  $("#notes").innerHTML = map.notes.map((note) => `<li>${linked(note)}</li>`).join("");

  // One checkbox per edge kind present, with its count.
  const present = kinds.filter((kind) => map.edges.some((edge) => edge.kind === kind));
  $("#kinds").innerHTML = present
    .map((kind) => `<label><input type="checkbox" value="${kind}" checked> ${esc(KIND_NAMES[kind])} <span class="muted">${map.edges.filter((edge) => edge.kind === kind).length}</span></label>`)
    .join("");

  const cy = cytoscape({ container: $("#graph"), style: graphStyle(), minZoom: 0.2, maxZoom: 3 });
  const details = $("#details");

  const filter = (): Filter => ({
    kinds: new Set([...document.querySelectorAll<HTMLInputElement>("#kinds input:checked")].map((input) => input.value as EdgeKind)),
    outdated: $<HTMLInputElement>("#outdated").checked,
    search: $<HTMLInputElement>("#search").value,
  });

  // Redraw the graph and the table for the current filters.
  const render = (): void => {
    const current = filter();
    const edges = visibleEdges(map, current);
    cy.elements().remove();
    cy.add(elements(map, edges, current.search));
    cy.layout({ name: "cose", randomize: false, animate: false, nodeRepulsion: 400000, idealEdgeLength: 120, edgeElasticity: 60, gravity: 0.4, nodeOverlap: 40, numIter: 2000, padding: 20, componentSpacing: 120 }).run();
    cy.fit(20);
    $("#table").innerHTML = table(edges);
    $("#count").textContent = `${edges.length} of ${map.edges.length} edges`;
  };

  cy.on("tap", "node", (event) => {
    details.innerHTML = nodeDetails(map, event.target.id());
  });
  cy.on("tap", "edge", (event) => {
    const indices = String(event.target.data("indices")).split(",").map(Number);
    details.innerHTML = indices.map((index) => edgeDetails(map.edges[index])).join("");
  });
  for (const input of document.querySelectorAll("#controls input")) {
    input.addEventListener(input.getAttribute("type") === "search" ? "input" : "change", render);
  }
  $("#all").addEventListener("click", () => {
    for (const input of document.querySelectorAll<HTMLInputElement>("#kinds input")) {
      input.checked = true;
    }
    render();
  });
  $("#none").addEventListener("click", () => {
    for (const input of document.querySelectorAll<HTMLInputElement>("#kinds input")) {
      input.checked = false;
    }
    render();
  });

  // Colours follow the system's light or dark mode.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => cy.style(graphStyle()));
  render();
}

if (typeof document !== "undefined") {
  main().catch((error: unknown) => {
    document.querySelector("#summary")!.textContent = `Could not load wiring.json: ${String(error)}`;
  });
}
