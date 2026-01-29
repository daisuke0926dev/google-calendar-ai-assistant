// プロンプトテンプレート管理モジュール

class PromptTemplateManager {
  constructor() {
    this.currentTemplate = null;
  }

  /**
   * 設定を読み込み
   */
  async loadSettings() {
    const data = await chrome.storage.local.get(['promptTemplate', 'customPrompts']);
    this.currentTemplate = data.promptTemplate || 'standard';
    this.customPrompts = data.customPrompts || {};
  }

  /**
   * テンプレートを設定
   */
  async setTemplate(templateId) {
    this.currentTemplate = templateId;
    await chrome.storage.local.set({ promptTemplate: templateId });
  }

  /**
   * カスタムプロンプトを保存
   */
  async saveCustomPrompt(templateId, promptData) {
    this.customPrompts[templateId] = promptData;
    await chrome.storage.local.set({ customPrompts: this.customPrompts });
  }

  /**
   * カスタムプロンプトを削除
   */
  async deleteCustomPrompt(templateId) {
    delete this.customPrompts[templateId];
    await chrome.storage.local.set({ customPrompts: this.customPrompts });
  }

  /**
   * 現在のテンプレートを取得
   */
  getCurrentTemplate() {
    const template = this.getTemplate(this.currentTemplate);
    if (!template) {
      console.warn(`テンプレート '${this.currentTemplate}' が見つかりません。標準テンプレートを使用します。`);
      return this.getTemplate('standard');
    }
    return template;
  }

  /**
   * テンプレートを取得
   */
  getTemplate(templateId) {
    // プリセットテンプレート
    if (PRESET_TEMPLATES[templateId]) {
      return PRESET_TEMPLATES[templateId];
    }

    // カスタムテンプレート
    if (this.customPrompts[templateId]) {
      return this.customPrompts[templateId];
    }

    return null;
  }

  /**
   * すべてのテンプレート一覧を取得
   */
  getAllTemplates() {
    const presets = Object.entries(PRESET_TEMPLATES).map(([id, template]) => ({
      id,
      ...template,
      isPreset: true
    }));

    const customs = Object.entries(this.customPrompts).map(([id, template]) => ({
      id,
      ...template,
      isPreset: false
    }));

    return [...presets, ...customs];
  }

  /**
   * 変数を置換
   */
  replaceVariables(text, variables = {}) {
    let result = text;

    // デフォルト変数
    const today = new Date().toISOString().split('T')[0];
    result = result.replace(/\{\{TODAY_DATE\}\}/g, today);

    // ユーザー定義変数
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, value);
    });

    return result;
  }

  /**
   * テンプレートをエクスポート
   */
  exportTemplate(templateId) {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`テンプレート '${templateId}' が見つかりません`);
    }

    const exportData = {
      version: '1.0',
      template: {
        id: templateId,
        ...template
      },
      exportedAt: new Date().toISOString()
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * テンプレートをインポート
   */
  async importTemplate(jsonString) {
    try {
      const data = JSON.parse(jsonString);

      // バージョンチェック
      if (data.version !== '1.0') {
        throw new Error('サポートされていないバージョンです');
      }

      const { template } = data;

      // バリデーション
      if (!template.name || !template.intentParsePrompt) {
        throw new Error('必須フィールドが不足しています');
      }

      // プリセットテンプレートの上書きを防ぐ
      if (PRESET_TEMPLATES[template.id]) {
        throw new Error('プリセットテンプレートは上書きできません');
      }

      // カスタムプロンプトとして保存
      await this.saveCustomPrompt(template.id, {
        name: template.name,
        description: template.description || '',
        intentParsePrompt: template.intentParsePrompt,
        suggestionPrompt: template.suggestionPrompt || PRESET_TEMPLATES.standard.suggestionPrompt,
        conversationPrompt: template.conversationPrompt || PRESET_TEMPLATES.standard.conversationPrompt
      });

      return template.id;
    } catch (error) {
      console.error('インポートエラー:', error);
      throw new Error(`テンプレートのインポートに失敗しました: ${error.message}`);
    }
  }
}

