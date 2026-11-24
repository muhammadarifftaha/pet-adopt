// Removes metadata from an image file WITHOUT decoding or re-encoding it, so the pixels are exactly
// the ones the owner uploaded. A photo of an adoptable pet is what makes people get in touch; it must
// not lose quality for the sake of privacy.
//
// Image files are containers: segments (JPEG), chunks (PNG, WebP) or blocks (GIF). The picture is in
// some of them and the metadata (camera, GPS position, comments, an embedded thumbnail that may show
// the uncropped original) is in others. Each function walks the container and copies the pieces that
// are needed to show the picture, byte for byte, and leaves the rest out. Every format works from an
// ALLOWLIST of the pieces that show the picture: a piece that is not on it is left out (PNG, WebP,
// GIF, JPEG application segments and comments) or, where its meaning is unclear (an unexpected JPEG
// marker), the whole file is refused. A new kind of metadata is therefore removed by default, never
// kept by default. Where a kept piece has a fixed layout and could carry extra bytes (the JFIF header,
// GIF timing and loop blocks), it is rebuilt from its known fields instead of copied.
//
// What is kept besides the picture: the colour profile (colours would shift without it), animation
// data, and, for JPEG and WebP, a tiny EXIF block that holds ONLY the orientation. Phones store photos
// sideways and record the rotation in EXIF; dropping it would show portrait photos on their side.
//
// Every function throws StripError for a file it cannot walk to the end. The caller must then refuse
// the upload: storing the original would publish the metadata this exists to remove.
//
// AVIF (and HEIC) are not handled here at all: their metadata, extra images and thumbnails are items
// woven into the file's offset tables, which cannot be cut out without a full ISO-BMFF writer, and
// sharp does not report all of them. uploads.ts refuses these formats.

export class StripError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripError'
  }
}

const fail = (message: string): never => {
  throw new StripError(message)
}

/** The orientation (1 to 8) recorded in an EXIF/TIFF block, or null. */
export function readOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null
  const little = tiff[0] === 0x49 && tiff[1] === 0x49
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d
  if (!little && !big) return null
  const u16 = (offset: number) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset))
  const u32 = (offset: number) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset))
  if (u16(2) !== 42) return null
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return null
  const entries = u16(ifd)
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return null
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/** A complete TIFF structure with a single entry: the orientation. 26 bytes, nothing identifying. */
function orientationOnlyTiff(orientation: number): Buffer {
  const tiff = Buffer.alloc(26)
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4) // the first (only) IFD starts right after the header
  tiff.writeUInt16LE(1, 8) // one entry
  tiff.writeUInt16LE(0x0112, 10) // tag: Orientation
  tiff.writeUInt16LE(3, 12) // type: SHORT
  tiff.writeUInt32LE(1, 14) // count
  tiff.writeUInt16LE(orientation, 18) // value (padded to four bytes)
  // bytes 22..25: offset of the next IFD, 0 = none
  return tiff
}

// --- JPEG ----------------------------------------------------------------------------------------

function jpegExifSegment(orientation: number): Buffer {
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), orientationOnlyTiff(orientation)])
  const header = Buffer.from([0xff, 0xe1, 0, 0])
  header.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([header, body])
}

