import { describe, expect, it } from 'vitest';
import { truncateExample } from '../src/converter/example';

describe('truncateExample', () => {
  it('数组超过 10 条截断为 10 条', () => {
    const arr = Array.from({ length: 25 }, (_, i) => i);
    expect(truncateExample(arr)).toHaveLength(10);
    expect(truncateExample(arr)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('不足 10 条原样保留', () => {
    expect(truncateExample([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('嵌套数组与对象字段中的数组同样截断', () => {
    const data = {
      list: Array.from({ length: 30 }, (_, i) => ({ id: i, subs: [1, 2] })),
      meta: { total: 30 },
      nested: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
    };
    const out = truncateExample(data) as typeof data;
    expect(out.list).toHaveLength(10);
    expect(out.list[0]).toEqual({ id: 0, subs: [1, 2] });
    expect(out.meta).toEqual({ total: 30 });
    expect(out.nested[0]).toHaveLength(10);
  });

  it('支持自定义条数', () => {
    expect(truncateExample([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it('基本类型原样返回', () => {
    expect(truncateExample('abc')).toBe('abc');
    expect(truncateExample(null)).toBe(null);
    expect(truncateExample(42)).toBe(42);
  });
});
