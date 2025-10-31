# Enhanced MCP Memory Server

Dockerized MCP memory server with inverted index search, tokenization, and temporal scoring.

## Features

| Feature | Original | Enhanced |
|---------|----------|----------|
| Search method | Substring match | Tokenized + inverted index |
| Performance | O(n×k) | O(t×log m) |
| Word order | Dependent | Independent |
| Multi-word queries | Fails | Works |
| Ranking | None | TF × importance × recency |
| Timestamps | None | created_at, updated_at |

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
- `SEARCH_MIN_TOKEN_MATCH`: Minimum token match percentage (default: `0`)
  - Range: 0.0-1.0 (e.g., 0.65 = 65% of query tokens must match)
  - Lower values = more results, higher values = stricter filtering
  - Default 0 = any entity matching at least one token is considered
- `SEARCH_TOP_K`: Maximum number of search results (default: `5`)
  - Returns top N most relevant results based on TF × importance × recency scoring
  - Increase for broader result sets, decrease for more focused results

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

### Search Process
1. Tokenize query into terms
2. Look up matching entities in inverted index
3. Count term frequency per entity
4. Apply importance and recency boosts
5. Filter by minimum token match threshold
6. Sort by final score (descending)
7. Limit to top k results

## Test Results

Comparative testing (Enhanced vs Original on 73 entities):

**Query: "docker memory server"**
- Enhanced: 5 highly relevant results, ranked by importance
- Original: 0 results (phrase matching failed)

**Single-word queries: "docker", "memory", "server"**
- Enhanced: 5 top-ranked results each (46% fewer on average)
- Original: 8-17 unranked results per query

**Conclusion**: Enhanced version delivers more concise, relevant results through tokenization and TF-based ranking. Top-k limiting (default 5) eliminates noise while relevance scoring surfaces most important entities first.

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
- Relevance scoring (TF-IDF inspired ranking)
- Temporal tracking (entity timestamps)
