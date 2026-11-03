"""Add SHA-256 records for every built release asset to a Syft SPDX document.

Syft recognizes some packages inside archives, but a scan of a directory of
ZIPs need not enumerate the ZIPs themselves. This step makes the asset-level
inventory complete; it does not claim to enumerate every nested dependency.
"""

import argparse
import hashlib
import json
from pathlib import Path


def complete(directory: Path, sbom: Path) -> int:
    document = json.loads(sbom.read_text(encoding="utf-8"))
    if document.get("spdxVersion") != "SPDX-2.3":
        raise ValueError("Expected an SPDX 2.3 JSON document")
    files = document.setdefault("files", [])
    relationships = document.setdefault("relationships", [])
    by_name = {entry["fileName"]: entry for entry in files}
    count = 0
    for asset in sorted(directory.iterdir()):
        if not asset.is_file() or asset.resolve() == sbom.resolve():
            continue
        with asset.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        existing = by_name.get(asset.name)
        if existing is not None:
            hashes = {item["algorithm"]: item["checksumValue"] for item in existing.get("checksums", [])}
            if hashes.get("SHA256") != digest:
                raise ValueError(f"Syft checksum differs from release asset: {asset.name}")
        else:
            spdx_id = "SPDXRef-ReleaseAsset-" + digest
            files.append({"fileName": asset.name, "SPDXID": spdx_id,
                          "fileTypes": ["ARCHIVE"] if asset.suffix.lower() in (".zip", ".apk") else ["DOCUMENTATION"],
                          "checksums": [{"algorithm": "SHA256", "checksumValue": digest}],
                          "licenseConcluded": "NOASSERTION", "licenseInfoInFiles": ["NOASSERTION"],
                          "copyrightText": "NOASSERTION"})
            relationships.append({"spdxElementId": "SPDXRef-DOCUMENT",
                                  "relatedSpdxElement": spdx_id, "relationshipType": "DESCRIBES"})
        count += 1
    sbom.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("sbom", type=Path)
    args = parser.parse_args()
    print(f"SPDX release assets: {complete(args.directory, args.sbom)}")
