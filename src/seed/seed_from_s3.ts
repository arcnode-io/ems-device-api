/**
 * Boot-time DTM fetch + seed per ADR-003.
 *
 * url set + table empty → fetch + parse + validate + seed
 * url set + table populated → fetch + skip seed (don't overwrite operator changes)
 * url null → graceful empty start
 * Any fetch/parse/validate/catalog error when url set → fatal (caller propagates)
 */

import { Logger } from "@nestjs/common";
import type { INestApplicationContext } from "@nestjs/common";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { Dtm } from "../topology/dtm.schema";
import type { DtmType } from "../topology/dtm.schema";
import { TopologyService } from "../topology/topology.service";

interface S3Url {
  bucket: string;
  key: string;
}

/**
 * Parse an s3://bucket/key URL into its components.
 * @param url Raw s3:// URL string
 * @returns Parsed bucket and key fields
 */
function parseS3Url(url: string): S3Url {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(url);
  // match[1] and match[2] are guaranteed by the regex capture groups
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`s3:// url required, got ${url}`);
  }
  return { bucket: match[1], key: match[2] };
}

/**
 * Drain a Node.js Readable into a UTF-8 string.
 * @param stream Readable stream to consume
 * @returns Full string contents of the stream
 */
async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch DTM from S3 (or S3-compatible endpoint) and seed topology if empty.
 * @param app Assembled NestJS application context
 * @param url s3://bucket/key, or null to skip fetch
 * @param endpointUrl S3 endpoint override (LocalStack/minio); null = real AWS S3
 * @param logger NestJS Logger instance
 * @param s3 Optional pre-constructed client for tests
 */
export async function seedFromS3(
  app: INestApplicationContext,
  url: string | null,
  endpointUrl: string | null,
  logger: Logger,
  s3?: S3Client,
): Promise<void> {
  if (url === null) {
    logger.log("no boot_dtm_s3_url configured; starting empty");
    return;
  }

  const { bucket, key } = parseS3Url(url);
  const client =
    s3 ??
    new S3Client(
      endpointUrl ? { endpoint: endpointUrl, forcePathStyle: true } : {},
    );

  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (response.Body === undefined) {
    throw new Error(`s3 object ${url} has no body`);
  }
  const body = await streamToString(response.Body as Readable);
  const raw = JSON.parse(body) as unknown;
  const dtm: DtmType = Dtm.parse(raw);

  const service = app.get(TopologyService);
  service.validateAgainstCatalog(dtm);

  const existing = await service.getLatest();
  if (existing !== null) {
    logger.log(`topology already populated; skipping seed from ${url}`);
    return;
  }
  await service.save(dtm);
  logger.log(`seeded topology from ${url}`);
}
