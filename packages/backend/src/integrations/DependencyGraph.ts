/**
 * A node in the integration dependency graph. Narrower than `IIntegration` on
 * purpose: the graph only needs an identity and a way to reach the nodes a
 * node depends on, which keeps it unit-testable without the lifecycle surface.
 */
export interface DependencyNode {
  readonly name: string;
  getDependencies?(): DependencyNode[];
}

/**
 * Pure dependency-graph queries over a live registry of nodes.
 *
 * Holds the registry by reference, so a graph built once at construction time
 * sees nodes registered later. Every traversal is guarded against cycles —
 * `validate()` rejects them outright, and the walks terminate even if it was
 * never called.
 */
export class DependencyGraph<T extends DependencyNode> {
  constructor(private readonly nodes: ReadonlyMap<string, T>) {}

  /**
   * The nodes `name` directly depends on. Dependencies are declared as node
   * references rather than names, so there is no lookup to fail here — an
   * unregistered dependency is a registration bug, which `validate()` reports.
   */
  dependenciesOf(name: string): T[] {
    const node = this.nodes.get(name);
    if (!node) return [];
    return (node.getDependencies?.() ?? []) as T[];
  }

  /**
   * Startup order for `names`: dependencies before the nodes that depend on
   * them. Dependencies outside `names` are skipped rather than pulled in — a
   * node whose dependency isn't in the set simply can't start, which the
   * caller reports instead of silently widening the set.
   */
  sort(names: Iterable<string>): string[] {
    const subset = new Set(names);
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving ${name}`);
      }

      visiting.add(name);
      for (const dep of this.dependenciesOf(name)) {
        if (subset.has(dep.name)) {
          visit(dep.name);
        }
      }
      visiting.delete(name);

      visited.add(name);
      sorted.push(name);
    };

    for (const name of subset) {
      visit(name);
    }

    return sorted;
  }

  /**
   * `names` grouped into dependency levels: everything in a level depends only
   * on earlier levels, so a level's members can be started concurrently and
   * one slow integration no longer delays an unrelated one. Levels preserve
   * the ordering guarantee `sort()` gives — flattening them yields a valid
   * startup order.
   */
  levels(names: Iterable<string>): string[][] {
    const subset = new Set(names);
    const ordered = this.sort(subset);
    const levelOf = new Map<string, number>();

    for (const name of ordered) {
      let level = 0;
      for (const dep of this.dependenciesOf(name)) {
        if (!subset.has(dep.name)) continue;
        // sort() guarantees dependencies come first, so this is already set.
        level = Math.max(level, (levelOf.get(dep.name) ?? 0) + 1);
      }
      levelOf.set(name, level);
    }

    const grouped: string[][] = [];
    for (const name of ordered) {
      const level = levelOf.get(name) ?? 0;
      const members = grouped[level] ?? [];
      members.push(name);
      grouped[level] = members;
    }

    return grouped;
  }

  /**
   * Shutdown order for `names`: the most downstream node first, so nothing is
   * torn down while something still depending on it is running.
   */
  stopOrder(names: Iterable<string>): string[] {
    return this.sort(names).reverse();
  }

  /**
   * Every node that depends on `name`, directly or transitively. The visited
   * set keeps a diamond from yielding duplicates and a cycle from recursing
   * forever, so this is safe to call before `validate()` has run.
   */
  transitiveDependentsOf(name: string): string[] {
    const found = new Set<string>();

    const walk = (target: string): void => {
      for (const node of this.nodes.values()) {
        if (found.has(node.name)) continue;
        const deps = node.getDependencies?.() ?? [];
        if (deps.some((dep) => dep.name === target)) {
          found.add(node.name);
          walk(node.name);
        }
      }
    };

    walk(name);
    return [...found];
  }

  /**
   * Check the whole registered graph, not just the subset someone is about to
   * start: every declared dependency is registered, and there are no cycles.
   * Startup-time validation only ever saw enabled nodes, so a cycle between
   * two disabled integrations stayed invisible until both were switched on.
   */
  validate(): void {
    for (const node of this.nodes.values()) {
      for (const dep of node.getDependencies?.() ?? []) {
        if (this.nodes.get(dep.name) !== dep) {
          throw new Error(
            `Integration '${node.name}' depends on '${dep.name}', which is not registered`
          );
        }
      }
    }

    // sort() throws on a cycle; running it over every node covers the graph.
    this.sort(this.nodes.keys());
  }
}
