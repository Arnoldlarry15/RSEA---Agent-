export { BaseTool } from './base_tool';
export type { ToolResult } from './base_tool';
export { ToolRegistry } from './registry';
export { HTTPTool } from './http_tool';
export { FileTool, FileWriteTool } from './file_tool';
export { WebhookTool } from './webhook_tool';

import { ToolRegistry } from './registry';
import { HTTPTool } from './http_tool';
import { FileTool, FileWriteTool } from './file_tool';
import { WebhookTool } from './webhook_tool';

/**
 * Pre-wired registry containing all built-in tools.
 * Imported by the Executor as its default registry.
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new HTTPTool());
  registry.register(new FileTool());
  registry.register(new FileWriteTool());
  registry.register(new WebhookTool());
  return registry;
}
