import { describe, it, expect } from 'vitest';
import { BaseTool, ToolResult } from '../../../../server/core/tools/base_tool';

class NoOpTool extends BaseTool {
  readonly name = 'noop';
  readonly description = 'Does nothing';

  async execute(_input_data: Record<string, any>): Promise<ToolResult> {
    return { result: 'ok', success: true, error: null, side_effects: [], confidence: 1.0 };
  }
}

describe('BaseTool', () => {
  it('can be subclassed with a name and description', () => {
    const tool = new NoOpTool();
    expect(tool.name).toBe('noop');
    expect(tool.description).toBe('Does nothing');
  });

  it('execute() returns a ToolResult with all required fields', async () => {
    const tool = new NoOpTool();
    const result = await tool.execute({});
    expect(result).toMatchObject({
      result: 'ok',
      success: true,
      error: null,
      side_effects: [],
      confidence: 1.0,
    });
  });
});
