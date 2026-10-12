/**
 * Antrean serial sederhana: tugas dijalankan satu per satu sesuai urutan masuk.
 *
 * Event Baileys dipancarkan tanpa menunggu handler sebelumnya selesai. Saat
 * sesi baru tersambung, puluhan batch `messages.upsert` dan `contacts.upsert`
 * bisa tiba hampir bersamaan, dan masing-masing menjalankan banyak query.
 * Tanpa antrean, semuanya berebut pool koneksi Prisma yang kecil sehingga
 * query lain kehabisan waktu tunggu (P2024).
 *
 * Antrean juga menjadi batas isolasi error: kegagalan satu tugas dicatat lewat
 * `onError` dan tidak menghentikan tugas berikutnya, serta tidak pernah
 * menjadi unhandled rejection yang mematikan proses.
 */
export const createSerialQueue = (onError) => {
  let tail = Promise.resolve();

  return (task) => {
    tail = tail.then(task).catch((error) => {
      onError(error);
    });

    return tail;
  };
};
