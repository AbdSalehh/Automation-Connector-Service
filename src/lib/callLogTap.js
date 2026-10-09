/**
 * Penyadap riwayat panggilan dari mutasi app-state WhatsApp.
 *
 * WhatsApp tidak mengirim stanza `call` ke perangkat tertaut untuk panggilan
 * yang dibuat dari ponsel utama, sehingga event `call` Baileys hanya pernah
 * memancarkan panggilan MASUK. Riwayat panggilan keluar datang lewat jalur
 * lain: mutasi app-state `callLogAction`, yang membawa `CallLogRecord` lengkap
 * dengan arah panggilan (`isIncoming`), durasi, dan peserta.
 *
 * Baileys mendekode mutasi tersebut, tetapi `processSyncAction` tidak memiliki
 * cabang untuk `callLogAction` sehingga isinya dibuang tanpa event apa pun.
 * Satu-satunya titik mutasi itu dapat diamati dari luar tanpa mem-fork Baileys
 * adalah log trace yang dipancarkan tepat sebelum pencocokan jenis action.
 * Logger yang dipakai socket adalah objek yang kita berikan sendiri ke
 * `makeWASocket` dan diteruskan apa adanya, sehingga dapat disadap di sini.
 */

/** Pesan log yang dipancarkan `processSyncAction` untuk setiap mutasi. */
const SYNC_ACTION_LOG_MESSAGE = "processing sync action";

/**
 * Membungkus logger agar setiap mutasi app-state diperiksa lebih dulu. Logger
 * asli dipakai sebagai prototipe sehingga seluruh method pino (`info`, `child`,
 * dan lainnya) tetap tersedia apa adanya; hanya `trace` yang disadap.
 *
 * Penyadapan tidak pernah menggagalkan logging: kegagalan pada handler ditelan
 * agar sinkronisasi app-state Baileys tetap berjalan.
 */
export const createCallLogTappedLogger = (baseLogger, onCallLogRecord) => {
  const tappedLogger = Object.create(baseLogger);

  tappedLogger.trace = function tapSyncAction(...traceArguments) {
    const [payload, message] = traceArguments;

    if (message === SYNC_ACTION_LOG_MESSAGE) {
      const mutation = payload?.syncAction;
      const callLogRecord =
        mutation?.syncAction?.value?.callLogAction?.callLogRecord;

      if (callLogRecord) {
        /**
         * `index` ikut diteruskan karena `participants` pada record bisa kosong
         * untuk panggilan satu lawan satu, sementara index mutasi umumnya masih
         * memuat JID lawan bicara.
         */
        Promise.resolve()
          .then(() =>
            onCallLogRecord({
              record: callLogRecord,
              index: Array.isArray(mutation?.index) ? mutation.index : [],
            }),
          )
          .catch((error) => {
            baseLogger.error(
              { err: error?.message },
              "Gagal memproses riwayat panggilan dari app-state",
            );
          });
      }
    }

    return baseLogger.trace(...traceArguments);
  };

  return tappedLogger;
};
