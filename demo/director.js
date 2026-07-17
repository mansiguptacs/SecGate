#!/usr/bin/env node
/**
 * SecGate demo-director — keypress / numbered CLI fires demo scenes.
 *
 * Usage:
 *   npm run demo              # interactive (0-4 / n / q)
 *   npm run demo -- --dry-run # print scene plan, no HTTP
 *   npm run demo -- 0         # run scene 0 then exit
 *   npm run demo -- --all     # run scenes 0→4 sequentially
 */
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MCP = process.env.SECGATE_MCP_URL || "http://127.0.0.1:3100";
const GATEWAY =
  process.env.SECGATE_GATEWAY_URL || "http://127.0.0.1:3200";
const GUARDIAN_TOKEN =
  process.env.SECGATE_GUARDIAN_TOKEN || "guardian-agent-token-PHASE2";
const DRIVER = path.join(ROOT, "agents", "ticket-driver.js");

const SCENES = [
  {
    id: 0,
    title: "Cold open — disaster",
    narration:
      "SecGate OFF. Poisoned ticket deploys 8×A100. Spend spins to ~$12.4k red.",
    voiceover:
      "This happened with one hidden line in a ticket. Agents have your cloud credentials. Who's watching them?",
  },
  {
    id: 1,
    title: "Gate on — happy path",
    narration:
      "SecGate ON. Clean ticket → approve → deploy with lease URL (~$3/mo).",
    voiceover: "SecGate doesn't slow normal work down.",
  },
  {
    id: 2,
    title: "Attack replay",
    narration:
      "Poisoned ticket → reject → direct apply 403×3 → quarantine + PPL panel.",
    voiceover: "Enforced by identity policy, not app code. No human touched anything.",
  },
  {
    id: 3,
    title: "Orphan sweep",
    narration:
      "Pre-seed idle untagged deployment → guardian destroys → spend drops.",
    voiceover: "Self-correction: the guardian cleans up what agents leave behind.",
  },
  {
    id: 4,
    title: "Close — architecture",
    narration:
      "Pause for sponsor callouts: Pomerium · Akash · Zero.xyz · Nexla.",
    voiceover: 'Agents propose. SecGate disposes.',
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mcp(method, route, body) {
  const res = await fetch(`${MCP}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

async function clearQuarantine() {
  try {
    await fetch(`${GATEWAY}/admin/clear-quarantine`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${GUARDIAN_TOKEN}`,
        "x-secgate-actor": "guardian",
      },
      body: "{}",
    });
  } catch {
    /* gateway may be down in dry paths */
  }
}

