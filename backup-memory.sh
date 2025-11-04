#!/bin/bash
set -euo pipefail

# MCP Memory Server - Intelligent Backup Rotation Script
# Implements grandfather-father-son backup strategy:
# - Daily backups: Keep last 7 days
# - Weekly backups: Keep 4 weeks (oldest daily becomes weekly)
# - Monthly backups: Keep 12 months (oldest weekly becomes monthly)
# - Yearly backups: Keep forever (oldest monthly becomes yearly)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"
BACKUP_DIR="${DATA_DIR}/backups"
MEMORY_FILE="${DATA_DIR}/memory.jsonl"

# Backup retention configuration
DAILY_KEEP=7        # Keep 7 daily backups
WEEKLY_KEEP=4       # Keep 4 weekly backups (4 weeks)
MONTHLY_KEEP=12     # Keep 12 monthly backups (1 year)
# Yearly backups kept forever

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

# Create backup directory structure
init_backup_dirs() {
    mkdir -p "${BACKUP_DIR}"/{daily,weekly,monthly,yearly}
    log "Backup directories initialized"
}

# Create compressed backup
create_backup() {
    if [[ ! -f "${MEMORY_FILE}" ]]; then
        error "Memory file not found: ${MEMORY_FILE}"
        exit 1
    fi

    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local backup_file="${BACKUP_DIR}/daily/memory_${timestamp}.jsonl.gz"

    log "Creating backup: $(basename ${backup_file})"

    # Compress and create backup
    gzip -c "${MEMORY_FILE}" > "${backup_file}"

    # Verify backup integrity
    if gzip -t "${backup_file}" 2>/dev/null; then
        local size=$(du -h "${backup_file}" | cut -f1)
        log "Backup created successfully (${size})"
        echo "${backup_file}"
    else
        error "Backup verification failed"
        rm -f "${backup_file}"
        exit 1
    fi
}

# Get age of backup in days
get_backup_age_days() {
    local backup_file="$1"
    local filename=$(basename "${backup_file}")

    # Extract date from filename: memory_YYYYMMDD_HHMMSS.jsonl.gz
    if [[ ${filename} =~ memory_([0-9]{8})_[0-9]{6}\.jsonl\.gz ]]; then
        local backup_date="${BASH_REMATCH[1]}"
        local backup_epoch=$(date -d "${backup_date}" +%s)
        local now_epoch=$(date +%s)
        local age_seconds=$((now_epoch - backup_epoch))
        local age_days=$((age_seconds / 86400))
        echo ${age_days}
    else
        echo "999999"  # Invalid date, very old
    fi
}

# Promote oldest daily backup to weekly
promote_daily_to_weekly() {
    local oldest_daily=$(ls -t "${BACKUP_DIR}/daily/"*.jsonl.gz 2>/dev/null | tail -1)

    if [[ -n "${oldest_daily}" && -f "${oldest_daily}" ]]; then
        local age=$(get_backup_age_days "${oldest_daily}")

        if [[ ${age} -ge 7 ]]; then
            local filename=$(basename "${oldest_daily}")
            local weekly_file="${BACKUP_DIR}/weekly/${filename}"

            if [[ ! -f "${weekly_file}" ]]; then
                info "Promoting daily backup to weekly: $(basename ${oldest_daily})"
                mv "${oldest_daily}" "${weekly_file}"
                return 0
            fi
        fi
    fi
    return 1
}

# Promote oldest weekly backup to monthly
promote_weekly_to_monthly() {
    local oldest_weekly=$(ls -t "${BACKUP_DIR}/weekly/"*.jsonl.gz 2>/dev/null | tail -1)

    if [[ -n "${oldest_weekly}" && -f "${oldest_weekly}" ]]; then
        local age=$(get_backup_age_days "${oldest_weekly}")

        # Promote to monthly after 4 weeks (28 days)
        if [[ ${age} -ge 28 ]]; then
            local filename=$(basename "${oldest_weekly}")
            local monthly_file="${BACKUP_DIR}/monthly/${filename}"

            if [[ ! -f "${monthly_file}" ]]; then
                info "Promoting weekly backup to monthly: $(basename ${oldest_weekly})"
                mv "${oldest_weekly}" "${monthly_file}"
                return 0
            fi
        fi
    fi
    return 1
}

# Promote oldest monthly backup to yearly
promote_monthly_to_yearly() {
    local oldest_monthly=$(ls -t "${BACKUP_DIR}/monthly/"*.jsonl.gz 2>/dev/null | tail -1)

    if [[ -n "${oldest_monthly}" && -f "${oldest_monthly}" ]]; then
        local age=$(get_backup_age_days "${oldest_monthly}")

        # Promote to yearly after 12 months (365 days)
        if [[ ${age} -ge 365 ]]; then
            local filename=$(basename "${oldest_monthly}")
            local yearly_file="${BACKUP_DIR}/yearly/${filename}"

            if [[ ! -f "${yearly_file}" ]]; then
                info "Promoting monthly backup to yearly: $(basename ${oldest_monthly})"
                mv "${oldest_monthly}" "${yearly_file}"
                return 0
            fi
        fi
    fi
    return 1
}

