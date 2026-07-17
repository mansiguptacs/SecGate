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
  const phaseLabel = document.getElementById("phaseLabel");
  const policyNote = document.getElementById("policyNote");

  let seen = new Set();
  let displaySpend = 0;
  let targetSpend = 0;
  let animFrame = null;
  let quarantined = false;

  function fmt(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function animateSpend() {
    const diff = targetSpend - displaySpend;
    if (Math.abs(diff) < 1) {
      displaySpend = targetSpend;
      spendEl.textContent = fmt(displaySpend);
      animFrame = null;
      return;
    }
    displaySpend += diff * 0.18;
    spendEl.textContent = fmt(displaySpend);
    animFrame = requestAnimationFrame(animateSpend);
  }

  function setSpend(n, budget) {
    targetSpend = n;
    const over = n > budget;
    spendEl.classList.toggle("over", over);
    spendEl.classList.toggle("ok", !over);
    const pct = Math.min(100, (n / budget) * 100);
    budgetFill.style.width = pct + "%";
    budgetFill.classList.toggle("over", over);
    budgetPct.textContent = Math.round(pct) + "%";
    budgetLabel.textContent = fmt(budget);
    if (quarantined) {
      gateLight.dataset.status = "alert";
      gateText.textContent = "QUARANTINED";
    } else {
      gateLight.dataset.status = over ? "alert" : "ok";
      gateText.textContent = over ? "OVER BUDGET" : "OPEN";
    }
    if (!animFrame) animFrame = requestAnimationFrame(animateSpend);
  }

  function renderPolicy(policy) {
    if (!policySnippet) return;
    if (!policy) return;
    const snippet = policy.snippet || "";
    if (snippet) policySnippet.textContent = snippet;
    const q = policy.policy?.quarantine?.identities || [];
    quarantined = q.length > 0;
    if (policyNote) {
      policyNote.textContent = policy.label || "Pomerium policy";
    }
  }

  function actorClass(actor) {
    if (actor === "guardian" || actor === "secgate") return "guardian";
    if (actor === "dev-agent" || actor.includes("dev")) return "dev";
    return "system";
  }

  function addChat(ev) {
    if (seen.has("chat:" + ev.id)) return;
    seen.add("chat:" + ev.id);
    const div = document.createElement("div");
    div.className = "bubble " + actorClass(ev.actor);
    div.innerHTML =
      '<div class="who">' +
      escapeHtml(ev.actor) +
      "</div>" +
      "<div>" +
      escapeHtml(ev.message) +
      "</div>";
    chatFeed.prepend(div);
  }

  function addTool(ev) {
    if (seen.has("tool:" + ev.id)) return;
    seen.add("tool:" + ev.id);
    const blocked = ev.kind === "blocked" || ev.kind === "apply_denied";
    const allow = ev.kind === "allow" || ev.kind === "apply" || ev.kind === "plan" || ev.kind === "estimate";
    if (!blocked && !allow && ev.kind !== "guardian_reject" && ev.kind !== "guardian_approve") {
      return;
    }
    const row = document.createElement("div");
    row.className = "tool-row" + (blocked ? " flash-block" : "");
    const badge = blocked
      ? '<span class="badge blocked">BLOCKED</span>'
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
  }

  function renderDeployments(deps) {
    if (!deps || !deps.length) {
      deployList.innerHTML = '<div class="empty">No running deployments</div>';
      return;
    }
    deployList.innerHTML = deps
      .map(
        (d) =>
          '<div class="dep-card"><div class="name">' +
          escapeHtml(d.name) +
          '</div><div class="dep-meta"><span>' +
          d.gpuCount +
          "×" +
          escapeHtml(d.gpu) +
          " · " +
          fmt(d.usdPerMonth) +
          '/mo</span><span>lease ' +
          escapeHtml(d.akashLeaseId) +
          '</span><a href="' +
          escapeHtml(d.liveUrl) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(d.liveUrl) +
          "</a></div></div>"
      )
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
      setSpend(data.committedSpendUsd || 0, data.budgetUsd || 500);
      renderDeployments(data.deployments || []);
      renderPolicy(data.policy);
      if (phaseLabel) {
        phaseLabel.textContent =
          "Phase " + (data.phase || 1) + (data.policy ? " · Pomerium policy" : " mock stack");
      }
      const events = data.events || [];
      for (const ev of events) {
        if (ev.kind === "chat") addChat(ev);
        addTool(ev);
      }
      conn.textContent = "live · " + events.length + " events · " + new Date().toLocaleTimeString();
    } catch (err) {
      conn.textContent = "offline · " + err.message;
    }
  }

  poll();
  setInterval(poll, 1200);
})();
