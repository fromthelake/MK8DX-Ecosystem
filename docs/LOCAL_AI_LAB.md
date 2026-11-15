# FromTheLake Local AI Lab

I'm Bas van der Meer ([fromthelake](https://github.com/fromthelake)). My professional background is in aerospace
programme management, manufacturing, supplier development and engineering. Software development, AI and
automation complement that work, and [MK8DX Ecosystem](../README.md) is the largest open-source project I have
built so far: a self-hosted Mario Kart 8 Deluxe community website with a phone and browser scanner, an Android app,
LiveTrial for automatic Time Trial recording and tools for LAN tournament nights.

This page is the single place for the Local AI Lab plan: the ambition, the stages, the funding assumptions,
reconciled progress, hardware status and updates. Other pages link here rather than keeping their own copy.

## Why I want to develop with local AI

Much of MK8DX Ecosystem was built with AI-assisted development. I would like more freedom to experiment locally: with AI-assisted development, computer vision and
automation, using my own test material and without every experiment depending on a cloud service.

Reducing that dependence is an ambition, not a promise. A local workstation will not replace every cloud
service or remove every subscription, and more hardware does not automatically produce better software.

The current software does not need this workstation, and its development continues with the equipment I have
now.

## What this could make possible

- **Repeatable testing**: running the same recorded races and result screens against several recognition
  approaches, with baseline measurements before a pipeline changes.
- **Local model experiments**: trying suitable coding and vision models on difficult result screens, capture
  conditions and languages, and comparing AI-assisted development workflows.
- **Evidence instead of assumptions**: finding out when a larger model genuinely helps and when a smaller one is
  enough.
- **New tools**: automation ideas and tools beyond MK8DX Ecosystem.

I intend to share useful findings, tools and reusable examples publicly. Code, models and test material are only
published when their licences, permissions and privacy requirements allow it.

## Funding overview and progress

