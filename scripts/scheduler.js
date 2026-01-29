// スケジュール管理・提案ロジック

class Scheduler {
  constructor(calendarAPI, openaiAPI) {
    this.calendar = calendarAPI;
    this.ai = openaiAPI;
    this.currentContext = null; // 現在の処理コンテキスト
    this.lastOperation = null; // 最後の操作（Undo用）
  }

  /**
   * ユーザーメッセージを処理
   * @param {string} message - ユーザーメッセージ
   * @param {Array} conversationHistory - 会話履歴
   */
  async processMessage(message, conversationHistory = []) {
    try {
      // コンテキストがある場合（提案への返答など）
      if (this.currentContext) {
        return await this.handleContextualResponse(message, conversationHistory);
      }

      // 自然言語から意図を抽出（会話履歴も渡す）
      const today = new Date();
      const nextMonth = new Date(today);
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const recentEvents = await this.calendar.getEvents(today, nextMonth);
      const intent = await this.ai.parseScheduleIntent(message, recentEvents.slice(0, 10), conversationHistory);

      console.log('解析された意図:', intent);

      // 意図に応じて処理を分岐
      switch (intent.action) {
        case 'move':
          return await this.handleMoveEvent(intent);

        case 'create':
          return await this.handleCreateEvent(intent);

        case 'delete':
          return await this.handleDeleteEvent(intent);

        case 'query':
          return await this.handleQuery(intent);

        case 'update':
          return await this.handleUpdateEvent(intent);

        case 'respond':
          return await this.handleRespondToEvent(intent);

        case 'bulk_respond':
          return await this.handleBulkRespond(intent);

        case 'add_attendees':
          return await this.handleAddAttendees(intent);

        case 'remove_attendees':
          return await this.handleRemoveAttendees(intent);

        case 'set_reminder':
          return await this.handleSetReminder(intent);

        case 'create_recurring':
          return await this.handleCreateRecurring(intent);

        case 'confirm':
          return await this.handleConfirmation(intent);

        default:
          // 通常の会話
          const response = await this.ai.generateResponse(message, conversationHistory);
          return {
            type: 'message',
            message: response
          };
      }
    } catch (error) {
      console.error('メッセージ処理エラー:', error);
      return {
        type: 'error',
        message: `エラーが発生しました: ${error.message}`
      };
    }
  }

