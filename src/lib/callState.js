/**
 * Aturan status panggilan yang dipakai bersama oleh pencatat event, pencatat
 * riwayat app-state, dan penyaji data.
 *
 * Event `terminate` dari WhatsApp bersifat ambigu. Baileys mendokumentasikannya
 * sebagai event yang dipancarkan ketika panggilan "accepted/rejected/timeout/
 * caller hangs up". Jadi untuk panggilan MASUK yang diangkat di ponsel utama,
 * perangkat tertaut menerima `terminate` pada saat panggilan DIANGKAT, bukan
 * saat berakhir. Menyimpannya begitu saja sebagai "Selesai" membuat panggilan
 * yang masih berlangsung terlihat selesai, dengan durasi 0 detik.
 */

/**
 * Selisih maksimum (detik) antara `accept` dan `terminate` agar keduanya
 * dianggap satu kejadian "diangkat", bukan panggilan yang sudah berbicara.
 */
export const ANSWERED_TERMINATE_WINDOW_SECONDS = 3;

/**
 * Batas waktu sebuah panggilan boleh tampil "berlangsung" tanpa kabar akhir.
 * Kabar akhir (durasi dan hasil) datang dari riwayat app-state setelah
 * panggilan selesai. Bila kabar itu tidak pernah tiba, panggilan tidak boleh
 * tampil berlangsung selamanya.
 */
export const ONGOING_CALL_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * True bila sebuah event `terminate` pada panggilan masuk satu lawan satu
 * kemungkinan besar menandakan panggilan baru DIANGKAT, bukan berakhir. Event
 * `timeout` dan `reject` punya status sendiri sehingga tidak ikut terhitung.
 */
export const isAnsweredTerminate = ({
  status,
  isIncoming,
  isGroup,
  acceptedAt,
  callDate,
}) => {
  if (status !== "terminate" || !isIncoming || isGroup) {
    return false;
  }

  if (!acceptedAt) {
    return true;
  }

  const secondsSinceAccept = (callDate - acceptedAt) / 1000;

  return secondsSinceAccept < ANSWERED_TERMINATE_WINDOW_SECONDS;
};

/**
 * Menyesuaikan status panggilan untuk ditampilkan.
 *
 * - `accept` yang sudah punya durasi pasti sudah selesai, karena durasi hanya
 *   diketahui setelah panggilan berakhir.
 * - `accept` tanpa durasi yang sudah melewati batas waktu dianggap selesai,
 *   agar tidak tampil berlangsung selamanya.
 */
export const normalizeCallForDisplay = (call, sentAt) => {
  if (!call || call.status !== "accept") {
    return call;
  }

  if (call.durationSeconds > 0) {
    return { ...call, status: "terminate" };
  }

  const ageMs = Date.now() - new Date(sentAt).getTime();

  return ageMs > ONGOING_CALL_MAX_AGE_MS
    ? { ...call, status: "terminate" }
    : call;
};
