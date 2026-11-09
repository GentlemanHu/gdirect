//! gdirect's engine, shared by the `gdirect` command and the desktop client.
pub mod api;
pub mod auth;
pub mod download;
pub mod drive;
pub mod mount;
pub mod netif;
pub mod proxy;
pub mod ranges;
pub mod route;
pub mod scan;
pub mod store;
#[cfg(test)]
mod test_network;
pub mod tui;
pub mod upload;

#[allow(clippy::all)]
pub mod auth_middleware;
#[allow(clippy::all)]
pub mod extensions;
#[allow(clippy::all)]
pub mod server;
#[allow(clippy::all)]
pub mod stream;
#[allow(clippy::all)]
pub mod strm;
#[allow(clippy::all)]
pub mod webdav;
