import re
from pathlib import Path

from mk8dx_icon_matcher import slot_presence as sp

PACKAGE = Path(__file__).resolve().parents[2]


def test_decision_per_source_and_kind():
    assert sp.slot_present("hdmi", "flag", 44.0)["present"]          # the small translucent Portugal flag
    assert not sp.slot_present("hdmi", "flag", 9.0)["present"]       # an empty slot
    assert not sp.slot_present("photo", "flag", 19.9)["present"]
    assert sp.slot_present("photo", "icon", 21.5)["present"]
    assert sp.slot_present("hdmi", "icon", 0.0)["present"]           # hdmi has no icon threshold


def test_ports_carry_the_same_thresholds():
    ts = (PACKAGE / "ts" / "sharedSlotPresence.ts").read_text(encoding="utf-8")
    java = (PACKAGE / "java" / "src" / "main" / "java" / "nl" / "mariokart8" / "iconmatcher"
            / "SlotPresence.java").read_text(encoding="utf-8")
    photo = sp.PROFILES["photo"]
    hdmi = sp.PROFILES["hdmi"]
    assert re.search(r"photo: \{ statistic: 'gray_std', icon: ([\d.]+), flag: ([\d.]+) \}", ts).groups() == (
        str(photo["icon"]), str(photo["flag"]))
    assert re.search(r"hdmi: \{ statistic: 'channel_std', flag: ([\d.]+) \}", ts).group(1) == str(hdmi["flag"])
    assert float(re.search(r"PHOTO_ICON_MIN_GRAY_STD = ([\d.]+);", java).group(1)) == photo["icon"]
    assert float(re.search(r"PHOTO_FLAG_MIN_GRAY_STD = ([\d.]+);", java).group(1)) == photo["flag"]
    assert float(re.search(r"HDMI_FLAG_MIN_CHANNEL_STD = ([\d.]+);", java).group(1)) == hdmi["flag"]
