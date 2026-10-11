import { describe, expect, it } from 'vitest';
import { DependencyGraph, type DependencyNode } from './DependencyGraph.js';

class Node implements DependencyNode {
  deps: Node[] = [];
  constructor(readonly name: string) {}
  getDependencies(): Node[] {
    return this.deps;
  }
}

function graphOf(...nodes: Node[]): DependencyGraph<Node> {
  return new DependencyGraph(new Map(nodes.map((node) => [node.name, node])));
}

describe('DependencyGraph', () => {
  it('orders dependencies before their dependents', () => {
    const auth = new Node('auth');
    const api = new Node('api');
    const eventsub = new Node('eventsub');
    api.deps = [auth];
    eventsub.deps = [auth, api];

    const sorted = graphOf(eventsub, api, auth).sort(['eventsub', 'api', 'auth']);

    expect(sorted.indexOf('auth')).toBeLessThan(sorted.indexOf('api'));
    expect(sorted.indexOf('api')).toBeLessThan(sorted.indexOf('eventsub'));
  });

  it('skips dependencies outside the requested subset', () => {
    const auth = new Node('auth');
    const api = new Node('api');
    api.deps = [auth];

    expect(graphOf(auth, api).sort(['api'])).toEqual(['api']);
  });

  it('groups independent nodes into the same level', () => {
    const auth = new Node('auth');
    const api = new Node('api');
    const eventsub = new Node('eventsub');
    const discord = new Node('discord');
    api.deps = [auth];
    eventsub.deps = [auth, api];

    const levels = graphOf(auth, api, eventsub, discord).levels([
      'auth',
      'api',
      'eventsub',
      'discord',
    ]);

    expect(levels[0]?.sort()).toEqual(['auth', 'discord']);
    expect(levels[1]).toEqual(['api']);
    expect(levels[2]).toEqual(['eventsub']);
  });

  it('reverses the order for shutdown', () => {
    const auth = new Node('auth');
    const api = new Node('api');
    api.deps = [auth];

    expect(graphOf(auth, api).stopOrder(['auth', 'api'])).toEqual(['api', 'auth']);
  });

  it('finds transitive dependents without duplicating a diamond', () => {
    const base = new Node('base');
    const left = new Node('left');
    const right = new Node('right');
    const join = new Node('join');
    left.deps = [base];
    right.deps = [base];
    join.deps = [left, right];

    const dependents = graphOf(base, left, right, join).transitiveDependentsOf('base');

    expect(dependents.sort()).toEqual(['join', 'left', 'right']);
  });

  it('terminates on a dependency cycle instead of recursing forever', () => {
    const a = new Node('a');
    const b = new Node('b');
    a.deps = [b];
    b.deps = [a];

    // The traversal must survive a graph validate() would have rejected.
    expect(graphOf(a, b).transitiveDependentsOf('a').sort()).toEqual(['a', 'b']);
  });

  it('rejects a cycle on validate, including among nodes nobody asked to start', () => {
    const a = new Node('a');
    const b = new Node('b');
    a.deps = [b];
    b.deps = [a];

    expect(() => graphOf(a, b).validate()).toThrow(/Circular dependency/);
  });

  it('rejects a dependency that is not registered', () => {
    const api = new Node('api');
    api.deps = [new Node('auth')];

    expect(() => graphOf(api).validate()).toThrow(/not registered/);
  });

  it('accepts a valid graph', () => {
    const auth = new Node('auth');
    const api = new Node('api');
    api.deps = [auth];

    expect(() => graphOf(auth, api).validate()).not.toThrow();
  });
});
