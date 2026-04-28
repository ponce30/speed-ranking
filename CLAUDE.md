# speed-ranking — Claude向け作業ノート

## このリポジトリの目的
NPB走力データ(「Stat Search Results」CSV)をブラウザでアップロード → 日本語列にマッピング → ソート可能なランキング表示 → `data/` 配下に自動コミット。

## 技術構成
- **完全静的サイト**(GitHub Pages公開、サーバーロジック無し)
- `index.html` / `style.css` / `app.js` の3ファイル構成
- データ永続化は GitHub Contents API 経由でリポジトリに直接コミット
- 認証はユーザー個人のPAT(localStorage保存)

## 列マッピングの根拠
ユーザーは「Stat Search Results」のCSVをそのまま投入したい。元ファイルは英語ヘッダ + `CS` 列を含むが、表示時は日本語ヘッダ・`CS` 列除外。マッピング定義は `app.js` の `COLUMN_MAP` を参照。新しい列を追加・削除したい時はこの配列を編集する。

## データフォルダ
- `data/` 配下に `YYYY-MM-DD_HHmmss.csv` の名前で自動保存
- アップロードのオリジナルCSV(英語ヘッダのまま)を保存している
- 履歴一覧は Contents API で取得し、最新を初期表示する

## PATが必要な操作
- 履歴一覧取得 (`GET /contents/data`) — public repoなら無くても動くが、rate limit緩和のため設定推奨
- 履歴ファイル取得 (`GET /contents/data/...`) — 同上
- CSVコミット (`PUT /contents/data/...`) — 必須

## 編集時の注意
- ユーザーが「speed-ranking編集」と言ったら `cd "/c/Users/ckg19/OneDrive/デスクトップ/speed-ranking"` → `git pull` → 編集 → commit/push
- commit時は `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` を付ける
- user.email は `141467642+ponce30@users.noreply.github.com`

## ブラウザでの動作確認
- index.html を直接ブラウザで開いてもCORSで動かない(GitHub APIは動くが)
- ローカル確認は `python -m http.server 8000` 等で起動して `http://localhost:8000`
