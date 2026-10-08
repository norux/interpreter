// The persistent host owns tab capture, playback and inference. Page injection
// is optional presentation only; capture does not depend on media discovery.
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.windows.create({ url: chrome.runtime.getURL(`tab-host.html?tab=${tab.id}`), type: "popup", width: 900, height: 720 })
    .catch(error => { console.error("Cannot open tab interpreter:", error.message); });
});
