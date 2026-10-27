import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

vi.mock('@/utils/coverScreenBridge', () => ({
  setCoverScreenBook: vi.fn().mockResolvedValue(undefined),
  startCoverScreen: vi.fn().mockResolvedValue(undefined),
  stopCoverScreen: vi.fn().mockResolvedValue(undefined),
}));

import { hideCoverScreen, showBookOnCoverScreen } from '@/services/coverScreen';
import { setCoverScreenBook, startCoverScreen, stopCoverScreen } from '@/utils/coverScreenBridge';

const mk = (over: Partial<Book>): Book =>
  ({ hash: 'h', title: 'T', author: 'A', format: 'EPUB', updatedAt: 0, ...over }) as Book;

const appService = {
  isAndroidApp: true,
  resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
} as unknown as AppService;

describe('showBookOnCoverScreen', () => {
  // A fresh hash per test, so the module's last-published book never carries over.
  let n = 0;
  let hash = '';
  beforeEach(() => {
    hash = `book${++n}`;
    vi.mocked(setCoverScreenBook).mockReset().mockResolvedValue(undefined);
    vi.mocked(startCoverScreen).mockReset().mockResolvedValue(undefined);
  });

  it('sends the book with its cover file, then starts the session', async () => {
    await showBookOnCoverScreen(
      appService,
      mk({ hash, title: 'Dune', author: 'Herbert' }),
      25,
      'fit',
    );

    expect(setCoverScreenBook).toHaveBeenCalledWith({
      title: 'Dune',
      author: 'Herbert',
      coverPath: `/data/Books/${hash}/cover.png`,
      dim: 25,
      crop: false,
    });
    expect(startCoverScreen).toHaveBeenCalledOnce();
    expect(vi.mocked(setCoverScreenBook).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(startCoverScreen).mock.invocationCallOrder[0]!,
    );
  });

  it('does not resend an unchanged book, but still makes sure the session runs', async () => {
    await showBookOnCoverScreen(appService, mk({ hash }), 0, 'fit');
    await showBookOnCoverScreen(appService, mk({ hash }), 0, 'fit');

    expect(setCoverScreenBook).toHaveBeenCalledOnce();
    expect(startCoverScreen).toHaveBeenCalledTimes(2);
  });

  it('resends when the book or the dim level changes', async () => {
    await showBookOnCoverScreen(appService, mk({ hash }), 0, 'fit');
    await showBookOnCoverScreen(appService, mk({ hash }), 50, 'fit');
    await showBookOnCoverScreen(appService, mk({ hash: `${hash}-other` }), 50, 'fit');

    expect(setCoverScreenBook).toHaveBeenCalledTimes(3);
  });

  it('asks native to crop when the cover should fill the screen', async () => {
    await showBookOnCoverScreen(appService, mk({ hash }), 0, 'crop');

    expect(setCoverScreenBook).toHaveBeenCalledWith(expect.objectContaining({ crop: true }));
  });

  it('resends after a failed update instead of caching it', async () => {
    vi.mocked(setCoverScreenBook).mockRejectedValueOnce(new Error('bridge not ready'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await showBookOnCoverScreen(appService, mk({ hash }), 0, 'fit');
    await showBookOnCoverScreen(appService, mk({ hash }), 0, 'fit');

    expect(setCoverScreenBook).toHaveBeenCalledTimes(2);
    expect(startCoverScreen).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('hideCoverScreen', () => {
  it('stops the session and swallows a bridge failure', async () => {
    vi.mocked(stopCoverScreen).mockRejectedValueOnce(new Error('unsupported'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(hideCoverScreen()).resolves.toBeUndefined();
    expect(stopCoverScreen).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
