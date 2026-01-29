// サイドパネルのメイン処理

// DOM要素
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const undoBtn = document.getElementById('undoBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const settingsBtn = document.getElementById('settingsBtn');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');

// 会話履歴
let conversationHistory = [];

// 初期化
async function initialize() {
  // 設定を読み込み
  await openaiAPI.loadSettings();

  // 会話履歴は復元しない（毎回フレッシュな状態で開始）
  // await loadConversationHistory();

  // 状態を確認
  await checkStatus();

  // イベントリスナーを設定
  setupEventListeners();

  // Undoボタンの初期状態を設定
  updateUndoButton();
}

/**
 * 会話履歴をローカルストレージから読み込み
 */
async function loadConversationHistory() {
  try {
    const data = await chrome.storage.local.get(['conversationHistory', 'schedulerContext']);

    // 会話履歴を復元
    if (data.conversationHistory && Array.isArray(data.conversationHistory) && data.conversationHistory.length > 0) {
      conversationHistory = data.conversationHistory;
      console.log('会話履歴を復元しました:', conversationHistory.length, '件');

      // ウェルカムメッセージを削除
      const welcomeMsg = chatContainer.querySelector('.welcome-message');
      if (welcomeMsg) {
        welcomeMsg.remove();
      }

      // UIに過去のメッセージを表示
      conversationHistory.forEach((msg, index) => {
        if (index % 2 === 0 && msg.role === 'user') {
          addMessage('user', msg.content);
        } else if (msg.role === 'assistant') {
          addMessage('assistant', msg.content);
        }
      });
    }

    // コンテキストを復元
    if (data.schedulerContext) {
      scheduler.currentContext = data.schedulerContext;
      console.log('コンテキストを復元しました:', scheduler.currentContext);
    }
  } catch (error) {
    console.error('会話履歴の読み込みエラー:', error);
  }
}

/**
 * 会話履歴をローカルストレージに保存
 */
async function saveConversationHistory() {
  try {
    await chrome.storage.local.set({
      conversationHistory,
      schedulerContext: scheduler.currentContext
    });
  } catch (error) {
    console.error('会話履歴の保存エラー:', error);
  }
}

/**
 * 状態を確認
 */
async function checkStatus() {
  try {
    // Google認証状態を確認
    const token = await calendarAPI.getToken();
    const hasOpenAIKey = openaiAPI.apiKey !== null;

    if (token && hasOpenAIKey) {
      updateStatus('準備完了', 'connected');
      sendBtn.disabled = false;
    } else {
      const missing = [];
      if (!token) missing.push('Google認証');
      if (!hasOpenAIKey) missing.push('OpenAI APIキー');
      updateStatus(`設定が必要です: ${missing.join(', ')}`, 'error');
      sendBtn.disabled = true;
    }
  } catch (error) {
    console.error('状態確認エラー:', error);
    updateStatus('設定を確認してください', 'error');
    sendBtn.disabled = true;
  }
}

/**
 * イベントリスナーを設定
 */
