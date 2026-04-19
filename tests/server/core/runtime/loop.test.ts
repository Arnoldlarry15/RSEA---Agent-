import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeLoop } from '../../../../server/core/runtime/loop';

describe('RuntimeLoop', () => {
  let loop: RuntimeLoop;

  beforeEach(() => {
    loop = new RuntimeLoop();
  });

  describe('isRunning', () => {
    it('is false before start() is called', () => {
      expect(loop.isRunning()).toBe(false);
    });

    it('is false after stop() has been called', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        loop.stop();
      });
      await loop.start(fn, 0);
      expect(loop.isRunning()).toBe(false);
    });
  });

  describe('start / stop', () => {
    it('calls fn at least once before stop()', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        loop.stop();
      });
      await loop.start(fn, 0);
      expect(fn).toHaveBeenCalledOnce();
    });

    it('calls fn multiple times before stop()', async () => {
      let count = 0;
      const fn = vi.fn().mockImplementation(async () => {
        count++;
        if (count >= 3) loop.stop();
      });
      await loop.start(fn, 0);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('resolves the start() promise after stop()', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        loop.stop();
      });
      // Should resolve without hanging
      await expect(loop.start(fn, 0)).resolves.toBeUndefined();
    });

    it('does not call fn again after stop() is invoked inside fn', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        loop.stop();
      });
      await loop.start(fn, 100);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('sleep', () => {
    it('resolves after the specified time', async () => {
      vi.useFakeTimers();
      const p = loop.sleep(500);
      vi.advanceTimersByTime(500);
      await p;
      vi.useRealTimers();
    });

    it('does not resolve before the specified time', async () => {
      vi.useFakeTimers();
      let resolved = false;
      loop.sleep(1000).then(() => { resolved = true; });
      vi.advanceTimersByTime(999);
      // Flush microtasks
      await Promise.resolve();
      expect(resolved).toBe(false);
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(resolved).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('propagates errors from fn', () => {
    it('rejects the start() promise when fn throws', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('cycle error'));
      await expect(loop.start(fn, 0)).rejects.toThrow('cycle error');
    });
  });
});
