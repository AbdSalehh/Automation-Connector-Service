import pino from "pino";

/**
 * Logger terpusat menggunakan pino.
 * Saat development memakai pino-pretty agar log mudah dibaca,
 * saat production memakai format JSON standar.
 */
const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});
