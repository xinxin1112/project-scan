#!/bin/bash
# scan-helper.sh — Git diff utilities for project-scan update mode
# Usage: scan-helper.sh <command> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "${1:-help}" in

  # Get current HEAD SHA
  head-sha)
    git rev-parse HEAD
    ;;

  # Get changed files between two commits
  # Usage: scan-helper.sh changed-files <from-sha> [to-sha]
  changed-files)
    FROM_SHA="${2:?Usage: scan-helper.sh changed-files <from-sha> [to-sha]}"
    TO_SHA="${3:-HEAD}"
    git diff --name-only "$FROM_SHA".."$TO_SHA"
    ;;

  # Get changed files with stats
  # Usage: scan-helper.sh changed-stats <from-sha> [to-sha]
  changed-stats)
    FROM_SHA="${2:?Usage: scan-helper.sh changed-stats <from-sha> [to-sha]}"
    TO_SHA="${3:-HEAD}"
    git diff --stat "$FROM_SHA".."$TO_SHA"
    ;;

  # Categorize changed files by scan phase
  # Usage: scan-helper.sh affected-phases <from-sha> [to-sha]
  # Output: phase numbers that need re-running
  affected-phases)
    FROM_SHA="${2:?Usage: scan-helper.sh affected-phases <from-sha> [to-sha]}"
    TO_SHA="${3:-HEAD}"

    CHANGED=$(git diff --name-only "$FROM_SHA".."$TO_SHA")
    PHASES=""

    # Phase 1,2,4: build files
    if echo "$CHANGED" | grep -qE '(pom\.xml|build\.gradle|settings\.gradle|package\.json|go\.mod|Cargo\.toml)'; then
      PHASES="$PHASES 1 2 4"
    fi

    # Phase 3: new Java/Kotlin files added (may indicate new packages)
    if git diff --diff-filter=A --name-only "$FROM_SHA".."$TO_SHA" | grep -qE 'src/main/(java|kotlin)/.*\.(java|kt)$'; then
      PHASES="$PHASES 3"
    fi

    # Phase 5: controller/api files
    if echo "$CHANGED" | grep -qiE '(controller|api|endpoint|rest)/.*\.(java|kt)$'; then
      PHASES="$PHASES 5"
    fi

    # Phase 6: entity/mapper/migration files
    if echo "$CHANGED" | grep -qiE '(entity|model|po|mapper|repository|dao|migration|changelog)/'; then
      PHASES="$PHASES 6"
    fi

    # Phase 6B + 8: config files (datasource + external services)
    if echo "$CHANGED" | grep -qE '(bootstrap|application).*\.(yml|yaml|properties)$'; then
      PHASES="$PHASES 6B 8"
    fi

    # Phase 7: service/scheduled/listener files
    if echo "$CHANGED" | grep -qiE '(service|biz|task|job|schedule|listener|consumer)/.*\.(java|kt)$'; then
      PHASES="$PHASES 7"
    fi

    # Phase 10: package.json (frontend detection)
    if echo "$CHANGED" | grep -qE '^(frontend|src)/.*package\.json$'; then
      PHASES="$PHASES 10"
    fi

    # Phase 11: router/routes files
    if echo "$CHANGED" | grep -qiE '(router|routes)/.*\.(ts|js|tsx)$'; then
      PHASES="$PHASES 11"
    fi

    # Phase 12: api/services/request files
    if echo "$CHANGED" | grep -qiE '(api|services|request)/.*\.(ts|js|tsx)$'; then
      PHASES="$PHASES 12"
    fi

    # Phase 13: store/stores/slices files
    if echo "$CHANGED" | grep -qiE '(store|stores|slices)/.*\.(ts|js|tsx)$'; then
      PHASES="$PHASES 13"
    fi

    # Phase 14: components files
    if echo "$CHANGED" | grep -qiE 'components/.*\.(vue|tsx|jsx)$'; then
      PHASES="$PHASES 14"
    fi

    # Phase 15: vite.config/vue.config/.env files
    if echo "$CHANGED" | grep -qE '(vite\.config|vue\.config|\.env)'; then
      PHASES="$PHASES 15"
    fi

    # Deduplicate and sort
    echo "$PHASES" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' '
    echo
    ;;

  # Extract scan-commit SHA from an existing output file
  # Usage: scan-helper.sh extract-sha <file-path>
  extract-sha)
    FILE="${2:?Usage: scan-helper.sh extract-sha <file-path>}"
    if [ -f "$FILE" ]; then
      sed -n 's/.*scan-commit: \([a-f0-9]*\).*/\1/p' "$FILE" 2>/dev/null || echo ""
    else
      echo ""
    fi
    ;;

  # Add paths to .gitignore if not already present
  # Usage: scan-helper.sh gitignore <path1> [path2] ...
  gitignore)
    shift
    GITIGNORE=".gitignore"
    touch "$GITIGNORE"
    for PATTERN in "$@"; do
      if ! grep -qxF "$PATTERN" "$GITIGNORE" 2>/dev/null; then
        echo "$PATTERN" >> "$GITIGNORE"
      fi
    done
    ;;

  # Check if database CLI tools are available
  check-db)
    echo "=== MySQL ==="
    if command -v mysql &>/dev/null; then
      echo "available"
      mysql --version 2>/dev/null
    else
      echo "unavailable"
    fi
    echo ""
    echo "=== PostgreSQL ==="
    if command -v psql &>/dev/null; then
      echo "available"
      psql --version 2>/dev/null
    else
      echo "unavailable"
    fi
    ;;

  help|*)
    cat <<'EOF'
scan-helper.sh — Git diff utilities for project-scan skill

Commands:
  head-sha                          Get current HEAD SHA
  changed-files <from> [to]         List changed files between commits
  changed-stats <from> [to]         Show diff stats between commits
  affected-phases <from> [to]       Determine which scan phases need re-running
  extract-sha <file>                Extract scan-commit SHA from output file
  gitignore <path1> [path2...]      Add paths to .gitignore (idempotent)
  check-db                          Check if database CLI tools (mysql/psql) are available
  help                              Show this help
EOF
    ;;
esac
