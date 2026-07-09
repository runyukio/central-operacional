const siteUrl = process.env.REALTIME_HOURS_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
const token = process.env.REALTIME_HOURS_IMPORT_TOKEN;

if (!token) {
  console.error("Configure REALTIME_HOURS_IMPORT_TOKEN antes de rodar o teste.");
  process.exit(1);
}

const endpoint = new URL("/api/realtime-hours/import", siteUrl);
const capturedAt = new Date().toISOString();

const payload = {
  source: "local-windows-server-test",
  capturedAt,
  records: [
    {
      hostname: "PC-OPERACAO-001",
      windowsUser: "lucas",
      wbLogin: "wb_lucas",
      employeeId: "fake-employee-001",
      ipAddress: "10.0.0.10",
      isSessionActive: true,
      idleSeconds: 45,
      activeProcessName: "msedge.exe",
      activeWindowTitle: "Central Operacional",
      lastActivityAt: new Date(Date.now() - 45_000).toISOString(),
      identitySource: "windows_user_mapping",
      identityConfidence: "HIGH"
    },
    {
      hostname: "PC-OPERACAO-002",
      windowsUser: "atendimento",
      wbLogin: "wb_teste",
      ipAddress: "10.0.0.11",
      isSessionActive: true,
      idleSeconds: 420,
      activeProcessName: "chrome.exe",
      activeWindowTitle: "Ferramenta operacional",
      lastActivityAt: new Date(Date.now() - 420_000).toISOString(),
      identitySource: "hostname_mapping",
      identityConfidence: "MEDIUM"
    },
    {
      hostname: "PC-OPERACAO-003",
      windowsUser: "shared",
      ipAddress: "10.0.0.12",
      isSessionActive: false,
      idleSeconds: 1800,
      identitySource: "unknown",
      identityConfidence: "UNKNOWN"
    }
  ]
};

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

const body = await readJson(response);
console.log(JSON.stringify(body, null, 2));

if (!response.ok) {
  process.exit(1);
}

if (process.argv.includes("--status")) {
  const statusEndpoint = new URL("/api/realtime-hours/status", siteUrl);
  const statusResponse = await fetch(statusEndpoint, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });
  const statusBody = await readJson(statusResponse);
  console.log(JSON.stringify(statusBody, null, 2));
  if (!statusResponse.ok) process.exit(1);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      status: response.status,
      ok: response.ok,
      body: text
    };
  }
}
