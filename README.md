# speed-ranking

NPB走力データのアップロード→ランキング表示・自動保存ツール。

## 公開URL
https://ponce30.github.io/speed-ranking/

## 使い方
1. 「Stat Search Results」のCSV(英語ヘッダ)をドロップ
2. 自動で日本語列にマッピングされ、テーブル表示
3. 列ヘッダクリックで昇順↔降順ソート
4. アップロードしたCSVは `data/` 配下に自動コミットされる(履歴として残る)
5. 「履歴」セレクトから過去のCSVを再表示可能

## 列マッピング(英語→日本語)
| 元(CSV) | 表示 |
|---|---|
| Rk | Rk |
| Player | Player |
| H-1st (avg) | H-1st (平均) |
| SB | SB |
| H-1st (min) | H-1st (最速) |
| 1st-2nd Steal (avg) | 1st-2nd 盗塁(平均) |
| 1st-2nd Steal (min) | 1st-2nd 盗塁 (最速) |
| SS (max) | スプリントスピード(max) |

`CS` 列は表示から除外。

## GitHub PAT設定(初回のみ)
1. https://github.com/settings/tokens で `repo` scope付きFine-grained or Classic PATを発行
2. アプリ内「⚙️ GitHub PAT設定」を開きペースト→保存
3. ブラウザのlocalStorageに保存される(他人には漏れない)

## 構成
- 静的サイト(GitHub Pages)
- アップロード→GitHub Contents APIで `data/YYYY-MM-DD_HHmmss.csv` にコミット
- 履歴一覧もContents APIで取得