  /**
   * イベント移動を処理
   */
  async handleMoveEvent(intent) {
    console.log('[handleMoveEvent] 解析された意図:', JSON.stringify(intent, null, 2));

    // 対象イベントを検索
    const targetDate = this.parseDate(intent.date);
    if (!targetDate) {
      console.error('[handleMoveEvent] 日付の解析に失敗:', intent.date);
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    console.log('[handleMoveEvent] 元の日付:', targetDate.toISOString());

    const events = await this.calendar.findEventsByDate(intent.eventQuery, targetDate);
    console.log('[handleMoveEvent] 見つかったイベント数:', events.length);

    if (events.length === 0) {
      return {
        type: 'message',
        message: `${intent.date}に「${intent.eventQuery}」に該当するイベントが見つかりませんでした。`
      };
    }

    const targetEvent = events[0]; // 最初にマッチしたイベント

    // イベントの参加者を取得
    const attendeeEmails = [];
    const humanAttendees = [];
    const roomResources = [];

    if (targetEvent.attendees && targetEvent.attendees.length > 0) {
      targetEvent.attendees.forEach(attendee => {
        if (attendee.email) {
          attendeeEmails.push(attendee.email);

          // 会議室リソースかどうかを判定
          if (attendee.resource || attendee.email.includes('@resource.calendar.google.com')) {
            roomResources.push(attendee.email);
          } else {
            humanAttendees.push(attendee.email);
          }
        }
      });
      console.log('[handleMoveEvent] 参加者（人間）:', humanAttendees);
      console.log('[handleMoveEvent] 会議室リソース:', roomResources);
      console.log('[handleMoveEvent] 全参加者（空き時間検索用）:', attendeeEmails);
    } else {
      console.log('[handleMoveEvent] 参加者なし（自分のみ）');
    }

    const eventDuration = this.calculateEventDuration(targetEvent);

    // 移動先の日付範囲を決定
    let newDate, searchEnd;

    if (intent.newDate) {
      // 具体的な日付が指定されている場合
      newDate = this.parseDate(intent.newDate);
      if (!newDate) {
        return {
          type: 'error',
          message: '移動先の日付を解析できませんでした。'
        };
      }

      // 時刻が指定されている場合は1週間分検索（柔軟性を持たせる）
      // 日付のみ指定の場合は、その日だけを検索
      searchEnd = new Date(newDate);
      if (intent.newTime) {
        searchEnd.setDate(searchEnd.getDate() + 7);
      } else {
        searchEnd.setDate(searchEnd.getDate() + 1); // 翌日の00:00 = その日の終わり
      }
    } else {
      // 日付が指定されていない場合（「別の日」など）
      // 元のイベントの翌日から2週間分を検索
      const originalDate = new Date(targetEvent.start.dateTime || targetEvent.start.date);
      newDate = new Date(originalDate);
      newDate.setDate(newDate.getDate() + 1); // 翌日から
      newDate.setHours(0, 0, 0, 0);

      searchEnd = new Date(newDate);
      searchEnd.setDate(searchEnd.getDate() + 14); // 2週間分

      console.log('[handleMoveEvent] 日付指定なし → 2週間分検索');
    }

    const settings = await chrome.storage.local.get(['businessHoursStart', 'businessHoursEnd']);

    // 休日を含めるかどうか
    const excludeHolidays = !intent.includeHolidays; // includeHolidaysがfalseなら除外する

    // 参加者がいる場合は全員の空き時間を考慮、いない場合は自分のみ
    const freeSlots = attendeeEmails.length > 0
      ? await this.calendar.findFreeSlotsForAttendees(
          newDate,
          searchEnd,
          eventDuration,
          attendeeEmails,
          {
            businessHoursStart: parseInt(settings.businessHoursStart) || 9,
            businessHoursEnd: parseInt(settings.businessHoursEnd) || 18,
            excludeHolidays: excludeHolidays
          }
        )
      : await this.calendar.findFreeSlots(
          newDate,
          searchEnd,
          eventDuration,
          {
            businessHoursStart: parseInt(settings.businessHoursStart) || 9,
            businessHoursEnd: parseInt(settings.businessHoursEnd) || 18,
            excludeHolidays: excludeHolidays
          }
        );

    if (freeSlots.length === 0) {
      const dateStr = newDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
      return {
        type: 'message',
        message: `申し訳ありません。${dateStr}に空き時間が見つかりませんでした。別の日付をご指定いただけますか？`
      };
    }

    // AIに提案を生成させる
    const suggestions = await this.ai.generateSuggestions(intent, freeSlots);

    // コンテキストを保存
    this.currentContext = {
      type: 'move',
      event: targetEvent,
      humanAttendees: humanAttendees,
      roomResources: roomResources,
      suggestions: suggestions.suggestions,
      freeSlots: freeSlots
    };

    return {
      type: 'suggestions',
      message: suggestions.message,
      event: {
        summary: targetEvent.summary,
        start: targetEvent.start.dateTime || targetEvent.start.date,
        attendees: attendeeEmails,  // 空き時間検索用（全員）
        humanAttendees: humanAttendees,  // 表示用（人間のみ）
        roomResources: roomResources  // 会議室リソース
      },
      suggestions: suggestions.suggestions
    };
  }

  /**
   * イベント作成を処理
   */
  async handleCreateEvent(intent) {
    const date = this.parseDate(intent.date);
    if (!date) {
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    // 検索範囲を決定
    // 時刻が指定されている場合は柔軟性を持たせて1週間分、
    // 日付のみの場合はその日だけを検索
    let searchEnd;
    if (intent.newTime) {
      searchEnd = new Date(date);
      searchEnd.setDate(searchEnd.getDate() + 7);
    } else {
      searchEnd = new Date(date);
      searchEnd.setDate(searchEnd.getDate() + 1); // その日のみ
    }

    const settings = await chrome.storage.local.get(['businessHoursStart', 'businessHoursEnd']);

    // 休日を含めるかどうか
    const excludeHolidays = !intent.includeHolidays;

    const freeSlots = await this.calendar.findFreeSlots(
      date,
      searchEnd,
      intent.duration || 60,
      {
        businessHoursStart: parseInt(settings.businessHoursStart) || 9,
        businessHoursEnd: parseInt(settings.businessHoursEnd) || 18,
        excludeHolidays: excludeHolidays
      }
    );

    if (freeSlots.length === 0) {
      const dateStr = date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
      return {
        type: 'message',
        message: `申し訳ありません。${dateStr}に空き時間が見つかりませんでした。別の日付をご指定いただけますか？`
      };
    }

    const suggestions = await this.ai.generateSuggestions(intent, freeSlots);

    this.currentContext = {
      type: 'create',
      title: intent.eventQuery,
      duration: intent.duration || 60,
      suggestions: suggestions.suggestions,
      freeSlots: freeSlots
    };

    return {
      type: 'suggestions',
      message: suggestions.message,
      suggestions: suggestions.suggestions
    };
  }

  /**
   * コンテキストに基づく応答を処理（提案への返答など）
   * @param {string} message - ユーザーメッセージ
   * @param {Array} conversationHistory - 会話履歴
   */
  async handleContextualResponse(message, conversationHistory = []) {
    console.log('[handleContextualResponse] メッセージ:', message);
    console.log('[handleContextualResponse] currentContext:', this.currentContext ? {
      type: this.currentContext.type,
      hasSuggestions: !!this.currentContext.suggestions,
      suggestionsCount: this.currentContext.suggestions?.length,
      hasEvent: !!this.currentContext.event
    } : null);

    const lowerMessage = message.toLowerCase().trim();

    // 時間条件の追加を検出（「14時以降」「午前中」など）
    const timeConstraintPatterns = [
      /(\d+)時以降/,
      /(\d+)時以前/,
      /(\d+)時から/,
      /(\d+)時まで/,
      /午前中/,
      /午後/,
      /夕方/,
      /朝/,
      /昼/
    ];
    const hasTimeConstraint = timeConstraintPatterns.some(pattern => pattern.test(message));

    // 時間条件がある場合は、現在の提案を再フィルタリング
    if (hasTimeConstraint && this.currentContext && this.currentContext.suggestions) {
      console.log('[handleContextualResponse] 時間条件を検出:', message);
      return await this.refineTimeSlots(message);
    }

    // 肯定的な応答パターン（より広範囲に）
    const positivePatterns = [
      'それで', 'お願い', 'はい', 'ok', 'yes', 'いいよ', 'それでいい',
      '1番目', '最初', 'やって', 'して', '頼む', 'よろしく', '了解'
    ];
    const isPositive = positivePatterns.some(pattern => lowerMessage.includes(pattern));

    // 「翌日」のパターンも検出
    const hasNextDay = lowerMessage.includes('翌日');

    // 数字による選択
    // 1. 「1番目」「2番」「3つ目」のような明示的な選択
    let numberMatch = message.match(/(\d+)\s*(番目|番|つ目)/);

    // 2. コンテキストがある場合は、単純な数字（1-9）も選択として扱う
    if (!numberMatch && this.currentContext && this.currentContext.suggestions) {
      // メッセージが単純な数字のみ、または数字で始まる短いメッセージの場合
      const simpleNumberMatch = message.trim().match(/^(\d+)$/);
      if (simpleNumberMatch) {
        const num = parseInt(simpleNumberMatch[1]);
        // 1-9の範囲内で、提案の数以下であれば選択として扱う
        if (num >= 1 && num <= this.currentContext.suggestions.length) {
          numberMatch = simpleNumberMatch;
          console.log('[handleContextualResponse] 単純な数字を選択として検出:', num);
        }
      }
    }

    let selectedIndex = numberMatch ? parseInt(numberMatch[1]) - 1 : 0;

    console.log('[handleContextualResponse] パターンマッチ:', {
      isPositive,
      numberMatch: numberMatch ? numberMatch[0] : null,
      hasNextDay,
      selectedIndex
    });

    // 「翌日」が含まれていて、現在のコンテキストがある場合、
    // 提案の中から翌日のものを探す
    if (hasNextDay && this.currentContext && this.currentContext.suggestions) {
      console.log('翌日パターン検出、提案から翌日を検索します');

      // 元のイベントの日付を取得
      let originalDate;
      if (this.currentContext.event) {
        originalDate = new Date(this.currentContext.event.start.dateTime || this.currentContext.event.start.date);
      }

      if (originalDate) {
        const nextDay = new Date(originalDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = nextDay.toISOString().split('T')[0];

        console.log('元の日付:', originalDate.toISOString().split('T')[0]);
        console.log('翌日:', nextDayStr);

        // 提案の中から翌日のものを探す
        const nextDayIndex = this.currentContext.suggestions.findIndex(s => s.date === nextDayStr);
        if (nextDayIndex !== -1) {
          selectedIndex = nextDayIndex;
          console.log('翌日の提案を選択:', selectedIndex);
        }
      }
    }

    if ((isPositive || numberMatch || hasNextDay) && this.currentContext && this.currentContext.suggestions) {
      console.log('[handleContextualResponse] 提案を選択:', {
        isPositive,
        numberMatch,
        hasNextDay,
        selectedIndex,
        contextType: this.currentContext.type
      });

      const suggestion = this.currentContext.suggestions[selectedIndex] || this.currentContext.suggestions[0];

      console.log('選択された提案:', suggestion);

      if (this.currentContext.type === 'move') {
        // イベントを移動
        const event = this.currentContext.event;

        // Undo用に元の情報を保存
        const originalStart = event.start;
        const originalEnd = event.end;

        const newDateTime = this.combineDateAndTime(suggestion.date, suggestion.time);
        const endDateTime = new Date(newDateTime);
        endDateTime.setMinutes(endDateTime.getMinutes() + this.calculateEventDuration(event));

        await this.calendar.updateEvent(event.id, {
          start: {
            dateTime: newDateTime.toISOString(),
            timeZone: 'Asia/Tokyo'
          },
          end: {
            dateTime: endDateTime.toISOString(),
            timeZone: 'Asia/Tokyo'
          }
        });

        // Undo履歴を保存
        this.lastOperation = {
          type: 'move',
          eventId: event.id,
          eventSummary: event.summary,
          originalStart: originalStart,
          originalEnd: originalEnd,
          newStart: {
            dateTime: newDateTime.toISOString(),
            timeZone: 'Asia/Tokyo'
          },
          newEnd: {
            dateTime: endDateTime.toISOString(),
            timeZone: 'Asia/Tokyo'
          }
        };

        this.currentContext = null;

        return {
          type: 'success',
          message: `「${event.summary}」を${suggestion.date} ${suggestion.time}に移動しました！`
        };
      } else if (this.currentContext.type === 'create') {
        // イベントを作成
        const title = this.currentContext.title;
        const newDateTime = this.combineDateAndTime(suggestion.date, suggestion.time);
        const endDateTime = new Date(newDateTime);
        endDateTime.setMinutes(endDateTime.getMinutes() + this.currentContext.duration);

        const createdEvent = await this.calendar.createEvent({
          summary: title,
          start: {
            dateTime: newDateTime.toISOString(),
            timeZone: 'Asia/Tokyo'
          },
          end: {
            dateTime: endDateTime.toISOString(),
            timeZone: 'Asia/Tokyo'
          }
        });

        // Undo履歴を保存
        this.lastOperation = {
          type: 'create',
          eventId: createdEvent.id,
          eventSummary: title
        };

        this.currentContext = null;

        return {
          type: 'success',
          message: `「${title}」を${suggestion.date} ${suggestion.time}に作成しました！`
        };
      }
    }

    // 否定的な応答の場合
    const negativePatterns = ['いいえ', 'no', 'やめて', 'キャンセル', 'だめ', '違う'];
    const isNegative = negativePatterns.some(pattern => lowerMessage.includes(pattern));

    if (isNegative) {
      this.currentContext = null;
      return {
        type: 'message',
        message: 'わかりました。キャンセルしました。'
      };
    }

    // それ以外の場合は通常の応答（会話履歴を含む）
    const response = await this.ai.generateResponse(message, conversationHistory);
    return {
      type: 'message',
      message: response
    };
  }

  /**
   * 時間条件で提案を絞り込む
   */
  async refineTimeSlots(message) {
    if (!this.currentContext || !this.currentContext.freeSlots) {
      return {
        type: 'message',
        message: '提案を絞り込むためのコンテキストが見つかりません。'
      };
    }

    console.log('[refineTimeSlots] 元の空き時間数:', this.currentContext.freeSlots.length);

    // 時間条件を抽出
    let minHour = null;
    let maxHour = null;

    const afterMatch = message.match(/(\d+)時以降/);
    if (afterMatch) {
      minHour = parseInt(afterMatch[1]);
      console.log('[refineTimeSlots] 条件: ' + minHour + '時以降');
    }

    const beforeMatch = message.match(/(\d+)時以前/);
    if (beforeMatch) {
      maxHour = parseInt(beforeMatch[1]);
      console.log('[refineTimeSlots] 条件: ' + maxHour + '時以前');
    }

    const fromMatch = message.match(/(\d+)時から/);
    if (fromMatch) {
      minHour = parseInt(fromMatch[1]);
      console.log('[refineTimeSlots] 条件: ' + minHour + '時から');
    }

    const toMatch = message.match(/(\d+)時まで/);
    if (toMatch) {
      maxHour = parseInt(toMatch[1]);
      console.log('[refineTimeSlots] 条件: ' + maxHour + '時まで');
    }

    if (message.includes('午前中')) {
      maxHour = 12;
      console.log('[refineTimeSlots] 条件: 午前中');
    }

    if (message.includes('午後')) {
      minHour = 12;
      console.log('[refineTimeSlots] 条件: 午後');
    }

    if (message.includes('朝')) {
      minHour = 6;
      maxHour = 10;
      console.log('[refineTimeSlots] 条件: 朝');
    }

    if (message.includes('昼')) {
      minHour = 11;
      maxHour = 14;
      console.log('[refineTimeSlots] 条件: 昼');
    }

    if (message.includes('夕方')) {
      minHour = 16;
      maxHour = 19;
      console.log('[refineTimeSlots] 条件: 夕方');
    }

    // freeSlotsをフィルタリング
    const filteredSlots = this.currentContext.freeSlots.filter(slot => {
      const hour = slot.start.getHours();
      if (minHour !== null && hour < minHour) return false;
      if (maxHour !== null && hour >= maxHour) return false;
      return true;
    });

    console.log('[refineTimeSlots] フィルタ後の空き時間数:', filteredSlots.length);

    if (filteredSlots.length === 0) {
      return {
        type: 'message',
        message: 'その時間帯には空きがありませんでした。他の条件をお試しください。'
      };
    }

    // AIに新しい提案を生成させる
    const intent = {
      eventQuery: this.currentContext.event ? this.currentContext.event.summary : '',
      newDate: null
    };
    const suggestions = await this.ai.generateSuggestions(intent, filteredSlots);

    // コンテキストを更新（元の情報は保持）
    this.currentContext.suggestions = suggestions.suggestions;

    console.log('[refineTimeSlots] 更新後のコンテキスト:', {
      type: this.currentContext.type,
      hasSuggestions: !!this.currentContext.suggestions,
      suggestionsCount: this.currentContext.suggestions?.length,
      hasEvent: !!this.currentContext.event,
      hasFreeSlots: !!this.currentContext.freeSlots
    });

    // moveの場合はイベント情報も返す
    const result = {
      type: 'suggestions',
      message: suggestions.message,
      suggestions: suggestions.suggestions
    };

    if (this.currentContext.type === 'move' && this.currentContext.event) {
      const attendeeEmails = this.currentContext.event.attendees
        ? this.currentContext.event.attendees.map(a => a.email)
        : [];

      result.event = {
        summary: this.currentContext.event.summary,
        start: this.currentContext.event.start.dateTime || this.currentContext.event.start.date,
        attendees: attendeeEmails,
        humanAttendees: this.currentContext.humanAttendees || [],
        roomResources: this.currentContext.roomResources || []
      };
    }

    return result;
  }

  /**
   * イベントの継続時間を計算（分単位）
   */
  calculateEventDuration(event) {
    const start = new Date(event.start.dateTime || event.start.date);
    const end = new Date(event.end.dateTime || event.end.date);
    return Math.round((end - start) / (1000 * 60));
  }

  /**
   * 日付文字列をDateオブジェクトに変換
   */
  parseDate(dateString) {
    if (!dateString) return null;

    try {
      // YYYY-MM-DD形式
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return new Date(dateString + 'T00:00:00');
      }

      // その他の形式は日付パーサーに任せる
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  /**
   * 日付と時刻を結合
   */
  combineDateAndTime(dateString, timeString) {
    return new Date(`${dateString}T${timeString}:00`);
  }

  /**
   * クエリ処理（イベント検索など）
   */
  async handleQuery(intent) {
    console.log('[handleQuery]', intent);

    // 日付範囲の設定
    let startDate, endDate;

    if (intent.date) {
      startDate = this.parseDate(intent.date);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    } else {
      // 日付指定がない場合は今日から1週間
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);
    }

    // 検索クエリがある場合は高度な検索を使用
    // eventQueryがnull、空文字列、または空白のみの場合は全件取得
    const hasQuery = intent.eventQuery && intent.eventQuery.trim() !== '';
    const events = hasQuery
      ? await this.calendar.searchEvents({
          timeMin: startDate,
          timeMax: endDate,
          q: intent.eventQuery.trim()
        })
      : await this.calendar.getEvents(startDate, endDate);

    console.log('[handleQuery] eventQuery:', intent.eventQuery, '→ hasQuery:', hasQuery, '→ 件数:', events.length);

    if (events.length === 0) {
      const dateStr = intent.date || '今後1週間';
      const queryStr = hasQuery ? `「${intent.eventQuery.trim()}」に該当する` : '';
      return {
        type: 'message',
        message: `${dateStr}には${queryStr}予定がありません。`
      };
    }

    // 日付でグループ化
    const eventsByDate = {};
    events.forEach(e => {
      const start = new Date(e.start.dateTime || e.start.date);
      const dateKey = start.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

      if (!eventsByDate[dateKey]) {
        eventsByDate[dateKey] = [];
      }

      const timeStr = e.start.dateTime
        ? start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
        : '終日';

      eventsByDate[dateKey].push(`  ${timeStr}: ${e.summary}`);
    });

    // フォーマット
    const formattedList = Object.entries(eventsByDate)
      .map(([date, eventList]) => `${date}\n${eventList.join('\n')}`)
      .join('\n\n');

    const queryStr = hasQuery ? `「${intent.eventQuery.trim()}」の` : '';
    return {
      type: 'message',
      message: `${queryStr}予定:\n\n${formattedList}`
    };
  }

  /**
   * 削除処理
   */
  async handleDeleteEvent(intent) {
    const date = this.parseDate(intent.date);
    const events = await this.calendar.findEventsByDate(intent.eventQuery, date);

    if (events.length === 0) {
      return {
        type: 'message',
        message: `該当するイベントが見つかりませんでした。`
      };
    }

    const event = events[0];

    // Undo用に削除前のイベント情報を保存
    this.lastOperation = {
      type: 'delete',
      event: JSON.parse(JSON.stringify(event)) // ディープコピー
    };

    await this.calendar.deleteEvent(event.id);

    return {
      type: 'success',
      message: `「${event.summary}」を削除しました。`
    };
  }

  /**
   * 確認処理
   */
  async handleConfirmation(intent) {
    return await this.handleContextualResponse(intent.userResponse || '');
  }

  /**
   * イベント詳細を更新
   */
  async handleUpdateEvent(intent) {
    const date = this.parseDate(intent.date);
    if (!date) {
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    const events = await this.calendar.findEventsByDate(intent.eventQuery, date);

    if (events.length === 0) {
      return {
        type: 'message',
        message: `${intent.date}に「${intent.eventQuery}」に該当するイベントが見つかりませんでした。`
      };
    }

    const event = events[0];
    const updates = {};

    if (intent.title) updates.title = intent.title;
    if (intent.description) updates.description = intent.description;
    if (intent.location) updates.location = intent.location;

    await this.calendar.updateEventDetails(event.id, updates);

    const updateParts = [];
    if (intent.title) updateParts.push(`タイトル: ${intent.title}`);
    if (intent.description) updateParts.push(`説明: ${intent.description}`);
    if (intent.location) updateParts.push(`場所: ${intent.location}`);

    return {
      type: 'success',
      message: `「${event.summary}」を更新しました。\n${updateParts.join('\n')}`
    };
  }

  /**
   * 参加/不参加の回答
   */
  async handleRespondToEvent(intent) {
    const date = this.parseDate(intent.date);
    if (!date) {
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    const events = await this.calendar.findEventsByDate(intent.eventQuery, date);

    if (events.length === 0) {
      return {
        type: 'message',
        message: `${intent.date}に「${intent.eventQuery}」に該当するイベントが見つかりませんでした。`
      };
    }

    const event = events[0];
    const statusMap = {
      'accepted': '参加',
      'declined': '不参加',
      'tentative': '仮承諾'
    };

    await this.calendar.respondToEvent(event.id, intent.responseStatus);

    return {
      type: 'success',
      message: `「${event.summary}」に「${statusMap[intent.responseStatus]}」で回答しました。`
    };
  }

  /**
   * 一括で参加/不参加を回答
   */
  async handleBulkRespond(intent) {
    console.log('[handleBulkRespond]', intent);

    if (!intent.dateRange || !intent.dateRange.start || !intent.dateRange.end) {
      return {
        type: 'error',
        message: '日付範囲の指定が必要です。'
      };
    }

    const startDate = this.parseDate(intent.dateRange.start);
    const endDate = this.parseDate(intent.dateRange.end);

    if (!startDate || !endDate) {
      return {
        type: 'error',
        message: '日付範囲の解析に失敗しました。'
      };
    }

    console.log('[handleBulkRespond] 期間:', startDate, '～', endDate);

    // 期間内のイベントを取得
    const events = await this.calendar.getEvents(startDate, endDate);
    console.log('[handleBulkRespond] 取得したイベント数:', events.length);

    // 自分のメールアドレスを取得
    const userInfo = await this.calendar.getUserInfo();
    const myEmail = userInfo.email;

    // フィルター条件に応じてイベントを絞り込み
    const targetEvents = events.filter(event => {
      // 自分が参加者として含まれているイベントのみ
      if (!event.attendees || event.attendees.length === 0) {
        return false; // 参加者がいないイベントはスキップ
      }

      const myAttendance = event.attendees.find(a => a.email === myEmail);
      if (!myAttendance) {
        return false; // 自分が参加者でないイベントはスキップ
      }

      // フィルター条件をチェック
      if (intent.filterCondition === '未回答のみ') {
        return myAttendance.responseStatus === 'needsAction';
      } else if (intent.filterCondition === '仮承諾のみ') {
        return myAttendance.responseStatus === 'tentative';
      } else if (intent.filterCondition === '全て') {
        return true;
      } else {
        // デフォルトは未回答のみ
        return myAttendance.responseStatus === 'needsAction' || !myAttendance.responseStatus;
      }
    });

    console.log('[handleBulkRespond] フィルター後のイベント数:', targetEvents.length);

    if (targetEvents.length === 0) {
      const conditionStr = intent.filterCondition || '未回答';
      return {
        type: 'message',
        message: `指定期間内に${conditionStr}のイベントが見つかりませんでした。`
      };
    }

    const statusMap = {
      'accepted': '参加',
      'declined': '不参加',
      'tentative': '仮承諾'
    };

    // 一括で回答を更新
    let successCount = 0;
    const processedEvents = [];
    const errors = [];

    for (const event of targetEvents) {
      try {
        await this.calendar.respondToEvent(event.id, intent.responseStatus);
        successCount++;

        // イベント情報を記録
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const dateStr = eventStart.toLocaleDateString('ja-JP', {
          month: 'numeric',
          day: 'numeric',
          weekday: 'short'
        });
        const timeStr = event.start.dateTime
          ? eventStart.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
          : '終日';

        processedEvents.push({
          summary: event.summary,
          date: dateStr,
          time: timeStr
        });

        console.log(`[handleBulkRespond] ${event.summary}: ${intent.responseStatus}`);
      } catch (error) {
        console.error(`[handleBulkRespond] エラー (${event.summary}):`, error);
        errors.push(event.summary);
      }
    }

    // 結果メッセージを生成
    let resultMessage = `${successCount}件のイベントに「${statusMap[intent.responseStatus]}」で回答しました。\n\n`;

    // 処理したイベントのリスト
    resultMessage += '【処理したイベント】\n';
    processedEvents.forEach((evt, index) => {
      resultMessage += `${index + 1}. ${evt.summary} (${evt.date} ${evt.time})\n`;
    });

    const errorMessage = errors.length > 0 ? `\n\n【失敗】\n${errors.join('\n')}` : '';

    return {
      type: 'success',
      message: resultMessage + errorMessage
    };
  }

  /**
   * 参加者を追加
   */
  async handleAddAttendees(intent) {
    const date = this.parseDate(intent.date);
    if (!date) {
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    const events = await this.calendar.findEventsByDate(intent.eventQuery, date);

    if (events.length === 0) {
      return {
        type: 'message',
        message: `${intent.date}に「${intent.eventQuery}」に該当するイベントが見つかりませんでした。`
      };
    }

    const event = events[0];

    if (!intent.attendees || intent.attendees.length === 0) {
      return {
        type: 'error',
        message: '追加する参加者のメールアドレスが指定されていません。'
      };
    }

    await this.calendar.addAttendees(event.id, intent.attendees);

    return {
      type: 'success',
      message: `「${event.summary}」に${intent.attendees.length}名の参加者を追加しました。`
    };
  }

  /**
   * 参加者を削除
   */
  async handleRemoveAttendees(intent) {
    const date = this.parseDate(intent.date);
    if (!date) {
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    const events = await this.calendar.findEventsByDate(intent.eventQuery, date);

    if (events.length === 0) {
      return {
        type: 'message',
        message: `${intent.date}に「${intent.eventQuery}」に該当するイベントが見つかりませんでした。`
      };
    }

    const event = events[0];

    if (!intent.attendees || intent.attendees.length === 0) {
      return {
        type: 'error',
        message: '削除する参加者のメールアドレスが指定されていません。'
      };
    }

    await this.calendar.removeAttendees(event.id, intent.attendees);

    return {
      type: 'success',
      message: `「${event.summary}」から${intent.attendees.length}名の参加者を削除しました。`
    };
  }

  /**
   * リマインダーを設定
   */
  async handleSetReminder(intent) {
    const date = this.parseDate(intent.date);
    if (!date) {
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    const events = await this.calendar.findEventsByDate(intent.eventQuery, date);

    if (events.length === 0) {
      return {
        type: 'message',
        message: `${intent.date}に「${intent.eventQuery}」に該当するイベントが見つかりませんでした。`
      };
    }

    const event = events[0];
    const reminderMinutes = intent.reminderMinutes || 30;

    await this.calendar.setReminders(event.id, [reminderMinutes]);

    return {
      type: 'success',
      message: `「${event.summary}」にリマインダーを設定しました（${reminderMinutes}分前）。`
    };
  }

  /**
   * 繰り返しイベントを作成
   */
  async handleCreateRecurring(intent) {
    const date = this.parseDate(intent.date);
    if (!date) {
      return {
        type: 'error',
        message: '日付の解析に失敗しました。'
      };
    }

    if (!intent.recurrence) {
      return {
        type: 'error',
        message: '繰り返しルールが指定されていません。'
      };
    }

    // 時刻が指定されている場合
    let startDateTime, endDateTime;
    if (intent.newTime) {
      startDateTime = this.combineDateAndTime(intent.date, intent.newTime);
      endDateTime = new Date(startDateTime);
      endDateTime.setMinutes(endDateTime.getMinutes() + (intent.duration || 60));
    } else {
      // 時刻が指定されていない場合は空き時間を検索
      const settings = await chrome.storage.local.get(['businessHoursStart', 'businessHoursEnd']);
      const searchEnd = new Date(date);
      searchEnd.setDate(searchEnd.getDate() + 1);

      // 休日を含めるかどうか
      const excludeHolidays = !intent.includeHolidays;

      const freeSlots = await this.calendar.findFreeSlots(
        date,
        searchEnd,
        intent.duration || 60,
        {
          businessHoursStart: parseInt(settings.businessHoursStart) || 9,
          businessHoursEnd: parseInt(settings.businessHoursEnd) || 18,
          excludeHolidays: excludeHolidays
        }
      );

      if (freeSlots.length === 0) {
        return {
          type: 'message',
          message: `${intent.date}に空き時間が見つかりませんでした。時刻を指定してください。`
        };
      }

      startDateTime = freeSlots[0].start;
      endDateTime = new Date(startDateTime);
      endDateTime.setMinutes(endDateTime.getMinutes() + (intent.duration || 60));
    }

    const eventData = {
      summary: intent.title || intent.eventQuery,
      description: intent.description || '',
      location: intent.location || '',
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Tokyo'
      }
    };

    const createdEvent = await this.calendar.createRecurringEvent(eventData, intent.recurrence);

    const freqMap = {
      'daily': '毎日',
      'weekly': '毎週',
      'monthly': '毎月',
      'yearly': '毎年'
    };

    return {
      type: 'success',
      message: `「${createdEvent.summary}」を${freqMap[intent.recurrence.frequency]}で作成しました。`
    };
  }

  /**
   * 直前の操作を取り消す
   */
  async undo() {
    if (!this.lastOperation) {
      return {
        type: 'message',
        message: '取り消せる操作がありません。'
      };
    }

    try {
      const operation = this.lastOperation;

      switch (operation.type) {
        case 'create':
          // 作成したイベントを削除
          await this.calendar.deleteEvent(operation.eventId);
          this.lastOperation = null;
          return {
            type: 'success',
            message: `「${operation.eventSummary}」の作成を取り消しました。`,
            undone: true
          };

        case 'move':
          // イベントを元の位置に戻す
          await this.calendar.updateEvent(operation.eventId, {
            start: operation.originalStart,
            end: operation.originalEnd
          });
          this.lastOperation = null;
          return {
            type: 'success',
            message: `「${operation.eventSummary}」の移動を取り消しました。`,
            undone: true
          };

        case 'delete':
          // 削除したイベントを復元
          const restoredEvent = await this.calendar.createEvent({
            summary: operation.event.summary,
            start: operation.event.start,
            end: operation.event.end,
            description: operation.event.description,
            location: operation.event.location,
            attendees: operation.event.attendees
          });
          this.lastOperation = null;
          return {
            type: 'success',
            message: `「${operation.event.summary}」の削除を取り消しました。`,
            undone: true
          };

        default:
          return {
            type: 'error',
            message: '不明な操作タイプです。'
          };
      }
    } catch (error) {
      console.error('Undo処理エラー:', error);
      return {
        type: 'error',
        message: `取り消し処理でエラーが発生しました: ${error.message}`
      };
    }
  }

  /**
   * Undo可能かどうかを確認
   */
  canUndo() {
    return this.lastOperation !== null;
  }
}

// グローバルインスタンスをエクスポート
const scheduler = new Scheduler(calendarAPI, openaiAPI);
