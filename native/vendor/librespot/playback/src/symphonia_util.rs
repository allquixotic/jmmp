use symphonia::core::{formats::FormatReader, meta::Metadata};
pub fn get_latest_metadata(format: &mut Box<dyn FormatReader>) -> Option<Metadata<'_>> {
    let mut metadata = format.metadata();
    _ = metadata.skip_to_latest();
    Some(metadata)
}
