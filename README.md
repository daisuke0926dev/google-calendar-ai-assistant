# 📅 Google Calendar AI Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)

自然な日本語でGoogleカレンダーを操作できるAIアシスタント。OpenAI GPT-4oがあなたの意図を理解し、最適な時間を提案します。

> 💡 **「2月3日の会議、翌日に移動させといて」** — それだけで予定を管理

---

## ✨ 主な機能

### 🗣️ 自然言語でのスケジュール操作
- 「明日の14時にミーティングを入れて」
- 「来週の1on1、別の日にずらしたい」
- 「今日の予定を教えて」

### 🤖 インテリジェントな時間提案
- 参加者全員の空き時間を自動分析
- 会議室の空き状況も考慮
- 平日のみ提案（休日除外）

### ⚡ 簡単な確認
- 「それで」「お願い」などの短い返答でOK
- 数字選択（「1」「2番目」）にも対応
- 時間条件の追加（「14時以降がいいな」）

### 🔄 高度な操作
- 複数イベントの一括操作
- 参加/不参加の回答
- リマインダー設定
- 繰り返しイベントの作成

### 🎨 カスタマイズ可能な応答スタイル
- **標準**: バランスの取れた応答スタイル
- **ビジネス**: フォーマルな言葉遣い（敬語表現）
- **カジュアル**: フレンドリーな口調
- カスタムプロンプトのインポート/エクスポート対応

---

## 🎬 デモ

<!-- TODO: 実際の使用例のGIFやスクリーンショットを追加 -->
<!-- ![デモGIF](docs/demo.gif) -->

**使用例:**

```
ユーザー: 来月の23日にある1on1の予定、別の日にずらしたいんだけどどこが良い？

AI: 2026年2月23日の空きがないため、近い日付の空き時間を提案いたします。

    対象イベント:
    1on1ミーティング
    2026/2/23 17:30:00
    参加者: 2名 / 会議室: 1室 (全員の空き時間を考慮)

    1. 2026-02-24 09:00
    2. 2026-02-25 12:30
    3. 2026-02-26 11:00

ユーザー: 14時以降がいいな

AI: 以下の時間帯で1on1のスケジュールを提案します。

    1. 2026-02-24 17:00
    2. 2026-02-25 15:30
    3. 2026-03-03 17:00

ユーザー: 1

AI: 「1on1ミーティング」を2026-02-24 17:00に移動しました！
```

---

## 🚀 クイックスタート

### 前提条件

