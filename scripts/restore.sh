#!/bin/sh
set -eu

backup_dir="${1:?usage: scripts/restore.sh <backup-directory>}"
test -f "$backup_dir/postgres.dump"
test -f "$backup_dir/minio-data.tar.gz"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)

docker compose exec -T postgres pg_restore -U docchain -d docchain --clean --if-exists < "$backup_dir/postgres.dump"
docker compose exec -T minio sh -c 'tar -C /data -xzf -' < "$backup_dir/minio-data.tar.gz"

echo "Restore completed from $backup_dir"
