import { env } from "../config/env.js";
import { sendError } from "../lib/apiResponse.js";

/**
 * Middleware autentikasi sederhana berbasis API Key.
 * Membaca header Authorization dengan format Bearer token
 * lalu mencocokkannya dengan API_KEY pada file .env.
 */
export const apiKeyAuth = (req, res, next) => {
  const authorizationHeader = req.headers.authorization || "";

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return sendError(res, {
      statusCode: 401,
      message: "Header Authorization tidak valid atau hilang",
    });
  }

  if (token !== env.apiKey) {
    return sendError(res, {
      statusCode: 401,
      message: "API Key tidak cocok",
    });
  }

  return next();
};
