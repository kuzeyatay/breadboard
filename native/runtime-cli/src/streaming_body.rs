use std::cmp;
use std::io::{self, Read};

const MAX_CHUNK_SIZE_LINE_BYTES: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StreamingBodyFraming {
    ContentLength(u64),
    Chunked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChunkState {
    Header,
    Data(u64),
    DataTerminator,
    FinalTerminator,
    Complete,
}

/// A one-request HTTP/1.1 entity decoder for the private upload route.
///
/// The ordinary control protocol continues to reject transfer encodings and
/// buffer only small JSON. This reader exists solely so a bounded raw upload
/// can flow directly into Runtime V2's one-shot staging writer. It accepts no
/// chunk extensions or trailers, never allocates from a peer-provided size,
/// and counts decoded bytes against one runtime-owned ceiling.
pub(crate) struct StreamingBody<R> {
    source: R,
    prefix: Vec<u8>,
    prefix_offset: usize,
    framing: StreamingBodyFraming,
    chunk_state: ChunkState,
    remaining_content_length: u64,
    maximum_decoded_bytes: u64,
    decoded_bytes: u64,
    complete: bool,
}

impl<R> Drop for StreamingBody<R> {
    fn drop(&mut self) {
        // The prelude can already contain the first document bytes. Erase
        // that bounded in-memory copy when the request completes or aborts.
        self.prefix.fill(0);
    }
}

impl<R: Read> StreamingBody<R> {
    pub(crate) fn new(
        source: R,
        prefix: Vec<u8>,
        framing: StreamingBodyFraming,
        maximum_decoded_bytes: u64,
    ) -> io::Result<Self> {
        if maximum_decoded_bytes == 0 {
            return Err(invalid_data("streaming body maximum must be positive"));
        }
        let remaining_content_length = match framing {
            StreamingBodyFraming::ContentLength(length) => {
                if length == 0 || length > maximum_decoded_bytes {
                    return Err(if length > maximum_decoded_bytes {
                        too_large("streaming Content-Length exceeded its bound")
                    } else {
                        invalid_data("streaming Content-Length must be positive")
                    });
                }
                let prefix_length = u64::try_from(prefix.len())
                    .map_err(|_| invalid_data("streaming body prefix is too large"))?;
                if prefix_length > length {
                    return Err(invalid_data("streaming body prefix exceeds Content-Length"));
                }
                length
            }
            StreamingBodyFraming::Chunked => 0,
        };
        Ok(Self {
            source,
            prefix,
            prefix_offset: 0,
            framing,
            chunk_state: ChunkState::Header,
            remaining_content_length,
            maximum_decoded_bytes,
            decoded_bytes: 0,
            complete: false,
        })
    }

    /// Proves that the consumer drove the decoder through the exact terminal
    /// boundary instead of stopping after a convenient prefix.
    pub(crate) fn finish(self) -> io::Result<u64> {
        if !self.complete {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "streaming request body was not consumed to completion",
            ));
        }
        if self.prefix_offset != self.prefix.len() {
            return Err(invalid_data(
                "streaming request carried bytes after its terminal boundary",
            ));
        }
        Ok(self.decoded_bytes)
    }

    fn read_source(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.prefix_offset < self.prefix.len() {
            let available = self.prefix.len() - self.prefix_offset;
            let count = cmp::min(available, output.len());
            output[..count]
                .copy_from_slice(&self.prefix[self.prefix_offset..self.prefix_offset + count]);
            self.prefix_offset += count;
            return Ok(count);
        }
        self.source.read(output)
    }

    fn read_source_exact(&mut self, output: &mut [u8]) -> io::Result<()> {
        let mut offset = 0;
        while offset < output.len() {
            match self.read_source(&mut output[offset..])? {
                0 => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "streaming request body ended early",
                    ))
                }
                count => offset += count,
            }
        }
        Ok(())
    }

    fn read_chunk_header(&mut self) -> io::Result<u64> {
        let mut line = [0_u8; MAX_CHUNK_SIZE_LINE_BYTES];
        let mut length = 0;
        loop {
            if length == line.len() {
                return Err(invalid_data("chunk size line exceeded its bound"));
            }
            self.read_source_exact(&mut line[length..length + 1])?;
            length += 1;
            if length >= 2 && line[length - 2..length] == *b"\r\n" {
                break;
            }
        }
        let digits = &line[..length - 2];
        if digits.is_empty() || digits.len() > 16 || !digits.iter().all(u8::is_ascii_hexdigit) {
            return Err(invalid_data("chunk size line is invalid"));
        }
        let text =
            std::str::from_utf8(digits).map_err(|_| invalid_data("chunk size line is invalid"))?;
        u64::from_str_radix(text, 16).map_err(|_| invalid_data("chunk size is invalid"))
    }

    fn account_decoded(&mut self, count: usize) -> io::Result<()> {
        let count = u64::try_from(count)
            .map_err(|_| invalid_data("decoded upload byte count overflowed"))?;
        let next = self
            .decoded_bytes
            .checked_add(count)
            .ok_or_else(|| invalid_data("decoded upload byte count overflowed"))?;
        if next > self.maximum_decoded_bytes {
            return Err(too_large("decoded upload exceeded its runtime bound"));
        }
        self.decoded_bytes = next;
        Ok(())
    }

    fn read_content_length(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.remaining_content_length == 0 {
            self.complete = true;
            return Ok(0);
        }
        let requested = cmp::min(
            output.len(),
            usize::try_from(self.remaining_content_length).unwrap_or(usize::MAX),
        );
        let count = self.read_source(&mut output[..requested])?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "streaming request body ended before Content-Length",
            ));
        }
        self.remaining_content_length -= count as u64;
        self.account_decoded(count)?;
        if self.remaining_content_length == 0 {
            self.complete = true;
        }
        Ok(count)
    }

    fn read_chunked(&mut self, output: &mut [u8]) -> io::Result<usize> {
        loop {
            match self.chunk_state {
                ChunkState::Header => {
                    let size = self.read_chunk_header()?;
                    if size == 0 {
                        self.chunk_state = ChunkState::FinalTerminator;
                    } else {
                        let prospective = self
                            .decoded_bytes
                            .checked_add(size)
                            .ok_or_else(|| invalid_data("decoded upload byte count overflowed"))?;
                        if prospective > self.maximum_decoded_bytes {
                            return Err(too_large("decoded upload exceeded its runtime bound"));
                        }
                        self.chunk_state = ChunkState::Data(size);
                    }
                }
                ChunkState::Data(remaining) => {
                    let requested = cmp::min(
                        output.len(),
                        usize::try_from(remaining).unwrap_or(usize::MAX),
                    );
                    let count = self.read_source(&mut output[..requested])?;
                    if count == 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "chunk data ended early",
                        ));
                    }
                    self.account_decoded(count)?;
                    let next = remaining - count as u64;
                    self.chunk_state = if next == 0 {
                        ChunkState::DataTerminator
                    } else {
                        ChunkState::Data(next)
                    };
                    return Ok(count);
                }
                ChunkState::DataTerminator => {
                    let mut terminator = [0_u8; 2];
                    self.read_source_exact(&mut terminator)?;
                    if terminator != *b"\r\n" {
                        return Err(invalid_data("chunk data terminator is invalid"));
                    }
                    self.chunk_state = ChunkState::Header;
                }
                ChunkState::FinalTerminator => {
                    let mut terminator = [0_u8; 2];
                    self.read_source_exact(&mut terminator)?;
                    if terminator != *b"\r\n" {
                        return Err(invalid_data(
                            "chunk trailers are not permitted on the private upload route",
                        ));
                    }
                    self.chunk_state = ChunkState::Complete;
                    self.complete = true;
                    return Ok(0);
                }
                ChunkState::Complete => {
                    self.complete = true;
                    return Ok(0);
                }
            }
        }
    }
}

