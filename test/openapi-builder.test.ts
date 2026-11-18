import { describe, expect, it } from 'vitest';
import { buildOpenAPI, detectSecurity } from '../src/converter/openapi-builder';
import { fromHarEntry, type HarEntry } from '../src/converter/captured';

function harEntry(overrides: {
  method?: string;
  url: string;
  requestHeaders?: Record<string, string>;
  postData?: { mimeType?: string; text?: string };
  status?: number;
  responseBody?: unknown;
}): { entry: HarEntry; body?: string } {
  const body =
    overrides.responseBody === undefined ? undefined : JSON.stringify(overrides.responseBody);
  return {
    entry: {
      request: {
        method: overrides.method ?? 'GET',
        url: overrides.url,
        headers: Object.entries(overrides.requestHeaders ?? {}).map(([name, value]) => ({
          name,
          value,
        })),
        postData: overrides.postData,
      },
      response: {
        status: overrides.status ?? 200,
        statusText: '',
        content: { mimeType: 'application/json', size: body?.length ?? 0 },
      },
    },
    body,
  };
}

function cap(...args: Parameters<typeof harEntry>) {
  const { entry, body } = harEntry(...args);
  return fromHarEntry(entry, body);
}

describe('buildOpenAPI', () => {
  it('生成合法的 OpenAPI 3.0.3 骨架', () => {
    const doc = buildOpenAPI([cap({ url: 'https://api.example.com/users?page=1' })]);
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.servers).toEqual([{ url: 'https://api.example.com' }]);
    expect(doc.paths['/users'].get).toBeDefined();
  });

  it('query 参数带类型与示例', () => {
    const doc = buildOpenAPI([cap({ url: 'https://a.com/list?page=2&kw=test' })]);
    const op = doc.paths['/list'].get as any;
    const params = op.parameters as Array<Record<string, unknown>>;
    const page = params.find((p) => p.name === 'page');
    const kw = params.find((p) => p.name === 'kw');
    expect(page).toMatchObject({ in: 'query', schema: { type: 'integer' }, example: '2' });
    expect(kw).toMatchObject({ in: 'query', schema: { type: 'string' }, example: 'test' });
  });

  it('敏感 query 参数值脱敏', () => {
    const doc = buildOpenAPI([cap({ url: 'https://a.com/x?token=abc123' })]);
    const op = doc.paths['/x'].get as any;
    const params = op.parameters as Array<Record<string, unknown>>;
    expect(params.find((p) => p.name === 'token')?.example).toBe('******');
  });

  it('路径参数识别并标记 required', () => {
    const doc = buildOpenAPI([cap({ url: 'https://a.com/users/42' })]);
    const op = doc.paths['/users/{userId}'].get as any;
    expect(op).toBeDefined();
    expect(op.parameters).toContainEqual({
      name: 'userId',
      in: 'path',
      required: true,
      schema: { type: 'integer' },
      example: '42',
    });
  });

  it('推断请求体与响应体 schema', () => {
    const doc = buildOpenAPI([
      cap({
        method: 'POST',
        url: 'https://a.com/users',
        requestHeaders: { 'Content-Type': 'application/json' },
        postData: { mimeType: 'application/json', text: '{"name":"a","age":20}' },
        responseBody: { id: 1, name: 'a' },
      }),
    ]);
    const op = doc.paths['/users'].post as any;
    expect(op.requestBody.content['application/json'].schema.required).toEqual(['name', 'age']);
    expect(op.responses['200'].content['application/json'].schema.properties.id).toEqual({
      type: 'integer',
    });
  });

  it('同一路径多个样本合并，部分出现字段不再 required', () => {
    const doc = buildOpenAPI([
      cap({ url: 'https://a.com/u/1', responseBody: { id: 1, name: 'a' } }),
      cap({ url: 'https://a.com/u/2', responseBody: { id: 2, extra: true } }),
    ]);
    const op = doc.paths['/u/{uId}'].get as any;
    const schema = op.responses['200'].content['application/json'].schema;
    expect(schema.required).toEqual(['id']);
    expect(Object.keys(schema.properties).sort()).toEqual(['extra', 'id', 'name']);
  });

  it('query 参数只出现在部分样本时 required 为 false', () => {
    const doc = buildOpenAPI([
      cap({ url: 'https://a.com/list?page=1' }),
      cap({ url: 'https://a.com/list' }),
    ]);
    const op = doc.paths['/list'].get as any;
    const params = op.parameters as Array<Record<string, unknown>>;
    expect(params.find((p) => p.name === 'page')?.required).toBe(false);
  });

  it('不同状态码分组到不同 responses', () => {
    const doc = buildOpenAPI([
      cap({ url: 'https://a.com/x', status: 200, responseBody: { ok: true } }),
      cap({ url: 'https://a.com/x', status: 401, responseBody: { message: 'denied' } }),
    ]);
    const op = doc.paths['/x'].get as any;
    const responses = op.responses;
    expect(responses['200']).toBeDefined();
    expect(responses['401'].description).toBe('Unauthorized');
  });

  it('form-urlencoded 请求体', () => {
    const doc = buildOpenAPI([
      cap({
        method: 'POST',
        url: 'https://a.com/login',
        postData: { mimeType: 'application/x-www-form-urlencoded', text: 'user=a&pwd=123' },
      }),
    ]);
    const op = doc.paths['/login'].post as any;
    const schema = op.requestBody.content['application/x-www-form-urlencoded'].schema;
    expect(schema.properties.pwd.example).toBe('******');
    expect(schema.required).toEqual(['user', 'pwd']);
  });

  it('自定义请求头输出为 header 参数', () => {
    const doc = buildOpenAPI([
      cap({ url: 'https://a.com/x', requestHeaders: { 'x-client-ver': '1.2.3' } }),
    ]);
    const op = doc.paths['/x'].get as any;
    const params = op.parameters as Array<Record<string, unknown>>;
    expect(params).toContainEqual({
      name: 'x-client-ver',
      in: 'header',
      required: false,
      schema: { type: 'string' },
      example: '1.2.3',
    });
  });
});