- Google Chrome（最新版）
- [OpenAI APIキー](https://platform.openai.com/api-keys)
- Googleアカウント
- [Google Cloud Console](https://console.cloud.google.com/)アカウント（無料）

### インストール

**1. リポジトリをクローン**

```bash
git clone https://github.com/yourusername/google-calendar-ai-assistant.git
cd google-calendar-ai-assistant
```

**2. Chrome拡張機能として読み込み**

1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. クローンしたフォルダを選択

**3. Google Cloud Consoleで認証情報を作成**

<details>
<summary>📋 詳細な手順を見る</summary>

1. [Google Cloud Console](https://console.cloud.google.com/)で新しいプロジェクトを作成
2. **Google Calendar API**を有効化
   - 「APIとサービス」→「ライブラリ」→「Google Calendar API」を検索
3. **OAuth同意画面**を設定
   - User Type: **外部**
   - **テストユーザー**に自分のメールアドレスを追加（必須）
4. **OAuth クライアントID**を作成
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクトURI: `https://[拡張機能ID].chromiumapp.org/`
   - （拡張機能IDは設定画面の「セットアップ手順を表示」で確認）
5. **クライアントID**と**クライアントシークレット**をコピー

</details>

**4. 拡張機能を設定**

1. 拡張機能アイコンをクリック → 「設定」
2. **OpenAI API設定**
   - APIキーを入力
   - モデルを選択（`gpt-4o` 推奨）
3. **Google Calendar API設定**
   - Client IDとClient Secretを入力
   - 「保存」→「Googleアカウントで認証」
4. 完了！🎉

---

## 📖 使い方

### 基本コマンド

| 操作 | 例 |
|------|-----|
| 予定を移動 | 「2月3日の会議、翌日に移動させといて」 |
| 予定を作成 | 「明日、1時間のミーティングを入れたい」 |
| 予定を確認 | 「今日の予定を教えて」 |
| 予定を削除 | 「明日の打ち合わせをキャンセルして」 |
| 一括操作 | 「来月の予定で参加にしていないやつ全部不参加にして」 |

### 提案への返答パターン

| パターン | 例 |
|----------|-----|
| ✅ 肯定 | 「それで」「お願い」「はい」「OK」 |
| 🔢 選択 | 「1」「2番目」「3つ目」 |
| ⏰ 条件追加 | 「14時以降がいいな」「午前中で」 |
| ❌ 否定 | 「いいえ」「やめて」「キャンセル」 |

---

## 🏗️ プロジェクト構成

```
google-calendar-ai-assistant/
├── manifest.json              # Chrome拡張機能の設定
├── popup.html                 # 拡張機能メニュー
├── sidepanel.html            # メインUI
├── settings.html             # 設定画面
├── scripts/
│   ├── background.js         # バックグラウンド処理
│   ├── popup.js              # メニュー処理
│   ├── sidepanel.js          # メインUI処理
│   ├── settings.js           # 設定画面処理
│   ├── calendar-api.js       # Google Calendar API連携
│   ├── openai-api.js         # OpenAI API連携
│   ├── scheduler.js          # スケジュール管理ロジック
│   └── holidays.js           # 日本の祝日データ
└── styles/
    ├── sidepanel.css         # メインUIスタイル
    └── settings.css          # 設定画面スタイル
```

---

## 🔧 カスタマイズ

### プロンプトテンプレート

設定画面でAIアシスタントの応答スタイルを変更できます：

| テンプレート | 説明 | 使用例 |
|------------|------|--------|
| 標準 | バランスの取れた応答スタイル | 一般的な使用 |
| ビジネス | フォーマルな言葉遣い（敬語表現） | ビジネスシーンでの利用 |
| カジュアル | フレンドリーな口調 | 友人・プライベート用 |

**カスタムテンプレート作成:**
1. 設定画面でテンプレートを選択
2. 「エクスポート」でJSONファイルをダウンロード
3. ファイルを編集してプロンプトをカスタマイズ
4. 「インポート」で読み込み

### 営業時間の変更

設定画面で営業時間（デフォルト: 9:00-18:00）を変更可能。AIはこの時間帯を優先して提案します。

### AIモデルの変更

| モデル | 特徴 |
|--------|------|
| `gpt-4o` | 推奨。高精度な自然言語理解 |
| `gpt-4o-mini` | コスト削減。精度は若干低下 |

---

## 🐛 トラブルシューティング

<details>
<summary>「認証が必要です」と表示される</summary>

1. 設定画面でClient IDとClient Secretが正しく入力されているか確認
2. 「保存」→「Googleアカウントで認証」の順に実行
3. リダイレクトURIが正しく設定されているか確認（Google Cloud Console）
4. テストユーザーに自分が追加されているか確認

</details>

<details>
<summary>「このアプリは確認されていません」と表示される</summary>

1. 「詳細」をクリック
2. 「[アプリ名]に移動（安全ではないページ）」をクリック
3. これは自分で作成した拡張機能なので安全です
4. カレンダーへのアクセスを許可

</details>

<details>
<summary>イベントが見つからない</summary>

- イベント名をより具体的に指定（「1on1」「会議」など）
- 日付の指定方法を変える（「2月3日」「明日」「来週」）
- 会話履歴クリアボタン（🗑️）でコンテキストをリセット

</details>

---

## 🔐 セキュリティとプライバシー

- ✅ **ローカルストレージ**: すべての認証情報はChromeのローカルストレージに暗号化保存
- ✅ **HTTPS通信**: すべてのAPI通信は暗号化
- ✅ **クライアントサイド処理**: カレンダーデータは外部サーバーに保存されません
- ✅ **最小限のデータ送信**: OpenAI APIにはイベントのタイトルと日時のみ送信
- ✅ **OAuth 2.0**: 業界標準の認証プロトコル

---

## 💰 API利用料金

- **OpenAI API**: 使用トークン数に応じて課金（従量課金）
- **Google Calendar API**: 無料（1日100万リクエストまで）

---

## 🤝 貢献

プルリクエストを歓迎します！バグ報告や機能要望は[Issues](https://github.com/yourusername/google-calendar-ai-assistant/issues)でお願いします。

### 開発に参加する

```bash
# リポジトリをクローン
git clone https://github.com/yourusername/google-calendar-ai-assistant.git

# 拡張機能として読み込み
# chrome://extensions/ で「パッケージ化されていない拡張機能を読み込む」

# 変更後、拡張機能をリロード
# chrome://extensions/ で🔄をクリック
```

詳細は[CLAUDE.md](CLAUDE.md)を参照してください。

---

## 📄 ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照

---

## 🗺️ ロードマップ

- [ ] 複数カレンダーのサポート
- [ ] 音声入力対応
- [x] カスタムプロンプトテンプレート
- [ ] 他のAIモデル対応（Claude、Gemini等）
- [ ] Chrome Web Storeへの公開
- [ ] Firefox/Safari対応

---

## 📬 サポート

質問や問題がある場合：

- 📖 [ドキュメント](SETUP_GUIDE.md)を確認
- 🐛 [Issues](https://github.com/yourusername/google-calendar-ai-assistant/issues)で報告
- 💬 [Discussions](https://github.com/yourusername/google-calendar-ai-assistant/discussions)で質問

---

<div align="center">

**⭐ このプロジェクトが役に立ったら、ぜひスターをお願いします！**

Made with ❤️ by the community

</div>
