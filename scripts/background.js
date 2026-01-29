// バックグラウンドスクリプト - サイドパネルの管理とメッセージング

/**
 * サイドバー風のウィンドウを開く
 */
async function openSidebarWindow() {
  try {
    const url = chrome.runtime.getURL('sidepanel.html');

    // 既存のカレンダーAIウィンドウを検索
    const windows = await chrome.windows.getAll({ populate: true });
    const existingWindow = windows.find(win =>
      win.tabs && win.tabs.some(tab => tab.url === url)
    );

    if (existingWindow) {
      // 既存のウィンドウがあればフォーカス
      console.log('既存のサイドバーウィンドウをフォーカス');
      await chrome.windows.update(existingWindow.id, { focused: true });
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

      console.log('サイドバーウィンドウを作成しました');
    }
  } catch (error) {
    console.error('サイドバーウィンドウ作成エラー:', error);
  }
}

// インストール時の処理
chrome.runtime.onInstalled.addListener(() => {
  console.log('Google Calendar AI Assistant installed');
});

// キーボードショートカット
chrome.commands.onCommand.addListener((command) => {
  console.log('コマンド受信:', command);

  if (command === 'open-sidebar') {
    openSidebarWindow();
  }
});

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openSidePanel' || request.action === 'openSidebar') {
    openSidebarWindow().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // 非同期応答を示す
  }
});
