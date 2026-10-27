import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { CoverScreenStatusResponse } from '@/utils/coverScreenBridge';

const mocks = vi.hoisted(() => ({
  appService: { isAndroidApp: true } as { isAndroidApp: boolean },
  onStatus: undefined as ((status: CoverScreenStatusResponse) => void) | undefined,
  unregister: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.appService }),
}));
vi.mock('@/services/coverScreen', () => ({
  showBookOnCoverScreen: vi.fn().mockResolvedValue(undefined),
  hideCoverScreen: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/coverScreenBridge', () => ({
  getCoverScreenStatus: vi.fn(),
  onCoverScreenStatus: vi.fn((callback: (status: CoverScreenStatusResponse) => void) => {
    mocks.onStatus = callback;
    return Promise.resolve({ unregister: mocks.unregister });
  }),
}));

import { useCoverScreen, useCoverScreenStatus } from '@/hooks/useCoverScreen';
import { hideCoverScreen, showBookOnCoverScreen } from '@/services/coverScreen';
import { getCoverScreenStatus } from '@/utils/coverScreenBridge';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import type { BookData } from '@/store/bookDataStore';

const mk = (hash: string, over: Partial<Book> = {}): Book =>
  ({ hash, title: `Title ${hash}`, author: 'A', format: 'EPUB', updatedAt: 0, ...over }) as Book;

const setEnabled = (
  coverScreenEnabled: boolean,
  coverScreenDim = 0,
  coverScreenFit: SystemSettings['coverScreenFit'] = 'fit',
) =>
  act(() => {
    useSettingsStore.setState({
      settings: { coverScreenEnabled, coverScreenDim, coverScreenFit } as SystemSettings,
    });
  });

const openBooks = (...books: Book[]) =>
  act(() => {
    useBookDataStore.setState({
      booksData: Object.fromEntries(
        books.map((b) => [b.hash, { id: b.hash, book: b } as BookData]),
      ),
    });
  });

const focus = (key: string | null) =>
  act(() => {
    useSidebarStore.setState({ sideBarBookKey: key });
  });

const shownBooks = () => vi.mocked(showBookOnCoverScreen).mock.calls.map((call) => call[1].hash);

beforeEach(() => {
  mocks.appService = { isAndroidApp: true };
  vi.mocked(showBookOnCoverScreen).mockClear();
  vi.mocked(hideCoverScreen).mockClear();
  setEnabled(true);
  openBooks(mk('h1'), mk('h2'));
  focus('h1-a');
});

afterEach(() => cleanup());

describe('useCoverScreen', () => {
  it('does nothing outside the Android app', () => {
    mocks.appService = { isAndroidApp: false };
    const { unmount } = renderHook(() => useCoverScreen());
    unmount();

    expect(showBookOnCoverScreen).not.toHaveBeenCalled();
    expect(hideCoverScreen).not.toHaveBeenCalled();
  });

  it('does nothing while the setting is off', () => {
    setEnabled(false);
    const { unmount } = renderHook(() => useCoverScreen());
    unmount();

    expect(showBookOnCoverScreen).not.toHaveBeenCalled();
    expect(hideCoverScreen).not.toHaveBeenCalled();
  });

  it('shows the focused book as configured, and stops when the reader unmounts', () => {
    setEnabled(true, 50, 'crop');
    const { unmount } = renderHook(() => useCoverScreen());

    expect(shownBooks()).toEqual(['h1']);
    expect(vi.mocked(showBookOnCoverScreen).mock.calls[0]!.slice(2)).toEqual([50, 'crop']);
    expect(hideCoverScreen).not.toHaveBeenCalled();

    unmount();
    expect(hideCoverScreen).toHaveBeenCalledOnce();
  });

  it('switches books in place, without stopping the session', () => {
    renderHook(() => useCoverScreen());
    focus('h2-b');

    expect(shownBooks()).toEqual(['h1', 'h2']);
    expect(hideCoverScreen).not.toHaveBeenCalled();
  });

  it('does not re-send when only the book object is replaced (progress saves)', () => {
    renderHook(() => useCoverScreen());
    openBooks(mk('h1', { progress: [10, 100] }), mk('h2'));

    expect(shownBooks()).toEqual(['h1']);
  });

  it('re-sends the book when the fit changes', () => {
    renderHook(() => useCoverScreen());
    setEnabled(true, 0, 'crop');

    expect(shownBooks()).toEqual(['h1', 'h1']);
    expect(hideCoverScreen).not.toHaveBeenCalled();
  });

  it('stops when the setting is turned off or the book is closed', () => {
    renderHook(() => useCoverScreen());
    setEnabled(false);
    expect(hideCoverScreen).toHaveBeenCalledOnce();

    setEnabled(true);
    expect(shownBooks()).toEqual(['h1', 'h1']);
    focus(null);
    expect(hideCoverScreen).toHaveBeenCalledTimes(2);
  });

  it('starts again when the app comes back to the foreground', () => {
    renderHook(() => useCoverScreen());
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(shownBooks()).toEqual(['h1', 'h1']);
    visibility.mockRestore();
  });
});

describe('useCoverScreenStatus', () => {
  beforeEach(() => {
    mocks.onStatus = undefined;
    mocks.unregister.mockReset();
    vi.mocked(getCoverScreenStatus).mockReset();
  });

  it('does not probe when disabled', () => {
    const { result } = renderHook(() => useCoverScreenStatus(false));

    expect(result.current).toBeNull();
    expect(getCoverScreenStatus).not.toHaveBeenCalled();
  });

  it('reports the probed status, then follows native status events', async () => {
    vi.mocked(getCoverScreenStatus).mockResolvedValue({ supported: true, status: 'unavailable' });
    const { result, unmount } = renderHook(() => useCoverScreenStatus(true));

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual({ supported: true, status: 'unavailable' }));

    act(() => mocks.onStatus?.({ supported: true, status: 'active' }));
    expect(result.current).toEqual({ supported: true, status: 'active' });

    unmount();
    await waitFor(() => expect(mocks.unregister).toHaveBeenCalledOnce());
  });

  it('treats a failed probe as unsupported', async () => {
    vi.mocked(getCoverScreenStatus).mockRejectedValue(new Error('no such command'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useCoverScreenStatus(true));

    await waitFor(() =>
      expect(result.current).toEqual({ supported: false, status: 'unsupported' }),
    );
    warn.mockRestore();
  });
});
