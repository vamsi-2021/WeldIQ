import type { FileRecord } from '../types/ScanTypes';

export interface FileUpload {
  /** file:// URI of the local file. */
  uri: string;
  /** Name stored on the server, e.g. "scan_004.zip". */
  name: string;
  contentType: string;
}

export class FileUploadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FileUploadError';
  }
}

export const CANCELLED = 'Cancelled';

/**
 * Uploads one file to BF Files: POST {baseUrl}/file-records?bucket=&name=
 * with the raw file as the body (not multipart), like:
 *   curl -X POST ".../file-records?bucket=weld-iq&name=scan_004.zip" \
 *     -H "Authorization: Bearer <token>" -H "Content-Type: application/zip" --data-binary @scan_004.zip
 */
export async function uploadFileRecord(
  baseUrl: string,
  bucket: string,
  file: FileUpload,
  authorization: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<FileRecord> {
  // React Native reads file:// URIs into a native-backed Blob, so the bytes never pass through JS.
  const body = await (await fetch(file.uri)).blob();
  const url =
    `${baseUrl.replace(/\/+$/, '')}/file-records` +
    `?bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(file.name)}`;

  return new Promise<FileRecord>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) {
      reject(new FileUploadError(CANCELLED));
      return;
    }
    signal?.addEventListener('abort', onAbort);

    console.log(`[API] POST ${url} · ${file.contentType} · ${body.size} bytes`);
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', authorization);
    xhr.setRequestHeader('Content-Type', file.contentType);
    xhr.timeout = 10 * 60_000;
    if (onProgress) {
      xhr.upload.onprogress = e => onProgress(e.loaded, e.lengthComputable ? e.total : body.size);
    }
    xhr.onload = () => {
      done();
      console.log(`[API] POST ${url} → ${xhr.status}\n[API] response: ${xhr.responseText?.slice(0, 2000)}`);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as FileRecord);
        } catch {
          reject(new FileUploadError('The server sent an unreadable response.', xhr.status));
        }
        return;
      }
      reject(new FileUploadError(describeStatus(xhr.status, xhr.responseText), xhr.status));
    };
    xhr.onerror = () => {
      done();
      console.log(`[API] POST ${url} → network error (no response). status=${xhr.status}`);
      reject(
        new FileUploadError(
          `Cannot reach the file server at ${baseUrl}. Check the address and that the server is running on the same network.`,
        ),
      );
    };
    xhr.ontimeout = () => {
      done();
      reject(new FileUploadError('The upload took too long.'));
    };
    xhr.onabort = () => {
      done();
      reject(new FileUploadError(CANCELLED));
    };
    xhr.send(body);
  });
}

function describeStatus(status: number, text: string): string {
  let detail = text?.trim();
  try {
    const json = JSON.parse(text);
    detail = json.message ?? json.error ?? json.detail ?? detail;
  } catch {
    // Not JSON; use the raw text.
  }
  if (status === 401 || status === 403) {
    return `Not authorised (${status}). Sign in again.${detail ? ` ${detail}` : ''}`;
  }
  return `Server error ${status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`;
}
