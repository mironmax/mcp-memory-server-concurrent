# MCP Memory Server - Concurrent Edition

High-performance MCP memory server with concurrent access support, inverted index search, per-token semantic matching, and Steiner Tree path-finding for intelligent context discovery.

## Key Features

- **Concurrent Access**: Safe multi-agent access via file locking
- **Fast Search**: Inverted index with O(t×log m) complexity
- **Smart Ranking**: TF × importance × recency scoring
- **Context Discovery**: Steiner Tree path-finding between concepts
- **Temporal Tracking**: Entity timestamps for recency-based ranking
- **Dockerized**: Persistent storage with volume mounts

## Quick Start

```bash
# Build and start
docker compose up -d --build

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
      "args": ["exec", "-i", "mcp-memory-server", "node", "dist/index.js"]
    }
  }
}
```

**After updating, restart Claude Code.**

## What This Memory Layer Does

This MCP server provides **interconnectedness** for Claude Code across:

- **Separate Sessions**: Claude remembers context from previous conversations
- **Multiple Projects**: Knowledge from one project informs work on others
- **Work Stages**: Track what's done, in progress, blocked, or planned
- **Patterns & Learning**: Capture and reuse architectural patterns, workflows, and solutions

Think of it as a **knowledge graph** that connects concepts, projects, tools, and decisions. Instead of starting fresh each session, Claude can:

1. **Retrieve relevant context** at the start of each interaction
2. **Discover connections** between seemingly unrelated concepts
3. **Learn from past work** and apply patterns to new situations
4. **Track project evolution** over time

### Example Use Case

You're debugging an OAuth flow. Memory helps Claude:
- Find the entity `oauth-token-handling` from a previous project
- Discover it's connected to `n8n-workflow` and `zoom-api-integration`
- Surface relevant observations like "Token refresh fails after 1 hour"
- Apply the solution pattern to your current debugging session

Without memory, each session starts from zero. With memory, Claude builds on accumulated knowledge.

## Guiding Claude's Memory Usage

Create a `.claude/CLAUDE.md` file in your project (or globally at `~/.claude/CLAUDE.md`) to instruct Claude on how to use memory effectively:

### Minimal Template

```markdown
# Memory Usage

For each interaction:

1. **Start by searching memory** for relevant context about the current project/task
2. **Capture new knowledge** as you work:
   - Create entities for: projects, tools, patterns, features, bugs, decisions
   - Use relations to connect them: uses, depends_on, implements, solves
   - Store facts as observations (what works, what doesn't, why decisions were made)
3. **Update progress** after completing tasks

## Project Context

- Project: [Your project name]
- Tech stack: [Main technologies]
- Current focus: [What you're working on]
```

### Advanced Template

For more sophisticated memory usage, see the comprehensive template with relation types and patterns in the repository's `CLAUDE.md.example` file.

### Why This Matters

- **Search quality**: Claude uses your project terminology in memory queries
- **Knowledge capture**: Defines what information is worth remembering
- **Cross-session continuity**: Ensures context carries between conversations
- **Pattern reuse**: Helps Claude apply solutions from past work

**Pro tip**: Start minimal, evolve as you discover what knowledge is most valuable to capture.

## Container Management

```bash
# Start
docker compose up -d

# Stop
docker compose down

# Restart
docker compose restart

# Rebuild after code changes
docker compose up -d --build

# View logs
docker logs -f mcp-memory-server
```

## Configuration

Environment variables in `.env` file:

### Storage Configuration
- `DATA_DIR`: Host directory for persistent storage (default: `./data`)
  - Maps to `/app/data` in container
  - Contains `memory.jsonl` file

### Search Configuration
- `SEARCH_TOP_PER_TOKEN`: Entities per query term (default: `1`)
  - Ensures semantic diversity
  - Range: 1-5 recommended

- `SEARCH_MIN_RELATIVE_SCORE`: Relative score threshold 0.0-1.0 (default: `0.3`)
  - Filters weak matches
  - 0.3 = keep entities scoring ≥30% of top match

- `SEARCH_MAX_PATH_LENGTH`: Maximum hops for path-finding (default: `5`)
  - Controls connection depth
  - Range: 1-10 recommended

- `SEARCH_MAX_TOTAL_NODES`: Maximum nodes in result (default: `50`)
  - Safety cap for result size
  - Range: 10-100 recommended

See `example.env` for detailed explanations.

## Concurrent Access

All mutation operations are protected by file locking:
- **Lock strategy**: Cooperative file locking via `proper-lockfile`
- **Stale timeout**: 10 seconds
- **Retry logic**: 5 attempts with exponential backoff (100ms-2s)
- **Atomic writes**: Temp file + rename pattern
- **Read operations**: Lock-free (eventual consistency)

This allows multiple agents to safely create entities, relations, and observations simultaneously without race conditions or data corruption.

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
docker compose restart
```

## How It Works

### Tokenization
Splits queries into words: `"docker mcp memory"` → `["docker", "mcp", "memory"]`

### Inverted Index
Maps terms to entities: `{docker: [entity1, entity2], mcp: [entity1, entity3]}`

### Relevance Scoring
```
TF (sublinear): 1 + log(1 + frequency)
Importance: log(observations + 1) × (1 + log(1 + degree))
Recency: exp(-age / 30 days)
Final score = TF × Importance × Recency
```

**Scoring rationale:**
- Sublinear TF prevents dominance by entities with many mentions
- Importance combines content richness (observations) and connectedness (degree)
- Recency gives recent entities a boost without overwhelming other factors

### Search Process (Two-Phase)

**Phase 1: Per-Token Entry Selection**
1. Tokenize query into terms (e.g., "zoom oauth timeline" → [zoom, oauth, timeline])
2. For each token, find matching entities via inverted index O(t×log m)
3. Score each entity: `TF × importance × recency`
4. Apply relative threshold: keep entities scoring ≥ X% of best match per token
5. Select top-N entities per token (deduplicated across tokens)
6. Result: diverse entry nodes representing each semantic concept

**Phase 2: Steiner Tree Approximation**
1. Find shortest paths between all pairs of entry nodes (BFS, max path length)
2. Union all paths to form minimal connecting subgraph (2-approximation)
3. Include only nodes on connection paths (not full neighborhoods)
4. Apply total node limit (prioritize entry nodes if exceeded)
5. Filter relations to only those between final nodes
6. Return knowledge graph with connecting context

**Why This Works**: Per-token selection ensures each query concept is represented. Steiner Tree finds minimal paths connecting these concepts, surfacing relevant intermediate context without neighborhood explosion.

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Search complexity | O(t×log m) + O(V+E) |
| Lock acquisition | 1-5ms (uncontended) |
| Lock retry | Up to 5 attempts |
| Stale timeout | 10 seconds |
| Read operations | Lock-free |
| Write operations | Serialized |

## Known Limitations

⚠️ **Hyphenated compounds**: "docker-compose" won't match "docker"
- **Workaround**: Include both terms in query: "docker compose"

⚠️ **Synonyms**: "container" won't find "docker"
- **Workaround**: Use known exact terms from observations

⚠️ **Word variants**: "containerization" won't match "containerize"
- **Workaround**: Try multiple word forms

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
├── index.ts              # MCP server implementation
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript configuration
├── Dockerfile            # Container build
├── docker-compose.yml    # Orchestration
├── data/
│   └── memory.jsonl      # Persistent knowledge graph storage
└── README.md             # This file
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

### Lock contention issues
If you see lock acquisition failures:
- Check `docker logs mcp-memory-server` for stale lock warnings
- Increase retry count in `index.ts` if needed
- Verify no orphaned lock files in `data/` directory

## Contributing

Contributions are welcome! This project aims to provide robust, concurrent memory for Claude Code.

**Areas for Contribution:**

- **Performance**: Optimize search algorithms, add caching strategies
- **Features**: Synonym expansion, stemming, fuzzy matching
- **Testing**: Concurrent stress tests, edge case coverage
- **Documentation**: Use cases, best practices, tutorials
- **Integrations**: Export/import formats, visualization tools

**How to Contribute:**

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes with clear commit messages
4. Test thoroughly (especially concurrent access scenarios)
5. Submit a pull request with description of changes

**Discussion & Feedback:**

- Open an issue for bugs, feature requests, or questions
- Share your CLAUDE.md patterns and memory strategies
- Report performance benchmarks and optimization ideas

## License

MIT

## Technical Details

**Package**: `mcp-memory-server-concurrent` v1.0.0

**Based on**: Original MCP memory server from Anthropic

**Enhancements**:
- Concurrent access support via file locking
- Inverted index search (10-500x performance improvement)
- Tokenization (word order independence)
- Per-token semantic matching (ensures diversity)
- Sublinear TF scoring (prevents super-entity dominance)
- Connectedness ranking (graph degree in importance)
- Relative score thresholding (adaptive filtering)
- Temporal tracking (entity timestamps)
- Steiner Tree path-finding (minimal connecting subgraph)
- Atomic write pattern (temp file + rename)
