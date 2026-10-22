use std::path::PathBuf;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("screen capture failed: {0}")]
    Capture(#[from] xcap::XCapError),

    #[error("no monitor found at ({x}, {y})")]
    NoMonitor { x: i32, y: i32 },

    #[error("the selected region is empty or outside the image")]
    EmptyRegion,

    #[error("library item {0} not found")]
    ItemNotFound(uuid::Uuid),

    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error(transparent)]
    Image(#[from] image::ImageError),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error("library database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("invalid annotation document: {0}")]
    InvalidDocument(String),
}

pub(crate) trait IoContext<T> {
    fn at(self, path: impl Into<PathBuf>) -> Result<T>;
}

impl<T> IoContext<T> for std::io::Result<T> {
    fn at(self, path: impl Into<PathBuf>) -> Result<T> {
        self.map_err(|source| Error::Io {
            path: path.into(),
            source,
        })
    }
}
