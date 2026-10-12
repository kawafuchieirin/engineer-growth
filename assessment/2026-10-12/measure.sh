#!/usr/bin/env bash
# スキル棚卸し（2026-10-12 版）の根拠を機械的に測り直すスクリプト。
#
# 目的は「レベルの数字が誰の印象なのか」をなくすこと。
# ここで出る TSV が raw/ の中身と一致すれば、判定に使った材料は再現できている。
#
# 使い方:
#   bash measure.sh                              # 一時ディレクトリに clone して測る
#   REPOS_DIR=/path/to/clones bash measure.sh    # 既存の clone を使う
#
# 前提: gh (認証済み), git, jq, bash 4 以上
#
# 実装上の注意（踏んだ罠をそのまま残す）:
#   - `git log | head -1` は、履歴が長いリポジトリで git 側に SIGPIPE が飛び、
#     pipefail + set -e で即死する。先頭の取得は tail -1 で全部読ませる。
#   - `grep -c ... || echo 0` は、不一致時に grep 自身が 0 を出力した上で
#     echo も走り "0\n0" になって算術評価が壊れる。`|| true` にする。
#   - 印の定義に `|` 区切りは使えない（正規表現の交替と衝突する）。配列で持つ。
set -euo pipefail

OWNER=kawafuchieirin
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/raw"
REPOS=(gcp-cert-master life-repo task-manager terminal-manager regular-study aws-exam dev-garden book-to-action)

mkdir -p "$OUT_DIR"

if [ -z "${REPOS_DIR:-}" ]; then
  REPOS_DIR="$(mktemp -d)/repos"
  mkdir -p "$REPOS_DIR"
  for r in "${REPOS[@]}"; do
    [ -d "$REPOS_DIR/$r" ] || gh repo clone "$OWNER/$r" "$REPOS_DIR/$r" -- --quiet >/dev/null 2>&1 \
      || echo "警告: $r を clone できなかった（private 権限か存在を確認）" >&2
  done
fi
echo "計測対象: $REPOS_DIR"

# git が追跡しているファイルだけを数える（node_modules や vendor を含めないため）
# core.quotePath=off が無いと、日本語を含むパスが "\343\202\242..." と
# エスケープされて返り、その後の [ -f ] が常に偽になって計測から漏れる
# （regular-study の「セッション５」配下の Dockerfile が 0 件に見えていた）。
tracked() { git -C "$1" -c core.quotePath=off ls-files 2>/dev/null || true; }
tracked_match() { tracked "$1" | grep -E "$2" || true; }

# 指定ファイル群での「出現回数」を数える（該当行数ではなく出現数）
count_in() {
  local repo="$1" filepat="$2" grepat="$3" n=0 f c
  while IFS= read -r f; do
    [ -f "$repo/$f" ] || continue
    c=$(grep -oE "$grepat" "$repo/$f" 2>/dev/null | wc -l | tr -d ' ' || true)
    n=$((n + ${c:-0}))
  done < <(tracked_match "$repo" "$filepat")
  echo "$n"
}

epoch() { date -j -f %Y-%m-%d "$1" +%s 2>/dev/null || date -d "$1" +%s; }

### 1. リポジトリの基本情報 ##################################################
{
  printf 'repo\tvisibility\tcreated\tcommits\tfirst_commit\tlast_commit\tdays_active\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    meta=$(gh repo view "$OWNER/$r" --json isPrivate,createdAt 2>/dev/null || echo '{}')
    vis=$([ "$(echo "$meta" | jq -r '.isPrivate // false')" = "true" ] && echo private || echo public)
    created=$(echo "$meta" | jq -r '.createdAt // "-"' | cut -c1-10)
    commits=$(git -C "$d" rev-list --count HEAD 2>/dev/null || echo 0)
    # tail -1 で全部読ませる（head だと SIGPIPE で落ちる）
    first=$(git -C "$d" log --format=%ad --date=short 2>/dev/null | tail -1)
    last=$(git -C "$d" log -1 --format=%ad --date=short 2>/dev/null)
    days=$(( ( $(epoch "$last") - $(epoch "$first") ) / 86400 ))
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$r" "$vis" "$created" "$commits" "$first" "$last" "$days"
  done
} > "$OUT_DIR/repos.tsv"

