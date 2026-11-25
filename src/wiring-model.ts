// The wiring map's data: wiring.json, written by src/wiring.ts and read by
// site/wiring.ts. Edges point the way code or data flows: from the
// upstream, source, provider or publisher to the repository that takes it.

/**
 * What a node is: a repository, a fork, an upstream or other outside
 * source, a Maven group, a module inside one of the repositories (such as a
 * second app), or the assets of a repository's releases.
 */
export type NodeKind = "repo" | "fork" | "external" | "package" | "module" | "release";

/** How one node feeds another. */
export type EdgeKind =
  | "upstream"
  | "watched"
  | "submodule"
  | "art"
  | "rules"
  | "flake"
  | "cargo"
  | "maven"
  | "publishes"
  | "vendored"
  | "workflow"
  | "checkout"
  | "data"
  | "agents"
  | "runtime";

/** Every edge kind, in the order the page lists them. */
export const EDGE_KINDS: EdgeKind[] = [
  "upstream",
  "watched",
  "submodule",
  "art",
  "rules",
  "flake",
  "cargo",
  "maven",
  "publishes",
  "vendored",
  "workflow",
  "checkout",
  "data",
  "agents",
  "runtime",
];

/**
 * Whether an edge's pin is current: `none` for edges without a version,
 * `planned` for edges decided but not made yet.
 */
export type Status = "current" | "behind" | "unknown" | "none" | "planned";

/** A repository, upstream or package. */
export interface WiringNode {
  id: string;
  kind: NodeKind;
  label: string;
  url?: string;
  purpose?: string;
  /** The latest commit of the default branch, when read. */
  head?: string;
  private?: boolean;
  /** False when the generator could not read the repository. */
  readable: boolean;
  /** A repository, module or release that is decided but does not exist yet. */
  planned?: boolean;
  /** For a module: the repository it is part of, which the page draws around both. */
  partOf?: string;
  note?: string;
}

/** Each kind in an edge's label: "watched + Cargo pin, bd8932b, 14 behind". */
export const KIND_LABELS: Record<EdgeKind, string> = {
  upstream: "upstream merge",
  watched: "watched",
  submodule: "submodule",
  art: "art release pin",
  rules: "rules release",
  flake: "flake input",
  cargo: "Cargo pin",
  maven: "Maven",
  publishes: "publishes",
  vendored: "vendored",
  workflow: "reusable workflow",
  checkout: "CI checkout",
  data: "Server data",
  agents: "AGENTS.md",
  runtime: "runtime",
};

/** One fact behind an edge: one kind of link, made by one file. */
export interface WiringFact {
  kind: EdgeKind;
  label: string;
  /** The commit or version the receiving side uses (for a watched source: the one reviewed). */
  pinned?: string;
  /** The newest commit or version available. */
  latest?: string;
  /** Commits the pin lacks, where counted. */
  behind?: number;
  status: Status;
  /** What a watched source is watched for (watched.json's `why`). */
  purpose?: string;
  detail?: string;
  /** Link to the file that makes this fact. */
  source?: string;
}

/**
 * Everything one node gives another, as one edge: every fact between the
 * pair, of every kind. The page draws it when any of its kinds is shown.
 */
export interface WiringEdge {
  from: string;
  to: string;
  /** The kinds of its facts, in EDGE_KINDS order. */
  kinds: EdgeKind[];
  /** A summary: kinds, pin and status, such as "watched + Cargo pin, bd8932b, 14 behind". */
  label: string;
  /** The worst status of its facts. */
  status: Status;
  /** Commits behind, when every out-of-date fact with a count agrees. */
  behind?: number;
  facts: WiringFact[];
}

/** The whole map. */
export interface Wiring {
  generated: string;
  nodes: WiringNode[];
  edges: WiringEdge[];
  /** What could not be read, and inconsistencies found on the way. */
  notes: string[];
}
