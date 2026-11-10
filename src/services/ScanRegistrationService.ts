import { CANCELLED } from './FileRecordsService';

export class ScanRegistrationError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ScanRegistrationError';
  }
}

/**
 * Registers an uploaded scan file with an assignment, like:
 *   curl -X POST ".../api/analytics/weld-iq/scans" \
 *     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *     -d '{"assignmentDetailId":"…","scanFile":"<uuid from the upload response>"}'
 * Returns the parsed JSON response, or the raw text if it isn't JSON.
 */
export async function registerScan(
  baseUrl: string,
  assignmentDetailId: string,
  scanFile: string,
  authorization: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/analytics/weld-iq/scans`;
  const payload = JSON.stringify({ assignmentDetailId, scanFile });
  console.log(`[API] POST ${url} · body ${payload}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: payload,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) {
      throw new ScanRegistrationError(CANCELLED);
    }
    console.log(`[API] POST ${url} → network error: ${e instanceof Error ? e.message : String(e)}`);
    throw new ScanRegistrationError(
      `Cannot reach the analytics server at ${baseUrl}. ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const text = await res.text();
  console.log(`[API] POST ${url} → ${res.status}\n[API] response: ${text.slice(0, 2000)}`);
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; keep the raw text.
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error ?? text
        : text;
    const prefix = res.status === 401 || res.status === 403 ? `Not authorised (${res.status}).` : `Server error ${res.status}`;
    throw new ScanRegistrationError(
      `Registering the scan failed. ${prefix}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`,
      res.status,
    );
  }
  return body;
}
