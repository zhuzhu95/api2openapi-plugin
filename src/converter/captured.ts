export interface HarNameValue {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: Array<{ name: string; value?: string; fileName?: string; contentType?: string }>;
}

export interface HarEntry {
  startedDateTime?: string;
  _resourceType?: string;
  request: {
    method: string;
    url: string;
    headers?: HarNameValue[];
    postData?: HarPostData;
  };
  response: {
    status: number;
    statusText?: string;
    headers?: HarNameValue[];
    content?: {
      mimeType?: string;
      size?: number;
      text?: string;
      encoding?: string;
    };
  };
}

export interface CapturedRequest {
  id: string;
  method: string;
  url: string;
  /** 请求头，key 为小写 */
  requestHeaders: Record<string, string>;
  requestBody?: string;
  postData?: HarPostData;
  status: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  responseBody?: string;
  mimeType: string;
  responseSize: number;
  startedDateTime: string;
}

let counter = 0;

export function resetCapturedIds(): void {
  counter = 0;
}

function headersToRecord(headers: HarNameValue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    out[h.name.toLowerCase()] = h.value;
  }
  return out;
}

export function fromHarEntry(
  entry: HarEntry,
  responseBody?: string,
  genId: () => string = () => `req-${++counter}`,
): CapturedRequest {
  return {
    id: genId(),
    method: (entry.request.method || 'GET').toUpperCase(),
    url: entry.request.url,
    requestHeaders: headersToRecord(entry.request.headers),
    requestBody: entry.request.postData?.text,
    postData: entry.request.postData,
    status: entry.response.status ?? 0,
    statusText: entry.response.statusText ?? '',
    responseHeaders: headersToRecord(entry.response.headers),
    responseBody,
    mimeType: entry.response.content?.mimeType ?? '',
    responseSize: entry.response.content?.size ?? responseBody?.length ?? 0,
    startedDateTime: entry.startedDateTime ?? new Date().toISOString(),
  };
}
