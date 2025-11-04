# Backup Strategy

Intelligent backup rotation script for MCP Memory Server using the **grandfather-father-son** strategy.

## Backup Rotation Logic

The script implements a hierarchical backup system where old backups are promoted:

```
Daily (7 days) → Weekly (4 weeks) → Monthly (12 months) → Yearly (forever)
```

### How It Works

1. **Daily Backups** (Keep 7):
   - Created every day
   - After 7 days, oldest daily becomes a weekly backup

2. **Weekly Backups** (Keep 4):
   - Promoted from 7-day-old daily backups
   - After 4 weeks (28 days), oldest weekly becomes monthly

3. **Monthly Backups** (Keep 12):
   - Promoted from 28-day-old weekly backups
   - After 12 months (365 days), oldest monthly becomes yearly

4. **Yearly Backups** (Forever):
   - Promoted from 365-day-old monthly backups
   - Never deleted - permanent archive

### Example Timeline

```
Day 1:  Create daily backup #1
Day 7:  Create daily #7
Day 8:  Create daily #8, daily #1 → weekly #1
Day 35: Weekly #1 (age 28d) → monthly #1
Day 365: Monthly #1 (age 365d) → yearly #1
```

## Installation

### Option 1: Systemd Timer (Recommended)

Automatic daily backups at 3 AM:

```bash
# Copy systemd files
sudo cp mcp-memory-backup.service /etc/systemd/system/
sudo cp mcp-memory-backup.timer /etc/systemd/system/

# Enable and start timer
sudo systemctl daemon-reload
sudo systemctl enable mcp-memory-backup.timer
sudo systemctl start mcp-memory-backup.timer

# Check timer status
sudo systemctl status mcp-memory-backup.timer
systemctl list-timers mcp-memory-backup.timer
```

### Option 2: Cron Job

```bash
# Edit crontab
crontab -e

# Add daily backup at 3 AM
0 3 * * * /home/maxim/DevProj/mcp-memory-server/backup-memory.sh backup
```

## Manual Usage

```bash
# Create backup and rotate old ones
./backup-memory.sh backup

# Show backup status
./backup-memory.sh status

# List all backups
./backup-memory.sh list

# Restore from backup
./backup-memory.sh restore data/backups/daily/memory_20251104_030000.jsonl.gz
```

## Backup Storage Structure

```
data/backups/
├── daily/              # Last 7 days
│   ├── memory_20251104_030000.jsonl.gz
│   ├── memory_20251103_030000.jsonl.gz
│   └── ...
├── weekly/             # Last 4 weeks
│   ├── memory_20251028_030000.jsonl.gz
│   └── ...
├── monthly/            # Last 12 months
│   ├── memory_20251001_030000.jsonl.gz
│   └── ...
└── yearly/             # Forever
    ├── memory_20240104_030000.jsonl.gz
    └── ...
```

## Features

- ✅ **Compressed backups**: gzip compression saves space
- ✅ **Integrity verification**: Each backup is verified after creation
- ✅ **Intelligent rotation**: Automatic promotion through retention tiers
- ✅ **Safe restore**: Creates safety backup before restoring
- ✅ **Detailed logging**: Color-coded output with timestamps
- ✅ **Zero data loss**: Yearly backups kept forever

## Configuration

Edit `backup-memory.sh` to customize retention:

```bash
DAILY_KEEP=7        # Keep 7 daily backups
WEEKLY_KEEP=4       # Keep 4 weekly backups
MONTHLY_KEEP=12     # Keep 12 monthly backups
# Yearly backups kept forever
```

## Monitoring

### Check backup status
```bash
./backup-memory.sh status
```

Output:
```
=== Backup Status ===
  Daily:   7/7
  Weekly:  4/4
  Monthly: 12/12
  Yearly:  2 (kept forever)
  Total size: 45M
```

### View systemd logs
```bash
# Recent backup logs
journalctl -u mcp-memory-backup.service -n 50

# Follow logs in real-time
journalctl -u mcp-memory-backup.service -f

# Today's backup logs
journalctl -u mcp-memory-backup.service --since today
```

## Restore Examples

### Restore from specific backup
```bash
# List available backups
./backup-memory.sh list

# Restore from yesterday's backup
./backup-memory.sh restore data/backups/daily/memory_20251103_030000.jsonl.gz

# Restore from 2 weeks ago
./backup-memory.sh restore data/backups/weekly/memory_20251021_030000.jsonl.gz
```

### Emergency restore from different location
```bash
# If backup directory is lost, but you have a copy elsewhere
gzip -dc /path/to/backup.jsonl.gz > data/memory.jsonl
docker compose restart
```

## Troubleshooting

### Backups not running
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

### Permission issues
```bash
# Ensure script is executable
chmod +x backup-memory.sh

# Ensure backup directory is writable
chmod 755 data/backups
```

### Disk space issues
```bash
# Check backup directory size
du -sh data/backups/

# Reduce retention if needed (edit backup-memory.sh)
DAILY_KEEP=5
WEEKLY_KEEP=3
MONTHLY_KEEP=6

# Then run rotation
./backup-memory.sh backup
```

## Best Practices

1. **Test restores regularly**: Verify backups can be restored
2. **Monitor disk usage**: Ensure backups don't fill disk
3. **Off-site backups**: Copy yearly backups to external storage
4. **Document retention**: Adjust retention based on your needs
5. **Alert on failures**: Monitor systemd service status

## Testing

### Test backup creation
```bash
# Create initial backup
./backup-memory.sh backup

# Verify backup exists
ls -lh data/backups/daily/
```

### Test rotation
```bash
# Create multiple backups (simulate days passing)
for i in {1..10}; do
    ./backup-memory.sh backup
    sleep 2
done

# Check rotation happened
./backup-memory.sh status
```

### Test restore
```bash
# Create test backup
./backup-memory.sh backup

# Modify memory file
echo "test" >> data/memory.jsonl

# Restore from backup
./backup-memory.sh restore data/backups/daily/memory_YYYYMMDD_HHMMSS.jsonl.gz

# Verify restoration
cat data/memory.jsonl
```

## Uninstallation

### Remove systemd timer
```bash
sudo systemctl stop mcp-memory-backup.timer
sudo systemctl disable mcp-memory-backup.timer
sudo rm /etc/systemd/system/mcp-memory-backup.{service,timer}
sudo systemctl daemon-reload
```

### Remove cron job
```bash
crontab -e
# Delete the backup line
```

### Keep or remove backups
```bash
# Keep backups (just disable automation)
# Backups remain in data/backups/

# Or remove all backups
rm -rf data/backups/
```
