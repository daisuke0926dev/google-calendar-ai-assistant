// OpenAI API連携モジュール

class OpenAIAPI {
  constructor() {
    this.apiKey = null;
    this.model = 'gpt-4o';
    this.baseURL = 'https://api.openai.com/v1/chat/completions';
  }

  /**
   * APIキーを設定
   */
  async setApiKey(key) {
    this.apiKey = key;
    await chrome.storage.local.set({ openaiKey: key });
  }

  /**
   * モデルを設定
   */
  async setModel(model) {
    this.model = model;
    await chrome.storage.local.set({ openaiModel: model });
  }

  /**
   * 保存された設定を読み込み
   */
  async loadSettings() {
    const data = await chrome.storage.local.get(['openaiKey', 'openaiModel']);
    this.apiKey = data.openaiKey || null;
    this.model = data.openaiModel || 'gpt-4o';
  }

  /**
   * 自然言語からスケジュール操作の意図を抽出
   * @param {string} userMessage - ユーザーのメッセージ
   * @param {Array} recentEvents - 最近のイベント（コンテキスト用）
   * @param {Array} conversationHistory - 会話履歴
   */
  async parseScheduleIntent(userMessage, recentEvents = [], conversationHistory = []) {
    if (!this.apiKey) {
      throw new Error('OpenAI APIキーが設定されていません');
    }

    const systemPrompt = `あなたはGoogleカレンダーのスケジュール管理アシスタントです。
ユーザーの自然言語でのリクエストを解析し、スケジュール操作の意図を抽出してください。

重要な指示：
1. 会話の文脈を考慮して、代名詞（「それ」「その予定」「翌日」など）や省略された情報を補完してください
2. 「翌日」は、直前に言及された日付の翌日を指します（例：2月3日の翌日 = 2月4日）
3. 「〜して」「〜やって」「お願い」などは、直前の提案に対する肯定的な応答として扱ってください
4. イベント名は会話の文脈から推測してください
5. **eventQueryは検索に使うキーワードのみを抽出してください**
   - ❌ 「1on1の予定」「ミーティングのイベント」「今日の予定」「明日の予定」
   - ✅ 「1on1」「ミーティング」
   - 不要な単語（「の予定」「イベント」「今日の」「明日の」など）は含めない
   - **「今日の予定」「明日の予定」「今週の予定」のように、すべての予定を見たい場合はeventQueryをnullまたは空文字列にする**
6. **移動先の日付指定について**
   - 「別の日」「他の日」「空いてる日」のように曖昧な場合は、newDateを指定しない（nullにする）
   - 具体的な日付（「3月5日に」「来週火曜日に」など）が指定された場合のみnewDateを設定
   - needsSuggestion: trueの場合、newDateはnullにすべき

利用可能なアクション：
- move: イベントの日時を移動
- create: 新しいイベントを作成
- delete: イベントを削除
- query: イベントを検索・照会（**具体的な日付やイベント名が指定されている場合のみ**）
- update: イベントの詳細を変更（タイトル、説明、場所など）
- respond: 招待への参加/不参加を回答
- bulk_respond: 複数のイベントに対して一括で参加/不参加を回答
- add_attendees: 参加者を追加
- remove_attendees: 参加者を削除
- set_reminder: リマインダーを設定
- create_recurring: 繰り返しイベントを作成
- confirm: 提案への確認
- other: その他の会話（雑談、質問、挨拶など、カレンダー操作を伴わないもの）

**重要**: 以下の場合は必ず action: "other" を使用してください：
- 挨拶や雑談（「こんにちは」「ありがとう」「調子はどう？」など）
- 会話履歴に関する質問（「私はさっきなんて言った？」「前に何を話した？」など）
- アシスタント自身に関する質問（「あなたは誰？」「何ができるの？」など）
- 具体的なカレンダー操作を求めていない質問

以下のJSON形式で回答してください：

{
  "action": "move" | "create" | "delete" | "query" | "update" | "respond" | "bulk_respond" | "add_attendees" | "remove_attendees" | "set_reminder" | "create_recurring" | "confirm" | "other",
  "eventQuery": "対象イベントの検索クエリ（会話から推測）",
  "date": "YYYY-MM-DD形式の日付（対象イベントが存在する日付。move/delete/update/queryの場合は必須）",
  "dateRange": {  // 日付範囲（bulk_respondの場合）
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD"
  },
  "filterCondition": "未回答のみ" | "仮承諾のみ" | "全て",  // フィルター条件（bulk_respondの場合）
  "newDate": "YYYY-MM-DD形式の新しい日付（moveの場合）",
  "newTime": "HH:MM形式の新しい時刻（オプション）",
  "duration": 60,  // 分単位
  "title": "イベントのタイトル（update/createの場合）",
  "description": "イベントの説明（update/createの場合）",
  "location": "場所（update/createの場合）",
  "attendees": ["email1@example.com", "email2@example.com"],  // 参加者（add_attendees/createの場合）
  "responseStatus": "accepted" | "declined" | "tentative",  // 参加ステータス（respond/bulk_respondの場合）
  "reminderMinutes": 30,  // リマインダーの時間（分）
  "recurrence": {  // 繰り返しルール（create_recurringの場合）
    "frequency": "daily" | "weekly" | "monthly" | "yearly",
    "interval": 1,  // 間隔
    "count": 10,  // 繰り返し回数（オプション）
    "until": "YYYY-MM-DD",  // 終了日（オプション）
    "byDay": ["MO", "WE", "FR"]  // 曜日指定（weeklyの場合、オプション）
  },
  "needsSuggestion": true,  // 時間提案が必要か
  "includeHolidays": false,  // 休日・祝日も含めるか（デフォルト: false）
  "userResponse": "肯定的" | "否定的" | null,  // 提案への応答
  "confidence": 0.0-1.0  // 解析の確信度
}

【重要】includeHolidaysについて：
- ユーザーが「休日でも良い」「土日でも大丈夫」「祝日でも構わない」など明示した場合のみtrue
- 特に指定がない場合はfalse（平日のみ提案）

【使用例】
1. 「来月の予定で参加にしていないやつ全部不参加にして」
→ action: "bulk_respond", dateRange: {start: "2026-03-01", end: "2026-03-31"}, filterCondition: "未回答のみ", responseStatus: "declined"

2. 「来月の23日にある1on1の予定、別の日にずらしたいんだけどどこが良い？」
→ action: "move", eventQuery: "1on1", date: "2026-02-23", newDate: null, needsSuggestion: true

3. 「2月8日のISR定例を2月4日に移動させて」
→ action: "move", eventQuery: "ISR定例", date: "2026-02-08", newDate: "2026-02-04", needsSuggestion: true

4. 「今日の予定を教えて」「今日の予定は？」
→ action: "query", eventQuery: null, date: "2026-01-29" (今日の日付)

5. 「明日の会議は何時から？」
→ action: "query", eventQuery: "会議", date: "2026-01-30" (明日の日付)

6. 「こんにちは」「ありがとう」「調子はどう？」
→ action: "other"

7. 「私はさっきなんて言った？」「前に何を話した？」
→ action: "other"

8. 「あなたは誰？」「何ができるの？」
→ action: "other"

今日の日付: ${new Date().toISOString().split('T')[0]}`;

    const userContext = recentEvents.length > 0
      ? `\n\n最近のイベント:\n${recentEvents.map(e => `- ${e.summary} (${e.start.dateTime || e.start.date})`).join('\n')}`
      : '';

    try {
      // 会話履歴を含めたメッセージを構築
      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-6), // 最新6件の会話履歴を使用
        { role: 'user', content: userMessage + userContext }
      ];

      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: 0.3,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API Error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      console.log('[parseScheduleIntent] AI応答:', content);
      const parsed = JSON.parse(content);
      console.log('[parseScheduleIntent] 解析結果:', parsed);
      return parsed;
    } catch (error) {
      console.error('意図解析エラー:', error);
      throw error;
    }
  }

  /**
   * スケジュール提案を生成
   * @param {Object} intent - 解析された意図
   * @param {Array} freeSlots - 空き時間のリスト
   */
  async generateSuggestions(intent, freeSlots) {
    if (!this.apiKey) {
      throw new Error('OpenAI APIキーが設定されていません');
    }

    const systemPrompt = `あなたはスケジュール提案のエキスパートです。
ユーザーの要求と空き時間を考慮して、最適なスケジュールを提案してください。

【最重要】ユーザーが日付を明示的に指定している場合：
- その日付の空き時間「のみ」を提案してください
- 他の日付を提案に含めないでください
- その日に空きがない場合は、その旨を伝えてください

指定がない場合は、早い日付から順に提案してください。

回答は以下のJSON形式で提供してください：

{
  "suggestions": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "reason": "提案理由（簡潔に）"
    }
  ],
  "message": "ユーザーへの自然な提案メッセージ"
}`;

    const userPrompt = `
リクエスト: ${JSON.stringify(intent)}
${intent.newDate ? `\n【必須】指定日付: ${intent.newDate}\n→ この日付の時間帯のみを提案してください。他の日付は含めないでください。` : '\n複数の日付から選択可能です。候補日を分散させて提案してください。'}

利用可能な空き時間:
${freeSlots.slice(0, 15).map((slot, i) => {
  const dateStr = slot.start.toISOString().split('T')[0];
  const timeStr = `${slot.start.getHours()}:${String(slot.start.getMinutes()).padStart(2, '0')}`;
  return `${i + 1}. ${dateStr} ${timeStr} (${Math.floor(slot.duration)}分)`;
}).join('\n')}

上記から最適な3つの時間帯を提案してください。
${intent.newDate ? `\n【重要】${intent.newDate}の時間帯のみを選択してください。` : ''}`;

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API Error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('提案生成エラー:', error);
      throw error;
    }
  }

  /**
   * 通常の会話応答を生成
   * @param {string} userMessage - ユーザーメッセージ
   * @param {Array} conversationHistory - 会話履歴
   */
  async generateResponse(userMessage, conversationHistory = []) {
    if (!this.apiKey) {
      throw new Error('OpenAI APIキーが設定されていません');
    }

    const systemPrompt = `あなたは親しみやすいGoogleカレンダーアシスタントです。
ユーザーのスケジュール管理をサポートしてください。
簡潔で自然な日本語で応答してください。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API Error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('応答生成エラー:', error);
      throw error;
    }
  }

  /**
   * 日時をフォーマット
   */
  formatDateTime(date) {
    const d = new Date(date);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    return `${month}月${day}日 ${hours}:${String(minutes).padStart(2, '0')}`;
  }
}

// グローバルインスタンスをエクスポート
const openaiAPI = new OpenAIAPI();
