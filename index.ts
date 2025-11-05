#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import lockfile from 'proper-lockfile';

// Number of top matching entities to select per query token
// Default 1 ensures each concept in the query is represented by its best match
const SEARCH_TOP_PER_TOKEN = parseInt(process.env.SEARCH_TOP_PER_TOKEN || '1', 10);

// Minimum relative score threshold (0.0-1.0) - entities must score at least this percentage of the best match per token
// Default 0.3 means keep entities scoring ≥30% of the top match, filtering weak matches while adapting to each token's distribution
const SEARCH_MIN_RELATIVE_SCORE = parseFloat(process.env.SEARCH_MIN_RELATIVE_SCORE || '0.3');

// Maximum path length (hops) when finding connections between entry nodes
// Default 5 allows reasonably long paths without traversing entire graph
const SEARCH_MAX_PATH_LENGTH = parseInt(process.env.SEARCH_MAX_PATH_LENGTH || '5', 10);

// Maximum total nodes to return in final result (safety cap)
// Default 50 provides comprehensive context without overwhelming token budget
const SEARCH_MAX_TOTAL_NODES = parseInt(process.env.SEARCH_MAX_TOTAL_NODES || '50', 10);

// Memory file path: absolute or relative to script directory
const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
  ? (path.isAbsolute(process.env.MEMORY_FILE_PATH)
      ? process.env.MEMORY_FILE_PATH
      : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.MEMORY_FILE_PATH))
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'memory.jsonl');

// Graph structure: entities with observations + relations
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  created_at?: number;  // Unix timestamp (ms)
  updated_at?: number;  // Unix timestamp (ms)
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// Knowledge graph manager with O(1) hash index + inverted index for search
class KnowledgeGraphManager {
  private entityIndex: Map<string, Entity> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();

  // File locking wrapper for safe concurrent access
  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    // Ensure directory exists
    const dir = path.dirname(MEMORY_FILE_PATH);
    await fs.mkdir(dir, { recursive: true });

    // Ensure file exists (lockfile requires existing file)
    try {
      await fs.access(MEMORY_FILE_PATH);
    } catch {
      await fs.writeFile(MEMORY_FILE_PATH, '');
    }

    // Acquire lock with retry strategy
    const release = await lockfile.lock(MEMORY_FILE_PATH, {
      stale: 10000,           // Consider lock stale after 10s
      update: 5000,           // Update lock every 5s to prove liveness
      retries: {
        retries: 5,           // Retry up to 5 times
        factor: 2,            // Exponential backoff
        minTimeout: 100,      // Min 100ms between retries
        maxTimeout: 2000,     // Max 2s between retries
      },
    });

    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const data = await fs.readFile(MEMORY_FILE_PATH, "utf-8");
      const graph = data.split("\n").filter(l => l.trim()).reduce((g: KnowledgeGraph, l) => {
        const item = JSON.parse(l);
        if (item.type === "entity") {
          g.entities.push({
            name: item.name,
            entityType: item.entityType,
            observations: item.observations,
            created_at: item.created_at,
            updated_at: item.updated_at
          });
        } else if (item.type === "relation") {
          g.relations.push(item as Relation);
        }
        return g;
      }, { entities: [], relations: [] });
      this.rebuildIndexes(graph);
      return graph;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  private async saveGraph(graph: KnowledgeGraph): Promise<void> {
    const lines = [
      ...graph.entities.map(e => JSON.stringify({
        type: "entity",
        name: e.name,
        entityType: e.entityType,
        observations: e.observations,
        ...(e.created_at && { created_at: e.created_at }),
        ...(e.updated_at && { updated_at: e.updated_at })
      })),
      ...graph.relations.map(r => JSON.stringify({
        type: "relation",
        from: r.from,
        to: r.to,
        relationType: r.relationType
      }))
    ];

    // Atomic write: write to temp file, then rename
    const content = lines.join("\n") + (lines.length > 0 ? "\n" : "");
    const tempPath = `${MEMORY_FILE_PATH}.tmp.${process.pid}`;

    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, MEMORY_FILE_PATH);  // Atomic on POSIX

