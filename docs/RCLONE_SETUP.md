# rclone Integration with ChittyConnect

## Overview

Sync local directories to ChittyConnect R2 storage using rclone for bulk file synchronization. This guide covers setup, workflows, and best practices for keeping files in sync across all channels (web, desktop, mobile).

## Prerequisites

- Active ChittyConnect account with API key
- rclone installed on your system
- Cloudflare R2 credentials (or use ChittyConnect's R2 bucket)

## Installation

### macOS
```bash
brew install rclone
```

### Linux
```bash
curl https://rclone.org/install.sh | sudo bash
```

### Windows
Download from [rclone.org/downloads](https://rclone.org/downloads/)

## Configuration

### 1. Configure R2 Remote

```bash
rclone config
```

Follow the interactive prompts:

```
n) New remote
name> chittyos-data
Storage> s3
provider> Cloudflare
env_auth> false
access_key_id> <CLOUDFLARE_R2_ACCESS_KEY>
secret_access_key> <CLOUDFLARE_R2_SECRET_KEY>
region> auto
endpoint> https://<ACCOUNT_ID>.r2.cloudflarestorage.com
location_constraint>
acl> private
server_side_encryption>
storage_class>
```

**Note**: Get R2 credentials from Cloudflare dashboard or ChittyConnect admin.

### 2. Create Session in ChittyConnect

Get a session ID for tracking your files:

```bash
curl -X POST https://api.chitty.cc/api/v1/sessions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chittyId": "YOUR_CHITTY_ID",
    "sessionId": "my-desktop-session",
    "metadata": {
      "device": "MacBook Pro",
      "purpose": "development"
    }
  }'
```

Save the returned `session_id` for use in sync commands.

### 3. Create Ignore File (Optional)

Create `~/.rcloneignore` to exclude unwanted files:

```bash
# System files
.DS_Store
.Spotlight-V100
.Trashes
Thumbs.db
desktop.ini

# Development
node_modules/
.git/
.venv/
__pycache__/
*.pyc
dist/
build/

# Temporary files
*.tmp
*.temp
*.swp
*.log
```

## Sync Workflows

### Workflow 1: Small Files (< 5MB) - Direct API Upload

For small files, use the API upload endpoint:

```bash
#!/bin/bash
# upload-file.sh

API_KEY="your-api-key"
SESSION_ID="my-desktop-session"
FILE_PATH="$1"
FILE_NAME=$(basename "$FILE_PATH")
SHA256=$(shasum -a 256 "$FILE_PATH" | cut -d' ' -f1)
CONTENT_BASE64=$(base64 < "$FILE_PATH")

curl -X POST https://api.chitty.cc/api/files/upload \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"$SESSION_ID\",
    \"name\": \"$FILE_NAME\",
    \"sha256\": \"$SHA256\",
    \"content_base64\": \"$CONTENT_BASE64\"
  }"
```

### Workflow 2: Bulk Sync - rclone + Sync Report

For large files or directories, use rclone:

#### Step 1: Sync Files to R2

```bash
rclone sync ~/Documents/chittyos-data chittyos-data:files/my-desktop-session \
  --progress \
  --checksum \
  --log-file sync.log \
  --exclude-from ~/.rcloneignore
```

**Options:**
- `--progress`: Show real-time progress
- `--checksum`: Use checksums instead of modtime
- `--log-file`: Save sync log
- `--exclude-from`: Use ignore file
- `--dry-run`: Test without actually syncing

#### Step 2: Report Sync to ChittyConnect

After syncing, notify ChittyConnect to index the files:

```bash
#!/bin/bash
# sync-report.sh

API_KEY="your-api-key"
SESSION_ID="my-desktop-session"

# Parse rclone log to extract file info
# (This is a simplified example - adapt to your needs)
ITEMS=$(jq -n --arg key "files/$SESSION_ID/file1.pdf" --arg sha256 "abc123..." '[{
  "r2_key": $key,
  "sha256": $sha256,
  "size": 52428
}]')

curl -X POST https://api.chitty.cc/api/context/files/sync-report \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"path_prefix\": \"files/$SESSION_ID\",
    \"source\": \"rclone\",
    \"items\": $ITEMS
  }"
```

### Workflow 3: Presigned Upload (Client-Side)

For better performance with large files:

#### Step 1: Request Presigned URL

```bash
PRESIGN_RESPONSE=$(curl -X POST https://api.chitty.cc/api/files/presign \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "document.pdf",
    "size": 52428,
    "mime": "application/pdf",
    "session_id": "my-desktop-session",
    "sha256": "abc123..."
  }')

echo $PRESIGN_RESPONSE
# {"ok":true,"upload_url":"https://api.chitty.cc/api/files/upload/TOKEN","r2_key":"...","expires_in":3600}
```

#### Step 2: Upload File

```bash
UPLOAD_URL=$(echo $PRESIGN_RESPONSE | jq -r '.upload_url')

curl -X PUT "$UPLOAD_URL" \
  --data-binary @document.pdf \
  -H "Content-Type: application/pdf"
```

## Automated Sync Script

Complete script for automated syncing:

```bash
#!/bin/bash
# chitty-sync.sh

set -e

# Configuration
API_KEY="your-api-key"
SESSION_ID="my-desktop-session"
LOCAL_DIR="$HOME/Documents/chittyos-data"
REMOTE_PATH="chittyos-data:files/$SESSION_ID"
LOG_FILE="$HOME/.chitty-sync.log"

echo "[$(date)] Starting ChittyConnect sync..." | tee -a "$LOG_FILE"

# Run rclone sync
rclone sync "$LOCAL_DIR" "$REMOTE_PATH" \
  --progress \
  --checksum \
  --log-file "$LOG_FILE" \
  --exclude-from ~/.rcloneignore

# Extract synced files from log (simplified - adapt to your needs)
# In production, parse the log file to get actual r2_keys and metadata
SYNC_COUNT=$(rclone ls "$REMOTE_PATH" 2>/dev/null | wc -l | xargs)

# Report sync to ChittyConnect
curl -X POST https://api.chitty.cc/api/context/files/sync-report \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"path_prefix\": \"files/$SESSION_ID\",
    \"source\": \"rclone\",
    \"items\": []
  }" >> "$LOG_FILE" 2>&1

echo "[$(date)] Sync complete. $SYNC_COUNT files synced." | tee -a "$LOG_FILE"
```

Make it executable and run:

```bash
chmod +x chitty-sync.sh
./chitty-sync.sh
```

### Cron Job (Automated Sync)

Sync every hour:

```bash
crontab -e
```

Add:

```cron
0 * * * * /path/to/chitty-sync.sh >> /tmp/chitty-sync-cron.log 2>&1
```

## File Indexing & Context Sync

After syncing via rclone, ChittyConnect automatically:

1. **Indexes in D1**: Files are recorded in `context_files` table
2. **Broadcasts via SSE**: All connected clients receive `context.files.synced` event
3. **Updates MemoryCloude™**: File metadata stored for semantic search
4. **Cross-Channel Sync**: Files immediately available in web, desktop, and mobile apps

## Resource URIs

ChittyConnect uses stable resource URIs:

```
resource://connect/{session_id}/{sha256}-{basename}
```

**Example:**
```
resource://connect/my-desktop-session/a1b2c3d4e5f6...-document.pdf
```

These URIs:
- Remain stable across moves/renames
- Support SHA256-based deduplication
- Work across all ChittyConnect channels

## Best Practices

### 1. Use Checksums

Always use `--checksum` for accurate sync:

```bash
rclone sync source dest --checksum
```

### 2. Test with --dry-run

Preview changes before syncing:

```bash
rclone sync source dest --dry-run
```

### 3. Monitor Sync Logs

Review logs regularly:

```bash
tail -f ~/.chitty-sync.log
```

### 4. Organize by Session

Keep files organized by session for better tracking:

```
files/
  ├── my-desktop-session/
  │   ├── 2026/01/04/
  │   │   ├── abc123...-report.pdf
  │   │   └── def456...-invoice.pdf
  ├── my-mobile-session/
  └── my-web-session/
```

### 5. Set Active Files

After syncing, mark important files as active:

```bash
curl -X POST https://api.chitty.cc/api/context/files/set-active \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "my-desktop-session",
    "files": [
      {
        "uri": "r2://files/my-desktop-session/2026/01/04/abc123-report.pdf",
        "name": "Q1-Report.pdf",
        "size": 52428,
        "sha256": "abc123..."
      }
    ]
  }'
```

## Troubleshooting

### Connection Issues

```bash
# Test R2 connection
rclone lsd chittyos-data:

# Check credentials
rclone config show chittyos-data
```

### Sync Failures

```bash
# Verbose logging
rclone sync source dest -vv

# Check bandwidth
rclone sync source dest --bwlimit 10M
```

### Permission Errors

Ensure your R2 credentials have write permissions on the bucket.

## Advanced Usage

### Bidirectional Sync

```bash
# Sync both ways
rclone sync "$LOCAL_DIR" "$REMOTE_PATH"
rclone sync "$REMOTE_PATH" "$LOCAL_DIR"
```

### Encryption

Encrypt files before upload:

```bash
rclone sync source dest --crypt-password YOUR_PASSWORD
```

### Bandwidth Limiting

```bash
rclone sync source dest --bwlimit 1M
```

### Parallel Transfers

```bash
rclone sync source dest --transfers 8
```

## API Reference

### Upload Endpoints

- `POST /api/files/upload` - Direct base64 upload
- `POST /api/files/presign` - Request presigned upload URL
- `PUT /api/files/upload/:token` - Execute presigned upload

### Context Endpoints

- `POST /api/context/files/set-active` - Mark files as active
- `POST /api/context/files/sync-report` - Report bulk sync
- `GET /api/registry/whoami` - Get session info with active files

### SSE Events

- `context.files.uploaded` - File uploaded
- `context.files.synced` - Bulk sync completed
- `context.files.updated` - Active files changed

## Support

- Documentation: https://docs.chitty.cc/rclone
- Issues: https://github.com/chittyos/chittyconnect/issues
- Community: https://community.chitty.cc

---

**Last Updated**: 2026-01-04
**Version**: 1.0.0
