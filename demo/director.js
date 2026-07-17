#!/usr/bin/env node
/**
 * AgentFence demo-director — keypress / numbered CLI fires demo scenes.
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

/** Demo-facing console URLs (override via env). */
const LINKS = {
  akash: process.env.AKASH_CONSOLE_URL || "https://console.akash.network",
  nexla:
    process.env.NEXLA_CONSOLE_URL ||
    (process.env.NEXLA_MCP_URL && process.env.NEXLA_MCP_URL.includes("nexla")
      ? "https://dataops.nexla.io"
      : "https://dataops.nexla.io"),
  zero: process.env.ZERO_CONSOLE_URL || "https://www.zero.xyz",
  policy: process.env.SECGATE_POLICY_VIEW_URL || `${MCP}/admin/policy`,
  tower: `${MCP}/`,
};

function sponsorLinks(...sponsors) {
  const out = [];
  const seen = new Set();
  for (const s of sponsors) {
    let label;
    let url;
    if (s === "akash") {
      label = "Akash console";
      url = LINKS.akash;
    } else if (s === "nexla") {
      label = "Nexla budget tool";
      url = LINKS.nexla;
    } else if (s === "zero") {
      label = "Zero.xyz";
      url = LINKS.zero;
    } else if (s === "pomerium") {
      label = "View policy";
      url = LINKS.policy;
    } else if (s === "guardian") {
      label = "Control Tower";
      url = LINKS.tower;
    } else continue;
    const key = `${label}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, url });
  }
  return out;
}

async function audit(payload) {
  return mcp("POST", "/events/audit", payload);
}

const SCENES = [
  {
    id: 0,
    title: "Cold open — disaster",
    narration:
      "AgentFence OFF. Poisoned ticket deploys 8×A100. Spend spins to ~$12.4k red.",
    voiceover:
      "This happened with one hidden line in a ticket. Agents have your cloud credentials. Who's watching them?",
  },
  {
    id: 1,
    title: "Gate on — happy path",
    narration:
      "AgentFence ON. Clean ticket → approve → deploy with lease URL (~$3/mo).",
    voiceover: "AgentFence doesn't slow normal work down.",
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
    voiceover: 'Agents propose. AgentFence disposes.',
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

/** Table price for 8×A100 (shared/GPU_PRICING) — never render $undefined. */
const DISASTER_SPEND_USD = 12398;

function formatUsdMo(n, fallback) {
  const num = Number(n);
  if (Number.isFinite(num)) {
    return `$${num.toLocaleString("en-US")}/mo`;
  }
  if (fallback != null && Number.isFinite(Number(fallback))) {
    return `$${Number(fallback).toLocaleString("en-US")}/mo`;
  }
  return "$—/mo";
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
  await audit({
    kind: "timeline",
    actor: "system",
    message: "Scene 0 — AgentFence OFF cold open",
    sponsor: "guardian",
    title: "SCENE 0 · Disaster",
    severity: "warn",
    action: "scene start",
    resource: "gate=off",
    result: "WARN",
    sponsors: ["guardian", "akash"],
    links: sponsorLinks("guardian", "akash"),
    detail: { scene: 0, blurb: "Gate off — nobody watching" },
  });
  const r = await mcp("POST", "/admin/demo/disaster");
  const spend =
    r.json.committedSpendUsd ??
    r.json.deployment?.usdPerMonth ??
    DISASTER_SPEND_USD;
  const spendLabel = formatUsdMo(spend, DISASTER_SPEND_USD);
  if (!r.ok) {
    console.error(`  ✗ disaster seed failed: ${r.json.error || r.status}`);
  }
  await audit({
    kind: "timeline",
    actor: "dev-agent",
    message: "Disaster apply complete — 8×A100 committed",
    sponsor: "akash",
    title: "Spend spike",
    severity: "block",
    action: "apply ALLOW (gate off)",
    resource: r.json.deployment?.name || "load-test-warm-pool",
    result: "WARN",
    sponsors: ["akash"],
    links: [
      ...sponsorLinks("akash"),
      ...(r.json.deployment?.liveUrl
        ? [{ label: "Live deployment", url: r.json.deployment.liveUrl }]
        : []),
    ],
    detail: {
      scene: 0,
      blurb: `Committed ${spendLabel}`,
      deployment: r.json.deployment,
      liveUrl: r.json.deployment?.liveUrl,
      committedSpendUsd: Number.isFinite(Number(spend))
        ? Number(spend)
        : DISASTER_SPEND_USD,
    },
  });
  console.log(`  → gate=${r.json.gate ?? "off"} spend=${spendLabel}`);
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
  await audit({
    kind: "timeline",
    actor: "system",
    message: "Scene 1 — clean ticket happy path",
    sponsor: "guardian",
    title: "SCENE 1 · Happy path",
    severity: "info",
    action: "scene start",
    resource: "tickets/clean.md",
    result: "OK",
    sponsors: ["guardian", "pomerium", "nexla", "zero", "akash"],
    links: sponsorLinks("pomerium", "nexla", "zero", "akash", "guardian"),
    detail: { scene: 1, blurb: "plan → budget → price → approve → deploy" },
  });
  await runDriver("clean", ["--wait-ms", "3000"]);
  const state = await mcp("GET", "/state");
  const deps = (state.json.deployments || []).filter((d) => d.status === "running");
  if (deps[0]) {
    await audit({
      kind: "timeline",
      actor: "guardian",
      message: `Happy-path deploy live: ${deps[0].liveUrl}`,
      sponsor: "akash",
      title: "Deployed",
      severity: "allow",
      action: "apply ALLOW",
      resource: `${deps[0].name} (${deps[0].id})`,
      result: "ALLOW",
      sponsors: ["akash", "guardian"],
      links: [
        { label: "Live deployment", url: deps[0].liveUrl },
        ...sponsorLinks("akash", "nexla", "zero", "pomerium"),
      ],
      detail: {
        scene: 1,
        blurb: `$${deps[0].usdPerMonth}/mo · click Live deployment`,
        deployment: deps[0],
        liveUrl: deps[0].liveUrl,
        akashLeaseId: deps[0].akashLeaseId,
      },
    });
  }
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
  await audit({
    kind: "timeline",
    actor: "system",
    message: "Scene 2 — poisoned ticket attack replay",
    sponsor: "guardian",
    title: "SCENE 2 · Attack",
    severity: "warn",
    action: "scene start",
    resource: "tickets/poisoned.md",
    result: "WARN",
    sponsors: ["guardian", "pomerium", "nexla", "zero"],
    links: sponsorLinks("pomerium", "nexla", "zero", "guardian"),
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
  await audit({
    kind: "timeline",
    actor: "guardian",
    message: q.length
      ? `Quarantine active: ${q.map((i) => i.email || i.id).join(", ")}`
      : "Attack trail complete — check Audit Log for REJECT / BLOCKED",
    sponsor: "pomerium",
    title: "Attack trail",
    severity: "block",
    action: "quarantine",
    resource: q[0]?.email || "dev-agent",
    result: "BLOCKED",
    sponsors: ["pomerium", "guardian"],
    links: sponsorLinks("pomerium", "guardian"),
    detail: { scene: 2, blurb: "View policy → quarantine deny rules", quarantine: q },
  });
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
  await audit({
    kind: "timeline",
    actor: "system",
    message: "Scene 3 — orphan sweep",
    sponsor: "guardian",
    title: "SCENE 3 · Orphan sweep",
    severity: "info",
    action: "scene start",
    resource: "dep-orphan",
    result: "OK",
    sponsors: ["guardian", "akash"],
    links: sponsorLinks("akash", "guardian"),
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
      await audit({
        kind: "timeline",
        actor: "guardian",
        message: "Orphan destroyed — spend dropped",
        sponsor: "akash",
        title: "Orphan cleanup",
        severity: "allow",
        action: "destroy",
        resource: "dep-orphan",
        result: "DESTROYED",
        sponsors: ["akash", "guardian"],
        links: sponsorLinks("akash", "guardian"),
        detail: {
          scene: 3,
          blurb: `Spend now $${state.json.committedSpendUsd}`,
        },
      });
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
  │  Tagline: Agents propose. AgentFence disposes.             │
  └─────────────────────────────────────────────────────────┘
`);
  if (dry) return { ok: true, dry: true };
  // Dense sponsor callouts on the Control Tower timeline + audit log
  const beats = [
    {
      sponsor: "pomerium",
      title: "Enforcement layer",
      detail: "Identity + per-tool PPL + audit stream",
      severity: "info",
      action: "policy",
      links: sponsorLinks("pomerium"),
    },
    {
      sponsor: "akash",
      title: "Governed infra",
      detail: "Leases / live URL under guardian apply",
      severity: "info",
      action: "apply ALLOW",
      links: sponsorLinks("akash"),
    },
    {
      sponsor: "zero",
      title: "Runtime pricing",
      detail: "Zero.xyz discovery for cost projection",
      severity: "info",
      action: "pricing",
      links: sponsorLinks("zero"),
    },
    {
      sponsor: "nexla",
      title: "Budget context",
      detail: "Team budget / spend / inventory",
      severity: "info",
      action: "budget fetch",
      links: sponsorLinks("nexla"),
    },
    {
      sponsor: "guardian",
      title: "Agents propose. AgentFence disposes.",
      detail: "Close — guardian loop owns mutate + quarantine",
      severity: "allow",
      action: "approve",
      links: sponsorLinks("guardian", "pomerium", "akash", "zero", "nexla"),
    },
  ];
  for (const beat of beats) {
    await audit({
      kind: "timeline",
      actor: "system",
      message: beat.detail,
      sponsor: beat.sponsor,
      title: beat.title,
      severity: beat.severity,
      action: beat.action,
      resource: beat.sponsor,
      result: "OK",
      sponsors: [beat.sponsor],
      links: beat.links,
      detail: { scene: 4, blurb: beat.detail },
    });
    await sleep(350);
  }
  console.log("  → timeline + audit sponsor beats emitted");
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
  console.log(`AgentFence demo-director

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

  console.log(`AgentFence demo-director  mcp=${MCP} gateway=${GATEWAY}${dry ? "  DRY-RUN" : ""}`);

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
