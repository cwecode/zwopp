//! Platform-independent core of Screenbook.
//!
//! Every frontend (desktop UI today; CLI, HTTP API and MCP server later) goes
//! through this crate so that all of them share a single code path.

pub mod capture;
pub mod error;
pub mod library;

pub use error::{Error, Result};
