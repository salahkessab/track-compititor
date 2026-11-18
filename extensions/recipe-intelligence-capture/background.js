// A regular extension tab keeps the import visible and alive when focus changes.
importScripts('shared.js');
chrome.action.onClicked.addListener(tab => {
  if (tab.id) void chrome.tabs.create({ url: chrome.runtime.getURL(`capture.html?sourceTab=${tab.id}`) });
});

const textMenu = 'capture-article-text', imageMenu = 'capture-article-image';
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const documentUrlPatterns = ['http://*/*','https://*/*'];
    chrome.contextMenus.create({id:textMenu,title:'Add selected text to article draft',contexts:['selection'],documentUrlPatterns});
    chrome.contextMenus.create({id:imageMenu,title:'Add image to article draft',contexts:['image'],documentUrlPatterns});
  });
});

chrome.contextMenus.onClicked.addListener(async (info,tab) => {
  if (!tab?.id || info.editable || info.frameId > 0 || ![textMenu,imageMenu].includes(info.menuItemId)) return;
  let page;
  try {
    page = CaptureHelpers.articleAddress(info.pageUrl);
    if (CaptureHelpers.articleAddress(tab.url) !== page) return;
  } catch { return; }
  const kind = info.menuItemId === textMenu ? 'text' : 'image';
  const value = kind === 'text' ? info.selectionText : info.srcUrl;
  const key = 'manualItem:'+crypto.randomUUID();
  const item = {sourceTab:tab.id,page,kind,time:Date.now()};
  if (!value || value.length > (kind === 'text' ? 200000 : 4096)) item.error = 'Choose a smaller selection or paste a public photo URL.';
  else item.value = value;
  await chrome.storage.session.set({[key]:item});
  await CaptureHelpers.openManualReview(tab,page);
});
