# Runtime Asset Notice

The original live shell source is under MPL 2.0, but that license does not cover
Nintendo-derived images, recognition templates, game footage, or reference
metadata used by the preserved working project.

The current consolidated repository contains an internal collection under
`packages/assets/collection/`; the product selects required objects from it.
Runtime path variables such as `MK8DX_TOURNAMENT_ASSETS_ROOT` and
`MK8DX_TOURNAMENT_REFERENCE_ROOT` identify those inputs for local execution.
The root MPL license covers original code, not the selected assets. Review each
required object before redistributing the combined repository; see
`docs/THIRD_PARTY_MATERIALS.md`.
