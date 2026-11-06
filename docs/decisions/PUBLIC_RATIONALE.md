# Public decision rationale

These are concise, reviewed explanations of the decisions cited in the public
source. They intentionally omit private migration cases, identities, operational
access and restricted asset details. They do not claim that every planned client
feature is complete; consult the current component documentation and tests for
implemented scope.

## ADR-0001

**Time Trial contract.** `TimeTrialSubmissionV1` is a language-neutral JSON
Schema Draft 2020-12 contract. Producers adapt to the contract and use stable
catalog asset IDs so clients can exchange results without numeric index drift.

## ADR-0006

**Identity policy.** A name, handle, OCR string or legacy key never proves that
two records belong to one person. A human Player has at most one active verified
claim and every claim needs authorized review. The older limit of one claim per
account was changed by ADR-0178; the Player-side limit remains.

## ADR-0131

**Runtime artifact provenance.** An artifact is classified as internally
redistributable, third-party redistributable under documented terms, private
non-redistributable or provenance unknown. Unknown provenance does not authorize
public redistribution; package inputs must follow their recorded class.

## ADR-0137

**Passwordless Web session.** The Web client exposes only a bounded signed-in
state to product UI. Email, session identifiers and tokens stay out of the DOM;
email-link requests use generic responses and users can revoke their session.

## ADR-0147

**Result publication.** Acceptance, publication and the current result revision
are separate server-owned states. Unreviewed or failed recognition does not
become a public result, and Tournament publication is an audited administrator
action over confirmed results.

## ADR-0151

**Player names.** The stable internal Player ID, unique public username and
display name serve different purposes. Changing a username or display name does
not change the Player ID or silently merge identities.

## ADR-0154

**Rating baseline.** The Tournament rating engine preserves the proven
race-level TrueSkill semantics and begins its canonical history from an
approved transition checkpoint. New Players use the documented prior; the
conservative public score is `mu - 3 * sigma`. Private source histories and
identity mappings are not public package inputs.

## ADR-0155

**Rating publication and recalculation.** Only administrator-published,
eligible races update ratings. Exclusion and re-inclusion append decisions;
recalculation replays included races into a new auditable epoch, preserving old
events rather than rewriting their history.

## ADR-0156

**Canonical Tournament import.** Confirmed `TournamentRaceResultV1` documents
enter through an authorized administrator boundary with contract validation and
audited publication. A local capture or spreadsheet cannot directly change
official standings.

## ADR-0159

**Page bootstrap and static assets.** The configured Web server serves versioned
static assets directly. Pages obtain their initial product state from a bounded
bootstrap response, avoiding mismatched HTML and asset copies during updates.

## ADR-0160

**Tournament operation.** Tournaments, participants, groups, races and manual
scores belong to the canonical API and database. Authorized Directors work
through revision-checked, audited operations; local clients supply evidence
and proposals, not a second authoritative store.

## ADR-0167

**Correction provenance.** Recognition-derived Time Trial revisions may record
which canonical field groups the player corrected. Manual entries do not invent
recognition provenance, and earlier result revisions remain intact.

## ADR-0169

**Reference records.** World Record updates are accepted only as one complete,
consistent canonical set across the required source pages. Missing or
conflicting records fail closed. Relative mastery derives from verified
reference data rather than silently changing user results.

## ADR-0172

**Account Time Trial preferences.** A private account may store a mode focus and
a bounded in-game screen name. Those settings affect personal views and
notifications through the existing preferences API and mutation budget, without
changing ownership or public result identity.

## ADR-0176

**Tournament steps and score feed.** New Tournament nights follow the complete
Step 0–10 flow. The current step owns its primary action; provisional connected
scores remain separate from confirmed, accepted official results.

## ADR-0177

**Director setup.** Account authentication and explicit Director grants replace
the old unauthenticated Manager PIN. Tournament setup records the intended
night and roster through the canonical workflow, with authority checked by the
server.

## ADR-0178

**Separate identities and multiple claims.** Time Trial and Tournament
identities remain separate Players until the person makes explicit claims and
an authorized reviewer approves them. One account may own several verified
Players, while a Player has only one verified owner. Two Players who competed
in the same Tournament must not be linked; joining rated histories also
requires the documented recalculation safeguard. These safeguards remain a
release qualification item where implementation is incomplete.

## ADR-0180

**Self-service onboarding.** A dedicated onboarding route lets a new user
search for an existing Player or create one through an explicit choice. Name
similarity supplies candidates and context, never automatic identity approval.

## ADR-0185

**Time Trial track scopes.** Base, Booster Course Pass and all-track views use
the same canonical 96-track catalog for both 150cc and 200cc. Staff-country
display follows its verified reference evidence and schema asset IDs.

## ADR-0187

**Browser scanner channel.** The browser scanner is a static same-origin
application under `/scanner/`, with its own scoped service worker and offline
assets. Its output enters the ordinary Time Trial review path instead of
publishing a result directly.

## ADR-0189

**Measured rating changes.** Rating parameters and inactivity behavior are
chosen from recorded comparisons, not guessed from current standings. Changes
use an explicit epoch so past ratings remain reproducible and the adopted
parameters can be inspected independently.

## ADR-0199

**One link grammar.** Android interprets the Web product's existing HTTPS
query links as navigation intents. It does not introduce a competing deep-link
scheme, and both clients keep route and comparison meanings aligned.

## ADR-0200

