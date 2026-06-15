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

/**
 * Meresolusi nomor pengirim asli dari sebuah message key Baileys. WhatsApp versi
 * baru kadang memakai LID (`<digit>@lid`) pada `remoteJid` demi privasi, sehingga
 * nomor asli harus diambil dari `senderPn` (chat pribadi) atau `participantPn`
 * (grup). Mengembalikan string kosong bila tidak ada sumber nomor asli.
 */
export const resolveSenderNumber = (messageKey) => {
  const remoteJid = messageKey?.remoteJid ?? "";

  if (remoteJid && !remoteJid.endsWith("@lid")) {
    return extractNumberFromJid(remoteJid);
  }

  const phoneNumberJid =
    messageKey?.senderPn || messageKey?.participantPn || "";

  if (phoneNumberJid) {
    return extractNumberFromJid(phoneNumberJid);
  }

  return "";
};
