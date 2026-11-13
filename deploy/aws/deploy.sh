#!/usr/bin/env bash
# One-command AWS deployment of github-ranking.
#
#   aws login --profile neyvro            # once; the session is short-lived
#   GITHUB_TOKEN=<token> deploy/aws/deploy.sh
#
# Creates (or reuses) in ap-south-1:
#   - one t4g.small Graviton instance (Amazon Linux 2023), managed through SSM, no SSH port
#   - a 30 GB encrypted gp3 disk that is KEPT if the instance is ever terminated
#   - a fixed Elastic IP and an HTTPS address <ip>.sslip.io (Let's Encrypt via Caddy)
#   - a private, versioned S3 bucket; database snapshots are synced to it every 15 minutes
#   - SSM SecureString parameters for GITHUB_TOKEN and ADMIN_PASSWORD (generated if absent)
# Approximate cost: ~$15/month (instance ~$12, disk ~$2.4, S3 pennies). Re-running is safe.
set -euo pipefail

PROFILE="${AWS_PROFILE:-neyvro}"
REGION="${AWS_REGION:-ap-south-1}"
NAME="${NAME:-github-ranking}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
VOLUME_GB="${VOLUME_GB:-30}"
REPO_URL="${REPO_URL:-https://github.com/kartikeyajay2006/github-ranking.git}"
aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }
log() { printf '\033[1m==> %s\033[0m\n' "$*"; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text) || { echo "Not signed in. Run: aws login --profile $PROFILE"; exit 1; }
BUCKET="${NAME}-backups-${ACCOUNT}"
log "Account $ACCOUNT, region $REGION"

# ---------------------------------------------------------------- secrets
param_exists() { aws ssm get-parameter --name "$1" >/dev/null 2>&1; }
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  aws ssm put-parameter --name "/$NAME/GITHUB_TOKEN" --type SecureString --value "$GITHUB_TOKEN" --overwrite >/dev/null
  log "Stored GITHUB_TOKEN in SSM"
elif ! param_exists "/$NAME/GITHUB_TOKEN"; then
  echo "Set GITHUB_TOKEN (a fine-grained token with no extra permissions is enough: only public data is read)."; exit 1
fi
if ! param_exists "/$NAME/ADMIN_PASSWORD"; then
  ADMIN_PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)
  aws ssm put-parameter --name "/$NAME/ADMIN_PASSWORD" --type SecureString --value "$ADMIN_PASSWORD" >/dev/null
  log "Generated ADMIN_PASSWORD (stored in SSM)"
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  aws ssm put-parameter --name "/$NAME/ANTHROPIC_API_KEY" --type SecureString --value "$ANTHROPIC_API_KEY" --overwrite >/dev/null
fi

# ---------------------------------------------------------------- backups bucket
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  log "Creating private, versioned bucket $BUCKET"
  aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[
  {"ID":"expire-old-versions","Status":"Enabled","Filter":{"Prefix":""},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'

# ---------------------------------------------------------------- instance role
ROLE="${NAME}-instance"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  log "Creating IAM role $ROLE"
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  sleep 10 # instance profiles take a moment to become usable
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name app-access --policy-document "{
  \"Version\":\"2012-10-17\",\"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\",\"s3:ListBucket\"],\"Resource\":[\"arn:aws:s3:::$BUCKET\",\"arn:aws:s3:::$BUCKET/*\"]},
    {\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameter\",\"ssm:GetParameters\"],\"Resource\":\"arn:aws:ssm:$REGION:$ACCOUNT:parameter/$NAME/*\"}]}"

# ---------------------------------------------------------------- network
VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" "Name=vpc-id,Values=$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [[ "$SG" == "None" ]]; then
  log "Creating security group (80 and 443 only; no SSH)"
  SG=$(aws ec2 create-security-group --group-name "$NAME" --description "github-ranking web" --vpc-id "$VPC" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' 'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
fi
ALLOC=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].AllocationId' --output text)
if [[ "$ALLOC" == "None" ]]; then
  ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)
fi
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
SITE="${IP//./-}.sslip.io"
log "Address: https://$SITE"

# ---------------------------------------------------------------- instance
INSTANCE=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [[ "$INSTANCE" == "None" ]]; then
  AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
  USERDATA=$(mktemp)
  sed -e "s|__REGION__|$REGION|g" -e "s|__NAME__|$NAME|g" -e "s|__BUCKET__|$BUCKET|g" -e "s|__SITE__|$SITE|g" -e "s|__REPO__|$REPO_URL|g" \
    "$(dirname "$0")/user-data.sh" >"$USERDATA"
  log "Launching $INSTANCE_TYPE"
  # A new instance profile can take a little while to be accepted by EC2: retry a few times.
  for attempt in 1 2 3 4 5 6; do
  INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --iam-instance-profile "Name=$ROLE" --security-group-ids "$SG" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":$VOLUME_GB,\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":false}}]" \
    --user-data "file://$USERDATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NAME-data}]" \
    --query 'Instances[0].InstanceId' --output text) && break
  [[ $attempt -lt 6 ]] || { echo "Could not launch the instance."; exit 1; }
  sleep 10
  done
  rm -f "$USERDATA"
  aws ec2 wait instance-running --instance-ids "$INSTANCE"
fi
aws ec2 associate-address --allocation-id "$ALLOC" --instance-id "$INSTANCE" --allow-reassociation >/dev/null
log "Instance $INSTANCE at $IP"

# ---------------------------------------------------------------- wait for the app
log "Waiting for the app to build and start (first boot takes ~5 minutes)"
for _ in $(seq 1 90); do
  if curl -fsS --max-time 5 "https://$SITE/api/health" >/dev/null 2>&1; then
    curl -fsS "https://$SITE/api/health"; echo
    PW=$(aws ssm get-parameter --name "/$NAME/ADMIN_PASSWORD" --with-decryption --query Parameter.Value --output text)
    log "Live: https://$SITE   user: admin   password: $PW"
    exit 0
  fi
  sleep 10
done
echo "The app did not answer within 15 minutes. Inspect with:"
echo "  aws --profile $PROFILE --region $REGION ssm start-session --target $INSTANCE"
echo "  then: sudo cat /var/log/cloud-init-output.log; cd /opt/$NAME && sudo docker compose -f docker-compose.prod.yml logs"
exit 1
