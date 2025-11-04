# Data Directory

This directory contains your MCP memory server's persistent storage.

**File**: `memory.jsonl`  
**Format**: JSONL (JSON Lines) - one JSON object per line

## What's Stored Here

- **Entities**: Concepts, projects, tools, features, patterns
- **Relations**: Connections between entities
- **Observations**: Facts and knowledge about entities
- **Timestamps**: Creation and update times

## Backup

It's recommended to backup this file regularly:

```bash
# Backup
cp data/memory.jsonl data/memory.jsonl.backup

# Or with timestamp
cp data/memory.jsonl data/memory.jsonl.$(date +%Y%m%d_%H%M%S)
```

## Migration

If moving from another MCP memory server installation:

```bash
# Copy your existing memory file
cp ~/.claude/memory.jsonl data/memory.jsonl

# Or from another location
cp /path/to/old/memory.jsonl data/memory.jsonl

# Restart the container
docker compose restart
```

## Troubleshooting

**File permissions issues:**
```bash
sudo chown $USER:$USER data/memory.jsonl
```

**Corrupted file:**
The server will create a new empty file if the current one is corrupted.
Restore from backup if needed.

## Note

This directory is gitignored - your personal data will never be committed to version control.
