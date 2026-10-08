chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.windows.create({ url: chrome.runtime.getURL(`host.html?tab=${tab.id}`), type: "popup", width: 600, height: 500 });
});
