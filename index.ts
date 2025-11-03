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

// Define memory file path using environment variable with fallback
const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.jsonl');

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

// Handle backward compatibility: migrate memory.json to memory.jsonl if needed
async function ensureMemoryFilePath(): Promise<string> {
  if (process.env.MEMORY_FILE_PATH) {
    // Custom path provided, use it as-is (with absolute path resolution)
    return path.isAbsolute(process.env.MEMORY_FILE_PATH)
      ? process.env.MEMORY_FILE_PATH
      : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.MEMORY_FILE_PATH);
  }
  
  // No custom path set, check for backward compatibility migration
  const oldMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.json');
  const newMemoryPath = defaultMemoryPath;
  
  try {
    // Check if old file exists and new file doesn't
    await fs.access(oldMemoryPath);
    try {
      await fs.access(newMemoryPath);
      // Both files exist, use new one (no migration needed)
      return newMemoryPath;
    } catch {
      // Old file exists, new file doesn't - migrate
      console.error('DETECTED: Found legacy memory.json file, migrating to memory.jsonl for JSONL format compatibility');
      await fs.rename(oldMemoryPath, newMemoryPath);
      console.error('COMPLETED: Successfully migrated memory.json to memory.jsonl');
      return newMemoryPath;
    }
  } catch {
    // Old file doesn't exist, use new path
    return newMemoryPath;
  }
}