function setupEventListeners() {
  // 送信ボタン
  sendBtn.addEventListener('click', handleSendMessage);

  // Enterキーで送信（Shift+Enterで改行、日本語変換中は無効）
  messageInput.addEventListener('keydown', (e) => {
    // IME変換中（日本語入力中）はEnterを無視
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // 入力時の自動リサイズ
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';

    // 送信ボタンの有効/無効
    sendBtn.disabled = messageInput.value.trim() === '';
  });

  // 設定ボタン
  settingsBtn.addEventListener('click', () => {
    window.location.href = 'settings.html';
  });

  // 会話履歴クリアボタン
  clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('会話履歴をすべてクリアしますか？')) {
      conversationHistory = [];
      scheduler.currentContext = null; // コンテキストもクリア
      scheduler.lastOperation = null; // Undo履歴もクリア
      // 保存しない（元々保存していないため）
      // await saveConversationHistory();

      // チャット画面をクリア
      const messages = chatContainer.querySelectorAll('.message');
      messages.forEach(msg => msg.remove());

      // 提案ボタンもクリア
      const suggestions = chatContainer.querySelectorAll('.suggestion-buttons');
      suggestions.forEach(s => s.remove());

      // イベント情報もクリア
      const eventInfos = chatContainer.querySelectorAll('.message-bubble[style*="fff3e0"]');
      eventInfos.forEach(e => e.parentElement.remove());

      // 既存のウェルカムメッセージもクリア
      const existingWelcome = chatContainer.querySelectorAll('.welcome-message');
      existingWelcome.forEach(w => w.remove());

      // ウェルカムメッセージを再表示
      const welcomeDiv = document.createElement('div');
      welcomeDiv.className = 'welcome-message';
      welcomeDiv.innerHTML = `
        <p>こんにちは！</p>
        <p>自然な言葉でスケジュール管理をお手伝いします。</p>
        <p>例: 「2月3日の会議、翌日に移動させといて」</p>
      `;
      chatContainer.appendChild(welcomeDiv);

      // Undoボタンの状態を更新
      updateUndoButton();

      console.log('会話履歴とコンテキストをクリアしました');
    }
  });

  // Undoボタン
  undoBtn.addEventListener('click', async () => {
    if (!scheduler.canUndo()) {
      return;
    }

    try {
      undoBtn.disabled = true;
      updateStatus('操作を取り消しています...', 'processing');

      const result = await scheduler.undo();

      if (result.undone) {
        // 成功メッセージを表示
        addMessage('assistant', result.message);

        // 会話履歴から直前のユーザーメッセージとアシスタント応答を削除
        if (conversationHistory.length >= 2) {
          conversationHistory.pop(); // アシスタントメッセージ
          conversationHistory.pop(); // ユーザーメッセージ
        }

        // チャットUIから直前のメッセージを削除
        const messages = chatContainer.querySelectorAll('.message');
        if (messages.length >= 2) {
          messages[messages.length - 1].remove(); // アシスタントメッセージ
          messages[messages.length - 2].remove(); // ユーザーメッセージ
        }

        // 提案ボタンもクリア
        const suggestions = chatContainer.querySelectorAll('.suggestion-buttons');
        if (suggestions.length > 0) {
          suggestions[suggestions.length - 1].remove();
        }

        // イベント情報もクリア
        const eventInfos = chatContainer.querySelectorAll('.event-info');
        if (eventInfos.length > 0) {
          eventInfos[eventInfos.length - 1].remove();
        }

        updateStatus('準備完了', 'connected');
      } else {
        addMessage('assistant', result.message);
        updateStatus('準備完了', 'connected');
      }

      // Undoボタンの状態を更新
      updateUndoButton();
    } catch (error) {
      console.error('Undo処理エラー:', error);
      addMessage('assistant', `エラーが発生しました: ${error.message}`);
      updateStatus('エラー', 'error');
      updateUndoButton();
    }
  });
}

/**
 * メッセージを送信
 */
async function handleSendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // ユーザーメッセージを表示
  addMessage('user', message);

  // 入力欄をクリア
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  // ローディング表示
  const loadingId = addLoadingIndicator();

  try {
    // メッセージを処理
    const result = await scheduler.processMessage(message, conversationHistory);

    // ローディングを削除
    removeLoadingIndicator(loadingId);

    // 結果に応じて表示
    switch (result.type) {
      case 'suggestions':
        addMessage('assistant', result.message);
        if (result.event) {
          addEventInfo(result.event);
        }
        addSuggestionButtons(result.suggestions);
        break;

      case 'success':
        addMessage('assistant', result.message, 'success');
        break;

      case 'error':
        addMessage('assistant', result.message, 'error');
        break;

      case 'message':
      default:
        addMessage('assistant', result.message);
        break;
    }

    // 会話履歴を更新（セッション内のみで保持、ページを閉じたら消える）
    conversationHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: result.message }
    );

    // 履歴が長すぎる場合は古いものを削除（最新20件=10往復を保持）
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }

    // 会話履歴は保存しない（ページを閉じたらリセット）
    // await saveConversationHistory();

    // Undoボタンの状態を更新
    updateUndoButton();
  } catch (error) {
    console.error('メッセージ処理エラー:', error);
    removeLoadingIndicator(loadingId);
    addMessage('assistant', `エラーが発生しました: ${error.message}`, 'error');
  }
}

/**
 * メッセージを追加
 */
