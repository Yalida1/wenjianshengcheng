#!/bin/sh
set -eu

backup_dir="${1:-./backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$backup_dir"

docker compose exec -T postgres pg_dump -U docchain -d docchain -Fc > "$backup_dir/postgres.dump"
docker compose exec -T minio sh -c 'tar -C /data -czf - .' > "$backup_dir/minio-data.tar.gz"
sha256sum "$backup_dir/postgres.dump" "$backup_dir/minio-data.tar.gz" > "$backup_dir/SHA256SUMS"

echo "Backup created at $backup_dir"
