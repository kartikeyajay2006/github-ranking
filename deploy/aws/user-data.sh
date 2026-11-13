#!/bin/bash
# First-boot setup on Amazon Linux 2023 (arm64). Placeholders (__X__) are filled in by deploy.sh.
set -euxo pipefail
REGION=__REGION__
NAME=__NAME__
BUCKET=__BUCKET__
SITE=__SITE__
REPO=__REPO__
APP=/opt/$NAME

# 2 GB of swap: building the Next.js app can briefly need more memory than a 2 GB instance has.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

dnf install -y docker git
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-aarch64" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

[ -d "$APP/.git" ] || git clone "$REPO" "$APP"
mkdir -p "$APP/data/backups"
chown -R 1001:1001 "$APP/data"   # the container runs as uid 1001

# Restore the newest snapshot from S3 if this is a fresh disk and backups exist (e.g. after rebuilding the server).
if [ ! -f "$APP/data/ranking.db" ]; then
  LATEST=$(aws s3 ls "s3://$BUCKET/snapshots/" --region "$REGION" | sort | tail -1 | awk '{print $4}')
  if [ -n "$LATEST" ]; then
    aws s3 cp "s3://$BUCKET/snapshots/$LATEST" "$APP/data/ranking.db" --region "$REGION"
    chown 1001:1001 "$APP/data/ranking.db"
  fi
fi

param() { aws ssm get-parameter --region "$REGION" --name "/$NAME/$1" --with-decryption --query Parameter.Value --output text 2>/dev/null || true; }
umask 077
cat >"$APP/.env" <<ENV
GITHUB_TOKEN=$(param GITHUB_TOKEN)
ADMIN_PASSWORD=$(param ADMIN_PASSWORD)
ANTHROPIC_API_KEY=$(param ANTHROPIC_API_KEY)
ANALYSIS_TTL_HOURS=12
ENV
echo "SITE_ADDRESS=$SITE" >"$APP/.compose.env"

cd "$APP"
docker compose --env-file .compose.env -f docker-compose.prod.yml up -d --build

# Copy snapshots off the machine every 15 minutes (S3 is versioned, so nothing is ever overwritten).
cat >/etc/systemd/system/$NAME-backup-sync.service <<UNIT
[Unit]
Description=Sync $NAME snapshots to S3
[Service]
Type=oneshot
ExecStart=/usr/bin/aws s3 sync $APP/data/backups s3://$BUCKET/snapshots/ --region $REGION --only-show-errors
UNIT
cat >/etc/systemd/system/$NAME-backup-sync.timer <<UNIT
[Unit]
Description=Sync $NAME snapshots to S3 every 15 minutes
[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now $NAME-backup-sync.timer

# Keep the server patched.
dnf install -y dnf-automatic
sed -i 's/^apply_updates = no/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer
