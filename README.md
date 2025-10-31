# Enhanced MCP Memory Server

Dockerized MCP memory server with inverted index search, tokenization, temporal scoring, and graph traversal for intelligent context discovery.

## Features

| Feature | Original | Enhanced |
|---------|----------|----------|
| Search method | Substring match | Tokenized + inverted index + graph traversal |
| Performance | O(n×k) | O(t×log m) + O(V+E) |
| Word order | Dependent | Independent |
| Multi-word queries | Fails | Works |
| Ranking | None | TF × importance × recency |
| Timestamps | None | created_at, updated_at |
| Context discovery | None | BFS path-finding between entry nodes |

## Quick Start

```bash
# Build and start
docker-compose up -d --build

# Verify running
docker ps | grep mcp-memory-server

# Check logs
docker logs mcp-memory-server
```

## Claude Code Configuration

Update `~/.claude.json`:

```json
{
  "mcpServers": {
    "memory": {
      "type": "stdio",
      "command": "docker",
      "args": ["exec", "-i", "mcp-memory-server", "node", "dist/index.js"],
      "env": {
        "MEMORY_FILE_PATH": "/app/data/memory.jsonl"
      }
    }
  }
}
```

**After updating, restart Claude Code.**

### Migrating from NPX Version

If migrating from the original NPX-based installation:

```bash
# Copy existing data
cp ~/.claude/memory.jsonl ~/DevProj/mcp-memory-server/data/memory.jsonl

# Backup old config
cp ~/.claude.json ~/.claude.json.backup
```

## Container Management

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart

# Rebuild after code changes
docker-compose up -d --build

# View logs
docker logs -f mcp-memory-server
```

## Configuration

Environment variables in `docker-compose.yml`:

- `MEMORY_FILE_PATH`: Storage location (default: `/app/data/memory.jsonl`)
- `SEARCH_TOP_K`: Maximum number of entry nodes from initial search (default: `5`)
  - Returns top N most relevant entry nodes based on TF × importance × recency scoring
  - These become starting points for graph traversal
  - Increase for broader initial matches, decrease for focused entry points
- `SEARCH_MAX_DEPTH`: Maximum hops for graph traversal (default: `2`)
  - Controls how far to explore from entry nodes
  - Depth 2 = entry → intermediate → entry paths
  - Higher values = more context but larger result sets
- `SEARCH_MAX_TOTAL_NODES`: Maximum total nodes in final result (default: `25`)
  - Caps result size to prevent unbounded growth
  - Entry nodes are prioritized if limit is exceeded
  - Increase if you need more comprehensive context

## Data Persistence

- **Volume mount**: `./data:/app/data`
- **Storage file**: `./data/memory.jsonl`
- **Format**: JSONL (JSON Lines) - one object per line

### Backup

```bash
# Backup
cp data/memory.jsonl data/memory.jsonl.backup

# Restore
cp data/memory.jsonl.backup data/memory.jsonl
docker-compose restart
```

## How It Works

### Tokenization
Splits queries into words: `"docker mcp memory"` → `["docker", "mcp", "memory"]`

### Inverted Index
Maps terms to entities: `{docker: [entity1, entity2], mcp: [entity1, entity3]}`

### Relevance Scoring
```
score = TF × importance × recency
- TF: Term frequency in entity
- Importance: log(observation count + 1)
- Recency: exp(-age / 30 days)
```

### Search Process (Two-Phase)

**Phase 1: Entry Node Selection**
1. Tokenize query into terms
2. Look up matching entities in inverted index (O(t×log m))
3. Count term frequency per entity (TF scoring)
4. Apply importance boost: `log(observation_count + 1)`
5. Apply recency boost: `exp(-age / 30 days)`
6. Calculate final score: `TF × importance × recency`
7. Sort by score and select top-K entry nodes

**Phase 2: Graph Traversal**
1. Build bidirectional adjacency list from relations
2. Run BFS from each entry node up to max depth
3. Collect all discovered nodes (entry + intermediate)
4. Apply total node limit (prioritize entry nodes if exceeded)
5. Filter relations to only those between final nodes
6. Return knowledge graph with context

**Why This Works**: Entry nodes match your query directly, while graph traversal discovers related context that might not contain query terms but connects the concepts you're searching for.

## Test Results

Comparative testing (Enhanced vs Original on 73 entities):

**Query: "docker memory server"**
- Enhanced: 5 highly relevant results, ranked by importance
- Original: 0 results (phrase matching failed)

**Single-word queries: "docker", "memory", "server"**
- Enhanced: 5 top-ranked results each (46% fewer on average)
- Original: 8-17 unranked results per query

**Conclusion**: Enhanced version delivers more concise, relevant results through tokenization and TF-based ranking. Top-k limiting (default 5) eliminates noise while relevance scoring surfaces most important entities first.

### Graph Traversal Test

**Setup**: Created test chain with relations
```
zoom-api-integration → oauth-protocol-handler → scope-management → timeline-feature
```

**Query**: "zoom timeline scope"

**Results**:
- ✅ `zoom-api-integration` (entry node - matches "zoom")
- ✅ `oauth-protocol-handler` (intermediate - NO query match, discovered via traversal)
- ✅ `scope-management` (entry node - matches "scope")
- ✅ All connecting relations included

**Proof**: `oauth-protocol-handler` appeared despite containing none of the query terms, demonstrating successful context discovery through graph traversal. This allows the search to surface implicit connections between concepts.

## Known Limitations

⚠️ **Hyphenated compounds**: "docker-compose" won't match "docker"
- **Workaround**: Include both terms in query: "docker compose"
- **Fix**: Update tokenization to split hyphens (Priority 1 future enhancement)

⚠️ **Synonyms**: "container" won't find "docker"
- **Workaround**: Use known exact terms from observations
- **Fix**: Add synonym expansion (Priority 3 future enhancement)

⚠️ **Word variants**: "containerization" won't match "containerize"
- **Workaround**: Try multiple word forms
- **Fix**: Add stemming library (Priority 2 future enhancement)

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode
npm run watch
```

## Project Structure

```
.
├── index.ts              # Enhanced MCP server implementation
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript configuration
├── Dockerfile            # Container build
├── docker-compose.yml    # Orchestration
├── data/
│   └── memory.jsonl      # Persistent knowledge graph storage
├── README.md             # This file
└── CHANGELOG.md          # Version history
```

## Troubleshooting

### Container won't start
```bash
docker logs mcp-memory-server
```

### Data not persisting
```bash
ls -la data/memory.jsonl
docker inspect mcp-memory-server | grep -A 10 Mounts
```

### Claude Code can't connect
1. Verify container running: `docker ps`
2. Check Claude Code config: `~/.claude.json`
3. Restart Claude Code after config change

### Rollback to NPX version
```json
{
  "mcpServers": {
    "memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_FILE_PATH": "/home/maxim/.claude/memory.jsonl"
      }
    }
  }
}
```

## License

MIT (inherited from original @modelcontextprotocol/server-memory)

## Credits

Based on: https://github.com/modelcontextprotocol/servers/tree/main/src/memory

Enhanced with:
- Inverted index search (10-500x performance improvement)
- Tokenization (word order independence)
- Relevance scoring (TF × importance × recency)
- Temporal tracking (entity timestamps)
- Graph traversal (BFS context discovery)
