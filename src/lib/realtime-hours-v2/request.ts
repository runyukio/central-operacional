export async function readRequestTextWithLimit(request: Request, limitBytes: number) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    return { ok: false as const, status: 413, error: "Payload excede o limite permitido." };
  }
  if (!request.body) return { ok: true as const, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel();
      return { ok: false as const, status: 413, error: "Payload excede o limite permitido." };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true as const, text };
}

export function parseJsonText(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false as const, status: 400, error: "JSON inválido." };
  }
}

export function dateWithinWindow(value: string | Date, options: { futureMs: number; pastMs: number }, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const delta = date.getTime() - now.getTime();
  return delta <= options.futureMs && delta >= -options.pastMs;
}
