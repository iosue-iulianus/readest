//! Foldable outer screen: shows the open book's cover on e.g. a Galaxy Z
//! Fold's cover screen while the app runs unfolded. Android only, backed by
//! `CoverScreenController.kt`; desktop reports no support. The mobile calls
//! live in `mobile.rs`, which owns the plugin handle.

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Runtime};

use crate::NativeBridgeExt;
use crate::Result;

/// The book whose cover the outer screen shows.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCoverScreenBookRequest {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub cover_path: String,
    /// How much to dim the cover, in percent.
    #[serde(default)]
    pub dim: u8,
    /// Fill the screen and crop the cover's edges instead of showing it whole.
    #[serde(default)]
    pub crop: bool,
}

/// `status` is one of "unsupported", "unavailable" (e.g. folded), "available"
/// or "active". `supported` is false only on devices with no rear display area.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverScreenStatusResponse {
    pub supported: bool,
    pub status: String,
}

#[command]
pub(crate) async fn get_cover_screen_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CoverScreenStatusResponse> {
    app.native_bridge().get_cover_screen_status()
}

#[command]
pub(crate) async fn set_cover_screen_book<R: Runtime>(
    app: AppHandle<R>,
    payload: SetCoverScreenBookRequest,
) -> Result<()> {
    app.native_bridge().set_cover_screen_book(payload)
}

#[command]
pub(crate) async fn start_cover_screen<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_bridge().start_cover_screen()
}

#[command]
pub(crate) async fn stop_cover_screen<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_bridge().stop_cover_screen()
}

#[cfg(desktop)]
impl<R: Runtime> crate::desktop::NativeBridge<R> {
    pub fn get_cover_screen_status(&self) -> Result<CoverScreenStatusResponse> {
        Ok(CoverScreenStatusResponse {
            supported: false,
            status: "unsupported".into(),
        })
    }

    pub fn set_cover_screen_book(&self, _payload: SetCoverScreenBookRequest) -> Result<()> {
        Ok(())
    }

    pub fn start_cover_screen(&self) -> Result<()> {
        Ok(())
    }

    pub fn stop_cover_screen(&self) -> Result<()> {
        Ok(())
    }
}
