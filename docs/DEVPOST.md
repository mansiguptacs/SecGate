## Inspiration

Coding agents are quietly becoming operators. They can open tickets, write Terraform, call cloud APIs, and spin up GPUs before a human finishes reading the prompt. That power is exciting — and dangerous. One buried instruction in a task description, one runaway loop, and a team can wake up to orphaned infrastructure and a four-figure monthly bill. We kept coming back to a simple question: if agents already hold cloud credentials, who is watching them? SecGate grew out of that discomfort. We wanted a gate that sits between “the agent wants to do something” and “the cloud actually changed,” without slowing down the normal, boring work that agents should be allowed to do.

## What it does

SecGate is a zero-trust guardrail for AI agents that manage infrastructure. Developer agents may only *propose* changes — plan, estimate, list. They cannot apply or destroy on their own. Every tool call passes through an identity-aware policy gate: the wrong identity trying to mutate infra gets a hard deny. A guardian loop then cost-checks proposals against live budget and pricing context, approves safe work onto Akash, rejects overspend and suspicious tickets, quarantines abusive identities by rewriting policy, and sweeps idle orphaned deployments. A Control Tower dashboard makes the story visible in real time — spend, allows and blocks, and a sponsor-tagged timeline of Pomerium, Zero, Nexla, Akash, and guardian decisions. The short version of the product thesis: agents propose; SecGate disposes.

## How we built it

We built in layers under a mock-first deadline. An infra tool server exposes plan / estimate / apply / destroy / list. A Pomerium-shaped policy gateway sits in front and enforces per-identity, per-tool rules with audit events. The guardian polls proposals, pulls budget through Nexla, enriches pricing through Zero.xyz when available, and only then applies under its own privileged identity. Deployments target Akash (live Console API when keyed, dry-run otherwise). The Control Tower and a keypress demo director make the three-minute story reproducible: disaster with the gate off, clean happy path, poisoned-ticket attack blocked three ways, orphan cleanup, sponsor close. Two laptops split roles — one as the developer agent, one as the security Control Tower — so the demo feels like a real enterprise workflow rather than a single-machine slideshow.

## Challenges we ran into

Sponsor integration under a same-day clock was the hard part. Cloudflare quick tunnels kept dying mid–Laptop A connection, so we moved to LAN-first connectivity. Nexla’s MCP Studio would not turn a PDF SOP or file upload into useful tools without a structured API or database source, so we exposed a small budget endpoint, iterated through Studio, and adapted to Studio-generated tool names and dataframe-shaped responses. Zero could authenticate and search, but GPU “$/hr” rarely appeared as clean numbers, so we had to design an honest enrichment path that still surfaces Zero in the timeline. We also learned the hard way not to commit live API keys into handoff docs. None of that is glamorous — it is exactly the friction teams hit when agents meet real enterprise systems.

## Accomplishments that we're proud of

We shipped a complete demo loop that judges can feel in under three minutes: the cold-open spend spike, the quiet happy path with a live lease story, the triple block on a prompt-injected ticket (guardian reject, gate 403, quarantine), and the orphan reclaim. The Control Tower’s sponsor timeline makes each dependency visible as it fires — not a slide claiming “we used X,” but a chronological trail. We got real Nexla budget reads, Zero session enrichment, and an Akash-backed deploy path working behind the same interfaces as our mocks, so the product did not collapse when a booth credential arrived late.

## What we learned

Autonomy without authorization is just a faster way to make expensive mistakes. Identity has to travel with every tool call; budget and price have to be data the agent can query, not vibes in a prompt; and demos fail for the same reasons production agents fail — networking, schema mismatches, and secrets hygiene. We also learned that “loop engineering” is not only plan → act → observe → correct inside the agent. The interesting loop is the one that watches the agent: observe abuse, tighten policy, verify the next call fails, clean up what was left behind.

## What's next for SecGate

Swap the policy shim for full Pomerium MCP with OAuth so enterprise SSO is first-class. Broaden beyond Akash to Terraform and multi-cloud apply paths under the same propose-only contract. Add richer blast-radius simulation before approval, stronger prompt-injection detection on ticket text, and a proper control plane for team budgets and quarantine policies. Longer term, we want SecGate to be the default side-car for any coding agent that is allowed to touch production infrastructure — quiet when work is safe, loud and final when it is not.
