// ポップアップの制御
document.addEventListener('DOMContentLoaded', function() {
  const extractBtn = document.getElementById('extractBtn');
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const result = document.getElementById('result');
  const resultText = document.getElementById('result-text');

  // ページ読み込み時の状態確認
  checkPageStatus();

  // ボタンクリック時の処理
  extractBtn.addEventListener('click', function() {
    startExtraction();
  });

  // ページの状態を確認
  function checkPageStatus() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const url = tabs[0].url;
      if (url && (url.includes('x.com') || url.includes('twitter.com'))) {
        if (url.includes('/followers')) {
          updateStatus('info', 'フォロワーページです。取得を開始できます。');
          extractBtn.disabled = false;
        } else {
          updateStatus('error', 'フォロワーページで実行してください。');
          extractBtn.disabled = true;
        }
      } else {
        updateStatus('error', 'X（Twitter）のページで実行してください。');
        extractBtn.disabled = true;
      }
    });
  }

  // 抽出開始
  function startExtraction() {
    extractBtn.disabled = true;
    updateStatus('info', '相互フォロワーの取得を開始しています...');
    showProgress(0, '初期化中...');

    // content scriptにメッセージを送信
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'extractMutualFollowers'}, function(response) {
        if (chrome.runtime.lastError) {
          updateStatus('error', 'エラー: ' + chrome.runtime.lastError.message);
          extractBtn.disabled = false;
          hideProgress();
        } else if (response && response.success) {
          updateStatus('success', `${response.count}人の相互フォロワーを取得しました！`);
          showResult(response);
          // 結果をダウンロード
          downloadResults(response.mutualFollowers);
          extractBtn.disabled = false;
          hideProgress();
        } else {
          updateStatus('error', response ? response.error : '取得に失敗しました');
          extractBtn.disabled = false;
          hideProgress();
        }
      });
    });
  }

  // 進捗更新のリスナー
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'progress') {
      showProgress(message.percent, message.message);
    }
  });

  // ステータス更新
  function updateStatus(type, message) {
    status.className = `status ${type}`;
    status.textContent = message;
  }

  // プログレスバー表示
  function showProgress(percent, text) {
    progress.style.display = 'block';
    progressFill.style.width = percent + '%';
    progressText.textContent = text;
  }

  // プログレスバー非表示
  function hideProgress() {
    progress.style.display = 'none';
  }

  // 結果表示
  function showResult(data) {
    result.style.display = 'block';
    resultText.innerHTML = `
      <strong>取得完了！</strong><br>
      相互フォロワー数: ${data.count}人<br>
      ファイル名: mutual_followers_${new Date().toISOString().split('T')[0]}.json<br>
      ダウンロードフォルダに保存されました。
    `;
  }

  // 結果をダウンロード
  function downloadResults(mutualFollowers) {
    const data = {
      mutualFollowers: mutualFollowers,
      timestamp: new Date().toISOString(),
      count: mutualFollowers.length
    };
    
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    
    try {
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
        
        // URLを解放
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
      });
    } catch (error) {
      console.error('Error creating download:', error);
    }
  }
});