function addMessage(role, content, type = 'normal') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (type === 'success') {
    bubble.style.background = '#e7f5e9';
    bubble.style.color = '#2e7d32';
  } else if (type === 'error') {
    bubble.style.background = '#fdecea';
    bubble.style.color = '#c62828';
  }
  bubble.textContent = content;

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  messageDiv.appendChild(bubble);
  messageDiv.appendChild(time);

  chatContainer.appendChild(messageDiv);
  scrollToBottom();
}

/**
 * イベント情報を表示
 */
function addEventInfo(event) {
  console.log('[addEventInfo] イベント情報:', event);

  const eventDiv = document.createElement('div');
  eventDiv.className = 'message assistant';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.style.background = '#fff3e0';
  bubble.style.borderLeft = '4px solid #ff9800';

  // event.start は文字列として渡されているはず
  const startDate = event.start ? new Date(event.start).toLocaleString('ja-JP') : '日時不明';

  // 参加者情報
  let attendeesHtml = '';
  const humanCount = event.humanAttendees ? event.humanAttendees.length : (event.attendees ? event.attendees.length : 0);
  const roomCount = event.roomResources ? event.roomResources.length : 0;

  if (humanCount > 0 || roomCount > 0) {
    const parts = [];
    if (humanCount > 0) {
      parts.push(`参加者: ${humanCount}名`);
    }
    if (roomCount > 0) {
      parts.push(`会議室: ${roomCount}室`);
    }
    attendeesHtml = `<br><small>${parts.join(' / ')} (全員の空き時間を考慮)</small>`;
  }

  bubble.innerHTML = `
    <strong>対象イベント:</strong><br>
    ${event.summary}<br>
    <small>${startDate}</small>${attendeesHtml}
  `;

  eventDiv.appendChild(bubble);
  chatContainer.appendChild(eventDiv);
  scrollToBottom();
}

/**
 * 提案ボタンを追加
 */
function addSuggestionButtons(suggestions) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';

  const buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'suggestion-buttons';

  suggestions.forEach((suggestion, index) => {
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = `${index + 1}. ${suggestion.date} ${suggestion.time}`;
    if (suggestion.reason) {
      btn.title = suggestion.reason;
    }

    btn.addEventListener('click', async () => {
      // ボタンを無効化
      buttonsContainer.querySelectorAll('button').forEach(b => b.disabled = true);

      // 選択をメッセージとして送信
      addMessage('user', `${index + 1}番目でお願いします`);

      const loadingId = addLoadingIndicator();

      try {
        const result = await scheduler.handleContextualResponse(`${index + 1}`);
        removeLoadingIndicator(loadingId);

        if (result.type === 'success') {
          addMessage('assistant', result.message, 'success');
        } else {
          addMessage('assistant', result.message);
        }
      } catch (error) {
        removeLoadingIndicator(loadingId);
        addMessage('assistant', `エラーが発生しました: ${error.message}`, 'error');
      }
    });

    buttonsContainer.appendChild(btn);
  });

  messageDiv.appendChild(buttonsContainer);
  chatContainer.appendChild(messageDiv);
  scrollToBottom();
}

/**
 * ローディングインジケーターを追加
 */
function addLoadingIndicator() {
  const loadingId = 'loading-' + Date.now();
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.id = loadingId;

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading-indicator';
  loadingDiv.innerHTML = `
    <div class="loading-dot"></div>
    <div class="loading-dot"></div>
    <div class="loading-dot"></div>
  `;

  messageDiv.appendChild(loadingDiv);
  chatContainer.appendChild(messageDiv);
  scrollToBottom();

  return loadingId;
}

/**
 * ローディングインジケーターを削除
 */
function removeLoadingIndicator(loadingId) {
  const element = document.getElementById(loadingId);
  if (element) {
    element.remove();
  }
}

/**
 * ステータスを更新
 */
function updateStatus(text, type = 'normal') {
  statusText.textContent = text;
  statusBar.className = 'status-bar';
  if (type === 'connected') {
    statusBar.classList.add('connected');
  } else if (type === 'error') {
    statusBar.classList.add('error');
  }
}

/**
 * Undoボタンの状態を更新
 */
function updateUndoButton() {
  if (scheduler.canUndo()) {
    undoBtn.disabled = false;
    undoBtn.style.opacity = '1';
  } else {
    undoBtn.disabled = true;
    undoBtn.style.opacity = '0.5';
  }
}

/**
 * 最下部にスクロール
 */
function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// 初期化を実行
initialize();
