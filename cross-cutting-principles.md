# Cross-Cutting Principles

Reusable principles promoted from task observations are recorded here during the scheduled review process.

---

## Active Principles

### 1. Production claims require identity and capability evidence
**Added:** 2026-08-25
**Applies to:** all skills that ship or operate software
**Requirement:** A production-complete claim must identify the deployed revision, confirm required services serve it, and probe the changed capability. Aggregate health and successful source-control delivery are supporting signals, not substitutes.
**Propagation:** opportunistic
**Status:** active

### 2. Agent authorization includes discovery and resource binding
**Added:** 2026-08-25
**Applies to:** all skills that design or review agent protocols
**Requirement:** Credentials must be tenant-bound and capability-bound; discovery and dispatch must enforce the same allowlist, and readiness must be evaluated for the resource currently being viewed.
**Propagation:** opportunistic
**Status:** active

### 3. Canonical truth gets one operational lifecycle
**Added:** 2026-08-25
**Applies to:** all product, architecture, import, and operational-UI skills
**Requirement:** Identify the canonical durable entity, protect its aggregate boundary across importers and synchronizers, and provide one write path per business event. Specialized interfaces remain projections of that lifecycle.
**Propagation:** opportunistic
**Status:** active

### 4. Deterministic guarantees and generative quality are separate gates
**Added:** 2026-08-25
**Applies to:** all skills that test or deliver generative systems
**Requirement:** Use deterministic seams for exact lifecycle and safety guarantees, then use the real provider for bounded availability checks and human quality acceptance. Neither form of evidence substitutes for the other.
**Propagation:** opportunistic
**Status:** active

### 5. Operational handoffs must be verifiable
**Added:** 2026-08-25
**Applies to:** all skills that hand work between agents or operators
**Requirement:** Handoffs must include a verified canonical deep link or executable command, observation time, and current persisted state. Proposed navigation must be labeled as proposed.
**Propagation:** opportunistic
**Status:** active
