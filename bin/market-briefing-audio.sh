#!/bin/bash
# market-briefing-audio — Generate spoken audio + upload to Mattermost
# Usage: bash bin/market-briefing-audio.sh <spoken_script.txt> <output_prefix> [channel_id]
#
# Example:
#   bash /opt/data/workspace/bin/market-briefing-audio.sh \
#     /opt/data/workspace/.scratch/morning_audio.txt \
#     /opt/data/workspace/.scratch/morning_briefing
#
# Prerequisites: spoken script already written by the LLM (markdown cleaned,
# tables converted to prose, emoji stripped). This script only generates
# audio and uploads — no LLM calls, no text rewriting.
#
# Channel defaults to finance/market briefings channel.

set -euo pipefail

SPOKEN_SCRIPT="${1:?Usage: market-briefing-audio.sh <spoken_script.txt> <output_prefix> [channel_id]}"
OUTPUT_PREFIX="${2:?Usage: market-briefing-audio.sh <spoken_script.txt> <output_prefix> [channel_id]}"
CHANNEL_ID="${3:-8of71fgwatbsjndz7sadn5aire}"

KOKORO="/opt/data/workspace/bin/kokoro-podcast"
TOKEN="nrdyn8nji78zdxje9mq9hcn96e"
BASE="http://localhost:8065/api/v4"

# ── Validate input ──────────────────────────────────────────
if [ ! -f "$SPOKEN_SCRIPT" ]; then
    echo "ERROR: Spoken script not found: $SPOKEN_SCRIPT" >&2
    exit 1
fi

WORD_COUNT=$(wc -w < "$SPOKEN_SCRIPT")
if [ "$WORD_COUNT" -lt 20 ]; then
    echo "ERROR: Spoken script too short ($WORD_COUNT words). Check input." >&2
    exit 1
fi

echo "🎙️  Generating audio from $SPOKEN_SCRIPT ($WORD_COUNT words)..."

# ── Step 1: Kokoro TTS ──────────────────────────────────────
python3 "$KOKORO" \
    --file "$SPOKEN_SCRIPT" \
    --output "$OUTPUT_PREFIX" \
    --host1 af_heart \
    --host2 af_heart

MP3_FILE="${OUTPUT_PREFIX}.mp3"
if [ ! -f "$MP3_FILE" ]; then
    echo "ERROR: kokoro-podcast did not produce $MP3_FILE" >&2
    exit 1
fi

echo "✅  Audio generated: $MP3_FILE ($(du -h "$MP3_FILE" | cut -f1))"

# ── Step 2: Upload to Mattermost ────────────────────────────
echo "📤  Uploading to Mattermost channel $CHANNEL_ID..."

python3 << PYEOF
import urllib.request, json, os

TOKEN = "nrdyn8nji78zdxje9mq9hcn96e"
BASE = "http://localhost:8065/api/v4"
CHANNEL_ID = "${CHANNEL_ID}"
MP3_FILE = "${MP3_FILE}"

with open(MP3_FILE, "rb") as f:
    boundary = "----Boundary"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="channel_id"\r\n\r\n'
        f"{CHANNEL_ID}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="files"; filename="{os.path.basename(MP3_FILE)}"\r\n'
        f"Content-Type: audio/mpeg\r\n\r\n"
    ).encode() + f.read() + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{BASE}/files",
        data=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )

    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read())
    file_id = data["file_infos"][0]["id"]
    filename = data["file_infos"][0]["name"]
    print(f"✅  Uploaded: {filename} (file_id: {file_id})")

# Create post with file attachment
post_data = json.dumps({
    "channel_id": CHANNEL_ID,
    "message": "🎙️ **Audio Briefing**",
    "file_ids": [file_id],
}).encode()

req = urllib.request.Request(
    f"{BASE}/posts",
    data=post_data,
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    },
)
urllib.request.urlopen(req, timeout=10)
print("✅  Posted to channel")
PYEOF

echo "✅  Done — audio delivered"
