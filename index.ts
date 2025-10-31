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

// Search relevance threshold: minimum percentage of query tokens that must match (0.0-1.0)
// Default 0 means any entity matching at least one token is considered (rely on top-k + scoring)
const SEARCH_MIN_TOKEN_MATCH = parseFloat(process.env.SEARCH_MIN_TOKEN_MATCH || '0');

// Maximum number of results to return from search (top-k limit)
// Default 5 returns the 5 most relevant results based on TF × importance × recency ranking
const SEARCH_TOP_K = parseInt(process.env.SEARCH_TOP_K || '5', 10);

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

  // Sparse vector search using inverted index (BM25-style with importance and recency scoring)
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();

    // Tokenize query
    const queryTokens = this.tokenize(query);

    if (queryTokens.length === 0) {
      // Empty query returns empty graph
      return { entities: [], relations: [] };
    }

    // Find entities matching query tokens using inverted index
    // Score entities by number of matching tokens (simple TF approach)
    const entityScores = new Map<string, number>();

    queryTokens.forEach(token => {
      const matchingEntityNames = this.invertedIndex.get(token);
      if (matchingEntityNames) {
        matchingEntityNames.forEach(entityName => {
          entityScores.set(entityName, (entityScores.get(entityName) || 0) + 1);
        });
      }
    });

    // Filter entities by minimum token match threshold
    // Example: 4 query tokens × 0.65 = 2.6 → ceil(2.6) = 3 tokens required
    const minTokenThreshold = Math.ceil(queryTokens.length * SEARCH_MIN_TOKEN_MATCH);
    for (const [entityName, tfScore] of entityScores.entries()) {
      if (tfScore < minTokenThreshold) {
        entityScores.delete(entityName);
      }
    }

    // If no entities meet threshold, return empty graph
    if (entityScores.size === 0) {
      return { entities: [], relations: [] };
    }

    // Apply importance boost (observation count) and recency decay
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    entityScores.forEach((tfScore, entityName) => {
      const entity = this.entityIndex.get(entityName);
      if (!entity) return;

      // Importance boost: log(observation_count + 1)
      // More observations = more important entity
      const importanceBoost = Math.log(entity.observations.length + 1);

      // Recency decay: entities updated recently score higher
      // Exponential decay with 30-day half-life
      let recencyBoost = 1.0;
      if (entity.updated_at) {
        const ageMs = now - entity.updated_at;
        recencyBoost = Math.exp(-ageMs / THIRTY_DAYS_MS);
      }

      // Final score = TF × importance × recency
      const finalScore = tfScore * importanceBoost * recencyBoost;
      entityScores.set(entityName, finalScore);
    });

    // Get entities sorted by final relevance score and limited to top k
    const rankedEntityNames = Array.from(entityScores.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by score descending
      .slice(0, SEARCH_TOP_K)      // Limit to top k results
      .map(([name]) => name);

    // Retrieve entity objects using hash index (O(1) per entity)
    const filteredEntities = rankedEntityNames
      .map(name => this.entityIndex.get(name))
      .filter((e): e is Entity => e !== undefined);

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(rankedEntityNames);

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    return filteredGraph;
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();

    // Use hash index for O(1) lookup per entity instead of O(n) filter
    const filteredEntities = names
      .map(name => this.entityIndex.get(name))
      .filter((e): e is Entity => e !== undefined);

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    return filteredGraph;
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
        description: "Create multiple new entities in the knowledge graph",
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
        description: "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
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
        description: "Add new observations to existing entities in the knowledge graph",
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
        description: "Search for nodes in the knowledge graph based on a query",
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
        description: "Open specific nodes in the knowledge graph by their names",
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
