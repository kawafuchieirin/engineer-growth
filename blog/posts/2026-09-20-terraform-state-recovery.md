---
title: Terraform の state をロックごと壊して復旧するまで
date: 2026-09-20
tags: [terraform, aws, troubleshooting]
skills: [infra-terraform, cloud-aws, infra-cicd]
summary: CI の同時実行で S3 バックエンドの state が中途半端な状態になり、import と state rm で復旧した記録。ロックの仕組みを理解すると再発を防げる。
status: published
---

## 課題

CI から `terraform apply` を流したところ、次のエラーで止まった。

```text
Error: Error acquiring the state lock

Error message: operation error DynamoDB: PutItem, https response error
StatusCode: 400, ConditionalCheckFailedException: The conditional request failed
Lock Info:
  ID:        7a0c1f6e-7b1a-4a0e-9a24-8f2b6c4f0f31
  Operation: OperationTypeApply
  Who:       runner@fv-az1234
  Created:   2026-09-20 02:11:43 UTC
```

前提の環境は次の通り。

| 項目 | 値 |
|---|---|
| Terraform | 1.9.5 |
| バックエンド | S3 + DynamoDB ロックテーブル |
| 実行元 | GitHub Actions（`main` への push で apply） |
| 対象 | ECS サービスと ALB のリスナールール |

直前に同じブランチへ 2 回連続で push しており、apply が 2 本同時に走っていた。
片方のジョブはタイムアウトで強制終了され、ロックだけが残った状態だった。

## 試したこと

1. **`terraform force-unlock` でロックを剥がす。**
   ロックは消えたが、次の `plan` で「存在しないはずのリスナールールを作る」差分が出た。
   強制終了されたジョブが、state に書き戻す前に AWS 側の変更を終えていたためだった。

2. **`terraform plan` の差分を AWS CLI の実物と突き合わせる。**
   state を信じずに実物を確認したのがこの作業の分岐点だった。

   ```bash
   aws elbv2 describe-rules \
     --listener-arn "$LISTENER_ARN" \
     --query 'Rules[].{Priority:Priority,Arn:RuleArn}' --output table
   ```

   実物には優先度 120 のルールが存在し、state には無かった。

3. **実物を state に取り込む。**

   ```bash
   terraform import \
     'aws_lb_listener_rule.api["canary"]' \
     "$RULE_ARN"
   ```

4. **逆に state にだけ残っていた「削除済みの古いルール」を外す。**

   ```bash
   terraform state rm 'aws_lb_listener_rule.api["legacy"]'
   ```

   `state rm` は AWS のリソースには触らず state の記録だけを消す。
   実物が本当に無いことを確認してから実行した。

5. `terraform plan` が `No changes.` になったことを確認し、CI を再開した。

## 原因

根本原因は 2 つ重なっていた。

- **apply の同時実行を許していた**こと。ロック機構は同時実行を検出して止めるためのもので、
  同時実行そのものを安全にする仕組みではない。片方を強制終了すれば state は中途半端になる。
- **強制終了が「AWS 変更後・state 書き戻し前」に起きた**こと。この区間はアトミックではないので、
  どんなバックエンドを使っても state と実物はずれ得る。

> ロックは「2 人が同時に書かない」ことしか保証しない。
> 「1 人の書き込みが途中で死んだとき」の整合性は別の仕組み（再実行の冪等性）で担保する必要がある。

## 学び

- `force-unlock` は**最後の手段**。実行する前に、死んだジョブがどこまで進んでいたかをログで確認する。
  ログを見ずに剥がすと、今回のように「state が実物より古い」ことに気付けない。
- 復旧の起点は常に「実物（AWS API）」。state も plan も実物の写しに過ぎない。
- CI には同時実行制御を入れる。GitHub Actions なら次の 3 行で apply が直列化される。

  ```yaml
  concurrency:
    group: terraform-apply-${{ github.ref }}
    cancel-in-progress: false
  ```

  `cancel-in-progress: false` が重要で、`true` にすると今回と同じ「途中で殺される apply」を自分で作ってしまう。
- `import` と `state rm` は state を手で直すための正当な道具。壊れた state を放置して
  `-target` で回避し続けると、差分が読めない状態が固定化する。
