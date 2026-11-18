import { describe, expect, it } from 'vitest';
import { pathToTemplate, toOperationId, toTag } from '../src/converter/path-template';

describe('pathToTemplate', () => {
  it('数字段转为参数，命名取前一段单数化 + Id', () => {
    const { template, params } = pathToTemplate('/api/users/123');
    expect(template).toBe('/api/users/{userId}');
    expect(params).toEqual([{ name: 'userId', example: '123' }]);
  });

  it('识别 UUID 段', () => {
    const { template } = pathToTemplate('/orders/550e8400-e29b-41d4-a716-446655440000');
    expect(template).toBe('/orders/{orderId}');
  });

  it('识别 24 位 MongoId', () => {
    const { template } = pathToTemplate('/items/507f1f77bcf86cd799439011');
    expect(template).toBe('/items/{itemId}');
  });

  it('多个参数段分别命名', () => {
    const { template, params } = pathToTemplate('/orders/1/items/2');
    expect(template).toBe('/orders/{orderId}/items/{itemId}');
    expect(params.map((p) => p.name)).toEqual(['orderId', 'itemId']);
  });

  it('普通段不受影响', () => {
    const { template, params } = pathToTemplate('/api/user/list');
    expect(template).toBe('/api/user/list');
    expect(params).toEqual([]);
  });

  it('参数在首段时使用兜底名', () => {
    const { template, params } = pathToTemplate('/123');
    expect(template).toBe('/{paramId}');
    expect(params[0].name).toBe('paramId');
  });
});

describe('toOperationId', () => {
  it('生成驼峰 operationId', () => {
    const used = new Set<string>();
    expect(toOperationId('GET', '/api/users/{userId}', used)).toBe('getApiUsersByUserId');
  });

  it('重复时追加序号', () => {
    const used = new Set<string>();
    toOperationId('GET', '/users', used);
    expect(toOperationId('GET', '/users', used)).toBe('getUsers2');
  });
});

describe('toTag', () => {
  it('取第一个非参数段', () => {
    expect(toTag('/api/users/{userId}')).toBe('api');
    expect(toTag('/{id}')).toBe('default');
  });
});
