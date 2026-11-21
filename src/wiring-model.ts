// The wiring map's data: wiring.json, written by src/wiring.ts and read by
// site/wiring.ts. Edges point the way code or data flows: from the
// upstream, source, provider or publisher to the repository that takes it.

/** What a node is. */
export type NodeKind = "repo" | "fork" | "external" | "package";

/** How one node feeds another. */
export type EdgeKind =
  | "upstream"
  | "watched"
  | "submodule"
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
  /** A repository that is decided but has no commits yet. */
  planned?: boolean;
  note?: string;
}

/** One link between two nodes. */
export interface WiringEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  label: string;
  /** The commit or version the receiving side uses. */
  pinned?: string;
  /** The newest commit or version available. */
  latest?: string;
  /** Commits the pin lacks, where counted. */
  behind?: number;
  status: Status;
  detail?: string;
  /** Link to the file that makes this edge. */
  source?: string;
}

/** The whole map. */
export interface Wiring {
  generated: string;
  nodes: WiringNode[];
  edges: WiringEdge[];
  /** What could not be read, and inconsistencies found on the way. */
  notes: string[];
}
