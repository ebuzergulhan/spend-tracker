#!/usr/bin/env bash
# deploy-hook.sh — the ONLY thing the Mac's deploy key is allowed to run.
# It is set as a forced command on that key in /root/.ssh/authorized_keys, so
# `ssh <server> deploy|logs|status` runs this script and nothing else.
set -euo pipefail

# Non-interactive SSH sessions don't load the login shell, so make sure node/pm2 are found.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

cd /var/www/spend-tracker

case "${SSH_ORIGINAL_COMMAND:-status}" in
    deploy)
        git pull --ff-only origin main
        bash backup-db.sh
        pm2 restart spend-tracker
        sleep 3
        pm2 logs spend-tracker --lines 20 --nostream
        ;;
    logs)
        pm2 logs spend-tracker --lines 60 --nostream
        ;;
    status)
        git log -1 --oneline
        pm2 describe spend-tracker | grep -E "status|uptime|restarts" || true
        ;;
    *)
        echo "Allowed commands: deploy | logs | status" >&2
        exit 1
        ;;
esac
