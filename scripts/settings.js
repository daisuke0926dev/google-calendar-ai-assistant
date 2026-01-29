// 設定画面の処理

// DOM要素
const backBtn = document.getElementById('backBtn');
const openaiKeyInput = document.getElementById('openaiKey');
const toggleOpenaiKeyBtn = document.getElementById('toggleOpenaiKey');
const openaiModelSelect = document.getElementById('openaiModel');
const openaiStatus = document.getElementById('openaiStatus');
const showSetupGuideBtn = document.getElementById('showSetupGuide');
const setupGuide = document.getElementById('setupGuide');
const redirectUri = document.getElementById('redirectUri');
const copyRedirectUriBtn = document.getElementById('copyRedirectUri');
const googleClientIdInput = document.getElementById('googleClientId');
const googleClientSecretInput = document.getElementById('googleClientSecret');
const toggleGoogleSecretBtn = document.getElementById('toggleGoogleSecret');
const googleAuthBtn = document.getElementById('googleAuthBtn');
const authBtnText = document.getElementById('authBtnText');
const googleStatus = document.getElementById('googleStatus');
const autoConfirmCheckbox = document.getElementById('autoConfirm');
const businessHoursStartInput = document.getElementById('businessHoursStart');
const businessHoursEndInput = document.getElementById('businessHoursEnd');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const saveStatus = document.getElementById('saveStatus');

// 初期化
async function initialize() {
  // 拡張機能IDを取得してリダイレクトURIを表示
  const extensionId = chrome.runtime.id;
  redirectUri.textContent = `https://${extensionId}.chromiumapp.org/`;

  await loadSettings();
  setupEventListeners();
  await checkGoogleAuthStatus();
}

/**
 * 設定を読み込み
 */
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get([
      'openaiKey',
      'openaiModel',
      'googleClientId',
      'googleClientSecret',
      'autoConfirm',
      'businessHoursStart',
      'businessHoursEnd'
    ]);

    if (data.openaiKey) {
      openaiKeyInput.value = data.openaiKey;
    }

    if (data.openaiModel) {
      openaiModelSelect.value = data.openaiModel;
    }

    if (data.googleClientId) {
      googleClientIdInput.value = data.googleClientId;
    }

    if (data.googleClientSecret) {
      googleClientSecretInput.value = data.googleClientSecret;
    }

    autoConfirmCheckbox.checked = data.autoConfirm || false;
    businessHoursStartInput.value = data.businessHoursStart || '09:00';
    businessHoursEndInput.value = data.businessHoursEnd || '18:00';
  } catch (error) {
    console.error('設定読み込みエラー:', error);
  }
}

/**
 * イベントリスナーを設定
 */
function setupEventListeners() {
  // 戻るボタン
  backBtn.addEventListener('click', () => {
    window.location.href = 'sidepanel.html';
  });

  // セットアップガイドの表示/非表示
  showSetupGuideBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (setupGuide.style.display === 'none') {
      setupGuide.style.display = 'block';
      showSetupGuideBtn.textContent = 'セットアップ手順を非表示';
    } else {
      setupGuide.style.display = 'none';
      showSetupGuideBtn.textContent = 'セットアップ手順を表示';
    }
  });

  // リダイレクトURIのコピー
  copyRedirectUriBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(redirectUri.textContent);
      copyRedirectUriBtn.textContent = 'コピー済み!';
      setTimeout(() => {
        copyRedirectUriBtn.textContent = 'コピー';
      }, 2000);
    } catch (error) {
      console.error('コピーエラー:', error);
    }
  });

  // OpenAI APIキーの表示切り替え
  toggleOpenaiKeyBtn.addEventListener('click', () => {
    if (openaiKeyInput.type === 'password') {
      openaiKeyInput.type = 'text';
      toggleOpenaiKeyBtn.textContent = '🙈';
    } else {
      openaiKeyInput.type = 'password';
      toggleOpenaiKeyBtn.textContent = '👁️';
    }
  });

  // Google Client Secretの表示切り替え
  toggleGoogleSecretBtn.addEventListener('click', () => {
    if (googleClientSecretInput.type === 'password') {
      googleClientSecretInput.type = 'text';
      toggleGoogleSecretBtn.textContent = '🙈';
    } else {
      googleClientSecretInput.type = 'password';
      toggleGoogleSecretBtn.textContent = '👁️';
    }
  });

  // Google認証
  googleAuthBtn.addEventListener('click', handleGoogleAuth);

  // 保存ボタン
  saveBtn.addEventListener('click', handleSave);

  // リセットボタン
  resetBtn.addEventListener('click', handleReset);

  // 入力変更時にステータスをクリア
  [openaiKeyInput, openaiModelSelect, googleClientIdInput, googleClientSecretInput, autoConfirmCheckbox, businessHoursStartInput, businessHoursEndInput].forEach(element => {
    element.addEventListener('change', () => {
      hideStatus(saveStatus);
    });
  });
}

