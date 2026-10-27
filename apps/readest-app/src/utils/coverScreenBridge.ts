import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core';

// Foldable cover screen (Android): native-bridge commands backed by
// CoverScreenController.kt. iOS and desktop have no outer screen.

export type CoverScreenStatus = 'unsupported' | 'unavailable' | 'available' | 'active';

export interface CoverScreenStatusResponse {
  /** False only on devices with no rear display area. */
  supported: boolean;
  /** `unavailable` while folded or while another app holds the outer screen. */
  status: CoverScreenStatus;
}

export interface SetCoverScreenBookRequest {
  title: string;
  author: string;
  coverPath: string;
  /** How much to dim the cover, in percent. */
  dim: number;
  /** Fill the screen and crop the cover's edges instead of showing it whole. */
  crop: boolean;
}

export async function getCoverScreenStatus(): Promise<CoverScreenStatusResponse> {
  return invoke<CoverScreenStatusResponse>('plugin:native-bridge|get_cover_screen_status');
}

export async function setCoverScreenBook(request: SetCoverScreenBookRequest): Promise<void> {
  await invoke('plugin:native-bridge|set_cover_screen_book', { payload: request });
}

/** Shows the book on the outer screen whenever the device is unfolded. */
export async function startCoverScreen(): Promise<void> {
  await invoke('plugin:native-bridge|start_cover_screen');
}

export async function stopCoverScreen(): Promise<void> {
  await invoke('plugin:native-bridge|stop_cover_screen');
}

export function onCoverScreenStatus(
  callback: (status: CoverScreenStatusResponse) => void,
): Promise<PluginListener> {
  return addPluginListener<CoverScreenStatusResponse>(
    'native-bridge',
    'cover-screen-status',
    callback,
  );
}