// The JPEG markers that make up the picture: quantisation and Huffman/arithmetic tables, the frame
// header (every SOFn the standard defines), restart interval, and the rarely used DNL and EXP. The
// scan (SOS), restart markers and the start and end markers are handled separately.
const JPEG_PICTURE_MARKERS = new Set([
  0xdb, 0xc4, 0xcc, 0xdd, 0xdc, 0xdf, 0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) fail('not a JPEG')
  const parts: Buffer[] = [buf.subarray(0, 2)]
  let orientation: number | null = null
  let exifAt = 1 // where the orientation block goes: after the start marker and a leading JFIF header
  let pos = 2
  let ended = false

  while (pos < buf.length) {
    if (buf[pos] !== 0xff) fail('bad JPEG marker')
    let marker = buf[pos + 1]
    // Any number of 0xFF fill bytes may precede a marker.
    while (marker === 0xff) {
      pos++
      if (pos + 1 >= buf.length) fail('truncated JPEG')
      marker = buf[pos + 1]
    }
    if (marker === 0x00) fail('bad JPEG marker')
    if (marker === 0xd9) {
      // End of image. Everything after it (a hidden payload, a second image) is not copied.
      parts.push(Buffer.from([0xff, 0xd9]))
      ended = true
      break
    }
    // Markers without a length: restart markers, TEM and SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(buf.subarray(pos, pos + 2))
      pos += 2
      continue
    }

    if (pos + 4 > buf.length) fail('truncated JPEG')
    const length = buf.readUInt16BE(pos + 2)
    const end = pos + 2 + length
    if (length < 2 || end > buf.length) fail('bad JPEG segment length')
    const segment = buf.subarray(pos, end)
    const payload = buf.subarray(pos + 4, end)

    if (marker === 0xda) {
      // Start of scan: the header, then the compressed data up to the next real marker. Inside the
      // data an 0xFF is always followed by 0x00 (a literal 0xFF) or a restart marker 0xD0..0xD7.
      parts.push(segment)
      let p = end
      while (p < buf.length) {
        if (buf[p] === 0xff && p + 1 < buf.length) {
          const next = buf[p + 1]
          if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break
        }
        p++
      }
      parts.push(buf.subarray(end, p))
      pos = p
      continue
    }

    if (marker >= 0xe0 && marker <= 0xef) {
      // Application segments: EXIF, XMP, IPTC, thumbnails, vendor data. Keep only what the picture needs.
      if (marker === 0xe1 && payload.subarray(0, 6).toString('latin1') === 'Exif\0\0') {
        orientation ??= readOrientation(payload.subarray(6))
      }
      const jfif = marker === 0xe0 && payload.subarray(0, 5).toString('latin1') === 'JFIF\0'
      const adobe = marker === 0xee && payload.subarray(0, 5).toString('latin1') === 'Adobe'
      const icc = marker === 0xe2 && payload.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0'
      if (jfif) {
        // A JFIF header can carry a small thumbnail (the original, uncropped) after its fixed fields.
        // Rebuild the header from those fields alone and say there is no thumbnail.
        if (payload.length < 14) fail('bad JFIF header')
        const header = Buffer.alloc(18)
        header[0] = 0xff
        header[1] = 0xe0
        header.writeUInt16BE(16, 2)
        payload.copy(header, 4, 0, 12) // "JFIF\0", version, units, pixel density; the thumbnail size stays 0 x 0
        parts.push(header)
        if (parts.length === 2) exifAt = 2
      } else if (adobe || icc) {
        parts.push(segment)
      }
    } else if (marker === 0xfe) {
      // A comment. Not copied.
    } else if (JPEG_PICTURE_MARKERS.has(marker)) {
      parts.push(segment)
    } else {
      // Reserved and extension markers (0x02..0xBF, JPG, JPGn...): nothing a browser needs, and a
      // place to hide data. Refuse the file rather than guess what they mean.
      fail(`unexpected JPEG marker 0x${marker.toString(16)}`)
    }
    pos = end
  }

  if (!ended) fail('JPEG has no end marker')
  if (orientation && orientation > 1) parts.splice(exifAt, 0, jpegExifSegment(orientation))
  return Buffer.concat(parts)
}

// --- PNG -----------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// What shows the picture: image data, palette, transparency, colour description, animation.
// Text chunks (tEXt, zTXt, iTXt), eXIf, tIME, and any private chunk are not in the list.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'cICP', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT'])

function stripPng(buf: Buffer): Buffer {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) fail('not a PNG')
  const parts: Buffer[] = [buf.subarray(0, 8)]
  let pos = 8
  let ended = false
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const end = pos + 12 + length // length, type, data, CRC
    if (end > buf.length) fail('truncated PNG chunk')
    // Copied whole, CRC included, so the chunk stays valid.
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(pos, end))
    pos = end
    if (type === 'IEND') {
      ended = true
      break // anything after IEND is not copied
    }
  }
  if (!ended) fail('PNG has no end chunk')
  return Buffer.concat(parts)
}

// --- GIF -----------------------------------------------------------------------------------------

/** Position just after a run of data sub-blocks (and their zero terminator). */
function skipSubBlocks(buf: Buffer, from: number): number {
  let pos = from
  while (true) {
    if (pos >= buf.length) fail('truncated GIF')
    const size = buf[pos]
    pos += 1 + size
    if (size === 0) return pos
  }
}

