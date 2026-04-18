import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FileTool, FileWriteTool } from '../../../../server/core/tools/file_tool';

const DATA_DIR = path.join(process.cwd(), 'data');
const TEST_FILE = path.join(DATA_DIR, '_test_file_tool.txt');

afterEach(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

describe('FileWriteTool', () => {
  const writeTool = new FileWriteTool();

  it('has name "file_write"', () => {
    expect(writeTool.name).toBe('file_write');
  });

  it('returns error when path is missing', async () => {
    const result = await writeTool.execute({ content: 'hello' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });

  it('returns error when content is missing', async () => {
    const result = await writeTool.execute({ path: '_test_file_tool.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('content');
  });

  it('blocks path traversal attempts', async () => {
    const result = await writeTool.execute({ path: '../../etc/passwd', content: 'bad' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });

  it('writes a file and returns structured result', async () => {
    const result = await writeTool.execute({ path: '_test_file_tool.txt', content: 'hello world' });
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.side_effects[0].type).toBe('file_write');
    expect(result.confidence).toBe(1.0);
    expect(fs.existsSync(TEST_FILE)).toBe(true);
    expect(fs.readFileSync(TEST_FILE, 'utf-8')).toBe('hello world');
  });
});

describe('FileTool', () => {
  const readTool = new FileTool();
  const writeTool = new FileWriteTool();

  it('has name "file_read"', () => {
    expect(readTool.name).toBe('file_read');
  });

  it('returns error when path is missing', async () => {
    const result = await readTool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });

  it('returns error when file does not exist', async () => {
    const result = await readTool.execute({ path: '_nonexistent_test.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('blocks path traversal attempts', async () => {
    const result = await readTool.execute({ path: '../../etc/passwd' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });

  it('reads a file that was previously written', async () => {
    await writeTool.execute({ path: '_test_file_tool.txt', content: 'test content' });
    const result = await readTool.execute({ path: '_test_file_tool.txt' });
    expect(result.success).toBe(true);
    expect(result.result).toBe('test content');
    expect(result.side_effects[0].type).toBe('file_read');
    expect(result.confidence).toBe(1.0);
  });
});
