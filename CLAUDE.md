# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

Googleカレンダーを自然な日本語コマンドで管理できるChrome拡張機能。OpenAIのGPT-4oでユーザーの意図を解析し、カレンダーの空き時間を分析してインテリジェントな時間枠を提案します。

**主要技術:** Manifest V3 Chrome拡張機能、Google Calendar API v3、OpenAI Chat Completions API、クライアントサイドのみ（バックエンドサーバーなし）

## 開発セットアップ

### 拡張機能の読み込み

1. `chrome://extensions/` にアクセス
2. 右上の「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `google-calendar-ai-assistant` ディレクトリを選択
5. OAuth リダイレクトURI設定のため拡張機能IDをメモ

### 変更のテスト

コード修正後：
1. `chrome://extensions/` を開く
2. 拡張機能カードの更新ボタン（🔄）をクリック
3. ポップアップ/サイドパネルウィンドウを再度開いて変更を確認

**注意:** バックグラウンドサービスワーカーの変更は完全なリロードが必要。サイドパネル/ポップアップのHTML/CSS/JSは更新ボタンのみでOK。

## アーキテクチャ概要

### 各モジュールの責務

**scheduler.js** (エントリーポイント)
- すべてのカレンダー操作を統括
- ユーザーの意図を適切なハンドラーにルーティング
- 会話コンテキスト (`this.currentContext`) を管理
- **重要なコンテキストプロパティ:**
  - `type`: 'move' | 'create' (実行する操作を決定)
  - `event`: 対象イベントオブジェクト (移動操作用)
  - `suggestions`: AIが生成した時間枠の提案
  - `freeSlots`: すべての空き時間スロット (「14時以降がいいな」などの絞り込みに使用)
  - `humanAttendees`: 人間の参加者 (表示用)
  - `roomResources`: 会議室リソース (参加者から分離)

**openai-api.js** (意図解析)
- 日本語の自然言語 → 構造化されたJSON意図に変換
- 主要な意図プロパティ:
  - `action`: 'move' | 'create' | 'delete' | 'query' | 'update' | 'respond' | 'bulk_respond' | 'other'
  - `eventQuery`: 検索キーワード (「の予定」「イベント」などを除去)
  - `date`: 対象イベントの日付 (move/delete/query用)
  - `newDate`: 移動先の日付 (move操作用、「別の日」などの曖昧な場合はnull)
  - `needsSuggestion`: 時間提案を生成するか
- **重要:** プロンプトエンジニアリングが重要。挨拶、雑談、会話的な質問（カレンダー操作ではない）には必ず "other" アクションを使用。

**calendar-api.js** (Googleカレンダー連携)
- `chrome.identity.launchWebAuthFlow` によるOAuth 2.0認証
- イベントのCRUD操作
- **複数参加者のスケジューリング:** Freebusy APIを使用して共通の空き時間を検索
- **柔軟な検索:** ストップワード除去によるキーワード正規化 (「1on1の予定」→「1on1」)
- **休日フィルタリング:** デフォルトで週末と日本の祝日を除外 (`excludeHolidays: false` で上書き可能)

**holidays.js** (休日データベース)
- 2026-2027年の日本の祝日
- その他の年はフォールバックロジック（固定祝日のみ）
- `findFreeSlots` と `findFreeSlotsForAttendees` で使用

**sidepanel.js** (UIコントローラー)
- 会話履歴を管理 (セッションのみ、永続化しない)
- `conversationHistory` には最大20メッセージ（10往復）を保持
- コンテキスト用に `scheduler.processMessage()` に履歴を渡す

### データフロー

```
ユーザー入力 → sidepanel.js
            ↓
         scheduler.processMessage()
            ↓
         openai-api.parseScheduleIntent() [conversationHistory付き]
            ↓
         返り値: { action, eventQuery, date, newDate, ... }
            ↓
         scheduler.handleMoveEvent() / handleCreateEvent() / など
            ↓
         calendar-api.findEventsByDate() / findFreeSlotsForAttendees()
            ↓
         openai-api.generateSuggestions()
            ↓
         scheduler.currentContext に保存
            ↓
         返り値: { type: 'suggestions', suggestions: [...], event: {...} }
            ↓
         sidepanel.js が提案 + イベント情報を表示
            ↓
         ユーザー: "1" or "それで" or "14時以降がいいな"
            ↓
         scheduler.handleContextualResponse()
            ↓
         時間条件の場合: refineTimeSlots()
         選択の場合: updateEvent() してコンテキストをクリア
```

## 重要な実装詳細

### 会話コンテキスト管理

`scheduler.currentContext` は絞り込み操作（「14時以降がいいな」など）を通じて永続化する必要があります:
- **常に保持:** `type`, `event`, `humanAttendees`, `roomResources`, `freeSlots`
- **更新のみ:** `suggestions`
- **コンテキストクリア:** イベント作成/更新成功後、または明示的なキャンセル時

### 数字選択パターン

