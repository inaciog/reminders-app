#!/bin/sh
# Backup reminders data to Dropbox

DATA_FILE="/data/reminders.json"
BACKUP_DIR="/data/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/reminders_$DATE.json"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Copy current data to backup
cp $DATA_FILE $BACKUP_FILE 2>/dev/null

# Sync to Dropbox using rclone
rclone copy $DATA_FILE dropbox:Apps/reminders-app/ 2>/dev/null
rclone copy $BACKUP_DIR dropbox:Apps/reminders-app/backups/ 2>/dev/null

# Keep only last 180 days of local backups
find $BACKUP_DIR -name "reminders_*.json" -mtime +180 -delete 2>/dev/null

echo "Backup completed: $BACKUP_FILE"
