#!/bin/bash
# run-big-model-radar.sh — Daily pipeline runner
# Launches Big Model Radar in background, exits immediately.
# Pipeline handles: data fetch → LLM summaries → digest save → symlinks.
set -euo pipefail

RADAR_DIR="/opt/data/workspace/big_model_radar"
DIGEST_OUT="/opt/data/workspace/ai-brief-digests"
LOG_DIR="$RADAR_DIR/logs"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$LOG_DIR" "$DIGEST_OUT"

echo "[$(date)] Launching Big Model Radar pipeline..."

# Launch the entire pipeline in a detached subshell.
# The cron runner has a 120s script timeout — this exits in <1s.
(
    cd "$RADAR_DIR"
    set -a
    source .env
    set +a

    echo "[$(date)] Pipeline started" >> "$LOG_DIR/pipeline_$TODAY.log"
    pnpm start >> "$LOG_DIR/pipeline_$TODAY.log" 2>&1
    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo "[$(date)] ❌ Pipeline FAILED (code $EXIT_CODE)" >> "$LOG_DIR/pipeline_$TODAY.log"
        exit $EXIT_CODE
    fi

    echo "[$(date)] Pipeline completed — linking digests..." >> "$LOG_DIR/pipeline_$TODAY.log"

    # Symlink latest English digests for AI News Brief consumption
    DIGEST_DATE_DIR="$RADAR_DIR/digests/$TODAY"
    if [ -d "$DIGEST_DATE_DIR" ]; then
        rm -f "$DIGEST_OUT"/*.md
        linked=0
        for f in "$DIGEST_DATE_DIR"/*-en.md; do
            if [ -f "$f" ]; then
                base=$(basename "$f")
                ln -sf "$f" "$DIGEST_OUT/$base"
                linked=$((linked + 1))
            fi
        done
        echo "[$(date)] Done — $linked English digests ready" >> "$LOG_DIR/pipeline_$TODAY.log"
        if [ $linked -eq 0 ]; then
            echo "[$(date)] ⚠️ Pipeline ran but produced 0 English digests" >> "$LOG_DIR/pipeline_$TODAY.log"
        fi
    else
        echo "[$(date)] ⚠️ No digest directory for $TODAY" >> "$LOG_DIR/pipeline_$TODAY.log"
    fi
) &
disown

echo "[$(date)] Pipeline launched (PID $!) — exiting"
exit 0