    this.rebuildIndexes(graph);
  }

  // Tokenize: lowercase, split on non-word chars (keep hyphens), filter short terms
  private tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  }

  // Rebuild indexes: hash (name→entity) and inverted (token→Set<name>)
  private rebuildIndexes(graph: KnowledgeGraph): void {
    this.entityIndex.clear();
    this.invertedIndex.clear();
    graph.entities.forEach(e => {
      this.entityIndex.set(e.name, e);
      this.tokenize([e.name, e.entityType, ...e.observations].join(' ')).forEach(t => {
        if (!this.invertedIndex.has(t)) this.invertedIndex.set(t, new Set());
        this.invertedIndex.get(t)!.add(e.name);
      });
    });
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.withFileLock(async () => {
      const graph = await this.loadGraph();
      const now = Date.now();
      const existingNames = new Set(graph.entities.map(e => e.name));
      const newEntities = entities.filter(e => !existingNames.has(e.name)).map(e => ({
        ...e, created_at: now, updated_at: now
      }));
      graph.entities.push(...newEntities);
      await this.saveGraph(graph);
      return newEntities;
    });
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    return this.withFileLock(async () => {
      const graph = await this.loadGraph();
      const existing = new Set(graph.relations.map(r => `${r.from}|${r.to}|${r.relationType}`));
      const newRelations = relations.filter(r => !existing.has(`${r.from}|${r.to}|${r.relationType}`));
      graph.relations.push(...newRelations);
      await this.saveGraph(graph);
      return newRelations;
    });
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    return this.withFileLock(async () => {
      const graph = await this.loadGraph();
      const now = Date.now();
      const results = observations.map(o => {
        const entity = this.entityIndex.get(o.entityName);
        if (!entity) throw new Error(`Entity ${o.entityName} not found`);
        const existing = new Set(entity.observations);
        const newObs = o.contents.filter(c => !existing.has(c));
        if (newObs.length > 0) {
          entity.observations.push(...newObs);
          entity.updated_at = now;
        }
        return { entityName: o.entityName, addedObservations: newObs };
      });
      await this.saveGraph(graph);
      return results;
    });
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.withFileLock(async () => {
      const graph = await this.loadGraph();
      const deleteSet = new Set(entityNames);
      graph.entities = graph.entities.filter(e => !deleteSet.has(e.name));
      graph.relations = graph.relations.filter(r => !deleteSet.has(r.from) && !deleteSet.has(r.to));
      await this.saveGraph(graph);
    });
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    await this.withFileLock(async () => {
      const graph = await this.loadGraph();
      const now = Date.now();
      deletions.forEach(d => {
        const entity = this.entityIndex.get(d.entityName);
        if (entity) {
          const deleteSet = new Set(d.observations);
          const origLen = entity.observations.length;
          entity.observations = entity.observations.filter(o => !deleteSet.has(o));
          if (entity.observations.length < origLen) entity.updated_at = now;
        }
      });
      await this.saveGraph(graph);
    });
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.withFileLock(async () => {
      const graph = await this.loadGraph();
      const deleteSet = new Set(relations.map(r => `${r.from}|${r.to}|${r.relationType}`));
      graph.relations = graph.relations.filter(r => !deleteSet.has(`${r.from}|${r.to}|${r.relationType}`));
      await this.saveGraph(graph);
    });
  }

  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  // BFS shortest path (bidirectional graph, max depth limit)
  private findShortestPath(from: string, to: string, graph: KnowledgeGraph, maxLen: number): string[] | null {
    if (from === to) return [from];

    // Build degree map for centrality weighting
    const degree = new Map<string, number>();
    graph.relations.forEach(r => {
      degree.set(r.from, (degree.get(r.from) || 0) + 1);
      degree.set(r.to, (degree.get(r.to) || 0) + 1);
    });

    // Build adjacency list (bidirectional)
    const adj = new Map<string, Set<string>>();
    graph.relations.forEach(r => {
      if (!adj.has(r.from)) adj.set(r.from, new Set());
      adj.get(r.from)!.add(r.to);
      if (!adj.has(r.to)) adj.set(r.to, new Set());
      adj.get(r.to)!.add(r.from);
    });

    // Dijkstra with centrality-weighted edges: cost = 1 + log(1 + degree)
    const dist = new Map<string, number>();
    const parent = new Map<string, string>();
    const pq: Array<[number, string]> = [[0, from]];
    dist.set(from, 0);

    while (pq.length > 0) {
      pq.sort((a, b) => a[0] - b[0]);
      const [currDist, curr] = pq.shift()!;

      if (curr === to) {
        const path: string[] = [];
        for (let n = to; n; n = parent.get(n)!) path.unshift(n);
        return path.length - 1 <= maxLen ? path : null;
      }

      if (currDist > (dist.get(curr) || Infinity)) continue;

      adj.get(curr)?.forEach(nb => {
        const edgeCost = 1 + Math.log(1 + (degree.get(nb) || 0));
        const newDist = currDist + edgeCost;

        if (newDist < (dist.get(nb) || Infinity)) {
          dist.set(nb, newDist);
          parent.set(nb, curr);
          pq.push([newDist, nb]);
        }
      });
    }
    return null;
  }

  // Steiner Tree: connect entry nodes via pairwise shortest paths (2-approx)
  private findSteinerTree(entries: Set<string>, graph: KnowledgeGraph, maxLen: number): Set<string> {
    if (entries.size <= 1) return new Set(entries);
    const connected = new Set(entries);
    const arr = Array.from(entries);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const path = this.findShortestPath(arr[i], arr[j], graph, maxLen);
        path?.forEach(n => connected.add(n));
      }
    }
    return connected;
  }

  // Sparse vector search: inverted index + TF×importance×recency scoring
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return { entities: [], relations: [] };

    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    // Degree map: count relations per entity
    const degree = new Map<string, number>();
    graph.relations.forEach(r => {
      degree.set(r.from, (degree.get(r.from) || 0) + 1);
      degree.set(r.to, (degree.get(r.to) || 0) + 1);
    });

    // Score entities per query token
    const tokenCands = new Map<string, Array<[string, number]>>();
    queryTokens.forEach(tok => {
      const matches = this.invertedIndex.get(tok);
      if (!matches) return;

      const scores: Array<[string, number]> = [];
      matches.forEach(name => {
        const e = this.entityIndex.get(name);
        if (!e) return;

        const text = [e.name, e.entityType, ...e.observations].join(' ').toLowerCase();
        const tf = 1 + Math.log(1 + (text.match(new RegExp(tok, 'g')) || []).length);
        const importance = Math.log(e.observations.length + 1) * (1 + Math.log(1 + (degree.get(name) || 0)));
        const recency = e.updated_at ? Math.exp(-(now - e.updated_at) / THIRTY_DAYS) : 1.0;
        scores.push([name, tf * importance * recency]);
      });

      scores.sort((a, b) => b[1] - a[1]);
      if (scores.length > 0) {
        const minScore = scores[0][1] * SEARCH_MIN_RELATIVE_SCORE;
        tokenCands.set(tok, scores.filter(([_, s]) => s >= minScore));
      }
    });

    // Deduplicate: select top N per token
    const entries = new Set<string>();
    queryTokens.forEach(tok => {
      const cands = tokenCands.get(tok);
      if (!cands) return;
      let count = 0;
      for (const [name] of cands) {
        if (count >= SEARCH_TOP_PER_TOKEN) break;
        if (!entries.has(name)) {
          entries.add(name);
          count++;
        }
      }
    });

    if (entries.size === 0) return { entities: [], relations: [] };

    // Find connecting paths (Steiner Tree)
    const connected = this.findSteinerTree(entries, graph, SEARCH_MAX_PATH_LENGTH);

    // Apply node limit: prioritize entry nodes, then intermediate
    let finalNames: string[];
    if (connected.size <= SEARCH_MAX_TOTAL_NODES) {
      finalNames = Array.from(connected);
    } else {
      finalNames = Array.from(entries);
      const inter = Array.from(connected).filter(n => !entries.has(n));
      finalNames.push(...inter.slice(0, SEARCH_MAX_TOTAL_NODES - finalNames.length));
    }

    const finalSet = new Set(finalNames);
    return {
      entities: finalNames.map(n => this.entityIndex.get(n)!).filter(Boolean),
      relations: graph.relations.filter(r => finalSet.has(r.from) && finalSet.has(r.to))
    };
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    const entities = names.map(n => this.entityIndex.get(n)!).filter(Boolean);
    const nameSet = new Set(names);
    return {
      entities,
      relations: graph.relations.filter(r => nameSet.has(r.from) || nameSet.has(r.to))
    };
  }
}

