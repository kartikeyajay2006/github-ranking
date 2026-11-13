#!/usr/bin/env bash
# Deploy the latest main to the running server (git pull + rebuild + restart). Data is untouched.
#   aws login --profile neyvro && deploy/aws/update.sh
set -euo pipefail
PROFILE="${AWS_PROFILE:-neyvro}"
REGION="${AWS_REGION:-ap-south-1}"
NAME="${NAME:-github-ranking}"
aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

INSTANCE=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
[[ "$INSTANCE" != "None" ]] || { echo "No running $NAME instance. Run deploy/aws/deploy.sh first."; exit 1; }

CMD_ID=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --comment "update $NAME" --parameters "commands=[
    \"set -e\",
    \"cd /opt/$NAME\",
    \"docker compose --env-file .compose.env -f docker-compose.prod.yml exec -T app node scripts/db.mjs backup || true\",
    \"git pull --ff-only\",
    \"docker compose --env-file .compose.env -f docker-compose.prod.yml up -d --build\",
    \"docker image prune -f\"
  ]" --query Command.CommandId --output text)
echo "Updating $INSTANCE (command $CMD_ID)…"
aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text | tail -20
