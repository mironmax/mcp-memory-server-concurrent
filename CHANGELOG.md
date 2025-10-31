# Changelog

All notable changes to the Enhanced MCP Memory Server.

## [1.0.0] - 2025-10-23

### Added
- **Inverted index search**: O(t×log m) performance vs O(n×k) linear scan
- **Tokenized search**: Splits queries into words, matches independently
- **Relevance scoring**: TF × importance × recency ranking
- **Temporal tracking**: Entity-level `created_at` and `updated_at` timestamps
- **Docker containerization**: Isolated deployment with volume persistence
- **Configurable search threshold**: `SEARCH_MIN_TOKEN_MATCH` environment variable (default: 0.65)

### Enhanced
- **Search quality**: Word order independence, multi-word queries, partial matching
- **Performance**: ~10-500x faster search with inverted index
- **Data persistence**: JSONL format with explicit volume mount to `./data/memory.jsonl`
- **Multi-field search**: Searches across entity name, type, and observations

### Migration
- Migrated from NPX-based deployment to Docker container
- Data migrated from `~/.claude/memory.jsonl` (57KB, 180 entities)
- Updated Claude Code configuration to use Docker exec transport

### Testing
- **Completed**: All 8 post-deployment tests passed
- **Verified**: Search enhancement, data migration, word order independence, partial matching, multi-field search, relevance ranking, performance (<1s), write operations with timestamps

### Known Limitations
- **Hyphenated compounds**: "docker-compose" won't match "docker" query (fixable)
- **Synonyms**: "container" won't find "docker" (requires synonym expansion)
- **Word variants**: "containerization" won't match "containerize" (requires stemming)

### Breaking Changes
- Configuration change required in `~/.claude.json`:
  - Old: `npx -y @modelcontextprotocol/server-memory`
  - New: `docker exec -i mcp-memory-server node dist/index.js`
- Data location changed:
  - Old: `~/.claude/memory.jsonl`
  - New: `~/DevProj/mcp-memory-server/data/memory.jsonl`

### Credits
Based on: https://github.com/modelcontextprotocol/servers/tree/main/src/memory
Enhanced with inverted index search, tokenization, and temporal scoring.
