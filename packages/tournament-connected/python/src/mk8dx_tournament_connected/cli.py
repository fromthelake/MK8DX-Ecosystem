from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from .client import (
    NO_SESSION, SIGNED_OUT, ConnectionTarget, ConnectionTargetStore, ConnectedClient, ConnectedError,
    forget_local_session, queue_upload, sign_in, sign_out,
)
from .session import SessionStore
from .server import exact_origin, selected_origin, save_origin


ADDRESS_PROMPT = ("Website address of your community (for example https://tournament.example.org, "
                  "or http://127.0.0.1:<port> for a website on this PC): ")
NO_ADDRESS = ("No website address is set yet. Run TournamentConnect.cmd server <address> first, "
              "for example TournamentConnect.cmd server https://tournament.example.org")


def _ask_address_once() -> None:
    """sign-in with no address configured asks for it once and stores it like ``server <address>``."""
    if os.environ.get("MK8DX_TOURNAMENT_API_ORIGIN") or selected_origin():
        return
    if not sys.stdin or not sys.stdin.isatty():
        raise ConnectedError(NO_ADDRESS)
    try:
        address = input(ADDRESS_PROMPT).strip()
    except EOFError:
        raise ConnectedError(NO_ADDRESS) from None
    save_origin(exact_origin(address))
    print(f"Website address saved: {address}")


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
    signout = sub.add_parser("sign-out", help="End this PC's session on the community website, then remove it here")
    signout.add_argument("--this-pc-only", action="store_true",
                         help="Only remove the session from this PC; the website session is not ended")
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
        if args.command == "sign-in":
            _ask_address_once()
        store = SessionStore()
        if args.command == "sign-in":
            sign_in(store)
        elif args.command == "sign-out" and args.this_pc_only:
            forget_local_session(store)
            print("Removed the sign-in from this PC only. The session was NOT ended on the website; "
                  "use 'Sign out on all devices' in the website's account menu to end it there. "
                  "Local processing is unchanged.")
        elif args.command == "sign-out":
            result = sign_out(store)
            if result.state == SIGNED_OUT:
                print(f"Signed out on {result.host}: this session no longer works. "
                      "Other devices stay signed in. Local processing is unchanged.")
            elif result.state == NO_SESSION:
                print("No sign-in is stored on this PC. Local processing is unchanged.")
            else:
                print(f"Sign-out on {result.host} was not confirmed ({result.reason}). "
                      "The sign-in is still stored on this PC. Try again when online, or run "
                      "'sign-out --this-pc-only' and end the session with 'Sign out on all devices' "
                      "in the website's account menu.")
                return 2
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
