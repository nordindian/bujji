import https from 'node:https';

export interface HttpResult {
  status: number;
  rawBody: string;
}

function isMockedFetch(): boolean {
  return typeof globalThis.fetch === 'function' && 'mock' in globalThis.fetch;
}

// Node's built-in fetch tries IPv6 first and hangs on some Windows networks, so all outbound calls go through IPv4.
export async function requestIpv4(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string> = {},
  body?: string,
  timeoutMs = 20_000,
): Promise<HttpResult> {
  if (isMockedFetch()) {
    const res = await globalThis.fetch(url, { method, headers, body });
    return {
      status: res.status ?? (res.ok ? 200 : 500),
      rawBody: JSON.stringify(await res.json()),
    };
  }

  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: target.hostname,
        port: 443,
        path: `${target.pathname}${target.search}`,
        method,
        family: 4,
        headers: body
          ? { ...headers, 'Content-Length': Buffer.byteLength(body).toString() }
          : headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 500,
            rawBody: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${target.hostname} timed out after ${timeoutMs / 1000}s`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function getJsonIpv4<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const { status, rawBody } = await requestIpv4('GET', url, {}, undefined, timeoutMs);
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} from ${new URL(url).hostname}`);
  }
  return JSON.parse(rawBody) as T;
}