function stripGif(buf: Buffer): Buffer {
  const signature = buf.toString('latin1', 0, 6)
  if (signature !== 'GIF87a' && signature !== 'GIF89a') fail('not a GIF')
  if (buf.length < 13) fail('truncated GIF')
  const packed = buf[10]
  let pos = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0)
  const parts: Buffer[] = [buf.subarray(0, pos)]
  let ended = false

  while (pos < buf.length) {
    const introducer = buf[pos]
    if (introducer === 0x3b) {
      parts.push(Buffer.from([0x3b]))
      ended = true
      break // anything after the trailer is not copied
    }
    if (introducer === 0x21) {
      const label = buf[pos + 1]
      const next = skipSubBlocks(buf, pos + 2)
      if (label === 0xf9) {
        // Graphic control: exactly four bytes of frame timing and transparency. Rebuilt from those
        // bytes rather than copied, so nothing can ride along in extra sub-blocks.
        if (buf[pos + 2] !== 4 || next !== pos + 8) fail('bad GIF graphic control block')
        parts.push(Buffer.from([0x21, 0xf9, 4, buf[pos + 3], buf[pos + 4], buf[pos + 5], buf[pos + 6], 0]))
      } else if (label === 0xff && buf[pos + 2] === 11 && ['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(buf.toString('latin1', pos + 3, pos + 14))) {
        // The loop count is one 16-bit number. Write a fresh block holding just that; the original's
        // extra sub-blocks (and XMP and every other application extension) are not copied.
        if (buf[pos + 14] >= 3 && buf[pos + 15] === 1) {
          const loops = buf.readUInt16LE(pos + 16)
          parts.push(Buffer.concat([Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([0x03, 0x01, loops & 0xff, loops >> 8, 0x00])]))
        }
      }
      pos = next
      continue
    }
    if (introducer === 0x2c) {
      // An image: descriptor (10 bytes), optional local colour table, LZW code size, then data.
      if (pos + 10 > buf.length) fail('truncated GIF')
      const local = buf[pos + 9]
      const table = local & 0x80 ? 3 * (1 << ((local & 7) + 1)) : 0
      const next = skipSubBlocks(buf, pos + 10 + table + 1)
      parts.push(buf.subarray(pos, next))
      pos = next
      continue
    }
    fail('bad GIF block')
  }
  if (!ended) fail('GIF has no trailer')
  return Buffer.concat(parts)
}

// --- WebP ----------------------------------------------------------------------------------------

// What shows the picture. EXIF and XMP chunks, and any chunk not listed, are left out.
const WEBP_KEEP = new Set(['ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L'])
const WEBP_FLAG_EXIF = 0x08
const WEBP_FLAG_XMP = 0x04

function stripWebp(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') fail('not a WebP')
  let pos = 12
  let vp8x: Buffer | null = null
  let orientation: number | null = null
  const chunks: Buffer[] = []

  while (pos + 8 <= buf.length) {
    const type = buf.toString('latin1', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const dataEnd = pos + 8 + size
    const end = dataEnd + (size % 2) // chunks are padded to an even length
    if (dataEnd > buf.length) fail('truncated WebP chunk')
    const data = buf.subarray(pos + 8, dataEnd)
    if (type === 'VP8X') {
      if (size < 10) fail('bad WebP header chunk')
      vp8x = Buffer.from(data.subarray(0, 10)) // a copy: its flags are rewritten below
    } else if (type === 'EXIF') {
      // Some writers put the "Exif\0\0" prefix in the chunk, some do not.
      const tiff = data.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? data.subarray(6) : data
      orientation ??= readOrientation(tiff)
    } else if (WEBP_KEEP.has(type)) {
      chunks.push(buf.subarray(pos, Math.min(end, buf.length)))
    }
    pos = end
  }
  if (!chunks.length) fail('WebP has no image data')

  const out: Buffer[] = []
  if (vp8x) {
    // Metadata exists only in the extended format. Say there is none, except the orientation block.
    vp8x[0] = vp8x[0] & ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP)
    const keepOrientation = orientation !== null && orientation > 1
    if (keepOrientation) vp8x[0] = vp8x[0] | WEBP_FLAG_EXIF
    const head = Buffer.alloc(8)
    head.write('VP8X', 0, 'latin1')
    head.writeUInt32LE(10, 4)
    out.push(head, vp8x, ...chunks)
    if (keepOrientation) {
      const tiff = orientationOnlyTiff(orientation as number)
      const exifHead = Buffer.alloc(8)
      exifHead.write('EXIF', 0, 'latin1')
      exifHead.writeUInt32LE(tiff.length, 4)
      out.push(exifHead, tiff) // 26 bytes: already even, no padding needed
    }
  } else {
    out.push(...chunks)
  }

  const body = Buffer.concat(out)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(body.length + 4, 4) // the size counts "WEBP" and the chunks
  riff.write('WEBP', 8, 'latin1')
  return Buffer.concat([riff, body])
}

/**
 * The same image with its metadata removed, byte for byte otherwise. `kind` is the extension chosen
 * by the upload code from the file's real contents. Throws StripError for a file it cannot walk.
 */
export function stripMetadata(kind: 'jpg' | 'png' | 'webp' | 'gif', data: Buffer): Buffer {
  switch (kind) {
    case 'jpg':
      return stripJpeg(data)
    case 'png':
      return stripPng(data)
    case 'webp':
      return stripWebp(data)
    case 'gif':
      return stripGif(data)
  }
}
