from __future__ import annotations

import argparse
import os
from datetime import datetime
from pathlib import Path

from .client import ConnectionTarget, ConnectionTargetStore, ConnectedClient, ConnectedError, queue_upload, sign_in
from .session import SessionStore
from .server import selected_origin, save_origin


def _choose(items: tuple, description) -> object:
    if not items:
        raise ConnectedError("No eligible active/waiting Tournaments are available")
    for index, item in enumerate(items, 1):
        print(f"{index}. {description(item)}")
    raw = input("Choose a number, or press Ctrl+C to keep working offline: ").strip()
    try:
        return items[int(raw) - 1]
    except (ValueError, IndexError):
        raise ConnectedError("Invalid selection") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Optional MK8DX Tournament connection; local export remains independent")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sign-in")
    server = sub.add_parser("server")
    server.add_argument("address", nargs="?")
    sub.add_parser("sign-out")
    sub.add_parser("tournaments")
    sub.add_parser("target")
    sub.add_parser("clear-target")
    send = sub.add_parser("send")
    send.add_argument("file", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "server":
            if args.address:
                previous = selected_origin() or os.environ.get("MK8DX_TOURNAMENT_API_ORIGIN") or "https://example.invalid"
                if previous != args.address:
                    answer = input("Switch community? Old accounts and waiting uploads stay with the old server. Type YES: ")
                    if answer != "YES":
                        raise ConnectedError("Server change cancelled")
                save_origin(args.address)
            print(os.environ.get("MK8DX_TOURNAMENT_API_ORIGIN") or selected_origin() or "https://example.invalid")
            return 0
        store = SessionStore()
        if args.command == "sign-in":
            sign_in(store)
        elif args.command == "sign-out":
            store.clear()
            print("Signed out. Local processing is unchanged.")
        elif args.command == "tournaments":
            for tournament in ConnectedClient(store).tournaments():
                when = "date/time unknown" if tournament.start_at_ms is None else datetime.fromtimestamp(tournament.start_at_ms / 1000).astimezone().strftime("%d %b %Y %H:%M")
                print(f"{tournament.name} · {when} · {tournament.stage}")
        elif args.command == "target":
            client = ConnectedClient(store)
            tournament = _choose(client.tournaments(), lambda item: f"{item.name} · {item.stage}")
            group = _choose(tournament.groups, lambda item: f"{item['phase']} · {item['name']}")
            ConnectionTargetStore().save(ConnectionTarget(
                tournament_id=tournament.tournament_id,
                tournament_name=tournament.name,
                group_id=group["groupId"],
                group_name=group["name"],
                phase=group["phase"],
            ))
            print(f"Incremental feed target: {tournament.name} · {group['name']}")
        elif args.command == "clear-target":
            ConnectionTargetStore().clear()
            print("Incremental feed target cleared. Local processing is unchanged.")
        else:
            source = args.file.resolve()
            if not source.is_file():
                raise ConnectedError(f"Result file not found: {source}")
            client = ConnectedClient(store)
            tournaments = client.tournaments()
            tournament = _choose(tournaments, lambda item: f"{item.name} · {item.stage}")
            group = _choose(tournament.groups, lambda item: f"{item['phase']} · {item['name']}")
            race_number = int(input("Suggested first race number: ").strip())
            try:
                client.upload(source, tournament, group, race_number)
            except ConnectedError:
                queued = queue_upload(source, {
                    "tournament_id": tournament.tournament_id,
                    "group": group,
                    "race_number": race_number,
                })
                print(f"Upload unavailable. Result remains at {source}; retry context saved at {queued}")
                return 2
            print("Uploaded as pending evidence. Tournament Manager must still map and accept the race.")
        return 0
    except (ConnectedError, ValueError) as error:
        print(f"Connection workflow stopped: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