### 2. 言語別の行数（追跡ファイルのみ） ######################################
{
  printf 'repo\text\tfiles\tlines\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    for ext in go ts tsx js mjs py sh lua tf yaml yml md html css sql; do
      files=0; lines=0
      while IFS= read -r f; do
        [ -f "$d/$f" ] || continue
        files=$((files+1)); lines=$((lines + $(wc -l < "$d/$f" | tr -d ' ')))
      done < <(tracked_match "$d" "\.${ext}\$")
      [ "$files" -gt 0 ] && printf '%s\t%s\t%s\t%s\n' "$r" "$ext" "$files" "$lines"
    done
  done
} > "$OUT_DIR/loc.tsv"

### 3. テストの量 ############################################################
{
  printf 'repo\tframework\ttest_files\ttest_cases\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    gf=$(tracked_match "$d" '_test\.go$' | wc -l | tr -d ' ')
    [ "$gf" -gt 0 ] && printf '%s\tgo test\t%s\t%s\n' "$r" "$gf" "$(count_in "$d" '_test\.go$' '^func Test[A-Za-z0-9_]*\(')"
    jf=$(tracked_match "$d" '\.(test|spec)\.(ts|tsx|js|mjs)$' | wc -l | tr -d ' ')
    [ "$jf" -gt 0 ] && printf '%s\tvitest/node:test\t%s\t%s\n' "$r" "$jf" "$(count_in "$d" '\.(test|spec)\.(ts|tsx|js|mjs)$' '^[[:space:]]*(it|test)\(')"
    pf=$(tracked_match "$d" '(^|/)test_[^/]*\.py$' | wc -l | tr -d ' ')
    [ "$pf" -gt 0 ] && printf '%s\tpytest\t%s\t%s\n' "$r" "$pf" "$(count_in "$d" '(^|/)test_[^/]*\.py$' '^def test_')"
  done
} > "$OUT_DIR/tests.tsv"

### 4. 技術的な印（レベル判定に直接使ったもの） ###############################
# 4 要素ずつ: 印の名前 / 対象ファイル / 正規表現 / この印が示すこと
MARKERS=(
  "go:errors.Is-As"            '\.go$'    'errors\.(Is|As)\('                        "エラーを型で判定している"
  "go:%w ラップ"                '\.go$'    'fmt\.Errorf\([^)]*%w'                      "エラーに文脈を足して包んでいる"
  "go:sentinel error"          '\.go$'    'Err[A-Za-z]+[[:space:]]*=[[:space:]]*errors\.New' "判定用のエラー値を定義している"
  "go:context 引数"             '\.go$'    'ctx[[:space:]]+context\.Context'           "context を引数で引き回している"
  "go:goroutine"               '\.go$'    'go func\('                                 "並行処理を書いた箇所"
  "go:テーブル駆動テスト"         '_test\.go$' 'for _, (tt|tc|c|case)[[:space:]]*:?= range' "テーブル駆動テスト"
  "go:サブテスト"                '_test\.go$' 't\.Run\('                                "サブテストに分けている"
  "go:トランザクション"           '\.go$'    'BeginTx\('                                 "明示的なトランザクション"
  "go:go-embed"                '\.go$'    'go:embed'                                  "バイナリへの埋め込み"
  "tf:resource 定義"            '\.tf$'    '^resource "'                              "Terraform のリソース定義数"
  "tf:module 呼び出し"           '\.tf$'    '^module "'                                "モジュールを呼んでいる箇所"
  "tf:for_each"                '\.tf$'    'for_each[[:space:]]*='                     "繰り返しでリソースを作っている"
  "tf:dynamic ブロック"          '\.tf$'    'dynamic "'                                "ブロックを動的に生成している"
  "tf:moved ブロック"            '\.tf$'    '^moved \{'                                "リソースを再作成せず移行した"
  "tf:validation"              '\.tf$'    'validation \{'                             "変数に入力検証を書いている"
  "tf:lifecycle"               '\.tf$'    'lifecycle \{'                              "削除保護などの制御"
  "tf:write-only 属性"          '\.tf$'    'value_wo'                                  "シークレットを state に載せない"
  "tf:バージョン固定"            '\.tf$'    'required_version'                          "Terraform 本体のバージョン固定"
  "tf:条件付きリソース"           '\.tf$'    'count[[:space:]]*=.*\?'                    "任意リソース化"
  "gha:ワークフロー"             '\.github/workflows/.*\.ya?ml$' '^name:'               "ワークフローの数"
  "gha:permissions 明示"        '\.github/workflows/.*\.ya?ml$' '^[[:space:]]*permissions:' "権限を明示している箇所"
  "gha:concurrency"            '\.github/workflows/.*\.ya?ml$' '^[[:space:]]*concurrency:' "同時実行を制御している箇所"
  "gha:OIDC"                   '\.github/workflows/.*\.ya?ml$' 'id-token:[[:space:]]*write' "長期キーを使わない認証"
  "gha:SHA ピン"                '\.github/workflows/.*\.ya?ml$' 'uses:[^@]*@[0-9a-f]{40}' "action をコミット SHA で固定"
  "gha:タグ参照"                '\.github/workflows/.*\.ya?ml$' 'uses:[^@]*@v[0-9]'     "action をタグ参照（固定されていない）"
  "gha:timeout"                '\.github/workflows/.*\.ya?ml$' 'timeout-minutes:'      "暴走を止める設定"
  "sh:strict mode"             '\.sh$'    'set -euo pipefail'                         "エラーで止まる設定"
  "sh:関数分割"                 '\.sh$'    '^[a-z_]+\(\) \{'                           "関数に分割している"
  "sh:dry-run"                 '\.sh$'    'dry.run'                                   "副作用なしで試せる設計"
  "ts:strict"                  'tsconfig.*json$' '"strict":[[:space:]]*true'          "TypeScript の strict"
  "ts:noUncheckedIndexedAccess" 'tsconfig.*json$' 'noUncheckedIndexedAccess'           "配列アクセスの型を厳しくしている"
  "ts:zod 検証"                 '\.(ts|tsx)$' 'z\.(object|string|number|array|enum)\(' "外部入力をスキーマ検証している"
  "sec:gitleaks"               '\.pre-commit-config\.yaml$' 'gitleaks'                "コミット前のシークレット検出"
  "sec:秘密鍵検出"              '\.pre-commit-config\.yaml$' 'detect-private-key'      "秘密鍵の混入防止"
  "sec:shellcheck"             '\.pre-commit-config\.yaml$' 'shellcheck'              "シェルスクリプトの静的検査"
)
{
  printf 'repo\tmarker\tcount\tmeans\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    i=0
    while [ "$i" -lt "${#MARKERS[@]}" ]; do
      name="${MARKERS[$i]}"; filepat="${MARKERS[$((i+1))]}"
      grepat="${MARKERS[$((i+2))]}"; means="${MARKERS[$((i+3))]}"
      i=$((i+4))
      n=$(count_in "$d" "$filepat" "$grepat")
      [ "$n" -gt 0 ] && printf '%s\t%s\t%s\t%s\n' "$r" "$name" "$n" "$means"
    done
  done
} > "$OUT_DIR/markers.tsv"