// プリセットテンプレート定義
const PRESET_TEMPLATES = {
  standard: {
    name: '標準',
    description: 'デフォルトのプロンプト。バランスの取れた応答スタイル',
    intentParsePrompt: `あなたはGoogleカレンダーのスケジュール管理アシスタントです。
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

今日の日付: {{TODAY_DATE}}`,

    suggestionPrompt: `あなたはスケジュール提案のエキスパートです。
ユーザーの要求と空き時間を考慮して、最適なスケジュールを提案してください。

【最重要】ユーザーが日付を明示的に指定している場合：
- その日付の空き時間「のみ」を提案してください
- 他の日付を提案に含めないでください
- その日に空きがない場合は、その旨を伝えてください

指定がない場合は、早い日付から順に提案してください。`,

    conversationPrompt: `あなたは親しみやすいGoogleカレンダーアシスタントです。
ユーザーのスケジュール管理をサポートしてください。
簡潔で自然な日本語で応答してください。`
  },

  business: {
    name: 'ビジネス',
    description: 'フォーマルな言葉遣い。ビジネスシーンに適した丁寧な対応',
    intentParsePrompt: `あなたはビジネス向けGoogleカレンダー管理アシスタントです。
ユーザー様の業務スケジュール管理を支援いたします。

重要な指示：
1. 会話の文脈を考慮し、代名詞や省略された情報を補完してください
2. 「翌日」「翌週」などの相対的な日付表現を正確に解釈してください
3. 「〜していただけますか」「お願いします」などの丁寧な表現も肯定的な指示として扱ってください
4. イベント名は文脈から推測し、ビジネス用語を適切に認識してください
5. **eventQueryは検索キーワードのみ抽出**
   - ❌ 「定例会議の予定」「MTGのイベント」
   - ✅ 「定例会議」「MTG」
6. **日付指定の解釈**
   - 「別の日程で」「他の日時で」は曖昧な指定
   - 「○月○日」「来週月曜日」は具体的な指定

利用可能なアクション：
- move: 予定の日時変更
- create: 新規予定作成
- delete: 予定削除
- query: 予定検索・照会
- update: 予定詳細変更
- respond: 出欠回答
- bulk_respond: 一括出欠回答
- add_attendees: 参加者追加
- remove_attendees: 参加者削除
- set_reminder: リマインダー設定
- create_recurring: 定期予定作成
- confirm: 提案確認
- other: 一般的な会話

**重要**: ビジネスマナーを考慮し、適切な敬語表現を使用してください。

本日の日付: {{TODAY_DATE}}`,

    suggestionPrompt: `あなたはビジネススケジュール調整の専門家です。
お客様のご要望と空き時間を分析し、最適な日程をご提案申し上げます。

【重要】日付指定がある場合：
- 指定された日付の空き時間のみをご提案ください
- 他の日程は含めないでください
- 空きがない場合は、その旨を丁寧にお伝えください

日付指定がない場合は、直近の日程から順にご提案いたします。`,

    conversationPrompt: `あなたはビジネス向けGoogleカレンダーアシスタントです。
お客様のスケジュール管理業務を丁寧にサポートいたします。
適切な敬語表現で、簡潔かつ分かりやすくご説明ください。`
  },

  casual: {
    name: 'カジュアル',
    description: 'フレンドリーな口調。友達感覚で気軽に使える',
    intentParsePrompt: `あなたは気さくなカレンダーアシスタントだよ！
友達のスケジュール管理を手伝う感じで、リラックスして対応してね。

大事なポイント：
1. 会話の流れから「それ」「あれ」とか省略されてる情報を読み取ってね
2. 「翌日」「次の日」は、さっき話してた日の次の日のこと
3. 「〜して」「やっといて」みたいな軽いノリもOKだよ
4. イベント名は会話から察してね
5. **eventQueryは検索ワードだけ**
   - ❌ 「飲み会の予定」「ミーティングのイベント」
   - ✅ 「飲み会」「ミーティング」
6. **日付の解釈**
   - 「別の日」「他の日」→ ふわっとした指定
   - 「3月5日」「来週火曜」→ ちゃんとした指定

使えるアクション：
- move: 予定を移動
- create: 新しい予定を作る
- delete: 予定を消す
- query: 予定を探す
- update: 予定の内容を変える
- respond: 出席・欠席の返事
- bulk_respond: まとめて返事
- add_attendees: 人を追加
- remove_attendees: 人を削除
- set_reminder: リマインダーをセット
- create_recurring: 繰り返しの予定を作る
- confirm: 提案の確認
- other: 普通の会話

**重要**: 「よろしく！」「ありがとう！」みたいな挨拶も普通に返してね。

今日: {{TODAY_DATE}}`,

    suggestionPrompt: `あなたはスケジュール調整が得意な友達だよ！
空いてる時間をチェックして、いい感じの候補を出してあげてね。

【ポイント】日付指定がある時：
- その日の空き時間だけ教えてあげて
- 他の日は出さないでね
- 空いてない時は「その日は埋まってるよ〜」って教えてあげて

日付指定がない時は、近い日から順番に提案してあげてね！`,

    conversationPrompt: `あなたは気さくなカレンダーアシスタントだよ！
友達のスケジュール管理を手伝う感じで対応してね。
カジュアルで分かりやすい日本語で話そう。`
  }
};

// グローバルインスタンスをエクスポート
const promptTemplateManager = new PromptTemplateManager();
