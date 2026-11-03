#!/usr/bin/env bash
# Verify all API database suites against one disposable engine per CI matrix job.
set -euo pipefail

mk8dx_engine="${1:-}"
case "$mk8dx_engine" in
  mysql) mk8dx_image='mysql:8.4.11'; mk8dx_client='mysql' ;;
  mariadb) mk8dx_image='mariadb:11.4.12'; mk8dx_client='mariadb' ;;
  *) echo 'usage: run_database_integration_ci.sh mysql|mariadb' >&2; exit 2 ;;
esac

mk8dx_container="mk8dx-v010-ci-${mk8dx_engine}-${RANDOM}-${RANDOM}"
mk8dx_password="ci-only-${RANDOM}-${RANDOM}"
mk8dx_env_file="$(mktemp)"
chmod 600 "$mk8dx_env_file"
mk8dx_cleanup() {
  rm -f -- "$mk8dx_env_file"
  if [[ "$mk8dx_container" == mk8dx-v010-ci-* ]]; then
    docker rm -f "$mk8dx_container" >/dev/null 2>&1 || true
  fi
}
trap mk8dx_cleanup EXIT

docker run -d --name "$mk8dx_container" \
  -e "MYSQL_ROOT_PASSWORD=$mk8dx_password" \
  -p 127.0.0.1:33406:3306 "$mk8dx_image" >/dev/null

mk8dx_ready=0
for _attempt in $(seq 1 90); do
  # The bootstrap server accepts socket queries before it shuts down and the
  # final server starts. TCP is available only on the final server.
  if docker exec -e "MYSQL_PWD=$mk8dx_password" "$mk8dx_container" \
      "$mk8dx_client" --protocol=TCP -h127.0.0.1 -uroot -N -e 'SELECT 1' >/dev/null 2>&1; then
    mk8dx_ready=1
    break
  fi
  sleep 2
done
if [[ "$mk8dx_ready" != 1 ]]; then
  echo "$mk8dx_engine did not become ready" >&2
  docker logs --tail 60 "$mk8dx_container" >&2
  exit 1
fi

if [[ "$mk8dx_engine" == mariadb ]]; then
  docker exec -e "MYSQL_PWD=$mk8dx_password" "$mk8dx_container" \
    "$mk8dx_client" -uroot \
    -e "SET GLOBAL sql_mode='ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'"
fi

export MK8DX_MYSQL_INTEGRATION=1
export MK8DX_MYSQL_TEST_HOST=127.0.0.1
export MK8DX_MYSQL_TEST_PORT=33406
export MK8DX_MYSQL_TEST_USER=root
export MK8DX_MYSQL_TEST_PASSWORD="$mk8dx_password"

pushd backend/api >/dev/null
mk8dx_count=0
for mk8dx_suite in test/*.integration.test.ts; do
  mk8dx_count=$((mk8dx_count + 1))
  mk8dx_database="mk8dx_ci_${mk8dx_count}_test"
  if [[ "$mk8dx_suite" == *protected-value-rotation* ]]; then
    mk8dx_database="mk8dx_ci_${mk8dx_count}_rotation_contract"
  elif [[ "$mk8dx_suite" == *reference-seed* ]]; then
    mk8dx_database="mk8dx_ci_${mk8dx_count}_contract"
  fi
  echo "[$mk8dx_engine $mk8dx_count] $mk8dx_suite"
  docker exec -e "MYSQL_PWD=$mk8dx_password" "$mk8dx_container" \
    "$mk8dx_client" -uroot -e "CREATE DATABASE $mk8dx_database"
  printf '{"MK8DX_HOSTED_MYSQL_HOST":"127.0.0.1","MK8DX_HOSTED_MYSQL_PORT":"33406","MK8DX_HOSTED_MYSQL_USER":"root","MK8DX_HOSTED_MYSQL_PASSWORD":"%s","MK8DX_HOSTED_MYSQL_DATABASE":"%s"}\n' \
    "$mk8dx_password" "$mk8dx_database" > "$mk8dx_env_file"
  node dist/composition/migration-apply-main.js \
    --private-environment-file "$mk8dx_env_file" \
    --migration-catalog ../../infrastructure/mysql/migration-catalog-v1.json \
    --confirm-database "$mk8dx_database" --fresh-empty-database
  if [[ "$mk8dx_suite" == *reference-seed* ]]; then
    # This suite checks an update from an existing reference baseline.
    node dist/composition/reference-seed-main.js \
      --private-environment-file "$mk8dx_env_file" \
      --staff-seed ../../infrastructure/mysql/reference/nintendo-staff-v1.json \
      --world-record-seed ../../infrastructure/mysql/reference/world-records-v1.json
  fi
  MK8DX_MYSQL_TEST_DATABASE="$mk8dx_database" \
    MK8DX_REFERENCE_TEST_CONFIG="$mk8dx_env_file" \
    npx vitest run --config vitest.config.ts "$mk8dx_suite"
done
popd >/dev/null
if [[ "$mk8dx_count" != 35 ]]; then
  echo "Expected 35 database suites; found $mk8dx_count" >&2
  exit 1
fi
echo "$mk8dx_engine: all $mk8dx_count integration suites passed"
