"""Offline canonical TimeTrialSubmissionV1 validator for Python outbox hosts."""

from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource


TIME_TRIAL_SCHEMA_ID = (
    "https://mk8dx.example/schemas/domain/time-trial-submission-v1.schema.json"
)
MAX_SCHEMA_BYTES = 1024 * 1024


class OfflineTimeTrialValidatorError(ValueError):
    """Bounded configuration/document failure without schema or record detail."""


def _load_json(path: Path) -> object:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_SCHEMA_BYTES:
            raise ValueError
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        raise OfflineTimeTrialValidatorError(
            "Time Trial schema validation failed."
        ) from None


class OfflineTimeTrialSubmissionV1Validator:
    """Load the language-neutral domain catalog once and validate without I/O later."""

    def __init__(self, domain_package_root: str | Path) -> None:
        try:
            root = Path(domain_package_root).resolve(strict=True)
        except (OSError, TypeError, ValueError):
            raise OfflineTimeTrialValidatorError(
                "Time Trial schema validation failed."
            ) from None
        catalog = _load_json(root / "schema-catalog-v1.json")
        if (
            not isinstance(catalog, dict)
            or catalog.get("catalogVersion") != "mk8dx.domain-schema-catalog.v1"
            or not isinstance(catalog.get("schemas"), list)
            or not isinstance(catalog.get("validationOrder"), list)
        ):
            raise OfflineTimeTrialValidatorError(
                "Time Trial schema validation failed."
            )

        resources: dict[str, dict] = {}
        for record in catalog["schemas"]:
            if not isinstance(record, dict) or set(record) != {
                "name",
                "schemaId",
                "path",
                "dependencies",
                "exampleGlobs",
            }:
                raise OfflineTimeTrialValidatorError(
                    "Time Trial schema validation failed."
                )
            try:
                path = (root / record["path"]).resolve(strict=True)
                path.relative_to(root)
            except (OSError, TypeError, ValueError):
                raise OfflineTimeTrialValidatorError(
                    "Time Trial schema validation failed."
                ) from None
            schema = _load_json(path)
            schema_id = record["schemaId"]
            if (
                not isinstance(schema, dict)
                or not isinstance(schema_id, str)
                or schema.get("$id") != schema_id
                or schema_id in resources
            ):
                raise OfflineTimeTrialValidatorError(
                    "Time Trial schema validation failed."
                )
            resources[schema_id] = schema

        if catalog["validationOrder"] != list(resources) or TIME_TRIAL_SCHEMA_ID not in resources:
            raise OfflineTimeTrialValidatorError(
                "Time Trial schema validation failed."
            )
        registry = Registry()
        try:
            for schema_id in catalog["validationOrder"]:
                registry = registry.with_resource(
                    schema_id,
                    Resource.from_contents(resources[schema_id]),
                )
            self._validator = Draft202012Validator(
                resources[TIME_TRIAL_SCHEMA_ID],
                registry=registry,
            )
        except Exception:
            raise OfflineTimeTrialValidatorError(
                "Time Trial schema validation failed."
            ) from None

    def __call__(self, document: dict) -> None:
        try:
            if not isinstance(document, dict) or any(
                self._validator.iter_errors(document)
            ):
                raise ValueError
            laps = document.get("laps")
            if isinstance(laps, list) and laps:
                lap_times = [lap.get("timeMs") for lap in laps]
                if (
                    not all(type(value) is int for value in lap_times)
                    or sum(lap_times) != document.get("totalTimeMs")
                ):
                    raise ValueError
                coins = [
                    lap["coinsCollected"]
                    for lap in laps
                    if "coinsCollected" in lap
                ]
                mushrooms = [
                    lap["mushroomsUsed"]
                    for lap in laps
                    if "mushroomsUsed" in lap
                ]
                # coinsCollected is the coin balance at the end of each lap
                # (schema: 0-10 each, gains derived from consecutive balances),
                # so balances are checked per lap and never summed; mushrooms
                # are the ones used inside each lap, at most 3 in a run.
                if (
                    not all(type(value) is int and 0 <= value <= 10 for value in coins)
                    or not all(type(value) is int for value in mushrooms)
                    or sum(mushrooms) > 3
                ):
                    raise ValueError
        except Exception:
            raise OfflineTimeTrialValidatorError(
                "Time Trial schema validation failed."
            ) from None
