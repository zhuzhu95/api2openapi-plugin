import type { CapturedRequest, HarPostData } from './captured';
import { inferLooseString, inferSchema, mergeSchemas, type JsonSchema } from './schema-infer';
import { pathToTemplate, toOperationId, toTag } from './path-template';
import { truncateExample, DEFAULT_MAX_EXAMPLE_ITEMS } from './example';

export interface BuildOptions {
  title?: string;
  /** 转换为 securityScheme 之外，自定义请求头是否输出为 header 参数 */
  includeHeaderParams?: boolean;
  /** 响应 schema 中是否携带真实响应数据（Apifox 惯例放在 schema.enum），默认 true */
  includeResponseExamples?: boolean;
  /** 示例数据中数组最大保留条数，默认 10 */
  maxExampleItems?: number;
}

/** 无业务含义、不导出为参数的通用请求头 */
const SKIP_HEADERS = new Set([
  'accept', 'accept-encoding', 'accept-language', 'cache-control', 'connection',
  'content-length', 'content-type', 'cookie', 'host', 'origin', 'pragma',
  'referer', 'user-agent', 'dnt', 'upgrade-insecure-requests', 'authorization',
  'if-none-match', 'if-modified-since', 'priority', 'sec-fetch-dest',
  'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user', 'sec-ch-ua',
  'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
]);

/** 视为 API Key 的鉴权头，转 apiKey securityScheme */
const RE_API_KEY_HEADER = /^(x-)?(api[-_]?key|token|access[-_]?token|auth[-_]?token)$/i;

/** 值需要脱敏的 query 参数名 */
const RE_SENSITIVE_QUERY = /^(token|access_token|refresh_token|sign|signature|key|apikey|api_key|secret|password|pwd|ticket|auth|sessionid|sid|code)$/i;

const MASKED = '******';

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable',
};

interface SecurityResult {
  schemes: Record<string, unknown>;
  security: Array<Record<string, string[]>>;
}

function camel(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
}

/**
 * 从样本中识别鉴权方式，转为 Apifox 可识别的 securityScheme。
 * 不导出任何真实凭证值。
 */
export function detectSecurity(requests: CapturedRequest[]): SecurityResult {
  const schemes: Record<string, unknown> = {};
  const security: Array<Record<string, string[]>> = [];
  const seenSchemes = new Set<string>();
  const add = (name: string, scheme: Record<string, unknown>) => {
    if (seenSchemes.has(name)) return;
    seenSchemes.add(name);
    schemes[name] = scheme;
    security.push({ [name]: [] });
  };

  let cookieName: string | undefined;

  for (const req of requests) {
    const auth = req.requestHeaders['authorization'];
    if (auth) {
      if (/^bearer\s+/i.test(auth)) {
        const token = auth.slice(7).trim();
        add('bearerAuth', {
          type: 'http',
          scheme: 'bearer',
          ...(token.split('.').length === 3 ? { bearerFormat: 'JWT' } : {}),
        });
      } else if (/^basic\s+/i.test(auth)) {
        add('basicAuth', { type: 'http', scheme: 'basic' });
      } else {
        add('authorizationHeader', { type: 'apiKey', in: 'header', name: 'Authorization' });
      }
    }

    const cookie = req.requestHeaders['cookie'];
    if (cookie && !cookieName) {
      cookieName = cookie.split(';')[0]?.split('=')[0]?.trim() || undefined;
    }

    for (const name of Object.keys(req.requestHeaders)) {
      if (RE_API_KEY_HEADER.test(name)) {
        add(`${camel(name)}Auth`, { type: 'apiKey', in: 'header', name });
      }
    }
  }

  if (cookieName) {
    add('cookieAuth', { type: 'apiKey', in: 'cookie', name: cookieName });
  }
  return { schemes, security };
}

function isSkippedHeader(name: string): boolean {
  return SKIP_HEADERS.has(name) || name.startsWith('sec-') || name.startsWith(':');
}

