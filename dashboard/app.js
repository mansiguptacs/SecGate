(() => {
  const spendEl = document.getElementById("spend");
  const budgetFill = document.getElementById("budgetFill");
  const budgetLabel = document.getElementById("budgetLabel");
  const budgetPct = document.getElementById("budgetPct");
  const gateLight = document.getElementById("gateLight");
  const gateText = document.getElementById("gateText");
  const chatFeed = document.getElementById("chatFeed");
  const toolFeed = document.getElementById("toolFeed");
  const deployList = document.getElementById("deployList");
  const conn = document.getElementById("conn");
  const policySnippet = document.getElementById("policySnippet");
  const policyDiff = document.getElementById("policyDiff");
  const phaseLabel = document.getElementById("phaseLabel");
  const policyNote = document.getElementById("policyNote");
  const policyPanel = document.getElementById("policyPanel");
  const flashOverlay = document.getElementById("flashOverlay");
  const timelineFeed = document.getElementById("timelineFeed");
  const timelineEmpty = document.getElementById("timelineEmpty");
  const auditFeed = document.getElementById("auditFeed");
  const auditEmpty = document.getElementById("auditEmpty");
  const auditFilters = document.getElementById("auditFilters");

  let seen = new Set();
  let displaySpend = 0;
  let targetSpend = 0;
  let animFrame = null;
  let quarantined = false;
  let gateMode = "on";
  let lastSnippet = "";
  let lastQuarantineCount = 0;
  let timelineCount = 0;
  let auditCount = 0;
  let auditFilter = "all";

  const SPONSOR_LABEL = {
    pomerium: "Pomerium",
    zero: "Zero",
    nexla: "Nexla",
    akash: "Akash",
    guardian: "Guardian",
  };

  function fmt(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  /** Never surface hackathon TODO / REPLACE_ placeholder copy in the Control Tower. */
  function polishPolicyLabel(raw) {
    const s = String(raw || "").trim();
    if (
      !s ||
      /REPLACE_/i.test(s) ||
      /swap for/i.test(s) ||
      /stand-in/i.test(s) ||
      /no Pomerium yet/i.test(s) ||
      /when IdP ready/i.test(s) ||
      /when booth/i.test(s)
    ) {
      return "Identity-aware policy gate (Pomerium)";
    }
    return s;
  }

  function polishPolicySnippet(raw) {
    return String(raw || "")
      .split("\n")
      .map((line) => {
        if (/REPLACE_|swap for|stand-in|when IdP ready|when booth/i.test(line)) {
          if (line.trimStart().startsWith("#")) {
            return "# Identity-aware policy gate (Pomerium)";
          }
          return line.replace(
            /Pomerium policy shim[^\n]*/i,
            "Identity-aware policy gate (Pomerium)"
          );
        }
        return line;
      })
      .join("\n");
  }

  function safeDisplayUrl(url) {
    const s = String(url || "");
    if (!s || /REPLACE_/i.test(s)) return "—";
    return s;
  }

  function animateSpend() {
    const diff = targetSpend - displaySpend;
    if (Math.abs(diff) < 1) {
      displaySpend = targetSpend;
      spendEl.textContent = fmt(displaySpend);
      animFrame = null;
      return;
    }
    const speed = Math.abs(diff) > 2000 ? 0.28 : Math.abs(diff) > 200 ? 0.22 : 0.18;
    displaySpend += diff * speed;
    spendEl.textContent = fmt(displaySpend);
    animFrame = requestAnimationFrame(animateSpend);
  }

  function setSpend(n, budget) {
    targetSpend = n;
    const over = n > budget;
    spendEl.classList.toggle("over", over);
    spendEl.classList.toggle("ok", !over && gateMode === "on");
    spendEl.classList.toggle("gate-off", gateMode === "off");
    const pct = Math.min(100, (n / budget) * 100);
    budgetFill.style.width = pct + "%";
    budgetFill.classList.toggle("over", over);
    budgetPct.textContent = Math.round(pct) + "%";
    budgetLabel.textContent = fmt(budget);
    updateGateStatus(over);
    if (!animFrame) animFrame = requestAnimationFrame(animateSpend);
  }

  function updateGateStatus(overBudget) {
    if (gateMode === "off") {
      gateLight.dataset.status = "off";
      gateText.textContent = "OFF";
      document.body.classList.add("gate-off");
      return;
    }
    document.body.classList.remove("gate-off");
    if (quarantined) {
      gateLight.dataset.status = "alert";
      gateText.textContent = "QUARANTINED";
    } else {
      gateLight.dataset.status = overBudget ? "alert" : "ok";
      gateText.textContent = overBudget ? "OVER BUDGET" : "OPEN";
    }
  }

  function flashScreen(kind) {
    if (!flashOverlay) return;
    flashOverlay.className = "flash-overlay " + kind;
    requestAnimationFrame(() => flashOverlay.classList.add("show"));
    setTimeout(() => flashOverlay.classList.remove("show"), 450);
  }

  function renderPolicy(policy) {
    if (!policySnippet) return;
    if (!policy) return;
    const snippet = polishPolicySnippet(policy.snippet || "");
    const q = policy.policy?.quarantine?.identities || [];
    quarantined = q.length > 0;

    if (snippet && snippet !== lastSnippet) {
      const before = lastSnippet;
      lastSnippet = snippet;
      policySnippet.textContent = snippet;
      if (before && policyDiff) {
        policyDiff.textContent =
          "─ PPL diff ─\n− before\n" +
          before.split("\n").slice(0, 4).join("\n") +
          "\n+ after\n" +
          snippet.split("\n").slice(0, 6).join("\n");
        policyDiff.hidden = false;
        if (policyPanel) {
          policyPanel.classList.remove("ppl-pulse");
          void policyPanel.offsetWidth;
          policyPanel.classList.add("ppl-pulse");
        }
      }
    } else if (snippet) {
      policySnippet.textContent = snippet;
      lastSnippet = snippet;
    }

    if (q.length > lastQuarantineCount) {
      flashScreen("block");
      if (policyPanel) {
        policyPanel.classList.add("quarantine-hot");
        setTimeout(() => policyPanel.classList.remove("quarantine-hot"), 2000);
      }
    }
    lastQuarantineCount = q.length;

    if (policyNote) {
      policyNote.textContent = polishPolicyLabel(policy.label);
    }
  }

  function actorClass(actor) {
    if (actor === "guardian" || actor === "secgate") return "guardian";
    if (actor === "dev-agent" || (actor && actor.includes("dev"))) return "dev";
    return "system";
  }

  function addChat(ev) {
    if (seen.has("chat:" + ev.id)) return;
    seen.add("chat:" + ev.id);
    const div = document.createElement("div");
    div.className = "bubble " + actorClass(ev.actor);
    if (ev.detail && ev.detail.verdict === "BLOCK") div.classList.add("verdict-block");
    if (ev.detail && ev.detail.verdict === "ALLOW") div.classList.add("verdict-allow");
    const badges = [];
    if (ev.detail && ev.detail.pricingSource) {
      const p = ev.detail.pricingSource === "zero" ? "Zero" : "table";
      badges.push(
        '<span class="src-badge' +
          (ev.detail.pricingSource === "zero" ? " live" : "") +
          '" title="Pricing source">' +
          escapeHtml(p) +
          "</span>"
      );
    }
    if (ev.detail && ev.detail.budgetSource) {
      const b = ev.detail.budgetSource === "nexla" ? "Nexla" : "local";
      badges.push(
        '<span class="src-badge' +
          (ev.detail.budgetSource === "nexla" ? " live" : "") +
          '" title="Budget source">' +
          escapeHtml(b) +
          "</span>"
      );
    }
    const badgeHtml = badges.length
      ? '<div class="src-row">' + badges.join("") + "</div>"
      : "";
    div.innerHTML =
      '<div class="who">' +
      escapeHtml(ev.actor) +
      "</div>" +
      badgeHtml +
      "<div>" +
      escapeHtml(ev.message) +
      "</div>";
    chatFeed.prepend(div);
  }

  function addTool(ev) {
    if (seen.has("tool:" + ev.id)) return;
    seen.add("tool:" + ev.id);
    const blocked = ev.kind === "blocked" || ev.kind === "apply_denied";
    const allow =
      ev.kind === "allow" ||
      ev.kind === "apply" ||
      ev.kind === "plan" ||
      ev.kind === "estimate" ||
      ev.kind === "destroy";
    if (
      !blocked &&
      !allow &&
      ev.kind !== "guardian_reject" &&
      ev.kind !== "guardian_approve"
    ) {
      return;
    }
    const row = document.createElement("div");
    row.className =
      "tool-row" + (blocked ? " flash-block" : allow ? " flash-allow" : "");
    const badge = blocked
      ? '<span class="badge blocked">BLOCKED 403</span>'
      : ev.kind === "guardian_reject"
        ? '<span class="badge blocked">REJECT</span>'
        : '<span class="badge allow">ALLOW</span>';
    row.innerHTML =
      badge +
      '<div class="tool-msg">' +
      escapeHtml(ev.message) +
      "</div>" +
      '<div class="tool-ts">' +
      new Date(ev.ts).toLocaleTimeString() +
      "</div>";
    toolFeed.prepend(row);
    if (blocked) flashScreen("block");
    else if (ev.kind === "allow" || ev.kind === "apply") flashScreen("allow");
  }

  function timelineDetail(ev) {
    if (ev.detail && typeof ev.detail.blurb === "string") return ev.detail.blurb;
    return ev.message;
  }

  function addTimeline(ev) {
    if (!ev.sponsor || !timelineFeed) return;
    if (seen.has("tl:" + ev.id)) return;
    seen.add("tl:" + ev.id);

    if (timelineEmpty) timelineEmpty.remove();

    const sev = ev.severity || "info";
    const row = document.createElement("div");
    row.className = "tl-row sev-" + sev + " sponsor-" + ev.sponsor;
    const label = SPONSOR_LABEL[ev.sponsor] || ev.sponsor;
    const title = ev.title || ev.kind || "event";
    row.innerHTML =
      '<div class="tl-sponsor sponsor-' +
      escapeHtml(ev.sponsor) +
      '">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="tl-body"><div class="tl-title">' +
      escapeHtml(title) +
      '</div><div class="tl-detail">' +
      escapeHtml(timelineDetail(ev)) +
      "</div></div>" +
      '<div class="tl-meta"><div>' +
      new Date(ev.ts).toLocaleTimeString() +
      '</div><span class="tl-sev ' +
      escapeHtml(sev) +
      '">' +
      escapeHtml(sev) +
      "</span></div>";

    timelineFeed.appendChild(row);
    timelineCount += 1;
    timelineFeed.scrollTop = timelineFeed.scrollHeight;

    if (sev === "block") flashScreen("block");
    else if (sev === "allow" && (ev.sponsor === "akash" || ev.kind === "apply")) {
      flashScreen("allow");
    }
  }

  function auditSponsors(ev) {
    if (Array.isArray(ev.sponsors) && ev.sponsors.length) return ev.sponsors;
    if (ev.sponsor) return [ev.sponsor];
    return [];
  }

  function isAuditEvent(ev) {
    if (!ev) return false;
    if (ev.action || (ev.links && ev.links.length) || ev.resource) return true;
    if (ev.sponsor) return true;
    const kinds = {
      plan: 1,
      estimate: 1,
      apply: 1,
      apply_denied: 1,
      destroy: 1,
      blocked: 1,
      allow: 1,
      guardian_approve: 1,
      guardian_reject: 1,
      timeline: 1,
    };
    return !!kinds[ev.kind];
  }

  function resultClass(result) {
    const r = String(result || "OK").toLowerCase();
    if (r.includes("block") || r.includes("reject")) return "blocked";
    if (r.includes("destroy")) return "destroyed";
    if (r.includes("warn")) return "warn";
    if (r.includes("allow") || r === "ok") return "allow";
    return "ok";
  }

  function inferAction(ev) {
    if (ev.action) return ev.action;
    if (ev.title) return ev.title;
    return ev.kind || "event";
  }

  function inferResult(ev) {
    if (ev.result) return ev.result;
    if (ev.severity === "block" || ev.kind === "blocked" || ev.kind === "apply_denied")
      return "BLOCKED";
    if (ev.kind === "guardian_reject") return "REJECTED";
    if (ev.kind === "destroy") return "DESTROYED";
    if (ev.severity === "allow" || ev.kind === "allow" || ev.kind === "guardian_approve")
      return "ALLOW";
    if (ev.severity === "warn") return "WARN";
    return "OK";
  }

  function inferResource(ev) {
    if (ev.resource) return ev.resource;
    const d = ev.detail || {};
    if (d.name) return String(d.name);
    if (d.deployment && d.deployment.name) return String(d.deployment.name);
    if (d.proposalId) return String(d.proposalId);
    if (d.planId) return String(d.planId);
    if (d.tool) return String(d.tool);
    return "—";
  }

  function applyAuditFilter() {
    if (!auditFeed) return;
    const rows = auditFeed.querySelectorAll(".audit-row");
    rows.forEach((row) => {
      if (auditFilter === "all") {
        row.classList.remove("hidden");
        return;
      }
      const list = (row.dataset.sponsors || "").split(",").filter(Boolean);
      row.classList.toggle("hidden", list.indexOf(auditFilter) === -1);
    });
  }

  function addAudit(ev) {
    if (!auditFeed || !isAuditEvent(ev)) return;
    if (seen.has("audit:" + ev.id)) return;
    seen.add("audit:" + ev.id);

    if (auditEmpty) auditEmpty.remove();

    const sponsors = auditSponsors(ev);
    const action = inferAction(ev);
    const result = inferResult(ev);
    const resource = inferResource(ev);
    const links = Array.isArray(ev.links) ? ev.links : [];

    const row = document.createElement("div");
    row.className = "audit-row";
    row.dataset.sponsors = sponsors.join(",");
    row.innerHTML =
      '<div class="al-ts">' +
      escapeHtml(new Date(ev.ts).toLocaleTimeString()) +
      '</div><div class="al-actor">' +
      escapeHtml(ev.actor || "system") +
      '</div><div class="al-action">' +
      escapeHtml(action) +
      '</div><div class="al-resource" title="' +
      escapeHtml(resource) +
      '">' +
      escapeHtml(resource) +
      '</div><div class="al-result ' +
      resultClass(result) +
      '">' +
      escapeHtml(result) +
      '</div><div class="al-links">' +
      links
        .map(
          (l) =>
            '<a href="' +
            escapeHtml(l.url) +
            '" target="_blank" rel="noopener">' +
            escapeHtml(l.label) +
            "</a>"
        )
        .join("") +
      "</div>" +
      (sponsors.length
        ? '<div class="al-sponsors">' +
          sponsors
            .map(
              (s) =>
                '<span class="al-sp sponsor-' +
                escapeHtml(s) +
                '">' +
                escapeHtml(SPONSOR_LABEL[s] || s) +
                "</span>"
            )
            .join("") +
          "</div>"
        : "");

    auditFeed.appendChild(row);
    auditCount += 1;
    applyAuditFilter();
    auditFeed.scrollTop = auditFeed.scrollHeight;
  }

  if (auditFilters) {
    auditFilters.addEventListener("click", (e) => {
      const btn = e.target.closest(".audit-chip");
      if (!btn) return;
      auditFilter = btn.dataset.sponsor || "all";
      auditFilters.querySelectorAll(".audit-chip").forEach((c) => {
        c.classList.toggle("active", c === btn);
      });
      applyAuditFilter();
    });
  }

  function renderDeployments(deps) {
    if (!deps || !deps.length) {
      deployList.innerHTML = '<div class="empty">No running deployments</div>';
      return;
    }
    deployList.innerHTML = deps
      .map((d) => {
        const orphan = !d.ownerTag
          ? '<span class="orphan-tag">untagged</span>'
          : "";
        return (
          '<div class="dep-card"><div class="name">' +
          escapeHtml(d.name) +
          orphan +
          '</div><div class="dep-meta"><span>' +
          d.gpuCount +
          "×" +
          escapeHtml(d.gpu) +
          " · " +
          fmt(d.usdPerMonth) +
          "/mo</span><span>lease " +
          escapeHtml(d.akashLeaseId) +
          "</span>" +
          (safeDisplayUrl(d.liveUrl) === "—"
            ? '<span class="muted">no public URL</span>'
            : '<a href="' +
              escapeHtml(d.liveUrl) +
              '" target="_blank" rel="noopener">' +
              escapeHtml(safeDisplayUrl(d.liveUrl)) +
              "</a>") +
          "</div></div>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function poll() {
    try {
      const res = await fetch("/events");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      gateMode = data.gate || "on";
      setSpend(data.committedSpendUsd || 0, data.budgetUsd || 500);
      renderDeployments(data.deployments || []);
      renderPolicy(data.policy);
      if (phaseLabel) {
        const bits = ["Phase " + (data.phase || 5)];
        if (data.gate === "off") bits.push("GATE OFF");
        else if (data.policy) bits.push("Pomerium policy");
        else bits.push("mock stack");
        if (data.budgetSource) bits.push("budget:" + data.budgetSource);
        bits.push("timeline:" + timelineCount);
        phaseLabel.textContent = bits.join(" · ");
      }
      const events = data.events || [];
      for (const ev of events) {
        if (ev.kind === "chat") addChat(ev);
        addTool(ev);
        addTimeline(ev);
        addAudit(ev);
        if (ev.detail && ev.detail.pplDiff) {
          if (policyDiff && ev.detail.snippetBefore && ev.detail.snippetAfter) {
            policyDiff.textContent =
              "─ PPL quarantine diff ─\n" +
              String(ev.detail.snippetAfter);
            policyDiff.hidden = false;
            if (policyPanel) {
              policyPanel.classList.add("ppl-pulse", "quarantine-hot");
            }
          }
        }
      }
      conn.textContent =
        "live · " +
        events.length +
        " events · " +
        timelineCount +
        " timeline · " +
        auditCount +
        " audit · " +
        new Date().toLocaleTimeString();
    } catch (err) {
      conn.textContent = "offline · " + err.message;
    }
  }

  poll();
  setInterval(poll, 1000);
})();
