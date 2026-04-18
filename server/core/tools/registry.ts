import { BaseTool } from './base_tool';

/**
 * Central registry that maps tool names to tool instances.
 * Tools are registered by name and retrieved by the Executor at dispatch time.
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  /** Register a tool instance. Overwrites any existing tool with the same name. */
  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  /** Retrieve a tool by name, or undefined if not registered. */
  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /** Return all registered tool names. */
  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
