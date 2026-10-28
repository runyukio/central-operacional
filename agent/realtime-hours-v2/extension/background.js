const NATIVE_HOST = "com.centraloperacional.realtimehours.v2";
const ALARM_NAME = "central-operacional-browser-state";

function browserName() {
  const userAgent = navigator.userAgent || "";
  if (/Edg\//i.test(userAgent)) return "msedge";
  if (/Brave/i.test(userAgent)) return "brave";
  return "chrome";
}

function normalizeDomain(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    if (!["http:", "https:"].includes(url.protocol)) return "";
    let host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("www.")) host = host.slice(4);
    if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return "";
    return host;
  } catch {
    return "";
  }
}

async function currentState() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const focusedWindow = windows.find((item) => item.focused) || null;
  const activeTab = focusedWindow?.tabs?.find((tab) => tab.active) || null;
  const domain = normalizeDomain(activeTab?.url || "");
  return {
    schemaVersion: 1,
    browser: browserName(),
    domain,
    focused: Boolean(focusedWindow && activeTab),
    private: Boolean(activeTab?.incognito),
    capturedAt: new Date().toISOString()
  };
}

async function publishState() {
  try {
    const state = await currentState();
    await chrome.runtime.sendNativeMessage(NATIVE_HOST, state);
  } catch (error) {
    console.warn("Central Operacional native messaging unavailable", String(error));
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  void publishState();
});
chrome.runtime.onStartup.addListener(() => void publishState());
chrome.tabs.onActivated.addListener(() => void publishState());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") void publishState();
});
chrome.windows.onFocusChanged.addListener(() => void publishState());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void publishState();
});
