// ポップアップメニューの処理

const openChatBtn = document.getElementById('openChatBtn');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const statusDiv = document.getElementById('status');

// 初期化
async function initialize() {
  await checkStatus();
  setupEventListeners();
}

/**
 * 状態を確認
 */
async function checkStatus() {
  try {
    const data = await chrome.storage.local.get([
      'openaiKey',
      'googleClientId',
      'googleClientSecret',
      'googleAccessToken'
    ]);

    const hasOpenAI = !!data.openaiKey;
    const hasGoogle = !!data.googleClientId && !!data.googleClientSecret;
    const hasAuth = !!data.googleAccessToken;

    if (hasOpenAI && hasGoogle && hasAuth) {
      updateStatus('準備完了', 'ready');
    } else {
      const missing = [];
      if (!hasOpenAI) missing.push('OpenAI API');
      if (!hasGoogle) missing.push('Google設定');
      if (!hasAuth) missing.push('Google認証');
      updateStatus(`設定が必要: ${missing.join(', ')}`, 'error');
    }
  } catch (error) {
    console.error('状態確認エラー:', error);
    updateStatus('設定を確認してください', 'error');
  }
}

/**
 * イベントリスナーを設定
 */
function setupEventListeners() {
  // チャットを開くボタン
  openChatBtn.addEventListener('click', () => {
    console.log('チャットを開くボタンがクリックされました');
    openChatPage();
  });

  // 設定を開くボタン
  openSettingsBtn.addEventListener('click', () => {
    console.log('設定を開くボタンがクリックされました');
    openSettingsPage();
  });
}

/**
 * チャットページを開く
 */
async function openChatPage() {
  try {
    const url = chrome.runtime.getURL('sidepanel.html');
    console.log('サイドバーウィンドウでチャットを開きます');

    // 既存のカレンダーAIウィンドウを検索
    const windows = await chrome.windows.getAll({ populate: true });
    const existingWindow = windows.find(win =>
      win.tabs && win.tabs.some(tab => tab.url === url)
    );

    if (existingWindow) {
      // 既存のウィンドウがあればフォーカス
      console.log('既存のウィンドウをフォーカス');
      await chrome.windows.update(existingWindow.id, { focused: true });
      updateStatus('ウィンドウをフォーカスしました', 'ready');
    } else {
      // 新しいサイドバー風ウィンドウを作成
      console.log('新しいサイドバーウィンドウを作成');

      // ブラウザにウィンドウ位置を任せて、サイズのみ指定
      await chrome.windows.create({
        url: url,
        type: 'popup',
        width: 400,
        height: 700,
        focused: true
        // left と top を指定しないことで、ブラウザが安全な位置に配置
      });

      updateStatus('ウィンドウを開きました', 'ready');
    }

    // ポップアップを閉じる
    window.close();
  } catch (error) {
    console.error('エラー:', error);
    updateStatus(`エラー: ${error.message}`, 'error');
  }
}

/**
 * 設定ページを開く
 */
async function openSettingsPage() {
  try {
    const url = chrome.runtime.getURL('settings.html');
    console.log('設定ウィンドウを開きます');

    // 既存の設定ウィンドウを検索
    const windows = await chrome.windows.getAll({ populate: true });
    const existingWindow = windows.find(win =>
      win.tabs && win.tabs.some(tab => tab.url === url)
    );

    if (existingWindow) {
      // 既存のウィンドウがあればフォーカス
      console.log('既存の設定ウィンドウをフォーカス');
      await chrome.windows.update(existingWindow.id, { focused: true });
      updateStatus('ウィンドウをフォーカスしました', 'ready');
    } else {
      // 新しいポップアップウィンドウを作成
      console.log('新しい設定ウィンドウを作成');

      await chrome.windows.create({
        url: url,
        type: 'popup',
        width: 600,
        height: 700,
        focused: true
      });

      updateStatus('設定ウィンドウを開きました', 'ready');
    }

    // ポップアップを閉じる
    window.close();
  } catch (error) {
    console.error('エラー:', error);
    updateStatus(`エラー: ${error.message}`, 'error');
  }
}

/**
 * ステータスを更新
 */
function updateStatus(text, type = 'normal') {
  statusDiv.textContent = text;
  statusDiv.className = 'status';
  if (type === 'ready') {
    statusDiv.classList.add('ready');
  } else if (type === 'error') {
    statusDiv.classList.add('error');
  }
}

// 初期化を実行
initialize();