function parseRequestBodySchema(req: CapturedRequest): { contentType: string; schema: JsonSchema } | undefined {
  const contentType = (req.postData?.mimeType ?? req.requestHeaders['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const body = req.requestBody;
  if (!body && !req.postData?.params?.length) return undefined;

  if (contentType.includes('json') || (!contentType && body?.trim().startsWith('{'))) {
    if (body) {
      try {
        return { contentType: 'application/json', schema: inferSchema(JSON.parse(body)) };
      } catch {
        return { contentType: contentType || 'application/json', schema: { type: 'string' } };
      }
    }
    return undefined;
  }

  if (contentType === 'application/x-www-form-urlencoded') {
    const properties: Record<string, JsonSchema> = {};
    for (const [k, v] of new URLSearchParams(body ?? '')) {
      properties[k] = { ...inferLooseString(v), example: RE_SENSITIVE_QUERY.test(k) ? MASKED : v };
    }
    return { contentType, schema: { type: 'object', properties, required: Object.keys(properties) } };
  }

  if (contentType === 'multipart/form-data') {
    const properties: Record<string, JsonSchema> = {};
    for (const p of req.postData?.params ?? []) {
      properties[p.name] = p.fileName
        ? { type: 'string', format: 'binary' }
        : { type: 'string', example: p.value ?? '' };
    }
    return { contentType, schema: { type: 'object', properties, required: Object.keys(properties) } };
  }

  return body
    ? { contentType: contentType || 'text/plain', schema: { type: 'string', example: body.slice(0, 200) } }
    : undefined;
}

function buildParameters(samples: CapturedRequest[], pathParams: Array<{ name: string; example: string }>, includeHeaders: boolean) {
  const parameters: Array<Record<string, unknown>> = [];

  for (const p of pathParams) {
    parameters.push({
      name: p.name,
      in: 'path',
      required: true,
      schema: inferLooseString(p.example),
      example: RE_SENSITIVE_QUERY.test(p.name) ? MASKED : p.example,
    });
  }

  const urls = samples.map((s) => new URL(s.url));
  const queryNames = new Set<string>();
  for (const u of urls) for (const k of u.searchParams.keys()) queryNames.add(k);

  for (const name of [...queryNames].sort()) {
    const values = urls.map((u) => u.searchParams.get(name)).filter((v): v is string => v !== null);
    const schema = values.map(inferLooseString).reduce((a, b) => mergeSchemas(a, b));
    const sensitive = RE_SENSITIVE_QUERY.test(name);
    parameters.push({
      name,
      in: 'query',
      required: values.length === samples.length,
      schema,
      example: sensitive ? MASKED : values[0],
    });
  }

  if (includeHeaders) {
    const headerNames = new Set<string>();
    for (const s of samples) {
      for (const name of Object.keys(s.requestHeaders)) {
        if (!isSkippedHeader(name) && !RE_API_KEY_HEADER.test(name)) headerNames.add(name);
      }
    }
    for (const name of [...headerNames].sort()) {
      const sample = samples.find((s) => s.requestHeaders[name] !== undefined);
      parameters.push({
        name,
        in: 'header',
        required: false,
        schema: { type: 'string' },
        example: sample?.requestHeaders[name] ?? '',
      });
    }
  }

  return parameters;
}

function buildResponses(
  samples: CapturedRequest[],
  includeExamples: boolean,
  maxExampleItems: number,
) {
  const responses: Record<string, unknown> = {};
  const byStatus = new Map<string, CapturedRequest[]>();
  for (const s of samples) {
    const key = String(s.status || 'default');
    byStatus.set(key, [...(byStatus.get(key) ?? []), s]);
  }

  for (const [status, group] of byStatus) {
    let jsonSchema: JsonSchema | undefined;
    let jsonExample: unknown;
    let hasExample = false;
    let contentType = 'application/json';
    for (const s of group) {
      const mime = (s.mimeType || s.responseHeaders['content-type'] || '').split(';')[0].trim().toLowerCase();
      const body = s.responseBody;
      if (!body) continue;
      if (mime.includes('json') || /^[[{]/.test(body.trim())) {
        try {
          const parsed: unknown = JSON.parse(body);
          jsonSchema = jsonSchema ? mergeSchemas(jsonSchema, inferSchema(parsed)) : inferSchema(parsed);
          if (!hasExample) {
            jsonExample = parsed;
            hasExample = true;
          }
          contentType = mime || 'application/json';
        } catch {
          // 非 JSON 文本，忽略 schema
        }
      } else if (!jsonSchema && group.length === 1) {
        responses[status] = {
          description: group[0].statusText || STATUS_TEXT[group[0].status] || '',
          content: { [mime || 'text/plain']: { schema: { type: 'string' } } },
        };
      }
    }

    if (!responses[status]) {
      const first = group[0];
      responses[status] = {
        description: first.statusText || STATUS_TEXT[first.status] || '',
        ...(jsonSchema
          ? {
              content: {
                [contentType]: {
                  schema: includeExamples && hasExample
                    ? { ...jsonSchema, enum: [truncateExample(jsonExample, maxExampleItems)] }
                    : jsonSchema,
                },
              },
            }
          : {}),
      };
    }
  }

  if (Object.keys(responses).length === 0) {
    responses['default'] = { description: '未捕获到响应' };
  }
  return responses;
}

/** 将捕获的请求样本转换为 OpenAPI 3.0.3 文档 */
export function buildOpenAPI(requests: CapturedRequest[], opts: BuildOptions = {}) {
  const includeHeaders = opts.includeHeaderParams ?? true;
  const includeExamples = opts.includeResponseExamples ?? true;
  const maxExampleItems = opts.maxExampleItems ?? DEFAULT_MAX_EXAMPLE_ITEMS;

  interface Group {
    method: string;
    template: string;
    pathParams: Array<{ name: string; example: string }>;
    samples: CapturedRequest[];
  }
  const groups = new Map<string, Group>();

  for (const req of requests) {
    let pathname = '/';
    try {
      pathname = new URL(req.url).pathname;
    } catch {
      continue;
    }
    const { template, params } = pathToTemplate(pathname);
    const key = `${req.method} ${template}`;
    const group = groups.get(key);
    if (group) {
      group.samples.push(req);
    } else {
      groups.set(key, { method: req.method, template, pathParams: params, samples: [req] });
    }
  }

  const paths: Record<string, Record<string, unknown>> = {};
  const servers = new Set<string>();
  const tags = new Set<string>();
  const operationIds = new Set<string>();

  for (const group of groups.values()) {
    const { method, template, samples } = group;
    try {
      servers.add(new URL(samples[0].url).origin);
    } catch {
      // 忽略无法解析的 origin
    }
    const tag = toTag(template);
    tags.add(tag);

    const operation: Record<string, unknown> = {
      tags: [tag],
      summary: `${method} ${template}`,
      operationId: toOperationId(method, template, operationIds),
      parameters: buildParameters(samples, group.pathParams, includeHeaders),
    };

    const bodySchemas = samples
      .map(parseRequestBodySchema)
      .filter((b): b is NonNullable<typeof b> => !!b);
    if (bodySchemas.length) {
      const content: Record<string, unknown> = {};
      for (const { contentType, schema } of bodySchemas) {
        const existing = content[contentType] as { schema: JsonSchema } | undefined;
        content[contentType] = { schema: existing ? mergeSchemas(existing.schema, schema) : schema };
      }
      operation.requestBody = { required: true, content };
    }

    operation.responses = buildResponses(samples, includeExamples, maxExampleItems);

    paths[template] = paths[template] ?? {};
    paths[template][method.toLowerCase()] = operation;
  }

  const { schemes, security } = detectSecurity(requests);

  return {
    openapi: '3.0.3',
    info: {
      title: opts.title ?? 'Captured API',
      version: '1.0.0',
      description: '由 API to OpenAPI 插件从浏览器实际请求自动生成。',
    },
    servers: [...servers].map((url) => ({ url })),
    tags: [...tags].map((name) => ({ name })),
    paths,
    components: Object.keys(schemes).length ? { securitySchemes: schemes } : {},
    ...(security.length ? { security } : {}),
  };
}