### 4b. 「無い」ことの確認 ####################################################
# レベル 0-1 の判定は不在が根拠になる。印象ではなく 0 件を測って示す。
# 全リポジトリを横断して数え、hits が 0 ならその技術の痕跡は無いと言える。
ABSENCE=(
  "Dockerfile"              'Dockerfile'                 'FROM '                                      "コンテナイメージの定義"
  "docker:マルチステージ"     'Dockerfile'                 '^FROM .+ (AS|as) '                           "イメージを小さくする書き方"
  "docker:非 root 実行"       'Dockerfile'                 '^USER '                                     "root を避ける設定"
  "docker:HEALTHCHECK"      'Dockerfile'                 '^HEALTHCHECK'                               "コンテナの死活監視"
  "docker:compose"          'docker-compose\.ya?ml$|compose\.ya?ml$' '^services:'                    "複数コンテナの構成"
  "k8s:マニフェスト"          '\.ya?ml$'                   '^kind: (Deployment|StatefulSet|DaemonSet|Service|Ingress)' "Kubernetes の定義"
  "k8s:Helm"                'Chart\.ya?ml$'              '^apiVersion:'                               "Helm チャート"
  "k8s:kustomize"           'kustomization\.ya?ml$'      '^resources:|^apiVersion:'                   "kustomize 構成"
  "aws:VPC"                 '\.tf$'                      'resource "aws_(vpc|subnet|route_table|nat_gateway|security_group)"' "ネットワークを自分で設計している"
  "aws:ECS-EKS"             '\.tf$'                      'resource "aws_(ecs|eks)_'                   "コンテナ基盤"
  "aws:RDS"                 '\.tf$'                      'resource "aws_(db_instance|rds_|elasticache)' "マネージド RDBMS"
  "aws:X-Ray"               '\.tf$'                      'xray|X-Ray'                                 "分散トレーシング"
  "gcp:provider"            '\.tf$'                      'google(-beta)?["/]'                          "Google Cloud のリソース定義"
  "rdbms:ドライバ"            'go\.mod$|package\.json$|requirements.*\.txt$' '(lib/pq|pgx|go-sql-driver|psycopg|mysql2|^pg$)' "PostgreSQL / MySQL への接続"
  "perf:Go ベンチマーク"      '_test\.go$'                 '^func Benchmark'                            "ベンチマーク"
  "perf:pprof"              '\.go$'                      'net/http/pprof|runtime/pprof'               "プロファイリング"
  "perf:k6"                 '\.(js|ts|ya?ml)$'           "grafana/k6|from 'k6|k6/http|k6 run"          "負荷試験"
  "obs:Prometheus"          '\.(go|ts|js|tf|ya?ml)$'     'prometheus|promhttp'                        "メトリクス基盤"
  "obs:OpenTelemetry"       '\.(go|ts|js)$'              'opentelemetry|otel'                         "分散トレーシング"
  "test:E2E"                'package\.json$'             'playwright|cypress|puppeteer'               "ブラウザの E2E テスト"
  "test:カバレッジ"           '\.(ya?ml|json|mk)$|Makefile$' 'coverprofile|--coverage|codecov'          "カバレッジ計測"
  "sec:IaC スキャナ"          '\.(ya?ml|toml)$'            'tfsec|checkov|trivy|terrascan'              "IaC のセキュリティ検査"
  "sec:govulncheck"         '\.(ya?ml|mk)$|Makefile$'    'govulncheck|npm audit|pip-audit'            "依存の脆弱性検査"
  "iac:複数環境"              '\.tf(vars)?$'               '(dev|stg|staging)/|workspace'               "環境の分離"
)
{
  printf 'check\thits\tfound_in\tmeans\n'
  i=0
  while [ "$i" -lt "${#ABSENCE[@]}" ]; do
    name="${ABSENCE[$i]}"; filepat="${ABSENCE[$((i+1))]}"
    grepat="${ABSENCE[$((i+2))]}"; means="${ABSENCE[$((i+3))]}"
    i=$((i+4))
    total=0; found=""
    for r in "${REPOS[@]}"; do
      d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
      n=$(count_in "$d" "$filepat" "$grepat")
      if [ "$n" -gt 0 ]; then total=$((total+n)); found="${found}${found:+,}${r}:${n}"; fi
    done
    printf '%s\t%s\t%s\t%s\n' "$name" "$total" "${found:--}" "$means"
  done
} > "$OUT_DIR/absence.tsv"

