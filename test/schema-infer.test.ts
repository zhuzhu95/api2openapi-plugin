import { describe, expect, it } from 'vitest';
import { inferLooseString, inferSchema, mergeSchemas } from '../src/converter/schema-infer';

describe('inferSchema', () => {
  it('推断基本类型', () => {
    expect(inferSchema(1)).toEqual({ type: 'integer' });
    expect(inferSchema(1.5)).toEqual({ type: 'number' });
    expect(inferSchema(true)).toEqual({ type: 'boolean' });
    expect(inferSchema(null)).toEqual({ nullable: true });
  });

  it('识别字符串 format', () => {
    expect(inferSchema('2026-11-18T10:00:00Z')).toEqual({ type: 'string', format: 'date-time' });
    expect(inferSchema('a@b.com')).toEqual({ type: 'string', format: 'email' });
    expect(inferSchema('hello')).toEqual({ type: 'string' });
  });

  it('对象推断出 properties 与 required', () => {
    const s = inferSchema({ id: 1, name: 'a' });
    expect(s.type).toBe('object');
    expect(s.required).toEqual(['id', 'name']);
    expect(s.properties?.id).toEqual({ type: 'integer' });
  });

  it('数组合并元素 schema', () => {
    const s = inferSchema([{ a: 1 }, { a: 2, b: 'x' }]);
    expect(s.type).toBe('array');
    expect(s.items?.required).toEqual(['a']);
    expect(s.items?.properties?.b).toEqual({ type: 'string' });
  });

  it('空数组 items 为空 schema', () => {
    expect(inferSchema([])).toEqual({ type: 'array', items: {} });
  });
});

describe('mergeSchemas', () => {
  it('对象合并：属性并集，required 交集', () => {
    const merged = mergeSchemas(inferSchema({ a: 1, b: 2 }), inferSchema({ a: 3, c: 'x' }));
    expect(Object.keys(merged.properties ?? {}).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.required).toEqual(['a']);
  });

  it('类型冲突降级为 oneOf', () => {
    const merged = mergeSchemas({ type: 'string' }, { type: 'integer' });
    expect(merged.oneOf).toEqual([{ type: 'string' }, { type: 'integer' }]);
  });

  it('null 样本合并后加 nullable', () => {
    const merged = mergeSchemas({ nullable: true }, { type: 'string' });
    expect(merged).toEqual({ type: 'string', nullable: true });
  });

  it('format 不一致时丢弃', () => {
    const merged = mergeSchemas(
      { type: 'string', format: 'email' },
      { type: 'string', format: 'uri' },
    );
    expect(merged.format).toBeUndefined();
  });

  it('oneOf 与同类型合并会去重', () => {
    const merged = mergeSchemas(
      { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      { type: 'integer' },
    );
    expect(merged.oneOf).toHaveLength(2);
  });
});

describe('inferLooseString', () => {
  it('推断 query 参数类型', () => {
    expect(inferLooseString('123')).toEqual({ type: 'integer' });
    expect(inferLooseString('1.5')).toEqual({ type: 'number' });
    expect(inferLooseString('true')).toEqual({ type: 'boolean' });
    expect(inferLooseString('abc')).toEqual({ type: 'string' });
  });
});
