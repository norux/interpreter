// Retained selected-video adapter regression entrypoint, not the product default.
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["content.js"] }).then(() =>
    chrome.windows.create({ url: chrome.runtime.getURL(`host.html?tab=${tab.id}`), type: "popup", width: 900, height: 720 }),
  ).catch(error => { console.error("Cannot open selected-video test host:", error.message); });
});
