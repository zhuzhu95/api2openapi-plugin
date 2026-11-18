/** 示例数据中数组的最大保留条数 */
export const DEFAULT_MAX_EXAMPLE_ITEMS = 10;

/** 递归截断示例数据：所有数组（含嵌套）最多保留 maxItems 条 */
export function truncateExample(value: unknown, maxItems = DEFAULT_MAX_EXAMPLE_ITEMS): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, maxItems).map((v) => truncateExample(v, maxItems));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateExample(v, maxItems);
    }
    return out;
  }
  return value;
}
