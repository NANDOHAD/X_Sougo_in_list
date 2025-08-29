// X相互フォロワー取得ツール - Content Script
class MutualFollowersExtractor {
  constructor() {
    this.mutualFollowers = new Set();
    this.processedUsernames = new Set();
    this.isRunning = false;
    this.maxScrolls = 30;
    this.scrollDelay = 1500;
  }

  // メッセージリスナーの初期化
  init() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('Content script received message:', request);
      
      if (request.action === 'extractMutualFollowers') {
        this.extractMutualFollowers().then(result => {
          console.log('Extraction completed:', result);
          sendResponse(result);
        }).catch(error => {
          console.error('Extraction error:', error);
          sendResponse({ success: false, error: error.message });
        });
        return true; // 非同期レスポンス
      }
    });
    console.log('Content script initialized');
  }

  // 相互フォロワー抽出のメイン処理
  async extractMutualFollowers() {
    if (this.isRunning) {
      return { success: false, error: '既に実行中です' };
    }

    // フォロワーページ以外では中断
    if (!(/\/followers\/?$/.test(location.pathname))) {
      return { success: false, error: 'フォロワーページで実行してください' };
    }

    this.isRunning = true;
    this.mutualFollowers.clear();
    this.processedUsernames.clear();

    try {
      this.sendProgress(10, '初期化完了');

      // 初期表示ユーザーを取得
      await this.extractUsersFromCurrentPage();
      this.sendProgress(30, `${this.mutualFollowers.size}人の相互フォロワーを発見`);

      // スクロールして追加ユーザーを取得
      await this.scrollAndExtract();

      const result = Array.from(this.mutualFollowers);
      this.sendProgress(100, `完了: ${result.length}人の相互フォロワーを取得`);

      return {
        success: true,
        mutualFollowers: result,
        count: result.length
      };

    } catch (error) {
      console.error('Extraction error:', error);
      return {
        success: false,
        error: error.message || '取得中にエラーが発生しました'
      };
    } finally {
      this.isRunning = false;
    }
  }

  // 現在のページからユーザーを抽出
  async extractUsersFromCurrentPage() {
    const userElements = this.getUserElements();
    console.log(`Processing ${userElements.length} user elements`);
    
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
      
      if (userInfo.isMutual) {
        this.mutualFollowers.add(userInfo.username);
        mutualCount++;
        console.log(`Added mutual follower: ${userInfo.username}`);
      }
    }
    
    console.log(`Found ${newUsersCount} new users, ${mutualCount} mutual followers`);
    return { newUsersCount, mutualCount };
  }

  // スクロールして追加ユーザーを取得
  async scrollAndExtract() {
    let iterationCount = 0;
    let noNewUsersCount = 0;

    while (iterationCount < this.maxScrolls) {
      const beforeCount = this.mutualFollowers.size;
      
      // スクロール
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
      await this.sleep(this.scrollDelay);

      // ユーザーを抽出
      const result = await this.extractUsersFromCurrentPage();
      const newUsersFound = result.newUsersCount;

      const afterCount = this.mutualFollowers.size;
      if (afterCount === beforeCount && newUsersFound === 0) {
        noNewUsersCount++;
      } else {
        noNewUsersCount = 0;
      }

      // 進捗更新
      const progress = Math.min(90, 30 + Math.round((iterationCount / this.maxScrolls) * 60));
      this.sendProgress(progress, `スクロール${iterationCount + 1}回目: ${this.mutualFollowers.size}人の相互フォロワーを発見`);

      // 新規ユーザーが連続で見つからない場合は早期終了
      if (noNewUsersCount >= 3) {
        console.log(`No new users found for ${noNewUsersCount} consecutive scrolls, ending extraction`);
        break;
      }

      iterationCount++;
    }
  }

  // ユーザー要素を取得
  getUserElements() {
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

    console.log('No user elements found');
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
      'a[href^="/"]'
    ];

    const reserved = new Set([
      '', 'home', 'explore', 'notifications', 'messages', 'i', 'settings', 'compose', 'search',
      'topics', 'lists', 'bookmarks', 'moments', 'help', 'privacy', 'tos', 'about', 'login', 'signup'
    ]);

    for (const selector of linkSelectors) {
      const links = element.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href.startsWith('/')) continue;

        const match = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\b|\/|\?|#)/);
        if (!match) continue;
        const candidate = match[1];
        if (reserved.has(candidate)) continue;

        return candidate;
      }
    }

    // テキストから@ユーザー名を抽出
    const text = element.textContent;
    const match = text && text.match(/@(\w+)/);
    if (match) {
      return match[1];
    }

    return null;
  }

  // 相互フォロワーかどうかを判定（既存のロジックを保持）
  isMutualFollower(element) {
    const username = this.extractUsername(element);
    
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
      'button[data-testid*="-unfollow"]',
      'button[aria-label*="フォロー解除"]',
      'button[aria-label*="Unfollow"]',
      'button[data-testid*="-unfollow"][aria-label*="フォロー中"]',
      'button[data-testid*="-unfollow"][aria-label*="Following"]'
    ];

    for (const selector of followingSelectors) {
      const button = element.querySelector(selector);
      if (button) {
        return true; // フォロー中 = 相互フォロワー
      }
    }
    
    // フォロー状態の表示要素も確認
    const followIndicators = element.querySelectorAll('[data-testid="userFollowIndicator"]');
    for (const indicator of followIndicators) {
      const text = indicator.textContent || '';
      if (/フォローされています|Follows you/i.test(text)) {
        // 「フォローされています」の表示がある場合、さらに「フォロー中」ボタンがあるかチェック
        const hasFollowingButton = followingSelectors.some(selector => {
          return element.querySelector(selector) !== null;
        });
        
        if (hasFollowingButton) {
          return true; // フォローされています + フォロー中 = 相互フォロワー
        } else {
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
      'button[data-testid*="-follow"]',
      'button[aria-label*="フォローバック"]',
      'button[aria-label*="Follow back"]'
    ];

    for (const selector of followBackSelectors) {
      const buttons = element.querySelectorAll(selector);
      for (const button of buttons) {
        const text = (button.textContent || button.getAttribute('aria-label') || '').toLowerCase();
        
        if (/フォローバック|follow back/i.test(text)) {
          return false; // フォローバック = 片方向フォロー
        }
      }
    }

    return false;
  }

  // 進捗メッセージ送信
  sendProgress(percent, message) {
    try {
      chrome.runtime.sendMessage({ 
        type: 'progress', 
        percent: percent, 
        message: message 
      });
    } catch(error) {
      console.error('Error sending progress:', error);
    }
  }



  // スリープ関数
  sleep(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
  }
}

// 初期化
console.log('Content script loading...');
const extractor = new MutualFollowersExtractor();
extractor.init();
console.log('Content script ready');
