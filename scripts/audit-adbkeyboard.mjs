/**
 * READ-ONLY audit of ADBKeyboard state on every device.
 *
 * Does NOT start any container, NOT install anything, NOT change any IME.
 * For each device that is currently `running`, it checks:
 *   - is the package installed?
 *   - is the IME service registered (`ime list -a`)?
 *   - is the IME enabled (`ime list -s`)?
 *
 * For stopped devices, it just reports `stopped` so we know they need a
 * boot+install pass.
 *
 * Usage:
 *   node scripts/audit-adbkeyboard.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs
  .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

const cf = {
  "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabase(p) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  return r.json();
}

async function shell(boxHost, dbId, cmd) {
  const r = await fetch(`https://${boxHost}/android_api/v1/shell/${dbId}`, {
    method: "POST",
    headers: { ...cf, "Content-Type": "application/json" },
    body: JSON.stringify({ id: dbId, cmd }),
  });
  const j = await r.json();
  return { code: j?.code ?? -1, message: j?.data?.message ?? "" };
}

async function listContainers(boxHost) {
  const r = await fetch(`https://${boxHost}/container_api/v1/list_names`, {
    headers: cf,
  });
  const j = await r.json();
  return j?.data?.list ?? [];
}

async function main() {
  const devices = await supabase(
    "devices?select=id,db_id,user_name,box_id,boxes(tunnel_hostname)&order=user_name.asc",
  );
  const boxHost = devices[0].boxes.tunnel_hostname;

  const live = await listContainers(boxHost);
  const liveByDb = new Map(live.map((c) => [c.db_id, c]));

  const rows = [];
  for (const d of devices) {
    const c = liveByDb.get(d.db_id);
    const state = c?.state ?? "unknown";
    const row = {
      user_name: d.user_name,
      db_id: d.db_id,
      state,
      pkgInstalled: null,
      imeRegistered: null,
      imeEnabled: null,
    };
    if (state === "running") {
      const pkg = await shell(
        boxHost,
        d.db_id,
        "pm list packages com.android.adbkeyboard",
      );
      row.pkgInstalled = pkg.message.includes("com.android.adbkeyboard");
      const reg = await shell(
        boxHost,
        d.db_id,
        "ime list -a | grep -i adbkeyboard",
      );
      row.imeRegistered = reg.message.toLowerCase().includes("adbkeyboard");
      const en = await shell(
        boxHost,
        d.db_id,
        "ime list -s | grep -i adbkeyboard",
      );
      row.imeEnabled = en.message.toLowerCase().includes("adbkeyboard");
    }
    rows.push(row);
    const flag = (b) => (b === null ? "-" : b ? "OK" : "NO");
    console.log(
      `${row.user_name.padEnd(14)} ${row.db_id.padEnd(18)} ${state.padEnd(10)}  pkg=${flag(row.pkgInstalled)}  reg=${flag(row.imeRegistered)}  en=${flag(row.imeEnabled)}`,
    );
  }

  const running = rows.filter((r) => r.state === "running");
  const stopped = rows.filter((r) => r.state !== "running");
  const fullyDone = running.filter(
    (r) => r.pkgInstalled && r.imeRegistered && r.imeEnabled,
  );
  const installedNotEnabled = running.filter(
    (r) => r.pkgInstalled && !r.imeEnabled,
  );
  const notInstalled = running.filter((r) => !r.pkgInstalled);

  console.log("\n=== summary ===");
  console.log(`total devices: ${rows.length}`);
  console.log(`  running    : ${running.length}`);
  console.log(`  stopped    : ${stopped.length}`);
  console.log(`among running:`);
  console.log(`  fully done             : ${fullyDone.length}`);
  console.log(`  installed, not enabled : ${installedNotEnabled.length}`);
  console.log(`  not installed          : ${notInstalled.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
