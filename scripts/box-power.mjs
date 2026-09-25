/**
 * Move a box safely: the procedure that was missing on 25 September 2026.
 *
 *   node scripts/box-power.mjs <box-num> status
 *   node scripts/box-power.mjs <box-num> shutdown [--yes] [--wait-minutes N]
 *
 * VMOS restarts, at boot, every container that was running when the power
 * went — box-1 came back with 8 containers booting at once (a 32 GB host at
 * load 192, zram at 100 %). So a box is stopped in this order:
 *
 *   1. pause its maintenance — `boxes.maintenance_until` when the column
 *      exists (Phase 3), the global `maintenance.global_enabled` switch
 *      otherwise (restored at the end);
 *   2. wait for the running maintenance tasks of the box to finish;
 *   3. `POST /container_api/v1/stop` one container at a time (the endpoint
 *      refuses a batch with any non-running instance) until `list_names`
 *      reports 0 running / starting;
 *   4. `GET /v1/shutdown`.
 *
 * Reachability is LAN first (MAC + device_id from manifest.tsv), tunnel
 * otherwise. Nothing is destroyed; the data stays on the SSD. On the next
 * power-up DHCP + the tunnel are enough — the reconcile worker finds the box.
 */

import { planBox, boxPost, requireEnv, supabaseGet, supabaseRequest } from "../infra/boxes/scripts/lib/env.mjs";

