# Testen

[English version](TESTING.md)

Test wat je wijziging kan raken, niet alles. Zoek de component die de wijziging bezit en de omgekeerde
gebruikers in [component-registry.json](../component-registry.json), en draai voor elk de controles hieronder.
Een gedeeld contract, de catalogus, een CSS-token of de centrale lezer vraagt de leverancier **én** de
gebruikers. Overgeslagen of "todo"-tests zijn geen geslaagde tests. Zet eerst Node en de Python-testpakketten klaar
([Ontwikkelen](DEVELOPMENT_NL.md#clonen-en-controleren)); gebruik op Linux en macOS `python3` waar hier `python` staat.

## Bij elke wijziging

```sh
python tooling/privacy_scan.py
python tooling/check_boundaries.py
python tooling/check_docs.py
git diff --check
```

## Per component

| Component | Opdrachten (vanuit de root van de repository) |
| --- | --- |
| API (`backend/api`) | `npm ci --prefix backend/api`, daarna `npm run typecheck`, `npm test` en `npm run build` met `--prefix backend/api` |
| Website (`apps/timetrials-web`) | dezelfde vier opdrachten met `--prefix apps/timetrials-web` |
| Gedeelde CSS | `node tooling/design-system/css-metrics.mjs --check` |
| Browserscanner (`apps/timetrials-scanner-web`) | `npm ci --ignore-scripts`, `npm run sync-assets`, `npm run typecheck`, `npm run build` in die map |
| Openbare herkenningstestset | `node tooling/test-set/score_test_set.mjs` na `npm ci`, `sync-assets` en `npx --prefix apps/timetrials-scanner-web playwright install chromium` voor de scanner ([testset](../packages/assets/test-set/README.md)) |
| Centrale lezer (`packages/icon-matcher`) | zie hieronder |
| Databasemigraties en seeds | `python tooling/reference/generate_benchmark_manifest.py --check`, plus de [MySQL-integratietests](#database-integratietests) van de API |
| Design tokens (Web en Android) | `node packages/design-tokens/generate.mjs --check` |
| Installer, privacyscan (`tooling/`) | `python -m unittest discover -s tooling/tests` |
| Intaketool | `MK8DX_INTAKE_TEST_ROOT=<tijdelijke map buiten de repository> python tooling/test_intake.py -v` |
| LiveTrial (`apps/timetrials-desktop`) | zie hieronder |
| Android, Tournament | de bouw- en teststappen in [Client builds](CLIENT_BUILDS.md) |

Centrale lezer, TypeScript en Python:

```sh
node --experimental-strip-types --no-warnings \
  --experimental-loader ./packages/icon-matcher/ts/ts_resolve_hook.mjs \
  --test "packages/icon-matcher/ts/*.test.mjs"
PYTHONPATH=packages/icon-matcher/python python -m pytest -q packages/icon-matcher/python/tests
```

De Python-tests vragen de vastgepinde pakketten uit [requirements-dev.txt](../requirements-dev.txt). Tests met
private evaluatiebeelden worden overgeslagen als die niet zijn ingesteld.

LiveTrial-desktoptests (Windows; één test verwacht Windows-paden):

```powershell
$env:PYTHONPATH = "apps/timetrials-desktop"
python -m pytest -q -p no:cacheprovider apps/timetrials-desktop/tests
```

In een POSIX-shell: `PYTHONPATH=apps/timetrials-desktop python -m pytest -q apps/timetrials-desktop/tests`.
De dashboardtest draait met `node apps/timetrials-desktop/tests/history-startup.test.js` (ook in CI). `engine-overlay/livetrial/tests/test_names.py` vraagt de volledige LiveTrial-engine
en zijn Clean Assets-database, die niet in deze repository staan.

## Database-integratietests

De MySQL-tests van de API (`backend/api/test/*.integration.test.ts`, 35 bestanden) draai je bewust; zonder de
instellingen hieronder worden ze overgeslagen. Gebruik een **wegwerp**-MySQL 8.4-server, nooit de database van
een installatie.

| Variabele | Waarde |
| --- | --- |
| `MK8DX_MYSQL_INTEGRATION` | `1` |
| `MK8DX_MYSQL_TEST_HOST`, `MK8DX_MYSQL_TEST_PORT` | de testserver, bijvoorbeeld `127.0.0.1` en `33406` |
| `MK8DX_MYSQL_TEST_USER`, `MK8DX_MYSQL_TEST_PASSWORD` | een account voor het testschema (`root` van de wegwerpserver is het eenvoudigst) |
| `MK8DX_MYSQL_TEST_DATABASE` | het schema; de naam eindigt op `_test` of `_contract` |

- Het schema moet al **gemigreerd** zijn met `migration-apply-main.js --fresh-empty-database` (hieronder);
  anders falen de meeste suites met "table doesn't exist".
- `protected-value-rotation.integration.test.ts` weigert een schema dat niet op `_rotation_contract` eindigt.
- `tournament-operation`, `administrator-claim-review` en `mysql-firebase-backout-repository` vragen een schema
  dat nog niemand gebruikte. Het eenvoudigst en betrouwbaarst is één vers schema per suite.
- `reference-seed.integration.test.ts` vraagt ook `MK8DX_REFERENCE_TEST_CONFIG` en wordt anders overgeslagen.

Deze werkwijze draaide op 2026-11-02 alle 34 suites (alles behalve `reference-seed`) groen op MySQL 8.4.11, in
een POSIX-shell (Git Bash werkt op Windows); het wachtwoord is een weggooiwaarde voor de wegwerpcontainer.

```sh
docker run -d --name mk8dx-test-mysql -e MYSQL_ROOT_PASSWORD=throwaway-test-pw -p 127.0.0.1:33406:3306 mysql:8.4.11
until docker exec mk8dx-test-mysql mysqladmin ping -uroot -pthrowaway-test-pw --silent; do sleep 2; done
npm ci --prefix backend/api && npm run build --prefix backend/api
cd backend/api
export MK8DX_MYSQL_INTEGRATION=1 MK8DX_MYSQL_TEST_HOST=127.0.0.1 MK8DX_MYSQL_TEST_PORT=33406 \
  MK8DX_MYSQL_TEST_USER=root MK8DX_MYSQL_TEST_PASSWORD=throwaway-test-pw
env_file="$(mktemp)"; chmod 600 "$env_file"      # the migration CLI wants an owner-only file and an absolute path
n=0
for suite in test/*.integration.test.ts; do
  case "$suite" in *reference-seed*) continue ;; esac
  n=$((n + 1)); db="mk8dx_s${n}_test"
  case "$suite" in *protected-value-rotation*) db="mk8dx_s${n}_rotation_contract" ;; esac
  docker exec mk8dx-test-mysql mysql -uroot -p"$MK8DX_MYSQL_TEST_PASSWORD" -e "CREATE DATABASE $db"
  printf '{"MK8DX_HOSTED_MYSQL_HOST":"127.0.0.1","MK8DX_HOSTED_MYSQL_PORT":"33406","MK8DX_HOSTED_MYSQL_USER":"root","MK8DX_HOSTED_MYSQL_PASSWORD":"%s","MK8DX_HOSTED_MYSQL_DATABASE":"%s"}' \
    "$MK8DX_MYSQL_TEST_PASSWORD" "$db" > "$env_file"
  node dist/composition/migration-apply-main.js --private-environment-file "$env_file" \
    --migration-catalog ../../infrastructure/mysql/migration-catalog-v1.json --confirm-database "$db" --fresh-empty-database
  MK8DX_MYSQL_TEST_DATABASE="$db" npx vitest run --config vitest.config.ts "$suite"
done
rm -f "$env_file"; cd ../..
docker rm -f mk8dx-test-mysql
```

Geef in Git Bash de migratie-CLI een Windows-pad: `--private-environment-file "$(cygpath -w "$env_file")"`.
MariaDB 11.4, de gedocumenteerde engine voor webhosting, wordt nog niet door deze tests gedekt. Deel nooit
databaseconfiguratie of uitvoer met geheimen.

## Browsercontroles

Controleer een pagina-wijziging in een echte browser op 320, 375, 768 en 1440 pixels breed, in het Engels en
Nederlands: geen horizontaal scrollen, geen afgesneden of onbereikbare inhoud. Met een draaiende lokale
installatie zet je `MK8DX_TEST_ORIGIN` op het loopbackadres en draai je `node test/local-compose.browser.mjs`
vanuit `backend/api` (standaard Edge; `MK8DX_TEST_BROWSER_CHANNEL=chrome` kiest Chrome).

## Wijzigingen die meer vragen

Aanmelden, SQL, de installer, backup en herstel vragen tests tegen een echte wegwerpdatabase, inclusief
foutgevallen. Fysieke toestellen, capturehardware en een echt hostingaccount zijn aparte controles: zeg in je
pull request als je die niet kon uitvoeren.

## Wat CI draait

De Python-afhankelijkheidscontrole inventariseert alle getrackte `requirements*.txt` en `pyproject.toml`
met `python tooling/security/python_dependency_audit.py prepare <tijdelijke-map>`. Verify scant de exacte
derdepartijversies met OSV-Scanner zonder installatie of nieuwe resolverkeuzes en weigert CVSS 7.0+.
Tijdelijke uitzonderingen zijn pakket- en advisoryspecifiek en hebben een reden en vervaldatum in
[`python_audit_allowlist.toml`](../tooling/security/python_audit_allowlist.toml); een verlopen uitzondering
laat Verify falen. Versiebereiken vereisen elders een exacte pin. Deze broncontrole vervangt geen audit van
de geïnstalleerde transitieve runtime.

De [Verify-workflow](../.github/workflows/verify.yml) draait bij elke pull request en push naar `main`: de privacy-,
grens- en documentatiecontroles; de API- en Webcontroles; de TypeScript- en Python-tests van de centrale lezer;
de CSS-controle, de intakeproef en de toolingtests; gitleaks over de geschiedenis; `npm audit --omit=dev
--audit-level=high` voor API, Web en scanner; de assetcollectie, de scannerbuild en de openbare testset; de
Android-unittests en debug-APK; de LiveTrial-desktoptests (Windows) en een compileercontrole van de LiveTrial- en
toernooibronnen; de bouw van het toernooipakket (Windows); en de Docker-images.
[CodeQL](../.github/workflows/codeql.yml) analyseert JavaScript/TypeScript, Python en Java. De
database-integratietests draaien nog niet in CI.