describe('detectSecurity', () => {
  it('Bearer token 转 http bearer，不导出真实值', () => {
    const { schemes, security } = detectSecurity([
      cap({ url: 'https://a.com/x', requestHeaders: { Authorization: 'Bearer abc.def.ghi' } }),
    ]);
    expect(schemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(security).toEqual([{ bearerAuth: [] }]);
    expect(JSON.stringify(schemes)).not.toContain('abc.def.ghi');
  });

  it('Cookie 转 apiKey cookie 鉴权', () => {
    const { schemes } = detectSecurity([
      cap({ url: 'https://a.com/x', requestHeaders: { Cookie: 'session_id=xyz; other=1' } }),
    ]);
    expect(schemes.cookieAuth).toEqual({ type: 'apiKey', in: 'cookie', name: 'session_id' });
    expect(JSON.stringify(schemes)).not.toContain('xyz');
  });

  it('x-api-key 头转 apiKey header 鉴权', () => {
    const { schemes, security } = detectSecurity([
      cap({ url: 'https://a.com/x', requestHeaders: { 'x-api-key': 'secret-value' } }),
    ]);
    expect(schemes.xApiKeyAuth).toEqual({ type: 'apiKey', in: 'header', name: 'x-api-key' });
    expect(security).toEqual([{ xApiKeyAuth: [] }]);
    expect(JSON.stringify(schemes)).not.toContain('secret-value');
  });

  it('鉴权写入文档顶层 security，供 Apifox 识别', () => {
    const doc = buildOpenAPI([
      cap({ url: 'https://a.com/x', requestHeaders: { Authorization: 'Bearer t' } }),
    ]);
    expect((doc.components as any).securitySchemes.bearerAuth).toBeDefined();
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });
});

describe('响应真实数据（schema.enum）', () => {
  it('响应 schema 携带真实数据，数组截断为 10 条', () => {
    const list = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `u${i}` }));
    const doc = buildOpenAPI([
      cap({ url: 'https://a.com/users', responseBody: { total: 20, list } }),
    ]);
    const op = doc.paths['/users'].get as any;
    const schema = op.responses['200'].content['application/json'].schema;
    expect(Array.isArray(schema.enum)).toBe(true);
    expect(schema.enum).toHaveLength(1);
    expect(schema.enum[0].total).toBe(20);
    expect(schema.enum[0].list).toHaveLength(10);
    expect(schema.enum[0].list[0]).toEqual({ id: 0, name: 'u0' });
  });

  it('嵌套数组同样截断', () => {
    const doc = buildOpenAPI([
      cap({
        url: 'https://a.com/x',
        responseBody: { data: { rows: Array.from({ length: 15 }, (_, i) => i) } },
      }),
    ]);
    const op = doc.paths['/x'].get as any;
    const example = op.responses['200'].content['application/json'].schema.enum[0];
    expect(example.data.rows).toHaveLength(10);
  });

  it('includeResponseExamples 为 false 时不携带 enum', () => {
    const doc = buildOpenAPI([cap({ url: 'https://a.com/x', responseBody: { a: 1 } })], {
      includeResponseExamples: false,
    });
    const op = doc.paths['/x'].get as any;
    expect(op.responses['200'].content['application/json'].schema.enum).toBeUndefined();
  });

  it('maxExampleItems 可自定义', () => {
    const doc = buildOpenAPI(
      [cap({ url: 'https://a.com/x', responseBody: [1, 2, 3, 4, 5] })],
      { maxExampleItems: 2 },
    );
    const op = doc.paths['/x'].get as any;
    expect(op.responses['200'].content['application/json'].schema.enum[0]).toEqual([1, 2]);
  });
});