requireEnv(["CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const [, , boxArg, verb = "status", ...rest] = process.argv;
const YES = rest.includes("--yes");
const waitIdx = rest.indexOf("--wait-minutes");
const WAIT_MINUTES = waitIdx >= 0 ? Number(rest[waitIdx + 1]) : 15;

if (!boxArg || !["status", "shutdown"].includes(verb)) {
  console.error("usage: node scripts/box-power.mjs <box-num> status|shutdown [--yes] [--wait-minutes N]");
  process.exit(2);
}
const num = Number(String(boxArg).replace(/^box-?/, ""));
const host = `box-${num}.attila.army`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function occupancy(plan) {
  const names = await plan.get("/container_api/v1/list_names");
  const list = names?.data?.list ?? null;
  if (!list) return null;
  return {
    total: list.length,
    running: list.filter((c) => c.state === "running").map((c) => c.db_id),
    starting: list.filter((c) => c.state === "starting").map((c) => c.db_id),
    other: list.filter((c) => !["running", "starting", "stopped"].includes(c.state)).map((c) => `${c.db_id}:${c.state}`),
  };
}

async function boxRow() {
  const rows = await supabaseGet(`boxes?select=id,tunnel_hostname,status,maintenance_until&tunnel_hostname=eq.${host}`).catch(async (err) => {
    // Before Phase 3 the column does not exist: retry without it.
    if (!/maintenance_until/.test(err.message)) throw err;
    return supabaseGet(`boxes?select=id,tunnel_hostname,status&tunnel_hostname=eq.${host}`);
  });
  return rows?.[0] ?? null;
}

async function runningTasks(boxId) {
  const rows = await supabaseGet(
    `maintenance_tasks?select=id,kind,device_id,devices!inner(db_id,box_id)&status=eq.running&devices.box_id=eq.${boxId}`,
  );
  return rows ?? [];
}

async function status(plan, box) {
  const [hw, heartbeat, occ] = await Promise.all([plan.get("/v1/get_hardware_cfg"), plan.get("/v1/heartbeat"), occupancy(plan)]);
  console.log(`${host}  transport ${plan.lanIp ? `lan ${plan.lanIp}` : "tunnel"}  db ${box?.status ?? "?"}`);
  console.log(`  hardware   ${hw?.data ? `${hw.data.model} · cbs ${hw.data.version} · kernel ${hw.data.kernel_version} · device_id ${hw.data.device_id}` : "(no answer)"}`);
  console.log(`  heartbeat  ${heartbeat?.data ? JSON.stringify(heartbeat.data) : "(no answer)"}`);
  console.log(`  containers ${occ ? `${occ.total} total · running ${occ.running.length} · starting ${occ.starting.length}${occ.other.length ? ` · other ${occ.other.join(",")}` : ""}` : "(no answer)"}`);
  if (occ?.running.length) console.log(`             running: ${occ.running.join(", ")}`);
  if (box) {
    const tasks = await runningTasks(box.id);
    console.log(`  maintenance running tasks ${tasks.length}${box.maintenance_until ? ` · paused until ${box.maintenance_until}` : ""}`);
  }
  return occ;
}

/** Pause maintenance for this box; returns a function that undoes it. */
async function pauseMaintenance(box) {
  if (box && "maintenance_until" in box) {
    const until = new Date(Date.now() + 6 * 3600_000).toISOString();
    await supabaseRequest("PATCH", `boxes?id=eq.${box.id}`, { maintenance_until: until });
    console.log(`  maintenance paused for ${host} until ${until} (boxes.maintenance_until)`);
    return async () => {}; // the box is off; the window expires on its own, or an operator lifts it
  }
  const [row] = await supabaseGet("runtime_settings?select=key,value&key=eq.maintenance.global_enabled");
  const previous = row?.value;
  if (previous === true) {
    await supabaseRequest("PATCH", "runtime_settings?key=eq.maintenance.global_enabled", { value: false });
    console.log("  maintenance paused GLOBALLY (no per-box switch yet — restored at the end)");
  }
  return async () => {
    if (previous === true) {
      await supabaseRequest("PATCH", "runtime_settings?key=eq.maintenance.global_enabled", { value: true });
      console.log("  maintenance.global_enabled restored to true");
    }
  };
}

async function stopAll(plan) {
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  for (;;) {
    const occ = await occupancy(plan);
    if (!occ) throw new Error("list_names unavailable");
    if (occ.running.length === 0 && occ.starting.length === 0) return occ;
    for (const id of occ.running) {
      const res = await boxPost(plan, "/container_api/v1/stop", { db_ids: [id] });
      console.log(`  stop ${id} → ${res?.code === 200 ? "stopping" : res?.msg ?? "no answer"}`);
      await sleep(1500);
    }
    if (occ.starting.length) console.log(`  ${occ.starting.length} container(s) still starting — stop refuses them until they reach running, waiting…`);
    if (Date.now() > deadline) throw new Error(`containers still up after ${WAIT_MINUTES} min: running ${occ.running.length}, starting ${occ.starting.length}`);
    await sleep(6000);
  }
}

async function main() {
  const box = await boxRow();
  const plan = await planBox(num, host);
  const occ = await status(plan, box);
  if (verb === "status") return;

  if (!occ) throw new Error(`${host} does not answer list_names — nothing to shut down safely`);
  if (!YES) {
    console.log(`\nDry run. This would: pause maintenance, wait for ${box ? (await runningTasks(box.id)).length : "?"} running task(s), stop ${occ.running.length + occ.starting.length} container(s) one by one, then GET /v1/shutdown.`);
    console.log("Re-run with --yes to execute.");
    return;
  }

  const restore = await pauseMaintenance(box);
  try {
    if (box) {
      const deadline = Date.now() + WAIT_MINUTES * 60_000;
      for (;;) {
        const tasks = await runningTasks(box.id);
        if (tasks.length === 0) break;
        console.log(`  waiting for ${tasks.length} running maintenance task(s): ${tasks.map((t) => `${t.kind}@${t.devices?.db_id}`).join(", ")}`);
        if (Date.now() > deadline) {
          console.log("  wait budget exhausted — proceeding; the tasks will fail with box_unreachable and be retried");
          break;
        }
        await sleep(20_000);
      }
    }
    const finalOcc = await stopAll(plan);
    console.log(`  0 running / 0 starting (${finalOcc.total} containers stopped)`);
    const off = await plan.get("/v1/shutdown");
    console.log(`  GET /v1/shutdown → ${off ? `${off.code} ${off.msg}` : "no answer (already going down?)"}`);
    console.log(`\n${host} is shutting down. Unplug when the LEDs are off; on the next power-up DHCP + the tunnel suffice.`);
  } finally {
    await restore();
  }
}

main().catch((e) => {
  console.error(`FATAL ${e.message}`);
  process.exit(1);
});
