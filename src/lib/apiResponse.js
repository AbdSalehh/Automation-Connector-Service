/**
 * Helper untuk membentuk respons API dengan kerangka metadata standar
 * agar selaras dengan sistem error handling pada AutoFlow.
 */

export const sendSuccess = (
  res,
  { statusCode = 200, message = "Berhasil", data = null },
) => {
  return res.status(statusCode).json({
    success: true,
    statusCode,
    message,
    data,
  });
};

export const sendError = (
  res,
  { statusCode = 500, message = "Terjadi kesalahan pada server", data = null },
) => {
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    data,
  });
};
