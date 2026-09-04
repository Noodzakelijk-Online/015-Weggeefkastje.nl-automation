# Compliance and privacy guidance

This product maintains a public directory of giveaway cupboards. A public exact address can be useful and necessary for a resident who wants to visit a cupboard, but source material can also contain personal data, private-group context or unreliable claims. The design therefore separates **public location facts** from **internal evidence**.

This document is operational guidance, not legal advice. The operator remains responsible for checking applicable platform terms, permission, privacy law and local circumstances before activating a source.

## Non-negotiable rules

The application and its operators must not:

- bypass authentication, paywalls, login walls, CAPTCHAs, rate limits or technical access controls;
- scrape private Facebook groups, private Nextdoor areas, private chats or closed community apps;
- use an ordinary logged-in browser as if it were source permission;
- impersonate a user, mass-message people, publish posts or automate conversations;
- collect unnecessary names, profiles, telephone numbers, private photos, comments or full conversations;
- treat a social mention, an anonymous report or source disappearance as proof that a cupboard should be removed;
- expose source links, source summaries, permission references, audit trails or caretaker-token data through the public API.

## Permitted routes

A source may be processed only when it has both a legitimate access route and a completed entry in the application’s source register.

1. An official API whose terms and credentials permit this use.
2. An export explicitly authorised by the platform or group administrator.
3. Open data with compatible licence and required attribution.
4. A written owner or partner authorisation, delivered through an approved export/API path.
5. Manually entered information where the operator has the right to process it.

For a private group, written permission from the group administrator must exist **before** data is processed. Record a concise reference to that permission in the source register; do not paste secret credentials, full emails or unrelated conversation content there.

## Source register requirements

Every enabled source has:

| Field | Why it exists |
| --- | --- |
| Key and name | Identifies the adapter and the human source |
| Access mode | Makes clear whether access is official API, approved export, open data, owner-authorised or manual |
| Authorisation reference | Evidence that the operator may use the source; do not store secrets |
| Attribution | Required public credit/license text where relevant |
| Enabled state | Lets an operator stop a source without deleting historical records |
| Exact-address permission | Explicitly records whether the source may support publication of exact addresses |
| Publication mode | Either automatic after all checks or review first |

The server rejects automatic mode unless the source is enabled and has exact-address permission. Technical configuration alone never turns a source on.

## Exact addresses and public visibility

An exact address is required for a public location because a neighbourhood-level approximation is not useful for this product. The application publishes an address only after all of the following are true:

1. the source is enabled and explicitly allows exact-address processing;
2. street, house number, Dutch postcode and city are present;
3. the official PDOK Locatieserver returns an exact normalised match;
4. the location is active; and
5. the source policy is automatic, or an authorised operator has reviewed and published it.

Public output contains only the resident-facing location facts: display name, exact address, optional municipality/province, coordinates, categories, last verification time, a user-initiated directions URL and public source attributions. It does not contain evidence text, social URLs, permission material, contact data, internal request reasons or source identifiers.

A lower-confidence record, an address that fails verification or a source without exact-address permission remains an internal review request. It is not “approximately published”.

## Facebook, Nextdoor and other social context

- Facebook use is limited to the official Graph API and explicitly configured Pages. The application does not crawl Facebook search, private groups or profiles.
- Nextdoor use is limited to a written-authorised JSONL export until a real partner/API agreement exists. No browser login workflow is implemented.
- Social material is evidence intake, not automatically trusted public truth. Store a short necessary summary, source URL only where appropriate and observation time; do not retain full conversations when not necessary.
- Do not request or infer a resident’s location from their browser. The public search field is user-entered text.

## Reports, removals and freshness

A public correction report creates an internal pending request. It cannot directly change or remove a public location. An operator must resolve or dismiss it, or a holder of a scoped caretaker link can update their own record. This preserves a complete audit trail and reduces the risk of malicious or mistaken removal.

Show the last verification time to residents. A source must not invent freshness merely because an import ran; it should record a source check separately from confirmed location evidence.

## Caretaker links

A caretaker link is a secret bearer link for one location only.

- Store only a hash of the token.
- Show the raw URL once at creation and do not log it.
- Use a finite lifetime; the current implementation allows 1–365 days and defaults to 180.
- Revoke the prior active link when issuing a new one and allow an operator to revoke any active link.
- Recheck a submitted exact address through PDOK before saving it.
- Do not use the link to reveal evidence, source details, other locations or operator functions.

## OpenStreetMap and attribution

OpenStreetMap is an optional bounded discovery pilot, not a blanket permission to copy data elsewhere. Use a small Dutch bounding box, an HTTPS endpoint and the source’s licence/attribution requirements. When OSM evidence supports a displayed location, configure visible attribution such as **© OpenStreetMap contributors — ODbL**. Consult the official [OpenStreetMap attribution guidance](https://www.openstreetmap.org/copyright/attribution-guide/) for the current requirements.

## Security and retention

- Keep .env files, SQLite files, source exports, backups and logs out of version control.
- Restrict filesystem access to the operator account/service account.
- Rotate an external credential immediately if it may be exposed.
- Use the safety stop before investigating a suspicious provider run.
- Keep evidence only as long as required for source traceability, review and legal obligations; apply the workspace retention policy deliberately.
- Use the privacy export and backup/restore controls according to the operator runbook.

See [README.md](../README.md), [SECURITY.md](SECURITY.md) and [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) for implementation and operating details.
