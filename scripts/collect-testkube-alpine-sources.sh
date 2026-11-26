#!/usr/bin/env bash
# Collect source recipes and checksum-verified distfiles for CI evidence only.
set -euo pipefail
manifest=${1:?source manifest required}
output=${2:?source output required}
scratch=$(mktemp -d)
mkdir -p "$output/alpine"
output=$(realpath "$output")
repo="$scratch/aports"
git init -q "$repo"
git -C "$repo" remote add origin https://github.com/alpinelinux/aports.git
git -C "$repo" config remote.origin.promisor true
git -C "$repo" config remote.origin.partialclonefilter blob:none

# This tool image is disposable and is not included in the product artifacts.
docker build --pull -t testlab-local/alpine-source-collector:3.22 - <<'DOCKER'
FROM alpine:3.22
RUN apk add --no-cache abuild
DOCKER

while IFS=$'\t' read -r origin version commit packages; do
  [[ "$origin" =~ ^[a-zA-Z0-9][a-zA-Z0-9+._-]*$ && "$version" =~ ^[a-zA-Z0-9][a-zA-Z0-9+._~-]*$ && "$commit" =~ ^[a-f0-9]{40}$ && -n "$packages" ]]
  if ! git -C "$repo" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$repo" fetch --no-tags --depth=1 --filter=blob:none origin "$commit"
  fi
  test "$(git -C "$repo" rev-parse "$commit^{commit}")" = "$commit"
  recipe=''
  for section in main community testing; do
    if git -C "$repo" cat-file -e "$commit:$section/$origin/APKBUILD" 2>/dev/null; then
      test -z "$recipe"
      recipe="$section/$origin"
    fi
  done
  test -n "$recipe"
  dest="$output/alpine/$origin-$commit"
  mkdir -p "$dest/distfiles"
  git -C "$repo" archive --format=tar "$commit" "$recipe" > "$dest/recipe.tar"
  work=$(mktemp -d "$scratch/recipe.XXXXXXXX")
  tar -xf "$dest/recipe.tar" -C "$work" --strip-components=2
  test -s "$work/APKBUILD"
  # The runner owns these two disposable directories. Allow the unprivileged
  # container process to work in them without filesystem-override capabilities.
  chmod a+rwx "$work" "$dest/distfiles"
  # Only the exact, official upstream recipe is executed, in a disposable
  # container without credentials, privileged mode, or the host Docker socket.
  docker run --rm --cap-drop ALL --security-opt no-new-privileges \
    -e SRCDEST=/distfiles -e CARCH=x86_64 \
    -v "$work:/recipe" -v "$dest/distfiles:/distfiles" -w /recipe \
    --entrypoint sh testlab-local/alpine-source-collector:3.22 -ec '
      . ./APKBUILD
      test "${pkgver}-r${pkgrel}" = "$1"
      abuild -F fetch
    ' sh "$version"
  printf '%s\t%s\t%s\t%s\t%s\n' "$origin" "$version" "$commit" "$recipe" "$packages" >> "$output/alpine-source-evidence.tsv"
  # Bound CI artifact consumption; never silently omit a source.
  test "$(du -sm "$output" | cut -f1)" -le 300
done < "$manifest"

test -s "$output/alpine-source-evidence.tsv"
test "$(wc -l < "$manifest")" = "$(wc -l < "$output/alpine-source-evidence.tsv")"
