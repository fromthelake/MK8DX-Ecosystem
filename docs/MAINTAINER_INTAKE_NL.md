# Wijzigingen uit de bron overnemen (onderhouders)

[English version](MAINTAINER_INTAKE.md)

Deze repository wordt gevoed vanuit de eigen ontwikkelomgeving van de onderhouder. `tooling/intake.py` neemt
beoordeelde wijzigingen daaruit over zonder iets privés mee te kopiëren. Gewone bijdragers hebben dit niet nodig;
zij openen een pull request. Wie een installatie wil bijwerken, gebruikt [Beheer](OPERATIONS_NL.md).

## Hoe het werkt

Een private JSON-**policy**, buiten deze repository, noemt:

- de alleen-lezen bronmap en deze repository als doel;
- een private statusmap voor baselines, plannen en het auditspoor;
- de exacte koppeling van bron- naar doelpaden, de gescande mappen, uitsluitingen en verwijderingen;
- vervangingsregels (een private hostnaam wordt bijvoorbeeld `mk8dx.example`) en geblokkeerde patronen die de
  import stoppen als er private kenmerken overblijven;
- "vaste" bestanden: een beoordeelde publieke tekst voor een bronbestand, alleen geldig zolang de hash van het
  bronbestand gelijk blijft;
- de controles per geraakte component.

Elke import vergelijkt drie bomen: de vorige opgeschoonde bron (`U0`), de huidige publieke repository (`P`) en de
nieuwe opgeschoonde bron (`U1`). Een bronwijziging aan een bestand dat publiek niet veranderde, wordt toegepast;
een wijziging die alleen publiek is gemaakt (documentatie, Dockerbestanden) blijft staan; onafhankelijke wijzigingen
worden samengevoegd; overlappende wijzigingen stoppen de import als conflict. Een nieuw bronbestand dat byte voor
byte gelijk is aan het bestaande publieke bestand, telt als al aanwezig. Toegepaste SQL-migraties veranderen nooit.

## Opdrachten

```sh
python tooling/intake.py plan     --config <private-policy.json>
python tooling/intake.py resolve  --config <private-policy.json> --plan-id <id> --resolution-dir <map>
python tooling/intake.py validate --config <private-policy.json> --plan-id <id>
python tooling/intake.py apply    --config <private-policy.json> --plan-id <id>
python tooling/intake.py recover  --config <private-policy.json> --plan-id <id>
python tooling/intake.py migrate-policy --config <nieuwe-policy.json> --baseline-dir <map> --old-policy-id <id>
```

- `plan` zet de opgeschoonde bron en een kandidaatboom klaar in de private statusmap en meldt de wijzigingen, de
  geraakte componenten en eventuele conflicten. Het raakt deze repository niet aan.
- `resolve` neemt voor elk conflict een beoordeelde oplossing aan, via SHA-256 gebonden aan de exacte bytes.
- `validate` draait de gekozen componentcontroles in de kandidaatboom.
- `apply` schrijft de wijzigingen in deze repository. Het weigert een vuile werkmap, een verouderd plan of een
  kandidaat die na de validatie veranderde, en houdt een journaal bij zodat `recover` een onderbroken toepassing
  terugdraait.
- `migrate-policy` legt een beoordeelde policywijziging vast (nieuwe koppelingen, vervangingen) zonder de
  padenset van de baseline te veranderen.

Bekijk na `apply` de `git diff`, draai `python tooling/privacy_scan.py` en `python tooling/check_boundaries.py`, en
commit.

## Oefenen

```sh
MK8DX_INTAKE_TEST_ROOT=<tijdelijke map buiten de repository> python tooling/test_intake.py -v
```

De synthetische tests dekken opeenvolgende imports, alleen-publieke wijzigingen, conflicten en hun oplossing,
verwijderen en hernoemen, identieke nieuwe bestanden, private kenmerken, pad- en junctionfouten, verouderde
plannen, onderbroken toepassingen, alleen-toevoegen-SQL en policymigratie.

## Assets in de collectie vervangen

Bestaande afbeeldingen in `packages/assets/collection/` hebben een eigen, smalle updateroute. Een private policy
met schema `mk8dx.collection-update-policy.v1` legt de huidige manifesthash en versie vast, de volgende versie,
een bronmap en de exacte lijst gewijzigde bestanden met hun vorige en nieuwe SHA-256:

```sh
python tooling/assets/update_collection.py plan     --policy <private-policy.json> --plan <private-plan.json>
python tooling/assets/update_collection.py validate --policy <private-policy.json> --plan <private-plan.json>
python tooling/assets/update_collection.py apply    --policy <private-policy.json> --plan <private-plan.json>
python tooling/assets/shared_asset_source.py verify
```

Het werkt de objectopslag, de collectieversie, de selecties per gebruiker en `compatibility.json` bij,
controleert de hele collectie en draait terug bij een fout. Nieuwe soorten bestanden, modellen en
cataloguswijzigingen lopen via de software-import hierboven.
