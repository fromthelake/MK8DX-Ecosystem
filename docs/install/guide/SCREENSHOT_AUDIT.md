# Illustrated A2 guide: screenshot review

The 30 screenshots below were compared with the current A2 steps on 2026-11-16.
Their exact SHA-256 hashes and byte sizes are in [images-reviewed-v1.json](images-reviewed-v1.json),
which the guide build and privacy scan check. `mk8dx-icon.png` is an icon, not a
screen capture. The English image is the intentional fallback in the other
13 guide languages; its text is not presented as a translated screen.

The original app/wizard build and capture viewport of the 28 retained images
were not recorded at capture time. Their pixel dimensions are listed here.
They were visually reviewed against the current written step, but this cannot
prove every control of the original capture is still identical on every device.
No production address, account, personal card, certificate or recovery code is
used as an example in these guide images.

| Step / example screen | English image and pixels | Dutch image and pixels | Review result |
| --- | --- | --- | --- |
| Wizard welcome | `wizard-welcome-en.png` 920×1095 | `wizard-welkom-nl.png` 920×1095 | Retained |
| Wizard checks | `wizard-check-en.png` 920×760 | `wizard-controle-nl.png` 920×760 | Retained |
| Network address | `wizard-network-en.png` 920×760 | `wizard-netwerk-nl.png` 920×760 | Retained |
| Recovery code | `recovery-code-en.png` 920×760 | `herstelcode-nl.png` 920×760 | Retained |
| Administrator adds people | `admin-people-en.png` 920×925 | `beheer-mensen-nl.png` 920×925 | Retained |
| Personal sign-in cards | `admin-cards-en.png` 920×1744 | `beheer-kaarten-nl.png` 920×1767 | Retained |
| New recovery code | `admin-new-code-en.png` 920×760 | `beheer-nieuwe-code-nl.png` 920×760 | Retained |
| Prepare a phone in browser | `phone-prepare-device-en.png` 780×1688 | `telefoon-apparaat-voorbereiden-nl.png` 780×1688 | Retained |
| Accept a browser invitation | `phone-accept-invitation-en.png` 780×921 | `telefoon-uitnodiging-accepteren-nl.png` 780×921 | Retained |
| Switch website account | `website-switch-account-en.png` 708×616 | `website-ander-account-nl.png` 708×756 | Retained |
| Android short code and address | `android-compare-en.png` 980×1600 | `android-vergelijken-nl.png` 980×1600 | **Recaptured** from current Android source, 2.99.15 build 185, on a disposable Android 36.1 emulator at 1080×2400. Cropped to the relevant 980×1600 content. Synthetic code `A136 1DF5 7802 E04E` and emulator-only `https://10.0.2.2`; EN/NL controls visually checked. |
| Change Android community | `android-change-server-en.png` 1260×730 | `android-server-wijzigen-nl.png` 1260×840 | Retained |
| Restore from backup | `wizard-restore-en.png` 920×760 | `wizard-terugzetten-nl.png` 920×760 | Retained |
| Move to a new address | `wizard-move-en.png` 920×760 | `wizard-verhuizen-nl.png` 920×760 | Retained |
| Wizard complete | `wizard-done-en.png` 920×760 | `wizard-klaar-nl.png` 920×760 | Retained |

The new Android captures show **Code** and **Address** first, with **Full
fingerprints** optional. They replace images that incorrectly emphasized the
long key. The remaining 28 were kept after the visual contact-sheet review;
review is limited to the visible guide scenes. The screenshot's alt text and
the written steps remain necessary because an image alone is not an instruction.
