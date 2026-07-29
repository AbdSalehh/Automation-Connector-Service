/**
 * Database seed for the Fluxera automation platform.
 *
 * Creates an admin user and the reference reminder workflow described in
 * docs/workflow-design-google-sheet-whatsapp-reminder.md:
 *
 *   Google Sheets Trigger -> Read Sheet -> Condition (Belum Bayar)
 *   -> Date Calculator (Deadline - 3 hari, 09:00) -> Schedule
 *   -> Send WhatsApp (Whapi) -> Wait Reply -> Update Sheet (kolom Respon)
 *
 * Credential IDs are left empty so the user picks their own in the editor.
 * Columns are fetched live from the connected spreadsheet.
 *
 * Run with:
 *   node prisma/seed.js
 */

const { PrismaClient } = require("./lib/generated/prisma");

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@autoflow.local";

const REMINDER_WORKFLOW_NAME = "Reminder Pembayaran (Sheets + WhatsApp)";

/**
 * Node graph for the reference reminder workflow. Positions are laid out left
 * to right so the flow reads naturally on the canvas.
 */
const REMINDER_NODES = JSON.stringify([
  {
    id: "node-sheets-trigger",
    type: "workflowNode",
    position: { x: 40, y: 240 },
    data: {
      kind: "google_sheets_trigger",
      label: "Sheet Diperbarui",
      config: {
        triggerColumn: ["Status", "Nomor"],
        event: "updated",
        pollingIntervalSeconds: 60,
      },
      credentialId: "",
    },
  },
  {
    id: "node-read-sheet",
    type: "workflowNode",
    position: { x: 320, y: 240 },
    data: {
      kind: "google_sheets_read",
      label: "Baca Baris",
      config: {
        spreadsheetId: "",
        sheetName: "Orders",
      },
      credentialId: "",
    },
  },
  {
    id: "node-condition",
    type: "workflowNode",
    position: { x: 600, y: 240 },
    data: {
      kind: "condition",
      label: "Status Belum Bayar?",
      config: {
        conditions: {
          match: "all",
          rules: [
            { field: "Status", operator: "equals", value: "Belum Bayar" },
          ],
        },
      },
    },
  },
  {
    id: "node-date-calculator",
    type: "workflowNode",
    position: { x: 880, y: 240 },
    data: {
      kind: "date_calculator",
      label: "Deadline - 3 Hari",
      config: {
        dateField: "Deadline",
        operation: "subtract",
        days: "3",
        time: "09:00",
      },
    },
  },
  {
    id: "node-schedule",
    type: "workflowNode",
    position: { x: 1160, y: 240 },
    data: {
      kind: "schedule",
      label: "Tunggu Jadwal",
      config: {
        executeDate: "{{computedDate}}",
        time: "09:00",
      },
    },
  },
  {
    id: "node-send-wa",
    type: "workflowNode",
    position: { x: 1440, y: 240 },
    data: {
      kind: "whatsapp_send",
      label: "Kirim Reminder WA",
      config: {
        provider: "baileys",
        targetField: "Nomor",
        message:
          "Halo {{Nama}} 👋\n\nPembayaran Anda belum kami terima. Batas waktu pembayaran {{Deadline}}.\nBalas pesan ini setelah melakukan pembayaran ya. Terima kasih 🙏",
      },
      credentialId: "",
    },
  },
  {
    id: "node-wait-reply",
    type: "workflowNode",
    position: { x: 1720, y: 240 },
    data: {
      kind: "wait_reply",
      label: "Tunggu Balasan",
      config: {
        matchField: "Nomor",
      },
    },
  },
  {
    id: "node-update-sheet",
    type: "workflowNode",
    position: { x: 2000, y: 240 },
    data: {
      kind: "google_sheets_update",
      label: "Catat Respon",
      config: {
        spreadsheetId: "",
        sheetName: "Orders",
        matchColumn: "Nomor",
        matchValue: "{{sender}}",
        writeTargets: [{ column: "Respon", value: "{{message}}" }],
      },
      credentialId: "",
    },
  },
]);

const REMINDER_EDGES = JSON.stringify([
  {
    id: "e-trigger-read",
    source: "node-sheets-trigger",
    target: "node-read-sheet",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-read-condition",
    source: "node-read-sheet",
    target: "node-condition",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-condition-date",
    source: "node-condition",
    target: "node-date-calculator",
    sourceHandle: "true",
    targetHandle: null,
    label: "true",
  },
  {
    id: "e-date-schedule",
    source: "node-date-calculator",
    target: "node-schedule",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-schedule-send",
    source: "node-schedule",
    target: "node-send-wa",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-send-wait",
    source: "node-send-wa",
    target: "node-wait-reply",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-wait-update",
    source: "node-wait-reply",
    target: "node-update-sheet",
    sourceHandle: null,
    targetHandle: null,
  },
]);

