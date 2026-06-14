/**
 * Membersihkan nomor telepon dari karakter non-digit
 * seperti tanda plus, spasi, strip, dan tanda kurung.
 */
export const normalizePhoneNumber = (rawNumber) => {
  if (!rawNumber) {
    return "";
  }

  return String(rawNumber).replace(/\D/g, "");
};

/**
 * Mengubah nomor bersih menjadi WhatsApp JID
 * dengan format <nomor>@s.whatsapp.net.
 */
export const toWhatsappJid = (rawNumber) => {
  const cleanNumber = normalizePhoneNumber(rawNumber);

  return `${cleanNumber}@s.whatsapp.net`;
};

/**
 * Mengekstrak nomor bersih dari sebuah remoteJid Baileys,
 * contoh: 6281234567890@s.whatsapp.net menjadi 6281234567890.
 */
export const extractNumberFromJid = (remoteJid) => {
  if (!remoteJid) {
    return "";
  }

  const [beforeAt] = String(remoteJid).split("@");

  const [numberPart] = beforeAt.split(":");

  return normalizePhoneNumber(numberPart);
};
