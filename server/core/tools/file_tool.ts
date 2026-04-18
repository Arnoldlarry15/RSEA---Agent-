import fs from 'fs';
import path from 'path';
import { BaseTool, ToolResult } from './base_tool';

/** All file operations are restricted to this base directory. */
const ALLOWED_BASE_DIR = path.join(process.cwd(), 'data');

/**
 * Resolve a caller-supplied path to an absolute path inside ALLOWED_BASE_DIR.
 * Returns null if the resolved path escapes the allowed directory (path traversal guard).
 */
function resolveSafePath(filePath: string): string | null {
  const resolved = path.resolve(ALLOWED_BASE_DIR, filePath);
  // Must be inside ALLOWED_BASE_DIR (with trailing sep to prevent sibling prefix match)
  if (resolved !== ALLOWED_BASE_DIR && !resolved.startsWith(ALLOWED_BASE_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Reads a file from the local `data/` directory.
 */
export class FileTool extends BaseTool {
  readonly name = 'file_read';
  readonly description = 'Read files from the local data directory';

  async execute(input_data: Record<string, any>): Promise<ToolResult> {
    const { path: filePath, encoding = 'utf-8' } = input_data;

    if (!filePath || typeof filePath !== 'string') {
      return { result: null, success: false, error: 'Missing required parameter: path', side_effects: [], confidence: 0 };
    }

    const safePath = resolveSafePath(filePath);
    if (!safePath) {
      return { result: null, success: false, error: 'Path traversal detected: access denied', side_effects: [], confidence: 0 };
    }

    try {
      if (!fs.existsSync(safePath)) {
        return { result: null, success: false, error: `File not found: ${filePath}`, side_effects: [], confidence: 0 };
      }
      const content = fs.readFileSync(safePath, encoding as BufferEncoding);
      return {
        result: content,
        success: true,
        error: null,
        side_effects: [{ type: 'file_read', path: safePath }],
        confidence: 1.0,
      };
    } catch (err: any) {
      return { result: null, success: false, error: err.message, side_effects: [], confidence: 0 };
    }
  }
}

/**
 * Writes a file to the local `data/` directory.
 */
export class FileWriteTool extends BaseTool {
  readonly name = 'file_write';
  readonly description = 'Write files to the local data directory';

  async execute(input_data: Record<string, any>): Promise<ToolResult> {
    const { path: filePath, content, encoding = 'utf-8' } = input_data;

    if (!filePath || typeof filePath !== 'string') {
      return { result: null, success: false, error: 'Missing required parameter: path', side_effects: [], confidence: 0 };
    }

    if (content === undefined || content === null) {
      return { result: null, success: false, error: 'Missing required parameter: content', side_effects: [], confidence: 0 };
    }

    const safePath = resolveSafePath(filePath);
    if (!safePath) {
      return { result: null, success: false, error: 'Path traversal detected: access denied', side_effects: [], confidence: 0 };
    }

    try {
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = String(content);
      fs.writeFileSync(safePath, data, encoding as BufferEncoding);
      return {
        result: { path: safePath, bytesWritten: data.length },
        success: true,
        error: null,
        side_effects: [{ type: 'file_write', path: safePath, bytesWritten: data.length }],
        confidence: 1.0,
      };
    } catch (err: any) {
      return { result: null, success: false, error: err.message, side_effects: [], confidence: 0 };
    }
  }
}
