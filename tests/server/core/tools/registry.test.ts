import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../../server/core/tools/registry';
import { BaseTool, ToolResult } from '../../../../server/core/tools/base_tool';

class EchoTool extends BaseTool {
  readonly name = 'echo';
  readonly description = 'Echoes input';
  async execute(input_data: Record<string, any>): Promise<ToolResult> {
    return { result: input_data, success: true, error: null, side_effects: [], confidence: 1.0 };
  }
}

class PingTool extends BaseTool {
  readonly name = 'ping';
  readonly description = 'Pings';
  async execute(_input_data: Record<string, any>): Promise<ToolResult> {
    return { result: 'pong', success: true, error: null, side_effects: [], confidence: 1.0 };
  }
}

describe('ToolRegistry', () => {
  it('registers and retrieves a tool by name', () => {
    const registry = new ToolRegistry();
    const tool = new EchoTool();
    registry.register(tool);
    expect(registry.get('echo')).toBe(tool);
  });

  it('returns undefined for an unregistered tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('list() returns all registered tool names', () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    registry.register(new PingTool());
    expect(registry.list()).toEqual(expect.arrayContaining(['echo', 'ping']));
    expect(registry.list()).toHaveLength(2);
  });

  it('overwrites an existing tool when registering the same name again', () => {
    const registry = new ToolRegistry();
    const first = new EchoTool();
    const second = new EchoTool();
    registry.register(first);
    registry.register(second);
    expect(registry.get('echo')).toBe(second);
  });
});