function runDriver(ticket, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [DRIVER, ticket, ...extraArgs],
      {
        cwd: ROOT,
        env: { ...process.env, SECGATE_GATEWAY_URL: GATEWAY, SECGATE_MCP_URL: MCP },
        stdio: "inherit",
      }
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ticket-driver exited ${code}`));
    });
  });
}

async function scene0(dry) {
  banner(0);
  if (dry) {
    console.log("  [dry-run] POST /admin/reset → /admin/demo/disaster (gate OFF, $12.4k)");
    return { ok: true, dry: true };
  }
  await mcp("POST", "/admin/reset");
  await clearQuarantine();
  await mcp("POST", "/events/audit", {
    kind: "timeline",
    actor: "secgate",
    message: "Scene 0 — SecGate OFF cold open",
    sponsor: "guardian",
    title: "SCENE 0 · Disaster",
    severity: "warn",
    detail: { scene: 0, blurb: "Gate off — nobody watching" },
  });
  const r = await mcp("POST", "/admin/demo/disaster");
  console.log(
    `  → gate=${r.json.gate} spend=$${r.json.committedSpendUsd?.toLocaleString?.() ?? r.json.committedSpendUsd}/mo`
  );
  return r;
}

async function scene1(dry) {
  banner(1);
  if (dry) {
    console.log("  [dry-run] reset → gate ON → agents clean ticket");
    return { ok: true, dry: true };
  }
  await mcp("POST", "/admin/reset");
  await clearQuarantine();
  await mcp("POST", "/admin/gate", { mode: "on" });
  await mcp("POST", "/events/audit", {
    kind: "timeline",
    actor: "secgate",
    message: "Scene 1 — clean ticket happy path",
    sponsor: "guardian",
    title: "SCENE 1 · Happy path",
    severity: "info",
    detail: { scene: 1, blurb: "plan → budget → price → approve → deploy" },
  });
  await runDriver("clean", ["--wait-ms", "3000"]);
  const state = await mcp("GET", "/state");
  const deps = (state.json.deployments || []).filter((d) => d.status === "running");
  console.log(
    `  → running=${deps.length} spend=$${state.json.committedSpendUsd} url=${deps[0]?.liveUrl || "(pending)"}`
  );
  return { ok: true, deps };
}

async function scene2(dry) {
  banner(2);
  if (dry) {
    console.log("  [dry-run] poisoned → reject → 3× apply 403 → quarantine");
    return { ok: true, dry: true };
  }
  // Keep any happy-path deploy; just ensure gate on + identity not quarantined yet
  await mcp("POST", "/admin/gate", { mode: "on" });
  await clearQuarantine();
  await mcp("POST", "/events/audit", {
    kind: "timeline",
    actor: "secgate",
    message: "Scene 2 — poisoned ticket attack replay",
    sponsor: "guardian",
    title: "SCENE 2 · Attack",
    severity: "warn",
    detail: { scene: 2, blurb: "reject → 403×3 → quarantine" },
  });
  try {
    await runDriver("poisoned", ["--direct-applies", "3", "--wait-ms", "2800"]);
  } catch (err) {
    // Driver may exit 1 if plan 403 after quarantine mid-run — still OK for demo
    console.log("  (driver finished with", err.message, ")");
  }
  await sleep(2000); // let abuse tracker quarantine
  const policy = await fetch(`${GATEWAY}/policy`).then((r) => r.json()).catch(() => null);
  const q = policy?.policy?.quarantine?.identities ?? [];
  console.log(`  → quarantine identities: ${q.map((i) => i.email || i.id).join(", ") || "(none yet — wait ~2s)"}`);
  return { ok: true, quarantine: q };
}

async function scene3(dry) {
  banner(3);
  if (dry) {
    console.log("  [dry-run] POST /admin/demo/orphan → wait guardian sweep");
    return { ok: true, dry: true };
  }
  const before = await mcp("GET", "/state");
  const spendBefore = before.json.committedSpendUsd ?? 0;
  await mcp("POST", "/events/audit", {
    kind: "timeline",
    actor: "secgate",
    message: "Scene 3 — orphan sweep",
    sponsor: "guardian",
    title: "SCENE 3 · Orphan sweep",
    severity: "info",
    detail: { scene: 3, blurb: "seed idle lease → guardian destroy" },
  });
  const seeded = await mcp("POST", "/admin/demo/orphan", {
    idleMinutes: 20,
    usdPerMonth: 48,
  });
  console.log(
    `  → orphan seeded $${seeded.json.deployment?.usdPerMonth}/mo; spend was $${spendBefore} now $${seeded.json.committedSpendUsd}`
  );
  console.log("  → waiting for guardian orphan sweep…");
  let dropped = false;
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const state = await mcp("GET", "/state");
    const orphanGone = !(state.json.deployments || []).some(
      (d) => d.id === "dep-orphan" && d.status === "running"
    );
    if (orphanGone) {
      console.log(
        `  → orphan destroyed; spend now $${state.json.committedSpendUsd} (was $${seeded.json.committedSpendUsd})`
      );
      dropped = true;
      break;
    }
  }
  if (!dropped) {
    console.log("  ⚠ orphan still present — check guardian SECGATE_ORPHAN_SWEEP / idle min");
  }
  return { ok: dropped };
}

async function scene4(dry) {
  banner(4);
  console.log(`
  ┌─────────────────────────────────────────────────────────┐
  │  Pomerium  — identity + per-tool policy + audit         │
  │  Akash     — governed infra (leases / live URL)         │
  │  Zero.xyz  — runtime pricing discovery                  │
  │  Nexla     — budget / spend / inventory context         │
  │                                                         │
  │  Tagline: Agents propose. SecGate disposes.             │
  └─────────────────────────────────────────────────────────┘
`);
  if (dry) return { ok: true, dry: true };
  // Dense sponsor callouts on the Control Tower timeline
  const beats = [
    {
      sponsor: "pomerium",
      title: "Enforcement layer",
      detail: "Identity + per-tool PPL + audit stream",
      severity: "info",
    },
    {
      sponsor: "akash",
      title: "Governed infra",
      detail: "Leases / live URL under guardian apply",
      severity: "info",
    },
    {
      sponsor: "zero",
      title: "Runtime pricing",
      detail: "Zero.xyz discovery for cost projection",
      severity: "info",
    },
    {
      sponsor: "nexla",
      title: "Budget context",
      detail: "Team budget / spend / inventory",
      severity: "info",
    },
    {
      sponsor: "guardian",
      title: "Agents propose. SecGate disposes.",
      detail: "Close — guardian loop owns mutate + quarantine",
      severity: "allow",
    },
  ];
  for (const beat of beats) {
    await mcp("POST", "/events/audit", {
      kind: "timeline",
      actor: "secgate",
      message: beat.detail,
      sponsor: beat.sponsor,
      title: beat.title,
      severity: beat.severity,
      detail: { scene: 4, blurb: beat.detail },
    });
    await sleep(350);
  }
  console.log("  → timeline sponsor beats emitted");
  console.log("  (paused — press next when narration done)");
  return { ok: true };
}

function banner(id) {
  const s = SCENES[id];
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  SCENE ${s.id}: ${s.title}`);
  console.log(`  ${s.narration}`);
  console.log(`  VO: "${s.voiceover}"`);
  console.log("══════════════════════════════════════════════════");
}

