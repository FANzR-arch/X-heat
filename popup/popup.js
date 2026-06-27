const DEFAULT_SETTINGS = {
  enabled: true
};

const enabledInput = document.querySelector("#enabled");

chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  enabledInput.checked = Boolean(settings.enabled);
});

enabledInput.addEventListener("change", () => {
  chrome.storage.sync.set({
    enabled: enabledInput.checked
  });
});
