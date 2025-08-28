document.addEventListener('DOMContentLoaded', function() {
  const startBtn = document.getElementById('startBtn');
  const status = document.getElementById('status');

  // 現在のタブがフォロワーページかどうかを確認
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentUrl = tabs[0].url;
    if (currentUrl.includes('/followers')) {
      status.textContent = 'フォロワーページで実行可能です';
      status.className = 'status success';
      startBtn.disabled = false;
    } else {
      status.textContent = 'フォロワーページで実行してください';
      status.className = 'status error';
      startBtn.disabled = true;
    }
  });

  // 相互フォロワー取得開始
  startBtn.addEventListener('click', function() {
    startBtn.disabled = true;
    status.textContent = 'バックグラウンドで処理を開始しました';
    status.className = 'status info';
    
    // バックグラウンドスクリプトにメッセージを送信
    chrome.runtime.sendMessage({
      action: 'startMutualFollowersExtraction'
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.error('Background message error:', chrome.runtime.lastError);
        // 直接コンテンツスクリプトに送信を試行
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          try {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'getMutualFollowers'
            }, function(response) {
              console.log('Direct message sent');
            });
          } catch (error) {
            console.error('Direct message error:', error);
          }
        });
      } else {
        console.log('Background message sent successfully');
      }
      
      // 少し遅延してからポップアップを閉じる
      setTimeout(() => {
        window.close();
      }, 100);
    });
  });
});
