// 相互フォロワー取得のメインロジック
class MutualFollowersExtractor {
  constructor() {
    this.mutualFollowers = new Set();
    this.processedUsernames = new Set(); // 処理済みユーザー名を追跡
    this.isRunning = false;
    this.maxScrolls = 50;
    this.scrollDelay = 2000; // 基本待機
    this.jitterMs = 800; // ランダムゆらぎ
    this.longPauseEvery = 8; // 何サイクルごとに長めの休止
    this.longPauseMs = 15000; // 長めの休止時間
    this.backoffMs = 30000; // エラー時のバックオフ初期値
    this.maxBackoffMs = 180000; // バックオフ上限
  }

  // メッセージリスナー
  init() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'getMutualFollowers') {
        this.extractMutualFollowers().then(result => {
          sendResponse(result);
        });
        return true; // 非同期レスポンス
      }
    });
  }

  // 相互フォロワー抽出のメイン処理
  async extractMutualFollowers() {
    if (this.isRunning) {
      return { success: false, error: '既に実行中です' };
    }

    this.isRunning = true;
    this.mutualFollowers.clear();
    this.processedUsernames.clear(); // 処理済みユーザーリストもクリア
    this.totalProcessedUsers = 0;
    this.totalMutualFound = 0;

    // 開始を通知
    this.sendProgress({ phase: 'start', percent: 0, count: 0, message: '開始' });

    try {
      // 初期表示ユーザーを取得
      await this.extractUsersFromCurrentPage();
      this.sendProgress({ 
        phase: 'progress', 
        percent: Math.min(20, Math.round((this.totalProcessedUsers / 100) * 20)), 
        count: this.mutualFollowers.size, 
        message: `初期取得: ${this.totalProcessedUsers}人処理済み` 
      });

      // スクロールして追加ユーザーを取得
      await this.scrollAndExtract();

      const result = Array.from(this.mutualFollowers);

      // 完了を通知（100%）
      this.sendProgress({ 
        phase: 'done', 
        percent: 100, 
        count: result.length, 
        message: `完了: ${this.totalProcessedUsers}人処理済み、${result.length}人の相互フォロワーを発見` 
      });
      
      // バックグラウンドに完了を通知
      this.sendTaskComplete({
        mutualFollowers: result,
        count: result.length
      });
      
      return {
        success: true,
        mutualFollowers: result,
        count: result.length
      };

    } catch (error) {
      this.sendProgress({ 
        phase: 'error', 
        percent: 0, 
        count: this.mutualFollowers.size, 
        message: error.message || 'エラー' 
      });
      
      // バックグラウンドにエラーを通知
      this.sendTaskError(error);
      
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.isRunning = false;
    }
  }

  // 現在のページからユーザーを抽出
  async extractUsersFromCurrentPage() {
    const userElements = this.getUserElements();
    console.log(`Processing ${userElements.length} user elements`);
    
    let processedCount = 0;
    let newUsersCount = 0;
    let mutualCount = 0;
    
    for (const element of userElements) {
      const userInfo = this.extractUserInfo(element);
      if (!userInfo) continue;
      
      // 既に処理済みのユーザーはスキップ
      if (this.processedUsernames.has(userInfo.username)) {
        continue;
      }
      
      // 新しいユーザーとして記録
      this.processedUsernames.add(userInfo.username);
      newUsersCount++;
      processedCount++;
      
      if (userInfo.isMutual) {
        this.mutualFollowers.add(userInfo.username);
        mutualCount++;
        console.log(`Added mutual follower: ${userInfo.username}`);
      }
    }
    
    // 累計処理ユーザー数を更新（重複を除いた実際の処理数）
    this.totalProcessedUsers = this.processedUsernames.size;
    this.totalMutualFound = this.mutualFollowers.size;
    
    console.log(`Processed ${processedCount} elements, found ${newUsersCount} new users, ${mutualCount} mutual followers`);
    console.log(`Total: ${this.totalProcessedUsers} unique users processed, ${this.totalMutualFound} mutual followers found`);
    
    return { newUsersCount, mutualCount };
  }

  // スクロールして追加ユーザーを取得（適応的バックオフ付き）
  async scrollAndExtract() {
    let scrollCycle = 0;
    let lastHeight = document.body.scrollHeight;
    let noNewUsersCount = 0;
    let consecutiveNoNewUsers = 0;

    while (scrollCycle < this.maxScrolls) {
      // エラーバナー検知と復帰
      const recovered = await this.detectAndRecoverFromError();
      if (recovered === 'abort') {
        break;
      }

      const beforeCount = this.mutualFollowers.size;
      const beforeTotalUsers = this.totalProcessedUsers;

      // 小刻みスクロールで負荷軽減
      const step = Math.floor(window.innerHeight * 0.8);
      window.scrollBy({ top: step, behavior: 'smooth' });
      await this.sleep(this.withJitter(this.scrollDelay));

      const result = await this.extractUsersFromCurrentPage();
      const newUsersFound = result.newUsersCount;

      const afterCount = this.mutualFollowers.size;
      if (afterCount === beforeCount && newUsersFound === 0) {
        consecutiveNoNewUsers++;
      } else {
        consecutiveNoNewUsers = 0;
      }

      const newHeight = document.body.scrollHeight;
      if (newHeight === lastHeight) {
        scrollCycle++;
      } else {
        scrollCycle = 0;
        lastHeight = newHeight;
      }

      // 進捗（処理したユーザー数とスクロール進捗を組み合わせて計算）
      const scrollProgress = Math.min(80, Math.round((scrollCycle / this.maxScrolls) * 80)); // スクロール進捗: 0-80%
      const userProgress = Math.min(20, Math.round((this.totalProcessedUsers / 1000) * 20)); // ユーザー処理進捗: 0-20%
      const totalProgress = Math.min(99, 20 + scrollProgress + userProgress); // 初期20% + スクロール80% + ユーザー処理20%
      
      this.sendProgress({ 
        phase: 'progress', 
        percent: totalProgress, 
        count: this.mutualFollowers.size, 
        message: `スクロール${scrollCycle}回目: ${this.totalProcessedUsers}人処理済み、${this.mutualFollowers.size}人の相互フォロワーを発見` 
      });

      // 定期的に長めの休止
      if ((scrollCycle % this.longPauseEvery) === 0 && scrollCycle !== 0) {
        await this.sleep(this.longPauseMs);
      }

      // 新規ユーザーが連続で見つからない場合は早期終了
      if (consecutiveNoNewUsers >= 3) {
        console.log(`No new users found for ${consecutiveNoNewUsers} consecutive scrolls, ending extraction`);
        break;
      }

      // しばらく新規が出ない場合は軽いバックオフ
      if (noNewUsersCount >= 5) {
        await this.sleep(this.withJitter(this.scrollDelay * 2));
        noNewUsersCount = 0;
      }

      // 実質末尾（高さ変化なく一定回数スクロール）と判断
      if (scrollCycle >= this.maxScrolls - 1) {
        break;
      }
    }
  }

  // エラーバナー検知と復帰処理
  async detectAndRecoverFromError() {
    const pageText = document.body.innerText || '';
    const hasErrorText = /問題が発生しました|Something went wrong/i.test(pageText);

    let alertEl = document.querySelector('[role="alert"], [data-testid="toast"]');
    if (alertEl || hasErrorText) {
      // 「やりなおす」「Retry」ボタンを探して押下
      const retryBtn = Array.from(document.querySelectorAll('button, div[role="button"]'))
        .find(el => /やりなおす|再読み込み|Retry|Reload/i.test(el.innerText || el.getAttribute('aria-label') || ''));

      if (retryBtn) {
        retryBtn.click();
        await this.sleep(this.backoffMs);
      } else {
        await this.sleep(this.backoffMs);
      }

      this.backoffMs = Math.min(this.backoffMs * 1.5, this.maxBackoffMs);

      const stillError = /問題が発生しました|Something went wrong/i.test(document.body.innerText || '');
      if (stillError) {
        location.reload();
        return 'abort';
      }

      return 'recovered';
    }

    this.backoffMs = 30000;
    return 'ok';
  }

  // ユーザー要素を取得
  getUserElements() {
    // フォロワーページに特化したセレクターを優先
    const selectors = [
      '[data-testid="cellInnerDiv"]',
      '[data-testid="UserCell"]',
      'div[data-testid="UserCell"]',
      'div[role="listitem"]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        return Array.from(elements);
      }
    }

    console.log('No user elements found with any selector');
    return [];
  }

  // ユーザー情報を抽出
  extractUserInfo(element) {
    try {
      const username = this.extractUsername(element);
      if (!username) return null;

      const isMutual = this.isMutualFollower(element);
      
      return { username, isMutual };

    } catch (error) {
      return null;
    }
  }

  // ユーザー名を抽出
  extractUsername(element) {
    const linkSelectors = [
      'a[data-testid="User-Name"]',
      'div[data-testid="User-Name"] a',
      'div[data-testid="UserName"] a',
      'a[role="link"]',
      'a[href*="/"]'
    ];

    for (const selector of linkSelectors) {
      const links = element.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('/') && !href.includes('/status/') && !href.includes('/photo/')) {
          const username = href.split('/')[1];
          if (username && username.length > 0 && !username.includes('?')) {
            console.log('Found username from href:', username);
            return username;
          }
        }
      }
    }

    // テキストから@ユーザー名を抽出
    const text = element.textContent;
    const match = text && text.match(/@(\w+)/);
    if (match) {
      console.log('Found username from text:', match[1]);
      return match[1];
    }

    console.log('No username found in element');
    return null;
  }

  // 相互フォロワーかどうかを判定
  isMutualFollower(element) {
    // フォロワーページでの相互フォロー判定
    // 「フォロー中」ボタンがあるユーザー = 相互フォロワー（既にフォローしている状態）
    // 「フォローバック」ボタンがあるユーザー = 片方向フォロー（相手からフォローされているが、まだフォローしていない）
    // 「フォロー」ボタンがあるユーザー = 相互フォローしていない
    
    const username = this.extractUsername(element);
    
    // デバッグ: 要素内のすべてのボタンとフォロー状態表示を確認
    const allButtons = element.querySelectorAll('button, div[role="button"], [data-testid*="follow"]');
    const followIndicators = element.querySelectorAll('[data-testid="userFollowIndicator"]');
    console.log(`=== Analyzing user: ${username} ===`);
    console.log(`Found ${allButtons.length} buttons in element`);
    console.log(`Found ${followIndicators.length} follow indicators in element`);
    
    for (let i = 0; i < allButtons.length; i++) {
      const button = allButtons[i];
      const text = button.textContent || button.getAttribute('aria-label') || '';
      const testId = button.getAttribute('data-testid') || '';
      console.log(`Button ${i + 1}: text="${text}", data-testid="${testId}"`);
    }
    
    for (let i = 0; i < followIndicators.length; i++) {
      const indicator = followIndicators[i];
      const text = indicator.textContent || '';
      console.log(`Follow indicator ${i + 1}: text="${text}"`);
    }
    
    // フォロー中ボタンを探す（相互フォロワー）
    const followingSelectors = [
      '[data-testid="unfollow"]',
      'div[data-testid="unfollow"]',
      'div[aria-label*="フォロー中"]',
      'div[aria-label*="Following"]',
      'div[aria-label*="フォロー解除"]',
      'div[aria-label*="Unfollow"]',
      'span[data-testid="unfollow"]',
      'button[data-testid="unfollow"]',
      'div[data-testid="followButton"]',
      'div[data-testid="followButton"][aria-label*="フォロー中"]',
      'div[data-testid="followButton"][aria-label*="Following"]',
      // 新しいセレクターを追加
      'button[data-testid*="-unfollow"]',
      'button[aria-label*="フォロー解除"]',
      'button[aria-label*="Unfollow"]',
      // より具体的なセレクター
      'button[data-testid*="-unfollow"][aria-label*="フォロー中"]',
      'button[data-testid*="-unfollow"][aria-label*="Following"]'
    ];

    for (const selector of followingSelectors) {
      const button = element.querySelector(selector);
      if (button) {
        console.log('Found mutual follower (following):', username, 'with selector:', selector);
        return true; // フォロー中 = 相互フォロワー
      }
    }
    
    // フォロー状態の表示要素も確認（相互フォロワーの場合のみ）
    for (const indicator of followIndicators) {
      const text = indicator.textContent || '';
      if (/フォローされています|Following/i.test(text)) {
        // 「フォローされています」の表示がある場合、さらに「フォロー中」ボタンがあるかチェック
        const hasFollowingButton = followingSelectors.some(selector => {
          return element.querySelector(selector) !== null;
        });
        
        if (hasFollowingButton) {
          console.log('Found mutual follower (follow indicator + following button):', username, 'with text:', text);
          return true; // フォローされています + フォロー中 = 相互フォロワー
        } else {
          console.log('Found one-way follower (follow indicator only):', username, 'with text:', text);
          return false; // フォローされていますのみ = 片方向フォロー
        }
      }
    }

    // フォローバックボタンを探す（片方向フォロー）
    const followBackSelectors = [
      '[data-testid="follow"]',
      'div[data-testid="follow"]',
      'div[role="button"]',
      'span[data-testid="follow"]',
      'button[data-testid="follow"]',
      'div[data-testid="followButton"]',
      'div[data-testid="followButton"][aria-label*="フォローバック"]',
      'div[data-testid="followButton"][aria-label*="Follow back"]',
      // 新しいセレクターを追加
      'button[data-testid*="-follow"]',
      'button[aria-label*="フォローバック"]',
      'button[aria-label*="Follow back"]'
    ];

    for (const selector of followBackSelectors) {
      const buttons = element.querySelectorAll(selector);
      for (const button of buttons) {
        const text = (button.textContent || button.getAttribute('aria-label') || '').toLowerCase();
        
        if (/フォローバック|follow back/i.test(text)) {
          console.log('Found one-way follower (follow back):', username, 'with text:', text);
          return false; // フォローバック = 片方向フォロー
        }
      }
    }

    // フォローしていない状態
    const followSelectors = [
      '[data-testid="follow"]',
      'div[data-testid="follow"]'
    ];

    for (const selector of followSelectors) {
      const button = element.querySelector(selector);
      if (button) {
        const text = (button.textContent || button.getAttribute('aria-label') || '').toLowerCase();
        if (/フォロー|follow/i.test(text) && !/フォローバック|follow back/i.test(text)) {
          console.log('Found non-following user:', username);
          return false; // フォローしていない
        }
      }
    }

    // デバッグ用：要素の内容をログ出力
    console.log('User element analysis:', {
      username: username,
      elementText: element.textContent?.substring(0, 200)
    });

    console.log(`=== Result: ${username} is NOT a mutual follower ===`);
    return false;
  }

  // 進捗メッセージ送信
  sendProgress({ phase, percent, count, message }) {
    try {
      chrome.runtime.sendMessage({ type: 'progress', phase, percent, count, message });
    } catch(_) {}
  }

  // タスク完了メッセージ送信
  sendTaskComplete(result) {
    try {
      chrome.runtime.sendMessage({ 
        type: 'task_complete', 
        mutualFollowers: result.mutualFollowers,
        count: result.count
      });
    } catch(_) {}
  }

  // エラーメッセージ送信
  sendTaskError(error) {
    try {
      chrome.runtime.sendMessage({ 
        type: 'task_error', 
        message: error.message || 'エラーが発生しました'
      });
    } catch(_) {}
  }

  // 待機にランダムゆらぎを付与
  withJitter(base) {
    const delta = Math.floor((Math.random() - 0.5) * 2 * this.jitterMs);
    return Math.max(500, base + delta);
  }

  // スリープ関数
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// 初期化
const extractor = new MutualFollowersExtractor();
extractor.init();