# Rotate backups according to retention policy
rotate_backups() {
    log "Starting backup rotation"

    # Promote backups up the chain (must go from top to bottom)
    promote_monthly_to_yearly
    promote_weekly_to_monthly
    promote_daily_to_weekly

    # Clean up excess daily backups (keep only DAILY_KEEP)
    local daily_count=$(ls -1 "${BACKUP_DIR}/daily/"*.jsonl.gz 2>/dev/null | wc -l)
    if [[ ${daily_count} -gt ${DAILY_KEEP} ]]; then
        local to_delete=$((daily_count - DAILY_KEEP))
        info "Removing ${to_delete} old daily backup(s)"
        ls -t "${BACKUP_DIR}/daily/"*.jsonl.gz | tail -${to_delete} | xargs rm -f
    fi

    # Clean up excess weekly backups
    local weekly_count=$(ls -1 "${BACKUP_DIR}/weekly/"*.jsonl.gz 2>/dev/null | wc -l)
    if [[ ${weekly_count} -gt ${WEEKLY_KEEP} ]]; then
        local to_delete=$((weekly_count - WEEKLY_KEEP))
        info "Removing ${to_delete} old weekly backup(s)"
        ls -t "${BACKUP_DIR}/weekly/"*.jsonl.gz | tail -${to_delete} | xargs rm -f
    fi

    # Clean up excess monthly backups
    local monthly_count=$(ls -1 "${BACKUP_DIR}/monthly/"*.jsonl.gz 2>/dev/null | wc -l)
    if [[ ${monthly_count} -gt ${MONTHLY_KEEP} ]]; then
        local to_delete=$((monthly_count - MONTHLY_KEEP))
        info "Removing ${to_delete} old monthly backup(s)"
        ls -t "${BACKUP_DIR}/monthly/"*.jsonl.gz | tail -${to_delete} | xargs rm -f
    fi

    # Yearly backups are kept forever (no cleanup)
}

# Show backup status
show_status() {
    echo ""
    info "=== Backup Status ==="

    local daily_count=$(ls -1 "${BACKUP_DIR}/daily/"*.jsonl.gz 2>/dev/null | wc -l || echo 0)
    local weekly_count=$(ls -1 "${BACKUP_DIR}/weekly/"*.jsonl.gz 2>/dev/null | wc -l || echo 0)
    local monthly_count=$(ls -1 "${BACKUP_DIR}/monthly/"*.jsonl.gz 2>/dev/null | wc -l || echo 0)
    local yearly_count=$(ls -1 "${BACKUP_DIR}/yearly/"*.jsonl.gz 2>/dev/null | wc -l || echo 0)

    echo "  Daily:   ${daily_count}/${DAILY_KEEP}"
    echo "  Weekly:  ${weekly_count}/${WEEKLY_KEEP}"
    echo "  Monthly: ${monthly_count}/${MONTHLY_KEEP}"
    echo "  Yearly:  ${yearly_count} (kept forever)"

    local total_size=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1 || echo "0")
    echo "  Total size: ${total_size}"
    echo ""
}

# Restore from backup
restore_backup() {
    local backup_file="$1"

    if [[ ! -f "${backup_file}" ]]; then
        error "Backup file not found: ${backup_file}"
        exit 1
    fi

    warn "This will overwrite ${MEMORY_FILE}"
    read -p "Continue? (yes/no): " confirm

    if [[ "${confirm}" == "yes" ]]; then
        # Backup current file before restore
        if [[ -f "${MEMORY_FILE}" ]]; then
            local safety_backup="${MEMORY_FILE}.before_restore.$(date +%Y%m%d_%H%M%S)"
            cp "${MEMORY_FILE}" "${safety_backup}"
            info "Current file backed up to: $(basename ${safety_backup})"
        fi

        log "Restoring from: $(basename ${backup_file})"
        gzip -dc "${backup_file}" > "${MEMORY_FILE}"
        log "Restore completed successfully"
    else
        info "Restore cancelled"
    fi
}

# List available backups
list_backups() {
    echo ""
    info "=== Available Backups ==="

    for period in daily weekly monthly yearly; do
        local count=$(ls -1 "${BACKUP_DIR}/${period}/"*.jsonl.gz 2>/dev/null | wc -l)
        count=${count:-0}
        if [[ ${count} -gt 0 ]]; then
            echo ""
            echo -e "${BLUE}${period^} Backups:${NC}"
            ls -lh "${BACKUP_DIR}/${period}/"*.jsonl.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
        fi
    done
    echo ""
}

# Main execution
main() {
    case "${1:-backup}" in
        backup)
            init_backup_dirs
            create_backup
            rotate_backups
            show_status
            ;;

        status)
            show_status
            ;;

        list)
            list_backups
            ;;

        restore)
            if [[ -z "${2:-}" ]]; then
                error "Usage: $0 restore <backup_file>"
                list_backups
                exit 1
            fi
            restore_backup "$2"
            ;;

        *)
            echo "Usage: $0 {backup|status|list|restore <file>}"
            echo ""
            echo "Commands:"
            echo "  backup    Create new backup and rotate old ones (default)"
            echo "  status    Show current backup status"
            echo "  list      List all available backups"
            echo "  restore   Restore from a specific backup file"
            exit 1
            ;;
    esac
}

main "$@"
