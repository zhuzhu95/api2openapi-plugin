const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_MONGO_ID = /^[0-9a-f]{24}$/i;
const RE_LONG_HEX = /^[0-9a-f]{32,}$/i;
const RE_NUMBER = /^-?\d+$/;

export interface PathParamInfo {
  name: string;
  example: string;
}

function isParamLike(segment: string): boolean {
  return (
    RE_NUMBER.test(segment) ||
    RE_UUID.test(segment) ||
    RE_MONGO_ID.test(segment) ||
    RE_LONG_HEX.test(segment)
  );
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * 把 URL 路径转换为 OpenAPI 路径模板，识别路径中的 ID 段为参数。
 * 参数名取自前一个路径段（单数化）+ Id，如 /users/123 -> /users/{userId}。
 */
export function pathToTemplate(pathname: string): { template: string; params: PathParamInfo[] } {
  const segments = pathname.split('/');
  const params: PathParamInfo[] = [];
  const used = new Map<string, number>();

  const out = segments.map((seg, i) => {
    if (!seg || !isParamLike(seg)) return seg;

    let base = '';
    for (let j = i - 1; j >= 0; j--) {
      if (segments[j]) {
        base = segments[j].replace(/[^a-zA-Z0-9].*$/, '');
        break;
      }
    }
    base = base.replace(/s$/, '') || 'param';
    let name = lowerFirst(base) + 'Id';

    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) name = `${name}${seen + 1}`;

    params.push({ name, example: safeDecode(seg) });
    return `{${name}}`;
  });

  return { template: out.join('/') || '/', params };
}

/** 从路径模板生成 operationId，如 get + /api/users/{userId} -> getApiUsersByUserId */
export function toOperationId(method: string, template: string, used: Set<string>): string {
  const parts: string[] = [];
  for (const seg of template.split('/')) {
    if (!seg) continue;
    const m = seg.match(/^\{(.+)\}$/);
    if (m) {
      parts.push('By', m[1][0].toUpperCase() + m[1].slice(1));
    } else {
      const clean = seg.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
      if (clean) parts.push(clean[0].toUpperCase() + clean.slice(1));
    }
  }
  let id = method.toLowerCase() + parts.join('');
  let n = 2;
  const base = id;
  while (used.has(id)) id = `${base}${n++}`;
  used.add(id);
  return id;
}

/** 取路径中第一个非参数段作为 tag，如 /api/users/{userId} -> api */
export function toTag(template: string): string {
  for (const seg of template.split('/')) {
    if (seg && !seg.startsWith('{')) return seg;
  }
  return 'default';
}
