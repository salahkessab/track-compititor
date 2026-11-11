// A regular extension tab keeps the import visible and alive when focus changes.
// No page content is read until the user clicks the toolbar action.
chrome.action.onClicked.addListener(tab => {
  if (tab.id) void chrome.tabs.create({ url: chrome.runtime.getURL(`capture.html?sourceTab=${tab.id}`) });
});