**Client build check-in.** A signed-in native client reports installation,
client, version, optional build and device name. Administrators alone can read
the bounded history; stale entries are pruned after 18 months. This does not
authorize broader activity or device telemetry.

## ADR-0203

**Preserved scan engine.** Maintained recognition fixes are applied only to a
verified staging copy of the protected engine, with old/new corpus evidence and
source hashes. The public Android build uses its active `engine-src`; unused
duplicate overlay files in the public checkout are not a runtime dependency.

## ADR-0204

**Web scan provenance.** A Web-assisted submission records `web_scan`, its
capture layout where known, field confidence and later corrected fields.
Correcting a scanned draft does not recast it as a manual entry.

## ADR-0205

**Appearance preference.** The saved choice is `system`, `light` or `dark`, not
the OS-resolved color mode. Account and local preference can synchronize while
high-contrast and forced-colors needs still follow the device.

## ADR-0206

**Scanner in Post a Time.** Scanning supplies a draft to the same Post a Time
validation and review as manual entry. The scanner engine and UI may be loaded
separately, but a scan does not create a second submission policy.

## ADR-0207

**Shared design tokens.** Platform-independent tokens define color, type,
spacing and component meaning once. Generated Web and Android adapters consume
that source rather than maintaining unrelated design constants.

## ADR-0208

**LiveTrial local app.** The local server and dashboard are the intended
interface for capture, video analysis, results and account actions. The
current public package is qualified on Windows; Linux is a documented target
and needs its own package and runtime evidence.

## ADR-0209

**Native email sign-in.** An email link or code can approve an existing device
authorization request, while the native client still redeems the normal device
code. The server retains session and revocation rules; clients never collect a
password.

## ADR-0210

**Detected ghosts.** LiveTrial collects sightings of a ghost under a stable
track, class, time and observed-name key. Repeated panels enrich one local
record, while incomplete or conflicting fields remain reviewable evidence.

## ADR-0211

**Manage a result.** A player edits an owned result through the same Time Trial
form and validation rules used to post it. Corrections append a revision;
changing track or class requires a separate result rather than rewriting the
competition identity.

## ADR-0212

**Reference ghost readings.** A signed-in native client may submit detected
Staff or World Record ghost details. The server verifies the reference identity
and total again before exposing a reading; the sending account is not displayed
as the ghost's owner.

## ADR-0213

**Optional video upload.** LiveTrial uploads a chosen clip to YouTube only after
the person explicitly requests it. The video goes directly from the local PC;
the community server does not relay it, and failure does not block local
capture or result delivery.

## ADR-0214

**Country catalog alignment.** Web and Android scanner staging verify flag
templates against the schema-9 country order. A mismatched catalog fails
staging rather than silently assigning the wrong country ID.

## ADR-0215

**Shared scan fields.** Web and Android scans publish the same canonical
character, kart, tire and country IDs with comparable confidence and review
semantics. Numeric legacy positions are resolved through verified tables.

## ADR-0216

**Claim review.** Administrators can review claims; a Director's review scope
is limited to Players in that Director's Tournament. Approval, refusal and
revocation preserve an audit trail and do not infer ownership from a name.

## ADR-0217

**Tournament race class.** `TournamentRaceResultV1` may carry 50, 100, 150 or
200cc, with Mirror represented as an optional marker only for 150cc. Older
documents without a confidently observed class remain valid.

## ADR-0218

**Player picking.** A name search shows contextual Player candidates and the
option to create a new Player. The Director chooses explicitly; display names
may repeat, while usernames remain unique and aliases are deliberate records.

## ADR-0219

**Onboarding choices.** Onboarding asks separately whether the person has
existing Time Trials and Tournament participation. Candidate search then
shows context for those answers; the user still chooses and requests review.

## ADR-0220

**Director terminology.** User-facing Web and Android copy uses Director for
the person authorized to host a Tournament. Capture operator is a different
role; a request to host does not grant Director authority by itself.

## ADR-0221

**Installation options.** Administrators may set who can create Players and
whether rating needs a verified claim. Defaults preserve the established
workflow; revisions and audit events record each settings change.

## ADR-0222

**Open sign-up.** The Director's existing roster remains the default. A night
may separately enable bounded sign-up with a closing time and a stated
selection rule; sign-ups join the same roster and waiting-list workflow rather
than replacing it.

## ADR-0223

**Optional offline LAN.** A separate, fully offline A2 installation will use a
per-installation local CA for one LAN-IP HTTPS origin. HTTP exposes only setup
instructions and the public CA certificate. The host-only administrator screen
shows the setup QR and CA fingerprint; Android pairing requires explicit
confirmation of that exact origin and CA key. Local, short-lived, one-use
invitations activate accounts without automatically claiming a Player. Existing
online authentication, routes and link grammar remain unchanged. Root trust
constraints are not assumed to work until tested on each platform; protected
CA backup, renewal, trust removal and an offline restart are required before
the route is described as supported. This is an approved design direction,
not an implemented or qualified installation mode; see [issue #90](https://github.com/fromthelake/MK8DX-Ecosystem/issues/90).

The host access foundation uses a five-minute local unlock code, a loopback-only
listener and a session that checks the administrator grant again on each use.
A2 also includes LiveTrial on another Windows PC: its saved result must reach
the same local API after trusted HTTPS setup and browser device approval.
Neither account management nor this LiveTrial path is qualified yet.
