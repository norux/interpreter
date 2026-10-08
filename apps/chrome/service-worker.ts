// This worker is control-only. The persistent host document owns the engine;
// selected-video PCM travels directly from its content-script port to that host.
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["content.js"] }).then(() =>
    chrome.windows.create({ url: chrome.runtime.getURL(`host.html?tab=${tab.id}`), type: "popup", width: 900, height: 720 }),
  ).catch(error => { console.error("Cannot open selected-video interpreter:", error.message); });
});
