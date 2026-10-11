---
title: {{title}}
date: {{date}}
tags: {{tags}}
skills: {{skills}}
summary: {{summary}}
status: {{status}}
---

<!--
この雛形は `pnpm growth new-post` が front matter を埋めて blog/posts/ または blog/drafts/ に複製する。
書き方の詳細は docs/BLOG_GUIDE.md を参照。構成は「課題 → 試したこと → 原因 → 学び」で固定し、
読んだ人（半年後の自分を含む）が再現・応用できる形にする。
front matter の skills は data/skills.yaml の id と一致させる（存在しない id は build / validate で失敗する）。
-->

## 課題

何に困っていたのかを、前提の環境とエラーメッセージまで含めて具体的に書く。
「誰のどんな状況で起きるのか」が分かると、後から検索した自分が再利用できる。

## 試したこと

1. 立てた仮説と、それをどう検証したか。
2. 失敗した試行も消さずに残す（同じ落とし穴を 2 回踏まないための記録）。

## 原因

根本原因。断定できない部分は「推測」と明記して、確かめる方法まで書く。

## 学び

- 次に同じ場面に出会ったときに最初にやること。
- front matter の `skills` に挙げた項目と対応させる（スキル棚卸しの裏付けになる）。