// Initialize memory file path (will be set during startup)
let MEMORY_FILE_PATH: string;

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  created_at?: number;   // Unix timestamp (ms) when entity was created
  updated_at?: number;   // Unix timestamp (ms) when last modified
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

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  // Hash index for O(1) entity lookup by name
  private entityIndex: Map<string, Entity> = new Map();

  // Inverted index for sparse vector search: term -> Set of entity names
  private invertedIndex: Map<string, Set<string>> = new Map();

  private async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const data = await fs.readFile(MEMORY_FILE_PATH, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      const graph = lines.reduce((graph: KnowledgeGraph, line) => {
        const item = JSON.parse(line);
        if (item.type === "entity") {
          // Backward compatibility: if no timestamps, leave as undefined
          const entity: Entity = {
            name: item.name,
            entityType: item.entityType,
            observations: item.observations,
            created_at: item.created_at,
            updated_at: item.updated_at
          };
          graph.entities.push(entity);
        }
        if (item.type === "relation") graph.relations.push(item as Relation);
        return graph;
      }, { entities: [], relations: [] });

      // Rebuild indexes after loading
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
      ...graph.entities.map(e => {
        const entityData: any = {
          type: "entity",
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        };
        // Include timestamps if present
        if (e.created_at !== undefined) entityData.created_at = e.created_at;
        if (e.updated_at !== undefined) entityData.updated_at = e.updated_at;
        return JSON.stringify(entityData);
      }),
      ...graph.relations.map(r => JSON.stringify({
        type: "relation",
        from: r.from,
        to: r.to,
        relationType: r.relationType
      })),
    ];
    await fs.writeFile(MEMORY_FILE_PATH, lines.join("\n"));

    // Rebuild indexes after saving
    this.rebuildIndexes(graph);
  }

  // Tokenize text into searchable terms (simple but effective)
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ') // Keep hyphens for compound terms
      .split(/\s+/)
      .filter(term => term.length > 2); // Skip very short terms
  }

  // Rebuild both hash and inverted indexes
  private rebuildIndexes(graph: KnowledgeGraph): void {
    // Clear existing indexes
    this.entityIndex.clear();
    this.invertedIndex.clear();

    // Build hash index and inverted index simultaneously
    graph.entities.forEach(entity => {
      // Hash index: entity name -> entity object
      this.entityIndex.set(entity.name, entity);

      // Inverted index: tokenize all searchable text
      const searchableText = [
        entity.name,
        entity.entityType,
        ...entity.observations
      ].join(' ');

      const tokens = this.tokenize(searchableText);
      tokens.forEach(token => {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set());
        }
        this.invertedIndex.get(token)!.add(entity.name);
      });
    });
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    const graph = await this.loadGraph();
    const now = Date.now();
    const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));

    // Set timestamps for new entities
    newEntities.forEach(entity => {
      entity.created_at = now;
      entity.updated_at = now;
    });

    graph.entities.push(...newEntities);
    await this.saveGraph(graph);
    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    const graph = await this.loadGraph();
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation => 
      existingRelation.from === r.from && 
      existingRelation.to === r.to && 
      existingRelation.relationType === r.relationType
    ));
    graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph();
    const now = Date.now();
    const results = observations.map(o => {
      // Use hash index for O(1) lookup instead of O(n) find
      const entity = this.entityIndex.get(o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObservations = o.contents.filter(content => !entity.observations.includes(content));
      if (newObservations.length > 0) {
        entity.observations.push(...newObservations);
        // Update timestamp when observations are added
        entity.updated_at = now;
      }
      return { entityName: o.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(graph);
    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    await this.saveGraph(graph);
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    const graph = await this.loadGraph();
    const now = Date.now();
    deletions.forEach(d => {
      // Use hash index for O(1) lookup
      const entity = this.entityIndex.get(d.entityName);
      if (entity) {
        const originalLength = entity.observations.length;
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
        // Update timestamp if observations were actually deleted
        if (entity.observations.length < originalLength) {
          entity.updated_at = now;
        }
      }
    });
    await this.saveGraph(graph);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.relations = graph.relations.filter(r => !relations.some(delRelation => 
      r.from === delRelation.from && 
      r.to === delRelation.to && 
      r.relationType === delRelation.relationType
    ));
    await this.saveGraph(graph);
  }

  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  // Find shortest path between two nodes using BFS (bidirectional graph)
  private findShortestPath(
    from: string,
    to: string,
    graph: KnowledgeGraph,
    maxLength: number
  ): string[] | null {
    if (from === to) return [from];

    // Build adjacency list for bidirectional traversal
    const adjacency = new Map<string, Set<string>>();
    graph.relations.forEach(rel => {
      // Forward direction
      if (!adjacency.has(rel.from)) adjacency.set(rel.from, new Set());
      adjacency.get(rel.from)!.add(rel.to);
      // Backward direction (treat relations as undirected)
      if (!adjacency.has(rel.to)) adjacency.set(rel.to, new Set());
      adjacency.get(rel.to)!.add(rel.from);
    });

    // BFS with parent tracking
    const queue: string[] = [from];
    const visited = new Set<string>([from]);
    const parent = new Map<string, string>();
    let depth = 0;

    while (queue.length > 0 && depth < maxLength) {
      const levelSize = queue.length;

      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!;

        if (current === to) {
          // Reconstruct path
          const path: string[] = [];
          let node = to;
          while (node !== undefined) {
            path.unshift(node);
            node = parent.get(node)!;
          }
          return path;
        }

        const neighbors = adjacency.get(current);
        if (neighbors) {
          neighbors.forEach(neighbor => {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              parent.set(neighbor, current);
              queue.push(neighbor);
            }
          });
        }
      }
      depth++;
    }

    return null; // No path found within maxLength
  }

  // Steiner Tree approximation: find minimal subgraph connecting entry nodes
  // Uses pairwise shortest paths (2-approximation of optimal Steiner Tree)
  private findSteinerTree(
    entryNodes: Set<string>,
    graph: KnowledgeGraph,
    maxPathLength: number
  ): Set<string> {
    if (entryNodes.size === 0) return new Set();
    if (entryNodes.size === 1) return new Set(entryNodes);

    const connectedNodes = new Set<string>(entryNodes);
    const entryArray = Array.from(entryNodes);

    // Find shortest path between each pair of entry nodes
    for (let i = 0; i < entryArray.length; i++) {
      for (let j = i + 1; j < entryArray.length; j++) {
        const path = this.findShortestPath(
          entryArray[i],
          entryArray[j],
          graph,
          maxPathLength
        );

        // Add all nodes in the path to result
        if (path) {
          path.forEach(node => connectedNodes.add(node));
        }
      }
    }

    return connectedNodes;
  }

  // Sparse vector search using inverted index (BM25-style with importance and recency scoring)
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();

    // Tokenize query
    const queryTokens = this.tokenize(query);

    if (queryTokens.length === 0) {
      // Empty query returns empty graph
      return { entities: [], relations: [] };
    }

    // Phase 1: Per-token entry selection with deduplication and backfill
    // For each query token, find top candidates, then deduplicate to ensure diversity
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    // Build degree map (connectedness): entity -> count of relations
    const degreeMap = new Map<string, number>();
    graph.relations.forEach(rel => {
      degreeMap.set(rel.from, (degreeMap.get(rel.from) || 0) + 1);
      degreeMap.set(rel.to, (degreeMap.get(rel.to) || 0) + 1);
    });

    // Map: token -> sorted array of [entityName, score]
    const tokenCandidates = new Map<string, Array<[string, number]>>();

    queryTokens.forEach(token => {
      const matchingEntityNames = this.invertedIndex.get(token);
      if (!matchingEntityNames) return;

      // Score entities matching this specific token
      const tokenScores: Array<[string, number]> = [];

      matchingEntityNames.forEach(entityName => {
        const entity = this.entityIndex.get(entityName);
        if (!entity) return;

        // Count how many times this token appears in entity
        const searchableText = [
          entity.name,
          entity.entityType,
          ...entity.observations
        ].join(' ').toLowerCase();
        const tfCount = (searchableText.match(new RegExp(token, 'g')) || []).length;

        // Sublinear TF scaling: 1 + log(1 + count)
        // Diminishing returns for repeated mentions
        const tfScore = 1 + Math.log(1 + tfCount);

        // Importance boost: combines observation richness and connectedness
        // log(obs_count + 1) × (1 + log(1 + degree))
        const obsImportance = Math.log(entity.observations.length + 1);
        const degree = degreeMap.get(entityName) || 0;
        const connectednessBoost = 1 + Math.log(1 + degree);
        const importanceBoost = obsImportance * connectednessBoost;

        // Recency boost: exp(-age / 30 days)
        let recencyBoost = 1.0;
        if (entity.updated_at) {
          const ageMs = now - entity.updated_at;
          recencyBoost = Math.exp(-ageMs / THIRTY_DAYS_MS);
        }

        // Final score = TF × importance × recency
        const finalScore = tfScore * importanceBoost * recencyBoost;
        tokenScores.push([entityName, finalScore]);
      });

      // Sort by score and apply relative threshold
      tokenScores.sort((a, b) => b[1] - a[1]);

      // Apply relative score threshold: keep entities scoring ≥ X% of best match
      if (tokenScores.length > 0) {
        const bestScore = tokenScores[0][1];
        const minScore = bestScore * SEARCH_MIN_RELATIVE_SCORE;
        const filteredScores = tokenScores.filter(([_, score]) => score >= minScore);
        tokenCandidates.set(token, filteredScores);
      }
    });

    // Deduplicate: ensure diverse entities across tokens
    const entryNodesSet = new Set<string>();

    // Select up to TOP_PER_TOKEN entities per token, avoiding duplicates
    queryTokens.forEach(token => {
      const candidates = tokenCandidates.get(token);
      if (!candidates || candidates.length === 0) {
        return;
      }

      let selectedCount = 0;
      for (const [entityName, score] of candidates) {
        if (selectedCount >= SEARCH_TOP_PER_TOKEN) break;

        if (!entryNodesSet.has(entityName)) {
          entryNodesSet.add(entityName);
          selectedCount++;
        }
      }
    });

    // If no entities found, return empty graph
    if (entryNodesSet.size === 0) {
      return { entities: [], relations: [] };
    }

    // Phase 2: Find minimal connecting structure (Steiner Tree approximation)
    const allConnectedNodes = this.findSteinerTree(entryNodesSet, graph, SEARCH_MAX_PATH_LENGTH);

    // Apply total node limit (safety cap)
    let finalNodeNames: string[];
    if (allConnectedNodes.size <= SEARCH_MAX_TOTAL_NODES) {
      // All nodes fit within limit
      finalNodeNames = Array.from(allConnectedNodes);
    } else {
      // Prioritize entry nodes, then add intermediate nodes up to limit
      const entryNodeNames = Array.from(entryNodesSet);
      finalNodeNames = [...entryNodeNames];
      const intermediateNodes = Array.from(allConnectedNodes).filter(
        name => !entryNodesSet.has(name)
      );
      const remainingSlots = SEARCH_MAX_TOTAL_NODES - entryNodeNames.length;
      finalNodeNames.push(...intermediateNodes.slice(0, remainingSlots));
    }

    // Retrieve entity objects using hash index (O(1) per entity)
    const finalEntities = finalNodeNames
      .map(name => this.entityIndex.get(name))
      .filter((e): e is Entity => e !== undefined);

    // Create a Set of final entity names for quick lookup
    const finalEntityNamesSet = new Set(finalNodeNames);

    // Filter relations to only include those between final entities
    const finalRelations = graph.relations.filter(r =>
      finalEntityNamesSet.has(r.from) && finalEntityNamesSet.has(r.to)
    );

    return {
      entities: finalEntities,
      relations: finalRelations,
    };
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();

    // Use hash index for O(1) lookup per entity instead of O(n) filter
    const filteredEntities = names
      .map(name => this.entityIndex.get(name))
      .filter((e): e is Entity => e !== undefined);

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    // Filter relations to include all 1-hop connections (relations where either endpoint is in the requested entities)
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) || filteredEntityNames.has(r.to)
    );

    return {
      entities: filteredEntities,
      relations: filteredRelations,
    };
  }
}

const knowledgeGraphManager = new KnowledgeGraphManager();


// The server instance and tools exposed to Claude
const server = new Server({
  name: "memory-server",
  version: "0.6.3",
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
        description: "Create multiple new entities in the knowledge graph. Best practice: use granular, focused entities rather than large aggregates. Each entity should represent a single concept, project, or component.",
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
        description: "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice. Best practice: always connect new entities to existing ones to ensure graph connectivity and improve retrieval.",
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
        description: "Add new observations to existing entities in the knowledge graph. Best practice: prefer adding observations to existing entities over creating new ones when information relates to the same concept.",
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
        description: "Delete multiple entities and their associated relations from the knowledge graph",
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
        description: "Delete specific observations from entities in the knowledge graph",
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
        description: "Delete multiple relations from the knowledge graph",
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
        description: "Search for nodes in the knowledge graph based on a query. Uses multi-term semantic matching - each query term finds its best representatives, then returns entities connecting them.",
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
        description: "Open specific nodes in the knowledge graph by their names, including all their direct connections (1-hop relations). Use this to explore entity neighborhoods before creating new entities.",
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
  // Initialize memory file path with backward compatibility
  MEMORY_FILE_PATH = await ensureMemoryFilePath();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