/**
 * Google認証状態を確認
 */
async function checkGoogleAuthStatus() {
  try {
    const data = await chrome.storage.local.get(['googleAccessToken']);
    if (data.googleAccessToken) {
      updateGoogleStatus(true);
    } else {
      updateGoogleStatus(false);
    }
  } catch (error) {
    updateGoogleStatus(false);
  }
}

/**
 * Google認証を処理
 */
async function handleGoogleAuth() {
  try {
    // まず設定が保存されているか確認
    const clientId = googleClientIdInput.value.trim();
    const clientSecret = googleClientSecretInput.value.trim();

    if (!clientId || !clientSecret) {
      showStatus(googleStatus, 'Client IDとClient Secretを入力して保存してください', 'error');
      return;
    }

    googleAuthBtn.disabled = true;
    authBtnText.textContent = '認証中...';

    // calendar-api.jsのauthenticate関数を呼び出す
    const result = await calendarAPI.authenticate();

    if (result.success) {
      updateGoogleStatus(true);
      showStatus(googleStatus, 'Google認証に成功しました', 'success');
    } else {
      updateGoogleStatus(false);
      showStatus(googleStatus, `認証に失敗しました: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Google認証エラー:', error);
    updateGoogleStatus(false);
    showStatus(googleStatus, `認証に失敗しました: ${error.message}`, 'error');
  } finally {
    googleAuthBtn.disabled = false;
    authBtnText.textContent = 'Googleアカウントで認証';
  }
}

/**
 * Google認証状態を更新
 */
function updateGoogleStatus(isAuthenticated) {
  if (isAuthenticated) {
    authBtnText.textContent = '✓ 認証済み';
    googleAuthBtn.classList.add('connected');
  } else {
    authBtnText.textContent = 'Googleアカウントで認証';
    googleAuthBtn.classList.remove('connected');
  }
}

/**
 * 設定を保存
 */
async function handleSave() {
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    const openaiKey = openaiKeyInput.value.trim();

    // OpenAI APIキーの検証
    if (openaiKey && !openaiKey.startsWith('sk-')) {
      showStatus(saveStatus, 'OpenAI APIキーの形式が正しくありません', 'error');
      return;
    }

    // 営業時間の検証
    const startTime = businessHoursStartInput.value;
    const endTime = businessHoursEndInput.value;
    if (startTime >= endTime) {
      showStatus(saveStatus, '営業時間の開始は終了よりも前である必要があります', 'error');
      return;
    }

    // 設定を保存
    await chrome.storage.local.set({
      openaiKey: openaiKey,
      openaiModel: openaiModelSelect.value,
      googleClientId: googleClientIdInput.value.trim(),
      googleClientSecret: googleClientSecretInput.value.trim(),
      autoConfirm: autoConfirmCheckbox.checked,
      businessHoursStart: startTime,
      businessHoursEnd: endTime
    });

    // OpenAI APIの検証
    if (openaiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${openaiKey}`
          }
        });

        if (response.ok) {
          showStatus(openaiStatus, 'OpenAI APIキーは有効です', 'success');
        } else {
          showStatus(openaiStatus, 'APIキーが無効です', 'error');
          return;
        }
      } catch (error) {
        showStatus(openaiStatus, 'API接続に失敗しました', 'error');
        return;
      }
    }

    showStatus(saveStatus, '設定を保存しました', 'success');

    // 1秒後にサイドパネルに戻る
    setTimeout(() => {
      window.location.href = 'sidepanel.html';
    }, 1000);
  } catch (error) {
    console.error('保存エラー:', error);
    showStatus(saveStatus, `保存に失敗しました: ${error.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
}

/**
 * 設定をリセット
 */
async function handleReset() {
  if (!confirm('すべての設定をリセットしますか？')) {
    return;
  }

  try {
    // Chrome storageをクリア
    await chrome.storage.local.clear();

    // フォームをリセット
    openaiKeyInput.value = '';
    openaiModelSelect.value = 'gpt-4o';
    googleClientIdInput.value = '';
    googleClientSecretInput.value = '';
    autoConfirmCheckbox.checked = false;
    businessHoursStartInput.value = '09:00';
    businessHoursEndInput.value = '18:00';

    updateGoogleStatus(false);
    showStatus(saveStatus, '設定をリセットしました', 'success');
  } catch (error) {
    console.error('リセットエラー:', error);
    showStatus(saveStatus, `リセットに失敗しました: ${error.message}`, 'error');
  }
}

/**
 * ステータスメッセージを表示
 */
function showStatus(element, message, type = 'info') {
  element.textContent = message;
  element.className = 'status-message show ' + type;
}

/**
 * ステータスメッセージを非表示
 */
function hideStatus(element) {
  element.className = 'status-message';
}

// 初期化を実行
initialize();
