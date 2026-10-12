#!/usr/bin/env bash
# 「過去に作ったが今は無いもの」を git 履歴から探す。
#
# measure.sh は HEAD しか見ないため、削除された成果物を見落とす。
# 初版の棚卸しで RaiseTech の CloudFormation(VPC/ALB/RDS/EC2) を
# 「存在しない」と判定した原因がこれ。レベル 0-1 を付ける前に必ず実行する。
set -euo pipefail

OWNER=kawafuchieirin
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/raw/history-absence.tsv"
REPOS=(gcp-cert-master life-repo task-manager terminal-manager regular-study aws-exam dev-garden book-to-action RaiseTech_kadaiyou_repo)

if [ -z "${REPOS_DIR:-}" ]; then
  REPOS_DIR="$(mktemp -d)/repos"; mkdir -p "$REPOS_DIR"
  for r in "${REPOS[@]}"; do
    [ -d "$REPOS_DIR/$r" ] || gh repo clone "$OWNER/$r" "$REPOS_DIR/$r" -- --quiet >/dev/null 2>&1 || true
  done
fi

# 全リビジョンのファイル内容を横断して検索する（git grep に全 rev を渡す）
PATTERNS=(
  "cfn:VPC"            'AWS::EC2::VPC'
  "cfn:Subnet"         'AWS::EC2::Subnet'
  "cfn:RouteTable"     'AWS::EC2::RouteTable'
  "cfn:InternetGateway" 'AWS::EC2::InternetGateway'
  "cfn:SecurityGroup"  'AWS::EC2::SecurityGroup'
  "cfn:ALB"            'AWS::ElasticLoadBalancingV2'
  "cfn:RDS"            'AWS::RDS::'
  "cfn:EC2"            'AWS::EC2::Instance'
  "tf:VPC"             'resource "aws_vpc"'
  "k8s:Deployment"     '^kind: Deployment'
  "k8s:Service"        '^kind: Service'
  "ansible:playbook"   '^- hosts:|^  hosts:'
  "docker:Dockerfile"  '^FROM '
)
{
  printf 'repo\tpattern\thits_in_history\tmeans\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    revs=$(git -C "$d" rev-list --all)
    [ -z "$revs" ] && continue
    i=0
    while [ "$i" -lt "${#PATTERNS[@]}" ]; do
      name="${PATTERNS[$i]}"; pat="${PATTERNS[$((i+1))]}"; i=$((i+2))
      # --all-match ではなく各 rev を対象にし、ヒットしたファイルの重複を除いて数える
      n=$(git -C "$d" grep -l -E "$pat" $revs 2>/dev/null | sed 's/^[^:]*://' | sort -u | wc -l | tr -d ' ' || true)
      [ "${n:-0}" -gt 0 ] && printf '%s\t%s\t%s\t%s\n' "$r" "$name" "$n" "履歴上に存在した固有ファイル数"
    done
  done
} > "$OUT"
echo "完了: $OUT"
