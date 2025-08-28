// バックグラウンドスクリプト
let currentTask = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log('X相互フォロワー取得ツールがインストールされました');
  
  // 通知権限を確認
  if (chrome.notifications) {
    console.log('Notifications API is available');
  } else {
    console.error('Notifications API is not available');
  }
});

// 通知権限を確認
function checkNotificationPermission() {
  if (chrome.notifications) {
    chrome.notifications.getPermissionLevel((level) => {
      console.log('Notification permission level:', level);
      if (level === 'denied') {
        console.warn('Notification permission is denied');
      }
    });
  }
}

// 進捗メッセージの処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  
  if (message.action === 'startMutualFollowersExtraction') {
    // ポップアップからの開始要求
    console.log('Starting mutual followers extraction from popup');
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'getMutualFollowers'
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Content script message error:', chrome.runtime.lastError);
          } else {
            console.log('Content script message sent successfully');
          }
        });
      }
    });
    sendResponse({status: 'started'});
  } else if (message.type === 'progress') {
    // 進捗をコンソールに表示
    console.log('Progress:', message);
    // 進捗通知を有効化
    updateNotification(message);
  } else if (message.type === 'task_complete') {
    // タスク完了時の処理
    handleTaskComplete(message);
  } else if (message.type === 'task_error') {
    // エラー時の処理
    handleTaskError(message);
  }
});

// 通知の更新
function updateNotification(progress) {
  const notificationId = 'mutual_followers_progress';
  
  let message = '';
  if (progress.phase === 'start') {
    message = '相互フォロワー取得を開始しました';
  } else if (progress.phase === 'progress') {
    message = `取得中... ${progress.count}人の相互フォロワーを発見`;
  } else if (progress.phase === 'done') {
    message = `完了！ ${progress.count}人の相互フォロワーを取得しました`;
  } else if (progress.phase === 'error') {
    message = `エラー: ${progress.message}`;
  }
  
  console.log('Creating notification:', { notificationId, message });
  
  // 通知権限を確認
  checkNotificationPermission();
  
  try {
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iOCIgZmlsbD0iIzFkOWJmNSIvPgo8cGF0aCBkPSJNMTIgMjRMMjAgMzJMMzYgMTYiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=',
      title: 'X相互フォロワー取得',
      message: message
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('Notification error:', chrome.runtime.lastError);
        console.error('Error details:', JSON.stringify(chrome.runtime.lastError));
      } else {
        console.log('Notification created successfully:', notificationId);
      }
    });
  } catch (error) {
    console.error('Exception in notification creation:', error);
  }
}

// タスク完了時の処理
function handleTaskComplete(result) {
  console.log('Task completed:', result);
  
  // 結果をストレージに保存
  chrome.storage.local.set({
    mutualFollowers: result.mutualFollowers,
    timestamp: new Date().toISOString()
  });
  
  // 自動でダウンロード
  downloadResults();
  
  // 完了通知を試行
  try {
    const notificationId = 'mutual_followers_complete';
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iOCIgZmlsbD0iIzFkOWJmNSIvPgo8cGF0aCBkPSJNMTIgMjRMMjAgMzJMMzYgMTYiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=',
      title: 'X相互フォロワー取得完了',
      message: `${result.count}人の相互フォロワーを取得しました。自動でダウンロードしました。`
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('Completion notification error:', chrome.runtime.lastError);
      } else {
        console.log('Completion notification created:', notificationId);
      }
    });
  } catch (error) {
    console.error('Exception in completion notification:', error);
  }
}

// エラー時の処理
function handleTaskError(error) {
  console.error('Task error:', error);
  
  // エラー通知を試行
  try {
    const notificationId = 'mutual_followers_error';
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iOCIgZmlsbD0iI2Y0NDM2MyIvPgo8cGF0aCBkPSJNMjQgMTJMMjQgMjQiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CjxwYXRoIGQ9Ik0yNCAyNEwyNCAzNiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPC9zdmc+Cg==',
      title: 'X相互フォロワー取得エラー',
      message: error.message || '取得中にエラーが発生しました'
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('Error notification error:', chrome.runtime.lastError);
      } else {
        console.log('Error notification created:', notificationId);
      }
    });
  } catch (error) {
    console.error('Exception in error notification:', error);
  }
}

// 通知のクリック時の処理
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log('Notification clicked:', notificationId);
  if (notificationId === 'mutual_followers_complete') {
    // 通知を閉じる
    chrome.notifications.clear(notificationId);
  }
});

// 結果のダウンロード
function downloadResults() {
  chrome.storage.local.get(['mutualFollowers', 'timestamp'], (result) => {
    if (result.mutualFollowers) {
      const data = {
        mutualFollowers: result.mutualFollowers,
        timestamp: result.timestamp,
        count: result.mutualFollowers.length
      };
      
      const jsonData = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonData], {type: 'application/json'});
      
      try {
        // URL.createObjectURLが利用できない場合は、data URLを使用
        const url = URL.createObjectURL ? URL.createObjectURL(blob) : 
          `data:application/json;base64,${btoa(jsonData)}`;
        
        chrome.downloads.download({
          url: url,
          filename: `mutual_followers_${new Date().toISOString().split('T')[0]}.json`,
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Download error:', chrome.runtime.lastError);
          } else {
            console.log('Download started with ID:', downloadId);
          }
          
          // URL.createObjectURLで作成したURLは後で解放
          if (URL.createObjectURL && url.startsWith('blob:')) {
            setTimeout(() => {
              try {
                URL.revokeObjectURL(url);
              } catch (e) {
                console.error('Error revoking URL:', e);
              }
            }, 1000);
          }
        });
      } catch (error) {
        console.error('Error creating download URL:', error);
        // フォールバック: テキストファイルとして保存
        const textData = `相互フォロワーリスト\n取得日時: ${new Date().toLocaleString()}\n\n${result.mutualFollowers.join('\n')}`;
        const textBlob = new Blob([textData], {type: 'text/plain'});
        const textUrl = URL.createObjectURL ? URL.createObjectURL(textBlob) : 
          `data:text/plain;base64,${btoa(textData)}`;
        
        chrome.downloads.download({
          url: textUrl,
          filename: `mutual_followers_${new Date().toISOString().split('T')[0]}.txt`,
          saveAs: false
        });
      }
    }
  });
}