const SCHEDULE_REMINDER_WORKFLOW_NAME = "Reminder Terjadwal (Cron + WhatsApp)";

const SCHEDULE_REMINDER_NODES = JSON.stringify([
  {
    id: "node-schedule-trigger",
    type: "workflowNode",
    position: { x: 40, y: 240 },
    data: {
      kind: "schedule_trigger",
      label: "Jadwal Reminder",
      config: {
        scheduleMode: "daily",
        dailyTime: "09:00",
        cron: "0 9 * * *",
      },
    },
  },
  {
    id: "node-read-sheet",
    type: "workflowNode",
    position: { x: 320, y: 240 },
    data: {
      kind: "google_sheets_read",
      label: "Baca Baris",
      config: {
        spreadsheetId: "",
        sheetName: "Orders",
      },
      credentialId: "",
    },
  },
  {
    id: "node-condition",
    type: "workflowNode",
    position: { x: 600, y: 240 },
    data: {
      kind: "condition",
      label: "Status Belum Bayar?",
      config: {
        conditions: {
          match: "all",
          rules: [
            { field: "Status", operator: "equals", value: "Belum Bayar" },
          ],
        },
      },
    },
  },
  {
    id: "node-send-wa",
    type: "workflowNode",
    position: { x: 880, y: 240 },
    data: {
      kind: "whatsapp_send",
      label: "Kirim Reminder WA",
      config: {
        provider: "baileys",
        targetField: "Nomor",
        message:
          "Halo {{Nama}} 👋\n\nPembayaran Anda belum kami terima. Mohon segera melakukan pembayaran.\nBalas pesan ini setelah transfer ya. Terima kasih 🙏",
      },
      credentialId: "",
    },
  },
  {
    id: "node-wait-reply",
    type: "workflowNode",
    position: { x: 1160, y: 240 },
    data: {
      kind: "wait_reply",
      label: "Tunggu Balasan",
      config: {
        matchField: "Nomor",
      },
    },
  },
  {
    id: "node-update-sheet",
    type: "workflowNode",
    position: { x: 1440, y: 240 },
    data: {
      kind: "google_sheets_update",
      label: "Catat Respon",
      config: {
        spreadsheetId: "",
        sheetName: "Orders",
        matchColumn: "Nomor",
        matchValue: "{{sender}}",
        writeTargets: [
          {
            column: "Respon",
            value: "{{message}} ({{__replyAt}})",
            append: true,
          },
        ],
      },
      credentialId: "",
    },
  },
]);

const SCHEDULE_REMINDER_EDGES = JSON.stringify([
  {
    id: "e-trigger-read",
    source: "node-schedule-trigger",
    target: "node-read-sheet",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-read-condition",
    source: "node-read-sheet",
    target: "node-condition",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-condition-send",
    source: "node-condition",
    target: "node-send-wa",
    sourceHandle: "true",
    targetHandle: null,
    label: "true",
  },
  {
    id: "e-send-wait",
    source: "node-send-wa",
    target: "node-wait-reply",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-wait-update",
    source: "node-wait-reply",
    target: "node-update-sheet",
    sourceHandle: null,
    targetHandle: null,
  },
]);

const SPLIT_REPLY_WORKFLOW_NAME = "Reminder + Tangkap Balasan (Chain Terpisah)";

/**
 * Workflow dengan DUA chain terpisah dalam satu kanvas:
 *
 * Chain A (kirim): Jadwal -> Baca Sheet -> Kondisi (Belum Bayar) -> Kirim WA.
 * Chain B (tangkap): WhatsApp Reply -> Catat Respon ke sheet.
 *
 * Keduanya tidak terhubung edge. Berkat eksekusi ber-scope trigger, run
 * terjadwal hanya menjalankan Chain A, dan balasan masuk hanya menjalankan
 * Chain B (mencocokkan {{sender}} ke kolom Nomor lalu menulis kolom Respon).
 */
