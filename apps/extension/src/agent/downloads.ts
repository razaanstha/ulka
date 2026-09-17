import { z } from 'zod';
import type { ChromeApi } from '../chrome';

export const downloadQuery = z.object({
  query: z.string().max(200).default(''),
  state: z.enum(['all', 'in_progress', 'complete', 'interrupted']).default('all'),
  limit: z.number().int().min(1).max(50).default(20),
});

export async function listDownloads(api: Pick<ChromeApi['downloads'], 'search'>, input: unknown) {
  const options = downloadQuery.parse(input);
  const items = await api.search({ limit: options.limit, orderBy: ['-startTime'],
    ...(options.query.trim() ? { query: [options.query.trim()] } : {}),
    ...(options.state === 'all' ? {} : { state: options.state }),
  });
  return { downloads: items.map(item => ({
    id: item.id, filename: item.filename.split(/[\\/]/).at(-1) ?? '',
    state: item.state, paused: item.paused, bytesReceived: item.bytesReceived,
    totalBytes: item.totalBytes < 0 ? null : item.totalBytes,
    progressPercent: item.state === 'complete' ? 100 : item.totalBytes > 0 ? Math.min(100, Math.round(100 * item.bytesReceived / item.totalBytes)) : null,
    startTime: item.startTime, endTime: item.endTime, error: item.error,
    danger: item.danger, existsLastKnown: item.exists,
  })), notice: 'Recent matching browser downloads. Filenames only, no file contents or local directory paths. File existence may be stale.', limit: options.limit };
}