ユーザーは以下で提案を選択できます:
1. 明示的: "1番目", "2番", "3つ目" → 正規表現: `/(\d+)\s*(番目|番|つ目)/`
2. 単純な数字: "1", "2", "3" → コンテキストが存在し `/^(\d+)$/` にマッチする場合のみ
3. これにより「14時以降」が14番目の選択として誤解されるのを防ぐ

### 参加者 vs 会議室リソース

Google Calendar APIの参加者には人間と会議室 (`@resource.calendar.google.com`) の両方が含まれます:
- **会議室の検出:** `attendee.resource === true` OR メールに `@resource.calendar.google.com` を含む
- **表示:** "参加者: 2名 / 会議室: 1室 (全員の空き時間を考慮)"
- **Freebusy検索:** すべて（人間 + 会議室）を空き時間確認に含める

### イベントクエリの正規化

ユーザーが「今日の予定を教えて」と言った場合:
- ❌ `eventQuery: "今日の予定"` (「今日の予定」というタイトルのイベントを検索)
- ✅ `eventQuery: null` (指定日のすべてのイベントを返す)

AIプロンプトで「すべてのイベント」クエリには `eventQuery: null` または空文字列を設定するよう明示的に指示。

### 休日フィルタリング

デフォルト動作: 週末 + 日本の祝日を提案から除外。
上書き: ユーザーが「休日でも良い」「土日でも大丈夫」などと明示した場合のみ。
- `includeHolidays: true` → `findFreeSlots` オプションに渡す
- 実装: ループ内で `holidayManager.isNonWorkingDay(date)` をチェック

### 日付の曖昧性処理

ユーザーが「別の日にずらしたい」と言った場合:
- AIは `newDate: null` を設定（具体的な日付ではない）
- スケジューラーは元のイベント日から2週間分を検索
- 複数の日付オプションを生成

ユーザーが「2月4日に移動」と指定した場合:
- AIは `newDate: "2026-02-04"` を設定
- スケジューラーはその特定の日のみ検索（時刻未指定なら+7日）

## よくある変更

### 新しい意図アクションの追加

1. `openai-api.js` のプロンプトにアクションを追加 (63-76行)
2. 使用例を追加 (121-145行)
3. `scheduler.js` のswitch文にcaseを追加 (33-68行)
4. ハンドラーメソッドを実装: `async handleXxx(intent) { ... }`

### AI動作の修正

`openai-api.js` のシステムプロンプトを編集:
- **意図解析:** `parseScheduleIntent()` 46-147行
- **提案生成:** `generateSuggestions()` 174-195行
- **会話:** `generateResponse()` 253-255行

Temperature設定:
- 意図解析: 0.3 (決定論的)
- 提案: 0.7 (創造的)
- 会話: 0.7 (自然)

### UI動作の変更

**ウェルカムメッセージ:** `sidepanel.html` 27-31行 (静的) + `sidepanel.js` 158-166行 (クリア時)
**イベント情報表示:** `sidepanel.js` `addEventInfo()` 274-310行
**提案ボタン:** `sidepanel.js` `addSuggestionButtons()` 312-349行

## 主要な制約と設計判断

1. **会話の永続化なし:** ウィンドウを閉じると履歴がクリアされる（ユーザーの要望）
2. **セッションベースのコンテキスト:** `currentContext` はストレージに保存しない
3. **クライアントサイドのみ:** すべての処理はローカル、バックエンドサーバーなし
4. **マニフェストにOAuthなし:** ユーザーが自身のGoogle Cloud認証情報を提供（ハードコードしない）
5. **Arcブラウザ互換性:** ネイティブサイドパネルAPIではなくポップアップウィンドウ
6. **日本語IME対応:** `e.isComposing` チェックで変換中のEnterキーで誤送信を防止
7. **柔軟な検索:** ストップワード除去によるキーワード抽出でイベントマッチング精度向上
8. **複数参加者対応:** Freebusy APIですべての参加者 + 会議室の空き状況を考慮

## テストシナリオ

修正後、以下を確認:

1. **コンテキスト保持:** 初回提案後の「14時以降がいいな」が機能するか
2. **数字選択:** 「1」と「1番目」の両方で最初のオプションが選択されるか
3. **会議室フィルタリング:** 表示が「参加者: X名 / 会議室: Y室」となり、合計数でないか
4. **休日除外:** 明示的にリクエストしない限り週末/休日が提案されないか
5. **すべてのイベントクエリ:** 「今日の予定」で全イベント表示、「今日の予定」という名前のイベント検索にならないか
6. **曖昧な日付:** 「別の日」で2週間にわたる複数の日付オプションが生成されるか
7. **会話処理:** 「こんにちは」「なにができるの」「私はさっきなんて言った？」が action: "other" を使用するか

## OAuth設定

ユーザーは以下が必要:
1. Google Cloudプロジェクトを作成
2. Google Calendar APIを有効化
3. OAuth 2.0 Webアプリケーション認証情報を作成
4. リダイレクトURIを追加: `https://[拡張機能ID].chromiumapp.org/`
5. OAuth同意画面でテストユーザーとして自分を追加

拡張機能IDは設定ページの「セットアップ手順を表示」セクションに表示されます。