const SPLIT_REPLY_NODES = JSON.stringify([
  {
    id: "node-schedule-trigger",
    type: "workflowNode",
    position: { x: 40, y: 160 },
    data: {
      kind: "schedule_trigger",
      label: "Jadwal Reminder",
      config: {
        scheduleMode: "daily",
        dailyTime: "09:00",
        cron: "0 9 * * *",
      },
    },
  },
  {
    id: "node-read-sheet",
    type: "workflowNode",
    position: { x: 320, y: 160 },
    data: {
      kind: "google_sheets_read",
      label: "Baca Baris",
      config: {
        spreadsheetId: "",
        sheetName: "Orders",
      },
      credentialId: "",
    },
  },
  {
    id: "node-condition",
    type: "workflowNode",
    position: { x: 600, y: 160 },
    data: {
      kind: "condition",
      label: "Status Belum Bayar?",
      config: {
        conditions: {
          match: "all",
          rules: [
            { field: "Status", operator: "equals", value: "Belum Bayar" },
          ],
        },
      },
    },
  },
  {
    id: "node-send-wa",
    type: "workflowNode",
    position: { x: 880, y: 160 },
    data: {
      kind: "whatsapp_send",
      label: "Kirim Reminder WA",
      config: {
        provider: "baileys",
        targetField: "Nomor",
        message:
          "Halo {{Nama}} 👋\n\nPembayaran Anda belum kami terima. Mohon segera melakukan pembayaran.\nBalas pesan ini setelah transfer ya. Terima kasih 🙏",
      },
      credentialId: "",
    },
  },
  {
    id: "node-whatsapp-trigger",
    type: "workflowNode",
    position: { x: 320, y: 440 },
    data: {
      kind: "whatsapp_trigger",
      label: "Balasan WhatsApp Masuk",
      config: {},
    },
  },
  {
    id: "node-update-sheet",
    type: "workflowNode",
    position: { x: 640, y: 440 },
    data: {
      kind: "google_sheets_update",
      label: "Catat Respon",
      config: {
        spreadsheetId: "",
        sheetName: "Orders",
        matchColumn: "Nomor",
        matchValue: "{{sender}}",
        writeTargets: [
          {
            column: "Respon",
            value: "{{message}} ({{__replyAt}})",
            append: true,
          },
        ],
      },
      credentialId: "",
    },
  },
]);

const SPLIT_REPLY_EDGES = JSON.stringify([
  {
    id: "e-trigger-read",
    source: "node-schedule-trigger",
    target: "node-read-sheet",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-read-condition",
    source: "node-read-sheet",
    target: "node-condition",
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: "e-condition-send",
    source: "node-condition",
    target: "node-send-wa",
    sourceHandle: "true",
    targetHandle: null,
    label: "true",
  },
  {
    id: "e-reply-update",
    source: "node-whatsapp-trigger",
    target: "node-update-sheet",
    sourceHandle: null,
    targetHandle: null,
  },
]);

async function main() {
  console.log("🌱  Starting seed…");

  const existingAdmin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });

  let adminUser;

  if (existingAdmin) {
    console.log(`   ↳ Admin user already exists (${ADMIN_EMAIL}), skipping.`);
    adminUser = existingAdmin;
  } else {
    adminUser = await prisma.user.create({
      data: {
        name: "Admin Fluxera",
        email: ADMIN_EMAIL,
        role: "admin",
        isActive: true,
        onboardingCompleted: true,
      },
    });

    console.log(
      `   ↳ Admin user created: ${adminUser.name} <${adminUser.email}>`,
    );
  }

  const existingReminder = await prisma.workflow.findFirst({
    where: { name: REMINDER_WORKFLOW_NAME, ownerId: adminUser.id },
  });

  if (existingReminder) {
    console.log("   ↳ Reminder workflow already exists, skipping.");
  } else {
    const reminderWorkflow = await prisma.workflow.create({
      data: {
        name: REMINDER_WORKFLOW_NAME,
        ownerId: adminUser.id,
        nodes: REMINDER_NODES,
        edges: REMINDER_EDGES,
        version: 1,
        isPublished: false,
      },
    });

    console.log(
      `   ↳ Reminder workflow created: "${reminderWorkflow.name}" (${reminderWorkflow.id})`,
    );
  }

  const existingScheduleReminder = await prisma.workflow.findFirst({
    where: { name: SCHEDULE_REMINDER_WORKFLOW_NAME, ownerId: adminUser.id },
  });

  if (existingScheduleReminder) {
    console.log("   ↳ Schedule reminder workflow already exists, skipping.");
  } else {
    const fw = await prisma.workflow.create({
      data: {
        name: SCHEDULE_REMINDER_WORKFLOW_NAME,
        ownerId: adminUser.id,
        nodes: SCHEDULE_REMINDER_NODES,
        edges: SCHEDULE_REMINDER_EDGES,
        version: 1,
        isPublished: false,
      },
    });

    console.log(
      `   ↳ Schedule reminder workflow created: "${fw.name}" (${fw.id})`,
    );
  }

  const existingSplitReply = await prisma.workflow.findFirst({
    where: { name: SPLIT_REPLY_WORKFLOW_NAME, ownerId: adminUser.id },
  });

  if (existingSplitReply) {
    console.log("   ↳ Split reply workflow already exists, skipping.");
  } else {
    const splitReplyWorkflow = await prisma.workflow.create({
      data: {
        name: SPLIT_REPLY_WORKFLOW_NAME,
        ownerId: adminUser.id,
        nodes: SPLIT_REPLY_NODES,
        edges: SPLIT_REPLY_EDGES,
        version: 1,
        isPublished: true,
      },
    });

    console.log(
      `   ↳ Split reply workflow created: "${splitReplyWorkflow.name}" (${splitReplyWorkflow.id})`,
    );
  }

  console.log("✅  Seed complete.");
}

main()
  .catch((error) => {
    console.error("❌  Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