### 5. AWS で実際に作っているリソースの種類 ##################################
{
  printf 'repo\tresource_type\tcount\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    while IFS= read -r f; do
      [ -f "$d/$f" ] || continue
      grep -hoE '^resource "aws_[a-z0-9_]+"' "$d/$f" 2>/dev/null || true
    done < <(tracked_match "$d" '\.tf$') \
      | sed -E 's/^resource "//; s/"$//' | sort | uniq -c \
      | awk -v r="$r" '{printf "%s\t%s\t%s\n", r, $2, $1}'
  done
} > "$OUT_DIR/aws-resources.tsv"

### 6. コミットの質 ##########################################################
{
  printf 'repo\ttotal\tconventional\tco_authored_ai\tmerge\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    total=$(git -C "$d" rev-list --count HEAD)
    conv=$(git -C "$d" log --format=%s | grep -cE '^(feat|fix|docs|test|refactor|chore|ci|perf|style|build|revert)(\([^)]+\))?!?: ' || true)
    # grep -c は「行数」を数えるため、1 コミットに複数行あると総数を超える。
    # git --grep はコミット単位で絞り込むので、こちらで数える（複数指定は OR）。
    ai=$(git -C "$d" log -i --grep='Co-Authored-By:.*Claude' --grep='Co-Authored-By:.*Codex' --grep='Generated with' --format=%H | wc -l | tr -d ' ')
    mg=$(git -C "$d" log --format=%s | grep -cE '^Merge ' || true)
    printf '%s\t%s\t%s\t%s\t%s\n' "$r" "$total" "$conv" "$ai" "$mg"
  done
} > "$OUT_DIR/commits.tsv"

### 7. 月ごとの活動量 ########################################################
{
  printf 'month\tcommits\trepos_active\n'
  for r in "${REPOS[@]}"; do
    d="$REPOS_DIR/$r"; [ -d "$d" ] || continue
    git -C "$d" log --format="%ad	$r" --date=format:'%Y-%m'
  done | sort | awk -F'\t' '
    {c[$1]++; k[$1 FS $2]=1}
    END {for (m in c) {n=0; for (p in k) {split(p, a, FS); if (a[1]==m) n++} printf "%s\t%s\t%s\n", m, c[m], n}}
  ' | sort
} > "$OUT_DIR/activity.tsv"

echo "完了。出力先: $OUT_DIR"
echo "clone 先: $REPOS_DIR"
