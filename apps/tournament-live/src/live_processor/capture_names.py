"""Local card labels and explicit audio associations, keyed by DirectShow IDs."""
from __future__ import annotations

import json
import unicodedata


class CaptureCardNames:
    _STICKER_DEFAULTS = {
        "cc groep 1": ("Groep 1", "Kampioen"),
        "cc group 1": ("Groep 1", "Kampioen"),
        "cc groep 2": ("Groep 2", "Talent"),
        "cc group 2": ("Groep 2", "Talent"),
        "cc groep 3": ("Groep 3", "Wild"),
        "cc group 3": ("Groep 3", "Wild"),
    }

    def __init__(self, serialized: object = "") -> None:
        self.names: dict[str, str] = {}
        self.audio_ids: dict[str, str] = {}
        self.audio_device_names: dict[str, str] = {}
        self.audio_container_ids: dict[str, str] = {}
        self.qualifier_groups: dict[str, str] = {}
        self.final_groups: dict[str, str] = {}
        try:
            rows = json.loads(serialized) if isinstance(serialized, str) else {}
            if isinstance(rows, dict):
                for identity, value in rows.items():
                    if not isinstance(identity, str):
                        continue
                    if isinstance(value, str):
                        self.set(identity, value)  # Earlier video-only preference.
                    elif isinstance(value, dict) and isinstance(value.get('name'), str) and isinstance(value.get('audioId', ''), str):
                        self.set(
                            identity,
                            value['name'],
                            audio_id=value.get('audioId', ''),
                            audio_device_name=value.get('audioDeviceName', ''),
                            audio_container_id=value.get('audioContainerId', ''),
                        )
                        self.set_group_defaults(
                            identity,
                            qualifier_group=value.get('qualifierGroup', ''),
                            final_group=value.get('finalGroup', ''),
                        )
        except (ValueError, TypeError):
            # Invalid preferences must never cause a guessed hardware match.
            self.names = {}
            self.audio_ids = {}
            self.audio_device_names = {}
            self.audio_container_ids = {}
            self.qualifier_groups = {}
            self.final_groups = {}

    def get(self, alternative_name: str) -> str:
        return self.names.get(alternative_name.strip().casefold(), "") if alternative_name else ""

    def audio_name(self, alternative_name: str) -> str:
        if not alternative_name:
            return ""
        identity = alternative_name.strip().casefold()
        matches = [self.names[key] for key, audio_id in self.audio_ids.items() if audio_id == identity]
        # A shared microphone/output is not the identity of a single card.
        return f"{matches[0]} · audio" if len(matches) == 1 else ""

    def paired_audio_id(self, video_id: str) -> str:
        """Only a uniquely associated endpoint may be selected automatically."""
        audio_id = self.audio_ids.get(video_id.strip().casefold(), '')
        return audio_id if audio_id and list(self.audio_ids.values()).count(audio_id) == 1 else ''

    def paired_audio_device_name(self, video_id: str) -> str:
        """Return a unique saved DirectShow name when Windows rotates its endpoint ID."""
        identity = video_id.strip().casefold()
        name = self.audio_device_names.get(identity, '')
        if not name:
            return ''
        matches = [value for value in self.audio_device_names.values() if value.casefold() == name.casefold()]
        return name if len(matches) == 1 else ''

    def paired_audio_container_id(self, video_id: str) -> str:
        identity = video_id.strip().casefold()
        container_id = self.audio_container_ids.get(identity, '')
        return container_id if container_id and list(self.audio_container_ids.values()).count(container_id) == 1 else ''

    def group_default(self, video_id: str, phase: str) -> str:
        """Return the saved route for one physical card and Tournament phase."""
        identity = video_id.strip().casefold()
        if not identity:
            return ""
        saved = self.final_groups if phase.strip().casefold() == "final" else self.qualifier_groups
        if saved.get(identity):
            return saved[identity]
        sticker_defaults = self._STICKER_DEFAULTS.get(self.names.get(identity, "").casefold())
        if sticker_defaults is None:
            return ""
        return sticker_defaults[1 if phase.strip().casefold() == "final" else 0]

    def set_group_defaults(
        self,
        video_id: str,
        *,
        qualifier_group: str | None = None,
        final_group: str | None = None,
    ) -> None:
        """Persist conscious routing changes without altering card/audio identity."""
        identity = video_id.strip().casefold()
        if not identity:
            raise ValueError("This device has no unique video ID; group defaults cannot be saved.")
        if qualifier_group is not None:
            value = qualifier_group.strip()
            if value:
                self.qualifier_groups[identity] = value
            else:
                self.qualifier_groups.pop(identity, None)
        if final_group is not None:
            value = final_group.strip()
            if value:
                self.final_groups[identity] = value
            else:
                self.final_groups.pop(identity, None)

    def set(
        self,
        alternative_name: str,
        name: str,
        *,
        audio_id: str = "",
        audio_device_name: str = "",
        audio_container_id: str = "",
    ) -> None:
        identity = alternative_name.strip().casefold()
        if not identity:
            raise ValueError("This device has no unique video ID; a remembered name cannot be assigned.")
        name = name.strip()
        if len(name) > 40 or any(unicodedata.category(c).startswith("C") for c in name):
            raise ValueError("Use a single-line name of at most 40 characters.")
        if name and any(key != identity and value.casefold() == name.casefold() for key, value in self.names.items()):
            raise ValueError("That name already belongs to another capture card.")
        if name:
            self.names[identity] = name
            if audio_id.strip():
                self.audio_ids[identity] = audio_id.strip().casefold()
            else:
                self.audio_ids.pop(identity, None)
            if audio_device_name.strip():
                self.audio_device_names[identity] = audio_device_name.strip()
            else:
                self.audio_device_names.pop(identity, None)
            if audio_container_id.strip():
                self.audio_container_ids[identity] = audio_container_id.strip().casefold()
            else:
                self.audio_container_ids.pop(identity, None)
        else:
            self.names.pop(identity, None)
            self.audio_ids.pop(identity, None)
            self.audio_device_names.pop(identity, None)
            self.audio_container_ids.pop(identity, None)
            self.qualifier_groups.pop(identity, None)
            self.final_groups.pop(identity, None)

    def serialize(self) -> str:
        return json.dumps({key: {
                               'name': name,
                               'audioId': self.audio_ids.get(key, ''),
                               'audioDeviceName': self.audio_device_names.get(key, ''),
                               'audioContainerId': self.audio_container_ids.get(key, ''),
                               'qualifierGroup': self.qualifier_groups.get(key, ''),
                               'finalGroup': self.final_groups.get(key, ''),
                           }
                           for key, name in self.names.items()}, ensure_ascii=False, sort_keys=True)
