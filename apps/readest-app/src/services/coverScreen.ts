import type { Book } from '@/types/book';
import type { LibraryCoverFitType } from '@/types/settings';
import type { AppService } from '@/types/system';
import { getCoverFilename } from '@/utils/book';
import { joinScannedPath } from '@/utils/path';
import { setCoverScreenBook, startCoverScreen, stopCoverScreen } from '@/utils/coverScreenBridge';
import type { SetCoverScreenBookRequest } from '@/utils/coverScreenBridge';
import { resolveBooksDir } from './widget/bookshelfWidget';

let lastPublished = '';

/**
 * Shows `book`'s cover on a foldable's outer screen whenever the device is
 * unfolded. The book is only sent again when it (or how it's shown) changes, so
 * calling this on every resume just makes sure the session is running.
 */
export const showBookOnCoverScreen = async (
  appService: AppService,
  book: Book,
  dim: number,
  fit: LibraryCoverFitType,
): Promise<void> => {
  const request: SetCoverScreenBookRequest = {
    title: book.title ?? '',
    author: book.author ?? '',
    coverPath: joinScannedPath(await resolveBooksDir(appService), getCoverFilename(book)),
    dim,
    crop: fit === 'crop',
  };
  const fingerprint = JSON.stringify(request);
  try {
    if (fingerprint !== lastPublished) {
      await setCoverScreenBook(request);
      lastPublished = fingerprint;
    }
    await startCoverScreen();
  } catch (err) {
    lastPublished = '';
    console.warn('Failed to show the book on the cover screen', err);
  }
};

export const hideCoverScreen = async (): Promise<void> => {
  try {
    await stopCoverScreen();
  } catch (err) {
    console.warn('Failed to stop the cover screen', err);
  }
};
