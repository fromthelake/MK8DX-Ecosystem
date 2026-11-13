"""Python result proposal: the TypeScript decision on hand-made evidence.

Full parity runs on recorded scanner evidence with
tooling/recognition/result_proposal_parity.py (private inputs).
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mk8dx_icon_matcher.result_proposal import compose_result_proposal  # noqa: E402


def read(kind, top, accepted=None, status="accepted", **extra):
    return {"schema": "mk8dx.visual-field-read.v1", "kind": kind, "profile": "result",
            "top": [{"id": i, "familyId": f, "score": s} for i, f, s in top],
            "top1Id": top[0][0], "acceptedId": accepted, "status": status,
            "cropPixelSha256": "c", "catalogSha256": "k", **extra}


def test_missing_fields_are_unavailable():
    fields = compose_result_proposal({})["fields"]
    assert {f["status"] for f in fields.values()} == {"unavailable"}


def test_visual_acceptance_passes_through_and_doubt_keeps_the_best_match():
    owner = {"kart": {"shared_icon_qa": read("bodies", [
        ("body_variant.pipe_frame.006_iggy", "body.pipe_frame", .846),
        ("body_variant.pipe_frame.005_green", "body.pipe_frame", .84)], status="unknown")},
        "wheel": {"shared_icon_qa": read("tires", [("tire.crimson_slim", "tire.crimson_slim", .84),
                                                   ("tire.slim", "tire.slim", .77)], "tire.crimson_slim")}}
    fields = compose_result_proposal(owner)["fields"]
    assert fields["wheel"]["acceptedId"] == "tire.crimson_slim" and not fields["wheel"]["reviewRequired"]
    kart = fields["kart"]
    assert kart["selectedId"] == "body_variant.pipe_frame.006_iggy" and kart["acceptedId"] is None
    assert kart["reviewRequired"] and kart["proposedFamilyId"] == "body.pipe_frame"


def test_tricolour_evidence_decides_a_dutch_looking_flag():
    flags = [("country.nl", "country.nl", .89), ("country.lu", "country.lu", .88), ("country.py", "country.py", .86)]
    flag = read("flags", flags, "country.nl",
                flag_distinctive_qa={"cropPixelSha256": "c", "top": [
                    {"id": "country.nl", "distance": 1.0}, {"id": "country.lu", "distance": 2.0},
                    {"id": "country.py", "distance": 3.0}]},
                flag_tricolor_qa={"schema": "mk8dx.flag-tricolor-evidence.v1", "status": "measured",
                                  "cropPixelSha256": "c", "acceptedId": None, "proposalId": "country.nl"})
    proposal = compose_result_proposal({"flag": {"shared_icon_qa": flag}})["fields"]["flag"]
    assert proposal["acceptedId"] is None and proposal["selectedId"] == "country.nl"
    assert "flag_tricolor_evidence" in proposal["evidence"]


def test_a_clipped_blue_white_keeps_nl_and_lu_under_review():
    from mk8dx_icon_matcher.result_proposal import compose_result_proposal as compose
    visual = {"schema": "mk8dx.visual-field-read.v1", "kind": "flags", "profile": "result", "catalogSha256": "b" * 64,
              "cropPixelSha256": "a" * 64, "status": "accepted", "top1Id": "country.nl", "acceptedId": "country.nl",
              "score": .95, "top": [{"id": "country.nl", "familyId": "country.nl", "score": .95},
                                    {"id": "country.lu", "familyId": "country.lu", "score": .9}]}
    assert compose({"flag": {"shared_icon_qa": visual}})["fields"]["flag"]["acceptedId"] == "country.nl"
    visual["photometric_qa"] = {"schema": "mk8dx.card-photometric.v1", "status": "corrected", "blueClipped": True}
    flag = compose({"flag": {"shared_icon_qa": visual}})["fields"]["flag"]
    assert flag["acceptedId"] is None and flag["selectedId"] == "country.nl"
    assert "photometric_blue_clipped" in flag["evidence"]


def _band(ratio, decision):
    return {"schema": "mk8dx.flag-band-ratio.v1", "status": "measured", "cropPixelSha256": "c",
            "ratio": ratio, "decisionId": decision}


def test_band_ratio_settles_nl_and_lu_even_with_a_clipped_blue_anchor():
    flags = [("country.lu", "country.lu", .91), ("country.nl", "country.nl", .90), ("country.py", "country.py", .86)]
    clipped = {"schema": "mk8dx.card-photometric.v1", "status": "corrected", "blueClipped": True}
    flag = read("flags", flags, "country.lu", photometric_qa=clipped, flag_band_ratio_qa=_band(.41, "country.nl"))
    proposal = compose_result_proposal({"flag": {"shared_icon_qa": flag}})["fields"]["flag"]
    assert proposal["acceptedId"] == "country.nl" and proposal["selectedId"] == "country.nl"
    assert proposal["top"][0]["id"] == "country.nl" and "flag_band_ratio" in proposal["evidence"]
    flag = read("flags", flags[1:2] + flags[:1] + flags[2:], "country.nl", flag_band_ratio_qa=_band(.75, "country.lu"))
    proposal = compose_result_proposal({"flag": {"shared_icon_qa": flag}})["fields"]["flag"]
    assert proposal["acceptedId"] == "country.lu" and proposal["proposedFamilyId"] == "country.lu"


def test_band_ratio_between_the_flags_keeps_review_and_other_flags_are_untouched():
    flags = [("country.nl", "country.nl", .91), ("country.lu", "country.lu", .90), ("country.py", "country.py", .86)]
    flag = read("flags", flags, "country.nl", flag_band_ratio_qa=_band(.65, None))
    proposal = compose_result_proposal({"flag": {"shared_icon_qa": flag}})["fields"]["flag"]
    assert proposal["acceptedId"] is None and proposal["selectedId"] == "country.nl"
    assert "flag_band_ratio_between" in proposal["evidence"]
    other = read("flags", [("country.fr", "country.fr", .93), ("country.nl", "country.nl", .80),
                           ("country.lu", "country.lu", .79)], "country.fr", flag_band_ratio_qa=_band(.41, "country.nl"))
    assert compose_result_proposal({"flag": {"shared_icon_qa": other}})["fields"]["flag"]["acceptedId"] == "country.fr"
    stale = read("flags", flags, "country.nl", flag_band_ratio_qa={**_band(.75, "country.lu"), "cropPixelSha256": "x"})
    assert compose_result_proposal({"flag": {"shared_icon_qa": stale}})["fields"]["flag"]["acceptedId"] == "country.nl"


def test_a_ghost_select_character_read_is_valid_only_for_the_character():
    char = read("characters", [("character.mario", "character.mario", .9)], "character.mario",
                profile="ghost_select")
    kart = read("bodies", [("body.pipe_frame", "body.pipe_frame", .9)], "body.pipe_frame",
                profile="ghost_select")
    fields = compose_result_proposal({"character": {"shared_icon_qa": char},
                                      "kart": {"shared_icon_qa": kart}})["fields"]
    assert fields["character"]["acceptedId"] == "character.mario"
    assert fields["kart"]["status"] == "unavailable"


def test_a_card_without_a_clear_winner_offers_mii_beside_the_best_match():
    # The owner's Mii card on a phone photo: three unrelated characters within 0.01.
    mii_card = read("characters", [("character.baby_rosalina", "character.baby_rosalina", .783),
                                   ("character.rosalina", "character.rosalina", .782),
                                   ("character.pink_gold_peach", "character.pink_gold_peach", .779)], status="unknown")
    field = compose_result_proposal({"character": {"shared_icon_qa": mii_card}})["fields"]["character"]
    assert field["selectedId"] == "character.baby_rosalina" and field["acceptedId"] is None
    assert [c["id"] for c in field["top"]][:2] == ["character.baby_rosalina", "character.mii_medium"]
    assert field["openSet"]["mode"] == "alternative" and "open_set_mii_alternative" in field["evidence"]
    # a clear but unaccepted read, or an accepted one, offers no Mii
    clear = read("characters", [("character.luigi", "character.luigi", .79),
                                ("character.mario", "character.mario", .74)], status="unknown")
    assert "openSet" not in compose_result_proposal({"character": {"shared_icon_qa": clear}})["fields"]["character"]
    accepted = read("characters", [("character.luigi", "character.luigi", .9)], "character.luigi")
    assert "openSet" not in compose_result_proposal({"character": {"shared_icon_qa": accepted}})["fields"]["character"]


def test_a_glider_colour_that_follows_the_character_is_proposed_not_accepted():
    # combine_part: an accepted character whose catalog colour clashes with the icon (#99).
    glider = read("gliders", [("glider.super", "glider.super", .92),
                              ("glider_variant.super.001_blue", "glider.super", .88)], "glider.super")
    chosen = {"id": None, "familyId": "glider.super", "status": "conflict",
              "evidence": ["visual_family", "character_colour_conflict_review"],
              "visualTop1": "glider.super", "suggestedId": "glider_variant.super.002_red"}
    field = compose_result_proposal({"glider": {"shared_icon_qa": glider,
                                                "part_text_qa": {"chosen": chosen}}})["fields"]["glider"]
    assert field["selectedId"] == "glider_variant.super.002_red" and field["acceptedId"] is None
    assert field["reviewRequired"] and field["proposedFamilyId"] == "glider.super"
    assert [c["id"] for c in field["top"]] == ["glider_variant.super.002_red", "glider.super",
                                               "glider_variant.super.001_blue"]
    assert field["top"][0]["basis"] == "context" and field["top"][0]["matchScore"] is None
    # Without a suggestion the best visual match stays the proposal.
    plain = compose_result_proposal({"glider": {"shared_icon_qa": glider, "part_text_qa": {
        "chosen": {**chosen, "suggestedId": None}}}})["fields"]["glider"]
    assert plain["selectedId"] == "glider.super" and plain["acceptedId"] is None
