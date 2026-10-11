//! Adapter for reqwest 0.13 while oauth2's built-in adapter targets 0.12.
use oauth2::{AsyncHttpClient, HttpClientError, HttpRequest, HttpResponse, SyncHttpClient};
use std::{future::Future, pin::Pin};

pub(crate) struct AsyncClient(pub reqwest::Client);
pub(crate) struct SyncClient(pub reqwest::blocking::Client);

impl<'c> AsyncHttpClient<'c> for AsyncClient {
    type Error = HttpClientError<reqwest::Error>;
    type Future =
        Pin<Box<dyn Future<Output = Result<HttpResponse, Self::Error>> + Send + Sync + 'c>>;
    fn call(&'c self, request: HttpRequest) -> Self::Future {
        Box::pin(async move {
            let response = self
                .0
                .execute(request.try_into().map_err(Box::new)?)
                .await
                .map_err(Box::new)?;
            let mut builder = oauth2::http::Response::builder()
                .status(response.status())
                .version(response.version());
            for (name, value) in response.headers() {
                builder = builder.header(name, value);
            }
            builder
                .body(response.bytes().await.map_err(Box::new)?.to_vec())
                .map_err(HttpClientError::Http)
        })
    }
}
impl SyncHttpClient for SyncClient {
    type Error = HttpClientError<reqwest::Error>;
    fn call(&self, request: HttpRequest) -> Result<HttpResponse, Self::Error> {
        let response = self
            .0
            .execute(request.try_into().map_err(Box::new)?)
            .map_err(Box::new)?;
        let mut builder = oauth2::http::Response::builder()
            .status(response.status())
            .version(response.version());
        for (name, value) in response.headers() {
            builder = builder.header(name, value);
        }
        builder
            .body(response.bytes().map_err(Box::new)?.to_vec())
            .map_err(HttpClientError::Http)
    }
}