impl<R: Read> Read for StreamingBody<R> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.complete {
            return Ok(0);
        }
        match self.framing {
            StreamingBodyFraming::ContentLength(_) => self.read_content_length(output),
            StreamingBodyFraming::Chunked => self.read_chunked(output),
        }
    }
}

fn invalid_data(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn too_large(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::FileTooLarge, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn consume(
        prefix: &[u8],
        remainder: &[u8],
        framing: StreamingBodyFraming,
        maximum: u64,
    ) -> io::Result<(Vec<u8>, u64)> {
        let mut body = StreamingBody::new(
            Cursor::new(remainder.to_vec()),
            prefix.to_vec(),
            framing,
            maximum,
        )?;
        let mut decoded = Vec::new();
        body.read_to_end(&mut decoded)?;
        let received = body.finish()?;
        Ok((decoded, received))
    }

    #[test]
    fn fixed_length_streams_prefix_and_socket_bytes_without_overread() {
        let (decoded, received) =
            consume(b"abc", b"def", StreamingBodyFraming::ContentLength(6), 8).unwrap();
        assert_eq!(decoded, b"abcdef");
        assert_eq!(received, 6);
    }

    #[test]
    fn fixed_length_rejects_oversize_prefix_and_early_eof() {
        assert!(StreamingBody::new(
            Cursor::new(Vec::<u8>::new()),
            b"too-long".to_vec(),
            StreamingBodyFraming::ContentLength(2),
            16,
        )
        .is_err());
        assert!(consume(b"a", b"b", StreamingBodyFraming::ContentLength(3), 3,).is_err());
    }

    #[test]
    fn chunked_streaming_decodes_fragmented_chunks_and_exact_terminator() {
        let (decoded, received) = consume(
            b"4\r\nWi",
            b"ki\r\n5\r\npedia\r\n0\r\n\r\n",
            StreamingBodyFraming::Chunked,
            16,
        )
        .unwrap();
        assert_eq!(decoded, b"Wikipedia");
        assert_eq!(received, 9);
    }

    #[test]
    fn chunked_streaming_rejects_extensions_trailers_and_decoded_overflow() {
        for encoded in [
            b"1;private=true\r\nx\r\n0\r\n\r\n".as_slice(),
            b"1\r\nx\r\n0\r\nX-Private: value\r\n\r\n".as_slice(),
        ] {
            assert!(consume(b"", encoded, StreamingBodyFraming::Chunked, 32).is_err());
        }
        let error = consume(
            b"",
            b"9\r\n123456789\r\n0\r\n\r\n",
            StreamingBodyFraming::Chunked,
            8,
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::FileTooLarge);
    }

    #[test]
    fn finish_rejects_a_consumer_that_stops_before_the_terminal_boundary() {
        let mut body = StreamingBody::new(
            Cursor::new(b"bc".to_vec()),
            b"a".to_vec(),
            StreamingBodyFraming::ContentLength(3),
            3,
        )
        .unwrap();
        let mut one = [0_u8; 1];
        body.read_exact(&mut one).unwrap();
        assert_eq!(one, *b"a");
        assert!(body.finish().is_err());
    }
}
