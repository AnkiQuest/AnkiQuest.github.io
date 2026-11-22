// Merges the facts the generator finds into one edge per pair of nodes,
// with a summary label. JSchoreels/fsrs-rs feeds AnkiQuest-Anki as a Cargo
// pin and as a watched source at the same commit; the map draws that as one
// edge, "watched + Cargo pin, bd8932b, 14 behind", and keeps both facts.

import { EDGE_KINDS, KIND_LABELS, type EdgeKind, type Status, type WiringEdge, type WiringFact } from "./wiring-model.ts";

/** One fact with its ends, as the generator finds it. */
export type Link = WiringFact & { from: string; to: string };

/** Statuses from worst to best: an edge shows its worst fact's. */
const SEVERITY: Status[] = ["behind", "unknown", "planned", "current", "none"];

/** Characters of a commit hash in a label. */
const HASH_CHARS = 7;

/** A commit hash shortened; versions and words pass unchanged. */
export function abbrev(value: string): string {
  return /^[0-9a-f]{40}$/.test(value) ? value.slice(0, HASH_CHARS) : value;
}

/** The worst status of some facts. */
export function worst(facts: WiringFact[]): Status {
  return SEVERITY.find((name) => facts.some((fact) => fact.status === name)) ?? "none";
}

/** How a fact's pin stands: "14 behind", "out of date, latest 0.1.3", "unknown", or nothing. */
export function state(fact: WiringFact): string {
  if (fact.status === "behind") {
    if (fact.behind !== undefined && fact.behind !== null) {
      return `${fact.behind} behind`;
    }
    return fact.latest && fact.latest !== fact.pinned ? `out of date, latest ${abbrev(fact.latest)}` : "out of date";
  }
  return fact.status === "unknown" ? "unknown" : "";
}

/** A fact's pin and how it stands, such as "bd8932b, 14 behind". */
function pinText(fact: WiringFact): string {
  return [fact.pinned ? abbrev(fact.pinned) : "", state(fact)].filter(Boolean).join(", ");
}

/** One fact's own words: "submodule: anki"; the kind alone when the label adds nothing. */
function own(fact: WiringFact): string {
  const kind = KIND_LABELS[fact.kind];
  if ([fact.kind, kind].includes(fact.label) || fact.label.startsWith(`${kind} `)) {
    return fact.label === fact.kind ? kind : fact.label;
  }
  return `${kind}: ${fact.label}`;
}

/** Facts in a fixed order: by kind as the page lists them, then label. */
function ordered(facts: WiringFact[]): WiringFact[] {
  return [...facts].sort((a, b) => EDGE_KINDS.indexOf(a.kind) - EDGE_KINDS.indexOf(b.kind) || a.label.localeCompare(b.label));
}

/**
 * An edge's label: what it carries, then its pin. One fact keeps its own
 * label ("submodule: anki, acf9fe3, 20 behind"); several name their kinds
 * ("watched + Cargo pin", "reusable workflow (4)"). The pin shows once when
 * every fact with a pin agrees on it, else each kind's pin in turn.
 */
export function summary(facts: WiringFact[]): string {
  const kinds = EDGE_KINDS.filter((kind) => facts.some((fact) => fact.kind === kind));
  const what =
    facts.length === 1
      ? own(facts[0])
      : kinds
          .map((kind) => {
            const count = facts.filter((fact) => fact.kind === kind).length;
            return count === 1 ? KIND_LABELS[kind] : `${KIND_LABELS[kind]} (${count})`;
          })
          .join(" + ");
  const pins = [...new Set(facts.map(pinText).filter(Boolean))];
  if (pins.length <= 1) {
    return [what, pins[0]].filter(Boolean).join(", ");
  }
  const each = kinds.flatMap((kind) => [...new Set(facts.filter((fact) => fact.kind === kind).map(pinText))].filter(Boolean).map((pin) => `${KIND_LABELS[kind]} ${pin}`));
  return [what, each.join("; ")].filter(Boolean).join(", ");
}

/** The commits behind of an edge, when its out-of-date facts with a count all agree. */
function behindOf(facts: WiringFact[]): number | undefined {
  const counts = new Set(facts.filter((fact) => fact.status === "behind" && typeof fact.behind === "number").map((fact) => fact.behind));
  return counts.size === 1 ? [...counts][0] : undefined;
}

/** One edge from its ends and facts. */
export function edgeOf(from: string, to: string, facts: WiringFact[]): WiringEdge {
  const kinds: EdgeKind[] = EDGE_KINDS.filter((kind) => facts.some((fact) => fact.kind === kind));
  const sorted = ordered(facts);
  const edge: WiringEdge = { from, to, kinds, label: summary(sorted), status: worst(sorted), facts: sorted };
  const behind = behindOf(facts);
  if (behind !== undefined) {
    edge.behind = behind;
  }
  return edge;
}

/** One edge per pair of nodes, in the order the pairs were first found, each with its facts in order found. */
export function merge(links: Link[]): WiringEdge[] {
  const pairs = new Map<string, { from: string; to: string; facts: WiringFact[] }>();
  for (const { from, to, ...fact } of links) {
    const key = `${from}\n${to}`;
    const pair = pairs.get(key) ?? { from, to, facts: [] };
    pair.facts.push(fact);
    pairs.set(key, pair);
  }
  return [...pairs.values()].map((pair) => edgeOf(pair.from, pair.to, pair.facts));
}
