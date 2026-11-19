//! Platform-independent core of Zwopp.
//!
//! Every frontend (the desktop UI and the command line) goes
//! through this crate so that all of them share a single code path.

pub mod archive;
pub mod capture;
pub mod error;
pub mod export;
pub mod hotkeys;
pub mod library;
pub mod record;
pub mod settings;
#[doc(hidden)]
pub mod testing;

pub use error::{Error, Result};
