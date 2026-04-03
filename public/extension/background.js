// PathUp AutoFill - Background Service Worker

// 监听安装事件
chrome.runtime.onInstalled.addListener(() => {
  console.log('PathUp AutoFill 已安装');
  
  // 设置默认配置
  chrome.storage.local.set({
    platformUrl: '',
    fieldMappings: [],
    parsedFields: {},
    lastSync: null
  });
});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getConfig') {
    chrome.storage.local.get(['platformUrl', 'fieldMappings', 'parsedFields'], (result) => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'saveConfig') {
    chrome.storage.local.set(request.data, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
