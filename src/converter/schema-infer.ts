export interface JsonSchema {
  type?: string;
  format?: string;
  nullable?: boolean;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  example?: unknown;
  description?: string;
}

const RE_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_URI = /^https?:\/\//i;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从字符串值推断 JSON Schema 类型与 format（用于 query/path/header 参数） */
export function inferLooseString(value: string): JsonSchema {
  if (/^-?\d+$/.test(value)) return { type: 'integer' };
  if (/^-?\d*\.\d+$/.test(value)) return { type: 'number' };
  if (/^(true|false)$/i.test(value)) return { type: 'boolean' };
  return inferStringFormat(value);
}

function inferStringFormat(value: string): JsonSchema {
  if (RE_DATE_TIME.test(value)) return { type: 'string', format: 'date-time' };
  if (RE_DATE.test(value)) return { type: 'string', format: 'date' };
  if (RE_UUID.test(value)) return { type: 'string', format: 'uuid' };
  if (RE_EMAIL.test(value)) return { type: 'string', format: 'email' };
  if (RE_URI.test(value)) return { type: 'string', format: 'uri' };
  return { type: 'string' };
}

/** 从任意 JSON 值递归推断 JSON Schema */
export function inferSchema(value: unknown): JsonSchema {
  if (value === null || value === undefined) return { nullable: true };
  if (Array.isArray(value)) {
    let items: JsonSchema | undefined;
    for (const item of value) {
      const s = inferSchema(item);
      items = items ? mergeSchemas(items, s) : s;
    }
    return { type: 'array', items: items ?? {} };
  }
  switch (typeof value) {
    case 'string':
      return inferStringFormat(value);
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        properties[k] = inferSchema(v);
      }
      return { type: 'object', properties, required: Object.keys(properties) };
    }
    default:
      return {};
  }
}

function stripNullable(s: JsonSchema): JsonSchema {
  if (!s.nullable) return s;
  const { nullable: _, ...rest } = s;
  return rest;
}

function variantKey(s: JsonSchema): string {
  return `${s.type ?? ''}#${s.format ?? ''}`;
}

/** 合并两个 schema：对象取属性并集/必填交集，类型冲突降级为 oneOf */
export function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  const nullable = a.nullable || b.nullable || undefined;

  // 一侧只有 nullable（来自 null 样本）
  if (!a.type && !a.oneOf && !a.properties) return { ...b, nullable: nullable || undefined };
  if (!b.type && !b.oneOf && !b.properties) return { ...a, nullable: nullable || undefined };

  if (a.oneOf || b.oneOf) {
    const variants: JsonSchema[] = [];
    for (const v of [...(a.oneOf ?? [stripNullable(a)]), ...(b.oneOf ?? [stripNullable(b)])]) {
      const key = variantKey(v);
      const idx = variants.findIndex((x) => variantKey(x) === key);
      if (idx >= 0) variants[idx] = mergeSchemas(variants[idx], v);
      else variants.push(v);
    }
    if (variants.length === 1) return { ...variants[0], nullable: nullable || undefined };
    const out: JsonSchema = { oneOf: variants };
    if (nullable) out.nullable = true;
    return out;
  }

  if (a.type && b.type && a.type !== b.type) {
    const out: JsonSchema = { oneOf: [stripNullable(a), stripNullable(b)] };
    if (nullable) out.nullable = true;
    return out;
  }

  if (a.type === 'object' && b.type === 'object') {
    const properties: Record<string, JsonSchema> = {};
    const keys = new Set([...Object.keys(a.properties ?? {}), ...Object.keys(b.properties ?? {})]);
    for (const key of keys) {
      const pa = a.properties?.[key];
      const pb = b.properties?.[key];
      properties[key] = pa && pb ? mergeSchemas(pa, pb) : (pa ?? pb)!;
    }
    const reqA = new Set(a.required ?? []);
    const required = (b.required ?? []).filter((k) => reqA.has(k));
    const out: JsonSchema = { type: 'object', properties };
    if (required.length) out.required = required;
    if (nullable) out.nullable = true;
    return out;
  }

  if (a.type === 'array' && b.type === 'array') {
    const items = a.items && b.items ? mergeSchemas(a.items, b.items) : a.items ?? b.items ?? {};
    const out: JsonSchema = { type: 'array', items };
    if (nullable) out.nullable = true;
    return out;
  }

  const out: JsonSchema = { type: a.type ?? b.type };
  if (a.format && a.format === b.format) out.format = a.format;
  if (nullable) out.nullable = true;
  return out;
}
