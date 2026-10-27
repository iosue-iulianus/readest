import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { hideCoverScreen, showBookOnCoverScreen } from '@/services/coverScreen';
import { getCoverScreenStatus, onCoverScreenStatus } from '@/utils/coverScreenBridge';
import type { CoverScreenStatusResponse } from '@/utils/coverScreenBridge';

/**
 * Shows the focused book's cover on a foldable's outer screen while the reader
 * is open (Android, when enabled in settings). Mounted on the reader page only:
 * leaving the reader, closing the book or turning the setting off stops it.
 * Native restarts the session itself after a fold/unfold or a trip to the
 * background; the visibility listener only re-sends the book in case native
 * state was lost.
 */
export function useCoverScreen() {
  const { appService } = useEnv();
  const enabled = useSettingsStore((s) => s.settings.coverScreenEnabled);
  const dim = useSettingsStore((s) => s.settings.coverScreenDim);
  const fit = useSettingsStore((s) => s.settings.coverScreenFit);
  // In parallel read this is the focused book.
  const sideBarBookKey = useSidebarStore((s) => s.sideBarBookKey);
  const book = useBookDataStore((s) =>
    sideBarBookKey ? s.getBookData(sideBarBookKey)?.book : null,
  );
  const active = !!appService?.isAndroidApp && !!enabled && !!book;

  // The book object is replaced as progress saves; only what the cover shows matters.
  const bookRef = useRef(book);
  bookRef.current = book;

  useEffect(() => {
    if (!active || !appService) return;
    const show = () => {
      if (bookRef.current) {
        void showBookOnCoverScreen(appService, bookRef.current, dim ?? 0, fit ?? 'fit');
      }
    };
    show();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') show();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, appService, book?.hash, book?.title, book?.author, dim, fit]);

  // Separate from the effect above so switching books updates the cover in
  // place instead of ending and restarting the session.
  useEffect(() => {
    if (!active) return;
    return () => {
      void hideCoverScreen();
    };
  }, [active]);
}

/** The outer screen's status for the settings toggle; null until the first answer. */
export function useCoverScreenStatus(enabled: boolean): CoverScreenStatusResponse | null {
  const [status, setStatus] = useState<CoverScreenStatusResponse | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    getCoverScreenStatus()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch((err) => {
        console.warn('Failed to read the cover screen status', err);
        if (!disposed) setStatus({ supported: false, status: 'unsupported' });
      });
    const listener = onCoverScreenStatus((next) => {
      if (!disposed) setStatus(next);
    });
    return () => {
      disposed = true;
      listener.then((registered) => registered.unregister()).catch(() => {});
    };
  }, [enabled]);

  return status;
}
