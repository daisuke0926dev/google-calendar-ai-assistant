// Google Calendar API連携モジュール（OAuth 2.0 手動実装版）

class CalendarAPI {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.calendarId = 'primary';
    this.clientId = null;
    this.clientSecret = null;
  }

  /**
   * 設定を読み込み
   */
  async loadSettings() {
    const data = await chrome.storage.local.get([
      'googleClientId',
      'googleClientSecret',
      'googleAccessToken',
      'googleRefreshToken',
      'googleTokenExpiry'
    ]);

    this.clientId = data.googleClientId;
    this.clientSecret = data.googleClientSecret;
    this.accessToken = data.googleAccessToken;
    this.refreshToken = data.googleRefreshToken;
    this.tokenExpiry = data.googleTokenExpiry;
  }

  /**
   * Google認証を実行（OAuth 2.0 Authorization Code Flow）
   */
  async authenticate() {
    try {
      await this.loadSettings();

      if (!this.clientId || !this.clientSecret) {
        return {
          success: false,
          error: 'Client IDとClient Secretが設定されていません'
        };
      }

      const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
      // Freebusy APIを使用するために calendar と calendar.events の両方が必要
      const scopes = [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly'
      ];
      const scope = scopes.join(' ');

      // 認証URLを構築
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', this.clientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scope);
      authUrl.searchParams.append('access_type', 'offline');
      authUrl.searchParams.append('prompt', 'consent');

      // OAuth認証フローを開始
      let responseUrl;
      try {
        responseUrl = await chrome.identity.launchWebAuthFlow({
          url: authUrl.toString(),
          interactive: true
        });
      } catch (authError) {
        console.error('認証フロー中のエラー:', authError);

        // ユーザーがキャンセルした場合
        if (authError.message && authError.message.includes('did not approve')) {
          return {
            success: false,
            error: '認証がキャンセルされました。Google Cloud Consoleの設定を確認してください：\n1. OAuth同意画面でテストユーザーに自分のメールアドレスが追加されているか\n2. リダイレクトURIが正しく設定されているか（' + redirectUri + '）'
          };
        }

        return { success: false, error: authError.message };
      }

      // レスポンスURLから認証コードを取得
      const url = new URL(responseUrl);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        return { success: false, error: `認証エラー: ${error}` };
      }

      if (!code) {
        return { success: false, error: '認証コードの取得に失敗しました' };
      }

      // 認証コードをアクセストークンに交換
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          code: code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        return {
          success: false,
          error: `トークン取得エラー: ${error.error_description || error.error}`
        };
      }

      const tokenData = await tokenResponse.json();

      // トークンを保存
      this.accessToken = tokenData.access_token;
      this.refreshToken = tokenData.refresh_token;
      this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);

      await chrome.storage.local.set({
        googleAccessToken: this.accessToken,
        googleRefreshToken: this.refreshToken,
        googleTokenExpiry: this.tokenExpiry
      });

      return { success: true, token: this.accessToken };
    } catch (error) {
      console.error('認証エラー:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * アクセストークンを取得（必要に応じてリフレッシュ）
   */
  async getToken() {
    await this.loadSettings();

    // トークンが期限切れかチェック
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    // リフレッシュトークンがあればトークンをリフレッシュ
    if (this.refreshToken) {
      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token'
          })
        });

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          this.accessToken = tokenData.access_token;
          this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);

          await chrome.storage.local.set({
            googleAccessToken: this.accessToken,
            googleTokenExpiry: this.tokenExpiry
          });

          return this.accessToken;
        }
      } catch (error) {
        console.error('トークンリフレッシュエラー:', error);
      }
    }

    return null;
  }

  /**
   * 認証を解除
   */
  async signOut() {
    if (this.accessToken) {
      try {
        // Googleのトークン失効エンドポイントを呼び出す
        await fetch(`https://oauth2.googleapis.com/revoke?token=${this.accessToken}`, {
          method: 'POST'
        });
      } catch (error) {
        console.error('トークン失効エラー:', error);
      }
    }

    // ローカルストレージをクリア
    await chrome.storage.local.remove([
      'googleAccessToken',
      'googleRefreshToken',
      'googleTokenExpiry'
    ]);

    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;

    return { success: true };
  }

  /**
   * カレンダーイベントを取得
   * @param {Date} startDate - 開始日
   * @param {Date} endDate - 終了日
   */
  async getEvents(startDate, endDate) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    const timeMin = startDate.toISOString();
    const timeMax = endDate.toISOString();

    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events`);
    url.searchParams.append('timeMin', timeMin);
    url.searchParams.append('timeMax', timeMax);
    url.searchParams.append('singleEvents', 'true');
    url.searchParams.append('orderBy', 'startTime');

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error('イベント取得エラー:', error);
      throw error;
    }
  }

  /**
   * 特定のイベントを取得
   * @param {string} eventId - イベントID
   */
  async getEvent(eventId) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('イベント取得エラー:', error);
      throw error;
    }
  }

  /**
   * 日付でイベントを検索
   * @param {string} query - 検索クエリ（イベント名など）
   * @param {Date} date - 検索対象日付
   */
  async findEventsByDate(query, date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const events = await this.getEvents(startOfDay, endOfDay);

    if (!query) {
      return events;
    }

    console.log('[findEventsByDate] クエリ:', query);
    console.log('[findEventsByDate] その日のイベント:', events.map(e => e.summary));

    // クエリを柔軟に処理
    const normalizedQuery = this.normalizeSearchQuery(query);
    console.log('[findEventsByDate] 正規化後のキーワード:', normalizedQuery);

    // 柔軟な部分一致検索
    return events.filter(event => {
      const summary = event.summary || '';
      const normalizedSummary = summary.toLowerCase().replace(/\s+/g, '');

      // いずれかのキーワードがマッチすればOK
      return normalizedQuery.some(keyword => {
        const match = normalizedSummary.includes(keyword);
        if (match) {
          console.log(`[findEventsByDate] マッチ: "${summary}" ← "${keyword}"`);
        }
        return match;
      });
    });
  }

  /**
   * 検索クエリを正規化（より柔軟な検索のため）
   * @param {string} query - 元のクエリ
   * @returns {Array<string>} 正規化されたキーワードの配列
   */
  normalizeSearchQuery(query) {
    // 不要な単語を除去
    const stopWords = ['の予定', 'イベント', '予定', 'ミーティング', '会議', 'mtg', 'meeting'];
    let normalized = query;

    stopWords.forEach(word => {
      normalized = normalized.replace(new RegExp(word, 'gi'), ' ');
    });

    // 空白で分割してキーワード化
    const keywords = normalized
      .split(/\s+/)
      .map(k => k.toLowerCase().trim())
      .filter(k => k.length > 0);

    // 元のクエリもキーワードに含める（完全一致も試す）
    keywords.push(query.toLowerCase().replace(/\s+/g, ''));

    // 重複を削除
    return [...new Set(keywords)];
  }

  /**
   * イベントを作成
   * @param {Object} eventData - イベントデータ
   */
  async createEvent(eventData) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventData)
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('イベント作成エラー:', error);
      throw error;
    }
  }

  /**
   * イベントを更新
   * @param {string} eventId - イベントID
   * @param {Object} eventData - 更新するイベントデータ
   */
  async updateEvent(eventId, eventData) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventData)
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('イベント更新エラー:', error);
      throw error;
    }
  }

  /**
   * イベントを削除
   * @param {string} eventId - イベントID
   */
  async deleteEvent(eventId) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return { success: true };
    } catch (error) {
      console.error('イベント削除エラー:', error);
      throw error;
    }
  }

  /**
   * 複数のカレンダーの空き状況を取得（Freebusy API）
   * @param {Date} startDate - 開始日
   * @param {Date} endDate - 終了日
   * @param {Array<string>} attendeeEmails - 参加者のメールアドレスリスト
   * @returns {Object} カレンダーごとのbusyな時間帯
   */
  async getFreeBusy(startDate, endDate, attendeeEmails = []) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    // 自分のカレンダーも含める
    const calendars = [{ id: 'primary' }];
    attendeeEmails.forEach(email => {
      if (email) {
        calendars.push({ id: email });
      }
    });

    console.log('[getFreeBusy] 検索対象カレンダー:', calendars);

    try {
      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            items: calendars
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Freebusy API Error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      console.log('[getFreeBusy] API応答:', data);
      return data.calendars;
    } catch (error) {
      console.error('Freebusy取得エラー:', error);
      throw error;
    }
  }

  /**
   * 空き時間を検索
   * @param {Date} startDate - 開始日
   * @param {Date} endDate - 終了日
   * @param {number} durationMinutes - 必要な時間（分）
   * @param {Object} options - オプション（businessHours等）
   */
  async findFreeSlots(startDate, endDate, durationMinutes, options = {}) {
    const events = await this.getEvents(startDate, endDate);
    const freeSlots = [];

    const businessHoursStart = options.businessHoursStart || 9;
    const businessHoursEnd = options.businessHoursEnd || 18;

    console.log('[findFreeSlots] 検索範囲:', startDate.toISOString(), '～', endDate.toISOString());
    console.log('[findFreeSlots] 必要時間:', durationMinutes, '分');
    console.log('[findFreeSlots] 営業時間:', businessHoursStart, '時 ～', businessHoursEnd, '時');

    // 日付ごとにループ
    const currentDate = new Date(startDate);
    while (currentDate < endDate) {
      // 休日・祝日を除外（オプションで指定された場合）
      const excludeHolidays = options.excludeHolidays !== false; // デフォルトはtrue
      if (excludeHolidays && holidayManager.isNonWorkingDay(currentDate)) {
        const holidayInfo = holidayManager.getHolidayInfo(currentDate);
        const reason = holidayInfo.isHoliday ? '祝日' : '週末';
        console.log(`[findFreeSlots] ${currentDate.toISOString().split('T')[0]} をスキップ (${reason})`);
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      const dayStart = new Date(currentDate);
      dayStart.setHours(businessHoursStart, 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(businessHoursEnd, 0, 0, 0);

      console.log('[findFreeSlots] 検索中の日付:', currentDate.toISOString().split('T')[0]);

      // その日のイベントを抽出（終日イベントは除外）
      const dayEvents = events.filter(event => {
        // 終日イベント（dateTimeがない）は除外
        if (!event.start.dateTime) {
          console.log('[findFreeSlots] 終日イベントをスキップ:', event.summary);
          return false;
        }
        const eventStart = new Date(event.start.dateTime);
        return eventStart.toDateString() === currentDate.toDateString();
      }).sort((a, b) => {
        const aStart = new Date(a.start.dateTime);
        const bStart = new Date(b.start.dateTime);
        return aStart - bStart;
      });

      console.log('[findFreeSlots] この日のイベント数:', dayEvents.length);
      dayEvents.forEach(e => {
        const start = new Date(e.start.dateTime);
        const end = new Date(e.end.dateTime);
        console.log('  -', e.summary, start.toLocaleTimeString('ja-JP'), '～', end.toLocaleTimeString('ja-JP'));
      });

      // 空き時間を検索
      let searchStart = dayStart;

      for (const event of dayEvents) {
        const eventStart = new Date(event.start.dateTime);
        const eventEnd = new Date(event.end.dateTime);

        // 空き時間が十分にあるか確認
        const gapMinutes = (eventStart - searchStart) / (1000 * 60);
        if (gapMinutes >= durationMinutes) {
          freeSlots.push({
            start: new Date(searchStart),
            end: new Date(eventStart),
            duration: gapMinutes
          });
        }

        searchStart = eventEnd > searchStart ? eventEnd : searchStart;
      }

      // 最後のイベントから終業時刻までの空き時間
      const remainingMinutes = (dayEnd - searchStart) / (1000 * 60);
      if (remainingMinutes >= durationMinutes) {
        freeSlots.push({
          start: new Date(searchStart),
          end: new Date(dayEnd),
          duration: remainingMinutes
        });
      }

      // 次の日へ
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log('[findFreeSlots] 見つかった空き時間の総数:', freeSlots.length);
    freeSlots.slice(0, 5).forEach((slot, i) => {
      console.log(`  ${i + 1}.`, slot.start.toLocaleString('ja-JP'), '～', slot.end.toLocaleString('ja-JP'), `(${Math.floor(slot.duration)}分)`);
    });

    return freeSlots;
  }

  /**
   * 参加者全員の空き時間を検索（Freebusy使用）
   * @param {Date} startDate - 開始日
   * @param {Date} endDate - 終了日
   * @param {number} durationMinutes - 必要な時間（分）
   * @param {Array<string>} attendeeEmails - 参加者のメールアドレスリスト
   * @param {Object} options - オプション（businessHours等）
   */
  async findFreeSlotsForAttendees(startDate, endDate, durationMinutes, attendeeEmails = [], options = {}) {
    console.log('[findFreeSlotsForAttendees] 参加者:', attendeeEmails);

    // Freebusy APIで全員の予定を取得
    const freeBusyData = await this.getFreeBusy(startDate, endDate, attendeeEmails);

    const businessHoursStart = options.businessHoursStart || 9;
    const businessHoursEnd = options.businessHoursEnd || 18;

    // 全員のbusyな時間帯を統合
    const allBusyPeriods = [];
    for (const [calendarId, calendarData] of Object.entries(freeBusyData)) {
      if (calendarData.busy) {
        console.log(`[findFreeSlotsForAttendees] ${calendarId} の予定数:`, calendarData.busy.length);
        calendarData.busy.forEach(busy => {
          allBusyPeriods.push({
            start: new Date(busy.start),
            end: new Date(busy.end),
            calendar: calendarId
          });
        });
      }
    }

    // 時間順にソート
    allBusyPeriods.sort((a, b) => a.start - b.start);
    console.log('[findFreeSlotsForAttendees] 全体の予定数:', allBusyPeriods.length);

    const freeSlots = [];

    // 日付ごとにループ
    const currentDate = new Date(startDate);
    while (currentDate < endDate) {
      // 休日・祝日を除外（オプションで指定された場合）
      const excludeHolidays = options.excludeHolidays !== false; // デフォルトはtrue
      if (excludeHolidays && holidayManager.isNonWorkingDay(currentDate)) {
        const holidayInfo = holidayManager.getHolidayInfo(currentDate);
        const reason = holidayInfo.isHoliday ? '祝日' : '週末';
        console.log(`[findFreeSlotsForAttendees] ${currentDate.toISOString().split('T')[0]} をスキップ (${reason})`);
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      const dayStart = new Date(currentDate);
      dayStart.setHours(businessHoursStart, 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(businessHoursEnd, 0, 0, 0);

      console.log('[findFreeSlotsForAttendees] 検索中の日付:', currentDate.toISOString().split('T')[0]);

      // その日のbusyな時間帯を抽出（重複を統合）
      const dayBusyPeriods = allBusyPeriods.filter(busy => {
        return busy.start.toDateString() === currentDate.toDateString() ||
               busy.end.toDateString() === currentDate.toDateString();
      });

      // 重複する時間帯を統合
      const mergedBusy = this.mergeBusyPeriods(dayBusyPeriods);
      console.log('[findFreeSlotsForAttendees] この日の予定（統合後）:', mergedBusy.length);

      // 空き時間を検索
      let searchStart = dayStart;

      for (const busy of mergedBusy) {
        const busyStart = busy.start < dayStart ? dayStart : busy.start;
        const busyEnd = busy.end > dayEnd ? dayEnd : busy.end;

        // 空き時間が十分にあるか確認
        const gapMinutes = (busyStart - searchStart) / (1000 * 60);
        if (gapMinutes >= durationMinutes) {
          freeSlots.push({
            start: new Date(searchStart),
            end: new Date(busyStart),
            duration: gapMinutes
          });
        }

        searchStart = busyEnd > searchStart ? busyEnd : searchStart;
      }

      // 最後の予定から終業時刻までの空き時間
      const remainingMinutes = (dayEnd - searchStart) / (1000 * 60);
      if (remainingMinutes >= durationMinutes) {
        freeSlots.push({
          start: new Date(searchStart),
          end: new Date(dayEnd),
          duration: remainingMinutes
        });
      }

      // 次の日へ
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log('[findFreeSlotsForAttendees] 見つかった空き時間の総数:', freeSlots.length);
    freeSlots.slice(0, 5).forEach((slot, i) => {
      console.log(`  ${i + 1}.`, slot.start.toLocaleString('ja-JP'), '～', slot.end.toLocaleString('ja-JP'), `(${Math.floor(slot.duration)}分)`);
    });

    return freeSlots;
  }

  /**
   * 重複するbusyな時間帯を統合
   * @param {Array} busyPeriods - busyな時間帯のリスト
   * @returns {Array} 統合された時間帯
   */
  mergeBusyPeriods(busyPeriods) {
    if (busyPeriods.length === 0) return [];

    // 開始時刻でソート
    const sorted = [...busyPeriods].sort((a, b) => a.start - b.start);
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      // 重複または連続している場合は統合
      if (current.start <= last.end) {
        last.end = current.end > last.end ? current.end : last.end;
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * 参加ステータスを更新（参加/不参加の回答）
   * @param {string} eventId - イベントID
   * @param {string} responseStatus - "accepted" | "declined" | "tentative"
   */
  async respondToEvent(eventId, responseStatus) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    console.log('[respondToEvent]', eventId, responseStatus);

    // まずイベントを取得
    const event = await this.getEvent(eventId);

    // 自分のメールアドレスを取得
    const userInfo = await this.getUserInfo();
    const myEmail = userInfo.email;

    console.log('[respondToEvent] 自分のメール:', myEmail);

    // 参加者リストから自分を探して更新
    if (!event.attendees) {
      event.attendees = [];
    }

    let found = false;
    event.attendees = event.attendees.map(attendee => {
      if (attendee.email === myEmail) {
        found = true;
        return { ...attendee, responseStatus };
      }
      return attendee;
    });

    // 参加者リストにいなければ追加
    if (!found) {
      event.attendees.push({
        email: myEmail,
        responseStatus
      });
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            attendees: event.attendees
          })
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('参加ステータス更新エラー:', error);
      throw error;
    }
  }

  /**
   * ユーザー情報を取得
   */
  async getUserInfo() {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    try {
      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/settings/timezone',
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      // メールアドレスを取得するためにカレンダーリストを使用
      const calResponse = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary',
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!calResponse.ok) {
        throw new Error(`API Error: ${calResponse.status}`);
      }

      const calData = await calResponse.json();
      return {
        email: calData.id,
        timezone: (await response.json()).value
      };
    } catch (error) {
      console.error('ユーザー情報取得エラー:', error);
      throw error;
    }
  }

  /**
   * イベントの詳細を部分更新
   * @param {string} eventId - イベントID
   * @param {Object} updates - 更新内容 { summary, description, location }
   */
  async updateEventDetails(eventId, updates) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    console.log('[updateEventDetails]', eventId, updates);

    const patchData = {};
    if (updates.title !== undefined) patchData.summary = updates.title;
    if (updates.description !== undefined) patchData.description = updates.description;
    if (updates.location !== undefined) patchData.location = updates.location;

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(patchData)
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('イベント詳細更新エラー:', error);
      throw error;
    }
  }

  /**
   * 参加者を追加
   * @param {string} eventId - イベントID
   * @param {Array<string>} emails - 追加する参加者のメールアドレスリスト
   */
  async addAttendees(eventId, emails) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    console.log('[addAttendees]', eventId, emails);

    // まずイベントを取得
    const event = await this.getEvent(eventId);

    if (!event.attendees) {
      event.attendees = [];
    }

    // 既存の参加者のメールアドレスセット
    const existingEmails = new Set(event.attendees.map(a => a.email));

    // 新しい参加者を追加
    emails.forEach(email => {
      if (!existingEmails.has(email)) {
        event.attendees.push({
          email: email,
          responseStatus: 'needsAction'
        });
      }
    });

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            attendees: event.attendees,
            sendUpdates: 'all' // 全員に通知を送信
          })
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('参加者追加エラー:', error);
      throw error;
    }
  }

  /**
   * 参加者を削除
   * @param {string} eventId - イベントID
   * @param {Array<string>} emails - 削除する参加者のメールアドレスリスト
   */
  async removeAttendees(eventId, emails) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    console.log('[removeAttendees]', eventId, emails);

    // まずイベントを取得
    const event = await this.getEvent(eventId);

    if (!event.attendees) {
      return event;
    }

    const emailsToRemove = new Set(emails);

    // 指定されたメールアドレスの参加者を除外
    event.attendees = event.attendees.filter(a => !emailsToRemove.has(a.email));

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            attendees: event.attendees,
            sendUpdates: 'all' // 全員に通知を送信
          })
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('参加者削除エラー:', error);
      throw error;
    }
  }

  /**
   * リマインダーを設定
   * @param {string} eventId - イベントID
   * @param {Array<number>} minutesBefore - リマインダーの時間（分前）のリスト
   */
  async setReminders(eventId, minutesBefore) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    console.log('[setReminders]', eventId, minutesBefore);

    const reminders = {
      useDefault: false,
      overrides: minutesBefore.map(minutes => ({
        method: 'popup',
        minutes: minutes
      }))
    };

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            reminders: reminders
          })
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('リマインダー設定エラー:', error);
      throw error;
    }
  }

  /**
   * 繰り返しイベントを作成
   * @param {Object} eventData - イベントデータ
   * @param {Object} recurrence - 繰り返しルール
   */
  async createRecurringEvent(eventData, recurrence) {
    console.log('[createRecurringEvent]', eventData, recurrence);

    // RFC 5545形式のRRULEを生成
    const rrule = this.buildRRule(recurrence);
    console.log('[createRecurringEvent] RRULE:', rrule);

    const eventWithRecurrence = {
      ...eventData,
      recurrence: [rrule]
    };

    return await this.createEvent(eventWithRecurrence);
  }

  /**
   * 繰り返しルールからRRULEを生成
   * @param {Object} recurrence - 繰り返しルール
   * @returns {string} RRULE文字列
   */
  buildRRule(recurrence) {
    const parts = ['RRULE:FREQ=' + recurrence.frequency.toUpperCase()];

    if (recurrence.interval && recurrence.interval > 1) {
      parts.push(`INTERVAL=${recurrence.interval}`);
    }

    if (recurrence.count) {
      parts.push(`COUNT=${recurrence.count}`);
    }

    if (recurrence.until) {
      // YYYY-MM-DD を YYYYMMDDThhmmssZ 形式に変換
      const untilDate = new Date(recurrence.until);
      const formatted = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      parts.push(`UNTIL=${formatted}`);
    }

    if (recurrence.byDay && recurrence.byDay.length > 0) {
      parts.push(`BYDAY=${recurrence.byDay.join(',')}`);
    }

    return parts.join(';');
  }

  /**
   * 高度な検索
   * @param {Object} searchParams - 検索パラメータ
   * @returns {Array} イベントリスト
   */
  async searchEvents(searchParams) {
    const token = await this.getToken();
    if (!token) {
      throw new Error('認証が必要です');
    }

    console.log('[searchEvents]', searchParams);

    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events`);

    if (searchParams.timeMin) {
      url.searchParams.append('timeMin', searchParams.timeMin.toISOString());
    }
    if (searchParams.timeMax) {
      url.searchParams.append('timeMax', searchParams.timeMax.toISOString());
    }
    if (searchParams.q) {
      url.searchParams.append('q', searchParams.q);
    }

    url.searchParams.append('singleEvents', 'true');
    url.searchParams.append('orderBy', 'startTime');

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error('イベント検索エラー:', error);
      throw error;
    }
  }
}

// グローバルインスタンスをエクスポート
const calendarAPI = new CalendarAPI();