async function runScene(id, dry) {
  switch (id) {
    case 0:
      return scene0(dry);
    case 1:
      return scene1(dry);
    case 2:
      return scene2(dry);
    case 3:
      return scene3(dry);
    case 4:
      return scene4(dry);
    default:
      throw new Error(`Unknown scene ${id}`);
  }
}

function printHelp() {
  console.log(`SecGate demo-director

Scenes:
${SCENES.map((s) => `  ${s.id}  ${s.title}`).join("\n")}

Keys (interactive):  0-4  run scene · n/Enter next · r list · q quit
Flags:  --dry-run   print plan only
        --all       run 0→4 then exit
        <N>         run scene N then exit
`);
}

async function interactive(dry) {
  printHelp();
  let next = 0;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    process.stdout.write(`\n[demo] scene ${next} ready — key (0-4/n/q): `);
  };

  prompt();
  rl.on("line", async (line) => {
    const t = line.trim().toLowerCase();
    if (t === "q" || t === "quit") {
      rl.close();
      process.exit(0);
    }
    if (t === "r" || t === "help" || t === "?") {
      printHelp();
      prompt();
      return;
    }
    let id = next;
    if (t === "" || t === "n" || t === "next") {
      id = next;
    } else if (/^[0-4]$/.test(t)) {
      id = Number(t);
    } else {
      console.log("  unknown key");
      prompt();
      return;
    }
    try {
      await runScene(id, dry);
      next = Math.min(4, id + 1);
    } catch (err) {
      console.error("  scene error:", err.message);
    }
    prompt();
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  const all = argv.includes("--all");
  const help = argv.includes("--help") || argv.includes("-h");
  const num = argv.find((a) => /^[0-4]$/.test(a));

  console.log(`SecGate demo-director  mcp=${MCP} gateway=${GATEWAY}${dry ? "  DRY-RUN" : ""}`);

  if (help) {
    printHelp();
    process.exit(0);
  }

  if (dry && !all && !num) {
    // Dry-run default: print all scene preconditions
    for (const s of SCENES) {
      await runScene(s.id, true);
    }
    console.log("\n[demo] dry-run complete — stack not required.");
    process.exit(0);
  }

  if (all) {
    for (let i = 0; i <= 4; i++) {
      await runScene(i, dry);
      if (!dry && i < 4) await sleep(800);
    }
    process.exit(0);
  }

  if (num !== undefined) {
    await runScene(Number(num), dry);
    process.exit(0);
  }

  await interactive(dry);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