![Local AI Lab funding: first milestone €5,000, complete setup approximately €23,000, progress awaiting reconciliation](images/local-ai-lab-light.svg#gh-light-mode-only)
![Local AI Lab funding: first milestone €5,000, complete setup approximately €23,000, progress awaiting reconciliation](images/local-ai-lab-dark.svg#gh-dark-mode-only)

| | Cumulative target | Covers |
| --- | --- | --- |
| First milestone | €5,000 | Stage 1: the workstation foundation |
| Complete setup | approximately €23,000 | Stages 1 to 5; the €5,000 is part of this amount, not added to it |

<!--
Maintenance: update only the "Funding progress" block below.
- Verified total: one cumulative total of completed GitHub Sponsors and Ko-fi contributions allocated to the
  hardware goal, after payment/platform fees and refunds, before income tax. Count each contribution once;
  exclude future recurring pledges; a payout is not a second contribution; no donor names or transaction details.
  Never lower this total when hardware is bought. It is not expected to match Ko-fi's own goal counter.
- Progress: replace "awaiting reconciliation" with two lines from that same total, the €5,000 first milestone
  first, for example
    `▓▓▓▓░░░░░░` 40% of the €5,000 first milestone
    `▓░░░░░░░░░` 8% of the approximately €23,000 complete setup (includes the €5,000)
- Personal or business co-funding, purchases and remaining cash: separate lines, never part of the verified total.
- Reconciled on: the date the totals were checked. Hardware status: only equipment actually bought.
Add a dated line to "Updates" for every change.
-->

**Funding progress**

- **Verified total:** Funding total not yet reconciled — see [Ko-fi](https://ko-fi.com/fromthelake) for its
  current goal progress.
- **Progress:** awaiting reconciliation. Once reconciled, progress is shown towards the €5,000 first milestone,
  with the approximately €23,000 complete setup alongside, both from the same cumulative total.
- **Reporting basis:** completed GitHub Sponsors and Ko-fi contributions allocated to the hardware goal, after
  payment/platform fees and refunds, before income tax. This is not an after-tax or guaranteed spendable balance.
  Personal or business co-funding is shown separately, and buying hardware does not reduce the cumulative total.
- **Reconciled on:** not yet reconciled.
- **Hardware status:** no purchases recorded on this page yet.

Both amounts are campaign planning targets, not supplier quotations. What can actually be bought depends on
prices at the time, platform and payment fees, other applicable costs and any personal or business co-funding.
Contributions received are not the same as money immediately available for hardware. Ko-fi's goal shows Ko-fi
only; it does not include GitHub Sponsors, so the reconciled total here need not match Ko-fi's counter.

The workstation will be my own equipment. I will use it for my open-source projects and also for other
professional work through FromTheLake Ventures. It is not community-owned equipment and is not reserved
exclusively for open-source work.

## Five-stage capability roadmap

The stages describe capabilities I would like to reach, not five purchases that must happen in order.

### Stage 1 — Development foundation

- **Funding:** €5,000 cumulative, towards the workstation foundation.
- **Hardware direction:** an expandable workstation base: CPU, motherboard, memory, storage, power supply,
  cooling and case. This is not yet a complete GPU-equipped AI workstation.
- **What this could enable:** a more organised development and test environment; repeatable tests with recorded
  races and result screenshots; comparing recognition approaches against consistent test cases; baseline
  measurements before changing a recognition pipeline.
- **Potential value for the projects:** a clearer way to investigate failures and to judge whether a change
  really improves MK8DX Ecosystem. Some of this is possible on my current equipment; a dedicated base makes it
  easier to do consistently.

### Stage 2 — First dedicated local AI setup

- **Funding:** an intermediate cumulative budget, still to be confirmed.
- **Hardware direction:** possibly a 32 GB GPU, such as an RTX PRO 4500 Blackwell.
- **What this could enable:** experiments with suitable local coding and vision models; comparing AI-assisted
  development workflows; investigating difficult result screens, capture conditions and language-dependent
  recognition problems.
- **Potential value for the projects:** experiments that may lead to better recognition methods, reusable
  development tools and practical setup notes. These are research directions, not promised improvements.

### Stage 3 — Broader experimentation

- **Funding:** an intermediate cumulative budget, still to be confirmed.
- **Hardware direction:** optionally a 48 GB GPU, such as an RTX PRO 5000 Blackwell.
- **What this could enable:** a wider range of local models and configurations; more demanding combinations of
  coding, image analysis and testing; comparing smaller and larger models to see when extra resources are
  genuinely useful.
- **Potential value for the projects:** evidence about which approaches work and which do not, rather than
  assuming that a bigger model improves everything. This stage may be skipped.

### Stage 4 — High-memory local AI

- **Funding:** part of the approximately €23,000 complete-setup ambition; no separate threshold has been
  validated.
- **Hardware direction:** a 96 GB RTX PRO 6000 Blackwell, or a suitable alternative at the time of purchase.
- **What this could enable:** investigating larger local coding and vision models; selected model-adaptation
  experiments where feasible; new automation tools and ideas beyond MK8DX Ecosystem.
- **Potential value for the projects:** more room to investigate ideas and develop tools, with the intention of
  sharing useful findings and reusable examples.

### Stage 5 — Complete development environment

- **Funding:** approximately €23,000 cumulative, for the complete setup.
- **Hardware direction:** the selected GPU and workstation with expanded memory, storage and power protection.
  Current preferences: 192 GB system RAM, 4 TB NVMe storage and a UPS.
- **What this could enable:** better organisation of model files and test recordings; longer-running
  evaluations and development experiments; a practical environment for maintaining projects and starting new
  ones over time.
- **Potential value for the projects:** a stronger development foundation, with useful experiments, tools and
  lessons shared publicly where appropriate.

These milestones describe my current plans and the possibilities I would like to explore. Hardware choices and
development priorities may change. Contributions are voluntary and do not purchase features, priority,
recognition or other benefits.

## Flexible purchasing

- The 32 GB and 48 GB GPUs are possible intermediate options, not a commitment to buy and later replace several
  expensive cards. If funding allows, I may go directly to the final GPU.
- The base workstation, GPU, memory, storage and UPS may be bought in a different order when that is more
  practical or economical.
- A large contribution can move the plan forward without the earlier intermediate purchases.
- Reaching a threshold does not mean a purchase follows immediately. The plan assumes no resale proceeds, and
  each euro is counted once.

## Voluntary support

Contributions of any size are welcome and entirely optional.

- [Ko-fi](https://ko-fi.com/fromthelake)
- [GitHub Sponsors](https://github.com/sponsors/fromthelake)

A contribution does not buy features or development work, priority for feature requests, support commitments
or response times, early or exclusive access, sponsor credits, names or logos, advertising or endorsements,
hardware access or ownership, or any financial return. Everyone can suggest features through
[GitHub issues](https://github.com/fromthelake/MK8DX-Ecosystem/issues), whether or not they contribute, and I
decide independently what to build and when. My open-source releases stay freely available under their
licences; third-party material keeps its own terms (see the [license scope](../LICENSE_SCOPE.md)).

If you are thinking about a larger contribution or about supporting the hardware directly, you can reach me
through the contact page of [fromthelake.eu](https://fromthelake.eu/contact.html).

Thank you to everyone who uses, tests or supports these projects.

## Transparency and updates

- Financial progress, purchased hardware and completed experiments will be reported separately on this page, and
  only once verified.
- Totals will be reconciled by hand from the platforms' own records. No donor identities or transaction details
  are published.
- No claims are made about tax treatment, charitable status, VAT or deductibility.

### Updates

- 2026-11: Local AI Lab roadmap added. Funding total not yet reconciled; no hardware purchases recorded.
