# speed-ranking — Claude向け作業ノート

## このリポジトリの目的
NPB走力データ(「Stat Search Results」の生データ)をブラウザに **テキスト貼り付け** → 日本語列にマッピング → ソート可能なランキング表示 → `data/` 配下に自動コミット。catcherの兄弟アプリ(捕手版→走力版)。

## 技術構成
- **完全静的サイト**(GitHub Pages公開、サーバーロジック無し)
- `index.html` / `style.css` / `app.js` の3ファイル構成
- データ永続化は GitHub Contents API 経由でリポジトリに直接コミット
- 認証はユーザー個人のPAT(localStorage `speed-ranking:pat`)

## 列マッピング(`app.js` の `COLUMN_MAP`)
| src(CSV英)             | dst(表示日)        | type | 補足 |
|---|---|---|---|
| (なし)                  | Rk                 | num  | H-1st (秒) 昇順で動的付与 |
| Game                   | 日付               | str  | YYYY-MM-DD 部分を抽出、表示は M/D |
| Game                   | 対戦               | str  | Gameから日付を除いた部分 (例: "ロ @ ソ") |
| Player                 | Player             | str  | 球団色で表示 |
| Team                   | Team               | str  | 球団略号 (色付けキー) |
| H-1st (SEC)            | H-1st (秒)         | num  | 基幹指標。3.0 未満は計測エラー除外 |
| 1st-2nd Steal (SEC)    | 1st-2nd 盗塁 (秒)  | num  | 欠損OK (盗塁試行なしも多い) |
| SS (M/S)               | SS (m/s)           | num  | 11.0 以上は計測エラー除外 |

## 入力方式: テキスト貼り付け
- 旧UI(CSVファイルアップロード)は廃止
- index.html の `#pasteInput` テキストエリアに Tableau からそのまま貼り付け → `ランキング表示` ボタン or `Ctrl/Cmd+Enter`
- **タブ区切り(Tableauコピペ)** と **カンマ区切り(CSV)** を `detectDelim()` が自動判定
- 内部的にCSV化して `data/<timestamp>.csv` にコミット (PAT設定済みの端末のみ)

## データ形式
- 列順自由 / 余分な列が混ざってもOK (`headers.indexOf(src)` で動的抽出)
- Tableauから貼ると Game列の値が複数行に分かれる + Game列が中間にあると後続セル(H-1st/Steal/SS)も別行になる → `joinMultilineCells()` が以下のルールで再結合:
  1. **先頭タブで始まる行** は前レコードの「中間以降のセル」とみなして続き行扱い
  2. **タブを含む続き行** はレコードの残りセル群として、タブ重複を避けつつ連結
  3. **タブ無しの単独行** は既存末尾セルに連結 (末尾TABなら直接、なければスペース区切り)
- ランキング対象: **H-1st (秒) と SS (m/s) が有効な行のみ** (1st-2nd Steal は欠損OK)
- 行ごと除外:
  - `H-1st (SEC) < 3.0` → 計測エラー
  - `SS (M/S) ≥ 11.0` → 計測エラー
  - Player名にラテン文字/U+FFFD → 文字化け除外
- H-1st (秒) 昇順で Rk を1始まりで付与

## 球団色
catcher と同じ `TEAM_COLORS` パレット。speed-rankingはデータ自体に `Team` 列があるので、所属推定不要 — 直接 `Team` 列の値で色を引く。

## データフォルダ
- `data/` 配下に `YYYY-MM-DD_HHmmss.csv` の名前で自動保存
- 履歴一覧は Contents API で取得し、最新を初期表示する

## PATが必要な操作
- 履歴一覧取得 / 履歴ファイル取得 — public repoなら無くても動く (rate limit緩和のため設定推奨)
- CSVコミット — 必須

## 編集時の注意
- ユーザーが「speed-ranking編集」と言ったら `cd "/c/Users/ckg19/OneDrive/デスクトップ/speed-ranking"` → `git pull` → 編集 → commit/push
- commit時は `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` を付ける
- user.email は `141467642+ponce30@users.noreply.github.com`

## ブラウザでの動作確認
- ローカル確認は preview名 `speed-ranking` で 8908 ポート
