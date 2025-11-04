# Data Directory

This directory contains your MCP memory server's persistent storage and backups.

**Storage File**: `memory.jsonl`
**Format**: JSONL (JSON Lines) - one JSON object per line
**Backup Location**: `backups/` subdirectory

## What's Stored Here

### memory.jsonl
Your knowledge graph containing:
- **Entities**: Concepts, projects, tools, features, patterns
- **Relations**: Connections between entities
- **Observations**: Facts and knowledge about entities
- **Timestamps**: Creation and update times

### backups/ Directory
Automated backup hierarchy:
```
backups/
├── daily/              # Last 7 days
├── weekly/             # Last 4 weeks (promoted from 7-day-old daily)
├── monthly/            # Last 12 months (promoted from 28-day-old weekly)
└── yearly/             # Forever (promoted from 365-day-old monthly)
```

## Intelligent Backup System

The repository includes an automated backup rotation script with **grandfather-father-son** strategy.

### Quick Start

```bash
# Manual backup with automatic rotation
./backup-memory.sh backup

# Check backup status
./backup-memory.sh status

# List all available backups
./backup-memory.sh list

# Restore from specific backup
./backup-memory.sh restore data/backups/daily/memory_20251104_030000.jsonl.gz
```

### Backup Retention Policy

| Tier    | Retention | Promotion Rule              |
|---------|-----------|----------------------------|
| Daily   | 7 days    | Age ≥ 7 days → Weekly      |
| Weekly  | 4 weeks   | Age ≥ 28 days → Monthly    |
| Monthly | 12 months | Age ≥ 365 days → Yearly    |
| Yearly  | Forever   | Never deleted              |

**How Promotion Works**: The oldest backup in each tier is automatically promoted to the next tier when it reaches the age threshold. This ensures you maintain recent granular backups and long-term yearly archives without manual intervention.

### Setup Automatic Daily Backups

Run backups automatically every day at 3 AM:

```bash
# Install systemd timer
sudo cp mcp-memory-backup.service mcp-memory-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mcp-memory-backup.timer

# Verify timer is active
systemctl status mcp-memory-backup.timer
systemctl list-timers mcp-memory-backup.timer

# View backup logs
journalctl -u mcp-memory-backup.service -n 50
```

### Manual Backup (Simple)

For quick one-time backups without rotation:

```bash
# Backup with timestamp
cp data/memory.jsonl data/memory.jsonl.$(date +%Y%m%d_%H%M%S)

# These will be automatically ignored by git
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

## Restore Examples

### Restore from yesterday
```bash
./backup-memory.sh list  # Find the backup file
./backup-memory.sh restore data/backups/daily/memory_20251103_030000.jsonl.gz
```

### Restore from 2 weeks ago
```bash
./backup-memory.sh restore data/backups/weekly/memory_20251021_030000.jsonl.gz
```

### Restore from 6 months ago
```bash
./backup-memory.sh restore data/backups/monthly/memory_20250504_030000.jsonl.gz
```

### Emergency restore (manual)
```bash
# If backup script isn't working, restore manually
gzip -dc data/backups/daily/memory_YYYYMMDD_HHMMSS.jsonl.gz > data/memory.jsonl
docker compose restart
```

## Monitoring Backups

```bash
# Check backup status
./backup-memory.sh status

# Output example:
# === Backup Status ===
#   Daily:   7/7
#   Weekly:  4/4
#   Monthly: 12/12
#   Yearly:  2 (kept forever)
#   Total size: 45M
```

## Troubleshooting

### File permissions issues
```bash
sudo chown $USER:$USER data/memory.jsonl
```

### Corrupted file
The server will create a new empty file if the current one is corrupted.
Restore from backup if needed.

### Backups not running (systemd timer)
```bash
# Check timer status
systemctl status mcp-memory-backup.timer

# Check if timer is enabled
systemctl is-enabled mcp-memory-backup.timer

# Manually trigger backup
sudo systemctl start mcp-memory-backup.service

# Check logs for errors
journalctl -u mcp-memory-backup.service -n 50
```

### Disk space issues
```bash
# Check backup size
du -sh data/backups/

# Reduce retention if needed (edit ../backup-memory.sh)
# Then re-run rotation
./backup-memory.sh backup
```

## Advanced Configuration

Edit `../backup-memory.sh` to customize retention:

```bash
DAILY_KEEP=7        # Keep 7 daily backups (default)
WEEKLY_KEEP=4       # Keep 4 weekly backups (default)
MONTHLY_KEEP=12     # Keep 12 monthly backups (default)
# Yearly backups kept forever
```

## Complete Documentation

For comprehensive backup documentation including:
- Detailed installation instructions
- Alternative installation methods (cron)
- Testing procedures
- Best practices

See [../BACKUP.md](../BACKUP.md)

## Security & Privacy

- ✅ This entire directory is **gitignored**
- ✅ Your personal data will **never** be committed to version control
- ✅ Backups are stored locally only
- ✅ All `.jsonl`, `.jsonl.backup`, and timestamp backups are ignored by git
