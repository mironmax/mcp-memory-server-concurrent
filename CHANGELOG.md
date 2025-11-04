# Changelog

All notable changes to the MCP Memory Server - Concurrent Edition.

## [1.0.0] - 2025-11-03

### Added - Concurrent Access Support
- **File locking**: Cooperative locking via `proper-lockfile` library
- **withFileLock() wrapper**: All mutation operations protected
- **Atomic writes**: Temp file + rename pattern prevents partial writes
- **Retry logic**: 5 attempts with exponential backoff (100ms-2s)
- **Stale lock detection**: 10s timeout with liveness updates every 5s
- **Lock-free reads**: Read operations don't acquire locks (eventual consistency)

### Added - Advanced Search Features
- **Inverted index search**: O(t×log m) performance vs O(n×k) linear scan
- **Per-token selection**: Each query term gets top-N entity matches
- **Steiner Tree path-finding**: Discovers connecting context between concepts
- **Relevance scoring**: TF × importance × recency ranking
- **Temporal tracking**: Entity-level `created_at` and `updated_at` timestamps
- **Configurable parameters**: SEARCH_TOP_PER_TOKEN, SEARCH_MIN_RELATIVE_SCORE, SEARCH_MAX_PATH_LENGTH, SEARCH_MAX_TOTAL_NODES

### Enhanced
- **Search quality**: Word order independence, multi-word queries, context discovery
- **Performance**: ~10-500x faster search with inverted index
- **Data persistence**: JSONL format with volume mount to `./data/memory.jsonl`
- **Multi-field search**: Searches across entity name, type, and observations
- **Concurrent safety**: Multiple agents can safely access memory simultaneously

### Changed
- **Package name**: `mcp-memory-server-concurrent` (independent package)
- **Version**: Reset to 1.0.0 (no backward compatibility with original)
- **Server name**: `mcp-memory-server-concurrent`
- **Docker deployment**: Isolated container with persistent storage

### Removed
- **Backward compatibility**: No memory.json migration (JSONL only)
- **Original package references**: Severed from @modelcontextprotocol/server-memory-modified

### Testing
- **Concurrent operations**: 2 parallel subagents tested successfully
- **Verified**: 5 entities created, 1 relation, no race conditions
- **Lock performance**: <5ms acquisition time (uncontended)
- **Search verified**: Per-token selection and path-finding working correctly

### Known Limitations
- **Hyphenated compounds**: "docker-compose" won't match "docker"
- **Synonyms**: "container" won't find "docker"
- **Word variants**: "containerization" won't match "containerize"

### Technical Details
- **Code growth**: +60 lines net (594 → 654 lines)
- **Dependencies added**: `proper-lockfile` v4.1.2, `@types/proper-lockfile` v4.1.4
- **Protected operations**: createEntities, createRelations, addObservations, deleteEntities, deleteObservations, deleteRelations
- **Lock strategy**: Exclusive write lock, lock-free reads

## Credits

Based on the original MCP memory server by Anthropic.

Enhanced with:
- Concurrent access support via file locking
- Inverted index search
- Per-token semantic matching
- Steiner Tree path-finding
- Sublinear TF scoring
- Temporal tracking
- Atomic write patterns
