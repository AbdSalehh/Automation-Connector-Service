import crypto from "crypto";

import { env } from "../config/env.js";
import { sendError } from "../lib/apiResponse.js";
import { sanitizeSessionId } from "../lib/sessionId.js";
import { isSessionOwnedBy } from "../services/session-ownership.store.js";

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

const safeCompare = (providedSignature, expectedSignature) => {
  const providedBuffer = Buffer.from(providedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

export const ownerAuth = (request, response, next) => {
  const ownerId = String(request.headers["x-owner-id"] || "").trim();
  const timestamp = String(request.headers["x-owner-timestamp"] || "").trim();
  const signature = String(request.headers["x-owner-signature"] || "").trim();
  const timestampMs = Number(timestamp);

  if (!env.baileysOwnerSecret) {
    return sendError(response, {
      statusCode: 503,
      message: "Verifikasi ownership belum dikonfigurasi",
    });
  }

  if (
    !ownerId ||
    !timestamp ||
    !signature ||
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_SIGNATURE_AGE_MS
  ) {
    return sendError(response, {
      statusCode: 401,
      message: "Header ownership tidak valid atau kedaluwarsa",
    });
  }

  const signedValue = [
    ownerId,
    timestamp,
    request.method.toUpperCase(),
    request.path,
  ].join(".");
  const expectedSignature = crypto
    .createHmac("sha256", env.baileysOwnerSecret)
    .update(signedValue)
    .digest("hex");

  if (!safeCompare(signature, expectedSignature)) {
    return sendError(response, {
      statusCode: 401,
      message: "Signature ownership tidak valid",
    });
  }

  request.ownerId = ownerId;

  return next();
};

export const requireOwnedSession = async (request, response, next) => {
  const sessionId = sanitizeSessionId(request.params.sessionId);

  if (!sessionId) {
    return sendError(response, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  const isOwned = await isSessionOwnedBy(request.ownerId, sessionId);

  if (!isOwned) {
    return sendError(response, {
      statusCode: 403,
      message: "Anda tidak memiliki akses ke sesi WhatsApp ini",
    });
  }

  return next();
};
