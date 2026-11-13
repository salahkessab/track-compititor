import { statfs } from 'node:fs/promises';

export type DiskStorage = { status: 'available'; totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number }
  | { status: 'unavailable' };

// Measure the filesystem containing the workspace, not the container's root
// disk. bavail is the space the app can actually use; reserved blocks count as
// occupied. No directory traversal, file contents or private paths are returned.
export async function workspaceDiskStorage(root: string, inspect = statfs): Promise<DiskStorage> {
  try {
    const { bsize, blocks, bavail } = await inspect(root);
    if (![bsize, blocks, bavail].every(n => Number.isSafeInteger(n) && n >= 0) || bsize === 0 || blocks === 0 || bavail > blocks) return { status: 'unavailable' };
    const totalBytes = blocks * bsize, freeBytes = bavail * bsize;
    if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(freeBytes)) return { status: 'unavailable' };
    const usedBytes = totalBytes - freeBytes;
    return { status: 'available', totalBytes, usedBytes, freeBytes, usedPercent: usedBytes / totalBytes * 100 };
  } catch {
    // Missing permissions / unsupported filesystems must not look like an empty disk.
    return { status: 'unavailable' };
  }
}
