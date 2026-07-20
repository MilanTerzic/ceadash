import { unzipSync } from "fflate";

const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 75 * 1024 * 1024;
const MAX_XML_DOCUMENTS = 500;

export function isZipPayload(bytes: Uint8Array, contentType: string): boolean {
  return (
    /(?:application\/(?:zip|x-zip-compressed|octet-stream)|zip)/i.test(contentType) ||
    (bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08)))
  );
}

export function extractEntsoeZipDocuments(bytes: Uint8Array): string[] {
  if (!bytes.length) throw new Error("entsoe_empty_response");
  if (bytes.length > MAX_COMPRESSED_BYTES) throw new Error("entsoe_zip_too_large");

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("entsoe_zip_parse_error");
  }

  const xmlEntries = Object.entries(entries).filter(
    ([name, value]) => /\.xml$/i.test(name) && value.length > 0,
  );
  if (!xmlEntries.length) throw new Error("entsoe_zip_no_xml_documents");
  if (xmlEntries.length > MAX_XML_DOCUMENTS) throw new Error("entsoe_zip_too_many_documents");

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let extractedBytes = 0;
  const documents: string[] = [];
  for (const [, value] of xmlEntries) {
    extractedBytes += value.length;
    if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error("entsoe_zip_too_large");
    const xml = decoder.decode(value).trim();
    if (xml) documents.push(xml);
  }
  if (!documents.length) throw new Error("entsoe_zip_no_xml_documents");
  return documents;
}