const knowledgeGraphManager = new KnowledgeGraphManager();


// The server instance and tools exposed to Claude
const server = new Server({
  name: "mcp-memory-server-concurrent",
  version: "1.0.0",
},    {
    capabilities: {
      tools: {},
    },
  },);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_entities",
        description: "Create entities in the knowledge graph. Use granular well connected entires for best results. Use search_nodes and/or open_nodes for planning.",
        inputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The name of the entity" },
                  entityType: { type: "string", description: "The type of the entity" },
                  observations: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "An array of observation contents associated with the entity"
                  },
                },
                required: ["name", "entityType", "observations"],
                additionalProperties: false,
              },
            },
          },
          required: ["entities"],
          additionalProperties: false,
        },
      },
      {
        name: "create_relations",
        description: "Create relations between entities. Use active voice. Connect new entities to existing ones for better retrieval.",
        inputSchema: {
          type: "object",
          properties: {
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
                additionalProperties: false,
              },
            },
          },
          required: ["relations"],
          additionalProperties: false,
        },
      },
      {
        name: "add_observations",
        description: "Add observations to existing entities. Prefer this over creating new entities for closely related information.",
        inputSchema: {
          type: "object",
          properties: {
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity to add the observations to" },
                  contents: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "An array of observation contents to add"
                  },
                },
                required: ["entityName", "contents"],
                additionalProperties: false,
              },
            },
          },
          required: ["observations"],
          additionalProperties: false,
        },
      },
      {
        name: "delete_entities",
        description: "Delete entities and their relations from the graph. Use actively for improving quality.",
        inputSchema: {
          type: "object",
          properties: {
            entityNames: { 
              type: "array", 
              items: { type: "string" },
              description: "An array of entity names to delete" 
            },
          },
          required: ["entityNames"],
          additionalProperties: false,
        },
      },
      {
        name: "delete_observations",
        description: "Delete observations from entities. Use actively for improving quality.",
        inputSchema: {
          type: "object",
          properties: {
            deletions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity containing the observations" },
                  observations: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "An array of observations to delete"
                  },
                },
                required: ["entityName", "observations"],
                additionalProperties: false,
              },
            },
          },
          required: ["deletions"],
          additionalProperties: false,
        },
      },
      {
        name: "delete_relations",
        description: "Delete relations from the graph. Use actively for improving quality.",
        inputSchema: {
          type: "object",
          properties: {
            relations: { 
              type: "array", 
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
                additionalProperties: false,
              },
              description: "An array of relations to delete" 
            },
          },
          required: ["relations"],
          additionalProperties: false,
        },
      },
      {
        name: "read_graph",
        description: "Read the entire knowledge graph",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "search_nodes",
        description: "Search nodes by query. Multi-term matching: each term finds best matches, returns connecting entities.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query to match against entity names, types, and observation content" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "open_nodes",
        description: "Open nodes by name with 1-hop relations. Use to explore neighborhoods, creating or deleting, planning quality improvement operations.",
        inputSchema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to retrieve",
            },
          },
          required: ["names"],
          additionalProperties: false,
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "read_graph") {
    return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.readGraph(), null, 2) }] };
  }

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    case "create_entities":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createEntities(args.entities as Entity[]), null, 2) }] };
    case "create_relations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createRelations(args.relations as Relation[]), null, 2) }] };
    case "add_observations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.addObservations(args.observations as { entityName: string; contents: string[] }[]), null, 2) }] };
    case "delete_entities":
      await knowledgeGraphManager.deleteEntities(args.entityNames as string[]);
      return { content: [{ type: "text", text: "Entities deleted successfully" }] };
    case "delete_observations":
      await knowledgeGraphManager.deleteObservations(args.deletions as { entityName: string; observations: string[] }[]);
      return { content: [{ type: "text", text: "Observations deleted successfully" }] };
    case "delete_relations":
      await knowledgeGraphManager.deleteRelations(args.relations as Relation[]);
      return { content: [{ type: "text", text: "Relations deleted successfully" }] };
    case "search_nodes":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.searchNodes(args.query as string), null, 2) }] };
    case "open_nodes":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.openNodes(args.names as string[]), null, 2) }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server running on stdio");
  console.error(`Memory file: ${MEMORY_FILE_PATH}`);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
